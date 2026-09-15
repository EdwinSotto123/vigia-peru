"""Tools del dominio: state_loaders."""

from tools._core import *  # noqa: F401,F403

def _compact_ocds(ocds):
    """Proyección del OCDS para el dictamen: entidad, monto, ganador, postores,
    ítems raíz y documentos (conteo + títulos). No lleva `parties`/`planning`/
    `sources` crudos (inflan el contexto), pero SÍ los datos que el writer necesita
    para no inventar: `numberOfTenderers`, `tenderers`, `items`, `documents`."""
    if not isinstance(ocds, dict):
        return ocds
    tender = ocds.get("tender") or {}
    buyer = ocds.get("buyer") or {}
    awards = ocds.get("awards") or []
    contracts = ocds.get("contracts") or []
    docs = tender.get("documents") or []
    return {
        "ocid": ocds.get("ocid"),
        "buyer": {"name": buyer.get("name"), "id": buyer.get("id")},
        "tender": {
            "title": tender.get("title"),
            "description": (tender.get("description") or "")[:1200] or None,
            "value": tender.get("value"),
            "procurementMethod": tender.get("procurementMethod"),
            "procurementMethodDetails": tender.get("procurementMethodDetails"),
            "mainProcurementCategory": tender.get("mainProcurementCategory"),
            "status": tender.get("status"),
            "numberOfTenderers": tender.get("numberOfTenderers"),
            "tenderers": [{"id": t.get("id"), "name": t.get("name")}
                          for t in (tender.get("tenderers") or []) if isinstance(t, dict)][:30],
            "items": [{"id": it.get("id"), "description": (it.get("description") or "")[:200],
                       "quantity": it.get("quantity"), "unit": (it.get("unit") or {}).get("name"),
                       "totalValue": it.get("totalValue")}
                      for it in (tender.get("items") or []) if isinstance(it, dict)][:60],
            "n_items": len(tender.get("items") or []),
            "tenderPeriod": tender.get("tenderPeriod"),
            "n_documents": len(docs),
            "documents": [{"title": d.get("title"), "documentType": d.get("documentType"),
                           "datePublished": (d.get("datePublished") or "")[:10]}
                          for d in docs if isinstance(d, dict)][:30],
        },
        "awards": [
            {"id": a.get("id"), "status": a.get("status"),
             "suppliers": [{"id": s.get("id"), "name": s.get("name")} for s in (a.get("suppliers") or [])],
             "value": a.get("value"), "date": a.get("date")}
            for a in awards[:20] if isinstance(a, dict)
        ],
        "n_awards": len(awards),
        "contracts": [
            {"id": c.get("id"), "status": c.get("status"), "value": c.get("value"),
             "dateSigned": c.get("dateSigned"), "n_amendments": len(c.get("amendments") or [])}
            for c in contracts[:20] if isinstance(c, dict)
        ],
        "n_contracts": len(contracts),
    }


# Campos de `document_analysis.documentos[*]` que sirven al dictamen (el resto —gs, url,
# sha256, cache, tiempos, usos, unidades, motor— es telemetría del parser).
_DOC_CAMPOS_DICTAMEN = ("id", "titulo", "tipo", "seccion", "formato", "n_paginas", "n_items", "n_firmantes",
                        "tipo_documento_detectado", "contiene_requerimiento", "truncado", "error")


def _sin_sha(ev):
    if isinstance(ev, list):
        return [{k: v for k, v in e.items() if k != "documento_sha256"} if isinstance(e, dict) else e for e in ev]
    return ev


