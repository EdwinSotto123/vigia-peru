"""Motor de agentes por SDK (MOTOR_AGENTES=sdk): corre los MISMOS sub-agentes ADK con el SDK de agentes del
proveedor de respaldo, que trae su propio bucle de herramientas, razonamiento y salida estructurada nativa.

De cada agente ADK se toma: el prompt (con lo que inyecta del estado), las herramientas (como MCP en proceso),
el `output_key` y el esquema de salida (agents/<agente>/config.py::OUTPUT_SCHEMA → agents/_shared/schemas).
Devuelve lo mismo que pipeline_runtime: eventos del trace, texto final, delta del estado y métricas.

Entorno (los nombres del paquete y del endpoint viven solo en la configuración del despliegue):
  MOTOR_SDK_MODULO      módulo Python del SDK (obligatoria).
  MOTOR_SDK_MODELO      id del modelo (obligatoria).
  MOTOR_SDK_ESFUERZO    low|medium|high (opcional): profundidad de razonamiento.
  MOTOR_SDK_PENSAR      tokens de razonamiento explícito (opcional, entero).
  MOTOR_SDK_ESQUEMA     1 (por defecto) = salida estructurada con el esquema del agente; 0 = texto.
  MOTOR_SDK_MAX_TURNOS  tope de vueltas del bucle de herramientas (por defecto 30).
  MOTOR_SDK_BUSQUEDA    nombre de la búsqueda web integrada del SDK, si se quiere en vez de la propia (opcional).
El endpoint y la clave del modelo los lee el propio SDK de su entorno (se configuran en el despliegue).
"""
from __future__ import annotations

import copy
import importlib
import json
import os
import re
import time
from types import SimpleNamespace
from typing import Any, AsyncIterator

from motores.motor_sdk import herramientas as _h

_SERVIDOR = "vigia"


def _sdk():
    mod = os.getenv("MOTOR_SDK_MODULO")
    if not mod:
        raise RuntimeError("MOTOR_AGENTES=sdk necesita MOTOR_SDK_MODULO")
    return importlib.import_module(mod)


# ─── prompt ───────────────────────────────────────────────────────────────────
_PLANTILLA = re.compile(r"{+[^{}]*}+")


def _inyectar(texto: str, state: dict) -> str:
    """Como ADK con un prompt de texto: `{clave}` → state[clave]; `{clave?}` opcional; lo demás queda igual."""
    def rep(m: re.Match) -> str:
        crudo = m.group()
        clave = crudo.lstrip("{").rstrip("}").strip()
        opcional = clave.endswith("?")
        clave = clave.rstrip("?")
        if not clave.isidentifier():
            return crudo
        if clave in state:
            v = state[clave]
            return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
        return "" if opcional else crudo
    return _PLANTILLA.sub(rep, texto)


async def prompt_de(agent: Any, state: dict) -> str:
    ins = getattr(agent, "instruction", "") or ""
    if callable(ins):
        res = ins(SimpleNamespace(state=state, agent_name=getattr(agent, "name", "")))
        if hasattr(res, "__await__"):
            res = await res
        return str(res or "")
    return _inyectar(str(ins), state)


# ─── esquema de salida ────────────────────────────────────────────────────────
def esquema_de(agent: Any) -> dict | None:
    """JSON Schema del esquema pydantic declarado en agents/<agente>/config.py (OUTPUT_SCHEMA), o None."""
    if os.getenv("MOTOR_SDK_ESQUEMA", "1") == "0":
        return None
    nombre = str(getattr(agent, "name", "")).removesuffix("_agent")
    try:
        cfg = importlib.import_module(f"agents.{nombre}.config")
        cls_nombre = getattr(cfg, "OUTPUT_SCHEMA", None)
        if not cls_nombre:
            return None
        from agents._shared import schemas
        cls = getattr(schemas, cls_nombre, None)
        return cls.model_json_schema() if cls is not None else None
    except Exception:
        return None


# ─── una corrida ──────────────────────────────────────────────────────────────
def _opciones(sdk, sistema: str, servidor, nombres: list[str], esquema: dict | None):
    kw: dict[str, Any] = dict(
        system_prompt=sistema,
        tools=[os.environ["MOTOR_SDK_BUSQUEDA"]] if os.getenv("MOTOR_SDK_BUSQUEDA") else [],
        mcp_servers={_SERVIDOR: servidor} if servidor is not None else {},
        allowed_tools=[f"mcp__{_SERVIDOR}__{n}" for n in nombres] + ([os.environ["MOTOR_SDK_BUSQUEDA"]] if os.getenv("MOTOR_SDK_BUSQUEDA") else []),
        model=os.environ["MOTOR_SDK_MODELO"],
        max_turns=int(os.getenv("MOTOR_SDK_MAX_TURNOS", "30")),
        permission_mode="bypassPermissions",
        setting_sources=[],
        cwd="/tmp" if os.path.isdir("/tmp") else None,
    )
    if os.getenv("MOTOR_SDK_ESFUERZO"):
        kw["effort"] = os.environ["MOTOR_SDK_ESFUERZO"]
    if os.getenv("MOTOR_SDK_PENSAR"):
        kw["thinking"] = {"type": "enabled", "budget_tokens": int(os.environ["MOTOR_SDK_PENSAR"])}
    if esquema:
        kw["output_format"] = {"type": "json_schema", "schema": esquema}
    return _clase_opciones(sdk)(**{k: v for k, v in kw.items() if v is not None})


