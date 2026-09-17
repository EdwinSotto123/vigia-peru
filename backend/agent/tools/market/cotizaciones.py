"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .historico_seace import (_comparables_convocatorias, _cubsos_del_record,
    _finding_historico, _monto_del_record)
from .normalizar import _diff_pct, _market_to_num, _mediana, _publicar_grounding, _veredicto

def _rucs_vinculados_person_network(state: dict) -> tuple[set[str], str]:
    """RUCs de empresas vinculadas al ganador según person_network. (rucs, estado)."""
    pn = _safe_parse_json(state.get("person_network"))
    if not isinstance(pn, dict) or not pn:
        return set(), "no_verificable"
    rucs: set[str] = set()
    pp = pn.get("persona_principal") or {}
    for grupo in (pp.get("otras_empresas_vinculadas") or [], pp.get("otros_cargos_actuales") or []):
        for e in grupo:
            if isinstance(e, dict) and re.fullmatch(r"\d{11}", str(e.get("ruc") or "")):
                rucs.add(str(e["ruc"]))
    red = pn.get("red_empresarial") or {}
    for grupo in (red.get("empresas_misma_direccion") or [], red.get("empresas_mismo_titular") or []):
        for e in grupo:
            if isinstance(e, dict) and re.fullmatch(r"\d{11}", str(e.get("ruc") or "")):
                rucs.add(str(e["ruc"]))
    for lz in pn.get("lazos_entre_postores") or []:
        if isinstance(lz, dict) and lz.get("tipo_vinculo") not in (None, "sin_vinculo"):
            for k in ("postor_a", "postor_b"):
                r = str(((lz.get(k) or {}).get("ruc")) or "")
                if re.fullmatch(r"\d{11}", r):
                    rucs.add(r)
    return rucs, "hallado"


def _ganador_del_record(ocds: dict) -> tuple[str | None, str | None]:
    for a in ocds.get("awards") or []:
        if not isinstance(a, dict):
            continue
        for s in a.get("suppliers") or []:
            if isinstance(s, dict):
                m = re.search(r"(\d{11})$", str(s.get("id") or ""))
                return (m.group(1) if m else None), (s.get("name") or None)
    return None, None


