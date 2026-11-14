"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .config import (MARKET_HIST_LIMIT, MARKET_HIST_MESES, MARKET_HIST_MIN_N,
    MARKET_HIST_SIM, MARKET_HIST_VEREDICTO, OECE_PROCESO_URL)
from .normalizar import _diff_pct, _percentil, _publicar_grounding, _veredicto

def _cubsos_del_record(ocds: dict) -> list[str]:
    ids: list[str] = []
    for it in ((ocds.get("tender") or {}).get("items") or []):
        if not isinstance(it, dict):
            continue
        for c in [it.get("classification")] + list(it.get("additionalClassifications") or []):
            cid = str((c or {}).get("id") or "").strip()
            if cid and cid not in ids:
                ids.append(cid)
    return ids


def _monto_del_record(ocds: dict, state: dict, total: bool = False) -> tuple[float | None, str | None]:
    """(monto, base): adjudicado (awards) > contratado (contracts) > referencial (tender.value /
    convocatoria). None si el valor no es público (p.ej. hasTenderInformationProtectedByLaw).

    `total=True` suma todas las adjudicaciones vigentes (o todos los contratos): en un proceso adjudicado por ítems
    el OCDS trae una adjudicación por ítem, y la primera sola no es el monto del proceso (se compara contra la
    cuantía TOTAL de otras convocatorias y se divide entre el plazo de TODO el servicio)."""
    def _amt(v):
        try:
            a = float((v or {}).get("amount") or 0)
            return a if a > 0 else None
        except (TypeError, ValueError):
            return None
    if total:
        for nodo, etiqueta in (("awards", "adjudicado"), ("contracts", "contratado")):
            vals = [_amt(x.get("value")) for x in (ocds.get(nodo) or [])
                    if isinstance(x, dict) and str(x.get("status") or "").lower() not in ("cancelled", "unsuccessful")]
            vals = [v for v in vals if v]
            if vals:
                return float(sum(vals)), etiqueta
    for a in ocds.get("awards") or []:
        if isinstance(a, dict) and _amt(a.get("value")):
            return _amt(a.get("value")), "adjudicado"
    for c in ocds.get("contracts") or []:
        if isinstance(c, dict) and _amt(c.get("value")):
            return _amt(c.get("value")), "contratado"
    t = ocds.get("tender") or {}
    if _amt(t.get("value")):
        return _amt(t.get("value")), "referencial"
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    if cf.get("precio_final_total"):
        try:
            return float(cf["precio_final_total"]), "contratado"
        except (TypeError, ValueError):
            pass
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    if em.get("valor_referencial"):
        try:
            return float(em["valor_referencial"]), "referencial"
        except (TypeError, ValueError):
            pass
    return None, None


def _entidad_ruc_del_record(ocds: dict) -> str | None:
    for p in ocds.get("parties") or []:
        if not isinstance(p, dict):
            continue
        roles = p.get("roles") or []
        if "buyer" in roles or "procuringEntity" in roles:
            for ai in p.get("additionalIdentifiers") or []:
                if (ai or {}).get("scheme") == "PE-RUC":
                    m = re.search(r"(\d{11})$", str(ai.get("id") or ""))
                    if m:
                        return m.group(1)
            ident = p.get("identifier") or {}
            if ident.get("scheme") == "PE-RUC":
                m = re.search(r"(\d{11})$", str(ident.get("id") or ""))
                if m:
                    return m.group(1)
    return None