def _clase_opciones(sdk):
    """La clase de opciones del SDK (`…AgentOptions`): se busca por sufijo para no atar el código a su nombre."""
    for n in dir(sdk):
        if n.endswith("AgentOptions"):
            return getattr(sdk, n)
    raise RuntimeError("el SDK no expone una clase *AgentOptions")


async def _correr(agent: Any, msg_text: str, state: dict) -> tuple[list[dict], str | None, Any, dict]:
    """Corre el agente sobre `state` (se escribe en él). Devuelve (eventos, texto_final, salida, métricas)."""
    sdk = _sdk()
    nombre = getattr(agent, "name", "agent")
    eventos: list[dict] = []
    metr = {"prompt": 0, "output": 0, "total": 0, "calls": 0, "cost": 0.0, "thoughts": 0, "cached": 0}
    # init_state de agents/_shared/callbacks.py (el único callback que toca el estado).
    state.setdefault("pending_flags", [])
    state.setdefault("market_findings", [])

    tools, omitidas = _h.convertir(sdk, getattr(agent, "tools", None) or [], state, nombre, eventos)
    if omitidas:
        eventos.append({"agent": nombre, "kind": "warn", "detail": f"motor sdk: herramientas sin equivalente: {omitidas}"})
    servidor = sdk.create_sdk_mcp_server(_SERVIDOR, tools=tools) if tools else None
    nombres = _h.nombres_mcp(getattr(agent, "tools", None) or [])
    sistema = await prompt_de(agent, state)
    integrada = _h.busqueda_integrada()
    if integrada and any(getattr(t, "__name__", getattr(t, "name", "")) == "google_search" for t in getattr(agent, "tools", None) or []):
        sistema += (f"\n\nPara buscar en la web usa la herramienta `{integrada}` (reemplaza a `google_search`). "
                    "Solo cita URLs que aparezcan en sus resultados.")
    busquedas: dict[str, str] = {}
    esquema = esquema_de(agent)

    texto, salida, t0 = None, None, time.monotonic()
    for intento in (0, 1):
        try:
            async for m in sdk.query(prompt=msg_text, options=_opciones(sdk, sistema, servidor, nombres, esquema)):
                tipo = type(m).__name__
                if tipo == "AssistantMessage":
                    metr["calls"] += 1
                    for b in getattr(m, "content", []) or []:
                        bt = type(b).__name__
                        if bt == "TextBlock" and getattr(b, "text", ""):
                            texto = b.text
                        elif bt == "ThinkingBlock":
                            eventos.append({"agent": nombre, "kind": "thought", "text": str(getattr(b, "thinking", ""))[:8000]})
                        elif bt in ("ToolUseBlock", "ServerToolUseBlock") and integrada and getattr(b, "name", "") == integrada:
                            busquedas[getattr(b, "id", "")] = str((getattr(b, "input", None) or {}).get("query", ""))
                            eventos.append({"agent": nombre, "kind": "tool_call", "name": "google_search",
                                            "args": {"consulta": busquedas[getattr(b, "id", "")]}})
                        elif bt == "ServerToolResultBlock" and getattr(b, "tool_use_id", None) in busquedas:
                            _publicar_busqueda(state, nombre, getattr(b, "content", None), eventos)
                elif tipo == "UserMessage":
                    for b in getattr(m, "content", None) if isinstance(getattr(m, "content", None), list) else []:
                        if type(b).__name__ == "ToolResultBlock" and getattr(b, "tool_use_id", None) in busquedas:
                            _publicar_busqueda(state, nombre, getattr(b, "content", None), eventos)
                elif tipo == "ResultMessage":
                    u = getattr(m, "usage", None) or {}
                    metr["prompt"] += int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0)
                    metr["cached"] += int(u.get("cache_read_input_tokens") or 0)
                    metr["output"] += int(u.get("output_tokens") or 0)
                    if getattr(m, "is_error", False):
                        eventos.append({"agent": nombre, "kind": "error",
                                        "detail": f"motor sdk: {getattr(m, 'subtype', '')} {str(getattr(m, 'errors', '') or '')[:300]}"})
                    salida = getattr(m, "structured_output", None)
                    texto = getattr(m, "result", None) or texto
            break
        except Exception as e:  # noqa: BLE001
            # Un esquema que la API no acepta no debe dejar al agente sin salida: un reintento en texto libre.
            if intento == 0 and esquema is not None:
                eventos.append({"agent": nombre, "kind": "warn", "detail": f"motor sdk: sin salida estructurada ({str(e)[:200]})"})
                esquema = None
                continue
            eventos.append({"agent": nombre, "kind": "error", "detail": f"run: {str(e)[:300]}"})
            break

    metr["total"] = metr["prompt"] + metr["output"]
    um = SimpleNamespace(prompt_token_count=metr["prompt"], cached_content_token_count=metr["cached"],
                         candidates_token_count=metr["output"], thoughts_token_count=0, traffic_type=None)
    try:
        from tools import costo_llm
        metr["cost"] = round(costo_llm.costo("respaldo", um), 6)
        costo_llm.registrar_externo("respaldo", nombre, um)
        if busquedas:   # la búsqueda integrada se cobra aparte por consulta (BUSQUEDA_USD_POR_BUSQUEDA)
            por_una = float(os.getenv("BUSQUEDA_USD_POR_BUSQUEDA", "0.01"))
            cero = SimpleNamespace(prompt_token_count=0, cached_content_token_count=0, candidates_token_count=0,
                                   thoughts_token_count=0, traffic_type=None)
            for _ in busquedas:
                costo_llm.registrar_externo("respaldo", "busqueda_web", cero, extra_usd=por_una)
            metr["cost"] = round(metr["cost"] + por_una * len(busquedas), 6)
        metr["busquedas"] = len(busquedas)
    except Exception:
        pass
    ok = getattr(agent, "output_key", None)
    if ok:
        state[ok] = salida if salida is not None else (texto or "")
    if texto:
        eventos.append({"agent": nombre, "kind": "final", "text": texto[:8000],
                        "segundos": round(time.monotonic() - t0, 1)})
    return eventos, texto, salida, metr


