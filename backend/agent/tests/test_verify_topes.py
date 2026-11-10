"""El verificador acepta los topes de la ley que la regla anotó (no salen de documentos ni del OCDS): antes descartaba
toda bandera de tipo_proceso_vs_monto por el umbral de S/ 485 000 (prueba de oro, 1225299)."""
from tools import verify


def test_umbral_legal_respaldado_y_monto_inventado_no():
    flag = {"regla": "tipo_proceso_vs_monto", "severidad": "alta",
            "evidencia": "Procedimiento abreviado con cuantía S/ 2,624,400.00, igual o mayor al umbral de S/ 485,000.",
            "topes_soles": {"comparacion_precios_max": 100000.0, "licitacion_publica_min": 485000.0, "uit_soles": 5500.0}}
    st = {"ocds": {"tender": {"value": {"amount": 2624400.0}}}}
    motivos = verify.verificar_bandera(dict(flag), st)["motivos"]
    assert any(m.startswith("monto:485,000") and m.endswith(":tope_legal") for m in motivos), motivos
    otra = {"regla": "x", "evidencia": "Se pagó S/ 777,777 de más."}
    assert not verify.verificar_bandera(otra, st)["ok"]


def test_topes_en_uit_tambien_en_soles():
    assert 400 * 5350.0 in verify._topes_legales({"topes_uit": {"uit_soles": 5350.0, "adjudicacion_simplificada_max": 400}})