def _comparables_convocatorias(ocid: str, cubsos: list[str], objeto: str, tipos: tuple[str, ...],
                               *, meses: int = MARKET_HIST_MESES, sim_min: float = MARKET_HIST_SIM,
                               limit: int = MARKET_HIST_LIMIT) -> list[dict]:
    """Convocatorias similares en la BD propia: mismo CUBSO (o clase UNSPSC) u objeto similar
    (unaccent + pg_trgm), últimos `meses`, con cuantía > 0. Determinista, sin LLM."""
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='pg_trgm'")
        tiene_trgm = cur.fetchone() is not None
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='unaccent'")
        tiene_unaccent = cur.fetchone() is not None
        norm = "unaccent(lower(%s))" if tiene_unaccent else "lower(%s)"
        sim_expr = f"similarity({norm.replace('%s', 'c.objeto')}, {norm})" if tiene_trgm else "0.0"
        clases = sorted({c[:8] for c in cubsos if len(c) >= 8})
        sql = f"""
            WITH base AS (
              SELECT c.ocid, c.entidad_ruc, e.nombre AS entidad, c.objeto, c.cuantia_referencial,
                     c.fecha_convocatoria, c.modalidad, c.etapa, c.tipo_contratacion, c.region,
                     {sim_expr} AS sim,
                     EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c.ocds_payload->'tender'->'items','[]'::jsonb)) it
                             WHERE it->'classification'->>'id' = ANY(%s)
                                OR left(it->'classification'->>'id', 8) = ANY(%s)) AS mismo_cubso
                FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
               WHERE c.ocid <> %s AND c.tipo_contratacion = ANY(%s) AND c.cuantia_referencial > 0
                 AND c.fecha_convocatoria >= (CURRENT_DATE - make_interval(months => %s))
            )
            SELECT ocid, entidad_ruc, entidad, objeto, cuantia_referencial, fecha_convocatoria, modalidad,
                   etapa, tipo_contratacion, region, sim, mismo_cubso
              FROM base WHERE (mismo_cubso AND sim >= %s) OR sim >= %s
             ORDER BY (CASE WHEN mismo_cubso THEN 0.25 ELSE 0 END) + sim DESC LIMIT %s"""
        # Mismo CUBSO con objeto poco similar (mitad del umbral) sigue siendo otro servicio.
        params = ([objeto] if tiene_trgm else []) + [cubsos or [""], clases or [""], ocid, list(tipos), meses,
                                                     sim_min / 2, sim_min, limit]
        cur.execute(sql, params)
        cols = ["ocid", "entidad_ruc", "entidad", "objeto", "cuantia_referencial", "fecha_convocatoria",
                "modalidad", "etapa", "tipo_contratacion", "region", "sim", "mismo_cubso"]
        out = []
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            d["cuantia_referencial"] = float(d["cuantia_referencial"] or 0)
            d["fecha_convocatoria"] = d["fecha_convocatoria"].isoformat() if d.get("fecha_convocatoria") else None
            d["sim"] = round(float(d["sim"] or 0), 3)
            d["url"] = OECE_PROCESO_URL.format(ocid=d["ocid"])
            out.append(d)
        return out
    finally:
        conn.close()


def _finding_historico(objeto: str, item_numero: str, monto, base: str | None, comparables: list[dict],
                       cantidad=1.0, unidad="Contrato", min_n: int = MARKET_HIST_MIN_N) -> dict:
    """Un finding (formato frontend) con la distribución de comparables como precios observados."""
    vals = [c["cuantia_referencial"] for c in comparables if c.get("cuantia_referencial")]
    p25, p50, p75 = _percentil(vals, .25), _percentil(vals, .5), _percentil(vals, .75)
    n = len(vals)
    diff_info = _diff_pct(monto, p50) if (n >= min_n and monto) else None
    posicion = None
    if diff_info is not None:
        posicion = ("sobre_p75" if monto > p75 else "bajo_p25" if monto < p25 else "entre_p25_p75")
    diff = diff_info if MARKET_HIST_VEREDICTO else None
    veredicto = _veredicto(diff) if diff is not None else "sin_dato"
    motivo = None
    if not monto:
        motivo = "monto_no_publico"
    elif n < min_n:
        motivo = "comparables_insuficientes"
    elif not MARKET_HIST_VEREDICTO:
        motivo = "comparacion_no_normalizada"
    obs = [{
        "producto": (c.get("objeto") or "")[:300], "precio": c["cuantia_referencial"], "unidad": "contrato",
        "url": c["url"], "fecha": c.get("fecha_convocatoria"), "proveedor": c.get("entidad") or c.get("entidad_ruc"),
        "moneda_origen": "PEN", "titulo_fuente": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
        "similitud_objeto": c.get("sim"), "mismo_cubso": bool(c.get("mismo_cubso")),
        "misma_entidad": bool(c.get("misma_entidad")), "valor": c["cuantia_referencial"],
    } for c in comparables]
    return {
        "item_numero": item_numero, "item_descripcion": objeto[:300],
        "cantidad": cantidad, "unidad": unidad,
        "precio_unitario_referencial": monto if base == "referencial" else None,
        "precio_unitario_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "precios_observados": obs,
        "proveedores_potenciales": [],
        "caracteristicas_solicitadas_clave": [],
        "precio_mediana_mercado": round(p50, 2) if p50 is not None else None,
        "rango_min": round(p25, 2) if p25 is not None else None,
        "rango_max": round(p75, 2) if p75 is not None else None,
        "n_precios": n, "percentiles": {"p25": p25, "p50": p50, "p75": p75},
        "diff_vs_p50_pct": diff_info, "posicion_historica": posicion,
        "diff_pct": diff, "diff_base": base if diff is not None else None,
        "veredicto": veredicto, "es_estimacion": veredicto == "sin_dato", "motivo_estimacion": motivo,
        "estado": "hallado" if n else "sin_dato",
        "evidencia": [{"url": c["url"], "cita": f"{(c.get('objeto') or '')[:160]}: S/ {c['cuantia_referencial']:,.2f}"[:240]} for c in comparables][:20],
        "spec_restrictiva": None,
        "comentario": ((f"{n} convocatoria(s) comparable(s) en {MARKET_HIST_MESES} meses (BD SEACE propia); "
                        f"rango p25–p75 S/ {p25:,.2f} – {p75:,.2f}."
                        + (f" El monto ({base}) queda {posicion.replace('_', ' ')} ({diff_info:+.1f}% vs p50); "
                           f"referencia de escala, no normalizada por alcance." if posicion else ""))
                       if n else "Sin convocatorias comparables por CUBSO u objeto en la BD propia."),
    }


