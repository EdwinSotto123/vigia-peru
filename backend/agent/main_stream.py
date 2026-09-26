"""Corrida del agente + streaming de eventos, para main.py (orchestrate).

`_run_streaming` es el corazón de una request: arma la sesión ADK, corre el pipeline
(determinista por defecto, o el orquestador-LLM legacy con DETERMINISTIC_PIPELINE=0),
aplica el safety-net (fuerza el report_writer si el dictamen quedó vacío), persiste el
análisis, corre el self-eval inline (8 evaluadores) y cierra la traza de Arize. `_run` es
el wrapper no-streaming que consume el generator y devuelve solo el snapshot final.

Extraído de main.py. Conserva acá — y NO en main.py — el bloque de imports con orden
crítico (ver el comentario debajo): main.py importa `_run_streaming`/`_run` de este
módulo ANTES que cualquier otra cosa relacionada a Gemini, así que ese import dispara
el patch de `model_fallback` + `init_arize_tracing()` en el mismo orden relativo que
tenían en el archivo original (init_arize_tracing es idempotente — arize_observability.py
lo documenta — pero el ORDEN entre el patch y la instrumentación sigue siendo crítico).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from typing import Any, AsyncIterator

# ⚠ ORDEN CRÍTICO de wrapping de google.genai.generate_content:
#   1) Primero el patch de fallback (envuelve la función ORIGINAL pura de Gemini).
#   2) Luego Arize/OpenInference (envuelve NUESTRO patch por fuera).
# Si se invierte, el patch re-llama la versión instrumentada de OpenInference
# con `self` explícito y rompe el bind ("missing a required argument: 'self'").
# Al aplicar el patch primero, re-llama la original pura (función normal) → OK,
# y OpenInference instrumenta nuestro patch (firma compatible) → captura tokens igual.
from agents._shared import model_fallback  # noqa: F401  (aplica el patch al importar)

from arize_observability import init_arize_tracing, set_session_attrs, force_flush_tracing
from agents._shared.profiles import get_profile

_ARIZE_ACTIVE = init_arize_tracing()

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as gtypes

import agents as _agents
from agents import vigia_orchestrator
from deterministic import _kwargs_soportados, _rate_for_model, _usage_tokens
from pipeline_runtime import _factor_trafico
from tools import flex as _flex_mod


APP_NAME = "vigia-peru"
PROFILE = get_profile()


def _rate_for_agent_name(name: str) -> tuple[float, float]:
    """Tarifa (in, out) USD/1M del MODELO real del agente `name` (camino LLM / safety-net
    writer). Reusa la tabla de deterministic._rate_for_model (3.x/2.5 + thinking)."""
    ag = getattr(_agents, name, None) if name else None
    model = getattr(ag, "model", None) if ag is not None else None
    return _rate_for_model(model)


def _build_runner() -> Runner:
    return Runner(
        agent=vigia_orchestrator,
        app_name=APP_NAME,
        session_service=InMemorySessionService(),
    )


def _normalizar_clasificacion(clasificacion) -> dict | None:
    """Valida el bloque `clasificacion` del body. Devuelve None si no viene o está vacío
    (→ compatibilidad: sin `agentes_permitidos` en el state corren todos los agentes)."""
    if not isinstance(clasificacion, dict):
        return None
    agentes = [str(a) for a in (clasificacion.get("agentes") or []) if a]
    if not agentes:
        return None
    return {
        "tipo": clasificacion.get("tipo"),
        "etapa": clasificacion.get("etapa"),
        "agentes": agentes,
        "validaciones_pendientes": [str(v) for v in (clasificacion.get("validaciones_pendientes") or []) if v],
    }


async def _run_streaming(
    input_str: str,
    ocds: dict | None,
    docs_b64: dict | None,
    doc_urls: dict | None,
    clasificacion: dict | None = None,
    doc_ids: list | None = None,
) -> AsyncIterator[dict]:
    """Async generator que yields cada evento del orquestador en tiempo real.

    El último yield es siempre `{"kind": "final", session_id, events, final_response, state}`
    con el snapshot completo del run.
    """
    runner = _build_runner()
    user_id = "demo"
    session_id = str(uuid.uuid4())
    _flex_mod.iniciar_corrida()   # corte por tiempo de Flex (tools/flex.py) cuenta desde aquí

    initial_state: dict[str, Any] = {}
    if ocds:
        initial_state["ocds_preloaded"] = ocds
        initial_state["ocds"] = ocds
    if docs_b64:
        initial_state["docs_b64"] = docs_b64
    if doc_urls:
        initial_state["doc_urls"] = doc_urls
    if isinstance(doc_ids, (list, tuple)) and doc_ids:
        initial_state["doc_ids"] = [str(d) for d in doc_ids if d]  # WS D restringe el lote a estos
    _clas = _normalizar_clasificacion(clasificacion)
    if _clas:
        # El pipeline determinista consulta `agentes_permitidos` (deterministic.permitido) y
        # el report_writer lista `validaciones_pendientes` al final del dictamen.
        initial_state["clasificacion"] = _clas
        initial_state["agentes_permitidos"] = _clas["agentes"]
        initial_state["validaciones_pendientes"] = _clas["validaciones_pendientes"]

    await runner.session_service.create_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id,
        state=initial_state,
    )

    # ─── Arize: span raíz por análisis ──────────────────────────────
    # Crear una span de toda la sesión etiquetada con el OCID. Todas las
    # llamadas a Gemini (capturadas por GoogleGenAIInstrumentor) cuelgan
    # automáticamente de esta span por ser hijas en el current context.
    _arize_span_cm = None
    _phoenix_trace_hex = ""  # trace_id de la corrida → deep-link a Phoenix desde el frontend
    if _ARIZE_ACTIVE:
        try:
            from arize_observability import get_tracer
            tracer = get_tracer()
            if tracer is not None:
                _arize_span_cm = tracer.start_as_current_span(
                    f"vigia_analysis · {input_str}",
                )
                _root_span = _arize_span_cm.__enter__()
                _root_span.set_attribute("vigia.ocid", input_str)
                _root_span.set_attribute("vigia.session_id", session_id)
                try:
                    _phoenix_trace_hex = format(_root_span.get_span_context().trace_id, "032x")
                except Exception:
                    _phoenix_trace_hex = ""
                if ocds:
                    buyer = ((ocds.get("buyer") or {}) if isinstance(ocds, dict) else {}).get("name")
                    if buyer:
                        _root_span.set_attribute("vigia.entidad", str(buyer)[:80])
                    cuantia = (ocds.get("tender") or {}).get("value", {}).get("amount") if isinstance(ocds, dict) else None
                    if cuantia:
                        _root_span.set_attribute("vigia.cuantia", float(cuantia))
        except Exception as e:
            print(f"[arize] no se pudo crear span raíz: {e}", flush=True)

    user_msg = gtypes.Content(
        role="user",
        parts=[gtypes.Part.from_text(text=(
            f"Investigá la convocatoria {input_str} y producí un análisis "
            f"completo de riesgo de corrupción, siguiendo el flujo de tu instrucción."
        ))],
    )

    events_trace: list[dict] = []
    final_response: str | None = None

    # Eventos sintéticos del lifecycle del stream
    yield {"kind": "session", "session_id": session_id, "ts": time.time()}
    yield {"kind": "phase", "name": "perfil", "msg": PROFILE.nombre}
    yield {"kind": "phase", "name": "started", "msg": f"despachando agentes para {input_str}"}

    # Capturar excepciones del runner (ej. 429 RESOURCE_EXHAUSTED de Gemini)
    # para evitar que la stream colapse sin emitir el evento `final`.
    # Si el runner explota, igual ejecutamos safety_net (persist parcial) y
    # emitimos `final` con el snapshot que tengamos hasta el momento.
    runner_error: dict | None = None
    # Orquestación determinista por defecto (DETERMINISTIC_PIPELINE!=0): el código
    # maneja la secuencia de agentes en vez del LLM orquestador (que se rinde antes
    # de terminar). =0 vuelve al orquestador-LLM (rollback).
    _DETERMINISTIC = os.getenv("DETERMINISTIC_PIPELINE", "1") != "0"
    _det_state: dict | None = None

    async def _safe_run():
        if _DETERMINISTIC:
            return  # la secuencia la maneja run_deterministic (abajo), no el LLM
        try:
            async for ev in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=user_msg,
            ):
                yield ev
        except Exception as _exc:
            # Marcador sentinel — el caller detecta y registra el error.
            yield ("__RUNNER_ERROR__", _exc)

    # Acumulador de tokens/costo (de usage_metadata de cada respuesta del LLM) —
    # se emite como eventos `metrics` al stream para mostrar en vivo que Arize
    # está midiendo. Tarifas Gemini 2.5 Flash en Vertex (USD/1M tokens, estimado).
    _metrics = {"prompt": 0, "output": 0, "total": 0, "calls": 0, "cost": 0.0, "thoughts": 0, "flex_calls": 0}

    # ── Pipeline DETERMINISTA: la secuencia de agentes/tools la corre el código
    #    (deterministic.run_deterministic) → todos los agentes corren SIEMPRE, no
    #    puede rendirse a mitad. Yields los mismos eventos al stream y deja el
    #    `state` final en `_det_state` (que el tail usa como raw_state). ──
    if _DETERMINISTIC:
        from deterministic import run_deterministic
        _det_state = dict(initial_state)
        _det_state.setdefault("ocid", input_str)
        yield {"kind": "phase", "name": "deterministic",
               "msg": "pipeline determinista (secuencia en código)"}
        try:
            async for ev in run_deterministic(
                input_str, runner, user_id, session_id, _det_state, events_trace, _metrics,
            ):
                yield ev
        except Exception as _exc:
            runner_error = {"kind": "runner_exception", "msg": str(_exc)[:500],
                            "class": type(_exc).__name__}
            yield {"kind": "error", "agent": "pipeline", "detail": str(_exc)[:300]}
        final_response = _det_state.get("_final_response")

    async for event in _safe_run():
        # Sentinel: el runner falló (ej. 429 RESOURCE_EXHAUSTED).
        if isinstance(event, tuple) and len(event) == 2 and event[0] == "__RUNNER_ERROR__":
            _exc = event[1]
            runner_error = {
                "kind": "runner_exception",
                "msg": str(_exc)[:500],
                "class": type(_exc).__name__,
            }
            err_kind = "quota_exhausted" if (
                "429" in str(_exc) or "RESOURCE_EXHAUSTED" in str(_exc)
                or "quota" in str(_exc).lower()
            ) else "runner_exception"
            err_ev = {
                "agent": "system",
                "kind": "error",
                "detail": runner_error["msg"],
                "error_class": runner_error["class"],
                "error_kind": err_kind,
            }
            events_trace.append(err_ev)
            yield err_ev
            yield {"kind": "phase", "name": "runner_aborted",
                   "msg": f"runner abortó ({err_kind}) — continuando con safety net"}
            break

        agent_name = getattr(event, "author", None) or "?"
        new_events: list[dict] = []

        try:
            parts = (event.content.parts if event.content else []) or []
            for p in parts:
                if getattr(p, "function_call", None):
                    fc = p.function_call
                    new_events.append({
                        "agent": agent_name,
                        "kind": "tool_call",
                        "name": fc.name,
                        "args": dict(fc.args) if fc.args else {},
                    })
                elif getattr(p, "function_response", None):
                    fr = p.function_response
                    out = dict(fr.response) if fr.response else {}
                    out_repr = {
                        k: (v if not isinstance(v, str) or len(v) < 8000 else v[:8000] + "…")
                        for k, v in out.items()
                    } if isinstance(out, dict) else out
                    new_events.append({
                        "agent": agent_name,
                        "kind": "tool_result",
                        "name": fr.name,
                        "result_preview": out_repr,
                    })
                elif getattr(p, "text", None):
                    if event.is_final_response():
                        final_response = p.text
                    else:
                        new_events.append({
                            "agent": agent_name,
                            "kind": "thought",
                            "text": p.text[:8000],
                        })
        except Exception as e:
            new_events.append({"agent": agent_name, "kind": "error", "detail": str(e)})

        actions = getattr(event, "actions", None)
        if actions:
            transfer = getattr(actions, "transfer_to_agent", None)
            if transfer:
                new_events.append({
                    "agent": agent_name, "kind": "transfer", "to": transfer,
                })

        # Métricas de tokens/costo del evento ADK (si trae usage_metadata).
        # SOLO para el stream en vivo (no se persisten en el trace).
        um = getattr(event, "usage_metadata", None)
        if um is not None:
            pt, ct, tt, _total = _usage_tokens(um)
            if pt or ct or tt:
                _in_r, _out_r = _rate_for_agent_name(agent_name)
                _metrics["prompt"] += pt
                _metrics["output"] += ct + tt       # thinking se cobra como salida
                _metrics["thoughts"] = int(_metrics.get("thoughts") or 0) + tt
                _metrics["total"] += _total
                _metrics["calls"] += 1
                # Suma POR LLAMADA con la tarifa del modelo real (no recálculo desde totales).
                _fx = _factor_trafico(um)
                if _fx < 1:
                    _metrics["flex_calls"] = int(_metrics.get("flex_calls") or 0) + 1
                _metrics["cost"] = round(float(_metrics.get("cost") or 0.0)
                                         + (pt / 1e6 * _in_r + (ct + tt) / 1e6 * _out_r) * _fx, 6)
                yield {
                    "kind": "metrics", "agent": agent_name,
                    "tokens_total": _metrics["total"], "tokens_prompt": _metrics["prompt"],
                    "tokens_output": _metrics["output"], "n_llm_calls": _metrics["calls"],
                    "cost_usd": _metrics["cost"],
                }

        for ev_d in new_events:
            events_trace.append(ev_d)
            yield ev_d

    yield {"kind": "phase", "name": "safety_net", "msg": "verificando completitud del análisis…"}

    if _det_state is not None:
        # Modo determinista: `state` lo controla run_deterministic (no la sesión ADK).
        raw_state = _det_state
    else:
        final_session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id,
        )
        raw_state = dict(final_session.state) if final_session and final_session.state else {}
    safety_actions: list[str] = []

    alerta_codigo = raw_state.get("alerta_codigo")
    has_dictamen = bool(raw_state.get("final_dictamen"))
    # Si la matriz tipo × etapa excluyó al report_writer, no forzarlo acá.
    _perm = raw_state.get("agentes_permitidos")
    writer_permitido = not isinstance(_perm, list) or "report_writer" in _perm
    # Heurística: `persist_analysis_outputs` deja `dictamen_markdown` en
    # alertas y suele dejar la key `_persisted` en state — pero acá nos
    # basta con saber si llegamos al PASO 9. Si NO hay final_dictamen,
    # el orquestador NO llegó al writer y por ende NO persistió.
    if alerta_codigo and not has_dictamen and writer_permitido:
        print(f"[safety-net] orquestador se rindió antes del writer — "
              f"corriendo report_writer + persist manualmente. "
              f"alerta_codigo={alerta_codigo}")
        safety_actions.append("writer_forced")
        yield {"kind": "phase", "name": "writer_forced", "msg": "escribiendo dictamen periodístico…"}
        # Ejecutar report_writer_agent como sub-agente standalone
        try:
            from agents import report_writer_agent
            writer_runner = Runner(
                agent=report_writer_agent,
                app_name=APP_NAME,
                session_service=runner.session_service,
            )
            writer_msg = gtypes.Content(role="user", parts=[gtypes.Part.from_text(
                text=(f"Escribí el dictamen periodístico para la alerta "
                      f"{alerta_codigo} usando la data en session.state. "
                      f"OBLIGATORIO PASO 1: llamá get_dictamen_context() antes de escribir."))])
            # Capturar el texto final del writer por si el output_key
            # 'final_dictamen' no se pobló (a veces el agente devuelve el
            # dictamen como texto pero ADK no lo guarda en state).
            writer_text = None
            async for _ev in writer_runner.run_async(
                user_id=user_id, session_id=session_id, new_message=writer_msg,
            ):
                try:
                    if getattr(_ev, "content", None) and _ev.content.parts:
                        for _p in _ev.content.parts:
                            _t = getattr(_p, "text", None)
                            if _t and _ev.is_final_response():
                                writer_text = _t
                except Exception:
                    pass
            # Recargar state después del writer
            final_session = await runner.session_service.get_session(
                app_name=APP_NAME, user_id=user_id, session_id=session_id,
            )
            raw_state = dict(final_session.state) if final_session and final_session.state else {}
            # Fallback: si no quedó dictamen en state pero el writer SÍ generó
            # texto, lo inyectamos para que persist_analysis_outputs lo guarde.
            if not raw_state.get("final_dictamen") and writer_text and len(writer_text.strip()) > 200:
                raw_state["final_dictamen"] = writer_text.strip()
                safety_actions.append("writer_text_captured")
            has_dictamen = bool(raw_state.get("final_dictamen"))
            safety_actions.append("writer_done" if has_dictamen else "writer_failed")
        except Exception as e:
            print(f"[safety-net] writer manual falló: {e}")
            safety_actions.append(f"writer_exception:{str(e)[:80]}")

    # Persist final SIEMPRE — la tool persist_analysis_outputs deriva el código
    # desde el OCID si alerta_codigo está vacío (caso: compliance no creó alerta).
    # No condicionamos por alerta_codigo: la tool sabe manejar el caso vacío.
    yield {"kind": "phase", "name": "persist", "msg": "persistiendo análisis en Cloud SQL…"}
    try:
        from tools import persist_analysis_outputs
        class _Shim:
            pass
        shim = _Shim()
        shim.state = raw_state  # type: ignore
        persist_result = persist_analysis_outputs(alerta_codigo or "", shim)  # type: ignore
        # La tool devuelve el codigo final que usó (derivado o no)
        alerta_codigo = persist_result.get("alerta_codigo") or alerta_codigo
        safety_actions.append(
            f"persist={persist_result.get('persisted')} "
            f"codigo={persist_result.get('alerta_codigo')} "
            f"bytes={persist_result.get('bytes_saved',0)}"
        )
    except Exception as e:
        print(f"[safety-net] persist manual falló: {e}")
        safety_actions.append(f"persist_exception:{str(e)[:80]}")

    # ─── Self-eval INLINE (track Arize): el orquestador juzga sus propios
    #     outputs con 8 evaluadores (4 LLM-as-judge en paralelo + 4 de código). Emite los scores al stream,
    #     quedan en el agent_trace, se anotan en el span raíz (Phoenix) y van al
    #     resultado. Unifica lo que antes corría offline en backend/scripts/evals_vigia.py.
    _evals = None
    try:
        yield {"kind": "phase", "name": "self_eval",
               "msg": "auto-evaluando el análisis (8 evaluadores · LLM-as-judge + código)…"}
        from tools.self_eval import run_inline_evals
        from tools import _pg as _pg_eval
        _band: list = []
        _cod = (alerta_codigo or "").strip()
        if _cod.startswith("ocds-"):
            _cod = "OECE-" + _cod.split("-")[-1]
        elif _cod and not _cod.startswith("OECE-") and _cod.isdigit():
            _cod = f"OECE-{_cod}"
        if _cod:
            try:
                _conn = _pg_eval()
                try:
                    _cur = _conn.cursor()
                    _cur.execute(
                        "SELECT b.regla, b.severidad, b.evidencia, b.norma, b.fuente_url "
                        "FROM banderas b JOIN alertas a ON a.id = b.alerta_id WHERE a.codigo = %s",
                        (_cod,))
                    _band = [{"regla": r[0], "severidad": r[1], "evidencia": r[2],
                              "norma": r[3], "fuente_url": r[4]} for r in _cur.fetchall()]
                finally:
                    _conn.close()
            except Exception as _e:
                print(f"[self-eval] no se pudieron leer banderas: {_e}")
        _ma_eval = raw_state.get("market_analysis") or {}
        _ocds_eval = raw_state.get("ocds") or {}
        _tender_eval = (_ocds_eval.get("tender") or {}) if isinstance(_ocds_eval, dict) else {}
        _objeto_eval = ""
        if isinstance(_tender_eval, dict):
            _objeto_eval = (_tender_eval.get("title") or _tender_eval.get("description") or "")
        if not _objeto_eval and isinstance(_ocds_eval, dict):
            _objeto_eval = _ocds_eval.get("objeto") or ""
        _stages_eval = {
            "docs": bool(raw_state.get("document_analysis")),
            "market": bool(_ma_eval.get("findings")),
            "red": bool(raw_state.get("person_network") or raw_state.get("entity_personnel")),
            "dictamen": bool((raw_state.get("final_dictamen") or final_response or "").strip()),
            "banderas": bool(_band),
        }
        def _rp_eval(v):
            # Parseo robusto (los output_key de los sub-agentes llegan como STRING,
            # a veces con fences ```json o texto extra; json.loads simple falla).
            if isinstance(v, dict):
                return v
            if not isinstance(v, str) or not v.strip():
                return {}
            s = v.strip()
            if s.startswith("```"):
                _nl = s.find("\n")
                s = s[_nl + 1:] if _nl > 0 else s
                if s.rstrip().endswith("```"):
                    s = s.rstrip()[:-3]
            try:
                return json.loads(s)
            except Exception:
                import re as _re_rp
                _m = _re_rp.search(r"\{[\s\S]*\}", s)
                if _m:
                    try:
                        return json.loads(_m.group(0))
                    except Exception:
                        return {}
                return {}
        _da_eval = _rp_eval(raw_state.get("document_analysis"))
        _firmantes_eval = (_da_eval.get("firmantes_consolidados") or _da_eval.get("firmantes") or [])
        _doc_items_eval = [str(it.get("descripcion_corta") or it.get("descripcion") or "")
                           for it in (_da_eval.get("items_consolidados") or [])
                           if isinstance(it, dict)]
        _nr_eval = _rp_eval(raw_state.get("news_research"))
        # Los 4 jueces LLM corren en paralelo dentro de run_inline_evals (EVAL_CONCURRENCY);
        # la función es síncrona → en un hilo para no bloquear el event loop del stream.
        _evals = await asyncio.to_thread(
            run_inline_evals,
            _band, _ma_eval.get("findings"),
            raw_state.get("final_dictamen") or final_response or "",
            objeto=str(_objeto_eval or ""), stages=_stages_eval,
            news_research=_nr_eval, firmantes=_firmantes_eval, doc_item_descs=_doc_items_eval,
            **_kwargs_soportados(run_inline_evals, state=raw_state))  # WS V: jueces con documentos_texto/ocds

        def _evpct(d):
            n = d.get("n", 0)
            return None if not n else round(100 * d.get("ok", 0) / n)
        _evals["pct"] = {
            "respaldo": _evpct(_evals["respaldo"]), "cita": _evpct(_evals["cita"]),
            "precio": _evpct(_evals["precio"]), "tono": _evals.get("tono"),
            "coherencia": _evals.get("coherencia"),
            "completitud": _evpct(_evals["completitud"]),
            "cobertura_prensa": _evpct(_evals["cobertura_prensa"]),
            "firmantes": _evpct(_evals["firmantes"]),
        }
        _evals["objeto"] = str(_objeto_eval or "")[:240]
        # Resúmenes legibles para el dashboard (el front ya muestra reason/faltantes).
        def _first_fail_reason(items, ok_key):
            for it in (items or []):
                # `is False`: un juez que no pudo evaluar deja None, que no es una falla.
                if isinstance(it, dict) and it.get(ok_key) is False and (it.get("reason") or "").strip():
                    return f"{it.get('regla') or it.get('item') or 'ítem'}: {it['reason'].strip()}"
            return None
        _respaldo_reason = (_first_fail_reason(_evals.get("per_bandera"), "respaldada")
                            or ("Todas las banderas con evidencia verificable." if _evals["respaldo"]["n"] else None))
        _precio_reason = (_first_fail_reason(_evals.get("per_precio"), "plausible")
                          or ("Veredictos coherentes con la mediana observada." if _evals["precio"]["n"] else None))
        _cita_faltantes = [f"{c.get('regla')} (falta {', '.join(c.get('falta') or [])})"
                           for c in (_evals.get("cita_detalle") or [])]
        for _ev in (
            {"kind": "eval", "agent": "evaluador", "evaluador": "respaldo_de_bandera",
             "ok": _evals["respaldo"]["ok"], "n": _evals["respaldo"]["n"], "pct": _evals["pct"]["respaldo"],
             "pregunta": "¿la bandera está respaldada por datos verificables (RUC, monto, fecha, artículo)?",
             "metodo": "LLM-as-judge", "objetivo": "banderas de riesgo",
             "reason": _respaldo_reason, "per_item": _evals.get("per_bandera")},
            {"kind": "eval", "agent": "evaluador", "evaluador": "cita_evidencia",
             "ok": _evals["cita"]["ok"], "n": _evals["cita"]["n"], "pct": _evals["pct"]["cita"],
             "pregunta": "¿cada bandera cita norma + fuente oficial (SEACE/OECE)?",
             "metodo": "determinista (código)", "objetivo": "banderas de riesgo",
             "faltantes": _cita_faltantes, "per_item": _evals.get("cita_detalle")},
            {"kind": "eval", "agent": "evaluador", "evaluador": "plausibilidad_precio",
             "ok": _evals["precio"]["ok"], "n": _evals["precio"]["n"], "pct": _evals["pct"]["precio"],
             "pregunta": "¿el sobreprecio se sostiene con la mediana de mercado observada?",
             "metodo": "LLM-as-judge", "objetivo": "ítems con precio de mercado",
             "reason": _precio_reason, "per_item": _evals.get("per_precio")},
            {"kind": "eval", "agent": "evaluador", "evaluador": "tono_no_acusatorio",
             "label": _evals.get("tono"), "reason": _evals.get("tono_reason"),
             "pregunta": "¿el dictamen usa lenguaje de 'señal de riesgo' y nunca acusa de delito?",
             "metodo": "LLM-as-judge", "objetivo": "dictamen final"},
            {"kind": "eval", "agent": "evaluador", "evaluador": "coherencia_objeto_items",
             "label": _evals.get("coherencia"), "reason": _evals.get("coherencia_reason"),
             "pregunta": "¿los ítems analizados pertenecen al objeto de la convocatoria?",
             "metodo": "LLM-as-judge", "objetivo": "objeto ↔ ítems"},
            {"kind": "eval", "agent": "evaluador", "evaluador": "completitud_analisis",
             "ok": _evals["completitud"]["ok"], "n": _evals["completitud"]["n"], "pct": _evals["pct"]["completitud"],
             "faltantes": _evals["completitud"]["faltantes"],
             "pregunta": "¿corrieron todas las etapas (documentos, mercado, red, dictamen, banderas)?",
             "metodo": "determinista (código)", "objetivo": "pipeline completo"},
            {"kind": "eval", "agent": "evaluador", "evaluador": "cobertura_prensa",
             "ok": _evals["cobertura_prensa"]["ok"], "n": _evals["cobertura_prensa"]["n"],
             "pct": _evals["pct"]["cobertura_prensa"],
             "pregunta": "¿el agente de prensa devolvió cobertura estructurada (noticias o 'sin menciones'), no vacío?",
             "metodo": "determinista (código)", "objetivo": "investigación de prensa",
             "reason": f"estado: {_evals['cobertura_prensa'].get('estado')}"},
            {"kind": "eval", "agent": "evaluador", "evaluador": "firmantes_plausibles",
             "ok": _evals["firmantes"]["ok"], "n": _evals["firmantes"]["n"],
             "pct": _evals["pct"]["firmantes"], "faltantes": _evals["firmantes"].get("placeholders"),
             "pregunta": "¿los firmantes extraídos son reales (no placeholders de plantilla tipo 'POSTOR N' sin DNI)?",
             "metodo": "determinista (código)", "objetivo": "firmantes del documento"},
        ):
            events_trace.append(_ev)
            yield _ev
        safety_actions.append(f"self_eval_done:{_evals.get('n_judge_calls', 0)}calls")

        # ── Self-eval BLOQUEANTE (WS V: tools.self_eval.debe_bloquear): si el respaldo
        #    de banderas es bajo, el tono es acusatorio o el dictamen es incoherente, la
        #    alerta pasa a estado 'revision' y NO se publica (la API pública la excluye).
        #    Hasta que V exista, `_debe_bloquear` no está y no se bloquea nada.
        try:
            from tools.self_eval import debe_bloquear as _debe_bloquear  # WS V
        except (ImportError, AttributeError):
            _debe_bloquear = None
        if _debe_bloquear is not None and _cod:
            try:
                _bloq, _motivo = _debe_bloquear(_evals)
            except Exception as _e:
                _bloq, _motivo = False, f"debe_bloquear falló: {str(_e)[:120]}"
                print(f"[self-eval] {_motivo}")
            if _bloq:
                try:
                    _conn_b = _pg_eval()
                    try:
                        _cur_b = _conn_b.cursor()
                        _cur_b.execute("UPDATE alertas SET estado = 'revision' WHERE codigo = %s", (_cod,))
                        _conn_b.commit()
                    finally:
                        _conn_b.close()
                    raw_state["revision"] = {"motivo": _motivo, "alerta_codigo": _cod}
                    _wev = {"kind": "warn", "name": "self_eval",
                            "msg": f"alerta {_cod} en REVISIÓN (no publicada): {_motivo}"}
                    events_trace.append(_wev)
                    yield _wev
                    safety_actions.append(f"revision:{str(_motivo)[:80]}")
                except Exception as _e:
                    print(f"[self-eval] no se pudo marcar revision: {_e}")
                    safety_actions.append(f"revision_exception:{str(_e)[:80]}")
    except Exception as _e:
        print(f"[self-eval] falló: {_e}")
        safety_actions.append(f"self_eval_exception:{str(_e)[:80]}")

    # Guardar el agent_trace (events) dentro de analisis_full.agent_trace
    # para que /history pueda renderizar el Trace ADK también en cargas cacheadas.
    if alerta_codigo and events_trace:
        try:
            from tools import _pg
            persist_codigo = (alerta_codigo or "").strip()
            if persist_codigo.startswith("ocds-"):
                persist_codigo = "OECE-" + persist_codigo.split("-")[-1]
            elif persist_codigo and not persist_codigo.startswith("OECE-") and persist_codigo.isdigit():
                persist_codigo = f"OECE-{persist_codigo}"
            # Fusionar agent_trace + llm_metrics + self_evals en analisis_full,
            # para que /history (cargas cacheadas) muestre el dashboard completo.
            _extra = {
                "agent_trace": events_trace,
                "llm_metrics": {
                    "tokens_total": _metrics["total"], "tokens_prompt": _metrics["prompt"],
                    "tokens_output": _metrics["output"], "tokens_thoughts": _metrics.get("thoughts", 0),
                    "n_llm_calls": _metrics["calls"], "cost_usd": _metrics["cost"],
                    "n_llm_calls_flex": _metrics.get("flex_calls", 0),
                    "flex": _flex_mod.resumen_corrida(),
                },
                "perfil": PROFILE.nombre,
                "recortes": raw_state.get("recortes") or [],
                "descartes": raw_state.get("descartes") or [],
                "verificacion_dictamen": raw_state.get("verificacion_dictamen"),
            }
            if _evals:
                _extra["self_evals"] = _evals
            # La traza técnica, recortes y descartes se guardan sin DNI (el dossier los conserva
            # en sus propios campos, bajo vidrio en el frontend).
            from agents._shared.pii import activo as _pii_activo, redactar as _redactar_pii
            if _pii_activo():
                for _k in ("agent_trace", "recortes", "descartes"):
                    _extra[_k] = _redactar_pii(_extra[_k])
            extra_blob = json.dumps(_extra, ensure_ascii=False, default=str)
            conn = _pg()
            try:
                cur = conn.cursor()
                cur.execute(
                    """UPDATE alertas
                          SET analisis_full = COALESCE(analisis_full, '{}'::jsonb) || %s::jsonb
                        WHERE codigo = %s""",
                    (extra_blob, persist_codigo),
                )
                conn.commit()
                safety_actions.append(f"trace_saved={len(events_trace)}ev")
            finally:
                conn.close()
        except Exception as e:
            print(f"[safety-net] guardar agent_trace falló: {e}")
            safety_actions.append(f"trace_exception:{str(e)[:80]}")

    state = raw_state
    # No exponer la session-state pesada
    state.pop("ocds", None)
    state.pop("ocds_preloaded", None)
    state.pop("docs_b64", None)
    state.pop("doc_urls", None)
    if safety_actions:
        state["_safety_net"] = safety_actions
    if _evals:
        state["self_evals"] = _evals
    # Persistir métricas LLM finales para que el resultado (no solo el vivo) las muestre.
    state["perfil_nombre"] = PROFILE.nombre
    state["llm_metrics"] = {
        "tokens_total": _metrics["total"], "tokens_prompt": _metrics["prompt"],
        "tokens_output": _metrics["output"], "tokens_thoughts": _metrics.get("thoughts", 0),
        "n_llm_calls": _metrics["calls"], "cost_usd": _metrics["cost"],
        "n_llm_calls_flex": _metrics.get("flex_calls", 0),
        "flex": _flex_mod.resumen_corrida(),
        # trace_id de Phoenix para que el frontend ofrezca el deep-link a la traza
        # completa (orquestación ADK + cada call a Gemini, vía OpenInference).
        "phoenix_trace_id": _phoenix_trace_hex or None,
    }

    final_payload = {
        "kind": "final",
        "session_id": session_id,
        "perfil": PROFILE.nombre,
        "events": events_trace,
        "final_response": final_response,
        "state": state,
    }
    if runner_error:
        final_payload["runner_error"] = runner_error

    # ─── Arize: cerrar span raíz con métricas finales del análisis ──
    if _arize_span_cm is not None:
        try:
            from opentelemetry import trace as _otel_trace  # type: ignore
            _root = _otel_trace.get_current_span()
            _root.set_attribute("vigia.n_events", len(events_trace))
            _root.set_attribute("vigia.alerta_codigo", state.get("alerta_codigo") or "")
            if state.get("score") is not None:
                try:
                    _root.set_attribute("vigia.score", int(state["score"]))
                except Exception:
                    pass
            # ── Métricas de negocio para el dashboard / pitch (todas guardadas) ──
            def _safe_set(attr, val):
                try:
                    if val is not None:
                        _root.set_attribute(attr, val)
                except Exception:
                    pass
            # Derivadas del trace de eventos (siempre disponible)
            _tool_calls = [e for e in events_trace if e.get("kind") == "tool_call"]
            _agentes = {e.get("name") for e in _tool_calls if str(e.get("name", "")).endswith("_agent")}
            _safe_set("vigia.n_tool_calls", len(_tool_calls))
            _safe_set("vigia.n_agentes", len(_agentes))
            # Banderas: máximo conteo persistido visto en los tool_results + contextuales
            _n_band = 0
            _n_ctx = 0
            for _e in events_trace:
                if _e.get("kind") == "tool_call" and _e.get("name") == "add_contextual_flag":
                    _n_ctx += 1
                _rp = _e.get("result_preview")
                if _e.get("kind") == "tool_result" and isinstance(_rp, dict):
                    for _k in ("banderas_persistidas", "n_pending_total", "persistidas"):
                        _v = _rp.get(_k)
                        if isinstance(_v, (int, float)) and _v > _n_band:
                            _n_band = int(_v)
            _safe_set("vigia.n_banderas", max(_n_band, _n_ctx))
            # Mercado (de state['market_analysis'])
            _ma = state.get("market_analysis")
            if isinstance(_ma, dict):
                _cob = _ma.get("cobertura_mercado")
                _safe_set("vigia.market.cobertura", float(_cob) if isinstance(_cob, (int, float)) else None)
                _safe_set("vigia.market.n_con_mediana", _ma.get("n_con_mediana"))
                _safe_set("vigia.market.n_items", _ma.get("n_items"))
                _safe_set("vigia.market.veredicto", _ma.get("veredicto_global"))
            # Evals inline (self-eval) → atributos del span en Phoenix
            if _evals and isinstance(_evals.get("pct"), dict):
                _safe_set("vigia.eval.respaldo_pct", _evals["pct"].get("respaldo"))
                _safe_set("vigia.eval.cita_pct", _evals["pct"].get("cita"))
                _safe_set("vigia.eval.precio_pct", _evals["pct"].get("precio"))
                _safe_set("vigia.eval.tono", _evals["pct"].get("tono"))
                _safe_set("vigia.eval.coherencia", _evals["pct"].get("coherencia"))
                _safe_set("vigia.eval.completitud_pct", _evals["pct"].get("completitud"))
                _safe_set("vigia.eval.n_judge_calls", _evals.get("n_judge_calls"))
            if isinstance(state.get("llm_metrics"), dict):
                _lm = state["llm_metrics"]
                _safe_set("vigia.llm.tokens_total", _lm.get("tokens_total"))
                _safe_set("vigia.llm.cost_usd", _lm.get("cost_usd"))
                _safe_set("vigia.llm.n_calls", _lm.get("n_llm_calls"))
            if runner_error:
                _root.set_attribute("vigia.runner_error", str(runner_error)[:300])
        except Exception:
            pass
        try:
            _arize_span_cm.__exit__(None, None, None)
        except Exception:
            pass
        # Serverless: empujar el span raíz a AX + Phoenix ANTES de que la
        # instancia se congele. Sin esto el span raíz se pierde (0 vigia.ocid).
        try:
            force_flush_tracing()
        except Exception:
            pass

    yield final_payload


async def _run(
    input_str: str,
    ocds: dict | None,
    docs_b64: dict | None,
    doc_urls: dict | None,
    clasificacion: dict | None = None,
    doc_ids: list | None = None,
) -> dict:
    """Wrapper non-streaming: consume el generator y retorna el snapshot final.
    Mantiene compat con clientes que no usan ?stream=1.
    """
    final: dict | None = None
    async for ev in _run_streaming(input_str, ocds, docs_b64, doc_urls, clasificacion, doc_ids):
        if ev.get("kind") == "final":
            final = ev
    if final is None:
        return {"session_id": None, "perfil": PROFILE.nombre, "events": [], "final_response": None, "state": {}}
    return {
        "session_id": final.get("session_id"),
        "perfil": PROFILE.nombre,
        "events": final.get("events", []),
        "final_response": final.get("final_response"),
        "state": final.get("state", {}),
    }
