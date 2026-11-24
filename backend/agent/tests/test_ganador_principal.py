"""El ganador principal es uno solo en todo el análisis, y los hechos de contexto no son banderas (2026-11-24).

  · Con varios ganadores se nombra al de MAYOR monto adjudicado (CONOSCE, o sin CONOSCE las adjudicaciones vigentes del
    OCDS), empate por RUC: la misma regla que la API. Antes `get_ganador` tomaba el primero de `parties[]` (2026-2543-197:
    HAMUQ, tercero por monto de 8), la alerta un `LIMIT 1` sin orden y las reglas el primer award con RUC.
  · Buena pro reemplazada (1220581): el OCDS trae a JEMAR primero y al CONSORCIO TECNISAN - METROPOLITAN sobre el mismo
    ítem; CONSOCE registra contratado al consorcio. El ganador es el consorcio, no JEMAR.
  · testaferro_multi_ruc, directa_recurrente y fraccionamiento miran a cada ganador, no a uno cualquiera.
  · Un hecho de contexto (puntua=false) no va en `reglas_disparadas` ni se cuenta como bandera en el dictamen.
"""
from __future__ import annotations

import datetime as dt
import os
import sys
from types import SimpleNamespace

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import compliance_rules as cr  # noqa: E402
from tools import ocds as ocds_mod  # noqa: E402
from tools import state_loaders as SL  # noqa: E402
from tools.compliance_rules import _base  # noqa: E402
from tools.persistence import shared  # noqa: E402

JEMAR, TECNISAN = "20601052084", "1807502"
ACFARMA, MIAVIDA, HAMUQ = "20347268683", "20600413571", "20613527134"


def _sin_base(monkeypatch):
    def _pg():
        raise ConnectionError("sin base en los tests")
    monkeypatch.setattr(_base, "_pg", _pg)


def _ocds_1220581(con_contrato=True):
    """Dos adjudicaciones sobre el mismo ítem (S/ 1,8 M de referencial): JEMAR primero; el consorcio, con contrato."""
    o = {"ocid": "ocds-dgv273-seacev3-1220581",
         "tender": {"items": [{"id": "21293428", "totalValue": {"amount": 1800000}}]},
         "parties": [{"id": f"PE-RUC-{JEMAR}", "name": "JEMAR CONTRATISTAS GENERALES S.A.C.", "roles": ["tenderer", "supplier"],
                      "identifier": {"scheme": "PE-RUC", "id": JEMAR}},
                     {"id": f"PE-RUC-{TECNISAN}", "name": "CONSORCIO TECNISAN - METROPOLITAN", "roles": ["tenderer", "supplier"]}],
         "awards": [{"id": f"1220581-{JEMAR}", "value": {"amount": 1337700.7}, "items": [{"id": "21293428"}],
                     "suppliers": [{"id": f"PE-RUC-{JEMAR}", "name": "JEMAR CONTRATISTAS GENERALES S.A.C."}]},
                    {"id": f"1220581-{TECNISAN}", "value": {"amount": 1487000}, "items": [{"id": "21293428"}],
                     "suppliers": [{"id": f"PE-RUC-{TECNISAN}", "name": "CONSORCIO TECNISAN - METROPOLITAN"}]}]}
    if con_contrato:
        o["contracts"] = [{"id": "2424097", "awardID": f"1220581-{TECNISAN}", "value": {"amount": 1487000}}]
    return o


def _ocds_varios():
    """Tres ganadores por ítems distintos; `parties[]` trae primero a HAMUQ (el tercero por monto)."""
    def aw(ruc, nombre, monto, item):
        return {"id": f"x-{ruc}", "value": {"amount": monto}, "items": [{"id": item}],
                "suppliers": [{"id": f"PE-RUC-{ruc}", "name": nombre}]}
    return {"ocid": "ocds-dgv273-seacev3-2026-2543-197",
            "tender": {"items": [{"id": "i1"}, {"id": "i2"}, {"id": "i3"}]},
            "parties": [{"id": f"PE-RUC-{r}", "name": n, "roles": ["supplier"], "identifier": {"scheme": "PE-RUC", "id": r}}
                        for r, n in ((HAMUQ, "HAMUQ FARMA E.I.R.L."), (MIAVIDA, "FARMA MIAVIDA S.A.C."),
                                     (ACFARMA, "LABORATORIOS AC FARMA S.A."))],
            "awards": [aw(HAMUQ, "HAMUQ FARMA E.I.R.L.", 1474235.95, "i1"),
                       aw(MIAVIDA, "FARMA MIAVIDA S.A.C.", 3272119.05, "i2"),
                       aw(ACFARMA, "LABORATORIOS AC FARMA S.A.", 8342000.0, "i3")]}


