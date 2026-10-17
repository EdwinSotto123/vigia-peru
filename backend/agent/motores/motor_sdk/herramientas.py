"""Herramientas ADK → herramientas MCP en proceso del SDK de agentes.

Las funciones son las mismas que usa ADK (tools/*.py): se llaman con el mismo `tool_context` mínimo que usa el
pipeline (`.state`, ver pipeline_runtime._Shim), así que lo que escriben en el estado queda donde siempre.
El esquema de argumentos sale de la declaración que ADK ya genera para el modelo (FunctionDeclaration).
"""
from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any, Callable

# Tope del resultado que vuelve al modelo (los resultados de BD pueden ser enormes; el estado guarda el entero).
MAX_RESULTADO = 400_000
# El CLI del SDK manda a un archivo (que el agente no puede leer: no tiene herramientas de archivos) todo resultado
# de más de ~50 KB, y el agente se queda sin el dato (medido 2026-10-16: get_dictamen_context, ~52 KB, dejaba el
# dictamen sin redactar en 15 de 20 contratos). Los resultados largos se entregan por partes de este tamaño.
TAM_PARTE = 40_000
CONTINUAR = "continuar_resultado"


class ContextoHerramienta:
    """ToolContext mínimo: las tools solo usan `.state` (como pipeline_runtime._Shim)."""
    __slots__ = ("state",)

    def __init__(self, state: dict):
        self.state = state


def esquema_json(schema: Any) -> dict:
    """genai.types.Schema (tipos en MAYÚSCULAS) o dict → JSON Schema en minúsculas."""
    if schema is None:
        return {"type": "object", "properties": {}}
    d = schema.model_dump(exclude_none=True, mode="json") if hasattr(schema, "model_dump") else dict(schema)

    def conv(x: Any) -> Any:
        if isinstance(x, dict):
            out = {}
            for k, v in x.items():
                if k == "type" and isinstance(v, str):
                    out[k] = v.lower()
                elif k in ("properties",) and isinstance(v, dict):
                    out[k] = {pk: conv(pv) for pk, pv in v.items()}
                elif k in ("items", "any_of", "anyOf"):
                    out["anyOf" if k == "any_of" else k] = conv(v)
                elif k in ("required", "enum", "description", "format", "nullable", "minimum", "maximum"):
                    out[k] = v
            if out.get("type") == "type_unspecified":
                out.pop("type")
            return out
        if isinstance(x, list):
            return [conv(i) for i in x]
        return x

    out = conv(d)
    out.setdefault("type", "object")
    if out["type"] == "object":
        out.setdefault("properties", {})
    return out


def declaracion(tool: Any) -> tuple[str, str, dict]:
    """(nombre, descripción, JSON Schema de argumentos) de una tool ADK."""
    nombre = getattr(tool, "name", None) or getattr(getattr(tool, "func", None), "__name__", "herramienta")
    desc = getattr(tool, "description", None) or ""
    params: dict = {"type": "object", "properties": {}}
    try:
        decl = tool._get_declaration()
        if decl is not None:
            desc = desc or (decl.description or "")
            pj = getattr(decl, "parameters_json_schema", None)
            if isinstance(pj, dict) and pj:
                params = pj
            elif getattr(decl, "parameters", None) is not None:
                params = esquema_json(decl.parameters)
    except Exception:
        pass
    return nombre, desc, params


def busqueda_integrada() -> str | None:
    """Nombre de la búsqueda web integrada del SDK (MOTOR_SDK_BUSQUEDA), si se usa en vez de tools/busqueda."""
    import os
    return os.getenv("MOTOR_SDK_BUSQUEDA") or None


def nombres_mcp(tools: list) -> list[str]:
    """Los nombres con que `convertir` registra las tools (mismo filtro)."""
    out = []
    for t in tools or []:
        if getattr(t, "func", None) is None and inspect.isfunction(t):
            from google.adk.tools import FunctionTool
            t = FunctionTool(t)
        if getattr(t, "func", None) is None:
            continue
        n = declaracion(t)[0]
        if n == "google_search" and busqueda_integrada():
            continue
        out.append(n)
    return out + ([CONTINUAR] if out else [])


