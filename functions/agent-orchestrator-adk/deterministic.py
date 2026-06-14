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
"""
from __future__ import annotations

import uuid
from typing import Any, AsyncIterator

from google.adk.runners import Runner
from google.genai import types as gtypes

import agents as A
import tools as T

APP_NAME = "vigia-peru"

# Tarifas Gemini 2.5 Flash en Vertex (USD/1M tokens) — igual que main.py
_COST_IN, _COST_OUT = 0.30, 2.50


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


def _parse_event(event, metrics: dict, fallback_agent: str) -> tuple[list[dict], list[dict], str | None]:
    """Convierte un evento ADK en (trace_events, metric_events, final_text).
    Acumula tokens/costo en `metrics`. Mismo parseo que main._run_streaming."""
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

    metric_events: list[dict] = []
    um = getattr(event, "usage_metadata", None)
    if um is not None:
        pt = int(getattr(um, "prompt_token_count", 0) or 0)
        ct = int(getattr(um, "candidates_token_count", 0) or 0)
        if pt or ct:
            metrics["prompt"] += pt
            metrics["output"] += ct
            metrics["total"] += int(getattr(um, "total_token_count", 0) or (pt + ct))
            metrics["calls"] += 1
            metrics["cost"] = round(metrics["prompt"] / 1e6 * _COST_IN + metrics["output"] / 1e6 * _COST_OUT, 4)
            metric_events.append({"kind": "metrics", "agent": agent_name,
                                  "tokens_total": metrics["total"], "tokens_prompt": metrics["prompt"],
                                  "tokens_output": metrics["output"], "n_llm_calls": metrics["calls"],
                                  "cost_usd": metrics["cost"]})
    return trace, metric_events, final_text


def _tool(fn, fname: str, state: dict, **kwargs) -> tuple[list[dict], Any]:
    """Llama una tool con shim sobre `state`. Devuelve (eventos_trace, resultado)."""
    shim = _Shim(state)
    try:
        res = fn(tool_context=shim, **kwargs)
    except Exception as e:
        res = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
    evs = [
        {"agent": "pipeline", "kind": "tool_call", "name": fname, "args": _short_args(kwargs)},
        {"agent": "pipeline", "kind": "tool_result", "name": fname, "result_preview": _truncate_result(res)},
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
    final_text = None
    try:
        async for event in sub_runner.run_async(user_id=user_id, session_id=sid, new_message=msg):
            trace, metric_evs, ft = _parse_event(event, metrics, name)
            if ft:
                final_text = ft
            for me in metric_evs:
                yield me
            for te in trace:
                yield te
    except Exception as e:
        yield {"agent": name, "kind": "error", "detail": f"run: {str(e)[:200]}"}
    # Merge del state de vuelta (output_key + escrituras de tools del sub-agente).
    try:
        sess = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=sid)
        if sess and sess.state:
            for k, v in dict(sess.state).items():
                state[k] = v
    except Exception:
        pass
    state["_last_agent_final"] = final_text


def _norm_codigo(ocid: str) -> str:
    c = (ocid or "").strip()
    if c.startswith("ocds-"):
        return "OECE-" + c.split("-")[-1]
    if c and not c.startswith("OECE-") and c.isdigit():
        return f"OECE-{c}"
    return c


async def run_deterministic(input_str: str, runner, user_id: str, session_id: str,
                            state: dict, events_trace: list[dict], metrics: dict) -> AsyncIterator[dict]:
    """Ejecuta el pipeline COMPLETO en orden fijo. Yields cada evento (ya appended
    a events_trace). Muta `state` (fuente de verdad para el tail de main.py)."""
    ss = runner.session_service
    ocid = (state.get("ocid") or input_str or "").strip()

    async def _emit(evs):
        for e in evs:
            events_trace.append(e)
            yield e

    async def _agent(agent, msg):
        async for e in _run_agent(agent, msg, state, ss, user_id, metrics):
            events_trace.append(e)
            yield e

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

    # ── 1. OCDS + registro ──
    yield {"kind": "phase", "name": "ocds", "msg": f"obteniendo OCDS de {ocid}"}
    evs, _ = _tool(T.fetch_ocds_record, "fetch_ocds_record", state, ocid=ocid)
    async for e in _emit(evs): yield e
    ocid = (state.get("ocid") or ocid).strip()  # normalizado por la tool
    alerta_codigo = _norm_codigo(ocid)
    evs, _ = _tool(T.register_convocatoria_in_db, "register_convocatoria_in_db", state, ocid=ocid)
    async for e in _emit(evs): yield e

    # ── 2. Compliance (reglas duras + crea alerta) ──
    yield {"kind": "phase", "name": "compliance", "msg": "evaluando reglas duras"}
    async for e in _agent(A.compliance_agent,
                          f"Evalúa la convocatoria OCID {ocid} contra las 3 reglas duras y crea la alerta."):
        yield e

    # ── 3. Document parser ──
    yield {"kind": "phase", "name": "document_parser", "msg": "procesando documentos SEACE"}
    async for e in _agent(A.document_parser_agent,
                          f"Procesa los documentos publicados en SEACE para el OCID {ocid}. PRIORIZA Bases "
                          f"Administrativas/Integradas, Resumen Ejecutivo y Archivos del contrato; extrae el "
                          f"REQUERIMIENTO técnico por ítem. OBLIGATORIO: llamá parse_document_pdf al menos una vez."):
        yield e

    # ── 4. Análisis legal + persistir banderas documentales ──
    yield {"kind": "phase", "name": "legal", "msg": "análisis legal del requerimiento"}
    async for e in _agent(A.document_legal_analyst_agent,
                          f"Analiza legalmente el documento extraído para el OCID {ocid}. Llamá "
                          f"read_document_analysis() para obtener el JSON real del parser antes de emitir banderas."):
        yield e
    evs, _ = _tool(T.persist_doc_flags_as_banderas, "persist_doc_flags_as_banderas", state, alerta_codigo=alerta_codigo)
    async for e in _emit(evs): yield e

    # ── 5. Mercado ──
    yield {"kind": "phase", "name": "market", "msg": "validando precios de mercado"}
    evs, _ = _tool(T.build_market_input, "build_market_input", state, ocid=ocid)
    async for e in _emit(evs): yield e
    evs, _ = _tool(T.analyze_market_sharded, "analyze_market_sharded", state, ocid=ocid)
    async for e in _emit(evs): yield e
    evs, _ = _tool(T.persist_market_flags_as_banderas, "persist_market_flags_as_banderas", state, alerta_codigo=alerta_codigo)
    async for e in _emit(evs): yield e

    # ── 6. Proveedor ganador: perfil OECE + SUNAT + web_research ──
    yield {"kind": "phase", "name": "proveedor", "msg": "perfilando al proveedor adjudicado"}
    evs, gan = _tool(T.get_ganador, "get_ganador", state, ocid=ocid)
    async for e in _emit(evs): yield e
    ganador = (gan or {}).get("ganador") or {}
    ruc = (ganador.get("ruc") or "").strip()
    razon = ganador.get("razon_social") or ""
    entidad = (gan or {}).get("entidad") or {}
    postores = (gan or {}).get("todos_postores") or []
    fuente_oece = f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"
    if ruc:
        evs, perfil = _tool(T.query_oece_perfil, "query_oece_perfil", state, ruc=ruc)
        async for e in _emit(evs): yield e
        async for e in _emit(_flags_from_senales((perfil or {}).get("senales"), fuente_oece)): yield e
        evs, sunat = _tool(T.query_sunat_decolecta, "query_sunat_decolecta", state, ruc=ruc)
        async for e in _emit(evs): yield e
        if isinstance(sunat, dict) and (sunat.get("error") or sunat.get("found") is False):
            evs, _ = _tool(T.query_edad_ciiu_web, "query_edad_ciiu_web", state, ruc=ruc, razon_social=razon)
            async for e in _emit(evs): yield e
        evs, _ = _tool(T.read_sunat_profile, "read_sunat_profile", state)
        async for e in _emit(evs): yield e
    async for e in _agent(A.web_research_agent,
                          f"Investiga la empresa con RUC {ruc} y razón social {razon}. El perfil SUNAT ya está "
                          f"pre-cargado en tu instrucción — incorpóralo y complementa con prensa, sanciones, "
                          f"directivos, aportes ONPE e historial de contratos."):
        yield e

    # ── 7. Prensa ──
    yield {"kind": "phase", "name": "news", "msg": "buscando cobertura de prensa"}
    tender = (state.get("ocds") or {}).get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    async for e in _agent(A.news_research_agent,
                          f"Investiga en prensa peruana: proveedor '{razon}' (RUC {ruc}); entidad "
                          f"'{entidad.get('nombre','')}' (RUC {entidad.get('ruc','')}, región {entidad.get('region','')}); "
                          f"objeto: {objeto[:160]}."):
        yield e

    # ── 8. Funcionarios de la entidad + lookup ──
    yield {"kind": "phase", "name": "entity_personnel", "msg": "descubriendo funcionarios de la entidad"}
    async for e in _agent(A.entity_personnel_agent,
                          f"Investiga la estructura administrativa de '{entidad.get('nombre','')}' "
                          f"(RUC {entidad.get('ruc','')}) en la región {entidad.get('region','')}. Devuelve los "
                          f"funcionarios designados (gerentes, procurador, jefe OCI, etc.) con su acto resolutivo."):
        yield e
    func_desig = (state.get("entity_personnel") or {})
    funcionarios = func_desig.get("funcionarios_designados") if isinstance(func_desig, dict) else None
    if funcionarios:
        personas_f = [{"id": f"func_{i}", "dni": (p.get("dni") or ""), "nombre": p.get("nombre") or p.get("nombre_completo") or "",
                       "rol": p.get("cargo") or "funcionario"} for i, p in enumerate(funcionarios) if isinstance(p, dict)]
        if personas_f:
            evs, _ = _tool(T.batch_person_lookup, "batch_person_lookup", state, personas=personas_f)
            async for e in _emit(evs): yield e

    # ── 9. Red de personas (RNP ganador + postores + batch + puerta giratoria) ──
    yield {"kind": "phase", "name": "person_network", "msg": "mapeando la red de personas"}
    socios_personas: list[dict] = []
    if ruc:
        evs, rnp = _tool(T.query_rnp_empresa, "query_rnp_empresa", state, ruc=ruc)
        async for e in _emit(evs): yield e
        for grupo in ("socios", "representantes_legales", "organos_administracion"):
            for i, s in enumerate((rnp or {}).get(grupo) or []):
                if isinstance(s, dict) and (s.get("numero_documento") or s.get("nombre")):
                    socios_personas.append({"id": f"{grupo}_{i}", "dni": s.get("numero_documento") or "",
                                            "nombre": s.get("nombre") or "", "rol": grupo[:-1] if grupo.endswith("s") else grupo})
    # RNP de postores rivales
    for j, p in enumerate(postores):
        pr = (p or {}).get("ruc") if isinstance(p, dict) else None
        if pr and pr != ruc:
            evs, _ = _tool(T.query_rnp_empresa, "query_rnp_empresa", state, ruc=pr)
            async for e in _emit(evs): yield e
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
        evs, _ = _tool(T.batch_person_lookup, "batch_person_lookup", state, personas=personas_all)
        async for e in _emit(evs): yield e
    # puerta giratoria / aporte (si hay DNI de gerente)
    dni_ger = ganador.get("dni_persona_natural") or ""
    if dni_ger and entidad.get("ruc"):
        evs, _ = _tool(T.detect_puerta_giratoria, "detect_puerta_giratoria", state,
                       dni_gerente=dni_ger, entidad_contratante_ruc=entidad.get("ruc"))
        async for e in _emit(evs): yield e
    evs, _ = _tool(T.read_person_network_context, "read_person_network_context", state)
    async for e in _emit(evs): yield e
    async for e in _agent(A.person_network_agent,
                          f"Analiza la red de personas para el OCID {ocid}. El contexto (RNP + datos Perú + "
                          f"postores + firmantes + autoridades) está pre-cargado en tu instrucción."):
        yield e

    # ── 10. Compliance extendido (12 reglas + RAG + banderas de juicio del 7.7) ──
    yield {"kind": "phase", "name": "compliance_extended", "msg": "cumplimiento normativo extendido"}
    async for e in _agent(A.compliance_extended_agent,
                          f"Corre los chequeos extendidos para el OCID {ocid}, evalúa contextualmente "
                          f"(CIIU↔objeto, capacidad operativa, causal de directa, conflicto de interés), "
                          f"cruza todo contra el RAG OECE y persiste las banderas en la alerta {alerta_codigo}."):
        yield e
    # persistir cualquier pending_flag acumulado
    evs, _ = _tool(T.persist_alert_from_flags, "persist_alert_from_flags", state, ocid=ocid)
    async for e in _emit(evs): yield e

    # ── 11. Checkpoint persist (antes del dictamen) ──
    yield {"kind": "phase", "name": "persist_checkpoint", "msg": "checkpoint del análisis"}
    evs, _ = _tool(T.persist_analysis_outputs, "persist_analysis_outputs", state, alerta_codigo=alerta_codigo)
    async for e in _emit(evs): yield e

    # ── 12. Dictamen ──
    yield {"kind": "phase", "name": "report_writer", "msg": "escribiendo dictamen periodístico"}
    async for e in _agent(A.report_writer_agent,
                          f"Escribí el dictamen periodístico para la alerta {alerta_codigo} usando la data en "
                          f"session.state. OBLIGATORIO PASO 1: llamá get_dictamen_context() antes de escribir."):
        yield e
    # Si el output_key no capturó el dictamen pero el agente devolvió texto, lo inyectamos.
    if not state.get("final_dictamen") and (state.get("_last_agent_final") or "").strip():
        state["final_dictamen"] = state["_last_agent_final"].strip()

    # ── 13. Persist final (con dictamen) ──
    evs, _ = _tool(T.persist_analysis_outputs, "persist_analysis_outputs", state, alerta_codigo=alerta_codigo)
    async for e in _emit(evs): yield e
    state["_final_response"] = (state.get("final_dictamen") or "")[:2000] or "Análisis completado."
