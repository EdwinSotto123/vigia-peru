"""Tools del dominio: state_loaders."""

from tools._core import *  # noqa: F401,F403

def get_dictamen_context(tool_context: ToolContext) -> dict:
    """Devuelve TODO el contexto investigativo de la convocatoria en curso,
    leído del session.state. Esta es la ÚNICA forma en que el report_writer
    accede a los datos reales del análisis — sin llamar esto, NO tiene
    información y CUALQUIER cosa que escriba será alucinación.

    Returns:
        Diccionario con:
          - ocds:          metadata OCDS (entidad, monto, postores, ganador)
          - document_analysis: items, requerimiento, red_flags, modalidad
          - market_analysis:   findings de precios y proveedores potenciales
          - web_research:      perfil SUNAT + historial contratista
          - news_research:     timeline de prensa
          - person_network:    gerente + red empresarial + aportes políticos
          - compliance_result: reglas duras evaluadas + banderas
          - normative_compliance: evaluación RAG cruzada con opiniones OECE
          - alerta_codigo:   código de alerta si se persistió alguna (puede ser None)
    """
    state = tool_context.state
    keys = [
        "ocds", "document_analysis", "legal_analysis", "market_analysis",
        "web_research", "news_research", "person_network", "compliance_result",
        "normative_compliance", "alerta_codigo", "parser_raw_consolidated",
        "market_findings",
    ]
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