def _serializar(res: Any) -> str:
    try:
        txt = json.dumps(res, ensure_ascii=False, default=str)
    except Exception:
        txt = str(res)
    return txt if len(txt) <= MAX_RESULTADO else txt[:MAX_RESULTADO] + "…(recortado)"


async def ejecutar(func: Callable, args: dict, state: dict) -> Any:
    """Llama la función de la tool (sync en un hilo, async directo) con el contexto mínimo si lo pide."""
    kw = dict(args or {})
    try:
        if "tool_context" in inspect.signature(func).parameters:
            kw["tool_context"] = ContextoHerramienta(state)
    except (TypeError, ValueError):
        pass
    if inspect.iscoroutinefunction(func):
        return await func(**kw)
    return await asyncio.to_thread(func, **kw)


def partir(texto: str, almacen: dict, tam: int = TAM_PARTE) -> str:
    """Texto entero si cabe; si no, la parte 1 con el aviso de cómo pedir el resto (las partes quedan en `almacen`)."""
    if len(texto) <= tam:
        return texto
    partes = [texto[i:i + tam] for i in range(0, len(texto), tam)]
    rid = f"r{len(almacen) + 1}"
    almacen[rid] = partes
    return (f"[Resultado largo: parte 1 de {len(partes)}. Para leer el resto llama `{CONTINUAR}` con "
            f"resultado_id=\"{rid}\" y parte=2 … {len(partes)}; no respondas sin leer todas las partes que necesites.]\n"
            + partes[0])


def herramienta_continuar(sdk: Any, almacen: dict):
    async def _c(args: dict) -> dict:
        partes = almacen.get(str(args.get("resultado_id")))
        n = int(args.get("parte") or 0)
        if not partes or not 1 <= n <= len(partes):
            return {"content": [{"type": "text", "text": "parte inexistente"}], "is_error": True}
        return {"content": [{"type": "text", "text": f"[parte {n} de {len(partes)}]\n" + partes[n - 1]}]}
    return sdk.tool(CONTINUAR, "Devuelve la parte N de un resultado largo de otra herramienta.",
                    {"type": "object", "properties": {"resultado_id": {"type": "string"}, "parte": {"type": "integer"}},
                     "required": ["resultado_id", "parte"]})(_c)


def convertir(sdk: Any, tools: list, state: dict, agente: str, eventos: list) -> tuple[list, list[str]]:
    """Tools ADK de un agente → (tools MCP del SDK, nombres no soportados). Cada llamada deja su par
    tool_call/tool_result en `eventos`, con el mismo formato que el motor ADK (pipeline_runtime._parse_event)."""
    from pipeline_runtime import _truncate_result

    salida, omitidas = [], []
    almacen: dict[str, list[str]] = {}
    for t in tools or []:
        func = getattr(t, "func", None)
        if func is None and inspect.isfunction(t):   # función suelta (ADK la envuelve sola): tools/busqueda.google_search
            from google.adk.tools import FunctionTool
            t = FunctionTool(t)
            func = t.func
        if func is None:          # tools nativas del modelo (p. ej. el grounding de Gemini): no existen acá
            omitidas.append(getattr(t, "name", type(t).__name__))
            continue
        nombre, desc, params = declaracion(t)
        if nombre == "google_search" and busqueda_integrada():
            continue              # la reemplaza la búsqueda del SDK (ver motor_sdk._correr)

        def _hacer(func=func, nombre=nombre):
            async def _h(args: dict) -> dict:
                eventos.append({"agent": agente, "kind": "tool_call", "name": nombre, "args": dict(args or {})})
                try:
                    res = await ejecutar(func, args, state)
                    error = False
                except Exception as e:  # noqa: BLE001  (como el motor ADK: el error vuelve al modelo, no corta)
                    res, error = {"error": f"{type(e).__name__}: {str(e)[:300]}"}, True
                eventos.append({"agent": agente, "kind": "tool_result", "name": nombre,
                                "result_preview": _truncate_result(res)})
                return {"content": [{"type": "text", "text": partir(_serializar(res), almacen)}],
                        **({"is_error": True} if error else {})}
            return _h

        salida.append(sdk.tool(nombre, desc[:1024], params)(_hacer()))
    if salida:
        salida.append(herramienta_continuar(sdk, almacen))
    return salida, omitidas
