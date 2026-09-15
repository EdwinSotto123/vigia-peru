"""Tests de reglas de compliance (WS V · Task V3) con BD falsa y state sintético.

  · C2 único postor: 1 postor + oferta ≥ 95 % → ALTA; 5 postores → nada; sin dato de
    postores → `sin_dato` (no bandera). Antes `ofertas` solo tenía ganadores y la regla
    disparaba siempre que hubiera award (falso positivo estructural, hallazgo #3).
  · reglas_activas / topes_uit por perfil (default = comportamiento anterior).
  · directa_emergencia_sin_acto_resolutivo: ALTA con texto completo, MEDIA +
    requiere_verificacion con solo resúmenes, no dispara si el acto está en el PDF.
  · firmante_vinculado_ganador exige fuente_url + confianza_match='alta'.
  · inconsistencia_doc_vs_ocds cuenta solo ítems raíz y no habla de "manipulación".
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import compliance_rules as cr  # noqa: E402
from tools import verify  # noqa: E402

OCID = "1216608"


class _Ctx:
    def __init__(self, state):
        self.state = state


class _FakeCursor:
    """Responde por patrón de SQL; `rows` mapea fragmento → filas."""

    def __init__(self, rows: dict):
        self.rows = rows
        self._cur = []

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        for frag, val in self.rows.items():
            if frag in s:
                self._cur = list(val) if isinstance(val, list) else [val]
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

    def commit(self):
        pass


def _ocds(n_tenderers=None, tenderers=None, ref=100000.0, adj=None):
    tender = {"value": {"amount": ref, "currency": "PEN"}, "description": "ADQUISICION DE LAPTOPS",
              "items": [{"id": "1"}, {"id": "2"}]}
    if n_tenderers is not None:
        tender["numberOfTenderers"] = n_tenderers
    if tenderers is not None:
        tender["tenderers"] = tenderers
    ocds = {"tender": tender, "parties": []}
    if adj is not None:
        ocds["awards"] = [{"suppliers": [{"id": "PE-RUC-20123456789", "name": "X"}],
                           "value": {"amount": adj, "currency": "PEN"}}]
    return ocds


@pytest.fixture(autouse=True)
def _sin_bd_verify(monkeypatch):
    monkeypatch.setattr(verify, "_en_bd", lambda kind, valor: False)
    monkeypatch.setattr(verify, "_texto_documento", lambda sha: None)


# ─── C2 ──────────────────────────────────────────────────────────────────────

def test_c2_un_postor_al_98_dispara_alta(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"round(avg(o.porcentaje_referencial)": (98.5,)}))
    st = {"ocds": _ocds(n_tenderers=1)}
    r = cr.check_unique_bidder_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "alta"
    assert r["n_postores"] == 1 and r["fuente_n_postores"] == "ocds" and r["estado"] == "hallado"
    assert st["pending_flags"][0]["regla"] == "unico_postor_alto"
    assert "98.5%" in r["evidencia"]


def test_c2_cinco_postores_no_dispara_aunque_ganador_al_100(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"round(avg(o.porcentaje_referencial)": (100.0,)}))
    st = {"ocds": _ocds(n_tenderers=5)}
    r = cr.check_unique_bidder_rule(OCID, _Ctx(st))
    assert r["triggered"] is False and r["n_postores"] == 5 and r["estado"] == "hallado"
    assert "pending_flags" not in st


def test_c2_sin_dato_de_postores_no_es_bandera(monkeypatch):
    # OCDS sin numberOfTenderers/tenderers y BD solo con ofertas ganadoras (0 no ganadoras)
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "count(distinct p.empresa_ruc)": (1, 0),
        "round(avg(o.porcentaje_referencial)": (100.0,),
    }))
    st = {"ocds": _ocds()}
    r = cr.check_unique_bidder_rule(OCID, _Ctx(st))
    assert r["estado"] == "sin_dato" and r["triggered"] is False and r["n_postores"] is None
    assert "pending_flags" not in st


def test_c2_bd_con_ofertas_no_ganadoras_cuenta_postores(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "count(distinct p.empresa_ruc)": (3, 2),          # 3 postores, 2 ofertas perdedoras registradas
        "round(avg(o.porcentaje_referencial)": (99.0,),
    }))
    st = {"ocds": _ocds()}
    r = cr.check_unique_bidder_rule(OCID, _Ctx(st))
    assert r["n_postores"] == 3 and r["fuente_n_postores"] == "ofertas_bd" and r["triggered"] is False


def test_c2_un_postor_pero_oferta_baja_no_dispara(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"round(avg(o.porcentaje_referencial)": (80.0,)}))
    st = {"ocds": _ocds(tenderers=[{"id": "PE-RUC-20123456789", "name": "X"}])}
    r = cr.check_unique_bidder_rule(OCID, _Ctx(st))
    assert r["n_postores"] == 1 and r["triggered"] is False and "oferta < 95%" in r["motivo"]


def test_c2_pct_desde_ocds_si_bd_no_tiene_ofertas(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({}))
    st = {"ocds": _ocds(n_tenderers=1, ref=100000.0, adj=97000.0)}
    r = cr.check_unique_bidder_rule(OCID, _Ctx(st))
    assert r["pct_ganador_vs_referencial"] == 97.0 and r["triggered"] is True


def test_c2_parties_role_tenderer(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"round(avg(o.porcentaje_referencial)": (99.0,)}))
    ocds = _ocds()
    ocds["parties"] = [{"id": "PE-RUC-1", "roles": ["tenderer"]}, {"id": "PE-RUC-2", "roles": ["tenderer"]},
                       {"id": "PE-RUC-3", "roles": ["buyer"]}]
    r = cr.check_unique_bidder_rule(OCID, _Ctx({"ocds": ocds}))
    assert r["n_postores"] == 2 and r["triggered"] is False


# ─── Perfil: reglas_activas y topes_uit ──────────────────────────────────────

def test_regla_no_activa_en_perfil_se_omite(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: (_ for _ in ()).throw(AssertionError("no debe tocar la BD")))
    st = {"ocds": _ocds(n_tenderers=1)}
    r = cr.check_unique_bidder_rule(OCID, _Ctx(st), reglas_activas=frozenset({"otra_regla"}))
    assert r["omitida"] is True and r["triggered"] is False and r["estado"] == "sin_dato"
    # también vía state (para los FunctionTool que no reciben kwargs)
    st2 = {"ocds": _ocds(n_tenderers=1), "reglas_activas": ["otra_regla"]}
    r2 = cr.check_unique_bidder_rule(OCID, _Ctx(st2))
    assert r2["omitida"] is True


def test_topes_uit_por_perfil_en_tipo_proceso_vs_monto(monkeypatch):
    # AS con 1000 UIT (S/ 5 350 000): bienes (tope 400) dispara; obras (tope 1800) no.
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "select tipo_proceso, cuantia_referencial from convocatorias": ("ADJUDICACION SIMPLIFICADA", 5350000.0)}))
    st = {}
    r = cr.check_tipo_proceso_vs_monto_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and "400 UIT" in r["evidencia"]
    st2 = {}
    r2 = cr.check_tipo_proceso_vs_monto_rule(OCID, _Ctx(st2), topes_uit={"adjudicacion_simplificada": 1800})
    assert r2["triggered"] is False and r2["topes_uit"]["adjudicacion_simplificada_max"] == 1800.0
    r3 = cr.check_tipo_proceso_vs_monto_rule(OCID, _Ctx({}), topes_uit={"licitacion_publica": 1800, "uit": 5350})
    assert r3["triggered"] is False


def test_tool_wrappers_tienen_firma_simple():
    decl = cr.check_unique_bidder_rule_tool._get_declaration()
    assert decl.name == "check_unique_bidder_rule"
    assert set(decl.parameters.properties.keys()) == {"ocid"}
    assert set(cr.REGLAS_POR_NOMBRE) >= {"adicional_acumulado", "personal_clave_vinculado",
                                         "fraccionamiento", "directa_recurrente"}


# ─── Acto resolutivo (hallazgo #5) ───────────────────────────────────────────

def _directa_conn():
    return _FakeConn({"select tipo_proceso, objeto from convocatorias": ("CONTRATACION DIRECTA", "COMPRA DE AGUA")})


def test_directa_acto_en_texto_completo_no_dispara(monkeypatch):
    monkeypatch.setattr(cr, "_pg", _directa_conn)
    st = {"document_analysis": {"fundamento_legal": ["Art. 27 lit. a) situación de emergencia por lluvias intensas"]},
          "documentos_texto": {"f" * 64: {"texto": "⟦p.1⟧ Informe. ⟦p.3⟧ Conforme al Decreto Supremo N° 012-2026-PCM "
                                                    "que declara el estado de emergencia del 5 de marzo de 2026."}}}
    r = cr.check_directa_fundamento_rule(OCID, _Ctx(st))
    assert r["triggered"] is False
    acto = st["acto_resolutivo_directa"]
    assert acto["encontrado"] is True and acto["pagina"] == 3 and acto["fuente"] == "documentos_texto"
    assert acto["documento_sha256"] == "f" * 64 and "012-2026-PCM" in acto["cita"]


def test_directa_sin_acto_con_texto_completo_alta(monkeypatch):
    monkeypatch.setattr(cr, "_pg", _directa_conn)
    st = {"document_analysis": {"fundamento_legal": ["situación de emergencia por desastre"]},
          "documentos_texto": {"f" * 64: {"texto": "⟦p.1⟧ Informe técnico sin ninguna resolución citada."}}}
    r = cr.check_directa_fundamento_rule(OCID, _Ctx(st))
    assert r["regla"] == "directa_emergencia_sin_acto_resolutivo" and r["severidad"] == "alta"
    assert r["requiere_verificacion"] is False and "texto completo" in r["evidencia"]


def test_directa_sin_acto_solo_resumenes_media_requiere_verificacion(monkeypatch):
    monkeypatch.setattr(cr, "_pg", _directa_conn)
    st = {"document_analysis": {"fundamento_legal": ["situación de emergencia por desastre"]}}
    r = cr.check_directa_fundamento_rule(OCID, _Ctx(st))
    assert r["regla"] == "directa_emergencia_sin_acto_resolutivo" and r["severidad"] == "media"
    assert r["requiere_verificacion"] is True and "requiere verificación manual" in r["evidencia"]


def test_directa_acto_en_estudio_mercado_causal(monkeypatch):
    monkeypatch.setattr(cr, "_pg", _directa_conn)
    st = {"document_analysis": {"fundamento_legal": ["desabastecimiento inminente"]},
          "estudio_mercado": {"causal_articulo": "Art. 27.1.b", "causal_texto": "Sustentado en la R.M. N° 0123-2026-MINSA"}}
    r = cr.check_directa_fundamento_rule(OCID, _Ctx(st))
    assert r["triggered"] is False and st["acto_resolutivo_directa"]["fuente"] == "parser_bloque_tipado"


# ─── firmante_vinculado_ganador (hallazgo #8) ────────────────────────────────

def test_firmante_vinculado_exige_fuente_y_confianza_alta():
    base = {"firmante": "A", "cargo_firmante": "Gerente", "persona_proveedor": "B",
            "tipo_relacion": "misma_direccion", "severidad": "alta", "evidencia": "coinciden"}
    st = {"person_network": {"cruce_firmantes_ganador": [
        dict(base),                                                # sin fuente ni confianza
        dict(base, fuente_url="https://x.gob.pe/1", confianza_match="media"),
    ]}}
    r = cr.check_recurrencia_firmante_rule(OCID, _Ctx(st))
    assert r["triggered"] is False and r["n_cruces_no_verificables"] == 2 and r["estado"] == "no_verificable"
    st2 = {"person_network": {"cruce_firmantes_ganador": [
        dict(base, fuente_url="https://x.gob.pe/1", confianza_match="alta")]}}
    r2 = cr.check_recurrencia_firmante_rule(OCID, _Ctx(st2))
    assert r2["triggered"] is True and st2["pending_flags"][0]["fuente_url"] == "https://x.gob.pe/1"


# ─── inconsistencia_doc_vs_ocds ──────────────────────────────────────────────

def test_inconsistencia_cuenta_solo_items_raiz_y_sin_manipulacion():
    ocds = _ocds()   # 2 ítems
    st = {"ocds": ocds, "document_analysis": {
        "cuantia_total": 100000.0,
        "items_consolidados": [
            {"descripcion_corta": "LAPTOP CORE I7", "padre_ocds_item": None},
            {"descripcion_corta": "LAPTOP CORE I5", "padre_ocds_item": None},
            {"descripcion_corta": "MOUSE", "padre_ocds_item": "1"},
            {"descripcion_corta": "TECLADO", "padre_ocds_item": "1"},
        ]}}
    r = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
    assert r["triggered"] is False and r["inconsistencias"] == []
    st2 = {"ocds": ocds, "document_analysis": {
        "cuantia_total": 100000.0,
        "items_consolidados": [{"descripcion_corta": "LAPTOP CORE I7"}, {"descripcion_corta": "LAPTOP I5"},
                               {"descripcion_corta": "LAPTOP I3"}]}}
    r2 = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st2))
    assert r2["triggered"] is True and "manipulaci" not in r2["evidencia"].lower()
    assert "requiere verificación manual" in r2["evidencia"]


# ─── evaluate_normative_compliance sin corte a 10 ───────────────────────────

def test_normative_compliance_prioriza_severidad_y_registra_recorte(monkeypatch):
    monkeypatch.setenv("RAG_MAX_HALLAZGOS", "5")
    monkeypatch.setattr(cr, "query_legal_rag", lambda q, tc: {"matches": [{"num_opinion": "001"}]})
    flags = [{"regla": f"r{i}", "evidencia": f"e{i}", "severidad": "baja"} for i in range(8)]
    flags += [{"regla": "grave", "evidencia": "g", "severidad": "alta"}]
    st = {"pending_flags": flags}
    out = cr.evaluate_normative_compliance(OCID, _Ctx(st))
    assert out["n_hallazgos_evaluados"] == 5 and out["n_hallazgos_totales"] == 9 and out["truncado"] is True
    assert out["evaluaciones"][0]["hallazgo"]["titulo"] == "grave"
    assert st["recortes"][0]["donde"] == "evaluate_normative_compliance" and st["recortes"][0]["omitido"] == 4
