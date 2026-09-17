"""Consultas de solo-lectura para las rutas GET de main.py (?action=list|load|random):
listar convocatorias analizadas, elegir una al azar, y cargar un análisis cacheado por
OCID/código. Sin dependencia del pipeline de agentes — solo Cloud SQL.

Extraído de main.py.
"""
from __future__ import annotations

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