def _compact_document_analysis(da):
    """Proyección de `document_analysis` para el writer SIN lo redundante (verificado en un
    contexto real: 28 k de 62 k chars eran document_analysis):
      · `requerimiento_tecnico_detallado` es ALIAS de `texto_literal` por ítem (hasta 4 000
        chars duplicados por ítem) → se deja solo `texto_literal`;
      · `firmantes_consolidados` == `firmantes` y `postores_consolidados` == `postores_extraidos`;
      · `documentos[*]` se reduce a los campos útiles (sin telemetría del OCR);
      · `documento_sha256` (por ítem/evidencia/firmante/…) no es citable en el dictamen.
    No se quita ninguna información única. Devuelve una COPIA (no muta el state)."""
    if not isinstance(da, dict):
        return da
    out = {}
    for k, v in da.items():
        if k in ("_source", "_note"):
            continue
        if k == "firmantes_consolidados" and v == da.get("firmantes"):
            continue
        if k == "postores_consolidados" and v == da.get("postores_extraidos"):
            continue
        if k == "documentos" and isinstance(v, list):
            out[k] = [{c: d.get(c) for c in _DOC_CAMPOS_DICTAMEN if d.get(c) not in (None, "", [], {})}
                      if isinstance(d, dict) else d for d in v]
            continue
        if isinstance(v, list):
            nv = []
            for it in v:
                if not isinstance(it, dict):
                    nv.append(it)
                    continue
                it2 = {}
                for ik, iv in it.items():
                    if ik == "documento_sha256":
                        continue
                    if ik == "requerimiento_tecnico_detallado" and iv == it.get("texto_literal"):
                        continue
                    it2[ik] = _sin_sha(iv) if ik == "evidencia" else iv
                nv.append(it2)
            out[k] = nv
        elif isinstance(v, dict):
            out[k] = {ik: (_sin_sha(iv) if ik == "evidencia" else iv) for ik, iv in v.items() if ik != "documento_sha256"}
        else:
            out[k] = v
    return out


def _paginar(obj, max_str: int, max_list: int, _depth: int = 0):
    """Paginación por sección: en vez de cortar silenciosamente (viejo `_cap`), cada
    lista que supera `max_list` se reemplaza por {"items": [...], "_truncado": true,
    "_omitidos": n, "_total": N} y cada string larga termina en un marcador con el
    conteo de chars omitidos. El writer SIEMPRE sabe qué no vio."""
    if _depth > 8:
        return obj
    if isinstance(obj, str):
        if len(obj) <= max_str:
            return obj
        return obj[:max_str] + f" …[_truncado: {len(obj) - max_str} chars omitidos]"
    if isinstance(obj, list):
        items = [_paginar(x, max_str, max_list, _depth + 1) for x in obj[:max_list]]
        if len(obj) > max_list:
            return {"items": items, "_truncado": True, "_omitidos": len(obj) - max_list,
                    "_total": len(obj)}
        return items
    if isinstance(obj, dict):
        return {k: _paginar(v, max_str, max_list, _depth + 1) for k, v in obj.items()}
    return obj


def _banderas_para_dictamen(state) -> list[dict] | None:
    """Banderas PERSISTIDAS (todos los agentes) leídas de BD por alerta_codigo; si la
    BD no responde, las que dejó `persist_alert_from_flags` en state['banderas']."""
    codigo = state.get("alerta_codigo")
    if codigo:
        try:
            conn = _pg()
            try:
                cur = conn.cursor()
                cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name='banderas' "
                            "AND column_name='verificacion'")
                con_ver = cur.fetchone() is not None
                cur.execute(
                    "SELECT b.regla, b.severidad, b.evidencia, b.norma, b.fuente_url, b.agente_origen"
                    + (", b.verificacion" if con_ver else ", NULL") +
                    " FROM banderas b JOIN alertas a ON a.id=b.alerta_id WHERE a.codigo=%s "
                    "ORDER BY CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, b.id",
                    (codigo,))
                rows = cur.fetchall()
                if rows:
                    out = []
                    for r in rows:
                        ver = r[6]
                        if isinstance(ver, str):
                            ver = _safe_parse_json(ver)
                        out.append({"regla": r[0], "severidad": r[1], "evidencia": r[2], "norma": r[3],
                                    "fuente_url": r[4], "agente_origen": r[5], "verificacion": ver})
                    return out
            finally:
                conn.close()
        except Exception:
            pass
    b = state.get("banderas")
    return [x for x in b if isinstance(x, dict)] if isinstance(b, list) else None


