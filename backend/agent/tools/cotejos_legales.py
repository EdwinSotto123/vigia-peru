"""Cotejos numéricos que el agente legal recibe ya calculados (nada de aritmética en el LLM).

Experiencia del postor: el tope de proporcionalidad se mide contra el VALOR ESTIMADO de la convocatoria (OCDS
tender.value / tender.items[].totalValue), no contra el monto adjudicado. Medido 2026-10-16 en el golden set:
el agente comparaba contra lo adjudicado y marcaba "experiencia desproporcionada" en 4 contratos donde la
exigencia era 1,9×, 2,0×, 2,5× y 3,0× del valor estimado (ninguno supera 3×).
"""
from __future__ import annotations

from typing import Any

TOPE_EXPERIENCIA = 3.0


def _monto(v: Any) -> float | None:
    if isinstance(v, dict):
        v = v.get("amount")
    try:
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def cotejos_legales(state: dict) -> dict:
    ocds = state.get("ocds") if isinstance(state.get("ocds"), dict) else {}
    tender = ocds.get("tender") or {}
    total = _monto(tender.get("value"))
    items_ocds = [i for i in (tender.get("items") or []) if isinstance(i, dict)]
    da = state.get("document_analysis") if isinstance(state.get("document_analysis"), dict) else {}

    experiencia = []
    for idx, it in enumerate(da.get("items_consolidados") or []):
        if not isinstance(it, dict):
            continue
        exigida = _monto((it.get("requisitos_postor") or {}).get("experiencia_minima_soles"))
        if exigida is None:
            continue
        # Valor estimado del ítem: el del OCDS en la misma posición si hay varios; si no, el total del proceso.
        base, fuente = None, None
        if len(items_ocds) > 1 and idx < len(items_ocds):
            base, fuente = _monto(items_ocds[idx].get("totalValue")), "valor estimado del ítem (OCDS)"
        if base is None and total is not None:
            base, fuente = total, "valor estimado de la convocatoria (OCDS)"
        veces = round(exigida / base, 2) if base else None
        experiencia.append({
            "item": it.get("numero") or idx + 1,
            "experiencia_minima_soles": exigida,
            "valor_estimado": base,
            "fuente_valor": fuente,
            "veces_valor_estimado": veces,
            "supera_tope": (veces is not None and veces > TOPE_EXPERIENCIA),
            "tope": TOPE_EXPERIENCIA,
        })
    return {
        "procedimiento": {"id": tender.get("id"), "titulo": tender.get("title"), "metodo": tender.get("procurementMethodDetails")},
        "valor_estimado_total": total,
        "experiencia": experiencia,
        "nota": ("La experiencia solo es desproporcionada si supera_tope=true (más de 3 veces el valor ESTIMADO). "
                 "Nunca la compares contra el monto adjudicado u ofertado."),
    }
