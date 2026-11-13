"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from tools.privacidad import es_persona_natural, tapar_nombre
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


def _ruc11(v) -> str | None:
    """El RUC como 11 dígitos: el parser lo copia como viene («RUC N° 20123456789», «20-12345678-9», con espacios).
    Comparado tal cual nunca era igual al del adjudicatario y su propia cotización contaba como «de terceros»."""
    d = re.sub(r"\D", "", str(v or ""))
    return d if len(d) == 11 else None


def _periodos(monto, cotizado) -> int | None:
    """k si el monto adjudicado es un múltiplo entero exacto (2 a 60, ±0,5 %) de lo cotizado: la cotización es por
    mes o por cuota (un alquiler de S/ 5 000 al mes por 36 meses = S/ 180 000) y no se compara contra el total."""
    try:
        k = float(monto) / float(cotizado)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    r = round(k)
    return int(r) if (2 <= r <= 60 and abs(k - r) <= 0.005 * r) else None


def _publico(c: dict, natural: bool) -> dict:
    """La cotización como se publica: una persona natural va con un apellido tapado y sin su RUC 10."""
    if not natural:
        return dict(c)
    return {**c, "ruc": None, "proveedor": tapar_nombre(c.get("proveedor")) or ""}


def _sustento(sd: dict | None, nombres: set[str]) -> dict | None:
    """Lo que el expediente de sustento trae además de las cotizaciones (informes, acto que aprueba la directa,
    por qué un solo proveedor, las partes del convenio), para la sección del dictamen: el bloque del parser no viaja
    por otro camino. Quien firma un informe es una persona natural: un apellido tapado."""
    if not sd:
        return None
    out: dict = {}
    for k in ("informe_tecnico", "informe_legal", "acto_aprobatorio"):
        v = sd.get(k)
        if isinstance(v, dict) and any(x not in (None, "", [], {}) for x in v.values()):
            v = dict(v)
            if v.get("firmante"):
                nombres.add(str(v["firmante"]))
                v["firmante"] = tapar_nombre(str(v["firmante"]))
            out[k] = v
    for k in ("proveedor_unico_justificacion", "fecha_publicacion_seace"):
        if sd.get(k):
            out[k] = str(sd[k])[:600]
    conv = sd.get("convenio")
    if isinstance(conv, dict) and any(x not in (None, "", [], {}) for x in conv.values()):
        out["convenio"] = conv
    return out or None