def get_dictamen_context(tool_context: ToolContext) -> dict:
    """Devuelve el contexto investigativo de la convocatoria en curso, leído del
    session.state. Es la ÚNICA forma en que el report_writer accede a los datos
    reales del análisis — sin llamar esto, NO tiene información y CUALQUIER cosa
    que escriba será alucinación.

    Incluye (WS V · auditoría #6 y §6.1-4):
      · `banderas`: las PERSISTIDAS en BD por todos los agentes (compliance, legal,
        market), con `verificacion`. El dictamen solo puede citar estas.
      · `reglas_evaluadas`: pending_flags (resultado de las reglas deterministas).
      · `entity_personnel`, `estado_real`, `analisis_postores`,
        `causal_directa_invocada`, `acto_resolutivo_directa`, `sunat_decolecta`.
      · `recortes` / `descartes` / `validaciones_pendientes`: lo que NO entró al
        análisis, para la sección "Recortes y datos no verificables".
      · `normative_compliance` completo (ya sin corte a 10 hallazgos).

    Paginación: cada sección se recorta con marca explícita (`_truncado`,
    `_omitidos`, `_total`) — nunca un corte silencioso. En el REINTENTO
    (`state['_dictamen_compact']`) bajan los topes pero NO se elimina
    `legal_analysis`. Un output no parseable llega como
    {"estado": "sin_dato", "_parse_failed": true}, nunca como texto crudo.

    Returns:
        Diccionario con ocds (compacto), banderas, document_analysis, legal_analysis,
        market_analysis, web_research, news_research, person_network, entity_personnel,
        compliance_result, normative_compliance, reglas_evaluadas, estado_real,
        analisis_postores, causal_directa_invocada, acto_resolutivo_directa,
        sunat_decolecta, estudio_mercado, contrato_final, recortes, descartes,
        validaciones_pendientes, alerta_codigo, perfil.
    """
    state = tool_context.state
    compact = bool(state.get("_dictamen_compact"))
    keys = [
        "ocds", "document_analysis", "legal_analysis", "market_analysis",
        "web_research", "news_research", "person_network", "entity_personnel",
        "compliance_result", "normative_compliance", "alerta_codigo",
        "estado_real", "analisis_postores", "causal_directa_invocada",
        "acto_resolutivo_directa", "sunat_decolecta",
        # Bloques tipados por documento (ruteo incremental): estudio de mercado +
        # causal (Resumen Ejecutivo) y condiciones FINALES (Orden de Compra).
        "estudio_mercado", "contrato_final",
        "recortes", "descartes", "validaciones_pendientes", "perfil",
    ]
    out: dict = {}
    for k in keys:
        v = state.get(k)
        if v is None:
            out[k] = None
            continue
        if isinstance(v, str):
            parsed = _safe_parse_json(v)
            if parsed:
                out[k] = parsed
            elif k in ("compliance_result", "alerta_codigo", "perfil"):
                out[k] = v          # texto legítimo (síntesis / código / nombre del perfil)
            else:
                out[k] = {"estado": "sin_dato", "_parse_failed": True,
                          "_motivo": "output del agente no parseable como JSON"}
        else:
            out[k] = v
    out["ocds"] = _compact_ocds(out.get("ocds"))
    out["document_analysis"] = _compact_document_analysis(out.get("document_analysis"))
    # `perfil` completo (listas de prioridad de documentos, reglas, topes) no aporta al texto:
    # las secciones del dictamen ya viajan en el mensaje del writer.
    if isinstance(out.get("perfil"), dict):
        out["perfil"] = {k: out["perfil"].get(k) for k in ("nombre", "market_estrategia", "legal_vectores")}
    out["banderas"] = _banderas_para_dictamen(state)
    out["reglas_evaluadas"] = [b for b in (state.get("pending_flags") or []) if isinstance(b, dict)]
    out["n_banderas"] = len(out["banderas"] or [])
    out["_nota"] = ("Solo se pueden citar banderas presentes en `banderas`. Las secciones con "
                    "`_truncado: true` fueron paginadas; `_omitidos` dice cuántos elementos no se "
                    "muestran. `recortes`/`descartes`/`validaciones_pendientes` deben listarse en "
                    "la sección 'Recortes y datos no verificables'.")
    if compact:
        out = _paginar(out, max_str=1600, max_list=15)
    else:
        out = _paginar(out, max_str=6000, max_list=60)
    return out