_URL = re.compile(r"https?://[^\s\"'<>)\]]+")


def _publicar_busqueda(state: dict, agente: str, contenido: Any, eventos: list) -> None:
    """URLs de un resultado de la búsqueda integrada → state['grounding_urls'] (como tools/busqueda), para que el
    verificador las reconozca como respaldadas."""
    texto = json.dumps(contenido, ensure_ascii=False, default=str) if not isinstance(contenido, str) else contenido
    urls = list(dict.fromkeys(u.rstrip(".,;") for u in _URL.findall(texto)))[:25]
    try:
        from tools.busqueda import _publicar
        _publicar(state, [{"url": u} for u in urls])
    except Exception:
        pass
    eventos.append({"agent": agente, "kind": "tool_result", "name": "google_search",
                    "result_preview": {"n_fuentes": len(urls), "fuentes": urls[:10]}})


def _delta(seed: dict, state: dict) -> dict:
    return {k: v for k, v in state.items() if k not in seed or seed[k] != v}


def _sumar(dst: dict, src: dict) -> None:
    for k in ("prompt", "output", "total", "calls", "thoughts", "cached"):
        dst[k] = (dst.get(k) or 0) + (src.get(k) or 0)
    dst["cost"] = round(float(dst.get("cost") or 0.0) + float(src.get("cost") or 0.0), 6)


# ─── las tres funciones del contrato de pipeline_runtime ─────────────────────
async def run_agent(agent, msg_text: str, state: dict, session_service, user_id: str, metrics: dict) -> AsyncIterator[dict]:
    """Como pipeline_runtime._run_agent: escribe en `state` y suma a `metrics`."""
    from pipeline_runtime import _metrics_event
    evs, texto, _salida, m = await _correr(agent, msg_text, state)
    for e in evs:
        yield e
    _sumar(metrics, m)
    yield _metrics_event(metrics, getattr(agent, "name", "agent"))
    state["_last_agent_final"] = texto


async def run_agent_delta(agent, msg_text: str, base_state: dict, session_service, user_id: str,
                          output_key: str | None = None):
    """Como pipeline_runtime._run_agent_delta: no toca `base_state`; devuelve solo lo que el agente escribió."""
    seed = copy.deepcopy(base_state)
    trabajo = copy.deepcopy(base_state)
    evs, texto, _salida, m = await _correr(agent, msg_text, trabajo)
    delta = _delta(seed, trabajo)
    if output_key and output_key not in delta and output_key in trabajo:
        delta[output_key] = trabajo[output_key]
    return evs, texto, delta, m


async def run_agent_isolated(agent, msg_text: str, base_state: dict, output_key: str, session_service, user_id: str):
    """Como pipeline_runtime._run_agent_isolated: devuelve solo {output_key: valor}."""
    trabajo = copy.deepcopy(base_state)
    evs, texto, _salida, m = await _correr(agent, msg_text, trabajo)
    delta = {output_key: trabajo[output_key]} if output_key in trabajo else {}
    if not delta:
        evs.append({"agent": getattr(agent, "name", "agent"), "kind": "warn",
                    "detail": f"merge: output_key '{output_key}' ausente en el sub-agente — sección pudo perderse"})
    return evs, texto, delta, m
