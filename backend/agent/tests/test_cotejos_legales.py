"""Cotejo de experiencia contra el valor ESTIMADO (no el adjudicado), calculado en código para el agente legal."""
from tools.cotejos_legales import cotejos_legales


def _st(valor, exigida, items_ocds=None, adjudicado=None):
    return {"ocds": {"tender": {"id": "LP-2", "value": {"amount": valor}, "items": items_ocds or []},
                     "awards": [{"value": {"amount": adjudicado}}] if adjudicado else []},
            "document_analysis": {"items_consolidados": [{"numero": "1", "requisitos_postor": {"experiencia_minima_soles": exigida}}]}}


def test_mide_contra_valor_estimado_no_adjudicado():
    e = cotejos_legales(_st(414988.0, 800000.0, adjudicado=159781.44))["experiencia"][0]
    assert e["veces_valor_estimado"] == 1.93 and e["supera_tope"] is False


def test_exactamente_tres_veces_no_supera():
    assert cotejos_legales(_st(114600.0, 343800.0))["experiencia"][0]["supera_tope"] is False


def test_supera_y_usa_valor_del_item_si_hay_varios():
    items = [{"totalValue": {"amount": 50000.0}}, {"totalValue": {"amount": 900000.0}}]
    e = cotejos_legales(_st(950000.0, 200000.0, items_ocds=items))["experiencia"][0]
    assert e["valor_estimado"] == 50000.0 and e["veces_valor_estimado"] == 4.0 and e["supera_tope"] is True


def test_sin_datos_no_rompe():
    assert cotejos_legales({})["experiencia"] == []
