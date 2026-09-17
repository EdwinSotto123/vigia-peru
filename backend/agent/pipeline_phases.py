"""Las 9 fases del pipeline determinista (backend/agent/deterministic.py) como funciones de
módulo, cada una tomando un `PipelineCtx` explícito en vez de cerrar sobre variables locales
de `_pipeline`.

Por qué un `PipelineCtx` y no un import directo de `agents`/`tools`/`get_profile`: los tests
(tests/test_dag.py) monkeypatchean esos nombres SOBRE EL MÓDULO `deterministic` (p.ej.
`monkeypatch.setattr(D, "A", agentes_stub)`) para correr el DAG completo sin red ni Gemini.
Un `import agents as A` propio de este módulo NO vería ese parche (cada módulo tiene su
propio namespace). En cambio, `deterministic._pipeline` SIGUE leyendo `A`/`T`/`get_profile`/
`_seleccionar_documentos`/`_analizar_mercado`/`_verificar_dictamen`/`_PARALLEL_RESEARCH`/etc.
por nombre simple DENTRO de deterministic.py (ahí SÍ ve el parche) y arma un `PipelineCtx`
con esos valores YA resueltos; estas funciones solo leen `pc.A`, `pc.T`, etc. — el parche
llega igual, por referencia, sin que este módulo necesite importar nada patcheable.

`PipelineCtx.perm`/`.validar` son los dos casos que siguen atados a deterministic.py (`permitido`
lee `get_profile` como fallback; `_validar_schema` lee `_schemas`): llegan como closures ya
ligadas, construidas allá.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Callable

from pipeline_guardrails import _bloque_recortes, _bloque_validaciones, _dictamen_problems, _sanitize_dictamen
from pipeline_runtime import _tool, _truncate_result
from pipeline_state import _aplicar_delta, _backfill_document_analysis, _is_empty_output, _kwargs_soportados, _registrar_descarte, _registrar_recorte


@dataclass
class PipelineCtx:
    """Todo lo que las fases necesitan de la corrida en curso, resuelto UNA vez al arrancar
    `_pipeline` (en deterministic.py, donde los nombres patcheables se leen correctamente)."""
    state: dict
    metrics: dict
    ctx: dict                  # scratch del proveedor: ganador/ruc/razon/entidad/postores
    profile: Any
    dag: bool
    ss: Any                    # session_service
    user_id: str
    ocid: str
    alerta_codigo: str
    clas: dict
    tipo_etapa: str
    A: Any                     # módulo `agents` (o stub de test)
    T: Any                     # módulo `tools` (o stub de test)
    seleccionar_documentos: Any
    recorte_seleccion: Any
    parse_documentos_lote: Any
    analizar_mercado: Any
    verificar_dictamen: Any
    reglas_por_nombre: Any
    parallel_research: bool
    run_agent: Callable
    run_agent_isolated: Callable
    run_agent_delta: Callable
    perm: Callable              # (nombre) -> bool
    validar: Callable           # (key, schema_name) -> evento|None


# ── Helpers que reemplazan a los closures de `_pipeline` ────────────────────────────────
def omitido(pc: PipelineCtx, nombre: str) -> dict:
    """Evento `phase` del agente saltado por la matriz tipo × etapa o por el perfil
    (el tablero lo muestra)."""
    motivo = (f"no aplica al perfil {pc.profile.nombre}" if nombre not in pc.profile.agentes
              else f"no aplica a {pc.tipo_etapa}")
    return {"kind": "phase", "name": nombre, "msg": f"omitido: {motivo}"}


async def sync_call(pc: PipelineCtx, fn, *a, **kw):
    """Función SÍNCRONA (tool/lote): en modo DAG corre en un hilo para no bloquear el
    event loop (la otra rama —agentes ADK— avanza a la vez); en secuencial, inline."""
    if pc.dag:
        return await asyncio.to_thread(fn, *a, **kw)
    return fn(*a, **kw)


async def t_call(pc: PipelineCtx, fn, fname: str, agent: str = "pipeline", **kwargs) -> tuple[list[dict], Any]:
    """`_tool` (shim sobre `state`) — en un hilo si DAG."""
    if pc.dag:
        return await asyncio.to_thread(_tool, fn, fname, pc.state, agent, **kwargs)
    return _tool(fn, fname, pc.state, agent, **kwargs)


async def agent_call(pc: PipelineCtx, agent, msg, output_key: str | None = None):
    # Evento `transfer` (orquestador → sub-agente): es lo que el grafo del
    # frontend usa para iluminar el nodo del agente (buildTrace → ev.to). En
    # el flujo determinista el "orquestador" es el código; sin este transfer,
    # los agentes que solo usan grounding (web/news/entity/person) no emiten
    # tool_calls y el grafo nunca los encendería.
    nm = getattr(agent, "name", "agent")
    yield {"kind": "transfer", "from": "orch", "to": nm, "agent": "orch",
           "msg": f"orquestador delega a {nm}"}
    if not pc.dag:
        async for e in pc.run_agent(agent, msg, pc.state, pc.ss, pc.user_id, pc.metrics):
            yield e
        return
    # DAG: sesión aislada + merge SOLO de lo que el agente escribió (otra rama pudo
    # escribir otras claves mientras tanto) + métricas sumadas en el event loop.
    evs_a, ft, delta_a, lm_a = await pc.run_agent_delta(agent, msg, pc.state, pc.ss, pc.user_id, output_key)
    _aplicar_delta(pc.state, delta_a)
    pc.state["_last_agent_final"] = ft
    for e in evs_a:
        yield e
    yield {"kind": "_metrics_delta", "agent": nm, "metrics": lm_a}


def flags_from_senales(pc: PipelineCtx, senales, fuente):
    """Loop add_contextual_flag por cada señal devuelta por query_oece_perfil."""
    out = []
    for s in (senales or []):
        if not isinstance(s, dict):
            continue
        evs, _ = _tool(pc.T.add_contextual_flag, "add_contextual_flag", pc.state,
                       regla=s.get("regla") or "senal_oece", severidad=s.get("severidad") or "media",
                       evidencia=s.get("evidencia") or "", norma=s.get("norma") or "", fuente=fuente)
        out.extend(evs)
    return out


async def retry_if_empty(pc: PipelineCtx, agent, msg, state_key, default_stub):
    """Tail del guardrail (sin la primera corrida): si `state_key` quedó VACÍO,
    reintenta 1× con instrucción explícita; si sigue vacío, deja un default tipado."""
    if _is_empty_output(pc.state.get(state_key)):
        yield {"kind": "warn", "name": state_key, "msg": f"{state_key} vacío — reintento"}
        pc.state.pop(state_key, None)
        pc.state.pop("_last_agent_final", None)
        async for e in agent_call(pc, agent, msg + " (REINTENTO: la pasada anterior salió VACÍA. "
                              "Devolvé SIEMPRE el JSON COMPLETO del schema pedido; si no hay "
                              "datos, devolvé las listas vacías + un campo que lo indique. "
                              "NUNCA respondas vacío.)", state_key):
            yield e
        if _is_empty_output(pc.state.get(state_key)):
            pc.state[state_key] = default_stub
            yield {"kind": "warn", "name": state_key,
                   "msg": f"{state_key} vacío tras reintento — default tipado"}


async def agent_with_retry(pc: PipelineCtx, agent, msg, state_key, default_stub):
    """Corre un sub-agente y, si su `state_key` quedó VACÍO (quirk de grounding),
    reintenta 1× con instrucción explícita; si sigue vacío, deja un default
    tipado (degradación honesta) para no dejar la sección en blanco sin aviso."""
    async for e in agent_call(pc, agent, msg, state_key):
        yield e
    async for e in retry_if_empty(pc, agent, msg, state_key, default_stub):
        yield e


def news_vacio(pc: PipelineCtx):
    """True si news_research quedó vacío (quirk Gemini+google_search: tokens al
    grounding/thinking, texto final '')."""
    nr = pc.state.get("news_research")
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


# ── 2. Compliance (reglas duras + crea alerta) ──
async def fase_compliance(pc: PipelineCtx):
    # Siempre está en la matriz (crea la alerta que persiste todo lo demás); igual se respeta la lista.
    if pc.perm("compliance"):
        yield {"kind": "phase", "name": "compliance", "msg": "evaluando reglas duras"}
        async for e in agent_call(pc, pc.A.compliance_agent,
                              f"Evalúa la convocatoria OCID {pc.ocid} contra las 3 reglas duras y crea la alerta.",
                              "compliance_result"):
            yield e
    else:
        yield omitido(pc, "compliance")


# ── 3. Document parser ──
async def fase_parser(pc: PipelineCtx):
    if not pc.perm("document_parser"):
        yield omitido(pc, "document_parser")
        return
    yield {"kind": "phase", "name": "document_parser", "msg": "procesando documentos SEACE"}
    _lote_ok = False
    if pc.seleccionar_documentos is not None and pc.parse_documentos_lote is not None:
        # WS D · selección DETERMINISTA por prioridad del perfil (sin LLM) + OCR una sola
        # vez (documentos_texto por sha256, páginas con marcador) + extracción con el
        # schema base + bloque del perfil. Los omitidos por tope quedan en `recortes`.
        yield {"kind": "transfer", "from": "orch", "to": "document_parser_agent", "agent": "orch",
               "msg": "orquestador delega a document_parser_agent (lote determinista)"}
        try:
            _doc_ids = pc.state.get("doc_ids")
            _doc_ids = [str(d) for d in _doc_ids] if isinstance(_doc_ids, (list, tuple)) and _doc_ids else None
            elegidos, omitidos = await sync_call(
                pc, pc.seleccionar_documentos,
                pc.ocid, pc.state.get("ocds") or {}, pc.state.get("doc_urls") or {},
                pc.profile.doc_prioridad, pc.profile.parse_max_docs,
                **_kwargs_soportados(pc.seleccionar_documentos, doc_ids=_doc_ids))
            if _doc_ids and "doc_ids" not in _kwargs_soportados(pc.seleccionar_documentos, doc_ids=_doc_ids):
                _ids = set(_doc_ids)
                _antes = len(elegidos)
                elegidos = [d for d in elegidos if str((d or {}).get("id")) in _ids]
                if len(elegidos) < _antes:
                    _registrar_recorte(pc.state, "doc_select.doc_ids", len(_ids), _antes - len(elegidos))
            if pc.recorte_seleccion is not None:
                _rec = pc.recorte_seleccion(elegidos, omitidos or [], pc.profile.parse_max_docs)
                if _rec:
                    pc.state.setdefault("recortes", []).append(_rec)
            else:
                for om in (omitidos or []):
                    _registrar_recorte(pc.state, "doc_select", pc.profile.parse_max_docs, om)
            yield {"agent": "document_parser_agent", "kind": "tool_call", "name": "seleccionar_documentos",
                   "args": {"prioridad": list(pc.profile.doc_prioridad), "max_docs": pc.profile.parse_max_docs}}
            yield {"agent": "document_parser_agent", "kind": "tool_result", "name": "seleccionar_documentos",
                   "result_preview": {"elegidos": [{k: (d or {}).get(k) for k in ("id", "tipo", "titulo", "formato")}
                                                   for d in elegidos],
                                      "n_omitidos": len(omitidos or [])}}
            if elegidos:
                yield {"agent": "document_parser_agent", "kind": "tool_call", "name": "parse_documentos_lote",
                       "args": {"n_docs": len(elegidos), "bloque": pc.profile.parser_bloque}}
                res = await sync_call(
                    pc, pc.parse_documentos_lote, pc.state, elegidos,
                    **_kwargs_soportados(pc.parse_documentos_lote, parser_bloque=pc.profile.parser_bloque,
                                         prioridad=pc.profile.doc_prioridad))
                yield {"agent": "document_parser_agent", "kind": "tool_result",
                       "name": "parse_documentos_lote", "result_preview": _truncate_result(res)}
                _raw = pc.state.get("parser_raw_consolidated") or {}
                _lote_ok = isinstance(_raw, dict) and bool(
                    _raw.get("items_consolidados") or _raw.get("bloque_servicio") or _raw.get("bloque_obra")
                    or _raw.get("bloque_sustento_directa") or _raw.get("requerimiento_tecnico_detallado")
                    or _raw.get("firmantes_consolidados") or pc.state.get("documentos_texto"))
            else:
                yield {"kind": "warn", "name": "document_parser",
                       "msg": "sin documentos seleccionables para el lote — se intenta el flujo del agente"}
        except Exception as e:
            yield {"kind": "warn", "name": "document_parser",
                   "msg": f"lote de documentos falló ({str(e)[:160]}) — fallback al agente"}
    if _lote_ok:
        # WS D: parse_documentos_lote ya escribió parser_raw_consolidated, documentos_texto,
        # document_analysis, estudio_mercado y contrato_final → la fase termina acá, sin LLM.
        _n_docs = len(pc.state.get("documentos_texto") or {}) if isinstance(pc.state.get("documentos_texto"), dict) else 0
        _n_items = len((pc.state.get("parser_raw_consolidated") or {}).get("items_consolidados") or [])
        yield {"kind": "info", "name": "document_parser",
               "msg": f"lote determinista: {_n_docs} documento(s) con texto, {_n_items} ítem(s); sin agente LLM"}
    else:
        # Fallback (lote vacío o WS D ausente): el agente LLM llama parse_documentos_seleccionados
        # (una sola vez) o, en la versión legacy, list_documents + parse_document_pdf.
        async for e in agent_call(pc, pc.A.document_parser_agent,
                              f"Procesa los documentos publicados en SEACE para el OCID {pc.ocid}. PRIORIZA Bases "
                              f"Administrativas/Integradas, Resumen Ejecutivo y Archivos del contrato; extrae el "
                              f"REQUERIMIENTO técnico por ítem. OBLIGATORIO: llamá la tool de parseo al menos una vez.",
                              "document_analysis"):
            yield e

    # ── 3.5 Backfill determinista de ítems: la extracción AUTORITATIVA de la tool
    # (parser_raw_consolidated) gana sobre el placeholder genérico que el LLM a veces
    # escribe. Va ANTES de legal/market para que toda la cadena reciba los ítems reales.
    _bf = _backfill_document_analysis(pc.state)
    print(f"[driver] document_analysis backfill · {_bf}", flush=True)
    if "BACKFILL" in _bf:
        yield {"kind": "warn", "name": "document_parser",
               "msg": f"ítems reales recuperados de la extracción del parser ({_bf})"}

    # ── 3.6 Sanitización por LLM (capa 2): lista canónica única de productos
    # Sobre los items crudos acumulados cross-doc, el LLM decide (no genera): normaliza
    # `numero`, funde variantes del mismo bien físico por OCR ruidoso, descarta la cabecera
    # del contrato colándose. El merge de campos lo hace el código sobre los crudos. Fail-safe:
    # si el LLM falla o devuelve cobertura inválida, conserva los crudos (no rompe nada).
    raw = pc.state.get("parser_raw_consolidated") or {}
    raw_items = raw.get("items_consolidados") or []
    if len(raw_items) >= 2:
        _tender_obj = (pc.state.get("ocds") or {}).get("tender") or {}
        _objeto_contrato = (_tender_obj.get("description") or _tender_obj.get("title") or "").strip()
        _antes_san = len(raw_items)
        _sanitized = await sync_call(pc, pc.T.sanitize_items_with_llm, raw_items, _objeto_contrato)
        if _sanitized and len(_sanitized) < _antes_san:
            print(f"[driver] sanitize: {_antes_san}→{len(_sanitized)} ítems (canónico único)", flush=True)
            raw["items_consolidados"] = _sanitized
            pc.state["parser_raw_consolidated"] = raw
            # Propagar al document_analysis del agente (que es lo que renderiza el front).
            _da = pc.state.get("document_analysis")
            if isinstance(_da, dict):
                _da["items_consolidados"] = _sanitized
                pc.state["document_analysis"] = _da
            yield {"kind": "warn", "name": "document_parser",
                   "msg": f"ítems canónicos tras sanitización por LLM: {len(_sanitized)} (de {_antes_san} crudos)"}
        else:
            print(f"[driver] sanitize: {_antes_san} ítems (sin cambios por LLM)", flush=True)


# ── 4. Análisis legal + persistir banderas documentales ──
async def fase_legal(pc: PipelineCtx):
    if not pc.perm("document_legal_analyst"):
        yield omitido(pc, "document_legal_analyst")
        return
    yield {"kind": "phase", "name": "legal", "msg": "análisis legal del requerimiento"}
    async for e in agent_call(pc, pc.A.document_legal_analyst_agent,
                          f"Analiza legalmente el documento extraído para el OCID {pc.ocid} (perfil "
                          f"{pc.profile.nombre}: vectores '{pc.profile.legal_vectores}'). Llamá "
                          f"read_document_analysis() para obtener el JSON real del parser antes de emitir banderas.",
                          "legal_analysis"):
        yield e
    _vev = pc.validar("legal_analysis", "LegalOutput")
    if _vev:
        yield _vev
    evs, _ = await t_call(pc, pc.T.persist_doc_flags_as_banderas, "persist_doc_flags_as_banderas", alerta_codigo=pc.alerta_codigo)
    for e in evs:
        yield e


# ── 5. Mercado (estrategia según perfil: goods_retail | historico_seace |
#      presupuesto_obra | cotizaciones) ──
async def fase_market(pc: PipelineCtx):
    if not pc.perm("market"):
        yield omitido(pc, "market")
        return
    yield {"kind": "phase", "name": "market",
           "msg": f"validando precios de mercado ({pc.profile.market_estrategia})"}
    # El análisis de mercado corre como tools (no sub-agente), pero igual debe
    # iluminar el nodo "market" del grafo → transfer explícito orquestador→market.
    yield {"kind": "transfer", "from": "orch", "to": "market_price_agent", "agent": "orch",
           "msg": "orquestador delega a market_price_agent"}
    _mercado_ok = False
    if pc.analizar_mercado is not None:
        # WS M · una sola entrada por estrategia; URLs solo desde grounding_metadata;
        # mediana/Δ%/veredicto en código; `sin_dato` cuando no hay base de comparación.
        yield {"agent": "market_price_agent", "kind": "tool_call", "name": "analizar_mercado",
               "args": {"estrategia": pc.profile.market_estrategia}}
        try:
            res = await sync_call(pc, pc.analizar_mercado, pc.state, pc.profile.market_estrategia)
            _mercado_ok = True
        except Exception as e:
            res = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
        yield {"agent": "market_price_agent", "kind": "tool_result",
               "name": "analizar_mercado", "result_preview": _truncate_result(res)}
        if not _mercado_ok:
            yield {"kind": "warn", "name": "market",
                   "msg": f"analizar_mercado({pc.profile.market_estrategia}) falló — fallback al fan-out retail"}
    if not _mercado_ok:
        # Flujo vigente (goods_retail): build_market_input + fan-out sharded con google_search.
        evs, _ = await t_call(pc, pc.T.build_market_input, "build_market_input", agent="market_price_agent", ocid=pc.ocid)
        for e in evs:
            yield e
        evs, _ = await t_call(pc, pc.T.analyze_market_sharded, "analyze_market_sharded", agent="market_price_agent", ocid=pc.ocid)
        for e in evs:
            yield e
    evs, _ = await t_call(pc, pc.T.persist_market_flags_as_banderas, "persist_market_flags_as_banderas",
                      agent="market_price_agent", alerta_codigo=pc.alerta_codigo)
    for e in evs:
        yield e


# ── 6. Proveedor ganador: perfil OECE + SUNAT ──
async def fase_proveedor(pc: PipelineCtx):
    yield {"kind": "phase", "name": "proveedor", "msg": "perfilando al proveedor adjudicado"}
    evs, gan = await t_call(pc, pc.T.get_ganador, "get_ganador", ocid=pc.ocid)
    for e in evs:
        yield e
    ganador = (gan or {}).get("ganador") or {}
    ruc = (ganador.get("ruc") or "").strip()
    pc.ctx.update(ganador=ganador, ruc=ruc, razon=ganador.get("razon_social") or "",
               entidad=(gan or {}).get("entidad") or {}, postores=(gan or {}).get("todos_postores") or [])
    fuente_oece = f"https://contratacionesabiertas.oece.gob.pe/proceso/{pc.ocid}"
    # El perfil OECE/SUNAT alimenta a web_research, person_network y compliance_extended:
    # si la matriz no incluye ninguno, no se consulta (get_ganador sí, para el dictamen).
    _investiga_proveedor = any(pc.perm(a) for a in ("web_research", "person_network", "compliance_extended"))
    if ruc and _investiga_proveedor:
        evs, perfil = await t_call(pc, pc.T.query_oece_perfil, "query_oece_perfil", ruc=ruc)
        for e in evs:
            yield e
        for e in flags_from_senales(pc, (perfil or {}).get("senales"), fuente_oece):
            yield e
        evs, sunat = await t_call(pc, pc.T.query_sunat_decolecta, "query_sunat_decolecta", ruc=ruc)
        for e in evs:
            yield e
        if isinstance(sunat, dict) and (sunat.get("error") or sunat.get("found") is False):
            evs, _ = await t_call(pc, pc.T.query_edad_ciiu_web, "query_edad_ciiu_web", ruc=ruc, razon_social=pc.ctx["razon"])
            for e in evs:
                yield e
        evs, _ = await t_call(pc, pc.T.read_sunat_profile, "read_sunat_profile")
        for e in evs:
            yield e


# ── 6-8. Investigación: empresa ∥ prensa ∥ funcionarios ──
async def fase_research(pc: PipelineCtx):
    ruc, razon, entidad = pc.ctx["ruc"], pc.ctx["razon"], pc.ctx["entidad"]
    # Objeto del proceso (lo usa el mensaje de prensa).
    tender = (pc.state.get("ocds") or {}).get("tender") or {}
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
        distinto del retry_if_empty genérico). Reusado por ambos caminos."""
        if news_vacio(pc):
            yield {"kind": "warn", "name": "news_research", "msg": "prensa vacía — reintento"}
            pc.state.pop("news_research", None)
            pc.state.pop("_last_agent_final", None)
            async for e in agent_call(
                pc, pc.A.news_research_agent,
                _news_msg + " (REINTENTO: la pasada anterior salió vacía. Devolvé SIEMPRE el JSON "
                "completo; si no hay prensa, noticias:[] con sin_menciones_relevantes:true y un "
                "resumen_ejecutivo que lo diga. NUNCA respondas vacío.)", "news_research"):
                yield e
            if news_vacio(pc):
                pc.state["news_research"] = {
                    "noticias": [], "sin_menciones_relevantes": True, "queries_realizadas": [],
                    "resumen_ejecutivo": "No se hallaron menciones de prensa materiales sobre el "
                    "proveedor, la entidad o el objeto de la contratación.",
                    "_note": "default por salida vacía del news_research_agent tras reintento",
                }
                yield {"kind": "warn", "name": "news_research",
                       "msg": "prensa vacía tras reintento — default sin_menciones"}

    _specs_todas = [
        (pc.A.web_research_agent, _web_msg, "web_research"),
        (pc.A.news_research_agent, _news_msg, "news_research"),
        (pc.A.entity_personnel_agent, _entity_msg, "entity_personnel"),
    ]
    _specs = [sp for sp in _specs_todas if pc.perm(sp[2])]
    for _ag, _m, _k in _specs_todas:
        if not pc.perm(_k):
            yield omitido(pc, _k)

    if not _specs:
        pass  # los 3 omitidos por la matriz: nada que investigar
    elif pc.parallel_research:
        # ── 6-8 PARALELO: empresa ∥ prensa ∥ funcionarios. Los 3 son grounding-only e
        # independientes → correrlos concurrentes recorta ~3×latencia a ~1×la-del-más-lento.
        yield {"kind": "phase", "name": "research_parallel",
               "msg": "investigación paralela: " + " ∥ ".join(sp[2] for sp in _specs)}
        _base = dict(pc.state)  # snapshot read-only para sembrar las sesiones aisladas
        # Transfers en vivo → encienden los nodos del grafo a la vez.
        for ag, _m, _k in _specs:
            nm = getattr(ag, "name", "agent")
            yield {"kind": "transfer", "from": "orch", "to": nm, "agent": "orch",
                   "msg": f"orquestador delega a {nm} (paralelo)"}
        _results = await asyncio.gather(
            *[pc.run_agent_isolated(ag, msg, _base, ok, pc.ss, pc.user_id) for ag, msg, ok in _specs],
            return_exceptions=True)
        for (ag, _m, _k), res in zip(_specs, _results):
            nm = getattr(ag, "name", "agent")
            if isinstance(res, Exception):
                yield {"kind": "error", "agent": nm, "detail": f"parallel run: {str(res)[:200]}"}
                continue
            evs_a, _ft, delta_a, lm_a = res
            pc.state.update(delta_a)             # SOLO el output_key del agente (merge seguro)
            for e in evs_a:
                yield e
            # Suma tokens/costo de este sub-run al global (lo hace el driver, en el event loop).
            yield {"kind": "_metrics_delta", "agent": nm, "metrics": lm_a}
        pc.state["_last_agent_final"] = None
        # Guardrails de vacío (raros) — secuenciales tras el join.
        if pc.perm("web_research"):
            async for e in retry_if_empty(pc, pc.A.web_research_agent, _web_msg, "web_research", _web_stub):
                yield e
        if pc.perm("news_research"):
            async for e in _news_guardrail():
                yield e
        if pc.perm("entity_personnel"):
            async for e in retry_if_empty(pc, pc.A.entity_personnel_agent, _entity_msg, "entity_personnel", _entity_stub):
                yield e
    else:
        # ── 6-8 SECUENCIAL (flujo original; rollback con PARALLEL_RESEARCH=0) ──
        if pc.perm("web_research"):
            async for e in agent_with_retry(pc, pc.A.web_research_agent, _web_msg, "web_research", _web_stub):
                yield e
        if pc.perm("news_research"):
            yield {"kind": "phase", "name": "news", "msg": "buscando cobertura de prensa"}
            async for e in agent_call(pc, pc.A.news_research_agent, _news_msg, "news_research"):
                yield e
            async for e in _news_guardrail():
                yield e
        if pc.perm("entity_personnel"):
            yield {"kind": "phase", "name": "entity_personnel", "msg": "descubriendo funcionarios de la entidad"}
            async for e in agent_with_retry(pc, pc.A.entity_personnel_agent, _entity_msg, "entity_personnel", _entity_stub):
                yield e

    # Validación pydantic (WS M) de las salidas de investigación; no descarta la salida,
    # anota en `descartes` y avisa.
    for _k, _sn in (("web_research", "WebResearchOutput"), ("news_research", "NewsOutput"),
                    ("entity_personnel", "EntityPersonnelOutput")):
        if pc.perm(_k):
            _vev = pc.validar(_k, _sn)
            if _vev:
                yield _vev

    # ── Lookup de funcionarios descubiertos (común a ambos caminos) ──
    func_desig = (pc.state.get("entity_personnel") or {})
    funcionarios = func_desig.get("funcionarios_designados") if isinstance(func_desig, dict) else None
    if funcionarios:
        personas_f = [{"id": f"func_{i}", "dni": (p.get("dni") or ""), "nombre": p.get("nombre") or p.get("nombre_completo") or "",
                       "rol": p.get("cargo") or "funcionario"} for i, p in enumerate(funcionarios) if isinstance(p, dict)]
        if personas_f:
            evs, _ = await t_call(pc, pc.T.batch_person_lookup, "batch_person_lookup", personas=personas_f)
            for e in evs:
                yield e


