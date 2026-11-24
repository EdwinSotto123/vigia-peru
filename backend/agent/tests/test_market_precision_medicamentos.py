"""Precios de medicamentos: decimales, referencias del mismo medicamento y veredictos con respaldo (2026-11-24).

Del caso 2026-2543-197 (EsSalud, 13 medicamentos):

  1. Redondeo: los precios unitarios se guardaban con 2 decimales; S/ 0,0205 la tableta quedaba en 0,02 y el total de
     51,9 millones de tabletas se desviaba en S/ 26 000. Ahora: 2 decimales desde S/ 1, 4 cifras significativas debajo.
  2. Ancla regional: «iny» en común bastaba para que la enoxaparina fuera referencia de la hidroxocobalamina, y el
     valsartán de 80 mg tomaba de referencia el de 160 mg y «SACUBITRILO + VALSARTAN». Un medicamento solo toma
     referencias del mismo principio activo con la misma dosis.
  3. Veredictos: el valsartán salía «barato −96 %» sobre 2 compras de otras entidades. Un veredicto pide
     ≥ MARKET_MIN_PRECIOS referencias, y un Δ < −80 % no es «barato» sino no verificable.
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import market as mk  # noqa: E402
from tools.market.normalizar import (_firma_medicamento, _fmt_precio, _mismo_medicamento,  # noqa: E402
                                     _precio_redondeado, _solape_raices)
from tests.test_market_lote1 import _fake_fanout, _precio, _ref, _run_retail  # noqa: E402


def _item(numero, descr, cantidad, ofertado, cubso=None):
    return {"numero": numero, "descripcion_corta": descr, "cantidad": cantidad, "unidad": "Unidad",
            "precio_unitario_ofertado": ofertado, "origen_precio": "oferta_ganadora_bd",
            "precio_unitario_referencial": None, "cuantia_referencial_item": None, "padre_ocds_item": None,
            "cubso": cubso}


def _refs_por_descr(monkeypatch, refs_por_palabra: dict[str, list[dict]]):
    """Referencias internas según el ítem (la consulta real filtra por CUBSO; acá, por una palabra del ítem)."""
    def _f(ocid, cubsos, descr, **kw):
        d = (descr or "").upper()
        return [r for k, v in refs_por_palabra.items() if k in d for r in v]
    monkeypatch.setattr(mk.goods_retail, "_consultar_referencias_internas", _f)


def _st(items, total=None, base=None):
    return {"ocid": "1", "ocds": {"ocid": "1", "tender": {"description": "PRODUCTOS FARMACEUTICOS"}},
            "market_input": {"ocid": "1", "items": items, "padre_lote": None, "total_ofertado": total,
                             "total_ofertado_base": base, "cuantia_referencial_total": None}}


# ═════════════════════════════════════════════════════════════════════
# 1 · Redondeo de precios unitarios
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("x,esperado", [
    (0.0205, 0.0205), (0.041666, 0.04167), (0.36, 0.36), (0.0004567, 0.0004567),
    (2.0085, 2.01), (14.987, 14.99), (1234.567, 1234.57), (0, 0.0),
])
def test_precio_redondeado(x, esperado):
    assert _precio_redondeado(x) == esperado


def test_fmt_precio():
    assert [_fmt_precio(x) for x in (0.0205, 0.36, 0.5, 2.0085, 1234.5)] == ["0.0205", "0.36", "0.50", "2.01", "1,234.50"]


def test_mediana_y_total_de_lote_sin_perder_los_decimales(monkeypatch):
    """Ácido fólico a S/ 0,0205 contra tiendas a 0,0205-0,0215: la mediana es 0,021 (no 0,02) y el total de mercado
    de 51,9 M de tabletas no pierde S/ 52 000."""
    items = [_item("1", "ACIDO FOLICO 500 mcg (0.5 mg) TAB", 51933400, 0.0205),
             _item("2", "ATORVASTATINA 20 mg TAB", 37995772, 0.0388)]
    precios = [_precio("1", f"Acido folico 0.5 mg tableta {i}", p, "unidad", f"farma{i}.pe")
               for i, p in enumerate([0.0205, 0.021, 0.0215])]
    precios += [_precio("2", f"Atorvastatina 20 mg tableta {i}", p, "unidad", f"botica{i}.pe")
                for i, p in enumerate([0.0385, 0.039, 0.0395])]
    res, _ = _run_retail(monkeypatch, items, precios, total_ofertado=2538870.65, base="adjudicado")
    folico = next(f for f in res["findings"] if f["item_numero"] == "1")
    assert folico["precio_mediana_mercado"] == 0.021 and folico["rango_min"] == 0.0205 and folico["rango_max"] == 0.0215
    assert sorted(p["precio"] for p in folico["precios_observados"]) == [0.0205, 0.021, 0.0215]
    assert any("S/ 0.0215/" in e["cita"] for e in folico["evidencia"])
    assert folico["diff_pct"] == pytest.approx(-2.38, abs=0.01) and folico["veredicto"] == "alineado"
    lote = res["lote"]
    assert lote["total_mercado_respaldados"] == pytest.approx(51933400 * 0.021 + 37995772 * 0.039, abs=1)
    assert lote["total_ofertado_respaldados"] == pytest.approx(51933400 * 0.0205 + 37995772 * 0.0388, abs=1)


# ═════════════════════════════════════════════════════════════════════
# 2 · Referencias del mismo medicamento
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("item,ref,mismo", [
    ("VALSARTAN 80 mg TAB", "VALSARTAN 80 mg TAB", True),
    ("VALSARTAN 80 mg TAB", "VALSARTAN 160 mg TAB", False),
    ("VALSARTAN 80 mg TAB", "SACUBITRILO + VALSARTAN 24 mg / 26 mg (24.3 mg/25.7 mg) TAB", False),
    ("HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", "ENOXAPARINA SODICA 60 mg INY 0,6 mL", False),
    ("HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", "HIDROXOCOBALAMINA 1 MG/ML X 1 ML INY", True),
    ("ENOXAPARINA SODICA 60 mg INY 0,6 mL", "ENOXAPARINA SÓDICA 100 mg/mL INY 0.6 mL", True),
    ("ENOXAPARINA SODICA 60 mg INY 0,6 mL", "ENOXAPARINA SODICA 40 mg INY 0,4 mL", False),
    ("CAFEINA CITRATO 20 mg/mL AMP 1 mL", "CAFEINA CITRATO 20MG/ML - INYECT - 1ML", True),
    ("ACIDO FOLICO 500 mcg (0.5 mg) TAB", "ACIDO FOLICO 0.5 mg TAB", True),
    ("ACIDO FOLICO 500 mcg (0.5 mg) TAB", "ACIDO VALPROICO 500 mg TAB", False),
    ("NIFEDIPINO 30 mg TAB LIB PRO", "NIFEDIPINO 30 mg TAB", False),
    ("SODIO CLORURO 0,9 % (900 mg/100 mL) INY 100 mL", "CLORURO DE SODIO 0.9% INY 100 mL", True),
    ("EPOETINA ALFA (ERITROPOYETINA) 2000 UI/mL INY 1 mL", "EPOETINA ALFA 2000 UI INY 1 mL", True),
    # La descripción larga del parser también encuentra su referencia.
    ("ÍTEM N° 7: ENALAPRIL, 10 mg, TABLETA RECUBIERTA, BLISTER", "ENALAPRIL 10 mg TAB", True),
])
def test_mismo_medicamento(item, ref, mismo):
    assert _mismo_medicamento(_firma_medicamento(item), _firma_medicamento(ref)) is mismo


def test_lo_que_no_es_medicamento_sigue_con_el_solape():
    for t in ("PIEDRA GRANDE DE 10 A 12 PULGADAS", "ARROZ SUPERIOR", "LECHE EVAPORADA 400 g", "ALCOHOL ETILICO 70% x 1 L"):
        assert _firma_medicamento(t) is None
    # Unidades y formas ya no cuentan como palabras en común.
    assert _solape_raices("HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", "ENOXAPARINA SODICA 60 mg INY 0,6 mL") == 0.0
    assert _solape_raices("ARROZ SUPERIOR", "ARROZ SUPERIOR EXTRA X 50 KG") == 1.0


def _ctx(it):
    return mk._contexto_unidad_item(it)


def test_ancla_del_valsartan_solo_con_valsartan_de_80_mg():
    it = _item("2", "VALSARTAN 80 mg TAB", 24319766, 0.0736, cubso="C-VALS")
    refs = [{**_ref("2026-1003000933-1", "VALSARTAN 160 mg TAB", 0.6, 0.487, unidad="Unidad"), "cubso": "C-VALS"},
            {**_ref("1233824", "SACUBITRILO + VALSARTAN 24 mg / 26 mg (24.3 mg/25.7 mg) TAB", 3.6, 3.53,
                    unidad="Unidad"), "cubso": "C-VALS"},
            _ref("A1", "VALSARTAN 80 mg TAB", 0.08, 0.071, unidad="Unidad"),
            _ref("A2", "VALSARTAN 80 MG TABLETA", 0.08, 0.075, unidad="Unidad"),
            _ref("A3", "VALSARTAN 80 mg TAB", 0.09, 0.08, unidad="Unidad")]
    ancla, usables = mk._ancla_regional_item(it, refs, 0.0736, _ctx(it))
    assert [r["ocid"] for r in usables] == ["A1", "A2", "A3"]
    assert ancla["estado"] == "hallado" and ancla["mediana"] == 0.075 and ancla["veredicto_regional"] == "alineado_regional"


def test_ancla_de_la_hidroxocobalamina_sin_enoxaparina():
    it = _item("13", "HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", 5377000, 0.5)
    enox = [_ref(f"E{i}", d, 15.0, 14.0, unidad="Unidad") for i, d in enumerate([
        "ENOXAPARINA SÓDICA 100 mg/mL INY 0.6 mL", "ENOXAPARINA SODICA 40 mg INY 0,4 mL",
        "ENOXAPARINA SODICA 60 mg INY 0,6 mL"])]
    hidroxo = [_ref(f"H{i}", "HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", 0.6, p, unidad="Unidad")
               for i, p in enumerate([0.52, 0.55, 0.6])]
    ancla, usables = mk._ancla_regional_item(it, enox + hidroxo, 0.5, _ctx(it))
    assert {r["ocid"] for r in usables} == {"H0", "H1", "H2"}
    assert ancla["mediana"] == 0.55


def test_ancla_de_un_bien_comun_no_cambia():
    it = {"numero": "1", "descripcion_corta": "ARROZ SUPERIOR", "cantidad": 1000, "unidad": "KG"}
    refs = [_ref(f"R{i}", "ARROZ SUPERIOR X 50 KG", 3.9, p, unidad="Kilogramo") for i, p in enumerate([3.8, 4.0, 4.1])]
    ancla, usables = mk._ancla_regional_item(it, refs, 4.0, _ctx(it))
    assert len(usables) == 3 and ancla["estado"] == "hallado"


# ═════════════════════════════════════════════════════════════════════
# 3 · Veredictos con respaldo suficiente
# ═════════════════════════════════════════════════════════════════════
def test_ancla_con_menos_de_tres_referencias_es_contexto():
    it = _item("2", "VALSARTAN 80 mg TAB", 24319766, 0.0736)
    dos = [_ref("A1", "VALSARTAN 80 mg TAB", 2.0, 0.487, unidad="Unidad"),
           _ref("A2", "VALSARTAN 80 mg TAB", 3.6, 3.53, unidad="Unidad")]
    ancla, _ = mk._ancla_regional_item(it, dos, 0.0736, _ctx(it))
    assert ancla["estado"] == "insuficiente" and ancla["n"] == 2 and "veredicto_regional" not in ancla
    # 2 del departamento + 1 de otro: decide el ámbito nacional con 3.
    tres = dos + [_ref("A3", "VALSARTAN 80 mg TAB", 2.5, 2.4, unidad="Unidad", misma_region=False)]
    ancla, _ = mk._ancla_regional_item(it, tres, 0.0736, _ctx(it))
    assert ancla["estado"] == "hallado" and ancla["ambito"] == "nacional" and ancla["n"] == 3


def test_valsartan_con_dos_compras_no_es_barato(monkeypatch):
    """El caso real: sin precios de tiendas y 2 compras de otras entidades → sin veredicto (antes «barato −96 %»)."""
    _refs_por_descr(monkeypatch, {"VALSARTAN": [_ref("A1", "VALSARTAN 80 mg TAB", 2.0, 0.487, unidad="Unidad"),
                                                _ref("A2", "VALSARTAN 80 mg TAB", 3.6, 3.53, unidad="Unidad")]})
    _fake_fanout(monkeypatch, [], sin_precios={"2"})
    f = mk._mercado_goods_retail(_st([_item("2", "VALSARTAN 80 mg TAB", 24319766, 0.0736)]))["findings"][0]
    assert f["veredicto"] == "sin_dato" and f["diff_pct"] is None and f["ancla_regional"]["n"] == 2


def test_delta_muy_negativo_contra_tiendas_no_es_barato(monkeypatch):
    """S/ 0,0205 la tableta contra S/ 0,50 de botica (−96 %): otra presentación o un precio mal asignado."""
    precios = [_precio("1", f"Acido folico 0.5 mg tableta {i}", p, "unidad", f"botica{i}.pe")
               for i, p in enumerate([0.45, 0.5, 0.55])]
    res, st = _run_retail(monkeypatch, [_item("1", "ACIDO FOLICO 500 mcg (0.5 mg) TAB", 51933400, 0.0205)], precios)
    f = res["findings"][0]
    assert f["diff_pct_retail"] < -80 and f["veredicto_retail"] == "barato"
    assert f["veredicto"] == "no_verificable" and f["estado"] == "no_verificable"
    assert f["motivo_estimacion"] == "delta_implausible_bajo_mercado"
    assert any(d.get("motivo") == "delta_implausible_bajo" for d in st["descartes"])


def test_delta_muy_negativo_contra_compras_del_estado_no_es_barato(monkeypatch):
    _refs_por_descr(monkeypatch, {"VALSARTAN": [_ref(f"A{i}", "VALSARTAN 80 mg TAB", 2.0, p, unidad="Unidad")
                                                for i, p in enumerate([1.9, 2.0, 2.1])]})
    _fake_fanout(monkeypatch, [], sin_precios={"2"})
    st = _st([_item("2", "VALSARTAN 80 mg TAB", 24319766, 0.0736)])
    f = mk._mercado_goods_retail(st)["findings"][0]
    assert f["ancla_regional"]["estado"] == "hallado" and f["diff_pct"] < -80
    assert f["veredicto"] == "no_verificable" and f["motivo_estimacion"] == "delta_implausible_bajo_compras_del_estado"


def test_tiendas_muy_caras_se_descartan_si_hay_compras_del_estado(monkeypatch):
    """Botica a S/ 1 la tableta (−93 %) pero 3 compras del Estado del mismo medicamento: se compara contra ellas."""
    _refs_por_descr(monkeypatch, {"VALSARTAN": [_ref(f"A{i}", "VALSARTAN 80 mg TAB", 0.12, p, unidad="Unidad")
                                                for i, p in enumerate([0.10, 0.11, 0.12])]})
    precios = [_precio("2", f"Valsartan 80 mg tableta {i}", p, "unidad", f"botica{i}.pe") for i, p in enumerate([0.9, 1.0, 1.1])]
    _fake_fanout(monkeypatch, precios)
    f = mk._mercado_goods_retail(_st([_item("2", "VALSARTAN 80 mg TAB", 24319766, 0.0736)]))["findings"][0]
    assert f["retail_descartado"] is True and f["diff_fuente"] == "ancla_regional"
    assert f["veredicto"] == "barato" and f["diff_pct"] == pytest.approx(-33.1, abs=0.1)
