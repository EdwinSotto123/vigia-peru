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


# ── Depuración de las banderas del analista legal (prueba de oro de las 4 redes, 2026-11-04) ──
import json as _json
import re as _re

# Lo que ya emiten las reglas de código: repetirlo como bandera documental duplica el puntaje (5 falsas alarmas).
_RE_DUPLICA_REGLA = _re.compile(
    r"[uú]nic[oa]\s+(postor|oferta|ofertante)|oferta\s+[uú]nica|postor\s+[uú]nico|sin\s+competencia\s+efectiva|"
    r"igual\s+al?\s+(100\s*%\s+del\s+)?valor\s+(referencial|estimado)|100\s*%\s+del\s+valor", _re.I)
# Un puntaje sobre 100 por las bonificaciones de ley (MYPE 5 %, colindancia o provincia 10 %) es lo normal (3).
_RE_BONIFICACION = _re.compile(r"bonificaci[oó]n|(puntaje|puntos).{0,80}(super|por\s+encima|exce|mayor).{0,30}\b100\b", _re.I)
# Errores materiales: fechas, cronograma o transcripción que no cambian quién compite (regla 7 del prompt; 6).
_RE_ERROR_MATERIAL = _re.compile(r"^\W*incoherencia|error\s+(de\s+)?transcripci|error\s+material|podr[ií]a\s+ser\s+un\s+error", _re.I)


def depurar_banderas_legales(state: dict) -> list[dict]:
    """Quita de `legal_analysis.red_flags_documentales` lo que no es una bandera documental: la repetición de una regla
    de código (único postor, oferta igual al referencial, con vector «procedimiento»), los puntajes sobre 100 por
    bonificaciones de ley y los errores materiales de fechas o de transcripción. Devuelve lo quitado (queda en
    `legal_analysis.descartes_depuracion`). En la prueba de oro eran 14 de las 18 falsas alarmas del analista legal."""
    la = state.get("legal_analysis")
    era_str = isinstance(la, str)
    if era_str:
        try:
            la = _json.loads(la)
        except ValueError:
            return []
    if not isinstance(la, dict):
        return []
    quedan, fuera = [], []
    for rf in la.get("red_flags_documentales") or []:
        if not isinstance(rf, dict):
            quedan.append(rf)
            continue
        texto = " ".join(str(rf.get(k) or "") for k in ("descripcion", "hallazgo", "titulo"))
        vector = str(rf.get("vector") or "").lower()
        motivo = None
        if vector == "procedimiento" and _RE_DUPLICA_REGLA.search(texto):
            motivo = "repite una regla de código (único postor / oferta igual al referencial)"
        elif _RE_BONIFICACION.search(texto):
            motivo = "puntaje sobre 100 por bonificaciones de ley"
        elif vector in ("otro", "procedimiento", "") and _RE_ERROR_MATERIAL.search(texto.strip()):
            motivo = "error material sin efecto en la competencia"
        if motivo:
            fuera.append({"vector": vector, "descripcion": texto[:200], "motivo": motivo})
        else:
            quedan.append(rf)
    if fuera:
        la["red_flags_documentales"] = quedan
        la["descartes_depuracion"] = fuera
        state["legal_analysis"] = _json.dumps(la, ensure_ascii=False) if era_str else la
    return fuera
