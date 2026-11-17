"""La comprobación sin modelo de la ficha del contrato (lector/por_pieza.py)."""
from lector.por_pieza import aritmetica_contrato


def test_renglones_y_suma_cuadran():
    # Dos renglones reales del contrato 068-2026 (proceso 1225937).
    s = {"items": [{"cantidad": 260, "precio_unitario": 294.0, "precio_total": 76440.0},
                   {"cantidad": 20, "precio_unitario": 310.2, "precio_total": 6204.0}],
         "monto_total": {"valor": 82644.0}}
    r = aritmetica_contrato(s)
    assert r == {"renglones": 2, "renglones_ok": 2, "suma_items": 82644.0, "monto": 82644.0, "suma_cuadra": True}
    assert all(it["cuadra"] for it in s["items"])


def test_un_renglon_que_no_cuadra_no_pasa():
    s = {"items": [{"cantidad": 10, "precio_unitario": 5.0, "precio_total": 80.0}], "monto_total": {"valor": 80.0}}
    r = aritmetica_contrato(s)
    assert r["renglones_ok"] == 0 and s["items"][0]["cuadra"] is False


def test_sin_tabla_no_hay_suma():
    assert aritmetica_contrato({"items": [], "monto_total": {"valor": 100.0}})["suma_cuadra"] is None
