"""Correcciones de mercado tras la revisión manual del lote 1 (Workstream R3 · T6/T14).

Cada test reproduce un caso de `docs/design/revision_contratos/*.md` con fixtures sintéticas
pequeñas (BD falsa por patrón de SQL; fan-out de precios falso; ancla regional falsa):

  · 1225450  el ítem OCDS "DIESEL B5 S-50" coincide con el producto del parser → no se degrada a
             "padre lote"; el gasohol pasa a ser hermano; cobertura por VALOR; total_ofertado = contrato
             (121 839, no la cuantía 139 950) → ya no hay "+7 162 %".
  · 1225058  kg vs bolsa de 5 kg / saco de 50 kg → Δ ≈ −24 %, no −84 %.
  · 1225062  rollo de 4 m × 100 m = 400 m² → S/ 5.75/m² (n = 3, veredicto en vez de sin_dato).
  · 1225266  pieza de 3 m prorrateada a 4 m (32.20 → 42.93) y riel de 0.45 mm descartado (0.90 exigido).
  · 1225416  "ofertado" = precio del contrato (920 000), nunca el estimado OCDS (1 100 900) → −2 %.
  · 1225030  un solo ítem → sin Δ de lote; ancla regional (VR Cusco 85–155/m³) → alineado_regional.
  · 1225090  Δ de lote sobre los MISMOS ítems que tienen mediana (no 3 ítems vs el lote entero).
  · Guardarraíl: Δ > 300 % sin precios de unidad confirmada → no_verificable.
  · Solo cuantía referencial → `estimado_sobre_mercado`, nunca `sobreprecio_pct`.
  · RUN_DB=1: referencias internas reales de 1225030 (OCIDs 1231226 y 1227961) desde Cloud SQL.
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


# ── Infra de pruebas ─────────────────────────────────────────────────
class _Ctx:
    def __init__(self, state):
        self.state = state


class _FakeCursor:
    """Responde por fragmento de SQL (normalizado a minúsculas y un espacio)."""

    def __init__(self, rows: dict):
        self.rows = rows
        self._cur = []

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        for frag, val in self.rows.items():
            if frag in s:
                self._cur = list(val)
                return
        self._cur = []

    def fetchone(self):
        return self._cur[0] if self._cur else None

    def fetchall(self):
        return list(self._cur)


class _FakeConn:
    def __init__(self, rows):
        self.rows = rows

    def cursor(self):
        return _FakeCursor(self.rows)

    def close(self):
        pass


def _fake_pg(monkeypatch, items_rows, ofertas_rows=()):
    rows = {"from convocatoria_items where ocid=%s order by numero_item": items_rows,
            "join ofertas o on o.item_id": list(ofertas_rows)}
    monkeypatch.setattr(mk, "_pg", lambda: _FakeConn(rows))


def _precio(num, producto, precio, unidad="unidad", dominio="tienda.pe", moneda="PEN"):
    return {"item_numero": mk._norm_num(num), "producto": producto, "precio": float(precio), "moneda_origen": moneda,
            "unidad": unidad, "proveedor": dominio,
            "fuentes": [{"uri": f"https://{dominio}/{abs(hash(producto)) % 9999}", "titulo": producto, "dominio": dominio}]}


def _fake_fanout(monkeypatch, precios: list[dict], sin_precios=()):
    """Primer fan-out devuelve `precios`; el 2º pase (retry) no encuentra nada."""
    llamadas = {"n": 0}

    def _f(items, objeto, state, contexto=""):
        llamadas["n"] += 1
        if llamadas["n"] == 1:
            chunks = [f["fuentes"][0] for f in precios]
            return list(precios), {}, set(sin_precios), chunks, 1
        return [], {}, set(), [], 1
    monkeypatch.setattr(mk, "_fanout_goods_retail", _f)
    return llamadas


def _fake_refs(monkeypatch, refs: list[dict]):
    monkeypatch.setattr(mk, "_consultar_referencias_internas", lambda ocid, cubsos, descr, **kw: list(refs))


def _ref(ocid, descr, pu_ref, pu_adj=None, unidad="M3", misma_region=True, mismo_cubso=False):
    return {"ocid": ocid, "entidad_ruc": "20100000001", "entidad": "ENTIDAD", "objeto": descr, "descripcion": descr,
            "cantidad": 1000.0, "unidad": unidad, "cubso": "x", "fecha_convocatoria": "2026-07-01", "region": "Cusco",
            "departamento_ubigeo": "08", "modalidad": "LP", "etapa": "contratada",
            "precio_unitario_referencial": pu_ref, "precio_unitario_adjudicado": pu_adj, "sim": 0.5,
            "misma_region": misma_region, "mismo_cubso": mismo_cubso, "url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"}


def _ocds(items, awards_amount=None, contracts_amount=None, tender_amount=None, descripcion="OBJETO"):
    tender_items = []
    for i, (descr, qty, unit, cubso) in enumerate(items, start=1):
        tender_items.append({"id": f"i{i}", "position": str(i), "description": descr, "quantity": qty,
                             "unit": {"name": unit}, "classification": {"id": cubso, "scheme": "CUBSO"}})
    ocds = {"ocid": "ocds-x-1", "tender": {"description": descripcion, "items": tender_items,
                                          "value": {"amount": tender_amount} if tender_amount else {}}}
    if awards_amount:
        ocds["awards"] = [{"id": "a1", "value": {"amount": awards_amount}, "items": []}]
    if contracts_amount:
        ocds["contracts"] = [{"id": "c1", "value": {"amount": contracts_amount}}]
    return ocds


# ═════════════════════════════════════════════════════════════════════
# 1225450 · diésel (5 000 gal) + gasohol (100 gal) bajo un solo ítem OCDS
# ═════════════════════════════════════════════════════════════════════
def _state_1225450(con_contrato=True):
    items = [
        {"numero": "1", "descripcion_corta": "DIESEL B5 S50", "cantidad": 5000, "unidad": "GALON", "padre_ocds_item": None,
         "requerimiento_tecnico_detallado": "Diésel B5 S-50 según ficha técnica OSINERGMIN " * 3},
        {"numero": "2", "descripcion_corta": "GASOHOL REGULAR", "cantidad": 100, "unidad": "GALON", "padre_ocds_item": "1",
         "requerimiento_tecnico_detallado": "Gasohol regular según ficha técnica " * 3},
    ]
    raw = {"items_consolidados": items, "items_otros_documentos": []}
    if con_contrato:
        raw["items_otros_documentos"] = [
            {"numero": "1", "descripcion_corta": "DIESEL B5 S-50", "cantidad": 5000, "unidad": "GALON",
             "precio_unitario_referencial": 23.89, "_documento": "Archivos del contrato"},
            {"numero": "2", "descripcion_corta": "GASOHOL REGULAR", "cantidad": 100, "unidad": "GALON",
             "precio_unitario_referencial": 23.89, "_documento": "Archivos del contrato"},
        ]
    state = {
        "ocid": "1225450",
        "ocds": _ocds([("DIESEL B5 S-50", 5000, "Galon", "1510150500233280")], awards_amount=121839.0,
                      contracts_amount=121839.0, tender_amount=139950.0,
                      descripcion="CONTRATACION DE COMBUSTIBLE DIESEL B5 S50 Y GASOHOL REGULAR"),
        "parser_raw_consolidated": raw,
        "contrato_final": {"precio_final_total": 121839.0, "moneda": "SOLES"} if con_contrato else None,
    }
    return state


_SQL_1225450 = [(1, "DIESEL B5 S-50", 5000.0, "Galon", 27.99, 139950.0, "1510150500233280")]


def test_1225450_diesel_no_se_degrada_a_padre_lote(monkeypatch):
    _fake_pg(monkeypatch, _SQL_1225450)
    st = _state_1225450()
    out = mk.build_market_input("1225450", _Ctx(st))
    nums = sorted(str(it["numero"]) for it in out["items"])
    assert nums == ["1", "2"], out["items"]
    assert out["padre_lote"] is None and out["n_padres_producto"] == 1
    diesel = next(it for it in out["items"] if it["numero"] == "1")
    gasohol = next(it for it in out["items"] if it["numero"] == "2")
    assert diesel.get("es_producto_ocds") is True and diesel["cantidad"] == 5000
    assert gasohol["padre_ocds_item"] is None and gasohol["hermano_de_ocds_item"] == "1"
    # Precio del contrato (no el referencial 27.99) como ofertado, en ambos ítems.
    assert diesel["precio_unitario_ofertado"] == 23.89 and gasohol["precio_unitario_ofertado"] == 23.89
    assert diesel["origen_precio"] == "contrato_items_otros_documentos"
    assert diesel["cubso"] == "1510150500233280" and gasohol["cubso"] == "1510150500233280"
    assert out["total_ofertado"] == 121839.0 and out["total_ofertado_base"] == "contrato"
    assert out["total_ofertado_es_referencial"] is False
    assert out["cuantia_referencial_total"] == 139950.0


def test_1225450_sin_diesel_preciado_no_hay_7162_pct(monkeypatch):
    """Como en la corrida real: solo el gasohol obtuvo precios (100 gal de 5 100)."""
    _fake_pg(monkeypatch, _SQL_1225450)
    _fake_refs(monkeypatch, [])
    st = _state_1225450()
    st["market_input"] = mk.build_market_input("1225450", _Ctx(st))
    precios = [_precio("2", f"Gasohol Regular grifo {i}", p, "galón", f"grifo{i}.pe")
               for i, p in enumerate([19.75, 22.29, 12.99, 9.74, 20.26, 18.79])]
    _fake_fanout(monkeypatch, precios, sin_precios={"1"})
    res = mk._mercado_goods_retail(st)
    assert res["sobreprecio_pct"] is None
    assert res["veredicto_global"] == "cobertura_parcial"
    assert res["cobertura_mercado"] < 0.05, res["cobertura_mercado"]      # 100 gal / 5 100 gal por valor
    assert res["total_ofertado"] == 121839.0 and res["total_ofertado_base"] == "contrato"
    assert "cobertura_por_valor_insuficiente" in (res["lote"]["motivo"] or "")
    gasohol = next(f for f in res["findings"] if str(f["item_numero"]) == "2")
    assert gasohol["diff_base"] == "ofertado" and gasohol["precio_unitario_ofertado"] == 23.89
    assert all(p["normalizacion"]["regla"] == "misma_unidad" for p in gasohol["precios_observados"])


def test_1225450_con_ambos_items_preciados_es_alineado(monkeypatch):
    _fake_pg(monkeypatch, _SQL_1225450)
    _fake_refs(monkeypatch, [])
    st = _state_1225450()
    st["market_input"] = mk.build_market_input("1225450", _Ctx(st))
    precios = [_precio("1", f"Diesel B5 S50 grifo {i}", p, "galón", f"grifo{i}.pe") for i, p in enumerate([23.5, 24.0, 24.85, 25.2])]
    precios += [_precio("2", f"Gasohol Regular grifo {i}", p, "galón", f"g{i}.pe") for i, p in enumerate([19.75, 20.26, 18.79])]
    _fake_fanout(monkeypatch, precios)
    res = mk._mercado_goods_retail(st)
    assert res["cobertura_mercado"] == 1.0
    assert res["lote"]["base"] == "ofertado_items"
    assert res["lote"]["total_ofertado_respaldados"] == pytest.approx(121839.0, abs=1)
    assert -15 < res["sobreprecio_pct"] < 15 and res["veredicto_global"] == "alineado"


def test_1225450_ancla_regional_sin_retail(monkeypatch):
    """Sin precios retail para el diésel, el comparable 1225256 (misma entidad, 24.85/gal) resuelve."""
    _fake_pg(monkeypatch, _SQL_1225450)
    _fake_refs(monkeypatch, [_ref("1225256", "DIESEL B5 S-50", 26.25, 24.85, unidad="Galon", mismo_cubso=True),
                             _ref("1224772", "DIESEL B5 S-50", 23.80, None, unidad="Galon", mismo_cubso=True),
                             _ref("1242269", "DIESEL B5 S-50", 29.99, None, unidad="Galon", mismo_cubso=True)])
    st = _state_1225450()
    st["market_input"] = mk.build_market_input("1225450", _Ctx(st))
    _fake_fanout(monkeypatch, [], sin_precios={"1", "2"})
    res = mk._mercado_goods_retail(st)
    diesel = next(f for f in res["findings"] if str(f["item_numero"]) == "1")
    assert diesel["veredicto"] == "alineado_regional" and diesel["diff_fuente"] == "ancla_regional"
    assert diesel["ancla_regional"]["ambito"] == "departamento" and diesel["ancla_regional"]["n"] == 3
    assert {r["ocid"] for r in diesel["referencias_internas"]} == {"1225256", "1224772", "1242269"}
    assert diesel["estado"] == "hallado" and diesel["precios_observados"] == []
    assert any("1225256" in u for u in st["grounding_urls"])


# ═════════════════════════════════════════════════════════════════════
# Normalización de unidades (1225058 · 1225062 · 1225266)
# ═════════════════════════════════════════════════════════════════════
def _mi_un_item(descr, cantidad, unidad, ofertado=None, referencial=None, numero="1", extra=None):
    it = {"numero": numero, "descripcion_corta": descr, "cantidad": cantidad, "unidad": unidad,
          "precio_unitario_ofertado": ofertado, "origen_precio": "contrato" if ofertado else None,
          "precio_unitario_referencial": referencial, "cuantia_referencial_item": None, "padre_ocds_item": None}
    it.update(extra or {})
    return it


def _run_retail(monkeypatch, items, precios, total_ofertado=None, base=None, refs=()):
    _fake_refs(monkeypatch, list(refs))
    _fake_fanout(monkeypatch, precios)
    st = {"ocid": "1", "ocds": {"ocid": "1", "tender": {"description": "OBJETO"}},
          "market_input": {"ocid": "1", "items": items, "padre_lote": None, "total_ofertado": total_ofertado,
                           "total_ofertado_base": base, "cuantia_referencial_total": None}}
    return mk._mercado_goods_retail(st), st


def test_1225058_kg_vs_bolsa_y_saco(monkeypatch):
    arroz = _mi_un_item("ARROZ SUPERIOR", 25450, "KILOGRAMO", ofertado=3.124126, referencial=3.97)
    precios = [_precio("1", "Arroz Faraón Superior bolsa 5 kg", 19.90, "bolsa de 5 kg", "plazavea.com.pe"),
               _precio("1", "Arroz Paisana superior 5kg", 21.50, "unidad", "wong.pe"),
               _precio("1", "Arroz Vallenorte superior x 5 kg", 17.90, "bolsa", "metro.pe"),
               _precio("1", "Arroz superior saco x 50 kg", 215.00, "saco de 50 kg", "mayorista.pe")]
    res, st = _run_retail(monkeypatch, [arroz], precios)
    f = res["findings"][0]
    normalizados = sorted(p["precio"] for p in f["precios_observados"])
    assert normalizados == pytest.approx([3.58, 3.98, 4.3, 4.3], abs=0.01)
    assert f["n_precios"] == 4 and f["n_precios_normalizados"] == 4     # el saco de 50 kg ya NO es outlier
    assert -30 < f["diff_pct"] < -15 and f["veredicto"] == "barato"     # ≈ −24 %, no −84 %
    assert not any(d.get("motivo") == "outlier" for d in st.get("descartes") or [])


def test_1225062_rollo_400_m2(monkeypatch):
    geo = _mi_un_item("GEOTEXTIL NO TEJIDO", 14000, "M2", ofertado=4.89)
    precios = [_precio("1", "Geotextil no tejido 200 g/m2", 4.98, "m2", "greenrain.pe"),
               _precio("1", "Geotextil NT 4MT x 100 metros rollo", 2300.0, "rollo", "ferropolis.pe"),
               _precio("1", "Geotextil no tejido por metro cuadrado", 5.20, "m2", "construmax.pe")]
    res, _ = _run_retail(monkeypatch, [geo], precios)
    f = res["findings"][0]
    rollo = next(p for p in f["precios_observados"] if "ferropolis" in p["url"])
    assert rollo["precio"] == 5.75 and rollo["normalizacion"]["regla"] == "precio_por_presentacion"
    assert f["n_precios"] == 3 and f["veredicto"] == "alineado"          # antes: outlier → n=2 → sin_dato
    assert f["diff_pct"] == pytest.approx((4.89 - 5.20) / 5.20 * 100, abs=0.1)


def test_1225266_parante_4m_prorrateado_y_riel_espesor_distinto(monkeypatch):
    parante = _mi_un_item("PARANTE 89 x 38 x 0.90 mm x 4.00 m", 2100, "UND", ofertado=37.80, numero="1.1")
    riel = _mi_un_item("RIEL 90 x 25 x 0.90 mm x 3.00 m", 600, "UND", ofertado=32.90, numero="1.2")
    precios = [_precio("1.1", "Parante 89 x 38 x 0.90 mm x 3 m", 32.20, "unidad", "sodimac.com.pe"),
               _precio("1.1", "Parante TUPEMESA 89x38x0.90mm x 3.00 m", 30.00, "unidad", "buscal.pe"),
               _precio("1.1", "Parante drywall 89 mm 0.90 mm 3 m", 33.50, "unidad", "falabella.com.pe"),
               _precio("1.2", "Riel 90 x 25 x 0.905 mm x 3 m", 27.50, "unidad", "falabella.com.pe"),
               _precio("1.2", "Riel G20 90mm x 3.00 m", 19.50, "unidad", "buscal.pe"),
               _precio("1.2", "Riel liviano 90x0.45mm x 3m", 8.77, "unidad", "sodimac.com.pe")]
    res, st = _run_retail(monkeypatch, [parante, riel], precios)
    f11 = next(f for f in res["findings"] if f["item_numero"] == "1.1")
    f12 = next(f for f in res["findings"] if f["item_numero"] == "1.2")
    # Prorrateo 3 m → 4 m: 32.20 × 4/3 = 42.93; el ofertado 37.80 queda POR DEBAJO (antes +17 % "elevado").
    assert sorted(p["precio"] for p in f11["precios_observados"]) == pytest.approx([40.0, 42.93, 44.67], abs=0.01)
    assert all(p["normalizacion"]["regla"] == "prorrateo_longitud" for p in f11["precios_observados"])
    assert f11["diff_pct"] < 0 and f11["veredicto"] in ("alineado", "barato")
    # Riel de 0.45 mm descartado por espesor; quedan 2 precios → sin veredicto (antes +69 % "muy_elevado").
    assert f12["n_precios"] == 2 and f12["veredicto"] == "sin_dato" and f12["motivo_estimacion"] == "precios_insuficientes"
    assert f12["precios_descartados"][0]["normalizacion"]["regla"] == "espesor_distinto"
    assert any(d.get("motivo") == "espesor_distinto" for d in st["descartes"])


@pytest.mark.parametrize("item_unidad,descr,precio,unidad_obs,producto,esperado,regla", [
    ("GALON", "DIESEL B5 S50", 6.50, "litro", "Diesel B5", 24.6025, "conversion_unidad"),
    ("GALON", "DIESEL B5 S50", 120.0, "bidón de 20 l", "Diesel bidón 20 litros", 22.71, "precio_por_presentacion"),
    ("KG", "AZUCAR RUBIA", 4.20, "kg", "Azúcar rubia a granel", 4.20, "misma_unidad"),
    ("KG", "AZUCAR RUBIA", 2.10, "bolsa", "Azúcar rubia 500 g", 4.20, "precio_por_presentacion"),
    ("M2", "GEOMALLA TRIAXIAL", 890.0, "rollo", "Geomalla 4 x 75 m", 2.9667, "precio_por_presentacion"),
    ("UND", "TUBO PVC 4 in x 3 m", 10.0, "metro", "Tubo PVC 4\"", 30.0, "longitud_por_unidad_de_medida"),
    ("UND", "LAPTOP CORE I7", 3500.0, "unidad", "Laptop Core i7 16 GB", 3500.0, "asumida_misma_unidad"),
    ("BOLSA", "CEMENTO PORTLAND TIPO I BOLSA 42.5 KG", 0.60, "kg", "Cemento a granel", 25.5, "masa_por_unidad_de_medida"),
])
def test_reglas_normalizacion_unidades(item_unidad, descr, precio, unidad_obs, producto, esperado, regla):
    ctx = mk._contexto_unidad_item({"descripcion_corta": descr, "unidad": item_unidad})
    norm, info = mk._normalizar_precio_observado(precio, unidad_obs, producto, ctx)
    assert info["regla"] == regla, info
    assert norm == pytest.approx(esperado, abs=0.01)


def test_unidad_canon_metro_lineal_vs_mililitro():
    assert mk._unidad_canon("ML", item=True) == ("longitud", 1.0)     # unidad SEACE: metro lineal
    assert mk._unidad_canon("ml") == ("volumen", 0.001)               # precio observado: mililitro
    assert mk._unidad_canon("metro") == ("longitud", 1.0)
    assert mk._unidad_canon("Metro cubico") == ("volumen_solido", 1.0)
    assert mk._unidad_canon("Kilogramo") == ("masa", 1.0)
    assert mk._unidad_canon("bolsa de 5 kg") == ("unidad", 1.0)
    assert mk._unidad_canon("Servicio") is None


# ═════════════════════════════════════════════════════════════════════
# 1225416 · lote real (diésel + gasohol) — "ofertado" = contrato, no estimado OCDS
# ═════════════════════════════════════════════════════════════════════
def test_1225416_total_ofertado_es_el_contrato_no_el_estimado(monkeypatch):
    _fake_pg(monkeypatch, [(1, "COMBUSTIBLE DIESEL B5 S50 Y GASOHOL REGULAR", 1.0, "Paquete", None, 1100900.0, "1510150500233280")])
    _fake_refs(monkeypatch, [])
    raw = {"items_consolidados": [
        {"numero": "1", "descripcion_corta": "DIESEL B5 S50", "cantidad": 30000, "unidad": "GALON", "padre_ocds_item": "1"},
        {"numero": "2", "descripcion_corta": "GASOHOL REGULAR", "cantidad": 10000, "unidad": "GALON", "padre_ocds_item": "1"},
    ], "items_otros_documentos": [
        {"numero": "1", "descripcion_corta": "DIESEL B5 S50", "cantidad": 30000, "unidad": "GALON", "precio_unitario_referencial": 23.33, "_documento": "Contrato"},
        {"numero": "2", "descripcion_corta": "GASOHOL REGULAR", "cantidad": 10000, "unidad": "GALON", "precio_unitario_referencial": 22.01, "_documento": "Contrato"},
    ]}
    st = {"ocid": "1225416", "parser_raw_consolidated": raw,
          "ocds": _ocds([("COMBUSTIBLE DIESEL B5 S50 Y GASOHOL REGULAR", 1, "Paquete", "1510150500233280")],
                        awards_amount=920000.0, contracts_amount=920000.0, tender_amount=1100900.0),
          "contrato_final": {"precio_final_total": 920000.0}}
    st["market_input"] = mi = mk.build_market_input("1225416", _Ctx(st))
    assert mi["padre_lote"] is not None and mi["n_items"] == 2          # sigue siendo lote: ambos hijos coinciden con el padre
    assert mi["total_ofertado"] == 920000.0 and mi["total_ofertado_base"] == "contrato"
    assert {it["precio_unitario_ofertado"] for it in mi["items"]} == {23.33, 22.01}
    n_diesel = next(it["numero"] for it in mi["items"] if "DIESEL" in it["descripcion_corta"])   # sub-ítem renumerado (1.1)
    n_gasohol = next(it["numero"] for it in mi["items"] if "GASOHOL" in it["descripcion_corta"])
    precios = [_precio(n_diesel, f"Diesel B5 S50 grifo {i}", p, "galón", f"g{i}.pe") for i, p in enumerate([24.39, 24.0, 25.99])]
    precios += [_precio(n_gasohol, f"Gasohol regular grifo {i}", p, "galón", f"h{i}.pe") for i, p in enumerate([20.78, 20.5, 21.0])]
    _fake_fanout(monkeypatch, precios)
    res = mk._mercado_goods_retail(st)
    assert res["total_ofertado"] == 920000.0 and res["total_ofertado_es_referencial"] is False
    assert res["lote"]["total_ofertado_respaldados"] == pytest.approx(920000.0, abs=1)
    assert res["lote"]["total_mercado_respaldados"] == pytest.approx(30000 * 24.39 + 10000 * 20.78, abs=1)
    assert res["sobreprecio_pct"] == pytest.approx(-2.1, abs=0.2) and res["veredicto_global"] == "alineado"


def test_solo_cuantia_referencial_no_es_sobreprecio(monkeypatch):
    """Sin contrato ni ofertas: la comparación es del ESTIMADO de la entidad, no de la oferta."""
    _fake_pg(monkeypatch, [(1, "CANASTA DE ALIMENTOS", 1.0, "Unidad", None, 98390.0, "5000000000000001")])
    _fake_refs(monkeypatch, [])
    raw = {"items_consolidados": [
        {"numero": "1", "descripcion_corta": "ARROZ SUPERIOR", "cantidad": 1000, "unidad": "KG", "padre_ocds_item": "1"},
        {"numero": "2", "descripcion_corta": "ACEITE VEGETAL", "cantidad": 500, "unidad": "L", "padre_ocds_item": "1"},
    ]}
    st = {"ocid": "9", "parser_raw_consolidated": raw,
          "ocds": _ocds([("CANASTA DE ALIMENTOS", 1, "Unidad", "5000000000000001")], tender_amount=98390.0)}
    st["market_input"] = mi = mk.build_market_input("9", _Ctx(st))
    assert mi["total_ofertado_base"] == "referencial" and mi["total_ofertado_es_referencial"] is True
    n_arroz = next(it["numero"] for it in mi["items"] if "ARROZ" in it["descripcion_corta"])
    n_aceite = next(it["numero"] for it in mi["items"] if "ACEITE" in it["descripcion_corta"])
    precios = [_precio(n_arroz, f"Arroz {i}", p, "kg", f"a{i}.pe") for i, p in enumerate([4.0, 4.2, 4.4])]
    precios += [_precio(n_aceite, f"Aceite {i}", p, "litro", f"o{i}.pe") for i, p in enumerate([9.0, 9.5, 10.0])]
    _fake_fanout(monkeypatch, precios)
    res = mk._mercado_goods_retail(st)
    assert res["sobreprecio_pct"] is None
    assert res["estimado_vs_mercado_pct"] is not None and res["estimado_vs_mercado_pct"] > 50
    assert res["veredicto_global"] == "estimado_sobre_mercado"
    assert res["lote"]["motivo"] == "solo_cuantia_referencial_disponible"


# ═════════════════════════════════════════════════════════════════════
# 1225030 · un solo ítem: sin bandera de lote + ancla regional
# ═════════════════════════════════════════════════════════════════════
def test_1225030_un_solo_item_sin_lote_y_alineado_regional(monkeypatch):
    piedra = _mi_un_item("PIEDRA GRANDE DE 10 A 12 PULGADAS", 6450, "M3", ofertado=113.80, referencial=115.0,
                         extra={"cuantia_referencial_item": 741750.0, "cubso": "1111161100147623"})
    precios = [_precio("1", "Piedra de 12 in", 64.0, "m3", "todolicitaciones.pe"),
               _precio("1", "Piedra grande genérico", 63.33, "m3", "cype.pe"),
               _precio("1", "Piedra de zanja", 60.0, "m3", "sodimac.com.pe"),
               _precio("1", "Piedra grande de 8 in", 40.0, "m3", "scribd.com"),
               _precio("1", "Piedra de río 8 in", 25.0, "m3", "webnode.pe")]
    refs = [_ref("1231226", 'ADQUISICION DE PIEDRA GRANDE DE 10" A 15" PARA EL PROYECTO', 85.0, 83.0),
            _ref("1227961", 'PIEDRA GRANDE DE 8" A 10"', 155.0, None),
            _ref("1227779", "PIEDRA ZARANDEADA DE 1/2 in", 500.0, 500.0),          # chancada: no es el mismo bien
            _ref("1241824", "ADQUISICIÓN DE PIEDRA MEDIANA 6 IN A 10 IN", 36.0, 19.85, misma_region=False)]
    res, st = _run_retail(monkeypatch, [piedra], precios, total_ofertado=734010.0, base="adjudicado", refs=refs)
    f = res["findings"][0]
    assert f["veredicto_retail"] == "muy_elevado" and f["diff_pct_retail"] == pytest.approx(89.67, abs=0.1)
    assert f["veredicto"] == "alineado_regional" and f["diff_fuente"] == "ancla_regional"
    assert f["ancla_regional"]["ambito"] == "departamento" and f["ancla_regional"]["ocids"] == ["1231226", "1227961"]
    assert f["ancla_regional"]["rango_min"] == 83.0 and f["ancla_regional"]["rango_max"] == 155.0
    assert {r["ocid"] for r in f["referencias_internas"]} == {"1231226", "1227961", "1241824"}
    assert f["nota_base"] and "valor referencial" in f["nota_base"]     # oferta = 98.96 % del VR
    # Un solo ítem: nada que permita recalcular un "sobreprecio de lote".
    assert res["lote"]["aplica"] is False and res["sobreprecio_pct"] is None and res["total_estimado_mercado"] is None
    assert res["veredicto_global"] == "alineado_regional"


# ═════════════════════════════════════════════════════════════════════
# 1225090 · Δ de lote sobre los mismos ítems
# ═════════════════════════════════════════════════════════════════════
def test_1225090_lote_compara_los_mismos_items(monkeypatch):
    kits = [_mi_un_item("KIT ANTIGLOBULINA HUMANA", 10000, "UND", ofertado=14.80, numero="1.1"),
            _mi_un_item("KIT ANTI-A ANTI-B", 3000, "UND", ofertado=38.60, numero="1.2"),
            _mi_un_item("KIT ANTI-D", 2000, "UND", ofertado=42.10, numero="1.3"),
            _mi_un_item("KIT CONTROL DE CALIDAD", 1000, "UND", ofertado=48.90, numero="1.4")]
    precios = []
    for num, med in (("1.1", 12.0), ("1.2", 30.0), ("1.3", 40.0)):
        precios += [_precio(num, f"Kit {num} {i}", med * k, "unidad", f"lab{i}.pe") for i, k in enumerate([0.95, 1.0, 1.05])]
    res, _ = _run_retail(monkeypatch, kits, precios, total_ofertado=649800.0, base="contrato")
    lote = res["lote"]
    assert lote["n_respaldados"] == 3 and lote["base"] == "ofertado_items"
    assert lote["total_ofertado_respaldados"] == pytest.approx(148000 + 115800 + 84200, abs=1)
    assert lote["total_mercado_respaldados"] == pytest.approx(120000 + 90000 + 80000, abs=1)
    assert res["cobertura_mercado"] == pytest.approx(348000 / 396900, abs=0.01)
    assert res["sobreprecio_pct"] == pytest.approx(20.0, abs=0.1) and res["veredicto_global"] == "elevado"


def test_guardarrail_delta_implausible_sin_unidad_confirmada(monkeypatch):
    it = _mi_un_item("MOBILIARIO ESCOLAR", 100, "UND", ofertado=900.0)
    precios = [_precio("1", f"Silla escolar {i}", p, "unidad", f"m{i}.pe") for i, p in enumerate([100.0, 110.0, 120.0])]
    res, st = _run_retail(monkeypatch, [it], precios)
    f = res["findings"][0]
    assert f["diff_pct_retail"] > 300 and f["n_precios_normalizados"] == 0
    assert f["veredicto"] == "no_verificable" and f["estado"] == "no_verificable"
    assert f["motivo_estimacion"] == "delta_implausible_sin_unidad_confirmada"
    assert any(d.get("motivo") == "delta_implausible" for d in st["descartes"])


def test_guardarrail_lote_cobertura_baja_no_extrapola(monkeypatch):
    """El ítem chico (0.2 % del valor) sí puede ser señal por ítem, pero no se extrapola al lote."""
    a = _mi_un_item("EQUIPO A", 10, "UND", ofertado=5000.0, numero="1")
    b = _mi_un_item("AZUCAR RUBIA", 1, "KG", ofertado=100.0, numero="2")
    precios = [_precio("2", f"Azúcar rubia {i}", p, "kg", f"e{i}.pe") for i, p in enumerate([20.0, 21.0, 22.0])]
    res, _ = _run_retail(monkeypatch, [a, b], precios, total_ofertado=50100.0, base="contrato")
    f = next(f for f in res["findings"] if f["item_numero"] == "2")
    assert f["veredicto"] == "muy_elevado" and f["n_precios_normalizados"] == 3
    assert res["cobertura_mercado"] < 0.01
    assert res["veredicto_global"] == "cobertura_parcial" and res["sobreprecio_pct"] is None


# ═════════════════════════════════════════════════════════════════════
# coincide_objeto (fallback) y helpers de fallback
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("objeto,item,esperado", [
    ("ADQUISICION DE GEOSINTETICOS PARA EL PROYECTO", "GEOMALLA TRIAXIAL", True),
    ("PERFILERIA METALICA PARA CONSTRUCCION EN SECO", "PARANTE 89 x 38 x 0.90 mm", True),
    ("CONTRATACION DE COMBUSTIBLE PARA MAQUINARIA", "GASOHOL REGULAR", True),
    ("DIESEL B5 S-50", "DIESEL B5 S50", True),
    ("DIESEL B5 S-50", "GASOHOL REGULAR", False),
    ("ADQUISICION DE CARNES", "CAMION VOLQUETE", False),
    ("REACTIVOS PARA INMUNOHEMATOLOGIA", "KIT ANTIGLOBULINA HUMANA", True),
    ("ADQUISICION DE BIENES PARA EL PROYECTO", "ESTACION TOTAL", True),       # comodín
    ("MEJORAMIENTO DEL CAMINO VECINAL EMP. PE-3S", "ESTACION TOTAL", False),
])
def test_coincide_objeto_fallback(objeto, item, esperado):
    assert mk._coincide_objeto_fallback(objeto, [item]) is esperado
    assert mk._coincide_objeto(objeto, [{"descripcion_corta": item}]) is esperado or mk._coincide_objeto(objeto, [item]) is esperado


def test_coincide_objeto_usa_helper_de_compliance_si_existe(monkeypatch):
    import types
    fake = types.ModuleType("tools.compliance_rules")
    fake.coincide_objeto = lambda objeto, items: objeto == "MAGIC"
    monkeypatch.setitem(sys.modules, "tools.compliance_rules", fake)
    assert mk._coincide_objeto("MAGIC", ["cualquier cosa"]) is True
    assert mk._coincide_objeto("DIESEL", ["DIESEL"]) is False              # el helper de R1 manda
    fake.coincide_objeto = lambda objeto, items: (_ for _ in ()).throw(TypeError("firma distinta"))
    assert mk._coincide_objeto("DIESEL", ["DIESEL"]) is True               # excepción → fallback propio


def test_award_items_y_total_ofertado_desde_ocds():
    ocds = {"awards": [{"id": "a", "value": {"amount": 121839.0},
                        "items": [{"id": "21307628", "position": "1", "quantity": 5000.0, "totalValue": {"amount": 121839.0}}]}]}
    assert mk._award_items_ocds(ocds) == {"1": 24.3678, "21307628": 24.3678}
    assert mk._total_ofertado_proceso([], [], {}, ocds, 139950.0) == (121839.0, "adjudicado")
    assert mk._total_ofertado_proceso([], [], {}, {}, 139950.0) == (139950.0, "referencial")
    assert mk._total_ofertado_proceso([], [], {"precio_final_total": "S/ 121,839.00"}, ocds, None) == (121839.0, "contrato")


def test_prorrateo_contrato_misma_unidad():
    items = [{"numero": "1", "descripcion_corta": "DIESEL", "cantidad": 5000, "unidad": "GALON"},
             {"numero": "2", "descripcion_corta": "GASOHOL", "cantidad": 100, "unidad": "GALON"}]
    mk._enriquecer_precio_ofertado(items, [], {}, {}, {"precio_final_total": 121839.0}, {})
    assert all(it["precio_unitario_ofertado"] == 23.89 and it["origen_precio"] == "prorrateo_contrato_misma_unidad" for it in items)
    items_und = [{"numero": "1", "descripcion_corta": "LAPTOP", "cantidad": 10, "unidad": "UND"},
                 {"numero": "2", "descripcion_corta": "MOUSE", "cantidad": 10, "unidad": "UND"}]
    mk._enriquecer_precio_ofertado(items_und, [], {}, {}, {"precio_final_total": 30000.0}, {})
    assert all(it["precio_unitario_ofertado"] is None for it in items_und)   # UND heterogéneo: no se prorratea


# ═════════════════════════════════════════════════════════════════════
# Cloud SQL real (RUN_DB=1): CUBSO de 1225030 → VR de Cusco 2026
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.skipif(os.getenv("RUN_DB") != "1", reason="RUN_DB=1 con PGHOST/PGPASSWORD hacia Cloud SQL")
def test_referencias_internas_reales_1225030():
    refs = mk._consultar_referencias_internas("1225030", ["1111161100147623"], "PIEDRA GRANDE DE 10 A 12 PULGADAS")
    it = {"numero": "1", "descripcion_corta": "PIEDRA GRANDE DE 10 A 12 PULGADAS", "unidad": "M3"}
    ancla, usables = mk._ancla_regional_item(it, refs, 113.80, mk._contexto_unidad_item(it))
    por_ocid = {r["ocid"]: r for r in usables}
    assert "1231226" in por_ocid and "1227961" in por_ocid, [r["ocid"] for r in usables]
    assert por_ocid["1231226"]["precio_unitario_referencial"] == pytest.approx(85.0)
    assert por_ocid["1227961"]["precio_unitario_referencial"] == pytest.approx(155.0)
    assert ancla["estado"] == "hallado" and ancla["ambito"] == "departamento"
    assert ancla["veredicto_regional"] == "alineado_regional"


def test_totales_bloqueados_no_permiten_recalcular_lote(monkeypatch):
    """`persist_market_flags_as_banderas` recalcula sobreprecio desde totales si `sobreprecio_pct`
    es None: en los casos bloqueados (1 ítem, solo referencial, cobertura parcial) el market no
    publica `total_estimado_mercado`, así que ese fallback no puede fabricar una bandera de lote."""
    piedra = _mi_un_item("PIEDRA GRANDE DE 10 A 12 PULGADAS", 6450, "M3", ofertado=113.80, referencial=115.0)
    precios = [_precio("1", f"Piedra {i}", p, "m3", f"p{i}.pe") for i, p in enumerate([64.0, 63.33, 60.0])]
    res, _ = _run_retail(monkeypatch, [piedra], precios, total_ofertado=734010.0, base="adjudicado")
    assert res["sobreprecio_pct"] is None and res["total_estimado_mercado"] is None
    assert res["lote"]["total_mercado_respaldados"] == pytest.approx(63.33 * 6450, abs=1)


# ═════════════════════════════════════════════════════════════════════
# Estimación IA (sin grounding) para lotes con demasiados ítems (> MARKET_ESTIMACION_DESDE)
# ═════════════════════════════════════════════════════════════════════
def _top20_y_fake_grounded(monkeypatch):
    """20 ítems de valor 500 (ofertado 50 × cantidad 10), cada uno con 3 precios grounded
    idénticos al ofertado → todos `alineado`/respaldados, cobertura 100 %, sobreprecio_pct 0."""
    top = [_mi_un_item(f"ITEM {i}", 10, "UND", ofertado=50.0, numero=str(i)) for i in range(1, 21)]
    llamadas = {}

    def _fake_grounded(its, objeto, state, contexto=""):
        llamadas["items"] = sorted((it["numero"] for it in its), key=int)
        precios = [_precio(str(i), f"Producto {i}", 50.0, "unidad", f"tienda{i}.pe")
                   for i in range(1, 21) for _ in range(3)]
        chunks = [p["fuentes"][0] for p in precios]
        return precios, {}, set(), chunks, 20

    monkeypatch.setattr(mk, "_fanout_goods_retail", _fake_grounded)
    _fake_refs(monkeypatch, [])
    return top, llamadas


def _st(items):
    return {"ocid": "1", "ocds": {"ocid": "1", "tender": {"description": "OBJETO"}},
            "market_input": {"ocid": "1", "items": items, "padre_lote": None, "total_ofertado": None,
                             "total_ofertado_base": None, "cuantia_referencial_total": None}}


def test_estimacion_ia_no_afecta_veredicto_ni_cobertura_del_lote(monkeypatch):
    """Añadir ítems de cola (estimados por IA, sin búsqueda) a un lote NO puede cambiar
    sobreprecio_pct/veredicto_global/cobertura_mercado frente al mismo lote sin esos ítems —
    son puramente informativos (n_precios=0, sin ancla) y quedan fuera de `respaldados`."""
    top, _ = _top20_y_fake_grounded(monkeypatch)
    res_sin_cola = mk._mercado_goods_retail(_st(top))
    assert res_sin_cola["sobreprecio_pct"] == pytest.approx(0.0, abs=0.01)
    assert res_sin_cola["veredicto_global"] == "alineado"

    top2, llamadas = _top20_y_fake_grounded(monkeypatch)
    cola = [_mi_un_item(f"ITEM {i}", 10, "UND", ofertado=1.0, numero=str(i)) for i in range(21, 24)]

    def _fake_estimacion(its, objeto, state, contexto=""):
        # Precio absurdo a propósito: si esto pudiera colarse en sobreprecio_pct/cobertura,
        # el test lo detectaría de inmediato.
        return ({it["numero"]: {"precio_estimado": 999999.0, "unidad": "unidad", "confianza": "baja",
                                "justificacion": "estimación de prueba"} for it in its}, set(), 1)

    monkeypatch.setattr(mk, "_fanout_estimacion_llm", _fake_estimacion)
    res_con_cola = mk._mercado_goods_retail(_st(top2 + cola))

    assert llamadas["items"] == [str(i) for i in range(1, 21)]      # la cola NUNCA entra al fan-out grounded
    # El % de sobreprecio y el veredicto (lo que dispara banderas) son IDÉNTICOS con o sin cola:
    # los 999 999 estimados no pueden moverlos ni un poco.
    assert res_con_cola["sobreprecio_pct"] == res_sin_cola["sobreprecio_pct"]
    assert res_con_cola["veredicto_global"] == res_sin_cola["veredicto_global"]
    assert res_con_cola["n_respaldados"] == res_sin_cola["n_respaldados"]
    # La cobertura por VALOR sí baja un poco (el denominador crece con la cola sin verificar) —
    # exactamente lo esperado: nunca puede SUBIR ni llegar a superar la del lote sin cola.
    assert res_con_cola["cobertura_mercado"] < res_sin_cola["cobertura_mercado"]
    assert res_con_cola["n_items_estimados_ia"] == 3
    assert res_con_cola["n_items"] == 23

    for num in ("21", "22", "23"):
        f = next(f for f in res_con_cola["findings"] if f["item_numero"] == num)
        assert f["precio_estimado_ia"] == 999999.0
        assert f["estado"] == "estimado_ia"
        assert f["confianza_estimacion_ia"] == "baja"
        assert f["motivo_estimacion"] == "estimado_por_ia_sin_busqueda"
        # Campos "verificados" intactos en su default sin_dato: nada que una bandera pueda leer.
        assert f["precio_mediana_mercado"] is None and f.get("precio_mediana_comparacion") is None
        assert f["veredicto"] == "sin_dato" and f["n_precios"] == 0
        assert f["diff_pct"] is None and f.get("diff_fuente") is None


def test_estimacion_ia_no_dispara_bandera_por_item(monkeypatch):
    """`persist_market_flags_as_banderas` solo dispara con veredicto_item en {elevado,
    muy_elevado}: un finding estimado por IA (veredicto='sin_dato') nunca puede generar
    `sobreprecio_elevado`/`sobreprecio_muy_elevado`, sin importar cuán extremo sea el precio
    estimado ni la confianza que reporte el modelo."""
    top, _ = _top20_y_fake_grounded(monkeypatch)
    cola = [_mi_un_item("ITEM COLA", 10, "UND", ofertado=1.0, numero="21")]

    def _fake_estimacion(its, objeto, state, contexto=""):
        return ({it["numero"]: {"precio_estimado": 0.0001, "unidad": "unidad", "confianza": "alta",
                                "justificacion": "precio irrisorio a propósito"} for it in its}, set(), 1)

    monkeypatch.setattr(mk, "_fanout_estimacion_llm", _fake_estimacion)
    res = mk._mercado_goods_retail(_st(top + cola))
    f21 = next(f for f in res["findings"] if f["item_numero"] == "21")
    assert (f21.get("veredicto") or "").lower() not in ("elevado", "muy_elevado")


# ═════════════════════════════════════════════════════════════════════
# Live (RUN_LIVE=1 + PGHOST): state real de 1225450 reconstruido desde dataset/_revision
# ═════════════════════════════════════════════════════════════════════
_REV_1225450 = os.path.join(os.path.dirname(os.path.dirname(_AGENT)), "dataset", "_revision", "1225450")


@pytest.mark.live
@pytest.mark.skipif(not os.getenv("PGHOST") or not os.path.exists(os.path.join(_REV_1225450, "alerta.json")),
                    reason="requiere PGHOST hacia Cloud SQL y dataset/_revision/1225450/alerta.json")
def test_live_1225450_ya_no_sale_7162_pct():
    import glob
    import json
    alerta = json.load(open(os.path.join(_REV_1225450, "alerta.json"), encoding="utf-8"))
    conv = json.load(open(os.path.join(_REV_1225450, "convocatoria.json"), encoding="utf-8"))
    af = alerta["analisis_full"]
    assert af["market_analysis"]["sobreprecio_pct"] > 7000          # lo que se persistió en la corrida original
    otros = []
    for f in glob.glob(os.path.join(_REV_1225450, "texto", "*.extraccion.json")):
        d = next(iter(json.load(open(f, encoding="utf-8")).values()))
        if d.get("tipo_documento_detectado") == "contrato":
            otros += [{**it, "_documento": "Archivos del contrato"} for it in d.get("items") or []]
    st = {"ocid": "1225450", "ocds": conv["ocds_payload"], "document_analysis": af["document_analysis"],
          "parser_raw_consolidated": {"items_consolidados": af["document_analysis"]["items_consolidados"],
                                      "items_otros_documentos": otros},
          "contrato_final": af.get("contrato_final"), "estudio_mercado": af.get("estudio_mercado")}
    res = mk.analizar_mercado(st, "goods_retail")
    ma = st["market_analysis"]
    assert res["ok"] and ma["n_items"] == 2 and ma["total_ofertado"] == 121839.0 and ma["total_ofertado_base"] == "contrato"
    assert all(f["precio_unitario_ofertado"] == 23.89 for f in ma["findings"])
    assert ma["sobreprecio_pct"] is None or -15 < ma["sobreprecio_pct"] < 15
    assert ma["veredicto_global"] in ("alineado", "alineado_regional", "cobertura_parcial", "sin_dato")
    diesel = next(f for f in ma["findings"] if str(f["item_numero"]) == "1")
    assert diesel["ancla_regional"]["estado"] == "hallado" and diesel["ancla_regional"]["ambito"] == "departamento"
