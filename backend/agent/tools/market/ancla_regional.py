"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .config import (MARKET_ANCLA_LIMIT, MARKET_ANCLA_MARGEN, MARKET_ANCLA_MESES,
    MARKET_ANCLA_MIN_PAIS, MARKET_ANCLA_MIN_REGION, MARKET_ANCLA_SOLAPE, OECE_PROCESO_URL)
from .normalizar import (_UNIDADES_MEDIDA, _diff_pct, _filtrar_outliers, _mediana,
    _solape_raices, _unidad_canon, _veredicto)

def _consultar_referencias_internas(ocid: str, cubsos: list[str], descripcion: str, *, meses: int = MARKET_ANCLA_MESES,
                                    limit: int = MARKET_ANCLA_LIMIT) -> list[dict]:
    """Ítems de otras convocatorias de BIENES en la BD propia con el mismo CUBSO o su clase (8
    dígitos) en los últimos `meses`, con precio unitario implícito (totalValue/quantity) del VR
    y, si existe, del award. Ordena: mismo departamento (ubigeo) → mismo CUBSO → similitud."""
    if not ocid or not (cubsos or descripcion):
        return []
    clases = sorted({c[:8] for c in cubsos if len(c) >= 8})
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='pg_trgm'")
        tiene_trgm = cur.fetchone() is not None
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='unaccent'")
        tiene_unaccent = cur.fetchone() is not None
        norm = "unaccent(lower(%s))" if tiene_unaccent else "lower(%s)"
        col_descr = "it->>'description'"
        sim_expr = f"similarity({norm.replace('%s', col_descr)}, {norm})" if tiene_trgm else "0.0"
        sql = f"""
            WITH me AS (SELECT left(ubigeo, 2) AS dpto FROM convocatorias WHERE ocid = %s)
            SELECT c.ocid, c.entidad_ruc, e.nombre, c.objeto, c.fecha_convocatoria, c.region, left(c.ubigeo, 2),
                   c.modalidad, c.etapa,
                   it->>'description', it->>'quantity', it->'unit'->>'name', it->'classification'->>'id',
                   it->'totalValue'->>'amount',
                   (SELECT ai->'totalValue'->>'amount'
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.ocds_payload->'awards') = 'array'
                                                     THEN c.ocds_payload->'awards' ELSE '[]'::jsonb END) a,
                           jsonb_array_elements(CASE WHEN jsonb_typeof(a->'items') = 'array'
                                                     THEN a->'items' ELSE '[]'::jsonb END) ai
                     WHERE ai->>'id' = it->>'id' LIMIT 1),
                   {sim_expr},
                   (left(c.ubigeo, 2) IS NOT NULL AND left(c.ubigeo, 2) = (SELECT dpto FROM me)),
                   (it->'classification'->>'id' = ANY(%s))
              FROM convocatorias c
              LEFT JOIN entidades e ON e.ruc = c.entidad_ruc,
                   jsonb_array_elements(CASE WHEN jsonb_typeof(c.ocds_payload->'tender'->'items') = 'array'
                                             THEN c.ocds_payload->'tender'->'items' ELSE '[]'::jsonb END) it
             WHERE c.ocid <> %s
               AND (c.categoria = 'goods' OR c.tipo_contratacion = 'bienes')
               AND COALESCE(c.etapa, '') NOT IN ('nula', 'cancelada')
               AND c.fecha_convocatoria >= (CURRENT_DATE - make_interval(months => %s))
               AND (it->'classification'->>'id' = ANY(%s) OR left(it->'classification'->>'id', 8) = ANY(%s))
               AND (it->>'quantity') ~ '^[0-9]+([.][0-9]+)?$' AND (it->>'quantity')::numeric > 0
               AND (it->'totalValue'->>'amount') ~ '^[0-9]+([.][0-9]+)?$'
               AND (it->'totalValue'->>'amount')::numeric > 0
             ORDER BY 16 DESC, 17 DESC, 15 DESC
             LIMIT %s"""
        params = [ocid] + ([descripcion] if tiene_trgm else []) + [cubsos or [""], ocid, meses, cubsos or [""],
                                                                     clases or [""], limit]
        cur.execute(sql, params)
        out, vistos = [], set()
        for r in cur.fetchall():
            (r_ocid, ent_ruc, ent_nombre, objeto, fecha, region, dpto, modalidad, etapa, descr, qty, unidad,
             cubso, total_ref, total_adj, sim, misma_region, mismo_cubso) = r
            k = (r_ocid, (descr or "")[:80])
            if k in vistos:
                continue
            vistos.add(k)
            try:
                qty_f, ref_f = float(qty), float(total_ref)
            except (TypeError, ValueError):
                continue
            adj_f = None
            try:
                adj_f = float(total_adj) if total_adj else None
            except (TypeError, ValueError):
                adj_f = None
            out.append({
                "ocid": r_ocid, "entidad_ruc": ent_ruc, "entidad": ent_nombre, "objeto": (objeto or "")[:200],
                "descripcion": (descr or "")[:200], "cantidad": qty_f, "unidad": unidad, "cubso": cubso,
                "fecha_convocatoria": fecha.isoformat() if fecha else None, "region": region, "departamento_ubigeo": dpto,
                "modalidad": modalidad, "etapa": etapa,
                "precio_unitario_referencial": round(ref_f / qty_f, 4),
                "precio_unitario_adjudicado": round(adj_f / qty_f, 4) if adj_f else None,
                "sim": round(float(sim or 0), 3), "misma_region": bool(misma_region), "mismo_cubso": bool(mismo_cubso),
                "url": OECE_PROCESO_URL.format(ocid=r_ocid),
            })
        return out
    finally:
        conn.close()


