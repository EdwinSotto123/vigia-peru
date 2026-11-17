"""El mercado usa los renglones de las fichas por pieza (backend/lector) cuando el lector del análisis resumió de más.

Caso real 1225937 (lubricantes): el SEACE registra UN ítem «adquisición de lubricantes» y el lector del análisis lo dejó
como «paquete de 10 productos»; el mercado buscó precio para el paquete entero (0 de 1 ítems con precio). Las fichas
por pieza traen los diez renglones: las bases con la especificación y el contrato con marca y precio unitario.
"""
from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import market as mk  # noqa: E402
from tools.market.input_building import _renglones_desde_fichas  # noqa: E402
from tests.test_market_lote1 import _Ctx, _FakeConn  # noqa: E402

CONTRATO = {"items": [
    {"numero": "1", "descripcion": "ACEITE DE MOTOR 15W40 : MOBIL DELVAC MODERN", "marca": "MOBIL", "unidad": "BALDE DE 05 GALONES",
     "cantidad": 260, "precio_unitario": 294.0, "precio_total": 76440.0, "cuadra": True},
    {"numero": "2", "descripcion": "ACEITE DE MOTOR 25W50 : VALVODIESEL", "marca": "VALVOLINE", "unidad": "BALDE DE 05 GALONES",
     "cantidad": 202, "precio_unitario": 258.0, "precio_total": 52116.0, "cuadra": True},
    {"numero": "3", "descripcion": "GRASA MULTIPROPOSITO EP2 : LITHIUM GREASE", "marca": "HESSTONE", "unidad": "BALDE DE 35 40 LIBRAS",
     "cantidad": 72, "precio_unitario": 999.0, "precio_total": 17856.0, "cuadra": False},
]}
BASES = {"items": [
    {"numero": "01", "descripcion": "Aceite de motor 15W40, API CJ-4 o superiores, en baldes de 05 galones", "unidad": "galones", "cantidad": 260},
    {"numero": "02", "descripcion": "Aceite de motor 25W50, API CF-4 o superiores, en baldes de 05 galones", "unidad": "galones", "cantidad": 202},
    {"numero": "03", "descripcion": "Grasa multipropósito EP2 NLGI2, en baldes de 35 a 40 libras", "unidad": "libras", "cantidad": 72},
]}


def test_renglones_desde_fichas_juntan_bases_y_contrato():
    r = _renglones_desde_fichas(CONTRATO, BASES)
    assert [x["numero"] for x in r] == ["1", "2", "3"]
    assert r[0]["marca_ofertada"] == "MOBIL" and r[0]["precio_unitario_ofertado"] == 294.0
    assert r[0]["origen_precio"] == "contrato_leido_por_pieza"
    assert r[0]["requerimiento_tecnico_detallado"].startswith("Aceite de motor 15W40")
    assert r[0]["unidad"] == "galones" and r[0]["cantidad"] == 260
    # Un renglón que no cuadra (cantidad × unitario ≠ total) no da precio ofertado.
    assert r[2]["precio_unitario_ofertado"] is None and r[2]["origen_precio"] is None


def test_un_solo_renglon_no_cambia_nada():
    assert _renglones_desde_fichas({"items": [CONTRATO["items"][0]]}, {"items": [BASES["items"][0]]}) == []


def test_el_mercado_precia_cada_renglon_y_no_el_paquete(monkeypatch):
    rows = {
        "from convocatoria_items where ocid=%s order by numero_item": [
            (1, "ADQUISICION DE LUBRICANTES PARA MANTENIMIENTO DE VEHICULOS", 1.0, "Unidad", 386344.0, 386344.0, "1512")],
        "join ofertas o on o.item_id": [],
        "from documento_pieza p join pieza_lectura l": [("contrato", CONTRATO), ("bases", BASES)],
    }
    fake = lambda: _FakeConn(rows)  # noqa: E731
    for mod in (mk, mk.input_building, mk.ancla_regional, mk.historico_seace):
        monkeypatch.setattr(mod, "_pg", fake)
    st = {"ocid": "1225937", "parser_raw_consolidated": {"items_consolidados": [
        {"numero": "1", "descripcion_corta": "ADQUISICION DE LUBRICANTES (paquete de 10 productos)", "cantidad": 1, "unidad": "Unidad"}]}}
    out = mk.build_market_input("1225937", _Ctx(st))
    precios = {str(it.get("descripcion_corta"))[:22]: it.get("precio_unitario_ofertado") for it in out["items"]}
    assert len(out["items"]) == 3, out["items"]
    assert precios["ACEITE DE MOTOR 15W40 "] == 294.0
    assert all("paquete" not in str(it.get("descripcion_corta")).lower() for it in out["items"])
