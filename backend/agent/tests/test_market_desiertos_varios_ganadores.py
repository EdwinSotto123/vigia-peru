"""Mercado de un proceso por ítems con desiertos y varios ganadores (caso real 2026-2543-197, EsSalud, 2026-11-24).

13 medicamentos, 11 adjudicados a 8 ganadores con 8 contratos y 2 desiertos. El arreglo tender.items[] del OCDS no
viene en el orden de `position` y `convocatoria_items.numero_item` es el índice del arreglo (tools/ocds.py). El
análisis guardado tenía cuatro errores que estos tests reproducen con una versión chica del caso (5 ítems):

  1. Precio adjudicado por `position` en vez del ítem: la cafeína (ítem 1 del registro, position 5, DESIERTA) recibía
     el precio del ácido fólico (position 1) y la hidroxocobalamina (ítem 13, DESIERTA) el del valsartán (position 13).
  2. Los ítems desiertos se comparaban con el mercado y sumaban al lote.
  3. El valsartán entraba al total del lote con una mediana de S/ 2,01 sostenida por dos compras de otras entidades
     (0 precios de tiendas) y el lote salía −81 % «barato».
  4. El total ofertado del proceso era UNO de los contratos (el de la enoxaparina, S/ 3 272 119,05).
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
from tools.market.goods_retail import _mediana_de_lote  # noqa: E402
from tools.market.input_building import _items_sin_adjudicar_ocds  # noqa: E402
from tests.test_market_lote1 import _Ctx, _fake_fanout, _fake_pg, _precio, _ref  # noqa: E402


# ── Fixture: 5 ítems; el arreglo no sigue `position` ─────────────────
# índice (numero_item) | position | ítem               | estado
#          1           |    4     | cafeína            | DESIERTO
#          2           |    5     | valsartán          | CONTRATADO  (ganador B)
#          3           |    3     | atorvastatina 20   | CONSENTIDO  (ganador B)
#          4           |    1     | ácido fólico       | CONTRATADO  (ganador A)
#          5           |    2     | hidroxocobalamina  | DESIERTO
_TENDER = [
    ("21236577", "4", "CAFEINA CITRATO 20 mg/mL AMP 1 mL", 23952, 118514.5, "unsuccessful", "DESIERTO"),
    ("21236576", "5", "VALSARTAN 80 mg TAB", 24319766, 7709365.82, "complete", "CONTRATADO"),
    ("21236575", "3", "ATORVASTATINA 20 mg TAB", 37995772, 4065547.6, "complete", "CONSENTIDO"),
    ("21236568", "1", "ACIDO FOLICO 500 mcg (0.5 mg) TAB", 51933400, 4777872.8, "complete", "CONTRATADO"),
    ("21236565", "2", "HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", 5377000, 4462910.0, "unsuccessful", "DESIERTO"),
]
_ADJ = {"21236576": 1790000.0, "21236575": 1474235.95, "21236568": 1064634.7}   # monto adjudicado por ítem
_TOTAL_ADJ = round(sum(_ADJ.values()), 2)                                          # 4 328 870,65
_PU = {"2": 0.0736, "3": 0.0388, "4": 0.0205}                                      # monto / cantidad (4 decimales)


def _ocds_caso(con_ids_en_awards=True, estados=True):
    por_id = {t[0]: t for t in _TENDER}

    def _ai(iid):
        t = por_id[iid]
        ai = {"position": t[1], "description": t[2], "quantity": t[3], "status": "active", "statusDetails": t[6],
              "totalValue": {"amount": _ADJ[iid], "currency": "PEN"}}
        if con_ids_en_awards:
            ai["id"] = iid
        return ai
    tender_items = []
    for iid, pos, descr, qty, tot, st, det in _TENDER:
        it = {"id": iid, "position": pos, "description": descr, "quantity": qty, "unit": {"name": "Unidad"},
              "classification": {"id": f"5115{iid}", "scheme": "CUBSO"}, "totalValue": {"amount": tot}}
        if estados:
            it.update({"status": st, "statusDetails": det})
        tender_items.append(it)
    return {
        "ocid": "ocds-dgv273-seacev3-2026-2543-197",
        "tender": {"description": "ADQUISICION DE PRODUCTOS FARMACEUTICOS", "items": tender_items,
                   "value": {"amount": round(sum(t[4] for t in _TENDER), 2)}},
        "awards": [
            {"id": "1201045-20100018625", "value": {"amount": _ADJ["21236568"]}, "items": [_ai("21236568")]},
            {"id": "1201045-20347268683", "value": {"amount": _ADJ["21236576"] + _ADJ["21236575"]},
             "items": [_ai("21236576"), _ai("21236575")]},
        ],
        "contracts": [
            {"id": "2433288", "awardID": "1201045-20100018625", "value": {"amount": _ADJ["21236568"]}},
            {"id": "2426898", "awardID": "1201045-20347268683", "value": {"amount": _ADJ["21236576"]}},
            {"id": "2426899", "awardID": "1201045-20347268683", "value": {"amount": _ADJ["21236575"]}},
        ],
    }


# Filas de convocatoria_items como las escribe tools/ocds.py: numero_item = índice del arreglo.
_SQL = [(i, t[2], float(t[3]), "Unidad", t[4] / t[3], t[4], f"5115{t[0]}") for i, t in enumerate(_TENDER, start=1)]
# Ofertas ganadoras de la BD (join por item_id): solo los ítems adjudicados.
_OFERTAS = [(2, _ADJ["21236576"]), (3, _ADJ["21236575"]), (4, _ADJ["21236568"])]


def _state(ocds=None):
    # El contrato leído de los documentos es uno de los tres (como en prod, donde se leyó el de la enoxaparina).
    return {"ocid": "2026-2543-197", "ocds": ocds or _ocds_caso(),
            "contrato_final": {"precio_final_total": _ADJ["21236576"], "moneda": "SOLES"}}


# ═════════════════════════════════════════════════════════════════════
# 1 · precio adjudicado por ítem (id OCDS ↔ índice del arreglo), nunca por position
# ═════════════════════════════════════════════════════════════════════
def test_award_items_se_indexan_por_el_indice_del_tender_no_por_position():
    assert mk._award_items_ocds(_ocds_caso()) == _PU
    # Sin id en awards[].items[]: se ubica por descripción (y cantidad), tampoco por position.
    assert mk._award_items_ocds(_ocds_caso(con_ids_en_awards=False)) == _PU


def test_award_item_que_no_se_ubica_no_da_precio():
    ocds = _ocds_caso()
    ocds["awards"][0]["items"][0].update({"id": "no-existe", "description": "OTRO PRODUCTO"})
    assert "4" not in mk._award_items_ocds(ocds)


def test_desiertos_sin_precio_ofertado_aunque_falte_la_oferta_en_bd(monkeypatch):
    """Sin ofertas en la BD el precio sale de awards[]: los desiertos no reciben el de otro ítem."""
    _fake_pg(monkeypatch, _SQL, ofertas_rows=())
    st = _state()
    mi = mk.build_market_input("2026-2543-197", _Ctx(st))
    por_num = {str(it["numero"]): it for it in mi["items"]}
    assert set(por_num) == {"2", "3", "4"}
    for n, pu in _PU.items():
        assert por_num[n]["precio_unitario_ofertado"] == pu and por_num[n]["origen_precio"] == "ocds_award_item"


# ═════════════════════════════════════════════════════════════════════
# 2 · desiertos / sin adjudicar fuera de la comparación y de los totales
# ═════════════════════════════════════════════════════════════════════
def test_items_desiertos_se_excluyen_del_input(monkeypatch):
    _fake_pg(monkeypatch, _SQL, _OFERTAS)
    mi = mk.build_market_input("2026-2543-197", _Ctx(_state()))
    assert sorted(str(it["numero"]) for it in mi["items"]) == ["2", "3", "4"]
    assert {x["numero"]: x["motivo"] for x in mi["items_no_adjudicados"]} == {"1": "desierto", "5": "desierto"}
    assert mi["n_items_no_adjudicados"] == 2
    assert not any(it.get("origen_precio") == "ocds_award_item" for it in mi["items"])
    assert {str(it["numero"]): it["precio_unitario_ofertado"] for it in mi["items"]} == pytest.approx(
        {"2": 1790000.0 / 24319766, "3": 1474235.95 / 37995772, "4": 1064634.7 / 51933400})
    assert "desierto" in mi["mensaje_para_market_agent"]


def test_item_sin_adjudicacion_se_infiere_de_awards():
    """Sin estado DESIERTO en el tender: lo que ninguna adjudicación cubre (y no tiene oferta ganadora) se excluye."""
    sql = {str(r[0]): {"descripcion_corta": r[1], "cantidad": r[2]} for r in _SQL}
    out = _items_sin_adjudicar_ocds(_ocds_caso(estados=False), sql, {})
    assert {k: v["motivo"] for k, v in out.items()} == {"1": "sin_adjudicacion", "5": "sin_adjudicacion"}
    # Una oferta ganadora en la BD cuenta como adjudicado.
    assert "5" not in _items_sin_adjudicar_ocds(_ocds_caso(estados=False), sql, {"5": 1000.0})
    # Proceso aún en convocatoria (sin awards): no se excluye nada.
    sin_awards = _ocds_caso(estados=False)
    sin_awards.pop("awards")
    assert _items_sin_adjudicar_ocds(sin_awards, sql, {}) == {}
    # Una adjudicación sin ítems no dice qué cubre: no se infiere.
    sin_items = _ocds_caso(estados=False)
    sin_items["awards"][0]["items"] = []
    assert _items_sin_adjudicar_ocds(sin_items, sql, {}) == {}


def test_nulo_y_cancelado_tambien_se_excluyen():
    sql = {str(r[0]): {"descripcion_corta": r[1], "cantidad": r[2]} for r in _SQL}
    ocds = _ocds_caso()
    ocds["tender"]["items"][0].update({"status": "unsuccessful", "statusDetails": "NULO"})
    ocds["tender"]["items"][4].update({"status": "cancelled", "statusDetails": "CANCELADO"})
    out = _items_sin_adjudicar_ocds(ocds, sql, {})
    assert {k: v["motivo"] for k, v in out.items()} == {"1": "nulo", "5": "cancelado"}


# ═════════════════════════════════════════════════════════════════════
# 3 · una mediana sin respaldo suficiente no suma al lote
# ═════════════════════════════════════════════════════════════════════
def _f(**kw):
    base = {"veredicto": "barato", "precio_mediana_mercado": None, "precio_mediana_comparacion": None,
            "fuente_mediana": "retail", "diff_fuente": "retail", "n_precios": 0, "respaldo_precios": None,
            "retail_descartado": False, "ancla_regional": {"estado": "insuficiente", "n": 0}}
    base.update(kw)
    return base


def test_mediana_de_lote_exige_minimo_de_precios():
    ancla2 = {"estado": "hallado", "n": 2}
    ancla3 = {"estado": "hallado", "n": 3}
    # Valsartán: mediana del ancla con 2 compras y ningún precio de tienda → no suma.
    valsartan = _f(precio_mediana_mercado=2.01, precio_mediana_comparacion=2.01, fuente_mediana="ancla_regional",
                   diff_fuente="ancla_regional", ancla_regional=ancla2)
    assert _mediana_de_lote(valsartan) is None
    assert _mediana_de_lote({**valsartan, "ancla_regional": ancla3}) == 2.01
    # Tiendas con ≥ 3 precios → suma; con 2 → no.
    assert _mediana_de_lote(_f(precio_mediana_mercado=0.04, precio_mediana_comparacion=0.04, n_precios=5)) == 0.04
    assert _mediana_de_lote(_f(precio_mediana_mercado=0.04, precio_mediana_comparacion=0.04, n_precios=2)) is None
    # Una mediana de Perú Compras cuenta por las entidades que la sostienen.
    assert _mediana_de_lote(_f(precio_mediana_mercado=0.3, precio_mediana_comparacion=0.3, n_precios=1,
                               respaldo_precios=6)) == 0.3
    # Tiendas descartadas: sus precios no respaldan; el ancla de 2 compras tampoco.
    assert _mediana_de_lote(_f(precio_mediana_mercado=0.5, precio_mediana_comparacion=2.01, n_precios=5,
                               retail_descartado=True, diff_fuente="ancla_regional", ancla_regional=ancla2)) is None
    # Alineado con un ancla de 2 compras pero con 5 precios de tienda: suma la mediana de tiendas.
    assert _mediana_de_lote(_f(veredicto="alineado_regional", precio_mediana_mercado=0.05,
                               precio_mediana_comparacion=0.06, n_precios=5, diff_fuente="ancla_regional",
                               ancla_regional=ancla2)) == 0.05
    # Guardarraíl disparado: nunca suma.
    assert _mediana_de_lote(_f(veredicto="no_verificable", precio_mediana_mercado=0.04,
                               precio_mediana_comparacion=0.04, n_precios=5)) is None


def _refs_valsartan(monkeypatch):
    """Dos compras de otras entidades en la región, solo para el valsartán (S/ 0,487 y S/ 3,53 → mediana 2,01)."""
    refs = [_ref("2026-1003000933-1", "VALSARTAN 80 mg TAB", 0.6, 0.487, unidad="Unidad"),
            _ref("1233824", "VALSARTAN 80 mg TAB", 3.6, 3.53, unidad="Unidad")]
    monkeypatch.setattr(mk.goods_retail, "_consultar_referencias_internas",
                        lambda ocid, cubsos, descr, **kw: list(refs) if "VALSARTAN" in (descr or "").upper() else [])


def _precios_tiendas():
    precios = [_precio("3", f"Atorvastatina 20 mg tableta {i}", p, "unidad", f"botica{i}.pe")
               for i, p in enumerate([0.04, 0.04, 0.05])]
    precios += [_precio("4", f"Acido folico 0.5 mg tableta {i}", p, "unidad", f"farma{i}.pe")
                for i, p in enumerate([0.02, 0.02, 0.03])]
    return precios


def test_lote_no_suma_la_mediana_sin_respaldo(monkeypatch):
    """Con el valsartán chico (cobertura alta), el Δ del lote es el de los ítems respaldados (≈ −0,8 %), no el
    −43 % «barato» que daba sumar sus 2,01 por tableta."""
    items = [
        {"numero": "2", "descripcion_corta": "VALSARTAN 80 mg TAB", "cantidad": 1000000, "unidad": "Unidad",
         "precio_unitario_ofertado": 0.0736, "origen_precio": "oferta_ganadora_bd", "padre_ocds_item": None},
        {"numero": "3", "descripcion_corta": "ATORVASTATINA 20 mg TAB", "cantidad": 37995772, "unidad": "Unidad",
         "precio_unitario_ofertado": 0.0388, "origen_precio": "oferta_ganadora_bd", "padre_ocds_item": None},
        {"numero": "4", "descripcion_corta": "ACIDO FOLICO 500 mcg (0.5 mg) TAB", "cantidad": 51933400,
         "unidad": "Unidad", "precio_unitario_ofertado": 0.0205, "origen_precio": "oferta_ganadora_bd",
         "padre_ocds_item": None},
    ]
    _refs_valsartan(monkeypatch)
    _fake_fanout(monkeypatch, _precios_tiendas())
    st = {"ocid": "1", "ocds": {"ocid": "1", "tender": {"description": "PRODUCTOS FARMACEUTICOS"}},
          "market_input": {"ocid": "1", "items": items, "padre_lote": None, "total_ofertado": 2612470.65,
                           "total_ofertado_base": "adjudicado", "cuantia_referencial_total": None}}
    res = mk._mercado_goods_retail(st)
    val = next(f for f in res["findings"] if str(f["item_numero"]) == "2")
    # Dos compras son contexto, no veredicto: ni «barato −96 %» por ítem ni mediana para el lote.
    assert val["ancla_regional"]["estado"] == "insuficiente" and val["ancla_regional"]["n"] == 2
    assert val["veredicto"] == "sin_dato" and val["diff_pct"] is None and val["precio_mediana_mercado"] is None
    lote = res["lote"]
    assert lote["n_respaldados"] == 2 and lote["base"] == "ofertado_items"
    assert lote["total_ofertado_respaldados"] == pytest.approx(0.0388 * 37995772 + 0.0205 * 51933400, abs=1)
    assert lote["total_mercado_respaldados"] == pytest.approx(0.04 * 37995772 + 0.02 * 51933400, abs=1)
    assert res["sobreprecio_pct"] == pytest.approx(-0.77, abs=0.05) and res["veredicto_global"] == "alineado"


# ═════════════════════════════════════════════════════════════════════
# 4 · varios ganadores: el total del proceso no es un contrato
# ═════════════════════════════════════════════════════════════════════
def test_total_ofertado_con_varios_contratos_es_lo_adjudicado():
    ocds = _ocds_caso()
    un_contrato = {"precio_final_total": _ADJ["21236576"]}
    assert mk._total_ofertado_proceso([], [], un_contrato, ocds, 16552786.22) == (_TOTAL_ADJ, "adjudicado")
    # Los ítems de ESE contrato tampoco son el proceso.
    contratados = [{"precio_unitario_contratado": 0.0736, "cantidad": 24319766}]
    assert mk._total_ofertado_proceso([], contratados, {}, ocds, None) == (_TOTAL_ADJ, "adjudicado")
    # Un documento que sí cubre el proceso entero (±1 %) sigue mandando.
    assert mk._total_ofertado_proceso([], [], {"precio_final_total": _TOTAL_ADJ}, ocds, None) == (_TOTAL_ADJ, "contrato")
    # Sin awards: la suma de los contratos, no el primero.
    sin_awards = {k: v for k, v in ocds.items() if k != "awards"}
    assert mk._total_ofertado_proceso([], [], un_contrato, sin_awards, None) == (_TOTAL_ADJ, "contratado_ocds")
    # Un solo ganador y un solo contrato: el contrato leído es el total (como antes).
    uno = {"awards": [ocds["awards"][0]], "contracts": [ocds["contracts"][0]]}
    assert mk._total_ofertado_proceso([], [], {"precio_final_total": 999.0}, uno, None) == (999.0, "contrato")


def test_caso_completo_2026_2543_197(monkeypatch):
    _fake_pg(monkeypatch, _SQL, _OFERTAS)
    _refs_valsartan(monkeypatch)
    st = _state()
    st["market_input"] = mi = mk.build_market_input("2026-2543-197", _Ctx(st))
    assert mi["total_ofertado"] == _TOTAL_ADJ and mi["total_ofertado_base"] == "adjudicado"
    assert mi["contrato_final_parcial"] is True
    ref_comparada = sum(t[4] for t in _TENDER if t[6] != "DESIERTO")
    assert mi["precio_final_vs_referencial"] == pytest.approx(round((_TOTAL_ADJ - ref_comparada) / ref_comparada * 100, 1))
    assert "Es UNO de los contratos" in mi["mensaje_para_market_agent"]
    _fake_fanout(monkeypatch, _precios_tiendas())
    res = mk._mercado_goods_retail(st)
    assert sorted(str(f["item_numero"]) for f in res["findings"]) == ["2", "3", "4"]
    assert {x["numero"] for x in res["items_no_adjudicados"]} == {"1", "5"}
    assert not any(f.get("origen_precio_ofertado") == "ocds_award_item" for f in res["findings"])
    assert res["total_ofertado"] == _TOTAL_ADJ and res["total_ofertado_base"] == "adjudicado"
    assert res["precio_final_contrato"] is None and res["contrato_final_parcial"] is True
    # El valsartán (41 % del valor) no tiene mediana respaldada: cobertura parcial, sin «barato» de lote.
    assert res["lote"]["n_respaldados"] == 2 and res["lote"]["n_items"] == 3
    assert res["sobreprecio_pct"] is None and res["veredicto_global"] == "cobertura_parcial"
    assert any("desierto" in o for o in res["observaciones_clave"])


def test_todos_desiertos_no_hay_que_comparar(monkeypatch):
    ocds = _ocds_caso()
    for it in ocds["tender"]["items"]:
        it.update({"status": "unsuccessful", "statusDetails": "DESIERTO"})
    ocds.pop("awards")
    ocds.pop("contracts")
    _fake_pg(monkeypatch, _SQL, ())
    st = {"ocid": "2026-2543-197", "ocds": ocds}
    st["market_input"] = mi = mk.build_market_input("2026-2543-197", _Ctx(st))
    assert mi["items"] == [] and mi["n_items_no_adjudicados"] == 5
    monkeypatch.setattr(mk.goods_retail, "read_market_input", lambda tool_context: mi)
    res = mk._mercado_goods_retail(st)
    assert res["estado"] == "sin_dato" and res["motivo"] == "todos_los_items_desiertos_o_sin_adjudicar"