def _entero_positivo(v) -> int | None:
    try:
        n = int(float(v))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _lectura(state: dict, clase: str, marca: str) -> dict:
    """La salida de un lector de Vigía (`lecturas_documentos`), vacía si el documento leído no era de esa clase."""
    lect = state.get("lecturas_documentos") if isinstance(state.get("lecturas_documentos"), dict) else {}
    salida = (lect.get(clase) or {}).get("salida") if isinstance(lect.get(clase), dict) else None
    return salida if (isinstance(salida, dict) and salida.get(marca) is not False) else {}


def _plazo_del_servicio(state: dict, srv: dict | None) -> tuple[int | None, str | None]:
    """(días, fuente) del plazo del servicio. Manda el contrato firmado (es el plazo por el que se paga el monto
    adjudicado); después las bases o los TDR. Antes sólo se miraba el bloque `servicio` del parser: con bases
    escaneadas no hay bloque y el costo mensual quedaba sin dato aunque el lector ya tenía el plazo."""
    contrato, bases = _lectura(state, "contrato", "es_contrato"), _lectura(state, "bases", "es_bases")
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    candidatos = (
        (contrato.get("plazo_dias"), "contrato (lector de Vigía)"),
        (cf.get("plazo_ejecucion_dias") if isinstance(cf, dict) else None, "contrato u orden (parser)"),
        ((srv or {}).get("plazo_total_dias"), "términos de referencia (parser)"),
        (bases.get("plazo_dias"), "bases (lector de Vigía)"),
    )
    for valor, fuente in candidatos:
        n = _entero_positivo(valor)
        if n:
            return n, fuente
    return None, None