def _ancla_regional_item(it: dict, refs: list[dict], base_val, ctx: dict) -> tuple[dict, list[dict]]:
    """Filtra las referencias internas al mismo bien (CUBSO exacto o solape de raíces ≥ umbral) y
    misma dimensión de unidad (convirtiendo factor), y decide el ámbito: departamento (≥ 2) →
    país (≥ 3) → insuficiente. Devuelve (ancla, referencias_usables)."""
    descr = it.get("descripcion_corta") or it.get("descripcion") or ""
    dim, f_item = ctx.get("dim"), ctx.get("factor") or 1.0
    usables = []
    for r in refs:
        cu = _unidad_canon(r.get("unidad"), item=True)
        if dim in _UNIDADES_MEDIDA:
            if not cu or cu[0] != dim:
                continue
            conv = f_item / cu[1]
        else:
            if cu and cu[0] in _UNIDADES_MEDIDA:
                continue
            conv = 1.0
        solape = _solape_raices(descr, r.get("descripcion") or "")
        if not (r.get("mismo_cubso") or solape >= MARKET_ANCLA_SOLAPE):
            continue
        pu = r.get("precio_unitario_adjudicado") or r.get("precio_unitario_referencial")
        if not pu:
            continue
        usables.append({**r, "solape_raices": round(solape, 2),
                        "precio_unitario": round(pu * conv, 4),
                        "precio_base": "adjudicado" if r.get("precio_unitario_adjudicado") else "referencial"})
    # Outliers de la BD (cantidad = 1 para un lote, unidad mal registrada): fuera de [med/5, med×5].
    keep, drop = _filtrar_outliers([r["precio_unitario"] for r in usables])
    n_outliers = len(drop)
    usables = [r for r in usables if r["precio_unitario"] in keep] if drop else usables
    region = [r for r in usables if r.get("misma_region")]
    if len(region) >= MARKET_ANCLA_MIN_REGION:
        grupo, ambito = region, "departamento"
    elif len(usables) >= MARKET_ANCLA_MIN_PAIS:
        grupo, ambito = usables, "nacional"
    else:
        return ({"estado": "insuficiente", "ambito": None, "n": len(usables), "n_region": len(region),
                 "n_outliers": n_outliers, "motivo": "menos_referencias_internas_que_el_minimo"}, usables)
    vals = [r["precio_unitario"] for r in grupo]
    p_min, p_max, med = min(vals), max(vals), _mediana(vals)
    lo, hi = p_min * (1 - MARKET_ANCLA_MARGEN), p_max * (1 + MARKET_ANCLA_MARGEN)
    diff = _diff_pct(base_val, med)
    if base_val is None:
        pos = "sin_base"
    elif lo <= float(base_val) <= hi:
        pos = "dentro_rango"
    elif float(base_val) > hi:
        pos = "sobre_rango"
    else:
        pos = "bajo_rango"
    return ({"estado": "hallado", "ambito": ambito, "n": len(grupo), "n_region": len(region), "n_outliers": n_outliers,
             "rango_min": round(p_min, 2), "rango_max": round(p_max, 2), "mediana": round(med, 2),
             "margen": MARKET_ANCLA_MARGEN, "posicion": pos, "diff_vs_mediana_pct": diff,
             "veredicto_regional": ("alineado_regional" if pos == "dentro_rango" else _veredicto(diff) if diff is not None else "sin_dato"),
             "ocids": [r["ocid"] for r in grupo][:12]}, usables)
