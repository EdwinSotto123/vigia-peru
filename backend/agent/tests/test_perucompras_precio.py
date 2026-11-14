"""Perú Compras como fuente de precios de bienes (tools/market/perucompras.py): candidatos con IGV, respaldo por
entidades y tope en el cuartil 3. Sin base: `_buscar` devuelve las filas que cada prueba arma."""
from __future__ import annotations

import os
import sys

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools.market import perucompras as PC  # noqa: E402
from tools.market import verificador as V  # noqa: E402
from tools.persistence.justificacion_precio import justificar  # noqa: E402

FICHA = {"ficha": "80022", "descripcion": "TONER : RENDIMIENTO: 21000 pg. NEGRO KONICA MINOLTA TN-211", "marca": "KONICA MINOLTA",
         "nro_parte": "8938415", "catalogo": "CONSUMIBLES", "anio": 2026, "lineas": 140, "entidades": 37,
         "p25": 90.0, "mediana": 100.0, "p75": 120.0}


def test_candidato_lleva_igv_respaldo_y_tope(monkeypatch):
    pedidas = []

    def _buscar(palabras, anio, limite):
        pedidas.append((palabras, anio))
        return [FICHA] if len(palabras) <= 3 else []
    monkeypatch.setattr(PC, "_buscar", _buscar)
    c = PC.candidatos_perucompras({"descripcion_corta": "Toner negro Konica Minolta TN-211 para fotocopiadora", "unidad": "Unidad"}, "2026-05-10")
    assert len(c) == 1 and pedidas[0][1] == 2026 and len(pedidas) >= 1
    x = c[0]
    assert x["precio"] == 118.0 and x["tope_referencia"] == 141.6            # sin IGV en el catálogo, con IGV en el contrato
    assert x["respaldo"] == 37 and x["origen"] == "perucompras" and x["marca"] == "KONICA MINOLTA"
    assert "mediana de 140 órdenes de 37 entidades en 2026, con IGV" in x["producto"] and "parte 8938415" in x["producto"]


def test_sin_palabras_o_sin_base_no_hay_candidatos(monkeypatch):
    monkeypatch.setattr(PC, "_buscar", lambda *a, **k: [])
    assert PC.candidatos_perucompras({"descripcion_corta": "Toner negro"}, None) == []
    assert PC.candidatos_perucompras({"descripcion_corta": ""}, None) == []


def _hallazgo(pagado, **extra):
    return {"item_descripcion": "TONER NEGRO TN-211", "cantidad": 50, "unidad": "Unidad", "precio_unitario_ofertado": pagado,
            "precio_mediana_mercado": 118.0, "precio_mediana_comparacion": 118.0, "n_precios": 1, "diff_fuente": "retail",
            "diff_pct": round((pagado - 118.0) / 118.0 * 100, 1), "veredicto": "muy_elevado",
            "precios_observados": [{"producto": "TONER TN-211 · catálogo de Perú Compras", "precio": 118.0, "origen": "perucompras",
                                    "dominio": "www.catalogos.perucompras.gob.pe", "respaldo": 37, "tope_referencia": 141.6}], **extra}


def test_una_mediana_de_catalogo_vale_sola_y_su_tope_es_el_cuartil_3():
    assert V.guardas(_hallazgo(260.0)) is None                                # 37 entidades la sostienen: no pide «3 tiendas»
    m = V.guardas(_hallazgo(140.0))                                           # +18,6 %, pero bajo el cuartil 3 (141,60)
    assert m and "dentro del rango" in m and "141.60" in m
    # Entre 15 y 22 % sobre el cuartil 3 no es «puede ser el IGV»: el catálogo ya lo trae.
    assert V.guardas(_hallazgo(142.0, diff_pct=20.3)) is None


def test_una_sola_tienda_sigue_sin_bastar():
    f = _hallazgo(260.0)
    f["precios_observados"] = [{"producto": "Toner", "precio": 118.0, "dominio": "tienda.pe"}]
    assert "hacen falta al menos" in V.guardas(f)


def test_la_justificacion_dice_cuantas_entidades():
    txt, nums = justificar({**_hallazgo(260.0), "diff_base": "ofertado"})
    assert "la referencia es S/ 118.00 (de lo que pagaron 37 entidades; catálogos electrónicos de Perú Compras" in txt
    assert nums["n_entidades_referencia"] == 37 and nums["exceso_soles"] == 7100.0