# ── 9. Red de personas (RNP ganador + postores + batch + puerta giratoria) ──
async def fase_person_network(pc: PipelineCtx):
    if not pc.perm("person_network"):
        yield omitido(pc, "person_network")
        return
    ganador, ruc, razon, entidad, postores = pc.ctx["ganador"], pc.ctx["ruc"], pc.ctx["razon"], pc.ctx["entidad"], pc.ctx["postores"]
    yield {"kind": "phase", "name": "person_network", "msg": "mapeando la red de personas"}
    socios_personas: list[dict] = []
    if ruc:
        evs, rnp = await t_call(pc, pc.T.query_rnp_empresa, "query_rnp_empresa", ruc=ruc)
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
            evs, _ = await t_call(pc, pc.T.query_rnp_empresa, "query_rnp_empresa", ruc=pr)
            for e in evs:
                yield e
    # batch con todas las personas (ganador/socios/firmantes)
    da = pc.state.get("document_analysis") or {}
    firmantes = (da.get("firmantes_consolidados") or da.get("firmantes") or []) if isinstance(da, dict) else []
    personas_all = list(socios_personas)
    if ganador.get("dni_persona_natural"):
        personas_all.insert(0, {"id": "gerente", "dni": ganador["dni_persona_natural"], "nombre": razon, "rol": "titular"})
    for i, f in enumerate(firmantes):
        if isinstance(f, dict) and (f.get("dni") or f.get("nombre_completo")):
            personas_all.append({"id": f"firmante_{i}", "dni": f.get("dni") or "",
                                 "nombre": f.get("nombre_completo") or "", "rol": "firmante"})
    if personas_all:
        evs, _ = await t_call(pc, pc.T.batch_person_lookup, "batch_person_lookup", personas=personas_all)
        for e in evs:
            yield e
    # puerta giratoria / aporte (si hay DNI de gerente)
    dni_ger = ganador.get("dni_persona_natural") or ""
    if dni_ger and entidad.get("ruc"):
        evs, _ = await t_call(pc, pc.T.detect_puerta_giratoria, "detect_puerta_giratoria",
                          dni_gerente=dni_ger, entidad_contratante_ruc=entidad.get("ruc"))
        for e in evs:
            yield e
    evs, _ = await t_call(pc, pc.T.read_person_network_context, "read_person_network_context")
    for e in evs:
        yield e
    _person_msg = (f"Analiza la red de personas para el OCID {pc.ocid}. El contexto (RNP + datos Perú + "
                   f"postores + firmantes + autoridades) está pre-cargado en tu instrucción.")
    async for e in agent_with_retry(pc, pc.A.person_network_agent, _person_msg, "person_network",
                                     {"vinculos_detectados": [], "sin_red_detectada": True,
                                      "_note": "person_network sin vínculos tras reintento"}):
        yield e
    _vev = pc.validar("person_network", "PersonNetworkOutput")
    if _vev:
        yield _vev


