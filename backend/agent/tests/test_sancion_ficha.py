"""La sanción juzgada con la ficha del proveedor en el OECE (migración 337; A & G INDUSTRIES, 2026-2409-58)."""
from datetime import date

from tools.expediente import _sancion_oece

DEFINITIVA_2016 = {"tipo": "definitivo", "resolucion": "1621-2016-TCE-S1", "fecha_desde": "2016-07-22", "fecha_hasta": None,
                   "estado": None}


def test_ya_no_figura_y_buena_pro_desde_la_ley_32069_no_es_vigente():
    s = {**DEFINITIVA_2016, "estado_ficha": "no_figura", "fin_ficha": None, "ficha_consultada": "2026-11-17"}
    d = _sancion_oece(s, date(2026, 6, 25))
    assert d["vigente"] is False
    assert "ya no figura" in d["segun_ficha_oece"]


def test_buena_pro_anterior_a_la_ley_sigue_vigente_con_la_nota():
    s = {**DEFINITIVA_2016, "estado_ficha": "no_figura", "fin_ficha": None, "ficha_consultada": "2026-11-17"}
    d = _sancion_oece(s, date(2024, 3, 1))
    assert d["vigente"] is True
    assert "ya no figura" in d["segun_ficha_oece"]


def test_fin_segun_la_ficha_anterior_a_la_buena_pro():
    s = {"tipo": "temporal", "resolucion": "100-2024-TCE-S2", "fecha_desde": "2024-01-10", "fecha_hasta": "2027-01-10",
         "estado": "VIGENTE", "estado_ficha": "no_vigente", "fin_ficha": "2025-06-30", "ficha_consultada": "2026-11-17"}
    d = _sancion_oece(s, date(2026, 2, 1))
    assert d["vigente"] is False and d["fechaFin"] == date(2025, 6, 30)


def test_sin_ficha_como_antes():
    assert _sancion_oece(dict(DEFINITIVA_2016), date(2026, 6, 25))["vigente"] is True
