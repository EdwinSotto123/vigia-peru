"""Capa de ejecución de agentes/tools del pipeline determinista (backend/agent/deterministic.py).

Cómo se corre cada sub-agente ADK (`_run_agent*`), cómo se llama una tool con el shim
mínimo de `tool_context` (`_tool`/`_Shim`), cómo se parsea un evento ADK a trace+métricas
(`_parse_event`) y a qué tarifa se cobra cada modelo (`_rate_for_model`). También el motor
genérico de ramas concurrentes del DAG (`_correr_dag`).

Extraído de deterministic.py (que sigue siendo el único módulo con acceso directo,
patcheable en tests, a `A`/`T`/`get_profile`/etc. — ver su docstring). Estas funciones NO
leen esos globals: reciben todo lo que necesitan por parámetro (`agent`, `fn`, `state`), así
que da igual desde qué módulo se llamen.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any, AsyncIterator

from google.adk.runners import Runner
from google.genai import types as gtypes

APP_NAME = "vigia-peru"


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


# Tarifas Gemini en Vertex (USD/1M tokens; lista pública consultada 2026-09-15 —
# [verificar] contra cloud.google.com/vertex-ai/generative-ai/pricing antes de facturar:
# 3.6-flash está en tarifa introductoria 0.75/3.75 hasta 2026-12-31, lista 1.50/7.50).
# El pipeline MEZCLA tiers; cobrar todo a una tarifa única distorsiona el costo que va al
# span de Arize → el costo se acumula POR LLAMADA con la tarifa del modelo del sub-agente.
# Los tokens de THINKING (`thoughts_token_count`) se cobran como salida (así los factura Vertex).
_MODEL_RATES = {
    "gemini-3.6-flash":      (0.75, 3.75),
    "gemini-3.8-flash":      (0.75, 3.75),   # mismo precio que 3.6 (Gemini API, 2026-09-24)
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


def _factor_trafico(um) -> float:
    """Flex PayGo cobra la mitad: la respuesta trae traffic_type ON_DEMAND_FLEX."""
    return 0.5 if "FLEX" in str(getattr(um, "traffic_type", "") or "").upper() else 1.0


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
            fx = _factor_trafico(um)
            if fx < 1:
                metrics["flex_calls"] = int(metrics.get("flex_calls") or 0) + 1
            metrics["cost"] = round(float(metrics.get("cost") or 0.0)
                                    + (pt / 1e6 * in_r + (ct + tt) / 1e6 * out_r) * fx, 6)
            metric_events.append({"kind": "metrics", "agent": agent_name,
                                  "tokens_total": metrics["total"], "tokens_prompt": metrics["prompt"],
                                  "tokens_output": metrics["output"], "n_llm_calls": metrics["calls"],
                                  "cost_usd": metrics["cost"]})
    return trace, metric_events, final_text


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
    for k in ("prompt", "output", "total", "calls", "thoughts", "flex_calls"):
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
