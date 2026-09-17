"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .config import MARKET_HIST_MESES, MARKET_HIST_MIN_N
from .historico_seace import (_comparables_convocatorias, _cubsos_del_record,
    _entidad_ruc_del_record, _finding_historico, _monto_del_record)
from .normalizar import _diff_pct, _market_to_num, _publicar_grounding

def _mercado_presupuesto_obra(state: dict) -> dict:
    ocds = state.get("ocds") or {}
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or "")
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    cubsos = _cubsos_del_record(ocds)
    monto, base = _monto_del_record(ocds, state)
    entidad_ruc = _entidad_ruc_del_record(ocds)

    raw = state.get("parser_raw_consolidated") or {}
    obra = raw.get("obra") if isinstance(raw.get("obra"), dict) else None
    et = (obra or {}).get("expediente_tecnico") if obra else None
    et = et if isinstance(et, dict) else None

    presupuesto: dict = {"estado": "sin_dato", "motivo": "sin_bloque_obra_del_parser"} if not et else {"estado": "hallado"}
    if et:
        partidas = [p for p in (et.get("partidas") or []) if isinstance(p, dict)]
        suma, inconsistentes = 0.0, []
        for p in partidas:
            parcial = _market_to_num(p.get("parcial"))
            met, pu = _market_to_num(p.get("metrado")), _market_to_num(p.get("precio_unitario"))
            calc = (met * pu) if (met and pu) else None
            if parcial is None and calc is not None:
                parcial = calc
            if parcial is not None:
                suma += parcial
            if parcial and calc and abs(parcial - calc) / max(calc, 1e-9) > 0.01:
                inconsistentes.append({"codigo": p.get("codigo"), "parcial": parcial, "metrado_x_pu": round(calc, 2)})
        total = _market_to_num(et.get("presupuesto_total"))
        gg, ut = _market_to_num(et.get("gastos_generales_pct")), _market_to_num(et.get("utilidad_pct"))
        presupuesto.update({
            "presupuesto_total": total, "n_partidas": len(partidas),
            "suma_partidas": round(suma, 2) if partidas else None,
            "diff_suma_vs_total_pct": _diff_pct(suma, total) if (partidas and total) else None,
            "partidas_inconsistentes": inconsistentes[:20],
            "gastos_generales_pct": gg, "utilidad_pct": ut,
            "gg_mas_utilidad_pct": (gg or 0) + (ut or 0) if (gg is not None or ut is not None) else None,
            "plazo_dias": et.get("plazo_dias"),
            "area_m2": _market_to_num(et.get("area_m2") or et.get("metrado_total_m2")),
        })
        presupuesto["monto_por_m2"] = (round((total or monto) / presupuesto["area_m2"], 2)
                                       if presupuesto["area_m2"] and (total or monto) else None)
        if presupuesto["monto_por_m2"] is None:
            presupuesto["monto_por_m2_estado"] = "sin_dato"
        adicionales = [a for a in ((obra or {}).get("adicionales") or []) if isinstance(a, dict)]
        ampliaciones = [a for a in ((obra or {}).get("ampliaciones_plazo") or []) if isinstance(a, dict)]
        suma_adic = sum(_market_to_num(a.get("monto")) or 0 for a in adicionales)
        ref = total or monto
        presupuesto["adicionales"] = {
            "n": len(adicionales), "monto_acumulado": round(suma_adic, 2) if adicionales else None,
            "pct_acumulado": round(suma_adic / ref * 100, 2) if (adicionales and ref) else None,
            "n_ampliaciones_plazo": len(ampliaciones),
        }

    comparables = _comparables_convocatorias(ocid, cubsos, objeto, ("obras",)) if (ocid and (cubsos or objeto)) else []
    for c in comparables:
        c["misma_entidad"] = bool(entidad_ruc and c.get("entidad_ruc") == entidad_ruc)
    _publicar_grounding(state, [{"uri": c["url"], "titulo": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
                                 "origen": "bd_convocatorias"} for c in comparables])
    monto_cmp = monto or (presupuesto.get("presupuesto_total") if et else None)
    finding = _finding_historico(objeto, "1", monto_cmp, base or ("referencial" if monto_cmp else None), comparables, unidad="Obra")

    vp = state.setdefault("validaciones_pendientes", [])
    if isinstance(vp, list) and "infobras_avance" not in vp:
        vp.append("infobras_avance")

    obs = [f"Obras similares en BD SEACE: {len(comparables)} en {MARKET_HIST_MESES} meses.",
           "Avance físico/financiero (INFOBRAS) no integrado: validación pendiente explícita."]
    if presupuesto.get("estado") == "sin_dato":
        obs.append("Sin bloque `obra` del parser: no se contrastaron partidas ni GG/utilidad.")
    return {
        "estado": "hallado" if (et or comparables) else "sin_dato",
        "findings": [finding],
        "monto_base": monto, "monto_base_tipo": base,
        "presupuesto": presupuesto,
        "cubsos": cubsos, "entidad_ruc": entidad_ruc,
        "total_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "total_estimado_mercado": finding["precio_mediana_mercado"],
        "sobreprecio_pct": finding["diff_pct"],
        "veredicto_global": finding["veredicto"],
        "cobertura_mercado": 1.0 if finding["veredicto"] != "sin_dato" else 0.0,
        "n_items": 1, "n_con_mediana": 1 if finding["precio_mediana_mercado"] is not None else 0,
        "confianza_global": ("media" if len(comparables) >= MARKET_HIST_MIN_N else "baja"),
        "validaciones_pendientes": ["infobras_avance"],
        "observaciones_clave": obs,
        "grounding_urls": [c["url"] for c in comparables],
        "_modo": "presupuesto_obra",
    }