# ── 10. Compliance extendido (12 reglas + banderas de juicio del 7.7) ──
async def fase_compliance_ext(pc: PipelineCtx):
    # Parámetros de perfil para las reglas (WS V los acepta como kwargs; hasta entonces las
    # reglas los leen de state["perfil"] o los ignoran).
    _reglas_kw = {"reglas_activas": pc.profile.reglas_activas, "topes_uit": pc.profile.topes_uit}
    if pc.perm("compliance_extended"):
        yield {"kind": "phase", "name": "compliance_extended", "msg": "cumplimiento normativo extendido"}
        async for e in agent_call(pc, pc.A.compliance_extended_agent,
                              f"Corre los chequeos extendidos para el OCID {pc.ocid} y evalúa contextualmente "
                              f"(capacidad operativa, conflicto de interés funcionario↔empresa) con los datos "
                              f"inyectados. Emití banderas de juicio SOLO si la evidencia las respalda.",
                              "compliance_extended"):
            yield e
    else:
        yield omitido(pc, "compliance_extended")
        # Perfil sin el agente extendido (p. ej. `otros`): las reglas ACTIVAS del perfil
        # igual corren, en CÓDIGO (sin LLM, sin banderas de juicio). Las 3 duras ya corrieron
        # en compliance; acá van las extendidas cuyo tool `check_<regla>_rule` exista.
        _duras = ("unique_bidder", "sanctioned_provider", "non_competitive_process")

        def _regla_fn(slug: str):
            if isinstance(pc.reglas_por_nombre, dict) and callable(pc.reglas_por_nombre.get(slug)):
                return pc.reglas_por_nombre[slug]
            fn = getattr(pc.T, f"check_{slug}_rule", None)
            return fn if callable(fn) else None
        _reglas_codigo = [(r, _regla_fn(r)) for r in sorted(pc.profile.reglas_activas) if r not in _duras]
        _reglas_codigo = [(r, fn) for r, fn in _reglas_codigo if fn is not None]
        if _reglas_codigo:
            yield {"kind": "phase", "name": "compliance_rules",
                   "msg": f"reglas del perfil {pc.profile.nombre} en código (sin LLM): "
                          + ", ".join(r for r, _ in _reglas_codigo)}
            for r, fn in _reglas_codigo:
                evs, _ = await t_call(pc, fn, getattr(fn, "__name__", f"check_{r}_rule"),
                                  agent="compliance_extended_agent", ocid=pc.ocid,
                                  **_kwargs_soportados(fn, **_reglas_kw))
                for e in evs:
                    yield e
    # El cruce RAG y la persistencia de banderas corren SIEMPRE (son del driver, no del agente):
    # cruzan lo acumulado por compliance/parser/market aunque el extendido se haya omitido.
    # En contratos reales el agente flash-lite se RENDÍA tras las 12 reglas (no llegaba a llamar
    # evaluate_normative_compliance) y `normative_compliance` quedaba vacío. Determinista:
    # evaluate_normative_compliance puebla state['normative_compliance'] cruzando TODAS las
    # banderas acumuladas (12 reglas + parser + market + person + juicio) contra el RAG OECE.
    evs, _ = await t_call(pc, pc.T.evaluate_normative_compliance, "evaluate_normative_compliance", ocid=pc.ocid,
                      **_kwargs_soportados(pc.T.evaluate_normative_compliance, **_reglas_kw))
    for e in evs:
        yield e
    # persistir cualquier pending_flag acumulado
    evs, _ = await t_call(pc, pc.T.persist_alert_from_flags, "persist_alert_from_flags", ocid=pc.ocid)
    for e in evs:
        yield e


