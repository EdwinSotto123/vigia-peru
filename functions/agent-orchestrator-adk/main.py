"""
agent-orchestrator-adk · Cloud Function HTTP que corre el agente ADK real.

Endpoint:
  POST /
  Body: {
    "input": "1203694",                           // código o OCID
    "ocds": { ...compiledRelease... },            // pre-fetched para evitar WAF
    "docs_b64": { url: base64, ... }              // PDFs pre-cargados (mismo motivo)
  }

Response:
  {
    "session_id": "...",
    "events": [                                   // trace del agent loop
      { "agent": "vigia_orchestrator", "kind": "tool_call",  "name": "fetch_ocds_record", "args": {...}, "result": {...} },
      { "agent": "vigia_orchestrator", "kind": "transfer",   "to": "document_parser_agent" },
      { "agent": "document_parser_agent", "kind": "tool_call", "name": "parse_document_pdf", ... },
      ...
    ],
    "final_response": "...",                      // mensaje final del orquestador
    "state": { "alerta_codigo": "...", "dictamen": "...", "banderas": [...] }
  }
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from typing import Any, AsyncIterator

import functions_framework

# ⚠ ORDEN CRÍTICO de wrapping de google.genai.generate_content:
#   1) Primero el patch de fallback (envuelve la función ORIGINAL pura de Gemini).
#   2) Luego Arize/OpenInference (envuelve NUESTRO patch por fuera).
# Si se invierte, el patch re-llama la versión instrumentada de OpenInference
# con `self` explícito y rompe el bind ("missing a required argument: 'self'").
# Al aplicar el patch primero, re-llama la original pura (función normal) → OK,
# y OpenInference instrumenta nuestro patch (firma compatible) → captura tokens igual.
from agents._shared import model_fallback  # noqa: F401  (aplica el patch al importar)

from arize_observability import init_arize_tracing, set_session_attrs, force_flush_tracing
_ARIZE_ACTIVE = init_arize_tracing()

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as gtypes

from agents import vigia_orchestrator


APP_NAME = "vigia-peru"


def _build_runner() -> Runner:
    return Runner(
        agent=vigia_orchestrator,
        app_name=APP_NAME,
        session_service=InMemorySessionService(),
    )


async def _run_streaming(
    input_str: str,
    ocds: dict | None,
    docs_b64: dict | None,
    doc_urls: dict | None,
) -> AsyncIterator[dict]:
    """Async generator que yields cada evento del orquestador en tiempo real.

    El último yield es siempre `{"kind": "final", session_id, events, final_response, state}`
    con el snapshot completo del run.
    """
    runner = _build_runner()
    user_id = "demo"
    session_id = str(uuid.uuid4())

    initial_state: dict[str, Any] = {}
    if ocds:
        initial_state["ocds_preloaded"] = ocds
        initial_state["ocds"] = ocds
    if docs_b64:
        initial_state["docs_b64"] = docs_b64
    if doc_urls:
        initial_state["doc_urls"] = doc_urls

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
    yield {"kind": "phase", "name": "started", "msg": f"despachando agentes para {input_str}"}

    # Capturar excepciones del runner (ej. 429 RESOURCE_EXHAUSTED de Gemini)
    # para evitar que la stream colapse sin emitir el evento `final`.
    # Si el runner explota, igual ejecutamos safety_net (persist parcial) y
    # emitimos `final` con el snapshot que tengamos hasta el momento.
    runner_error: dict | None = None

    async def _safe_run():
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
    _metrics = {"prompt": 0, "output": 0, "total": 0, "calls": 0, "cost": 0.0}
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
            pt = int(getattr(um, "prompt_token_count", 0) or 0)
            ct = int(getattr(um, "candidates_token_count", 0) or 0)
            if pt or ct:
                _metrics["prompt"] += pt
                _metrics["output"] += ct
                _metrics["total"] += int(getattr(um, "total_token_count", 0) or (pt + ct))
                _metrics["calls"] += 1
                _metrics["cost"] = round(_metrics["prompt"] / 1e6 * 0.30 + _metrics["output"] / 1e6 * 2.50, 4)
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

    final_session = await runner.session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id,
    )
    raw_state = dict(final_session.state) if final_session and final_session.state else {}
    safety_actions: list[str] = []

    alerta_codigo = raw_state.get("alerta_codigo")
    has_dictamen = bool(raw_state.get("final_dictamen"))
    # Heurística: `persist_analysis_outputs` deja `dictamen_markdown` en
    # alertas y suele dejar la key `_persisted` en state — pero acá nos
    # basta con saber si llegamos al PASO 9. Si NO hay final_dictamen,
    # el orquestador NO llegó al writer y por ende NO persistió.
    if alerta_codigo and not has_dictamen:
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
    #     outputs con 4 evaluadores LLM-as-judge. Emite los scores al stream,
    #     quedan en el agent_trace, se anotan en el span raíz (Phoenix) y van al
    #     resultado. Unifica lo que antes corría offline en scripts/evals_vigia.py.
    _evals = None
    try:
        yield {"kind": "phase", "name": "self_eval",
               "msg": "auto-evaluando el análisis (6 evaluadores · LLM-as-judge + código)…"}
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
        _evals = run_inline_evals(
            _band, _ma_eval.get("findings"),
            raw_state.get("final_dictamen") or final_response or "",
            objeto=str(_objeto_eval or ""), stages=_stages_eval)

        def _evpct(d):
            n = d.get("n", 0)
            return None if not n else round(100 * d.get("ok", 0) / n)
        _evals["pct"] = {
            "respaldo": _evpct(_evals["respaldo"]), "cita": _evpct(_evals["cita"]),
            "precio": _evpct(_evals["precio"]), "tono": _evals.get("tono"),
            "coherencia": _evals.get("coherencia"),
            "completitud": _evpct(_evals["completitud"]),
        }
        _evals["objeto"] = str(_objeto_eval or "")[:240]
        for _ev in (
            {"kind": "eval", "agent": "evaluador", "evaluador": "respaldo_de_bandera",
             "ok": _evals["respaldo"]["ok"], "n": _evals["respaldo"]["n"], "pct": _evals["pct"]["respaldo"],
             "pregunta": "¿la bandera está respaldada por datos verificables (RUC, monto, fecha, artículo)?",
             "metodo": "LLM-as-judge", "objetivo": "banderas de riesgo",
             "per_item": _evals.get("per_bandera")},
            {"kind": "eval", "agent": "evaluador", "evaluador": "cita_evidencia",
             "ok": _evals["cita"]["ok"], "n": _evals["cita"]["n"], "pct": _evals["pct"]["cita"],
             "pregunta": "¿cada bandera cita norma + fuente oficial (SEACE/OECE)?",
             "metodo": "determinista (código)", "objetivo": "banderas de riesgo"},
            {"kind": "eval", "agent": "evaluador", "evaluador": "plausibilidad_precio",
             "ok": _evals["precio"]["ok"], "n": _evals["precio"]["n"], "pct": _evals["pct"]["precio"],
             "pregunta": "¿el sobreprecio se sostiene con la mediana de mercado observada?",
             "metodo": "LLM-as-judge", "objetivo": "ítems con precio de mercado"},
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
        ):
            events_trace.append(_ev)
            yield _ev
        safety_actions.append(f"self_eval_done:{_evals.get('n_judge_calls', 0)}calls")
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
                    "tokens_output": _metrics["output"], "n_llm_calls": _metrics["calls"],
                    "cost_usd": _metrics["cost"],
                },
            }
            if _evals:
                _extra["self_evals"] = _evals
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
    state["llm_metrics"] = {
        "tokens_total": _metrics["total"], "tokens_prompt": _metrics["prompt"],
        "tokens_output": _metrics["output"], "n_llm_calls": _metrics["calls"],
        "cost_usd": _metrics["cost"],
        # trace_id de Phoenix para que el frontend ofrezca el deep-link a la traza
        # completa (orquestación ADK + cada call a Gemini, vía OpenInference).
        "phoenix_trace_id": _phoenix_trace_hex or None,
    }

    final_payload = {
        "kind": "final",
        "session_id": session_id,
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
) -> dict:
    """Wrapper non-streaming: consume el generator y retorna el snapshot final.
    Mantiene compat con clientes que no usan ?stream=1.
    """
    final: dict | None = None
    async for ev in _run_streaming(input_str, ocds, docs_b64, doc_urls):
        if ev.get("kind") == "final":
            final = ev
    if final is None:
        return {"session_id": None, "events": [], "final_response": None, "state": {}}
    return {
        "session_id": final.get("session_id"),
        "events": final.get("events", []),
        "final_response": final.get("final_response"),
        "state": final.get("state", {}),
    }


_LIST_INDEXES_ENSURED = False

def _ensure_list_indexes(cur) -> None:
    """Crea índices idempotentes para acelerar _list_analyzed. Una sola vez por proceso."""
    global _LIST_INDEXES_ENSURED
    if _LIST_INDEXES_ENSURED:
        return
    try:
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_alertas_analizado_en "
            "ON alertas (analizado_en DESC NULLS LAST) "
            "WHERE analizado_en IS NOT NULL"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_banderas_alerta_id "
            "ON banderas (alerta_id)"
        )
        _LIST_INDEXES_ENSURED = True
    except Exception:
        pass


def _list_analyzed(limit: int = 20) -> dict:
    """Lista las convocatorias analizadas (alertas con analizado_en NOT NULL).

    Optimizado:
      · índice parcial sobre `analizado_en` (descendente)
      · agregación de banderas vía LEFT JOIN LATERAL en vez de N subqueries
    """
    from tools import _pg
    conn = _pg()
    try:
        cur = conn.cursor()
        _ensure_list_indexes(cur)
        cur.execute(
            """SELECT a.codigo, a.ocid, a.score,
                      a.objeto, a.monto_adjudicado, a.region,
                      a.fecha_buena_pro, a.analizado_en,
                      e.nombre AS entidad_nombre,
                      a.entidad_ruc, a.proveedor_ruc,
                      LENGTH(a.dictamen_markdown) AS dictamen_chars,
                      COALESCE(bc.n_banderas, 0) AS n_banderas,
                      COALESCE(bc.n_alta, 0)     AS n_alta,
                      COALESCE(bc.n_media, 0)    AS n_media,
                      COALESCE(bc.n_baja, 0)     AS n_baja
                 FROM alertas a
                 LEFT JOIN entidades e ON e.ruc = a.entidad_ruc
                 LEFT JOIN LATERAL (
                   SELECT COUNT(*) AS n_banderas,
                          COUNT(*) FILTER (WHERE severidad='alta')  AS n_alta,
                          COUNT(*) FILTER (WHERE severidad='media') AS n_media,
                          COUNT(*) FILTER (WHERE severidad='baja')  AS n_baja
                     FROM banderas WHERE alerta_id = a.id
                 ) bc ON TRUE
                WHERE a.analizado_en IS NOT NULL
                   OR a.score > 0
                   OR COALESCE(bc.n_banderas, 0) > 0
                ORDER BY COALESCE(a.analizado_en, a.created_at, a.updated_at) DESC NULLS LAST
                LIMIT %s""",
            (limit,),
        )
        rows = cur.fetchall()
        items = []
        for r in rows:
            items.append({
                "codigo": r[0],
                "ocid": r[1],
                "codigo_convocatoria": (r[1] or "").split("-")[-1],
                "score": int(r[2] or 0),
                "objeto": (r[3] or "")[:200],
                "monto": float(r[4] or 0),
                "region": r[5],
                "fecha_buena_pro": str(r[6])[:10] if r[6] else None,
                "analizado_en": r[7].isoformat() if r[7] else None,
                "entidad": r[8],
                "entidad_ruc": r[9],
                "proveedor_ruc": r[10],
                "dictamen_chars": int(r[11] or 0),
                "n_banderas": int(r[12] or 0),
                "n_alta":     int(r[13] or 0),
                "n_media":    int(r[14] or 0),
                "n_baja":     int(r[15] or 0),
            })
        return {"count": len(items), "items": items}
    finally:
        conn.close()


def _random_convocatoria(excluir_analizadas: bool = True) -> dict:
    """Elige al azar una convocatoria conocida.

    Usa la tabla `convocatorias`. Por defecto excluye las ya analizadas
    (para que el sorteo sirva como "explorar una convocatoria nueva del Estado").
    """
    from tools import _pg
    conn = _pg()
    try:
        cur = conn.cursor()
        # Descubrir qué columnas existen en `convocatorias` (defensa contra schema drift)
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='convocatorias' AND table_schema='public'"
        )
        cols_existentes = {r[0] for r in cur.fetchall()}

        # Construir lista de columnas opcionales (solo las que existan)
        candidatos = ["objeto", "cuantia_referencial", "region", "entidad_ruc",
                      "fecha_buena_pro", "fecha_publicacion", "fecha_fin"]
        cols_opcionales = [c for c in candidatos if c in cols_existentes]
        select_cols = "c.ocid" + (", " + ", ".join(f"c.{c}" for c in cols_opcionales) if cols_opcionales else "")

        def _row_to_dict(row, fuente: str) -> dict:
            d: dict = {
                "found": True,
                "fuente": fuente,
                "ocid": row[0] or "",
                "codigo_convocatoria": (row[0] or "").split("-")[-1] if row[0] else "",
            }
            for i, col in enumerate(cols_opcionales, start=1):
                val = row[i] if i < len(row) else None
                if col == "objeto":
                    d["objeto"] = (val or "")[:200]
                elif col == "cuantia_referencial":
                    d["monto"] = float(val or 0)
                elif col in ("fecha_buena_pro", "fecha_publicacion", "fecha_fin"):
                    d[col] = str(val)[:10] if val else None
                else:
                    d[col] = val
            return d

        # Filtro de RECENCIA: SEACE solo expone públicamente las convocatorias
        # de los últimos ~6 meses. OCIDs antiguos devuelven 404 al fetchear.
        # Si existe alguna columna de fecha, filtramos.
        fecha_col = next((c for c in ("fecha_publicacion", "fecha_buena_pro", "fecha_fin")
                          if c in cols_existentes), None)
        fecha_filter = f"AND c.{fecha_col} >= NOW() - INTERVAL '180 days'" if fecha_col else ""

        # Intentar: convocatorias no analizadas, recientes
        if excluir_analizadas:
            cur.execute(
                f"""SELECT {select_cols}
                      FROM convocatorias c
                      LEFT JOIN alertas a ON a.ocid = c.ocid AND a.analizado_en IS NOT NULL
                     WHERE a.id IS NULL
                       AND c.ocid IS NOT NULL
                       {fecha_filter}
                     ORDER BY random()
                     LIMIT 1"""
            )
            row = cur.fetchone()
            if row:
                return _row_to_dict(row, "convocatorias_no_analizadas_recientes")

        # Fallback: cualquier convocatoria reciente (incluso analizada)
        cur.execute(
            f"""SELECT {select_cols}
                  FROM convocatorias c
                 WHERE c.ocid IS NOT NULL
                   {fecha_filter}
                 ORDER BY random()
                 LIMIT 1"""
        )
        row = cur.fetchone()
        if row:
            return _row_to_dict(row, "convocatorias_recientes")
        return {"found": False, "error": "no_convocatorias_recientes"}
    finally:
        conn.close()


def _load_analyzed(ocid_or_codigo: str) -> dict:
    """Carga un análisis cacheado por OCID o codigo de alerta."""
    from tools import _pg
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.codigo, a.ocid, a.score, a.objeto, a.monto_adjudicado,
                      a.region, a.fecha_buena_pro, a.analizado_en,
                      a.entidad_ruc, a.proveedor_ruc,
                      a.analisis_full, a.dictamen_markdown,
                      e.nombre as entidad_nombre,
                      c.ocds_payload
                 FROM alertas a
                 LEFT JOIN entidades e ON e.ruc = a.entidad_ruc
                 LEFT JOIN convocatorias c ON c.ocid = a.ocid
                WHERE a.codigo = %s OR a.ocid = %s OR a.codigo_convocatoria = %s
                LIMIT 1""",
            (ocid_or_codigo, ocid_or_codigo, ocid_or_codigo),
        )
        row = cur.fetchone()
        if not row:
            return {"error": "not_found", "query": ocid_or_codigo}

        cur.execute(
            "SELECT regla, severidad, evidencia, norma, fuente_url "
            "FROM banderas WHERE alerta_id = (SELECT id FROM alertas WHERE codigo = %s)",
            (row[0],),
        )
        banderas = [
            {"regla": b[0], "severidad": b[1], "evidencia": b[2],
             "norma": b[3], "fuente_url": b[4]}
            for b in cur.fetchall()
        ]

        analisis = row[10] or {}
        return {
            "alerta_codigo": row[0],
            "ocid": row[1],
            "score": int(row[2] or 0),
            "objeto": row[3],
            "monto": float(row[4] or 0),
            "region": row[5],
            "fecha_buena_pro": str(row[6])[:10] if row[6] else None,
            "analizado_en": row[7].isoformat() if row[7] else None,
            "entidad_ruc": row[8],
            "proveedor_ruc": row[9],
            "entidad": row[12],
            "banderas": banderas,
            "market_analysis":      analisis.get("market_analysis"),
            "document_analysis":    analisis.get("document_analysis"),
            "web_research":         analisis.get("web_research"),
            "news_research":        analisis.get("news_research"),
            "person_network":       analisis.get("person_network"),
            "person_network_context": analisis.get("person_network_context"),
            "entity_personnel":     analisis.get("entity_personnel"),
            "normative_compliance": analisis.get("normative_compliance"),
            "causal_directa_invocada": analisis.get("causal_directa_invocada"),
            "acto_resolutivo_directa": analisis.get("acto_resolutivo_directa"),
            "estado_real":          analisis.get("estado_real"),
            "analisis_postores":    analisis.get("analisis_postores"),
            "agent_trace":          analisis.get("agent_trace") or [],
            "llm_metrics":          analisis.get("llm_metrics"),
            "self_evals":           analisis.get("self_evals"),
            "dictamen_markdown":    row[11] or "",
            "ocds_payload":         row[13],
        }
    finally:
        conn.close()