def read_document_analysis(tool_context: ToolContext) -> dict:
    """Devuelve el state['document_analysis'] producido por el document_parser_agent.
    Sirve a sub-agentes (legal_analyst, etc.) que necesitan leer items/firmantes/
    comite/motivos_adjudicacion del documento parseado sin depender de que el
    orchestrator inyecte el JSON en el mensaje (operación que el LLM falla
    cuando el JSON es grande).

    Fallback: si state['document_analysis'] está vacío o malformado, lee
    state['parser_raw_consolidated'] que la tool parse_document_pdf escribe
    directamente con el JSON ya estructurado (sin pasar por el LLM).

    Returns:
        dict con el state['document_analysis'] parseado a JSON, o
        {error: '...'} si no se ha ejecutado el parser todavía.
    """
    state = tool_context.state

    # Helper: limpia markdown fences ```json ... ``` antes de parsear
    def _strip_fences(s: str) -> str:
        s = s.strip()
        if s.startswith("```"):
            # Quitar primera línea (```json o ```)
            first_nl = s.find("\n")
            if first_nl > 0:
                s = s[first_nl + 1:]
            # Quitar ``` final
            if s.endswith("```"):
                s = s[:-3].strip()
        return s

    # PRIORIDAD INVERTIDA (fix 2026-06-17): la AUTORIDAD es `parser_raw_consolidated`
    # (extracción DETERMINISTA de la tool parse_document_pdf), NO el document_analysis del
    # AGENTE. El document_parser_AGENTE recibe de la tool solo un RESUMEN compacto (conteos,
    # NO los ítems), así que cuando arma su document_analysis a veces ECHA el schema como
    # valor — placeholders tipo "Descripción corta del Ítem N extraída de las Bases",
    # "POSTOR DE BASES 1", "NOMBRE FIRMANTE BASES". Esa basura envenenaba al legal_analyst
    # (leía ítems/firmantes inventados). La tool SÍ tiene los datos reales. Antes esto solo
    # se usaba como fallback "si document_analysis vacío"; ahora gana SIEMPRE que tenga datos.
    raw = state.get("parser_raw_consolidated")
    if isinstance(raw, dict) and (raw.get("items_consolidados") or raw.get("firmantes")
                                  or raw.get("postores_consolidados") or raw.get("postores_extraidos")):
        return {
            "items": raw.get("items_consolidados", []),
            "items_consolidados": raw.get("items_consolidados", []),
            "postores_extraidos": raw.get("postores_extraidos") or raw.get("postores_consolidados") or [],
            "firmantes": raw.get("firmantes", []),
            "comite_evaluacion": raw.get("comite_evaluacion", []),
            "motivos_adjudicacion": raw.get("motivos_adjudicacion", []),
            "cuantia_total": raw.get("cuantia_total"),
            "modalidad": raw.get("modalidad"),
            "fundamento_legal": raw.get("fundamento_legal"),
            # Estudio de mercado + causal (Resumen Ejecutivo) para que el análisis
            # legal evalúe la VALIDEZ de la causal de contratación directa.
            "estudio_mercado": state.get("estudio_mercado"),
            "contrato_final": state.get("contrato_final"),
            "_source": "parser_raw_consolidated",
            "_note": "Extracción determinista de la tool (autoritativa sobre el LLM del parser).",
        }

    # Fallback: el output del AGENTE (solo si la tool no dejó nada extraído).
    v = state.get("document_analysis")
    if v is not None:
        if isinstance(v, dict):
            if v.get("items") or v.get("items_consolidados") or v.get("firmantes"):
                return v
        if isinstance(v, str):
            cleaned = _strip_fences(v)
            parsed = _safe_parse_json(cleaned)
            if parsed and (parsed.get("items") or parsed.get("items_consolidados")
                           or parsed.get("firmantes")):
                return parsed

    return {
        "error": "document_analysis no está en state — el parser aún no corrió.",
        "items": [],
        "firmantes": [],
        "comite_evaluacion": [],
        "motivos_adjudicacion": [],
    }