def _mercado_historico_seace(state: dict) -> dict:
    ocds = state.get("ocds") or {}
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or "")
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    cubsos = _cubsos_del_record(ocds)
    monto, base = _monto_del_record(ocds, state, total=True)
    entidad_ruc = _entidad_ruc_del_record(ocds)
    tipos = ("servicios", "consultoria")

    comparables = _comparables_convocatorias(ocid, cubsos, objeto, tipos) if (ocid and (cubsos or objeto)) else []
    for c in comparables:
        c["misma_entidad"] = bool(entidad_ruc and c.get("entidad_ruc") == entidad_ruc)
    _publicar_grounding(state, [{"uri": c["url"], "titulo": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
                                 "origen": "bd_convocatorias"} for c in comparables])

    finding = _finding_historico(objeto, "1", monto, base, comparables)

    # Tarifas implícitas del bloque `servicio` del parser (lo produce D; si falta → sin_dato).
    raw = state.get("parser_raw_consolidated") or {}
    srv = raw.get("servicio") if isinstance(raw, dict) and isinstance(raw.get("servicio"), dict) and raw.get("servicio") else None
    plazo, plazo_fuente = _plazo_del_servicio(state, srv)
    personal = [p for p in ((srv or {}).get("personal_clave") or []) if isinstance(p, dict)]
    personal_fuente = "términos de referencia (parser)" if personal else None
    if not personal:
        personal = [p for p in (_lectura(state, "bases", "es_bases").get("personal_clave") or []) if isinstance(p, dict)]
        personal_fuente = "bases (lector de Vigía)" if personal else None
    ind: dict = ({"estado": "sin_dato", "motivo": "sin_bloque_servicio_del_parser"}
                 if not (srv or plazo or personal) else {"estado": "hallado"})
    if srv or plazo or personal:
        entregables = [e for e in ((srv or {}).get("entregables") or []) if isinstance(e, dict)]
        ind.update({"plazo_dias": plazo, "plazo_fuente": plazo_fuente,
                    "n_personal_clave": len(personal), "personal_fuente": personal_fuente,
                    "n_entregables": len(entregables),
                    "tarifas_declaradas": [t for t in ((srv or {}).get("tarifas") or []) if isinstance(t, dict)][:20]})
        # Un plazo menor a un mes no se lleva a «costo mensual»: 10 días por S/ 30 000 no son S/ 90 000 al mes.
        meses = plazo / 30.0 if (plazo and plazo >= 30) else None
        ind["costo_mensual_implicito"] = round(monto / meses, 2) if (monto and meses) else None
        ind["costo_mensual_por_persona"] = (round(monto / meses / len(personal), 2)
                                            if (monto and meses and personal) else None)
        if ind["costo_mensual_por_persona"] is not None:
            # El divisor son los CARGOS de personal clave que piden las bases, no la dotación del servicio.
            ind["costo_mensual_por_persona_base"] = "cargos de personal clave exigidos (no es el total de trabajadores)"
        ind["costo_por_entregable"] = round(monto / len(entregables), 2) if (monto and entregables) else None
        if ind["costo_mensual_implicito"] is None and ind["costo_por_entregable"] is None:
            ind["estado"] = "sin_dato"
            ind["motivo"] = ("monto_no_publico" if not monto
                             else "plazo_menor_a_un_mes" if plazo else "sin_plazo_ni_entregables_en_tdr")
    # Costo mensual contra el contrato anterior del mismo servicio en la misma entidad y contra servicios parecidos
    # (tabla servicio_costo_mensual, migración 280). Antes: «sin dato, los comparables no traen plazo».
    try:
        from .costo_mensual import bandera_costo_mensual, comparar_costo_mensual
        comp = comparar_costo_mensual(ocid, entidad_ruc, objeto, ind.get("costo_mensual_implicito"), len(personal) or None)
        ind["comparacion_tarifa_mensual"] = comp
        bandera_costo_mensual(state, comp, ocid, monto, plazo)
    except Exception as _e:  # noqa: BLE001 — la comparación nunca tumba el análisis de mercado
        ind["comparacion_tarifa_mensual"] = {"estado": "sin_dato", "motivo": f"fallo: {str(_e)[:100]}"}

    misma_ent = [c for c in comparables if c.get("misma_entidad")]
    n = len(comparables)
    obs = [f"Histórico SEACE: {n} comparable(s) ({sum(1 for c in comparables if c.get('mismo_cubso'))} por CUBSO, "
           f"{len(misma_ent)} de la misma entidad) en {MARKET_HIST_MESES} meses."]
    if monto is None:
        obs.append("El monto del proceso no es público (valor referencial reservado o sin award): no se calculó Δ%.")
    elif n < MARKET_HIST_MIN_N:
        obs.append(f"Menos de {MARKET_HIST_MIN_N} comparables: no se emite veredicto.")
    return {
        "estado": finding["estado"],
        "findings": [finding],
        "monto_base": monto, "monto_base_tipo": base,
        "cubsos": cubsos, "entidad_ruc": entidad_ruc,
        "comparables_misma_entidad": misma_ent[:10],
        "indicadores_servicio": ind,
        "total_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "total_estimado_mercado": finding["precio_mediana_mercado"],
        "sobreprecio_pct": finding["diff_pct"],
        "veredicto_global": finding["veredicto"],
        "cobertura_mercado": 1.0 if finding["veredicto"] != "sin_dato" else 0.0,
        "n_items": 1, "n_con_mediana": 1 if finding["precio_mediana_mercado"] is not None else 0,
        "confianza_global": ("alta" if n >= 2 * MARKET_HIST_MIN_N else "media" if n >= MARKET_HIST_MIN_N else "baja"),
        "observaciones_clave": obs,
        "grounding_urls": [c["url"] for c in comparables],
        "_modo": "historico_seace",
    }
