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

# Tarifas Gemini en Vertex (USD/1M tokens, estimado). El pipeline MEZCLA tiers:
# Pro (report_writer/legal/person_network), Flash (default) y Flash-Lite
# (compliance_extended). Cobrar TODO a tarifa Flash subreporta el costo real
# (Pro ~5x in / ~4x out) → distorsiona el costo que va al span de Arize. Por eso
# el costo se acumula POR LLAMADA con la tarifa del modelo de cada sub-agente.
_MODEL_RATES = {
    "pro":        (1.25, 10.00),
    "flash-lite": (0.10, 0.40),
    "flash":      (0.30, 2.50),
}
_DEFAULT_RATE = _MODEL_RATES["flash"]


def _rate_for_model(model) -> tuple[float, float]:
    """(in_rate, out_rate) USD/1M según substring del id del modelo. Robusto a
    None o a un objeto Model (se castea a str)."""
    m = str(model or "").lower()
    if "pro" in m:
        return _MODEL_RATES["pro"]
    if "lite" in m:
        return _MODEL_RATES["flash-lite"]
    if "flash" in m:
        return _MODEL_RATES["flash"]
    return _DEFAULT_RATE


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
        pt = int(getattr(um, "prompt_token_count", 0) or 0)
        ct = int(getattr(um, "candidates_token_count", 0) or 0)
        if pt or ct:
            in_r, out_r = _rate_for_model(model)
            metrics["prompt"] += pt
            metrics["output"] += ct
            metrics["total"] += int(getattr(um, "total_token_count", 0) or (pt + ct))
            metrics["calls"] += 1
            # Costo = SUMA POR LLAMADA con la tarifa del modelo (no recálculo desde
            # totales con una tarifa única — eso era lo que subreportaba al Pro).
            metrics["cost"] = round(float(metrics.get("cost") or 0.0)
                                    + pt / 1e6 * in_r + ct / 1e6 * out_r, 6)
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
        # Evento `transfer` (orquestador → sub-agente): es lo que el grafo del
        # frontend usa para iluminar el nodo del agente (buildTrace → ev.to). En
        # el flujo determinista el "orquestador" es el código; sin este transfer,
        # los agentes que solo usan grounding (web/news/entity/person) no emiten
        # tool_calls y el grafo nunca los encendería.
        nm = getattr(agent, "name", "agent")
        tev = {"kind": "transfer", "from": "orch", "to": nm, "agent": "orch",
               "msg": f"orquestador delega a {nm}"}
        events_trace.append(tev)
        yield tev
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

    async def _agent_with_retry(agent, msg, state_key, default_stub):
        """Corre un sub-agente y, si su `state_key` quedó VACÍO (quirk de grounding),
        reintenta 1× con instrucción explícita; si sigue vacío, deja un default
        tipado (degradación honesta) para no dejar la sección en blanco sin aviso.
        Generaliza el guardrail que ya tenía news_research a web/entity/person."""
        async for e in _agent(agent, msg):
            yield e
        if _is_empty_output(state.get(state_key)):
            yield {"kind": "warn", "name": state_key, "msg": f"{state_key} vacío — reintento"}
            state.pop(state_key, None)
            state.pop("_last_agent_final", None)
            async for e in _agent(agent, msg + " (REINTENTO: la pasada anterior salió VACÍA. "
                                  "Devolvé SIEMPRE el JSON COMPLETO del schema pedido; si no hay "
                                  "datos, devolvé las listas vacías + un campo que lo indique. "
                                  "NUNCA respondas vacío.)"):
                yield e
            if _is_empty_output(state.get(state_key)):
                state[state_key] = default_stub
                yield {"kind": "warn", "name": state_key,
                       "msg": f"{state_key} vacío tras reintento — default tipado"}

    # ── 1. OCDS + registro ──
    yield {"kind": "phase", "name": "ocds", "msg": f"obteniendo OCDS de {ocid}"}
    evs, _ = _tool(T.fetch_ocds_record, "fetch_ocds_record", state, ocid=ocid)
    async for e in _emit(evs): yield e
    ocid = (state.get("ocid") or ocid).strip()  # normalizado por la tool
    alerta_codigo = _norm_codigo(ocid)

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
        evs, _ = _tool(T.persist_analysis_outputs, "persist_analysis_outputs", state, alerta_codigo=alerta_codigo)
        async for e in _emit(evs): yield e
        return

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
    # El análisis de mercado corre como tools (no sub-agente), pero igual debe
    # iluminar el nodo "market" del grafo → transfer explícito orquestador→market.
    _mkt = {"kind": "transfer", "from": "orch", "to": "market_price_agent", "agent": "orch",
            "msg": "orquestador delega a market_price_agent"}
    events_trace.append(_mkt)
    yield _mkt
    evs, _ = _tool(T.build_market_input, "build_market_input", state, agent="market_price_agent", ocid=ocid)
    async for e in _emit(evs): yield e
    evs, _ = _tool(T.analyze_market_sharded, "analyze_market_sharded", state, agent="market_price_agent", ocid=ocid)
    async for e in _emit(evs): yield e
    evs, _ = _tool(T.persist_market_flags_as_banderas, "persist_market_flags_as_banderas", state, agent="market_price_agent", alerta_codigo=alerta_codigo)
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
    _web_msg = (f"Investiga la empresa con RUC {ruc} y razón social {razon}. El perfil SUNAT ya está "
                f"pre-cargado en tu instrucción — incorpóralo y complementa con prensa, sanciones, "
                f"directivos, aportes ONPE e historial de contratos.")
    async for e in _agent_with_retry(A.web_research_agent, _web_msg, "web_research",
                                     {"empresa": {"ruc": ruc, "razon_social": razon},
                                      "hallazgos": [], "sin_hallazgos_relevantes": True,
                                      "_note": "web_research sin hallazgos tras reintento"}):
        yield e

    # ── 7. Prensa ──
    yield {"kind": "phase", "name": "news", "msg": "buscando cobertura de prensa"}
    tender = (state.get("ocds") or {}).get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    _news_msg = (f"Investiga en prensa peruana: proveedor '{razon}' (RUC {ruc}); entidad "
                 f"'{entidad.get('nombre','')}' (RUC {entidad.get('ruc','')}, región {entidad.get('region','')}); "
                 f"objeto: {objeto[:160]}.")
    async for e in _agent(A.news_research_agent, _news_msg):
        yield e

    # Guardrail: news_research a veces sale VACÍO ("") — quirk de Gemini+google_search
    # (los tokens se van al grounding/thinking y el texto final viene vacío). Reintentar
    # una vez; si sigue vacío, default 'sin menciones' para no dejar la sección en blanco.
    def _news_vacio():
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
    if _news_vacio():
        yield {"kind": "warn", "name": "news_research", "msg": "prensa vacía — reintento"}
        state.pop("news_research", None)
        state.pop("_last_agent_final", None)
        async for e in _agent(
            A.news_research_agent,
            _news_msg + " (REINTENTO: la pasada anterior salió vacía. Devolvé SIEMPRE el JSON "
            "completo; si no hay prensa, noticias:[] con sin_menciones_relevantes:true y un "
            "resumen_ejecutivo que lo diga. NUNCA respondas vacío.)"):
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

    # ── 8. Funcionarios de la entidad + lookup ──
    yield {"kind": "phase", "name": "entity_personnel", "msg": "descubriendo funcionarios de la entidad"}
    _entity_msg = (f"Investiga la estructura administrativa de '{entidad.get('nombre','')}' "
                   f"(RUC {entidad.get('ruc','')}) en la región {entidad.get('region','')}. Devuelve los "
                   f"funcionarios designados (gerentes, procurador, jefe OCI, etc.) con su acto resolutivo.")
    async for e in _agent_with_retry(A.entity_personnel_agent, _entity_msg, "entity_personnel",
                                     {"funcionarios_designados": [], "sin_data_publica": True,
                                      "_note": "entity_personnel sin directorio público tras reintento"}):
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
    _person_msg = (f"Analiza la red de personas para el OCID {ocid}. El contexto (RNP + datos Perú + "
                   f"postores + firmantes + autoridades) está pre-cargado en tu instrucción.")
    async for e in _agent_with_retry(A.person_network_agent, _person_msg, "person_network",
                                     {"vinculos_detectados": [], "sin_red_detectada": True,
                                      "_note": "person_network sin vínculos tras reintento"}):
        yield e

    # ── 10. Compliance extendido (12 reglas + banderas de juicio del 7.7) ──
    yield {"kind": "phase", "name": "compliance_extended", "msg": "cumplimiento normativo extendido"}
    async for e in _agent(A.compliance_extended_agent,
                          f"Corre los chequeos extendidos para el OCID {ocid} y evalúa contextualmente "
                          f"(capacidad operativa, conflicto de interés funcionario↔empresa) con los datos "
                          f"inyectados. Emití banderas de juicio SOLO si la evidencia las respalda."):
        yield e
    # El cruce RAG y la persistencia los corre el DRIVER, NO el agente flash-lite: en
    # contratos reales el agente se RENDÍA tras las 12 reglas (no llegaba a llamar
    # evaluate_normative_compliance) y `normative_compliance` quedaba vacío. Determinista:
    # evaluate_normative_compliance puebla state['normative_compliance'] cruzando TODAS las
    # banderas acumuladas (12 reglas + parser + market + person + juicio) contra el RAG OECE.
    evs, _ = _tool(T.evaluate_normative_compliance, "evaluate_normative_compliance", state, ocid=ocid)
    async for e in _emit(evs): yield e
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
            f"licencias ni texto ajeno al dictamen.",
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

    # ── 13. Persist final (con dictamen) ──
    evs, _ = _tool(T.persist_analysis_outputs, "persist_analysis_outputs", state, alerta_codigo=alerta_codigo)
    async for e in _emit(evs): yield e
    state["_final_response"] = (state.get("final_dictamen") or "")[:2000] or "Análisis completado."