def _mercado_cotizaciones(state: dict) -> dict:
    import difflib
    ocds = state.get("ocds") or {}
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or "")
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    monto, base = _monto_del_record(ocds, state, total=True)
    ganador_ruc, ganador_nombre = _ganador_del_record(ocds)
    ganador_natural = es_persona_natural(ganador_ruc)
    nombres_tapar: set[str] = set()
    if ganador_natural and ganador_nombre:
        nombres_tapar.add(ganador_nombre)

    raw = state.get("parser_raw_consolidated") or {}
    sd = raw.get("sustento_directa") if isinstance(raw.get("sustento_directa"), dict) else None
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    cots = [c for c in ((sd or {}).get("cotizaciones") or []) if isinstance(c, dict)]
    doc_sha = (sd or {}).get("documento_sha256") if sd else None

    def _sim(a, b):
        return difflib.SequenceMatcher(None, _normalize_name_for_search(a or ""), _normalize_name_for_search(b or "")).ratio()

    def _misma(a: dict, b: dict) -> bool:
        """La misma cotización citada en dos documentos (informe técnico, informe legal, resolución): mismo monto y
        mismo cotizante (RUC, o razón social si alguno no trae RUC). El bloque del parser las suma sin fundirlas."""
        if abs(a["monto"] - b["monto"]) > 0.005:
            return False
        if a.get("ruc") and b.get("ruc"):
            return a["ruc"] == b["ruc"]
        return bool(a.get("proveedor") and b.get("proveedor")) and _sim(a["proveedor"], b["proveedor"]) >= 0.85

    cot_val = []
    for c in cots:
        m = _market_to_num(c.get("monto"))
        if m:
            nueva = {"proveedor": (c.get("proveedor") or "")[:200], "ruc": _ruc11(c.get("ruc")),
                     "monto": m, "pagina": c.get("pagina"), "documento_sha256": c.get("documento_sha256") or doc_sha}
            previa = next((p for p in cot_val if _misma(p, nueva)), None)
            if previa is None:
                cot_val.append(nueva)
            elif not previa.get("ruc"):
                previa["ruc"] = nueva["ruc"]
    n = len(cot_val)
    montos = [c["monto"] for c in cot_val]

    # Cotizante = ganador (RUC exacto o razón social muy similar). Todas las suyas: si cotizó dos montos, la segunda
    # no es «de terceros».
    cot_ganador, idx_ganador, idx_ganadores = None, None, set()
    for i, c in enumerate(cot_val):
        match = ("ruc" if (ganador_ruc and c.get("ruc") == ganador_ruc) else
                 "razon_social" if (ganador_nombre and c.get("proveedor") and _sim(c["proveedor"], ganador_nombre) >= 0.85)
                 else None)
        if match:
            idx_ganadores.add(i)
            if cot_ganador is None:
                cot_ganador, idx_ganador = {**c, "match": match}, i
    minimo = min(montos) if montos else None
    ganador_es_el_mas_barato = (cot_ganador is not None and minimo is not None and cot_ganador["monto"] <= minimo + 1e-6)

    # Personas naturales entre los cotizantes (RUC 10, o el adjudicatario con RUC 10 reconocido por su nombre).
    naturales = [es_persona_natural(c.get("ruc")) or (i in idx_ganadores and ganador_natural) for i, c in enumerate(cot_val)]
    for c, nat in zip(cot_val, naturales):
        if nat and c.get("proveedor"):
            nombres_tapar.add(c["proveedor"])
    publicas = [_publico(c, nat) for c, nat in zip(cot_val, naturales)]

    # Misma unidad: si el adjudicado es k veces exactas lo que cotizó el ganador (o, sin ganador reconocido, k veces
    # una de las cotizaciones), las cotizaciones son por mes o por cuota y el adjudicado se lleva a esa unidad.
    periodos = None
    if monto and cot_ganador:
        periodos = _periodos(monto, cot_ganador["monto"])
    elif monto and cot_val and max(montos) * 1.9 < monto:
        # Sin ganador reconocido sólo se infiere si TODAS las cotizaciones quedan muy por debajo del adjudicado
        # (si una lo iguala, esa es la del ganador y las demás son simplemente más baratas).
        periodos = next((k for k in (_periodos(monto, c["monto"]) for c in cot_val) if k), None)
    monto_cmp = (monto / periodos) if (monto and periodos) else monto

    # La base de comparación son las OTRAS cotizaciones (la del ganador es el propio monto):
    # ¿se adjudicó por encima de lo que cotizaron los demás?
    otras = [c["monto"] for i, c in enumerate(cot_val) if i not in idx_ganadores]
    n_otras = len(otras)
    # Sin cotizaciones de terceros no hay mediana: la del propio adjudicatario no es una referencia de mercado.
    mediana = _mediana(otras) if otras else None
    diff_med = _diff_pct(monto_cmp, mediana) if (monto_cmp and n_otras >= 2) else None
    diff_min = _diff_pct(monto_cmp, min(otras)) if (monto_cmp and otras) else None
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
    vinculados = [p for c, p in zip(cot_val, publicas) if c.get("ruc") and c["ruc"] in rucs_vinc and c["ruc"] != ganador_ruc]

    evidencia = []
    for c in publicas:
        evidencia.append({"documento": c.get("documento_sha256"), "pagina": c.get("pagina"),
                          "cita": f"Cotización {c['proveedor'] or c.get('ruc') or 's/n'}: S/ {c['monto']:,.2f}"[:240]})
    obs_precios = [{"producto": objeto[:300], "precio": c["monto"], "unidad": "cotización", "url": None, "fecha": None,
                    "proveedor": c["proveedor"] or c.get("ruc"), "moneda_origen": "PEN", "valor": c["monto"],
                    "ruc": c.get("ruc"), "es_ganador": (i in idx_ganadores)}
                   for i, c in enumerate(publicas)]
    if not n:
        comentario = "El expediente parseado no trae cotizaciones (o el parser no produjo el bloque sustento_directa)."
    elif not n_otras:
        comentario = (f"{n} cotización(es) en el expediente de sustento, todas del proveedor adjudicado: "
                      f"no hay cotizaciones de terceros contra las cuales comparar.")
    else:
        comentario = (f"{n} cotización(es) en el expediente de sustento ({n_otras} de terceros); "
                      f"mediana de terceros S/ {mediana:,.2f}.")
    if periodos:
        comentario += (f" El monto adjudicado equivale a {periodos} veces lo cotizado: las cotizaciones son por periodo "
                       f"(mes o cuota) y la comparación se hace por periodo (S/ {monto_cmp:,.2f}).")
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
        "periodos_inferidos": periodos, "monto_comparado": round(monto_cmp, 2) if monto_cmp else None,
        "diff_pct": diff_med, "diff_base": base if diff_med is not None else None,
        # Contra qué se midió: cotizaciones del propio expediente, no precios de mercado.
        "diff_fuente": "cotizaciones_expediente" if diff_med is not None else None,
        "diff_vs_cotizacion_minima_pct": diff_min,
        "veredicto": veredicto, "es_estimacion": veredicto == "sin_dato", "motivo_estimacion": motivo,
        "estado": "hallado" if n else "sin_dato", "evidencia": evidencia[:20], "spec_restrictiva": None,
        "comentario": comentario,
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
    if cot_ganador and not ganador_es_el_mas_barato:
        obs.append(f"La cotización del adjudicatario (S/ {cot_ganador['monto']:,.2f}) no es la más baja del expediente "
                   f"(S/ {minimo:,.2f}).")
    if n and not n_otras:
        obs.append("Todas las cotizaciones del expediente son del proveedor adjudicado: no consta indagación con terceros.")
    if estado_vinc == "no_verificable":
        obs.append("Vínculos entre cotizantes: no verificable (sin person_network en esta corrida).")
    elif vinculados:
        obs.append(f"{len(vinculados)} cotizante(s) con RUC vinculado al ganador según person_network.")
    if motivo:
        obs.append(f"Sin veredicto: {motivo}.")

    sustento = _sustento(sd, nombres_tapar)
    if nombres_tapar:
        # El nombre en claro queda sólo acá, para tapar el dictamen (igual que tools/lecturas.py).
        state["_nombres_tapar"] = sorted({*(state.get("_nombres_tapar") or []), *nombres_tapar})
    cot_ganador_pub = ({**publicas[idx_ganador], "match": cot_ganador["match"]} if cot_ganador else None)
    return {
        "estado": finding["estado"],
        "findings": [finding, hist],
        "monto_base": monto, "monto_base_tipo": base,
        "ganador": {"ruc": None if ganador_natural else ganador_ruc,
                    "nombre": tapar_nombre(ganador_nombre) if ganador_natural else ganador_nombre},
        "cotizaciones": publicas,
        "cotizante_ganador": cot_ganador_pub,
        "ganador_es_el_mas_barato": ganador_es_el_mas_barato if cot_ganador else None,
        "cotizantes_vinculados": {"estado": estado_vinc, "items": vinculados},
        "causal": {"articulo": (sd or {}).get("causal_articulo") or em.get("causal_articulo"),
                   "texto": ((sd or {}).get("causal_texto") or em.get("causal_texto") or "")[:600] or None},
        "sustento": sustento,
        "total_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "total_estimado_mercado": (round(mediana * periodos, 2) if (mediana is not None and periodos)
                                   else finding["precio_mediana_mercado"]),
        "sobreprecio_pct": diff_med,
        "veredicto_global": veredicto,
        "cobertura_mercado": 1.0 if veredicto != "sin_dato" else 0.0,
        "n_items": 1, "n_con_mediana": 1 if mediana is not None else 0,
        "confianza_global": ("alta" if n >= 3 else "media" if n == 2 else "baja"),
        "observaciones_clave": obs,
        "grounding_urls": [c["url"] for c in comparables],
        "_modo": "cotizaciones",
    }
