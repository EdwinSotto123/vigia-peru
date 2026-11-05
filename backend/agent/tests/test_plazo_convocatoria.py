"""plazo_convocatoria_minimo no marca procesos sin buena pro ni fechas imposibles (1248872, 2026-11-04). Sin base."""
from __future__ import annotations

import datetime as dt

from tools.compliance_rules import _rules_montos as rm


class _Ctx:
    def __init__(self):
        self.state = {}


class _Cur:
    def __init__(self, fila):
        self.fila = fila

    def execute(self, *_a, **_k):
        pass

    def fetchone(self):
        return self.fila


class _Conn:
    def __init__(self, fila):
        self.fila = fila

    def cursor(self):
        return _Cur(self.fila)

    def close(self):
        pass


def _correr(monkeypatch, fconv, fbp, etapa, tipo="CONCURSO PUBLICO ABREVIADO"):
    monkeypatch.setattr(rm, "_pg", lambda: _Conn((tipo, fconv, fbp, 300000, etapa)))
    return rm.check_plazo_convocatoria_rule("1248872", _Ctx())


def test_cancelado_no_marca(monkeypatch):
    r = _correr(monkeypatch, dt.date(2026, 9, 11), dt.date(2026, 9, 11), "cancelada")
    assert not r["triggered"] and "cancelada" in r["motivo"]


def test_buena_pro_mismo_dia_es_dato_malo(monkeypatch):
    r = _correr(monkeypatch, dt.date(2026, 9, 11), dt.date(2026, 9, 11), "adjudicada")
    assert not r["triggered"] and "inconsistentes" in r["motivo"]


def test_plazo_corto_real_sigue_marcando(monkeypatch):
    r = _correr(monkeypatch, dt.date(2026, 9, 1), dt.date(2026, 9, 3), "adjudicada")
    assert r["triggered"] and r["severidad"] == "alta"