# ═════════════════════════════════════════════════════════════════════
# 1 · Un solo ganador principal
# ═════════════════════════════════════════════════════════════════════
def test_buena_pro_reemplazada_el_ganador_es_quien_quedo(monkeypatch):
    _sin_base(monkeypatch)
    # Sin CONOSCE: las dos se pisan y pasan el referencial; queda la que tiene contrato (el consorcio).
    assert [a["id"] for a in _base._awards_vigentes(_ocds_1220581())] == [f"1220581-{TECNISAN}"]
    assert cr.ganador_principal("1220581", {"ocds": _ocds_1220581()})["ruc"] == TECNISAN
    # Con CONOSCE, la que CONOSCE registra.
    assert [a["id"] for a in _base._awards_vigentes(_ocds_1220581(False), {TECNISAN})] == [f"1220581-{TECNISAN}"]
    # Sin CONOSCE ni contrato: alternativas, queda la primera (como la API).
    assert [a["id"] for a in _base._awards_vigentes(_ocds_1220581(False))] == [f"1220581-{JEMAR}"]
    # JEMAR ya no es «el ganador con RUC» del OCDS.
    assert cr._ganador_ocds(_ocds_1220581()) == (None, None)


def test_reparto_del_mismo_item_deja_a_todos():
    o = _ocds_1220581(False)
    o["awards"][0]["value"]["amount"], o["awards"][1]["value"]["amount"] = 900000, 800000   # juntas ≤ referencial
    assert len(_base._awards_vigentes(o)) == 2


def test_varios_ganadores_el_de_mayor_monto_y_empate_por_ruc(monkeypatch):
    _sin_base(monkeypatch)
    st = {"ocds": _ocds_varios()}
    assert cr.ganador_principal("2026-2543-197", st)["ruc"] == ACFARMA
    assert cr._ganador_ruc("2026-2543-197", st) == (ACFARMA, "LABORATORIOS AC FARMA S.A.")
    o = _ocds_varios()
    o["awards"][1]["value"]["amount"] = 8342000.0          # empate AC FARMA / MIAVIDA → el RUC menor
    assert cr.ganador_principal("x", {"ocds": o})["ruc"] == ACFARMA
    assert cr._ganador_ocds(o) == (ACFARMA, "LABORATORIOS AC FARMA S.A.")


class _Cur:
    """Cursor falso: la convocatoria y lo que CONOSCE tiene del proceso."""

    def __init__(self, conosce):
        self.conosce, self.rows, self.sql = conosce, [], []

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        self.sql.append((s, params))
        if "select codigo, entidad_ruc" in s:
            self.rows = [("1220581", "20100152356")]
        elif "from conosce_adjudicaciones" in s:
            self.rows = list(self.conosce)
        elif "from empresas where ruc" in s:
            self.rows = [(1,)] if params[0] == ACFARMA else []
        else:
            self.rows = []

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


def test_conosce_manda_sobre_el_ocds():
    cur = _Cur([(TECNISAN, "CONSORCIO TECNISAN - METROPOLITAN", 1487000.0, dt.date(2026, 7, 13))])
    g = cr.ganador_principal("1220581", {"ocds": _ocds_1220581(False)}, cur)
    assert g == {"ruc": TECNISAN, "nombre": "CONSORCIO TECNISAN - METROPOLITAN", "monto": 1487000.0, "fuente": "conosce"}
    # El OCID largo es el mismo proceso.
    cur2 = _Cur([(ACFARMA, "LABORATORIOS AC FARMA S.A.", 8342000.0, None), (HAMUQ, "HAMUQ FARMA", 1474235.95, None)])
    assert cr.ganador_principal("ocds-dgv273-seacev3-2026-2543-197", {}, cur2)["ruc"] == ACFARMA
    assert any(p == ("2026-2543-197",) for s, p in cur2.sql if "select codigo, entidad_ruc" in s)


