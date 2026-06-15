"""Tools del dominio: state_loaders."""

from tools._core import *  # noqa: F401,F403

def _compact_ocds(ocds):
    """Proyección MÍNIMA del OCDS para el dictamen (entidad, monto, ganador).
    El report_writer no necesita parties/sources/planning/items crudos — esos
    inflan el contexto y suben el riesgo de que el modelo degenere la salida en
    contratos doc-pesados. La data de items/postores ya viene en document_analysis."""
    if not isinstance(ocds, dict):
        return ocds
    tender = ocds.get("tender") or {}
    buyer = ocds.get("buyer") or {}
    awards = ocds.get("awards") or []
    return {
        "ocid": ocds.get("ocid"),
        "buyer": {"name": buyer.get("name"), "id": buyer.get("id")},
        "tender": {
            "title": tender.get("title"),
            "description": (tender.get("description") or "")[:800] or None,
            "value": tender.get("value"),
            "procurementMethodDetails": tender.get("procurementMethodDetails"),
            "mainProcurementCategory": tender.get("mainProcurementCategory"),
            "numberOfTenderers": tender.get("numberOfTenderers"),
        },
        "awards": [
            {"suppliers": [s.get("name") for s in (a.get("suppliers") or [])],
             "value": a.get("value"), "date": a.get("date")}
            for a in awards[:10]
        ],
    }


def _cap(obj, max_str: int, max_list: int, _depth: int = 0):
    """Tope genérico recursivo: trunca strings largos y listas largas para acotar
    el tamaño del contexto inyectado. Defensa contra inflado futuro."""
    if _depth > 8:
        return obj
    if isinstance(obj, str):
        return obj if len(obj) <= max_str else obj[:max_str] + "…[truncado]"
    if isinstance(obj, list):
        capped = [_cap(x, max_str, max_list, _depth + 1) for x in obj[:max_list]]
        if len(obj) > max_list:
            capped.append(f"…[+{len(obj) - max_list} ítems omitidos]")
        return capped
    if isinstance(obj, dict):
        return {k: _cap(v, max_str, max_list, _depth + 1) for k, v in obj.items()}
    return obj


def get_dictamen_context(tool_context: ToolContext) -> dict:
    """Devuelve el contexto investigativo ACOTADO de la convocatoria en curso,
    leído del session.state. Es la ÚNICA forma en que el report_writer accede a
    los datos reales del análisis — sin llamar esto, NO tiene información y
    CUALQUIER cosa que escriba será alucinación.

    Contexto deliberadamente acotado para estabilizar la salida del modelo: con
    contexto > ~70K chars el report_writer (gemini-2.5-pro) degeneró la respuesta
    final (README alucinado + tokens de control) en contratos doc-pesados. Se
    EXCLUYEN dos bloques redundantes y se compacta `ocds`:
      · parser_raw_consolidated → redundante con document_analysis (mismos items,
        pre-dedup); inflaba ~20K en contratos doc-pesados.
      · market_findings → redundante con market_analysis (su versión estructurada).

    Modo compacto (`state['_dictamen_compact']`): el driver lo activa en el
    REINTENTO tras una salida malformada — recorta aún más (suelta legal_analysis
    y baja los topes) para maximizar la probabilidad de una salida estable.

    Returns:
        Diccionario con ocds (compacto), document_analysis, legal_analysis,
        market_analysis, web_research, news_research, person_network,
        compliance_result, normative_compliance, alerta_codigo,
        estudio_mercado, contrato_final.
    """
    state = tool_context.state
    compact = bool(state.get("_dictamen_compact"))
    keys = [
        "ocds", "document_analysis", "legal_analysis", "market_analysis",
        "web_research", "news_research", "person_network", "compliance_result",
        "normative_compliance", "alerta_codigo",
        # Bloques tipados por documento (ruteo incremental): estudio de mercado +
        # causal (Resumen Ejecutivo) y condiciones FINALES (Orden de Compra). El
        # dictamen los cita para el "por qué" de la modalidad y el precio pagado.
        "estudio_mercado", "contrato_final",
    ]
    if compact:
        # En reintento: soltar el bloque legal extenso (normative_compliance ya
        # trae la evaluación RAG cruzada con opiniones OECE).
        keys = [k for k in keys if k != "legal_analysis"]
    out: dict = {}
    for k in keys:
        v = state.get(k)
        if v is None:
            out[k] = None
            continue
        if isinstance(v, str):
            parsed = _safe_parse_json(v)
            out[k] = parsed if parsed else v
        else:
            out[k] = v
    out["ocds"] = _compact_ocds(out.get("ocds"))
    if compact:
        out = _cap(out, max_str=1400, max_list=10)
    else:
        out = _cap(out, max_str=5000, max_list=40)
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

    v = state.get("document_analysis")
    if v is not None:
        if isinstance(v, dict):
            # Si trae datos reales, devolverlos. Si está vacío, caer a fallback.
            if v.get("items") or v.get("items_consolidados") or v.get("firmantes"):
                return v
        if isinstance(v, str):
            cleaned = _strip_fences(v)
            parsed = _safe_parse_json(cleaned)
            if parsed and (parsed.get("items") or parsed.get("items_consolidados")
                           or parsed.get("firmantes")):
                return parsed

    # Fallback: el parser raw consolidado que parse_document_pdf escribe
    # directamente en state (sin pasar por LLM, garantiza dict válido).
    raw = state.get("parser_raw_consolidated")
    if raw and isinstance(raw, dict):
        # Normalizar al shape esperado por legal_analyst
        return {
            "items": raw.get("items_consolidados", []),
            "items_consolidados": raw.get("items_consolidados", []),
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
            "_note": "Fallback: document_analysis vacío o malformado, "
                     "usé parser_raw_consolidated directamente.",
        }

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