def _mercado_cotizaciones(state: dict) -> dict:
    import difflib
    ocds = state.get("ocds") or {}
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or "")
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    monto, base = _monto_del_record(ocds, state)
    ganador_ruc, ganador_nombre = _ganador_del_record(ocds)

    raw = state.get("parser_raw_consolidated") or {}
    sd = raw.get("sustento_directa") if isinstance(raw.get("sustento_directa"), dict) else None
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    cots = [c for c in ((sd or {}).get("cotizaciones") or []) if isinstance(c, dict)]
    doc_sha = (sd or {}).get("documento_sha256") if sd else None

    cot_val = []
    for c in cots:
        m = _market_to_num(c.get("monto"))
        if m:
            cot_val.append({"proveedor": (c.get("proveedor") or "")[:200], "ruc": str(c.get("ruc") or "") or None,
                            "monto": m, "pagina": c.get("pagina"), "documento_sha256": c.get("documento_sha256") or doc_sha})
    n = len(cot_val)
    montos = [c["monto"] for c in cot_val]

    # Cotizante = ganador (RUC exacto o razón social muy similar).
    def _sim(a, b):
        return difflib.SequenceMatcher(None, _normalize_name_for_search(a or ""), _normalize_name_for_search(b or "")).ratio()
    cot_ganador, idx_ganador = None, None
    for i, c in enumerate(cot_val):
        if ganador_ruc and c.get("ruc") == ganador_ruc:
            cot_ganador, idx_ganador = {**c, "match": "ruc"}, i
            break
        if ganador_nombre and c.get("proveedor") and _sim(c["proveedor"], ganador_nombre) >= 0.85:
            cot_ganador, idx_ganador = {**c, "match": "razon_social"}, i
            break
    minimo = min(montos) if montos else None
    ganador_es_el_mas_barato = (cot_ganador is not None and minimo is not None and cot_ganador["monto"] <= minimo + 1e-6)

    # La base de comparación son las OTRAS cotizaciones (la del ganador es el propio monto):
    # ¿se adjudicó por encima de lo que cotizaron los demás?
    otras = [c["monto"] for i, c in enumerate(cot_val) if i != idx_ganador]
    mediana = _mediana(otras) if otras else _mediana(montos)
    n_otras = len(otras)
    diff_med = _diff_pct(monto, mediana) if (monto and n_otras >= 2) else None
    diff_min = _diff_pct(monto, min(otras)) if (monto and otras) else None
    veredicto = _veredicto(diff_med) if diff_med is not None else "sin_dato"
    motivo = None
    if not sd:
        motivo = "sin_bloque_sustento_directa_del_parser"
    elif n == 0:
        motivo = "sin_cotizaciones_en_expediente"
    elif not monto:
        motivo = "monto_adjudicado_no_publico"
    elif n_otras < 2:
        motivo = "menos_de_dos_cotizaciones_de_terceros"

    # Cotizantes vinculados entre sí o con el ganador (person_network).
    rucs_vinc, estado_vinc = _rucs_vinculados_person_network(state)
    vinculados = [c for c in cot_val if c.get("ruc") and c["ruc"] in rucs_vinc and c["ruc"] != ganador_ruc]

    evidencia = []
    for c in cot_val:
        evidencia.append({"documento": c.get("documento_sha256"), "pagina": c.get("pagina"),
                          "cita": f"Cotización {c['proveedor'] or c.get('ruc') or 's/n'}: S/ {c['monto']:,.2f}"[:240]})
    obs_precios = [{"producto": objeto[:300], "precio": c["monto"], "unidad": "cotización", "url": None, "fecha": None,
                    "proveedor": c["proveedor"] or c.get("ruc"), "moneda_origen": "PEN", "valor": c["monto"],
                    "ruc": c.get("ruc"), "es_ganador": (i == idx_ganador)}
                   for i, c in enumerate(cot_val)]
    finding = {
        "item_numero": "1", "item_descripcion": objeto[:300], "cantidad": 1, "unidad": "Contrato",
        "precio_unitario_referencial": _market_to_num(em.get("valor_referencial")),
        "precio_unitario_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "precios_observados": obs_precios, "proveedores_potenciales": [],
        "caracteristicas_solicitadas_clave": [],
        "precio_mediana_mercado": round(mediana, 2) if mediana is not None else None,
        "rango_min": round(minimo, 2) if minimo is not None else None,
        "rango_max": round(max(montos), 2) if montos else None,
        "n_precios": n, "n_cotizaciones_terceros": n_otras,
        "diff_pct": diff_med, "diff_base": base if diff_med is not None else None,
        "diff_vs_cotizacion_minima_pct": diff_min,
        "veredicto": veredicto, "es_estimacion": veredicto == "sin_dato", "motivo_estimacion": motivo,
        "estado": "hallado" if n else "sin_dato", "evidencia": evidencia[:20], "spec_restrictiva": None,
        "comentario": (f"{n} cotización(es) en el expediente de sustento ({n_otras} de terceros); "
                       f"mediana de terceros S/ {mediana:,.2f}." if n
                       else "El expediente parseado no trae cotizaciones (o el parser no produjo el bloque sustento_directa)."),
    }

    # Histórico de directas del mismo objeto como referencia adicional (BD propia).
    cubsos = _cubsos_del_record(ocds)
    comparables = _comparables_convocatorias(ocid, cubsos, objeto, ("directa", "convenio", "bienes", "servicios", "consultoria"),
                                             limit=20) if (ocid and (cubsos or objeto)) else []
    _publicar_grounding(state, [{"uri": c["url"], "titulo": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
                                 "origen": "bd_convocatorias"} for c in comparables])
    hist = _finding_historico(objeto, "1.h", monto, base, comparables, unidad="Contrato (histórico)")
    hist["item_descripcion"] = f"Histórico SEACE: {objeto[:240]}"

    obs = [f"Cotizaciones del expediente: {n}; cotizante ganador identificado: {'sí' if cot_ganador else 'no'}"
           f"{' (es la más barata)' if ganador_es_el_mas_barato else ''}."]
    if estado_vinc == "no_verificable":
        obs.append("Vínculos entre cotizantes: no verificable (sin person_network en esta corrida).")
    elif vinculados:
        obs.append(f"{len(vinculados)} cotizante(s) con RUC vinculado al ganador según person_network.")
    if motivo:
        obs.append(f"Sin veredicto: {motivo}.")
    return {
        "estado": finding["estado"],
        "findings": [finding, hist],
        "monto_base": monto, "monto_base_tipo": base,
        "ganador": {"ruc": ganador_ruc, "nombre": ganador_nombre},
        "cotizaciones": cot_val,
        "cotizante_ganador": cot_ganador,
        "ganador_es_el_mas_barato": ganador_es_el_mas_barato if cot_ganador else None,
        "cotizantes_vinculados": {"estado": estado_vinc, "items": vinculados},
        "causal": {"articulo": (sd or {}).get("causal_articulo") or em.get("causal_articulo"),
                   "texto": ((sd or {}).get("causal_texto") or em.get("causal_texto") or "")[:600] or None},
        "total_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "total_estimado_mercado": finding["precio_mediana_mercado"],
        "sobreprecio_pct": diff_med,
        "veredicto_global": veredicto,
        "cobertura_mercado": 1.0 if veredicto != "sin_dato" else 0.0,
        "n_items": 1, "n_con_mediana": 1 if mediana is not None else 0,
        "confianza_global": ("alta" if n >= 3 else "media" if n == 2 else "baja"),
        "observaciones_clave": obs,
        "grounding_urls": [c["url"] for c in comparables],
        "_modo": "cotizaciones",
    }