def get_alerta_full_context(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Trae todo el contexto disponible de una alerta para que el report
    writer arme el dictamen: convocatoria, banderas, items, hallazgos de
    mercado, web research, documentos parseados.

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1203694').

    Returns:
        Diccionario con alerta, banderas, items, market_findings, web_research.
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.id::text, a.codigo, a.ocid, a.score, a.estado,
                      a.entidad_ruc, a.proveedor_ruc, a.monto_adjudicado,
                      a.fecha_buena_pro, a.region, a.objeto, a.fuente_url,
                      e.nombre, emp.razon_social, emp.actividad_economica
                 FROM alertas a
                 LEFT JOIN entidades e ON e.ruc=a.entidad_ruc
                 LEFT JOIN empresas emp ON emp.ruc=a.proveedor_ruc
                WHERE a.codigo=%s LIMIT 1""",
            (alerta_codigo,),
        )
        row = cur.fetchone()
        if not row:
            return {"error": "alerta not found"}
        keys = ["id", "codigo", "ocid", "score", "estado", "entidad_ruc",
                "proveedor_ruc", "monto", "fecha_bp", "region", "objeto",
                "fuente_url", "entidad_nombre", "proveedor_nombre", "actividad_proveedor"]
        alerta = dict(zip(keys, row))
        alerta["monto"] = float(alerta["monto"] or 0)
        alerta["fecha_bp"] = str(alerta["fecha_bp"]) if alerta["fecha_bp"] else None

        cur.execute(
            "SELECT regla, severidad, evidencia, norma, fuente_url FROM banderas "
            "WHERE alerta_id=%s ORDER BY CASE severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END",
            (alerta["id"],),
        )
        banderas = [
            {"regla": r[0], "severidad": r[1], "evidencia": r[2], "norma": r[3], "fuente_url": r[4]}
            for r in cur.fetchall()
        ]
        cur.execute(
            "SELECT numero_item, descripcion, cantidad, unidad, cuantia_referencial "
            "FROM convocatoria_items WHERE ocid=%s ORDER BY numero_item",
            (alerta["ocid"],),
        )
        items = [{"n": r[0], "desc": r[1], "cant": float(r[2] or 0),
                  "unidad": r[3], "ref": float(r[4] or 0)} for r in cur.fetchall()]
        return {
            "alerta": alerta, "banderas": banderas, "items": items,
            "market_findings": tool_context.state.get("market_findings", []),
            "web_research_text": tool_context.state.get("web_research", ""),
            "doc_parser_text": tool_context.state.get("document_analysis", ""),
        }
    finally:
        conn.close()

# ── FunctionTool wrappers ──
get_alerta_full_context_tool = FunctionTool(func=get_alerta_full_context)
get_dictamen_context_tool = FunctionTool(func=get_dictamen_context)
read_document_analysis_tool = FunctionTool(func=read_document_analysis)
