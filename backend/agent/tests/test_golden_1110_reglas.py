"""Reglas corregidas tras la prueba de oro de 30 contratos del 2026-11-10 (corrida abierta 20261110-070204)."""
from __future__ import annotations

import os
import sys

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import compliance_rules as cr  # noqa: E402
from tools.compliance_rules._base import _quedo_fuera, postores_acta  # noqa: E402


class _Ctx:
    def __init__(self, state):
        self.state = state


class _Cur:
    def __init__(self, filas):
        self.filas, self._r = filas, []

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        self._r = next((v for k, v in self.filas.items() if k in s), [])

    def fetchall(self):
        return list(self._r)

    def fetchone(self):
        return self._r[0] if self._r else None


class _Conn:
    def __init__(self, filas):
        self.filas = filas

    def cursor(self):
        return _Cur(self.filas)

    def close(self):
        pass

    def rollback(self):
        pass


def test_postor_unico_mayoritario_cuenta_ofertas_de_conosce(monkeypatch):
    # 1228470: `ofertas` repetía los 20 participantes en cada ítem; CONOSCE tiene 1, 5, 1 y 1 ofertas.
    monkeypatch.setattr(cr._rules_bidder, "_pg", lambda: _Conn({
        "from conosce_postores": [(1, 1), (2, 5), (3, 1), (4, 1)],
        "from convocatoria_items": [(1, 20), (2, 20), (3, 20), (4, 20)]}))
    r = cr._rules_bidder.check_postor_unico_mayoritario_rule("1228470", _Ctx({}))
    assert r["triggered"] and r["fuente_postores"] == "conosce_postores" and r["n_items_un_solo_postor"] == 3


def test_postor_unico_mayoritario_sin_conosce_usa_ofertas(monkeypatch):
    monkeypatch.setattr(cr._rules_bidder, "_pg", lambda: _Conn({
        "from convocatoria_items": [(1, 1), (2, 1), (3, 1), (4, 3)]}))
    r = cr._rules_bidder.check_postor_unico_mayoritario_rule("1", _Ctx({}))
    assert r["triggered"] and r["fuente_postores"] == "ofertas"


def test_motivos_del_acta_que_dejan_fuera_la_oferta():
    assert _quedo_fuera("No se indica motivo de no calificación en el documento")
    assert _quedo_fuera("Comprobante de pago no sustentado con voucher de depósito legible")
    assert _quedo_fuera("Incongruencia entre la ficha técnica del proveedor y la del fabricante")
    assert not _quedo_fuera("Bonificación MYPE no otorgada; no fue descalificado")


def test_unica_oferta_valida_con_motivos_del_acta_1226572():
    post = [{"nombre": "GANADOR", "ganador": True, "admitida": True, "calificada": True, "monto_ofertado": 81000}]
    post += [{"nombre": f"R{i}", "ganador": False, "admitida": True, "calificada": None,
              "motivo_fuera": "No cumple con las especificaciones de los bienes solicitados"} for i in range(6)]
    post += [{"nombre": "KEPAL", "ganador": False, "admitida": True, "calificada": None,
              "motivo_fuera": "No se indica motivo de no calificación en el documento"},
             {"nombre": "MSK", "ganador": False, "admitida": True, "calificada": True,
              "motivo_fuera": "Comprobante de pago no sustentado con voucher de depósito"}]
    st = {"lecturas_documentos": {"acta": {"salida": {"es_buena_pro": True, "postores": post}}}}
    assert [p["estado"] for p in postores_acta(st)].count("valido") == 0
    r = cr._rules_lote1.check_unica_oferta_valida_rule("1226572", _Ctx(st))
    assert r["triggered"] and r["n_validas"] == 1 and r["n_invalidas"] == 8
