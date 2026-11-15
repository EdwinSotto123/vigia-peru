"""La bandera de sobreprecio se justifica sola: precio pagado, referencia, cuántos precios y de dónde, y el exceso en
soles (tools/persistence/justificacion_precio.py). Antes decía sólo «42 % por encima de la mediana de mercado»."""
from __future__ import annotations

import os
import sys

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools.persistence.justificacion_precio import justificar  # noqa: E402

DIESEL = {
    "item_numero": "1", "item_descripcion": "DIESEL B5 S-50", "cantidad": 12000, "unidad": "Galón",
    "precio_unitario_ofertado": 18.5, "precio_unitario_referencial": 19.0, "precio_mediana_mercado": 13.03,
    "precio_mediana_comparacion": 13.03, "rango_min": 12.4, "rango_max": 13.9, "n_precios": 14,
    "diff_pct": 42.0, "diff_base": "ofertado", "diff_fuente": "retail", "veredicto": "elevado",
    "precios_observados": [{"origen": "osinergmin", "dominio": "osinergmin.gob.pe", "precio": 13.0}] * 14,
}


def test_combustible_con_precio_oficial():
    txt, nums = justificar(DIESEL)
    assert txt == ("Se pagó S/ 18.50 por galón; la referencia es S/ 13.03 (mediana de 14 precios; de S/ 12.40 a S/ 13.90; "
                   "precios que los grifos declaran a Osinergmin). Cantidad: 12,000. Total pagado: S/ 222,000.00; son S/ 65,640.00 más "
                   "que al precio de referencia.")
    assert nums == {"precio_pagado": 18.5, "precio_referencia": 13.03, "n_precios_referencia": 14, "referencia_min": 12.4,
                    "referencia_max": 13.9, "cantidad": 12000.0, "total_pagado": 222000.0, "exceso_soles": 65640.0}


def test_contra_compras_del_estado_usa_las_cifras_del_ancla():
    f = {**DIESEL, "diff_fuente": "ancla_regional", "precio_mediana_comparacion": 25.3, "precio_unitario_ofertado": 36.68, "cantidad": 100,
         "unidad": "Unidad", "ancla_regional": {"estado": "hallado", "n": 12, "rango_min": 22.0, "rango_max": 28.5, "mediana": 25.3}}
    txt, nums = justificar(f)
    assert "la referencia es S/ 25.30 (mediana de 12 precios; de S/ 22.00 a S/ 28.50; otras compras del Estado por el mismo bien (SEACE))" in txt
    assert nums["exceso_soles"] == 1138.0 and nums["n_precios_referencia"] == 12


def test_tiendas_se_nombran_y_el_valor_referencial_no_es_lo_pagado():
    f = {**DIESEL, "diff_base": "referencial", "cantidad": None,
         "precios_observados": [{"dominio": "www.sodimac.com.pe"}, {"dominio": "promart.pe"}, {"dominio": "sodimac.com.pe"},
                                {"dominio": "tottus.com.pe"}, {"dominio": "plazavea.com.pe"}]}
    txt, nums = justificar(f)
    assert txt.startswith("El valor referencial es S/ 19.00 por galón; la referencia es S/ 13.03")
    assert "precios publicados en sodimac.com.pe, promart.pe, tottus.com.pe y 1 más" in txt
    assert "exceso_soles" not in nums and "Total pagado" not in txt


def test_combustible_dice_cuantas_declaraciones():
    f = {**DIESEL, "n_precios": 3, "precios_observados": [
        {"origen": "osinergmin", "producto": "Diesel B5 S-50, percentil 25 de 203 declaraciones (Lima)", "precio": 12.4},
        {"origen": "osinergmin", "producto": "Diesel B5 S-50, mediana de 203 declaraciones (Lima)", "precio": 13.03},
        {"origen": "osinergmin", "producto": "Diesel B5 S-50, percentil 75 de 203 declaraciones (Lima)", "precio": 13.9}]}
    txt, nums = justificar(f)
    assert "(mediana de 203 declaraciones de precio; de S/ 12.40 a S/ 13.90; precios que los grifos declaran a Osinergmin)" in txt
    assert nums["n_declaraciones_referencia"] == 203


def test_sin_precio_o_sin_referencia_no_inventa():
    assert justificar({"precio_unitario_ofertado": 10}) == ("", {})
    assert justificar({"precio_mediana_mercado": 10}) == ("", {})
    assert justificar({}) == ("", {})


def test_lleva_lo_que_dijo_el_verificador():
    txt, _ = justificar({**DIESEL, "verificacion_precio": {"comparable": True, "motivo": "Mismo combustible y misma unidad; 14 grifos de la región."}})
    assert txt.endswith("Revisado: Mismo combustible y misma unidad; 14 grifos de la región.")


def test_los_numeros_van_en_la_bandera_para_la_verificacion():
    from tools import verify as V
    txt, nums = justificar(DIESEL)
    bandera = {"regla": "sobreprecio_elevado", "evidencia": txt, **nums}
    assert {18.5, 13.03, 222000.0, 65640.0, 12.4, 13.9} <= V._numeros_de_la_regla(bandera)
