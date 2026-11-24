"""El dictamen de un proceso con varios ganadores (2026-2543-197, EsSalud, 2026-11-24).

13 ítems, 8 ganadores e ítems 5 y 9 desiertos: el dictamen hablaba de un proveedor como «el ganador», tomaba como monto
adjudicado el de un contrato y comparaba contra el referencial con los desiertos. El contexto del writer trae ahora
`adjudicacion`: cada ganador (RUC —nunca el de una persona natural—, nombre, ítems oficiales y monto), el principal
(de quien es el análisis del proveedor), los desiertos, el total del proceso y el referencial de lo adjudicado.
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import state_loaders as SL  # noqa: E402
from tools.compliance_rules import _base, adjudicacion_del_proceso  # noqa: E402

ACFARMA, MIAVIDA, HAMUQ, MEDIFARMA = "20347268683", "20600413571", "20613527134", "20100018625"
NATURAL = "10456789012"

# (posición oficial, id, descripción, referencial, estado OCDS); el arreglo no sigue la posición.
_ITEMS = [(5, "i5", "CAFEINA CITRATO 20 mg/mL AMP 1 mL", 118514.5, ("unsuccessful", "DESIERTO")),
          (13, "i13", "VALSARTAN 80 mg TAB", 7709365.82, ("complete", "CONTRATADO")),
          (3, "i3", "ATORVASTATINA 20 mg TAB", 4065547.6, ("complete", "CONSENTIDO")),
          (8, "i8", "ENOXAPARINA SODICA 60 mg INY 0,6 mL", 5480297.55, ("complete", "CONTRATADO")),
          (10, "i10", "IRBESARTAN 150 mg TAB", 16040060.59, ("complete", "CONTRATADO")),
          (9, "i9", "HIDROXOCOBALAMINA 1 mg/mL INY 1 mL", 4462910.0, ("unsuccessful", "DESIERTO")),
          (1, "i1", "ACIDO FOLICO 500 mcg (0.5 mg) TAB", 4777872.8, ("complete", "CONTRATADO")),
          (6, "i6", "CLOPIDOGREL 75 mg TAB", 1445577.48, ("complete", "CONSENTIDO"))]


def _ocds():
    def aw(ruc, nombre, monto, items):
        return {"id": f"a-{ruc}", "value": {"amount": monto}, "items": [{"id": i} for i in items],
                "suppliers": [{"id": f"PE-RUC-{ruc}", "name": nombre}]}
    return {
        "ocid": "ocds-dgv273-seacev3-2026-2543-197",
        "tender": {"value": {"amount": sum(x[3] for x in _ITEMS)},
                   "items": [{"id": i, "position": str(p), "description": d, "totalValue": {"amount": r},
                              "status": e[0], "statusDetails": e[1]} for p, i, d, r, e in _ITEMS]},
        "awards": [aw(ACFARMA, "LABORATORIOS AC FARMA S.A.", 1790000.0 + 5024000.0, ["i13", "i10"]),
                   aw(MIAVIDA, "FARMA MIAVIDA SOCIEDAD ANONIMA CERRADA", 3272119.05, ["i8"]),
                   aw(HAMUQ, "HAMUQ FARMA E.I.R.L.", 1474235.95, ["i3"]),
                   aw(MEDIFARMA, "MEDIFARMA S A", 1064634.7, ["i1"]),
                   aw(NATURAL, "ROJAS QUISPE ELENA", 840452.03, ["i6"])],
        # El contrato leído por los documentos es UNO de los varios.
        "contracts": [{"id": "c1", "awardID": f"a-{MIAVIDA}", "value": {"amount": 3272119.05}}],
    }


def _sin_base(monkeypatch):
    def _pg():
        raise ConnectionError("sin base en los tests")
    monkeypatch.setattr(_base, "_pg", _pg)


TOTAL = round(1790000.0 + 5024000.0 + 3272119.05 + 1474235.95 + 1064634.7 + 840452.03, 2)
REF_ADJUDICADO = round(sum(x[3] for x in _ITEMS if x[0] not in (5, 9)), 2)


def test_adjudicacion_del_proceso_desde_el_ocds(monkeypatch):
    _sin_base(monkeypatch)
    a = adjudicacion_del_proceso("2026-2543-197", {"ocds": _ocds()})
    assert a["fuente"] == "ocds" and a["n_ganadores"] == 5
    assert [g["nombre"] for g in a["ganadores"][:3]] == ["LABORATORIOS AC FARMA S.A.",
                                                         "FARMA MIAVIDA SOCIEDAD ANONIMA CERRADA", "HAMUQ FARMA E.I.R.L."]
    ac = a["ganadores"][0]
    assert ac == {"ruc": ACFARMA, "persona_natural": False, "nombre": "LABORATORIOS AC FARMA S.A.",
                  "items": [10, 13], "monto": 6814000.0}
    assert a["ganador_principal"]["ruc"] == ACFARMA
    # Persona natural: sin RUC (lleva el DNI) y con un apellido tapado.
    pn = next(g for g in a["ganadores"] if g["persona_natural"])
    assert pn["ruc"] is None and NATURAL not in str(a) and pn["nombre"] == "ROJAS ••• ELENA" and pn["items"] == [6]
    # El total es el del proceso (no el contrato de MIAVIDA) y se compara sin los desiertos.
    assert a["monto_adjudicado_total"] == TOTAL
    assert a["referencial_items_adjudicados"] == REF_ADJUDICADO
    assert a["adjudicado_vs_referencial_pct"] == round((TOTAL - REF_ADJUDICADO) / REF_ADJUDICADO * 100, 1)
    assert [(d["item"], d["motivo"]) for d in a["items_desiertos"]] == [(5, "desierto"), (9, "desierto")]


def test_adjudicacion_del_proceso_desde_conosce():
    """CONOSCE da los ítems por su número oficial y el referencial de cada ítem; no trae los desiertos."""
    filas = [(13, ACFARMA, "LABORATORIOS AC FARMA S.A.", 1790000.0, 7709365.82, "Contratado"),
             (10, ACFARMA, "LABORATORIOS AC FARMA S.A.", 5024000.0, 16040060.59, "Contratado"),
             (8, MIAVIDA, "FARMA MIAVIDA SOCIEDAD ANONIMA", 3272119.05, 5480297.55, "Contratado"),
             (3, HAMUQ, "HAMUQ FARMA E.I.R.L.", 1474235.95, 4065547.6, "Consentido")]
    st = {"ocds": _ocds(), "_conosce_items": {"ocid": "2026-2543-197", "filas": filas},
          "_conosce_adj": {"ocid": "2026-2543-197", "filas": [(ACFARMA, "LABORATORIOS AC FARMA S.A.", 6814000.0, None),
                                                              (MIAVIDA, "FARMA MIAVIDA", 3272119.05, None),
                                                              (HAMUQ, "HAMUQ FARMA", 1474235.95, None)]}}
    a = adjudicacion_del_proceso("ocds-dgv273-seacev3-2026-2543-197", st)
    assert a["fuente"] == "conosce" and a["n_ganadores"] == 3 and a["ganador_principal"]["ruc"] == ACFARMA
    assert a["monto_adjudicado_total"] == round(6814000.0 + 3272119.05 + 1474235.95, 2)
    assert a["referencial_items_adjudicados"] == round(7709365.82 + 16040060.59 + 5480297.55 + 4065547.6, 2)
    # Lo que CONOSCE no adjudicó también sale: los desiertos del OCDS y los que nadie ganó.
    assert {(d["item"], d["motivo"]) for d in a["items_desiertos"]} == {
        (5, "desierto"), (9, "desierto"), (1, "sin_adjudicacion"), (6, "sin_adjudicacion")}


def test_el_contexto_del_dictamen_trae_la_adjudicacion(monkeypatch):
    _sin_base(monkeypatch)
    st = {"ocid": "2026-2543-197", "ocds": _ocds(), "contrato_final": {"precio_final_total": 3272119.05}}
    out = SL.get_dictamen_context(SimpleNamespace(state=st))
    a = out["adjudicacion"]
    assert a["n_ganadores"] == 5 and a["ganador_principal"]["nombre"] == "LABORATORIOS AC FARMA S.A."
    assert a["monto_adjudicado_total"] == TOTAL != out["contrato_final"]["precio_final_total"]
    assert [d["item"] for d in a["items_desiertos"]] == [5, 9]
    assert "`adjudicacion`" in out["_nota"]
    assert NATURAL not in str(a)


def test_un_solo_ganador_y_sin_adjudicacion(monkeypatch):
    _sin_base(monkeypatch)
    o = _ocds()
    o["awards"] = o["awards"][:1]
    a = adjudicacion_del_proceso("1", {"ocds": o})
    assert a["n_ganadores"] == 1 and a["ganador_principal"]["ruc"] == ACFARMA
    o["awards"] = []
    assert adjudicacion_del_proceso("2", {"ocds": o}) is None


def test_el_prompt_pide_todos_los_ganadores_y_el_total_del_proceso():
    from agents.report_writer.prompt import GUIA_SECCION as G, build_instruction
    hc = G["Hechos clave"]
    for frase in ("adjudicacion.monto_adjudicado_total", "adjudicacion.referencial_items_adjudicados",
                  "los 5 de mayor monto", "«y N más»", "adjudicacion.items_desiertos", "adjudicacion.ganador_principal",
                  "`contrato_final`", "«persona natural»"):
        assert frase in hc, frase
    assert "adjudicacion.n_ganadores" in G["Resumen ejecutivo"] and "monto_adjudicado_total" in G["Resumen ejecutivo"]
    assert "adjudicacion.n_ganadores" in G["Título"]
    for seccion in ("Antecedentes del proveedor", "Personas clave y red empresarial", "Cobertura periodística"):
        assert "adjudicacion.ganador_principal" in G[seccion], seccion
    assert "adjudicacion.ganador_principal" in build_instruction()