@functions_framework.http
def orchestrate(request):
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    if request.method == "OPTIONS":
        return ("", 204, cors)

    # GET routing: ?action=list o ?action=load&ocid=...
    if request.method == "GET":
        action = request.args.get("action", "list")
        try:
            if action == "list":
                limit = int(request.args.get("limit", "20"))
                result = _list_analyzed(limit=min(limit, 100))
            elif action == "load":
                ocid = (request.args.get("ocid") or "").strip()
                if not ocid:
                    return (json.dumps({"error": "missing 'ocid'"}), 400,
                            {"Content-Type": "application/json", **cors})
                result = _load_analyzed(ocid)
            elif action == "random":
                excluir = request.args.get("excluir_analizadas", "1") != "0"
                result = _random_convocatoria(excluir_analizadas=excluir)
            else:
                return (json.dumps({"error": f"unknown action: {action}"}), 400,
                        {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "query_failed", "detail": str(e)[:200]}),
                    500, {"Content-Type": "application/json", **cors})
        return (json.dumps(result, ensure_ascii=False, default=str), 200,
                {"Content-Type": "application/json; charset=utf-8", **cors})

    # POST: run agent
    body = request.get_json(silent=True) or {}

    # ── ADMIN (one-shot): poblar embeddings del RAG legal en pgvector ──
    if body.get("admin_action") == "build_legal_embeddings":
        try:
            from tools.legal import build_legal_embeddings
            res = build_legal_embeddings()
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "build_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    # ── ADMIN: probar el RAG legal (dispatcher: Vertex + fallback pgvector) ──
    if body.get("admin_action") == "test_legal_rag":
        try:
            from tools.legal import query_legal_rag
            res = query_legal_rag(body.get("question") or "único postor gana al 100% del valor referencial", None)
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "test_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    # ── ADMIN (one-shot): ingestar las opiniones OECE a Vertex AI Search ──
    if body.get("admin_action") == "ingest_opinions_to_vertex_search":
        try:
            from tools.legal import ingest_opinions_to_vertex_search
            res = ingest_opinions_to_vertex_search()
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "ingest_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    # ── ADMIN: probar SOLO el backend Vertex AI Search (sin fallback) ──
    if body.get("admin_action") == "test_legal_rag_vertex":
        try:
            from tools.legal import query_legal_rag_vertex
            res = query_legal_rag_vertex(body.get("question") or "adenda mayor al 25% del monto original")
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "test_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    input_str = (body.get("input") or "").strip()
    if not input_str:
        return (json.dumps({"error": "missing 'input'"}), 400,
                {"Content-Type": "application/json", **cors})

    # ── STREAMING MODE: ?stream=1 → NDJSON line-per-event ──
    # Cada línea es un JSON con `{kind, ...}`. La última tiene `kind: "final"`.
    if request.args.get("stream") in ("1", "true", "yes"):
        ocds_p = body.get("ocds")
        docs_b64_p = body.get("docs_b64")
        doc_urls_p = body.get("doc_urls")

        def _generate():
            import queue as _queue
            import threading
            q: "_queue.Queue[Any]" = _queue.Queue(maxsize=512)
            SENTINEL = object()

            def _worker():
                async def _async():
                    try:
                        async for ev in _run_streaming(input_str, ocds_p, docs_b64_p, doc_urls_p):
                            q.put(ev)
                    except Exception as ex:
                        q.put({"kind": "error", "detail": str(ex)[:400]})
                    finally:
                        q.put(SENTINEL)
                asyncio.run(_async())

            threading.Thread(target=_worker, daemon=True).start()

            while True:
                ev = q.get()
                if ev is SENTINEL:
                    break
                try:
                    yield json.dumps(ev, ensure_ascii=False, default=str) + "\n"
                except Exception as ex:
                    yield json.dumps({"kind": "error", "detail": str(ex)[:200]}) + "\n"

        from flask import Response  # type: ignore
        return Response(
            _generate(),
            status=200,
            headers={
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",  # nginx: disable buffering
                **cors,
            },
        )

    try:
        result = asyncio.run(_run(
            input_str,
            body.get("ocds"),
            body.get("docs_b64"),
            body.get("doc_urls"),
        ))
    except Exception as e:
        return (json.dumps({"error": "runner_failed", "detail": str(e)}),
                500, {"Content-Type": "application/json", **cors})

    return (
        json.dumps(result, ensure_ascii=False),
        200,
        {"Content-Type": "application/json; charset=utf-8", **cors},
    )