def test_get_ganador_nombra_al_de_mayor_monto_y_no_al_reemplazado(monkeypatch):
    _sin_base(monkeypatch)
    r = ocds_mod.get_ganador("2026-2543-197", SimpleNamespace(state={"ocds": _ocds_varios()}))
    assert r["ganador"]["ruc"] == ACFARMA and r["ganador"]["monto_ganado"] == 8342000.0
    assert all(p["es_ganador"] for p in r["todos_postores"])
    r2 = ocds_mod.get_ganador("1220581", SimpleNamespace(state={"ocds": _ocds_1220581()}))
    assert r2["ganador"]["ruc"] == TECNISAN
    jemar = next(p for p in r2["todos_postores"] if p["ruc"] == JEMAR)
    assert jemar["es_ganador"] is False


def test_proveedor_de_la_alerta(monkeypatch):
    # Empresa con RUC que ya está en `empresas`.
    cur = _Cur([(ACFARMA, "LABORATORIOS AC FARMA S.A.", 8342000.0, None), (HAMUQ, "HAMUQ FARMA", 1474235.95, None)])
    assert shared.proveedor_ruc_alerta("2026-2543-197", {}, cur) == (ACFARMA, True)
    # Un consorcio no tiene RUC: NULL, pero decidido (pisa al reemplazado que la alerta tenía).
    cur = _Cur([(TECNISAN, "CONSORCIO TECNISAN - METROPOLITAN", 1487000.0, None)])
    assert shared.proveedor_ruc_alerta("1220581", {}, cur) == (None, True)
    # Ganador sólo en CONOSCE, sin fila en `empresas`: se da de alta con su razón social (FK).
    cur = _Cur([(HAMUQ, "HAMUQ FARMA E.I.R.L.", 1474235.95, None)])
    assert shared.proveedor_ruc_alerta("x", {}, cur) == (HAMUQ, True)
    assert any(s.startswith("insert into empresas") and p == (HAMUQ, "HAMUQ FARMA E.I.R.L.") for s, p in cur.sql)
    # Sin adjudicación: no se decide nada (queda lo que había).
    _sin_base(monkeypatch)
    assert shared.proveedor_ruc_alerta("y", {"ocds": {}}, _Cur([])) == (None, False)


# ═════════════════════════════════════════════════════════════════════
# Reglas sobre «el» ganador: cada uno
# ═════════════════════════════════════════════════════════════════════
class _CurReglas:
    """Responde por SQL y por RUC: `por_ruc[ruc]` = filas de la consulta de la regla para ese ganador."""

    def __init__(self, fila_conv, por_ruc):
        self.fila_conv, self.por_ruc, self.rows = fila_conv, por_ruc, []

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        if "select codigo, entidad_ruc" in s:
            self.rows = []
        elif s.startswith("select fecha_convocatoria, tipo_proceso") or s.startswith("select entidad_ruc, objeto"):
            self.rows = [self.fila_conv]
        elif "from convocatorias c" in s or "from rnp_conformacion_juridica" in s:
            self.rows = list(self.por_ruc.get(params[0], []))
        else:
            self.rows = []

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


def _conn(cur):
    return SimpleNamespace(cursor=lambda: cur, close=lambda: None)


def _st_varios():
    return {"ocds": _ocds_varios()}


def test_directa_recurrente_mira_a_cada_ganador(monkeypatch):
    _sin_base(monkeypatch)
    f = dt.date(2026, 8, 1)
    directas = [(f"o{i}", "20100000001", f, 50000.0) for i in range(3)]
    cur = _CurReglas((f, "Contratación Directa"), {HAMUQ: directas})       # el principal (AC FARMA) no tiene
    monkeypatch.setattr(cr._rules_network, "_pg", lambda: _conn(cur))
    r = cr.check_directa_recurrente_rule("2026-2543-197", SimpleNamespace(state=_st_varios()))
    assert r["triggered"] is True and r["ganador_ruc"] == HAMUQ and r["n_ganadores_evaluados"] == 3


