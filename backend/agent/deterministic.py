"""
Orquestación DETERMINISTA del pipeline Vigía.

En vez de que el orquestador-LLM decida (y se rinda antes de terminar) qué
sub-agente llamar, ESTE módulo ejecuta la secuencia fija en CÓDIGO. Garantiza
que TODOS los agentes corran SIEMPRE (no más "faltó red de personas").

Modelo de state:
  · UN dict `state` es la fuente de verdad (lo controla el código).
  · TOOLS → se llaman directo con un shim (`shim.state = state`); mutan `state`
    in-place. (Ninguna tool usa `tool_context` más allá de `.state`.)
  · SUB-AGENTES → se corren con un `Runner` sobre una sesión FRESCA sembrada con
    `dict(state)`; al terminar se mergea `session.state` de vuelta a `state`
    (propaga el `output_key` + escrituras de sus tools). Sesión fresca por agente
    = sin contaminación de conversación entre agentes (solo comparten state).

Selección por flag en main.py: `DETERMINISTIC_PIPELINE` (default on).

Concurrencia: con `PIPELINE_DAG=1` (default) las fases independientes corren como ramas
paralelas (compliance ∥ [parser → legal ∥ market] ∥ [proveedor → web ∥ prensa ∥ funcionarios])
y el resto (person_network → compliance_extended → dictamen) tras el join; ver el bloque
"DAG paralelo" más abajo (dependencias y claves que escribe cada rama). `PIPELINE_DAG=0`
vuelve a la secuencia histórica.

Matriz tipo × etapa (backend/core/clasificacion.py): si el state trae
`agentes_permitidos` (lo manda el dispatcher vía `clasificacion` en el body), cada
sub-agente corre solo si está en la lista — los demás emiten un `phase` "omitido: …"
para que el tablero lo muestre. Sin esa clave corren TODOS (análisis a demanda del
admin: flujo idéntico al anterior). `validaciones_pendientes` va al report_writer, que
las lista al final del dictamen sin inventar nada.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import os
import uuid
from typing import Any, AsyncIterator

from google.adk.runners import Runner
from google.genai import types as gtypes

import agents as A
import tools as T
from agents._shared.profiles import Profile, get_profile

APP_NAME = "vigia-peru"

# ── Interfaces de otros workstreams (pueden no existir todavía) ─────────────
# Cada import cae a None y el driver conserva el comportamiento actual en ese punto.
try:  # WS D · selección determinista + lote de documentos con texto persistido
    from tools.doc_select import seleccionar_documentos as _seleccionar_documentos
except (ImportError, AttributeError):
    _seleccionar_documentos = None
try:  # WS D · entrada de `recortes` cuando la selección dejó documentos fuera por el tope
    from tools.doc_select import recorte_seleccion as _recorte_seleccion
except (ImportError, AttributeError):
    _recorte_seleccion = None
try:  # WS D
    from tools.documentos import parse_documentos_lote as _parse_documentos_lote
except (ImportError, AttributeError):
    _parse_documentos_lote = None
try:  # WS M · mercado por estrategia del perfil
    from tools.market import analizar_mercado as _analizar_mercado
except (ImportError, AttributeError):
    _analizar_mercado = None
try:  # WS V · verificación determinista del dictamen
    from tools.verify import verificar_dictamen as _verificar_dictamen
except (ImportError, AttributeError):
    _verificar_dictamen = None
try:  # WS V · reglas por slug (para correrlas en código cuando el perfil omite el agente)
    from tools.compliance_rules import REGLAS_POR_NOMBRE as _REGLAS_POR_NOMBRE
except (ImportError, AttributeError):
    _REGLAS_POR_NOMBRE = None
try:  # WS M · schemas pydantic con evidencia obligatoria
    from agents._shared import schemas as _schemas
except (ImportError, AttributeError):
    _schemas = None

# Paralelización de los 3 agentes de investigación INDEPENDIENTES (web ∥ prensa ∥
# funcionarios). Los tres son grounding-only (solo google_search) y escriben ÚNICAMENTE
# su propio output_key (verificado: web_research/news_research/entity_personnel) → no
# tocan acumuladores compartidos, así que correrlos concurrentes y mergear solo su
# output_key es seguro. Corta ~3×latencia-secuencial → ~1×la-del-más-lento en esa franja
# (la causa raíz de que los contratos doc-pesados muriesen en el wall de 3600s de Cloud
# Run). Flag para rollback instantáneo a secuencial sin redeploy.
_PARALLEL_RESEARCH = os.getenv("PARALLEL_RESEARCH", "1") != "0"


def permitido(state: dict, nombre: str, profile: Profile | None = None) -> bool:
    """¿Corre el sub-agente `nombre` (nombre canónico: compliance, document_parser,
    document_legal_analyst, market, web_research, news_research, entity_personnel,
    person_network, compliance_extended, report_writer)?

    = intersección de la matriz tipo × etapa (`agentes_permitidos`, lo manda el dispatcher)
    con los agentes del PERFIL del servicio (`PIPELINE_PROFILE`). Sin `agentes_permitidos`
    → decide solo el perfil (análisis a demanda); sin perfil → bienes (todos)."""
    prof = profile or get_profile()
    if nombre not in prof.agentes:
        return False
    perm = state.get("agentes_permitidos")
    if not isinstance(perm, (list, tuple, set)):
        return True
    return nombre in perm


# Nombres de las fases/agentes que emite este driver (los tests de perfiles verifican que
# `Profile.agentes` ⊆ FASES). Mismo orden que backend/dispatcher/events.FASES.
FASES: tuple[str, ...] = (
    "compliance", "document_parser", "document_legal_analyst", "market",
    "web_research", "news_research", "entity_personnel", "person_network",
    "compliance_extended", "report_writer",
)


def _kwargs_soportados(fn, **extra) -> dict:
    """Filtra `extra` a los kwargs que `fn` acepta (para pasar parámetros de perfil a tools
    de otros WS que pueden no haberlos incorporado todavía)."""
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return {}
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return dict(extra)
    return {k: v for k, v in extra.items() if k in params}


def _registrar_recorte(state: dict, donde: str, limite, omitido) -> None:
    """Todo tope aplicado queda registrado (ningún recorte silencioso)."""
    state.setdefault("recortes", []).append({"donde": donde, "limite": limite, "omitido": omitido})


def _registrar_descarte(state: dict, donde: str, motivo: str, detalle=None) -> None:
    state.setdefault("descartes", []).append({"donde": donde, "motivo": motivo, "detalle": detalle})


def _parse_json_flexible(v):
    """dict desde un output_key que puede venir como dict, str JSON o str con fences."""
    if isinstance(v, dict):
        return v
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    if s.startswith("```"):
        nl = s.find("\n")
        s = s[nl + 1:] if nl > 0 else s
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    try:
        return json.loads(s)
    except Exception:
        i, j = s.find("{"), s.rfind("}")
        if i != -1 and j > i:
            try:
                return json.loads(s[i:j + 1])
            except Exception:
                return None
    return None


def _validar_schema(state: dict, key: str, schema_name: str) -> dict | None:
    """Valida `state[key]` contra `agents._shared.schemas.<schema_name>` (WS M) en el DRIVER.

    No se usa `output_schema` nativo en los agentes con google_search: verificado en vivo que
    con 3.6-flash `response_schema` + grounding deja `grounding_chunks` vacío (URLs no
    verificables). Aquí el JSON en texto se valida con pydantic; si no valida, la salida se
    conserva tal cual (para no perder información) pero queda anotada en `descartes` y se
    devuelve el evento `warn`. Si el schema aún no existe (WS M) → no-op."""
    if _schemas is None:
        return None
    schema = getattr(_schemas, schema_name, None)
    if schema is None:
        return None
    data = _parse_json_flexible(state.get(key))
    if data is None:
        _registrar_descarte(state, key, "salida_no_json")
        return {"kind": "warn", "name": key, "msg": f"{key}: salida no es JSON (schema {schema_name} no aplicable)"}
    try:
        validado = schema.model_validate(data)
        state[key] = validado.model_dump(exclude_none=True)
        return None
    except Exception as e:
        _registrar_descarte(state, key, "schema_invalido", str(e)[:400])
        return {"kind": "warn", "name": key,
                "msg": f"{key}: no cumple {schema_name} — {str(e)[:160]}"}


# Texto de cada validación pendiente para el dictamen (códigos de
# backend/core/clasificacion.VALIDACIONES; el orquestador no importa ese paquete).
_VALIDACION_TEXTO = {
    "infobras_avance": "Avance físico/financiero de la obra (INFOBRAS) no disponible: no se verificó la ejecución.",
    "market_sin_items_fisicos": "Sin ítems físicos con cantidad y unidad: no se comparó precio de mercado.",
    "sin_documentos_descargables": "Sin bases, buena pro ni contrato publicados: no se analizaron documentos.",
    "proveedor_sin_ruc": "El record no identifica al proveedor (RUC): no se investigó a la empresa ni su red.",
    "entidad_sin_ruc": "Sin RUC de la entidad: no se investigó a sus funcionarios.",
}


def _bloque_validaciones(state: dict) -> str:
    """Instrucción para el report_writer con las validaciones pendientes (vacío si no hay)."""
    vals = state.get("validaciones_pendientes")
    if not isinstance(vals, (list, tuple)) or not vals:
        return ""
    lineas = "\n".join(f"- {_VALIDACION_TEXTO.get(str(v), str(v))}" for v in vals)
    return ("\n\nVALIDACIONES PENDIENTES (datos que NO se pudieron verificar en esta corrida). Cerrá el "
            "dictamen con una sección '## Validaciones pendientes' que las liste TAL CUAL, sin inventar "
            "resultados ni conclusiones sobre ellas:\n" + lineas)


_MAX_LINEAS_RECORTES = 25


def _bloque_recortes(state: dict) -> str:
    """Instrucción para el report_writer con los recortes (topes aplicados) y descartes
    (hallazgos sin evidencia verificable) de la corrida. Vacío si no hubo ninguno. Si hay más
    de _MAX_LINEAS_RECORTES, se listan los primeros y el conteo del resto (recorte declarado)."""
    recortes = state.get("recortes") if isinstance(state.get("recortes"), list) else []
    descartes = state.get("descartes") if isinstance(state.get("descartes"), list) else []
    if not recortes and not descartes:
        return ""
    lineas: list[str] = []
    for r in recortes:
        if isinstance(r, dict):
            lineas.append(f"- recorte en {r.get('donde')}: límite {r.get('limite')}, omitido: "
                          f"{json.dumps(r.get('omitido'), ensure_ascii=False, default=str)[:200]}")
        else:
            lineas.append(f"- recorte: {str(r)[:200]}")
    for d in descartes:
        if isinstance(d, dict):
            lineas.append(f"- descarte en {d.get('donde')}: {d.get('motivo')} "
                          f"{json.dumps(d.get('detalle'), ensure_ascii=False, default=str)[:160] if d.get('detalle') else ''}")
        else:
            lineas.append(f"- descarte: {str(d)[:200]}")
    resto = len(lineas) - _MAX_LINEAS_RECORTES
    if resto > 0:
        lineas = lineas[:_MAX_LINEAS_RECORTES] + [f"- … y {resto} recortes/descartes más (ver analisis_full.recortes)"]
    return ("\n\nRECORTES Y DATOS NO VERIFICABLES de esta corrida (topes aplicados por el pipeline y "
            "hallazgos descartados por falta de evidencia). Incluí una sección '## Recortes y datos no "
            "verificables' que los liste TAL CUAL, sin inferir conclusiones a partir de lo omitido:\n"
            + "\n".join(lineas))

# Tarifas Gemini en Vertex (USD/1M tokens; lista pública consultada 2026-09-15 —
# [verificar] contra cloud.google.com/vertex-ai/generative-ai/pricing antes de facturar:
# 3.6-flash está en tarifa introductoria 0.75/3.75 hasta 2026-12-31, lista 1.50/7.50).
# El pipeline MEZCLA tiers; cobrar todo a una tarifa única distorsiona el costo que va al
# span de Arize → el costo se acumula POR LLAMADA con la tarifa del modelo del sub-agente.
# Los tokens de THINKING (`thoughts_token_count`) se cobran como salida (así los factura Vertex).
_MODEL_RATES = {
    "gemini-3.6-flash":      (0.75, 3.75),
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.5-flash":      (1.50, 9.00),
    "gemini-3-flash":        (0.50, 3.00),
    "gemini-2.5-pro":        (1.25, 10.00),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash":      (0.30, 2.50),
}
_DEFAULT_RATE = _MODEL_RATES["gemini-3.6-flash"]


def _rate_for_model(model) -> tuple[float, float]:
    """(in_rate, out_rate) USD/1M según el id del modelo (prefijo más largo que matchee;
    'lite' antes que su base). Robusto a None o a un objeto Model (se castea a str)."""
    m = str(model or "").lower()
    if "/" in m:
        m = m.rsplit("/", 1)[-1]
    for key in sorted(_MODEL_RATES, key=len, reverse=True):
        if m.startswith(key):
            return _MODEL_RATES[key]
    if "pro" in m:
        return _MODEL_RATES["gemini-2.5-pro"]
    if "lite" in m:
        return _MODEL_RATES["gemini-3.5-flash-lite"]
    return _DEFAULT_RATE


def _usage_tokens(um) -> tuple[int, int, int, int]:
    """(prompt, candidates, thoughts, total) desde usage_metadata; thoughts se suma a salida."""
    pt = int(getattr(um, "prompt_token_count", 0) or 0)
    ct = int(getattr(um, "candidates_token_count", 0) or 0)
    tt = int(getattr(um, "thoughts_token_count", 0) or 0)
    total = int(getattr(um, "total_token_count", 0) or (pt + ct + tt))
    return pt, ct, tt, total


def _is_empty_output(val) -> bool:
    """True si la salida de un sub-agente es 'vacía' (quirk Gemini+google_search:
    tokens al grounding, texto final ''). Una salida ESTRUCTURADA con al menos un
    campo con contenido (ej. sin_data_publica:true, noticias:[...]) NO es vacía —
    solo dispara el guardrail lo realmente hueco (''/{}/[] o dict todo-vacío)."""
    if val is None:
        return True
    if isinstance(val, str):
        return val.strip() in ("", "{}", "[]")
    if isinstance(val, dict):
        return not any(v not in (None, "", [], {}) for v in val.values())
    if isinstance(val, (list, tuple, set)):
        return len(val) == 0
    return not val


class _Shim:
    """ToolContext mínimo: las tools solo usan `.state`."""
    __slots__ = ("state",)

    def __init__(self, state: dict):
        self.state = state


def _truncate_result(res: Any) -> Any:
    if isinstance(res, dict):
        return {k: (v if not isinstance(v, str) or len(v) < 8000 else v[:8000] + "…")
                for k, v in res.items()}
    if isinstance(res, str) and len(res) > 8000:
        return res[:8000] + "…"
    return res


def _short_args(kwargs: dict) -> dict:
    out = {}
    for k, v in kwargs.items():
        if k == "tool_context":
            continue
        out[k] = v if (not isinstance(v, (dict, list)) or len(str(v)) < 200) else f"<{type(v).__name__} {len(v)}>"
    return out


# ── Guardrail del dictamen ──────────────────────────────────────────────────
# El report_writer (gemini-2.5-pro) ocasionalmente DEGENERA su salida final en
# contratos doc-pesados: pierde la cabecera (queda solo en el "thinking") y anexa
# boilerplate de README + tokens de control. Detectamos eso y reintentamos con
# contexto compacto; si persiste, sanitizamos (cortamos la basura).
_DICTAMEN_BOILERPLATE = (
    "## usage", "## contributing", "## license", "## installation",
    "## getting started", "import main", "some_function", "pip install",
    "this project is licensed", "contributions are welcome",
)
_DICTAMEN_CTRL = ("<ctrl", "<unused", "<pad>", "<extra_id")


def _dictamen_problems(text) -> list[str]:
    """Detecta una salida de dictamen malformada (degeneración del modelo)."""
    t = (text or "").strip()
    probs: list[str] = []
    low = t.lower()
    for m in _DICTAMEN_BOILERPLATE:
        if m in low:
            probs.append(f"boilerplate:{m}")
            break
    for m in _DICTAMEN_CTRL:
        if m in t:
            probs.append(f"ctrl_token:{m}")
            break
    # Cabecera: el dictamen debe empezar con un heading markdown (título) en las
    # primeras líneas. Si arranca a mitad de contenido → cabecera perdida.
    head_lines = [ln for ln in t.splitlines()[:4] if ln.strip()]
    if not head_lines or not head_lines[0].lstrip().startswith("#"):
        probs.append("no_head")
    if len(t) < 800:
        probs.append("too_short")
    return probs


def _sanitize_dictamen(text: str) -> str:
    """Último recurso: corta la cola de basura (boilerplate de README / tokens de
    control) que el modelo pudo anexar. NO inventa contenido — solo recorta."""
    t = text or ""
    low = t.lower()
    cut = len(t)
    for m in _DICTAMEN_BOILERPLATE:
        i = low.find(m)
        if i != -1:
            cut = min(cut, i)
    for m in _DICTAMEN_CTRL:
        i = t.find(m)
        if i != -1:
            cut = min(cut, i)
    t = t[:cut].rstrip()
    # Cerrar un code fence colgante que el recorte pudo dejar abierto.
    if t.count("```") % 2 == 1:
        t = t.rsplit("```", 1)[0].rstrip()
    return t


def _parse_event(event, metrics: dict, fallback_agent: str, model=None) -> tuple[list[dict], list[dict], str | None]:
    """Convierte un evento ADK en (trace_events, metric_events, final_text).
    Acumula tokens/costo en `metrics`. `model` = id del modelo del sub-agente que
    emitió el evento → permite cobrar cada llamada a su tarifa real (Pro vs Flash)."""
    agent_name = getattr(event, "author", None) or fallback_agent
    trace: list[dict] = []
    final_text: str | None = None
    try:
        parts = (event.content.parts if getattr(event, "content", None) else []) or []
        for p in parts:
            if getattr(p, "function_call", None):
                fc = p.function_call
                trace.append({"agent": agent_name, "kind": "tool_call", "name": fc.name,
                              "args": dict(fc.args) if fc.args else {}})
            elif getattr(p, "function_response", None):
                fr = p.function_response
                trace.append({"agent": agent_name, "kind": "tool_result", "name": fr.name,
                              "result_preview": _truncate_result(dict(fr.response) if fr.response else {})})
            elif getattr(p, "text", None):
                if event.is_final_response():
                    final_text = p.text
                else:
                    trace.append({"agent": agent_name, "kind": "thought", "text": p.text[:8000]})
    except Exception as e:
        trace.append({"agent": agent_name, "kind": "error", "detail": str(e)[:200]})

    # GROUNDING (Google Search): web/news/entity/person usan grounding INTERNO de
    # Gemini (no FunctionTools), así que no emiten function_call → antes el trace
    # solo mostraba TRANSFER + metrics, sin las búsquedas. Surfaceamos las queries
    # reales de grounding como un tool_call sintético para que se vea QUÉ buscaron.
    try:
        gm = getattr(event, "grounding_metadata", None)
        qs = list(getattr(gm, "web_search_queries", None) or []) if gm is not None else []
        if qs:
            trace.append({"agent": agent_name, "kind": "tool_call", "name": "google_search",
                          "args": {"queries": qs[:12]}})
            trace.append({"agent": agent_name, "kind": "tool_result", "name": "google_search",
                          "result_preview": {"n_queries": len(qs), "queries": qs[:12],
                                             "_note": "grounding en vivo (Gemini + Google Search)"}})
    except Exception:
        pass

    metric_events: list[dict] = []
    um = getattr(event, "usage_metadata", None)
    if um is not None:
        pt, ct, tt, total = _usage_tokens(um)
        if pt or ct or tt:
            in_r, out_r = _rate_for_model(model)
            metrics["prompt"] += pt
            metrics["output"] += ct + tt
            metrics["thoughts"] = int(metrics.get("thoughts") or 0) + tt
            metrics["total"] += total
            metrics["calls"] += 1
            # Costo = SUMA POR LLAMADA con la tarifa del modelo (no recálculo desde
            # totales con una tarifa única). Los tokens de thinking se cobran como salida.
            metrics["cost"] = round(float(metrics.get("cost") or 0.0)
                                    + pt / 1e6 * in_r + (ct + tt) / 1e6 * out_r, 6)
            metric_events.append({"kind": "metrics", "agent": agent_name,
                                  "tokens_total": metrics["total"], "tokens_prompt": metrics["prompt"],
                                  "tokens_output": metrics["output"], "n_llm_calls": metrics["calls"],
                                  "cost_usd": metrics["cost"]})
    return trace, metric_events, final_text


def _tool(fn, fname: str, state: dict, agent: str = "pipeline", **kwargs) -> tuple[list[dict], Any]:
    """Llama una tool con shim sobre `state`. Devuelve (eventos_trace, resultado).

    `agent` etiqueta los eventos del trace. Default "pipeline" (= Orquestador en la UI).
    Pasá el nombre de un sub-agente cuando la tool corre LÓGICAMENTE bajo él — p.ej. el
    análisis de mercado corre como tools (fan-out sharded, sin saturar) pero conceptualmente
    ES market_price_agent: así sus llamadas se atribuyen al nodo `market` del grafo y a
    "Market Price" en el stream de eventos, no al Orquestador. Ninguna tool usa un kwarg
    `agent`, así que no colisiona con `**kwargs`."""
    shim = _Shim(state)
    try:
        res = fn(tool_context=shim, **kwargs)
    except Exception as e:
        res = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
    evs = [
        {"agent": agent, "kind": "tool_call", "name": fname, "args": _short_args(kwargs)},
        {"agent": agent, "kind": "tool_result", "name": fname, "result_preview": _truncate_result(res)},
    ]
    return evs, res


async def _run_agent(agent, msg_text: str, state: dict, session_service, user_id: str,
                     metrics: dict) -> AsyncIterator[dict]:
    """Corre un sub-agente sobre una sesión fresca sembrada con `state`; yields los
    eventos del trace; al terminar mergea `session.state` → `state` y stashea el
    texto final del agente en `state['_last_agent_final']`."""
    name = getattr(agent, "name", "agent")
    sid = str(uuid.uuid4())
    try:
        await session_service.create_session(app_name=APP_NAME, user_id=user_id,
                                              session_id=sid, state=dict(state))
    except Exception as e:
        yield {"agent": name, "kind": "error", "detail": f"create_session: {str(e)[:160]}"}
        return
    sub_runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)
    msg = gtypes.Content(role="user", parts=[gtypes.Part.from_text(text=msg_text)])
    _model = getattr(agent, "model", None)
    final_text = None
    try:
        async for event in sub_runner.run_async(user_id=user_id, session_id=sid, new_message=msg):
            trace, metric_evs, ft = _parse_event(event, metrics, name, model=_model)
            if ft:
                final_text = ft
            for me in metric_evs:
                yield me
            for te in trace:
                yield te
    except Exception as e:
        yield {"agent": name, "kind": "error", "detail": f"run: {str(e)[:200]}"}
    # Merge del state de vuelta (output_key + escrituras de tools del sub-agente).
    # Si el merge falla, el output_key de este agente se PIERDE silenciosamente
    # (reintroduce el bug de "sección vacía" que el pipeline vino a matar) → warn.
    try:
        sess = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
        if sess and sess.state:
            for k, v in dict(sess.state).items():
                state[k] = v
        else:
            yield {"agent": name, "kind": "warn",
                   "detail": "merge: sesión del sub-agente vacía — su output_key pudo perderse"}
    except Exception as e:
        yield {"agent": name, "kind": "warn",
               "detail": f"merge del state falló: {str(e)[:160]} — output del sub-agente pudo perderse"}
    state["_last_agent_final"] = final_text


def _merge_metrics(dst: dict, src: dict) -> None:
    """Suma las métricas de un sub-run aislado al acumulador global (in-place)."""
    for k in ("prompt", "output", "total", "calls", "thoughts"):
        dst[k] = (dst.get(k) or 0) + (src.get(k) or 0)
    dst["cost"] = round(float(dst.get("cost") or 0.0) + float(src.get("cost") or 0.0), 6)


def _metrics_event(metrics: dict, agent_name: str) -> dict:
    """Evento `metrics` con los totales corrientes del acumulador global."""
    return {"kind": "metrics", "agent": agent_name,
            "tokens_total": metrics.get("total", 0), "tokens_prompt": metrics.get("prompt", 0),
            "tokens_output": metrics.get("output", 0), "n_llm_calls": metrics.get("calls", 0),
            "cost_usd": metrics.get("cost", 0.0)}


async def _run_agent_isolated(agent, msg_text: str, base_state: dict, output_key: str,
                              session_service, user_id: str
                              ) -> tuple[list[dict], str | None, dict, dict]:
    """Variante AISLADA de `_run_agent` para correr sub-agentes CONCURRENTEMENTE.

    A diferencia de `_run_agent`, NO muta el `state` compartido ni el `metrics` global
    (lo haría con races bajo `asyncio.gather`). En su lugar:
      · siembra una sesión fresca con `dict(base_state)` (snapshot read-only),
      · COLECTA los eventos del trace en una lista (no los yieldea),
      · acumula tokens/costo en un `metrics` LOCAL,
      · extrae SOLO `output_key` del state final del sub-agente (web/news/entity son
        grounding-only → escriben únicamente su output_key; no hay otras escrituras).
    Devuelve (eventos, final_text, delta={output_key: valor}, metrics_local). El caller
    mergea `delta` al state y SUMA `metrics_local` al global tras el join."""
    name = getattr(agent, "name", "agent")
    sid = str(uuid.uuid4())
    local_metrics = {"prompt": 0, "output": 0, "total": 0, "calls": 0, "cost": 0.0}
    evs_out: list[dict] = []
    try:
        await session_service.create_session(app_name=APP_NAME, user_id=user_id,
                                              session_id=sid, state=dict(base_state))
    except Exception as e:
        evs_out.append({"agent": name, "kind": "error", "detail": f"create_session: {str(e)[:160]}"})
        return evs_out, None, {}, local_metrics
    sub_runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)
    msg = gtypes.Content(role="user", parts=[gtypes.Part.from_text(text=msg_text)])
    _model = getattr(agent, "model", None)
    final_text = None
    try:
        async for event in sub_runner.run_async(user_id=user_id, session_id=sid, new_message=msg):
            trace, _metric_evs, ft = _parse_event(event, local_metrics, name, model=_model)
            if ft:
                final_text = ft
            # Descartamos los metric_evs locales (totales por-agente); el caller re-emite
            # UN evento `metrics` con el total GLOBAL tras sumar este sub-run → contador monótono.
            evs_out.extend(trace)
    except Exception as e:
        evs_out.append({"agent": name, "kind": "error", "detail": f"run: {str(e)[:200]}"})
    delta: dict = {}
    try:
        sess = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
        if sess and sess.state and output_key in sess.state:
            delta[output_key] = sess.state[output_key]
        else:
            evs_out.append({"agent": name, "kind": "warn",
                            "detail": f"merge: output_key '{output_key}' ausente en el sub-agente — sección pudo perderse"})
    except Exception as e:
        evs_out.append({"agent": name, "kind": "warn",
                        "detail": f"merge del state aislado falló: {str(e)[:160]}"})
    return evs_out, final_text, delta, local_metrics


def _backfill_document_analysis(state: dict) -> str:
    """Backfill DETERMINISTA de `document_analysis` desde `parser_raw_consolidated`.

    `parse_document_pdf` (tool) extrae los ítems REALES y los stashea en
    `state['parser_raw_consolidated']`; al agente le devuelve solo un RESUMEN compacto
    (conteos), por lo que el LLM document_parser A VECES escribe `items_consolidados`
    GENÉRICO ("Item N del proceso de selección") o vacío aunque OCR'eó los reales (bug
    intermitente verificado: 1212446 → 1 genérico; 1211719 → vacío; pero 1202511 → 35
    reales en la MISMA revisión). Acá, en CÓDIGO, preferimos la extracción autoritativa
    de la tool sobre el placeholder del LLM, de modo que legal/market/compliance reciban
    los ítems reales (el rescate equivalente en persist no alcanzaba porque depende de que
    `parser_raw_consolidated` siga en state al final). Idempotente; no-op si la tool no
    extrajo nada o si el agente ya trae ítems reales. Devuelve un log de conteos."""
    raw = state.get("parser_raw_consolidated")
    raw = raw if isinstance(raw, dict) else {}
    da = state.get("document_analysis")
    if isinstance(da, str):
        try:
            da = json.loads(da)
        except Exception:
            da = {}
    da = da if isinstance(da, dict) else {}
    raw_items = raw.get("items_consolidados") or []
    da_items = da.get("items_consolidados") or []
    msg = f"raw={len(raw_items)} da={len(da_items)}"
    # La tool (parse_document_pdf) es la AUTORIDAD de extracción estructurada: al AGENTE
    # se le devuelve solo un RESUMEN con conteos (NO los ítems), así que su
    # document_analysis a veces es PLACEHOLDER del schema ("Descripción corta del Ítem N
    # extraída de las Bases", "POSTOR DE BASES 1", "NOMBRE FIRMANTE BASES"). Por eso, si la
    # tool extrajo algo, GANA SIEMPRE (incondicional — antes se gateaba con n_raw>n_da y
    # los placeholders, contados como "reales", empataban y ganaban). Se conserva el
    # `resumen_ejecutivo`/`modalidad`/etc. narrativos del agente.
    if raw_items:
        da["items_consolidados"] = raw_items
        for k in ("firmantes_consolidados", "firmantes", "postores_consolidados",
                  "postores_extraidos", "comite_evaluacion", "motivos_adjudicacion",
                  "lugar_fecha_acta", "cuantia_total"):
            if raw.get(k) not in (None, "", [], {}):
                da[k] = raw[k]
        state["document_analysis"] = da
        msg += f" → estructura desde la TOOL (items={len(raw_items)}, autoritativa sobre el LLM)"
    return msg


def _norm_codigo(ocid: str) -> str:
    """Código de alerta canónico 'OECE-<sufijo>'. Vía _short_ocid soporta los dos
    esquemas: flat ('OECE-1221284') y año-secuencia ('OECE-2026-10404-12'). Antes
    hacía split('-')[-1] → 'OECE-12' (la versión) para los OCID año-secuencia (roto)."""
    c = (ocid or "").strip()
    if not c:
        return c
    if c.startswith("OECE-"):
        return c
    return "OECE-" + T._short_ocid(c)


# ── DAG paralelo ─────────────────────────────────────────────────────────────
# PIPELINE_DAG=1 (default): las fases que no dependen entre sí corren a la vez:
#
#     ocds → registro ─┬─ compliance (agente)
#                      ├─ document_parser (tools, hilo) → [legal (agente) ∥ market (tools, hilo)]
#                      └─ proveedor (tools, hilo)       → [web ∥ prensa ∥ funcionarios] (agentes)
#                      ▼ join
#              person_network → compliance_extended → RAG normativo → persist → dictamen
#
# Dependencias reales (verificadas leyendo qué claves del state usa cada mensaje/agente):
#   · compliance: reglas SQL sobre el OCID + crea la alerta → no lee salida de otro agente.
#   · document_parser: `ocds`/`doc_urls`. legal: `parser_raw_consolidated`/`document_analysis`
#     (read_document_analysis). market: ítems del parser (`document_analysis`, `estudio_mercado`).
#   · proveedor (get_ganador/oece/sunat): `ocds`. web/news/entity: RUC/razón/entidad del
#     proveedor (`sunat_decolecta` inyectado a web_research) → tras proveedor.
#   · person_network: firmantes/comité del parser + RNP del ganador + funcionarios de entity
#     + web_research → tras el join. compliance_extended: sunat + web + person_network.
#   · report_writer: todo (get_dictamen_context). self_eval (main.py): dictamen.
#
# Claves del state que escribe cada rama (DISTINTAS entre ramas; los acumuladores de lista
# se mergean por append-dedupe en `_aplicar_delta`, nunca por overwrite):
#   compliance : compliance_result, alerta_codigo, banderas, score, estado_real,
#                analisis_postores, causal_directa_invocada, acto_resolutivo_directa,
#                pending_flags(+), descartes(+)
#   parser     : parser_raw_consolidated, documentos_texto, document_analysis, estudio_mercado,
#                contrato_final, _parse_deadline, _parsed_doc_cache, recortes(+)
#   legal      : legal_analysis, pending_doc_flags, descartes(+)
#   market     : market_analysis, market_input, market_findings, market_queries,
#                market_grounding, grounding_urls(+), pending_market_flags, recortes(+),
#                descartes(+), validaciones_pendientes(+)
#   proveedor  : oece_perfiles, sunat_profiles, sunat_decolecta, pending_flags(+),
#                web_research, news_research, entity_personnel, batch_person_lookup_result,
#                descartes(+)
# Las tools SÍNCRONAS de una rama corren en un hilo (`asyncio.to_thread`) para que la rama
# async (agentes ADK) avance a la vez; `metrics` y `events_trace` se actualizan SOLO desde el
# event loop (el driver consume los eventos de cada rama por una cola). PIPELINE_DAG=0 →
# secuencia histórica (mismas fases, mismos eventos, sin concurrencia).
_PIPELINE_DAG = os.getenv("PIPELINE_DAG", "1") != "0"

# Acumuladores de lista compartidos: al aplicar el delta de un sub-agente aislado se AÑADEN
# los elementos nuevos (dedupe por JSON) en vez de pisar la lista (otra rama pudo agregar).
_ACUMULADORES = ("pending_flags", "recortes", "descartes", "grounding_urls", "validaciones_pendientes")
_SOLO_DRIVER = ("banderas", "score", "alerta_codigo")


def _json_key(x) -> str:
    try:
        return json.dumps(x, sort_keys=True, default=str, ensure_ascii=False)
    except Exception:
        return repr(x)


def _aplicar_delta(state: dict, delta: dict) -> None:
    """Mergea el delta de un sub-agente al state compartido: claves normales → overwrite;
    acumuladores (`_ACUMULADORES`) → append de los elementos que aún no están."""
    for k, v in (delta or {}).items():
        if k in _SOLO_DRIVER:
            continue  # las escribe persistence desde el driver (score/banderas): un snapshot viejo las pisaría
        if k in _ACUMULADORES and isinstance(v, list):
            cur = state.get(k)
            if not isinstance(cur, list):
                state[k] = list(v)
                continue
            vistos = {_json_key(x) for x in cur}
            for x in v:
                kx = _json_key(x)
                if kx not in vistos:
                    cur.append(x)
                    vistos.add(kx)
        else:
            state[k] = v


async def _run_agent_delta(agent, msg_text: str, base_state: dict, session_service, user_id: str,
                           output_key: str | None = None
                           ) -> tuple[list[dict], str | None, dict, dict]:
    """Corre un sub-agente en una sesión fresca sembrada con `dict(base_state)` SIN mutar el
    state ni el `metrics` global (apto para correr concurrente). Devuelve
    (eventos, final_text, delta, metrics_local) donde `delta` son SOLO las claves que el
    sub-agente escribió (output_key + `state_delta` de sus eventos: escrituras de sus tools).
    A diferencia de `_run_agent`, no pisa el resto del state con la copia (stale) de la sesión."""
    name = getattr(agent, "name", "agent")
    sid = str(uuid.uuid4())
    local_metrics = {"prompt": 0, "output": 0, "total": 0, "calls": 0, "cost": 0.0, "thoughts": 0}
    evs_out: list[dict] = []
    seed = dict(base_state)   # snapshot: qué había al sembrar (para descartar escrituras no-op)
    try:
        await session_service.create_session(app_name=APP_NAME, user_id=user_id,
                                              session_id=sid, state=dict(seed))
    except Exception as e:
        evs_out.append({"agent": name, "kind": "error", "detail": f"create_session: {str(e)[:160]}"})
        return evs_out, None, {}, local_metrics
    sub_runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)
    msg = gtypes.Content(role="user", parts=[gtypes.Part.from_text(text=msg_text)])
    _model = getattr(agent, "model", None)
    final_text = None
    try:
        async for event in sub_runner.run_async(user_id=user_id, session_id=sid, new_message=msg):
            trace, _metric_evs, ft = _parse_event(event, local_metrics, name, model=_model)
            if ft:
                final_text = ft
            evs_out.extend(trace)
    except Exception as e:
        evs_out.append({"agent": name, "kind": "error", "detail": f"run: {str(e)[:200]}"})
    delta: dict = {}
    try:
        sess = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
        if sess is not None:
            keys: set = set()
            for ev in (getattr(sess, "events", None) or []):
                acts = getattr(ev, "actions", None)
                sd = getattr(acts, "state_delta", None) if acts is not None else None
                if isinstance(sd, dict):
                    keys.update(k for k in sd.keys() if not str(k).startswith("temp:"))
            if output_key:
                keys.add(output_key)
            st = dict(sess.state or {})
            for k in keys:
                if k not in st:
                    continue
                v = st[k]
                # No-ops del callback init_state (`setdefault(<acumulador>, [])`): una lista
                # vacía en una clave que no existía no es una escritura del agente. Tampoco
                # lo es devolver el mismo valor con el que se sembró.
                if k != output_key:
                    if k not in seed and v in ([], {}, None):
                        continue
                    if k in seed and seed[k] == v:
                        continue
                delta[k] = v
            if output_key and output_key not in delta:
                evs_out.append({"agent": name, "kind": "warn",
                                "detail": f"merge: output_key '{output_key}' ausente en el sub-agente — sección pudo perderse"})
        else:
            evs_out.append({"agent": name, "kind": "warn",
                            "detail": "merge: sesión del sub-agente ausente — su output_key pudo perderse"})
    except Exception as e:
        evs_out.append({"agent": name, "kind": "warn",
                        "detail": f"merge del state (delta) falló: {str(e)[:160]} — output del sub-agente pudo perderse"})
    return evs_out, final_text, delta, local_metrics


def _va_al_trace(ev: dict) -> bool:
    """Qué eventos del driver se guardan en `events_trace` (agent_trace persistido): todo
    salvo los `phase` de progreso (los `phase` "omitido: …" sí, el tablero los muestra)."""
    if ev.get("kind") != "phase":
        return True
    return str(ev.get("msg") or "").startswith("omitido")


async def run_deterministic(input_str: str, runner, user_id: str, session_id: str,
                            state: dict, events_trace: list[dict], metrics: dict) -> AsyncIterator[dict]:
    """Ejecuta el pipeline COMPLETO (DAG paralelo con PIPELINE_DAG=1, secuencia fija con 0).
    Yields cada evento (ya appended a events_trace cuando corresponde). Muta `state`
    (fuente de verdad para el tail de main.py). `metrics` y `events_trace` se tocan SOLO
    acá (event loop), nunca desde las ramas ni desde hilos."""
    async for e in _pipeline(input_str, runner, user_id, state, metrics):
        if e.get("kind") == "_metrics_delta":
            # Sub-run aislado terminado: sumar sus tokens/costo al global y emitir UN evento
            # `metrics` con el total (contador monótono para el tablero).
            _merge_metrics(metrics, e.get("metrics") or {})
            e = _metrics_event(metrics, e.get("agent") or "agent")
        if _va_al_trace(e):
            events_trace.append(e)
        yield e


async def _pipeline(input_str: str, runner, user_id: str, state: dict, metrics: dict) -> AsyncIterator[dict]:
    ss = runner.session_service
    dag = _PIPELINE_DAG
    ocid = (state.get("ocid") or input_str or "").strip()

    _clas = state.get("clasificacion") if isinstance(state.get("clasificacion"), dict) else {}
    _tipo_etapa = f"{_clas.get('tipo') or '?'}/{_clas.get('etapa') or '?'}"

    # ── Perfil del servicio (PIPELINE_PROFILE): agentes, estrategia de mercado, reglas,
    # topes, prioridad de documentos, secciones del dictamen. Va al state para que las
    # tools de los otros WS lo lean vía tool_context.state["perfil"].
    profile = get_profile()
    state["perfil"] = profile.as_state()
    # WS V lee estas dos claves directamente (compliance_rules._perfil_reglas/_perfil_topes).
    state["reglas_activas"] = sorted(profile.reglas_activas)
    state["topes_uit"] = dict(profile.topes_uit)
    state.setdefault("recortes", [])    # [{donde, limite, omitido}] — ningún tope silencioso
    state.setdefault("descartes", [])   # [{donde, motivo, detalle}] — nada sin evidencia se persiste
    _agentes_activos = [a for a in profile.agentes if permitido(state, a, profile)]
    yield {"kind": "phase", "name": "perfil",
           "msg": f"{profile.nombre} · mercado={profile.market_estrategia} · "
                  f"agentes: {', '.join(_agentes_activos) or 'ninguno'}"}

    def _perm(nombre: str) -> bool:
        return permitido(state, nombre, profile)

    def _omitido(nombre: str) -> dict:
        """Evento `phase` del agente saltado por la matriz tipo × etapa o por el perfil
        (el tablero lo muestra)."""
        motivo = (f"no aplica al perfil {profile.nombre}" if nombre not in profile.agentes
                  else f"no aplica a {_tipo_etapa}")
        return {"kind": "phase", "name": nombre, "msg": f"omitido: {motivo}"}

    def _validar(key: str, schema_name: str):
        """Validación pydantic (WS M) de la salida de un sub-agente; devuelve evento o None."""
        return _validar_schema(state, key, schema_name)

    async def _sync(fn, *a, **kw):
        """Función SÍNCRONA (tool/lote): en modo DAG corre en un hilo para no bloquear el
        event loop (la otra rama —agentes ADK— avanza a la vez); en secuencial, inline."""
        if dag:
            return await asyncio.to_thread(fn, *a, **kw)
        return fn(*a, **kw)

    async def _t(fn, fname: str, agent: str = "pipeline", **kwargs) -> tuple[list[dict], Any]:
        """`_tool` (shim sobre `state`) — en un hilo si DAG."""
        if dag:
            return await asyncio.to_thread(_tool, fn, fname, state, agent, **kwargs)
        return _tool(fn, fname, state, agent, **kwargs)

    async def _agent(agent, msg, output_key: str | None = None):
        # Evento `transfer` (orquestador → sub-agente): es lo que el grafo del
        # frontend usa para iluminar el nodo del agente (buildTrace → ev.to). En
        # el flujo determinista el "orquestador" es el código; sin este transfer,
        # los agentes que solo usan grounding (web/news/entity/person) no emiten
        # tool_calls y el grafo nunca los encendería.
        nm = getattr(agent, "name", "agent")
        yield {"kind": "transfer", "from": "orch", "to": nm, "agent": "orch",
               "msg": f"orquestador delega a {nm}"}
        if not dag:
            async for e in _run_agent(agent, msg, state, ss, user_id, metrics):
                yield e
            return
        # DAG: sesión aislada + merge SOLO de lo que el agente escribió (otra rama pudo
        # escribir otras claves mientras tanto) + métricas sumadas en el event loop.
        evs_a, ft, delta_a, lm_a = await _run_agent_delta(agent, msg, state, ss, user_id, output_key)
        _aplicar_delta(state, delta_a)
        state["_last_agent_final"] = ft
        for e in evs_a:
            yield e
        yield {"kind": "_metrics_delta", "agent": nm, "metrics": lm_a}

    def _flags_from_senales(senales, fuente):
        """Loop add_contextual_flag por cada señal devuelta por query_oece_perfil."""
        out = []
        for s in (senales or []):
            if not isinstance(s, dict):
                continue
            evs, _ = _tool(T.add_contextual_flag, "add_contextual_flag", state,
                           regla=s.get("regla") or "senal_oece", severidad=s.get("severidad") or "media",
                           evidencia=s.get("evidencia") or "", norma=s.get("norma") or "", fuente=fuente)
            out.extend(evs)
        return out

    async def _retry_if_empty(agent, msg, state_key, default_stub):
        """Tail del guardrail (sin la primera corrida): si `state_key` quedó VACÍO,
        reintenta 1× con instrucción explícita; si sigue vacío, deja un default tipado."""
        if _is_empty_output(state.get(state_key)):
            yield {"kind": "warn", "name": state_key, "msg": f"{state_key} vacío — reintento"}
            state.pop(state_key, None)
            state.pop("_last_agent_final", None)
            async for e in _agent(agent, msg + " (REINTENTO: la pasada anterior salió VACÍA. "
                                  "Devolvé SIEMPRE el JSON COMPLETO del schema pedido; si no hay "
                                  "datos, devolvé las listas vacías + un campo que lo indique. "
                                  "NUNCA respondas vacío.)", state_key):
                yield e
            if _is_empty_output(state.get(state_key)):
                state[state_key] = default_stub
                yield {"kind": "warn", "name": state_key,
                       "msg": f"{state_key} vacío tras reintento — default tipado"}

    async def _agent_with_retry(agent, msg, state_key, default_stub):
        """Corre un sub-agente y, si su `state_key` quedó VACÍO (quirk de grounding),
        reintenta 1× con instrucción explícita; si sigue vacío, deja un default
        tipado (degradación honesta) para no dejar la sección en blanco sin aviso."""
        async for e in _agent(agent, msg, state_key):
            yield e
        async for e in _retry_if_empty(agent, msg, state_key, default_stub):
            yield e

    def _news_vacio():
        """True si news_research quedó vacío (quirk Gemini+google_search: tokens al
        grounding/thinking, texto final '')."""
        nr = state.get("news_research")
        if isinstance(nr, str):
            return nr.strip() in ("", "{}", "[]")
        if isinstance(nr, dict):
            if nr.get("noticias"):
                return False
            if nr.get("sin_menciones_relevantes") is True:
                return False
            if (nr.get("sintesis") or "").strip():
                return False
            return True
        return not nr

    # ── 1. OCDS + registro ──
    yield {"kind": "phase", "name": "ocds", "msg": f"obteniendo OCDS de {ocid}"}
    evs, _ = await _t(T.fetch_ocds_record, "fetch_ocds_record", ocid=ocid)
    for e in evs:
        yield e
    ocid = (state.get("ocid") or ocid).strip()  # normalizado por la tool
    alerta_codigo = _norm_codigo(ocid)
    state["alerta_codigo"] = alerta_codigo   # verify/persist lo usan como fallback para leer banderas de la BD

    # ABORT honesto: si no se obtuvo el OCDS (relay VPS / WAF caído), los ~12 pasos
    # siguientes correrían sobre datos VACÍOS y producirían un análisis basura que
    # igual se persistiría y dictaminaría. Mejor abortar y dejar constancia clara.
    _ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    _ocds_ok = isinstance(_ocds, dict) and (_ocds.get("tender") or _ocds.get("awards") or _ocds.get("ocid"))
    if not _ocds_ok:
        yield {"kind": "warn", "name": "ocds",
               "msg": "OCDS no disponible (fuente OECE inaccesible) — abortando análisis"}
        state["final_dictamen"] = (
            f"## Análisis no disponible — {alerta_codigo}\n\n"
            f"No se pudo obtener el registro OCDS del proceso `{ocid}` desde la fuente oficial "
            f"(OECE Contrataciones Abiertas inaccesible en este momento). El análisis NO puede "
            f"continuar sin los datos base del proceso y se aborta para no emitir conclusiones "
            f"sobre información vacía. Reintentar cuando la fuente esté disponible.")
        state["_final_response"] = "OCDS no disponible — análisis abortado."
        state["_aborted"] = "ocds_unavailable"
        evs, _ = await _t(T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=alerta_codigo)
        for e in evs:
            yield e
        return

    evs, _ = await _t(T.register_convocatoria_in_db, "register_convocatoria_in_db", ocid=ocid)
    for e in evs:
        yield e

    if state.get("agentes_permitidos"):
        yield {"kind": "phase", "name": "clasificacion",
               "msg": f"matriz tipo × etapa {_tipo_etapa}: agentes {', '.join(state['agentes_permitidos'])}"}

    # Contexto del proveedor (lo llena _fase_proveedor; lo leen research y person_network).
    ctx: dict = {"ganador": {}, "ruc": "", "razon": "", "entidad": {}, "postores": []}

    # ── 2. Compliance (reglas duras + crea alerta) ──
    async def _fase_compliance():
        # Siempre está en la matriz (crea la alerta que persiste todo lo demás); igual se respeta la lista.
        if _perm("compliance"):
            yield {"kind": "phase", "name": "compliance", "msg": "evaluando reglas duras"}
            async for e in _agent(A.compliance_agent,
                                  f"Evalúa la convocatoria OCID {ocid} contra las 3 reglas duras y crea la alerta.",
                                  "compliance_result"):
                yield e
        else:
            yield _omitido("compliance")

    # ── 3. Document parser ──
    async def _fase_parser():
        if not _perm("document_parser"):
            yield _omitido("document_parser")
            return
        yield {"kind": "phase", "name": "document_parser", "msg": "procesando documentos SEACE"}
        _lote_ok = False
        if _seleccionar_documentos is not None and _parse_documentos_lote is not None:
            # WS D · selección DETERMINISTA por prioridad del perfil (sin LLM) + OCR una sola
            # vez (documentos_texto por sha256, páginas con marcador) + extracción con el
            # schema base + bloque del perfil. Los omitidos por tope quedan en `recortes`.
            yield {"kind": "transfer", "from": "orch", "to": "document_parser_agent", "agent": "orch",
                   "msg": "orquestador delega a document_parser_agent (lote determinista)"}
            try:
                _doc_ids = state.get("doc_ids")
                _doc_ids = [str(d) for d in _doc_ids] if isinstance(_doc_ids, (list, tuple)) and _doc_ids else None
                elegidos, omitidos = await _sync(
                    _seleccionar_documentos,
                    ocid, state.get("ocds") or {}, state.get("doc_urls") or {},
                    profile.doc_prioridad, profile.parse_max_docs,
                    **_kwargs_soportados(_seleccionar_documentos, doc_ids=_doc_ids))
                if _doc_ids and "doc_ids" not in _kwargs_soportados(_seleccionar_documentos, doc_ids=_doc_ids):
                    _ids = set(_doc_ids)
                    _antes = len(elegidos)
                    elegidos = [d for d in elegidos if str((d or {}).get("id")) in _ids]
                    if len(elegidos) < _antes:
                        _registrar_recorte(state, "doc_select.doc_ids", len(_ids), _antes - len(elegidos))
                if _recorte_seleccion is not None:
                    _rec = _recorte_seleccion(elegidos, omitidos or [], profile.parse_max_docs)
                    if _rec:
                        state.setdefault("recortes", []).append(_rec)
                else:
                    for om in (omitidos or []):
                        _registrar_recorte(state, "doc_select", profile.parse_max_docs, om)
                yield {"agent": "document_parser_agent", "kind": "tool_call", "name": "seleccionar_documentos",
                       "args": {"prioridad": list(profile.doc_prioridad), "max_docs": profile.parse_max_docs}}
                yield {"agent": "document_parser_agent", "kind": "tool_result", "name": "seleccionar_documentos",
                       "result_preview": {"elegidos": [{k: (d or {}).get(k) for k in ("id", "tipo", "titulo", "formato")}
                                                       for d in elegidos],
                                          "n_omitidos": len(omitidos or [])}}
                if elegidos:
                    yield {"agent": "document_parser_agent", "kind": "tool_call", "name": "parse_documentos_lote",
                           "args": {"n_docs": len(elegidos), "bloque": profile.parser_bloque}}
                    res = await _sync(
                        _parse_documentos_lote, state, elegidos,
                        **_kwargs_soportados(_parse_documentos_lote, parser_bloque=profile.parser_bloque,
                                             prioridad=profile.doc_prioridad))
                    yield {"agent": "document_parser_agent", "kind": "tool_result",
                           "name": "parse_documentos_lote", "result_preview": _truncate_result(res)}
                    _raw = state.get("parser_raw_consolidated") or {}
                    _lote_ok = isinstance(_raw, dict) and bool(
                        _raw.get("items_consolidados") or _raw.get("bloque_servicio") or _raw.get("bloque_obra")
                        or _raw.get("bloque_sustento_directa") or _raw.get("requerimiento_tecnico_detallado")
                        or _raw.get("firmantes_consolidados") or state.get("documentos_texto"))
                else:
                    yield {"kind": "warn", "name": "document_parser",
                           "msg": "sin documentos seleccionables para el lote — se intenta el flujo del agente"}
            except Exception as e:
                yield {"kind": "warn", "name": "document_parser",
                       "msg": f"lote de documentos falló ({str(e)[:160]}) — fallback al agente"}
        if _lote_ok:
            # WS D: parse_documentos_lote ya escribió parser_raw_consolidated, documentos_texto,
            # document_analysis, estudio_mercado y contrato_final → la fase termina acá, sin LLM.
            _n_docs = len(state.get("documentos_texto") or {}) if isinstance(state.get("documentos_texto"), dict) else 0
            _n_items = len((state.get("parser_raw_consolidated") or {}).get("items_consolidados") or [])
            yield {"kind": "info", "name": "document_parser",
                   "msg": f"lote determinista: {_n_docs} documento(s) con texto, {_n_items} ítem(s); sin agente LLM"}
        else:
            # Fallback (lote vacío o WS D ausente): el agente LLM llama parse_documentos_seleccionados
            # (una sola vez) o, en la versión legacy, list_documents + parse_document_pdf.
            async for e in _agent(A.document_parser_agent,
                                  f"Procesa los documentos publicados en SEACE para el OCID {ocid}. PRIORIZA Bases "
                                  f"Administrativas/Integradas, Resumen Ejecutivo y Archivos del contrato; extrae el "
                                  f"REQUERIMIENTO técnico por ítem. OBLIGATORIO: llamá la tool de parseo al menos una vez.",
                                  "document_analysis"):
                yield e

        # ── 3.5 Backfill determinista de ítems: la extracción AUTORITATIVA de la tool
        # (parser_raw_consolidated) gana sobre el placeholder genérico que el LLM a veces
        # escribe. Va ANTES de legal/market para que toda la cadena reciba los ítems reales.
        _bf = _backfill_document_analysis(state)
        print(f"[driver] document_analysis backfill · {_bf}", flush=True)
        if "BACKFILL" in _bf:
            yield {"kind": "warn", "name": "document_parser",
                   "msg": f"ítems reales recuperados de la extracción del parser ({_bf})"}

        # ── 3.6 Sanitización por LLM (capa 2): lista canónica única de productos
        # Sobre los items crudos acumulados cross-doc, el LLM decide (no genera): normaliza
        # `numero`, funde variantes del mismo bien físico por OCR ruidoso, descarta la cabecera
        # del contrato colándose. El merge de campos lo hace el código sobre los crudos. Fail-safe:
        # si el LLM falla o devuelve cobertura inválida, conserva los crudos (no rompe nada).
        raw = state.get("parser_raw_consolidated") or {}
        raw_items = raw.get("items_consolidados") or []
        if len(raw_items) >= 2:
            _tender_obj = (state.get("ocds") or {}).get("tender") or {}
            _objeto_contrato = (_tender_obj.get("description") or _tender_obj.get("title") or "").strip()
            _antes_san = len(raw_items)
            _sanitized = await _sync(T.sanitize_items_with_llm, raw_items, _objeto_contrato)
            if _sanitized and len(_sanitized) < _antes_san:
                print(f"[driver] sanitize: {_antes_san}→{len(_sanitized)} ítems (canónico único)", flush=True)
                raw["items_consolidados"] = _sanitized
                state["parser_raw_consolidated"] = raw
                # Propagar al document_analysis del agente (que es lo que renderiza el front).
                _da = state.get("document_analysis")
                if isinstance(_da, dict):
                    _da["items_consolidados"] = _sanitized
                    state["document_analysis"] = _da
                yield {"kind": "warn", "name": "document_parser",
                       "msg": f"ítems canónicos tras sanitización por LLM: {len(_sanitized)} (de {_antes_san} crudos)"}
            else:
                print(f"[driver] sanitize: {_antes_san} ítems (sin cambios por LLM)", flush=True)

    # ── 4. Análisis legal + persistir banderas documentales ──
    async def _fase_legal():
        if not _perm("document_legal_analyst"):
            yield _omitido("document_legal_analyst")
            return
        yield {"kind": "phase", "name": "legal", "msg": "análisis legal del requerimiento"}
        async for e in _agent(A.document_legal_analyst_agent,
                              f"Analiza legalmente el documento extraído para el OCID {ocid} (perfil "
                              f"{profile.nombre}: vectores '{profile.legal_vectores}'). Llamá "
                              f"read_document_analysis() para obtener el JSON real del parser antes de emitir banderas.",
                              "legal_analysis"):
            yield e
        _vev = _validar("legal_analysis", "LegalOutput")
        if _vev:
            yield _vev
        evs, _ = await _t(T.persist_doc_flags_as_banderas, "persist_doc_flags_as_banderas", alerta_codigo=alerta_codigo)
        for e in evs:
            yield e

    # ── 5. Mercado (estrategia según perfil: goods_retail | historico_seace |
    #      presupuesto_obra | cotizaciones) ──
    async def _fase_market():
        if not _perm("market"):
            yield _omitido("market")
            return
        yield {"kind": "phase", "name": "market",
               "msg": f"validando precios de mercado ({profile.market_estrategia})"}
        # El análisis de mercado corre como tools (no sub-agente), pero igual debe
        # iluminar el nodo "market" del grafo → transfer explícito orquestador→market.
        yield {"kind": "transfer", "from": "orch", "to": "market_price_agent", "agent": "orch",
               "msg": "orquestador delega a market_price_agent"}
        _mercado_ok = False
        if _analizar_mercado is not None:
            # WS M · una sola entrada por estrategia; URLs solo desde grounding_metadata;
            # mediana/Δ%/veredicto en código; `sin_dato` cuando no hay base de comparación.
            yield {"agent": "market_price_agent", "kind": "tool_call", "name": "analizar_mercado",
                   "args": {"estrategia": profile.market_estrategia}}
            try:
                res = await _sync(_analizar_mercado, state, profile.market_estrategia)
                _mercado_ok = True
            except Exception as e:
                res = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
            yield {"agent": "market_price_agent", "kind": "tool_result",
                   "name": "analizar_mercado", "result_preview": _truncate_result(res)}
            if not _mercado_ok:
                yield {"kind": "warn", "name": "market",
                       "msg": f"analizar_mercado({profile.market_estrategia}) falló — fallback al fan-out retail"}
        if not _mercado_ok:
            # Flujo vigente (goods_retail): build_market_input + fan-out sharded con google_search.
            evs, _ = await _t(T.build_market_input, "build_market_input", agent="market_price_agent", ocid=ocid)
            for e in evs:
                yield e
            evs, _ = await _t(T.analyze_market_sharded, "analyze_market_sharded", agent="market_price_agent", ocid=ocid)
            for e in evs:
                yield e
        evs, _ = await _t(T.persist_market_flags_as_banderas, "persist_market_flags_as_banderas",
                          agent="market_price_agent", alerta_codigo=alerta_codigo)
        for e in evs:
            yield e

    # ── 6. Proveedor ganador: perfil OECE + SUNAT ──
    async def _fase_proveedor():
        yield {"kind": "phase", "name": "proveedor", "msg": "perfilando al proveedor adjudicado"}
        evs, gan = await _t(T.get_ganador, "get_ganador", ocid=ocid)
        for e in evs:
            yield e
        ganador = (gan or {}).get("ganador") or {}
        ruc = (ganador.get("ruc") or "").strip()
        ctx.update(ganador=ganador, ruc=ruc, razon=ganador.get("razon_social") or "",
                   entidad=(gan or {}).get("entidad") or {}, postores=(gan or {}).get("todos_postores") or [])
        fuente_oece = f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"
        # El perfil OECE/SUNAT alimenta a web_research, person_network y compliance_extended:
        # si la matriz no incluye ninguno, no se consulta (get_ganador sí, para el dictamen).
        _investiga_proveedor = any(_perm(a) for a in ("web_research", "person_network", "compliance_extended"))
        if ruc and _investiga_proveedor:
            evs, perfil = await _t(T.query_oece_perfil, "query_oece_perfil", ruc=ruc)
            for e in evs:
                yield e
            for e in _flags_from_senales((perfil or {}).get("senales"), fuente_oece):
                yield e
            evs, sunat = await _t(T.query_sunat_decolecta, "query_sunat_decolecta", ruc=ruc)
            for e in evs:
                yield e
            if isinstance(sunat, dict) and (sunat.get("error") or sunat.get("found") is False):
                evs, _ = await _t(T.query_edad_ciiu_web, "query_edad_ciiu_web", ruc=ruc, razon_social=ctx["razon"])
                for e in evs:
                    yield e
            evs, _ = await _t(T.read_sunat_profile, "read_sunat_profile")
            for e in evs:
                yield e

    # ── 6-8. Investigación: empresa ∥ prensa ∥ funcionarios ──
    async def _fase_research():
        ruc, razon, entidad = ctx["ruc"], ctx["razon"], ctx["entidad"]
        # Objeto del proceso (lo usa el mensaje de prensa).
        tender = (state.get("ocds") or {}).get("tender") or {}
        objeto = tender.get("description") or tender.get("title") or ""
        # Mensajes de los 3 agentes de investigación INDEPENDIENTES (empresa · prensa · funcionarios).
        _web_msg = (f"Investiga la empresa con RUC {ruc} y razón social {razon}. El perfil SUNAT ya está "
                    f"pre-cargado en tu instrucción — incorpóralo y complementa con prensa, sanciones, "
                    f"directivos, aportes ONPE e historial de contratos.")
        _news_msg = (f"Investiga en prensa peruana: proveedor '{razon}' (RUC {ruc}); entidad "
                     f"'{entidad.get('nombre','')}' (RUC {entidad.get('ruc','')}, región {entidad.get('region','')}); "
                     f"objeto: {objeto[:160]}.")
        _entity_msg = (f"Investiga la estructura administrativa de '{entidad.get('nombre','')}' "
                       f"(RUC {entidad.get('ruc','')}) en la región {entidad.get('region','')}. Devuelve los "
                       f"funcionarios designados (gerentes, procurador, jefe OCI, etc.) con su acto resolutivo.")
        _web_stub = {"empresa": {"ruc": ruc, "razon_social": razon}, "hallazgos": [],
                     "sin_hallazgos_relevantes": True, "_note": "web_research sin hallazgos tras reintento"}
        _entity_stub = {"funcionarios_designados": [], "sin_data_publica": True,
                        "_note": "entity_personnel sin directorio público tras reintento"}

        async def _news_guardrail():
            """Reintento+default del quirk de salida vacía de news_research (esquema propio,
            distinto del _retry_if_empty genérico). Reusado por ambos caminos."""
            if _news_vacio():
                yield {"kind": "warn", "name": "news_research", "msg": "prensa vacía — reintento"}
                state.pop("news_research", None)
                state.pop("_last_agent_final", None)
                async for e in _agent(
                    A.news_research_agent,
                    _news_msg + " (REINTENTO: la pasada anterior salió vacía. Devolvé SIEMPRE el JSON "
                    "completo; si no hay prensa, noticias:[] con sin_menciones_relevantes:true y un "
                    "resumen_ejecutivo que lo diga. NUNCA respondas vacío.)", "news_research"):
                    yield e
                if _news_vacio():
                    state["news_research"] = {
                        "noticias": [], "sin_menciones_relevantes": True, "queries_realizadas": [],
                        "resumen_ejecutivo": "No se hallaron menciones de prensa materiales sobre el "
                        "proveedor, la entidad o el objeto de la contratación.",
                        "_note": "default por salida vacía del news_research_agent tras reintento",
                    }
                    yield {"kind": "warn", "name": "news_research",
                           "msg": "prensa vacía tras reintento — default sin_menciones"}

        _specs_todas = [
            (A.web_research_agent, _web_msg, "web_research"),
            (A.news_research_agent, _news_msg, "news_research"),
            (A.entity_personnel_agent, _entity_msg, "entity_personnel"),
        ]
        _specs = [sp for sp in _specs_todas if _perm(sp[2])]
        for _ag, _m, _k in _specs_todas:
            if not _perm(_k):
                yield _omitido(_k)

        if not _specs:
            pass  # los 3 omitidos por la matriz: nada que investigar
        elif _PARALLEL_RESEARCH:
            # ── 6-8 PARALELO: empresa ∥ prensa ∥ funcionarios. Los 3 son grounding-only e
            # independientes → correrlos concurrentes recorta ~3×latencia a ~1×la-del-más-lento.
            yield {"kind": "phase", "name": "research_parallel",
                   "msg": "investigación paralela: " + " ∥ ".join(sp[2] for sp in _specs)}
            _base = dict(state)  # snapshot read-only para sembrar las sesiones aisladas
            # Transfers en vivo → encienden los nodos del grafo a la vez.
            for ag, _m, _k in _specs:
                nm = getattr(ag, "name", "agent")
                yield {"kind": "transfer", "from": "orch", "to": nm, "agent": "orch",
                       "msg": f"orquestador delega a {nm} (paralelo)"}
            _results = await asyncio.gather(
                *[_run_agent_isolated(ag, msg, _base, ok, ss, user_id) for ag, msg, ok in _specs],
                return_exceptions=True)
            for (ag, _m, _k), res in zip(_specs, _results):
                nm = getattr(ag, "name", "agent")
                if isinstance(res, Exception):
                    yield {"kind": "error", "agent": nm, "detail": f"parallel run: {str(res)[:200]}"}
                    continue
                evs_a, _ft, delta_a, lm_a = res
                state.update(delta_a)             # SOLO el output_key del agente (merge seguro)
                for e in evs_a:
                    yield e
                # Suma tokens/costo de este sub-run al global (lo hace el driver, en el event loop).
                yield {"kind": "_metrics_delta", "agent": nm, "metrics": lm_a}
            state["_last_agent_final"] = None
            # Guardrails de vacío (raros) — secuenciales tras el join.
            if _perm("web_research"):
                async for e in _retry_if_empty(A.web_research_agent, _web_msg, "web_research", _web_stub):
                    yield e
            if _perm("news_research"):
                async for e in _news_guardrail():
                    yield e
            if _perm("entity_personnel"):
                async for e in _retry_if_empty(A.entity_personnel_agent, _entity_msg, "entity_personnel", _entity_stub):
                    yield e
        else:
            # ── 6-8 SECUENCIAL (flujo original; rollback con PARALLEL_RESEARCH=0) ──
            if _perm("web_research"):
                async for e in _agent_with_retry(A.web_research_agent, _web_msg, "web_research", _web_stub):
                    yield e
            if _perm("news_research"):
                yield {"kind": "phase", "name": "news", "msg": "buscando cobertura de prensa"}
                async for e in _agent(A.news_research_agent, _news_msg, "news_research"):
                    yield e
                async for e in _news_guardrail():
                    yield e
            if _perm("entity_personnel"):
                yield {"kind": "phase", "name": "entity_personnel", "msg": "descubriendo funcionarios de la entidad"}
                async for e in _agent_with_retry(A.entity_personnel_agent, _entity_msg, "entity_personnel", _entity_stub):
                    yield e

        # Validación pydantic (WS M) de las salidas de investigación; no descarta la salida,
        # anota en `descartes` y avisa.
        for _k, _sn in (("web_research", "WebResearchOutput"), ("news_research", "NewsOutput"),
                        ("entity_personnel", "EntityPersonnelOutput")):
            if _perm(_k):
                _vev = _validar(_k, _sn)
                if _vev:
                    yield _vev

        # ── Lookup de funcionarios descubiertos (común a ambos caminos) ──
        func_desig = (state.get("entity_personnel") or {})
        funcionarios = func_desig.get("funcionarios_designados") if isinstance(func_desig, dict) else None
        if funcionarios:
            personas_f = [{"id": f"func_{i}", "dni": (p.get("dni") or ""), "nombre": p.get("nombre") or p.get("nombre_completo") or "",
                           "rol": p.get("cargo") or "funcionario"} for i, p in enumerate(funcionarios) if isinstance(p, dict)]
            if personas_f:
                evs, _ = await _t(T.batch_person_lookup, "batch_person_lookup", personas=personas_f)
                for e in evs:
                    yield e

    # ── 9. Red de personas (RNP ganador + postores + batch + puerta giratoria) ──
    async def _fase_person_network():
        if not _perm("person_network"):
            yield _omitido("person_network")
            return
        ganador, ruc, razon, entidad, postores = ctx["ganador"], ctx["ruc"], ctx["razon"], ctx["entidad"], ctx["postores"]
        yield {"kind": "phase", "name": "person_network", "msg": "mapeando la red de personas"}
        socios_personas: list[dict] = []
        if ruc:
            evs, rnp = await _t(T.query_rnp_empresa, "query_rnp_empresa", ruc=ruc)
            for e in evs:
                yield e
            for grupo in ("socios", "representantes_legales", "organos_administracion"):
                for i, s in enumerate((rnp or {}).get(grupo) or []):
                    if isinstance(s, dict) and (s.get("numero_documento") or s.get("nombre")):
                        socios_personas.append({"id": f"{grupo}_{i}", "dni": s.get("numero_documento") or "",
                                                "nombre": s.get("nombre") or "", "rol": grupo[:-1] if grupo.endswith("s") else grupo})
        # RNP de postores rivales
        for j, p in enumerate(postores):
            pr = (p or {}).get("ruc") if isinstance(p, dict) else None
            if pr and pr != ruc:
                evs, _ = await _t(T.query_rnp_empresa, "query_rnp_empresa", ruc=pr)
                for e in evs:
                    yield e
        # batch con todas las personas (ganador/socios/firmantes)
        da = state.get("document_analysis") or {}
        firmantes = (da.get("firmantes_consolidados") or da.get("firmantes") or []) if isinstance(da, dict) else []
        personas_all = list(socios_personas)
        if ganador.get("dni_persona_natural"):
            personas_all.insert(0, {"id": "gerente", "dni": ganador["dni_persona_natural"], "nombre": razon, "rol": "titular"})
        for i, f in enumerate(firmantes):
            if isinstance(f, dict) and (f.get("dni") or f.get("nombre_completo")):
                personas_all.append({"id": f"firmante_{i}", "dni": f.get("dni") or "",
                                     "nombre": f.get("nombre_completo") or "", "rol": "firmante"})
        if personas_all:
            evs, _ = await _t(T.batch_person_lookup, "batch_person_lookup", personas=personas_all)
            for e in evs:
                yield e
        # puerta giratoria / aporte (si hay DNI de gerente)
        dni_ger = ganador.get("dni_persona_natural") or ""
        if dni_ger and entidad.get("ruc"):
            evs, _ = await _t(T.detect_puerta_giratoria, "detect_puerta_giratoria",
                              dni_gerente=dni_ger, entidad_contratante_ruc=entidad.get("ruc"))
            for e in evs:
                yield e
        evs, _ = await _t(T.read_person_network_context, "read_person_network_context")
        for e in evs:
            yield e
        _person_msg = (f"Analiza la red de personas para el OCID {ocid}. El contexto (RNP + datos Perú + "
                       f"postores + firmantes + autoridades) está pre-cargado en tu instrucción.")
        async for e in _agent_with_retry(A.person_network_agent, _person_msg, "person_network",
                                         {"vinculos_detectados": [], "sin_red_detectada": True,
                                          "_note": "person_network sin vínculos tras reintento"}):
            yield e
        _vev = _validar("person_network", "PersonNetworkOutput")
        if _vev:
            yield _vev

    # ── 10. Compliance extendido (12 reglas + banderas de juicio del 7.7) ──
    async def _fase_compliance_ext():
        # Parámetros de perfil para las reglas (WS V los acepta como kwargs; hasta entonces las
        # reglas los leen de state["perfil"] o los ignoran).
        _reglas_kw = {"reglas_activas": profile.reglas_activas, "topes_uit": profile.topes_uit}
        if _perm("compliance_extended"):
            yield {"kind": "phase", "name": "compliance_extended", "msg": "cumplimiento normativo extendido"}
            async for e in _agent(A.compliance_extended_agent,
                                  f"Corre los chequeos extendidos para el OCID {ocid} y evalúa contextualmente "
                                  f"(capacidad operativa, conflicto de interés funcionario↔empresa) con los datos "
                                  f"inyectados. Emití banderas de juicio SOLO si la evidencia las respalda.",
                                  "compliance_extended"):
                yield e
        else:
            yield _omitido("compliance_extended")
            # Perfil sin el agente extendido (p. ej. `otros`): las reglas ACTIVAS del perfil
            # igual corren, en CÓDIGO (sin LLM, sin banderas de juicio). Las 3 duras ya corrieron
            # en compliance; acá van las extendidas cuyo tool `check_<regla>_rule` exista.
            _duras = ("unique_bidder", "sanctioned_provider", "non_competitive_process")

            def _regla_fn(slug: str):
                if isinstance(_REGLAS_POR_NOMBRE, dict) and callable(_REGLAS_POR_NOMBRE.get(slug)):
                    return _REGLAS_POR_NOMBRE[slug]
                fn = getattr(T, f"check_{slug}_rule", None)
                return fn if callable(fn) else None
            _reglas_codigo = [(r, _regla_fn(r)) for r in sorted(profile.reglas_activas) if r not in _duras]
            _reglas_codigo = [(r, fn) for r, fn in _reglas_codigo if fn is not None]
            if _reglas_codigo:
                yield {"kind": "phase", "name": "compliance_rules",
                       "msg": f"reglas del perfil {profile.nombre} en código (sin LLM): "
                              + ", ".join(r for r, _ in _reglas_codigo)}
                for r, fn in _reglas_codigo:
                    evs, _ = await _t(fn, getattr(fn, "__name__", f"check_{r}_rule"),
                                      agent="compliance_extended_agent", ocid=ocid,
                                      **_kwargs_soportados(fn, **_reglas_kw))
                    for e in evs:
                        yield e
        # El cruce RAG y la persistencia de banderas corren SIEMPRE (son del driver, no del agente):
        # cruzan lo acumulado por compliance/parser/market aunque el extendido se haya omitido.
        # En contratos reales el agente flash-lite se RENDÍA tras las 12 reglas (no llegaba a llamar
        # evaluate_normative_compliance) y `normative_compliance` quedaba vacío. Determinista:
        # evaluate_normative_compliance puebla state['normative_compliance'] cruzando TODAS las
        # banderas acumuladas (12 reglas + parser + market + person + juicio) contra el RAG OECE.
        evs, _ = await _t(T.evaluate_normative_compliance, "evaluate_normative_compliance", ocid=ocid,
                          **_kwargs_soportados(T.evaluate_normative_compliance, **_reglas_kw))
        for e in evs:
            yield e
        # persistir cualquier pending_flag acumulado
        evs, _ = await _t(T.persist_alert_from_flags, "persist_alert_from_flags", ocid=ocid)
        for e in evs:
            yield e

    # ── 11-13. Checkpoint + dictamen + verificación + persist final ──
    async def _fase_dictamen():
        yield {"kind": "phase", "name": "persist_checkpoint", "msg": "checkpoint del análisis"}
        evs, _ = await _t(T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=alerta_codigo)
        for e in evs:
            yield e

        if not _perm("report_writer"):
            yield _omitido("report_writer")
            evs, _ = await _t(T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=alerta_codigo)
            for e in evs:
                yield e
            state["_final_response"] = "Análisis completado (sin dictamen: no aplica a la etapa)."
            return
        yield {"kind": "phase", "name": "report_writer", "msg": "escribiendo dictamen periodístico"}
        _validaciones = _bloque_validaciones(state) + _bloque_recortes(state)
        _etapa = str(_clas.get("etapa") or "")
        _tipo = str(_clas.get("tipo") or "")
        _breve = ("" if _etapa not in ("desierta", "cancelada", "nula") else
                  f" El proceso quedó {_etapa}: dictamen BREVE (causal, contexto y lo que sí se verificó); "
                  f"no especules sobre proveedores ni ejecución.")
        if profile.nombre == "otros" and _tipo in ("directa", "convenio"):
            _breve += (f" Contratación {_tipo}: dictamen BREVE centrado en la causal invocada, el expediente de "
                       f"sustento (informes, acto resolutivo, cotizaciones) y lo verificado; sin especular.")
        _secciones = ("\n\nSECCIONES DEL DICTAMEN (perfil " + profile.nombre + "), en este orden: "
                      + " · ".join(profile.dictamen_secciones) + ".")
        async for e in _agent(A.report_writer_agent,
                              f"Escribí el dictamen periodístico para la alerta {alerta_codigo} usando la data en "
                              f"session.state. OBLIGATORIO PASO 1: llamá get_dictamen_context() antes de escribir."
                              + _breve + _secciones + _validaciones, "final_dictamen"):
            yield e

        # Si el output_key no capturó el dictamen pero el agente devolvió texto, lo inyectamos.
        def _capture_dictamen():
            if not state.get("final_dictamen") and (state.get("_last_agent_final") or "").strip():
                state["final_dictamen"] = state["_last_agent_final"].strip()

        _capture_dictamen()

        # Guardrail: si el dictamen salió malformado (degeneración del modelo —
        # README alucinado / tokens de control / cabecera perdida), reintentar UNA vez
        # con contexto compacto; si aún falla, sanitizar como último recurso.
        probs = _dictamen_problems(state.get("final_dictamen"))
        if probs:
            # Sanitizamos el 1er intento ANTES de reintentar, para nunca terminar peor.
            attempt1_clean = _sanitize_dictamen(state.get("final_dictamen") or "")
            yield {"kind": "warn", "name": "report_writer",
                   "msg": f"dictamen malformado {probs} — reintento con contexto compacto"}
            state["_dictamen_compact"] = True
            state.pop("final_dictamen", None)
            state.pop("_last_agent_final", None)
            async for e in _agent(
                A.report_writer_agent,
                f"REINTENTO. El intento anterior salió malformado. Tu RESPUESTA FINAL debe ser el "
                f"dictamen periodístico ENTERO y AUTOCONTENIDO para la alerta {alerta_codigo}: NO "
                f"continúes ningún borrador ni asumas texto previo — reescribí TODO desde el título. "
                f"EMPEZÁ con el título (encabezado markdown '## …') seguido de las secciones (Resumen "
                f"ejecutivo, Hechos clave, etc.). OBLIGATORIO PASO 1: llamá get_dictamen_context() "
                f"antes de escribir. NO incluyas bloques de código, instrucciones de instalación, "
                f"licencias ni texto ajeno al dictamen." + _validaciones, "final_dictamen",
            ):
                yield e
            _capture_dictamen()
            state.pop("_dictamen_compact", None)
            probs2 = _dictamen_problems(state.get("final_dictamen"))
            if not probs2:
                yield {"kind": "info", "name": "report_writer",
                       "msg": "reintento OK — dictamen bien formado"}
            else:
                # Ambas pasadas fallaron: quedarse con la MEJOR sanitizada.
                retry_clean = _sanitize_dictamen(state.get("final_dictamen") or "")
                best = retry_clean if len(retry_clean) >= len(attempt1_clean) else attempt1_clean
                # Si quedó sin cabecera, anteponer un título mínimo (no inventa hechos).
                if best and not best.lstrip().startswith("#"):
                    ocds = state.get("ocds") if isinstance(state.get("ocds"), dict) else {}
                    objeto = ((ocds.get("tender") or {}).get("title") or "").strip()
                    titulo = f"## Dictamen periodístico — {alerta_codigo}"
                    if objeto:
                        titulo += f": {objeto[:120]}"
                    best = titulo + "\n\n" + best
                state["final_dictamen"] = best
                yield {"kind": "warn", "name": "report_writer",
                       "msg": f"reintento aún {probs2} — sanitizado a {len(best)} chars"}

        # ── 12.5 Verificación determinista del dictamen (WS V): banderas citadas que no existen
        #      en `banderas`, URLs sin respaldo en ningún output → `verificacion_dictamen` en state
        #      (persist lo guarda en analisis_full) y warn si quedó degradado.
        if _verificar_dictamen is not None and state.get("final_dictamen"):
            try:
                _ver = _verificar_dictamen(state["final_dictamen"], state)
                state["verificacion_dictamen"] = _ver
                _v = _ver or {}
                _partes = [f"{len(_v.get(k) or [])} {lbl}" for k, lbl in (
                    ("banderas_no_existentes", "bandera(s) inexistentes"), ("urls_no_respaldadas", "URL(s) sin respaldo"),
                    ("rucs_no_respaldados", "RUC sin respaldo"), ("dnis_no_respaldados", "DNI sin respaldo")) if _v.get(k)]
                if _v.get("degradado") or _partes:
                    yield {"kind": "warn", "name": "report_writer",
                           "msg": "dictamen: " + (", ".join(_partes) or "sanitizado") + (" — degradado" if _v.get("degradado") else "")}
            except Exception as e:
                yield {"kind": "warn", "name": "report_writer", "msg": f"verificar_dictamen falló: {str(e)[:160]}"}

        # ── 13. Persist final (con dictamen) ──
        evs, _ = await _t(T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=alerta_codigo)
        for e in evs:
            yield e
        state["_final_response"] = (state.get("final_dictamen") or "")[:2000] or "Análisis completado."

    # ── Ejecución: DAG paralelo o secuencia histórica ──
    if dag:
        async for e in _correr_dag(
            [("compliance", [_fase_compliance]),
             ("documentos", [_fase_parser, ("paralelo", [_fase_legal, _fase_market])]),
             ("proveedor", [_fase_proveedor, _fase_research])]):
            yield e
    else:
        for fase in (_fase_compliance, _fase_parser, _fase_legal, _fase_market, _fase_proveedor, _fase_research):
            async for e in fase():
                yield e
    for fase in (_fase_person_network, _fase_compliance_ext, _fase_dictamen):
        async for e in fase():
            yield e


async def _correr_dag(ramas: list) -> AsyncIterator[dict]:
    """Corre las ramas del DAG concurrentes (tareas asyncio) y re-emite sus eventos EN VIVO por
    una cola (el orden entre ramas no importa; dentro de cada rama se respeta). Un fallo en una
    rama se convierte en un evento `error` de esa rama y NO tumba a las demás.

    `ramas`: [(nombre, pasos)] donde cada paso es una factory de async-generator, o
    ("paralelo", [factories]) para correr sub-pasos concurrentes dentro de la rama."""
    q: asyncio.Queue = asyncio.Queue()

    async def _paso(nombre: str, paso) -> None:
        if isinstance(paso, tuple) and paso[0] == "paralelo":
            await asyncio.gather(*[_paso(nombre, p) for p in paso[1]])
            return
        try:
            async for e in paso():
                await q.put(e)
        except Exception as e:  # la rama falla sola; las otras siguen
            await q.put({"kind": "error", "agent": "pipeline", "name": nombre,
                         "detail": f"rama {nombre}: {type(e).__name__}: {str(e)[:200]}"})

    _FIN = object()   # centinela: la rama terminó (uno por rama)

    async def _rama(nombre: str, pasos: list) -> None:
        try:
            for p in pasos:
                await _paso(nombre, p)
        except Exception as e:  # no debería (cada paso captura), por si acaso
            await q.put({"kind": "error", "agent": "pipeline", "name": nombre,
                         "detail": f"rama {nombre}: {type(e).__name__}: {str(e)[:200]}"})
        finally:
            await q.put(_FIN)

    nombres = [n for n, _ in ramas]
    yield {"kind": "phase", "name": "dag", "msg": "ramas en paralelo: " + " ∥ ".join(nombres)}
    tareas = [asyncio.create_task(_rama(n, pasos)) for n, pasos in ramas]
    pendientes = len(tareas)
    while pendientes > 0:
        e = await q.get()
        if e is _FIN:
            pendientes -= 1
            continue
        yield e
    await asyncio.gather(*tareas, return_exceptions=True)
    yield {"kind": "phase", "name": "dag_join", "msg": "ramas terminadas: " + ", ".join(nombres)}