# ── 11-13. Checkpoint + dictamen + verificación + persist final ──
async def fase_dictamen(pc: PipelineCtx):
    yield {"kind": "phase", "name": "persist_checkpoint", "msg": "checkpoint del análisis"}
    evs, _ = await t_call(pc, pc.T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=pc.alerta_codigo)
    for e in evs:
        yield e

    if not pc.perm("report_writer"):
        yield omitido(pc, "report_writer")
        evs, _ = await t_call(pc, pc.T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=pc.alerta_codigo)
        for e in evs:
            yield e
        pc.state["_final_response"] = "Análisis completado (sin dictamen: no aplica a la etapa)."
        return
    yield {"kind": "phase", "name": "report_writer", "msg": "escribiendo dictamen periodístico"}
    _validaciones = _bloque_validaciones(pc.state) + _bloque_recortes(pc.state)
    _etapa = str(pc.clas.get("etapa") or "")
    _tipo = str(pc.clas.get("tipo") or "")
    _breve = ("" if _etapa not in ("desierta", "cancelada", "nula") else
              f" El proceso quedó {_etapa}: dictamen BREVE (causal, contexto y lo que sí se verificó); "
              f"no especules sobre proveedores ni ejecución.")
    if pc.profile.nombre == "otros" and _tipo in ("directa", "convenio"):
        _breve += (f" Contratación {_tipo}: dictamen BREVE centrado en la causal invocada, el expediente de "
                   f"sustento (informes, acto resolutivo, cotizaciones) y lo verificado; sin especular.")
    _secciones = ("\n\nSECCIONES DEL DICTAMEN (perfil " + pc.profile.nombre + "), en este orden: "
                  + " · ".join(pc.profile.dictamen_secciones) + ".")
    async for e in agent_call(pc, pc.A.report_writer_agent,
                          f"Escribí el dictamen periodístico para la alerta {pc.alerta_codigo} usando la data en "
                          f"session.state. OBLIGATORIO PASO 1: llamá get_dictamen_context() antes de escribir."
                          + _breve + _secciones + _validaciones, "final_dictamen"):
        yield e

    # Si el output_key no capturó el dictamen pero el agente devolvió texto, lo inyectamos.
    def _capture_dictamen():
        if not pc.state.get("final_dictamen") and (pc.state.get("_last_agent_final") or "").strip():
            pc.state["final_dictamen"] = pc.state["_last_agent_final"].strip()

    _capture_dictamen()

    # Guardrail: si el dictamen salió malformado (degeneración del modelo —
    # README alucinado / tokens de control / cabecera perdida), reintentar UNA vez
    # con contexto compacto; si aún falla, sanitizar como último recurso.
    probs = _dictamen_problems(pc.state.get("final_dictamen"))
    if probs:
        # Sanitizamos el 1er intento ANTES de reintentar, para nunca terminar peor.
        attempt1_clean = _sanitize_dictamen(pc.state.get("final_dictamen") or "")
        yield {"kind": "warn", "name": "report_writer",
               "msg": f"dictamen malformado {probs} — reintento con contexto compacto"}
        pc.state["_dictamen_compact"] = True
        pc.state.pop("final_dictamen", None)
        pc.state.pop("_last_agent_final", None)
        async for e in agent_call(
            pc, pc.A.report_writer_agent,
            f"REINTENTO. El intento anterior salió malformado. Tu RESPUESTA FINAL debe ser el "
            f"dictamen periodístico ENTERO y AUTOCONTENIDO para la alerta {pc.alerta_codigo}: NO "
            f"continúes ningún borrador ni asumas texto previo — reescribí TODO desde el título. "
            f"EMPEZÁ con el título (encabezado markdown '## …') seguido de las secciones (Resumen "
            f"ejecutivo, Hechos clave, etc.). OBLIGATORIO PASO 1: llamá get_dictamen_context() "
            f"antes de escribir. NO incluyas bloques de código, instrucciones de instalación, "
            f"licencias ni texto ajeno al dictamen." + _validaciones, "final_dictamen",
        ):
            yield e
        _capture_dictamen()
        pc.state.pop("_dictamen_compact", None)
        probs2 = _dictamen_problems(pc.state.get("final_dictamen"))
        if not probs2:
            yield {"kind": "info", "name": "report_writer",
                   "msg": "reintento OK — dictamen bien formado"}
        else:
            # Ambas pasadas fallaron: quedarse con la MEJOR sanitizada.
            retry_clean = _sanitize_dictamen(pc.state.get("final_dictamen") or "")
            best = retry_clean if len(retry_clean) >= len(attempt1_clean) else attempt1_clean
            # Si quedó sin cabecera, anteponer un título mínimo (no inventa hechos).
            if best and not best.lstrip().startswith("#"):
                ocds = pc.state.get("ocds") if isinstance(pc.state.get("ocds"), dict) else {}
                objeto = ((ocds.get("tender") or {}).get("title") or "").strip()
                titulo = f"## Dictamen periodístico — {pc.alerta_codigo}"
                if objeto:
                    titulo += f": {objeto[:120]}"
                best = titulo + "\n\n" + best
            pc.state["final_dictamen"] = best
            yield {"kind": "warn", "name": "report_writer",
                   "msg": f"reintento aún {probs2} — sanitizado a {len(best)} chars"}

    # ── 12.5 Verificación determinista del dictamen (WS V): banderas citadas que no existen
    #      en `banderas`, URLs sin respaldo en ningún output → `verificacion_dictamen` en state
    #      (persist lo guarda en analisis_full) y warn si quedó degradado.
    #      Revisión lote 1 (T9): ya no solo avisa. RUC/DNI sin respaldo se sustituyen por
    #      "[… no verificado]", las URLs inventadas (incluidas gob.pe que no resuelven) se
    #      quitan y TODO DNI se enmascara antes de persistir (`tools.verify.sanitizar_dictamen`).
    if pc.verificar_dictamen is not None and pc.state.get("final_dictamen"):
        try:
            _ver = pc.verificar_dictamen(pc.state["final_dictamen"], pc.state)
            pc.state["verificacion_dictamen"] = _ver
            _v = _ver or {}
            _partes = [f"{len(_v.get(k) or [])} {lbl}" for k, lbl in (
                ("banderas_no_existentes", "bandera(s) inexistentes"), ("urls_no_respaldadas", "URL(s) sin respaldo"),
                ("rucs_no_respaldados", "RUC sin respaldo"), ("dnis_no_respaldados", "DNI sin respaldo")) if _v.get(k)]
            if _v.get("degradado") or _partes:
                yield {"kind": "warn", "name": "report_writer",
                       "msg": "dictamen: " + (", ".join(_partes) or "sanitizado") + (" — degradado" if _v.get("degradado") else "")}
            try:
                from tools.verify import sanitizar_dictamen as _sanitizar_dictamen
            except (ImportError, AttributeError):
                _sanitizar_dictamen = None
            if _sanitizar_dictamen is not None:
                _md2, _cambios = _sanitizar_dictamen(pc.state["final_dictamen"], _v)
                if isinstance(_v, dict):
                    _v["sanitizacion"] = _cambios
                if _cambios.get("modificado"):
                    pc.state["final_dictamen"] = _md2
                    for _k, _lbl in (("rucs_sustituidos", "ruc_no_verificado"), ("dnis_sustituidos", "dni_no_verificado"),
                                     ("urls_eliminadas", "url_no_verificable")):
                        for _x in _cambios.get(_k) or []:
                            _registrar_descarte(pc.state, "dictamen", _lbl, _x)
                    _res = [f"{len(_cambios.get(k) or [])} {lbl}" for k, lbl in (
                        ("rucs_sustituidos", "RUC sustituido(s)"), ("dnis_sustituidos", "DNI sustituido(s)"),
                        ("urls_eliminadas", "URL(s) eliminada(s)")) if _cambios.get(k)]
                    if _cambios.get("dnis_enmascarados"):
                        _res.append(f"{_cambios['dnis_enmascarados']} DNI enmascarado(s)")
                    yield {"kind": "info", "name": "report_writer",
                           "msg": "dictamen sanitizado: " + ", ".join(_res)}
        except Exception as e:
            yield {"kind": "warn", "name": "report_writer", "msg": f"verificar_dictamen falló: {str(e)[:160]}"}

    # ── 13. Persist final (con dictamen) ──
    evs, _ = await t_call(pc, pc.T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=pc.alerta_codigo)
    for e in evs:
        yield e
    pc.state["_final_response"] = (pc.state.get("final_dictamen") or "")[:2000] or "Análisis completado."