def test_fraccionamiento_mira_a_cada_ganador(monkeypatch):
    _sin_base(monkeypatch)
    f = dt.date(2026, 8, 1)
    objeto = "ADQUISICION DE MEDICAMENTOS ATORVASTATINA"
    parecidos = [("p1", objeto, f, 300000.0, "Comparación de Precios"), ("p2", objeto, f, 300000.0, "Comparación de Precios")]
    cur = _CurReglas(("20100000001", objeto, f, 300000.0, "Comparación de Precios"), {MIAVIDA: parecidos})
    monkeypatch.setattr(cr._rules_montos, "_pg", lambda: _conn(cur))
    r = cr.check_fraccionamiento_rule("2026-2543-197", SimpleNamespace(state=_st_varios()))
    assert r["proveedor_ruc"] == MIAVIDA and r["n_ganadores_evaluados"] == 3
    assert r["triggered"] is True and r["ganador_ruc"] == MIAVIDA


def test_testaferro_mira_a_cada_ganador(monkeypatch):
    _sin_base(monkeypatch)
    otras = [("41234567", "20111111111", "OTRA UNO S.A.C.", True, 2, 100000.0, False),
             ("41234567", "20222222222", "OTRA DOS S.A.C.", True, 1, 50000.0, False)]
    cur = _CurReglas(None, {MIAVIDA: otras})
    monkeypatch.setattr(cr._rules_network, "_pg", lambda: _conn(cur))
    r = cr.check_testaferro_multi_ruc_rule("2026-2543-197", SimpleNamespace(state=_st_varios()))
    assert r["triggered"] is True and r["ganador_ruc"] == MIAVIDA and r["n_ganadores_evaluados"] == 3
    assert "41234567" not in r["evidencia"]


# ═════════════════════════════════════════════════════════════════════
# 2 · Hechos de contexto: fuera de reglas_disparadas y del conteo del dictamen
# ═════════════════════════════════════════════════════════════════════
def test_reglas_disparadas_sin_hechos_de_contexto():
    class C:
        def __init__(self):
            self.update = None

        def execute(self, sql, params=()):
            self.s = " ".join(sql.split()).lower()
            if self.s.startswith("update alertas set score"):
                self.update = params

        def fetchall(self):
            return [("procedimiento_no_competitivo", "baja", "Tipo de proceso: Contratación Directa", "n", "u",
                     "compliance_agent", {}, False),
                    ("directa_sin_fundamento", "alta", "sin informe técnico", "n", "u", "compliance_agent", {}, True)]
    c = C()
    score, banderas = shared._recalcular_score(c, "A1")
    assert score == 35 and c.update[1] == ["directa_sin_fundamento"]
    assert len(banderas) == 2


def test_el_dictamen_recibe_los_hechos_de_contexto_aparte():
    st = {"pending_flags": [
        {"regla": "procedimiento_no_competitivo", "severidad": "baja", "evidencia": "Contratación Directa", "puntua": False},
        {"regla": "directa_sin_fundamento", "severidad": "alta", "evidencia": "sin informe técnico"},
        {"regla": "cobertura_prensa_adversa", "severidad": "media", "evidencia": "Contexto, no del proveedor: EsSalud…",
         "puntua": False}]}
    out = SL.get_dictamen_context(SimpleNamespace(state=st))
    assert [b["regla"] for b in out["banderas"]] == ["directa_sin_fundamento"] and out["n_banderas"] == 1
    assert {b["regla"] for b in out["hechos_contexto"]} == {"procedimiento_no_competitivo", "cobertura_prensa_adversa"}
    assert out["n_hechos_contexto"] == 2 and "hechos_contexto" in out["_nota"]


def test_el_prompt_del_dictamen_no_cuenta_el_contexto():
    from agents.report_writer.prompt import GUIA_SECCION
    assert "hechos_contexto" in GUIA_SECCION["Resumen ejecutivo"]
    assert "NO tienen sub-sección" in GUIA_SECCION["Análisis de banderas detectadas"]
    assert "Contexto (no son señales" in GUIA_SECCION["Hechos clave"]
