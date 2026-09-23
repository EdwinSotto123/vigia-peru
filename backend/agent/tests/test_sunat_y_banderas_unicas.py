"""SUNAT sin credencial válida y dedupe de banderas.

· query_sunat_decolecta con HTTP 401 → "SUNAT no disponible (credencial inválida)", sin tocar el
  state ni reintentar el endpoint básico, y conservando `error` para el fallback del pipeline.
· _insert_bandera: INSERT … WHERE NOT EXISTS … ON CONFLICT DO NOTHING con la MISMA expresión
  md5 que el índice único de la migración 27, y los 8 parámetros posicionales de siempre.

Sin red ni BD: requests y el cursor son falsos.
"""
from __future__ import annotations

import os
import re
import sys
from types import SimpleNamespace

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import sunat  # noqa: E402
from tools.persistence import shared  # noqa: E402

RUC = "20100028698"
_REPO = os.path.dirname(os.path.dirname(_AGENT))


class _Resp:
    def __init__(self, status: int, body: str = "", data: dict | None = None):
        self.status_code = status
        self.text = body
        self._data = data

    def json(self):
        return self._data


def _fake_get(respuestas: list[_Resp], llamadas: list[str]):
    def _get(url, **kw):
        llamadas.append(url)
        return respuestas.pop(0)
    return _get


def test_sunat_401_es_no_disponible_y_no_ruc_inexistente(monkeypatch):
    llamadas: list[str] = []
    monkeypatch.setattr(sunat, "DECOLECTA_API_KEY", "sk_vencida")
    monkeypatch.setattr(sunat.requests, "get",
                        _fake_get([_Resp(401, '{"error":"Apikey Required / Limit Exceeded"}')], llamadas))
    ctx = SimpleNamespace(state={})
    out = sunat.query_sunat_decolecta(RUC, ctx)
    assert out["error"] == "sunat_no_disponible"
    assert out["motivo"] == "SUNAT no disponible (credencial inválida)"
    assert out["disponible"] is False and out["http_status"] == 401
    assert "found" not in out and "ruc_not_found" not in str(out)
    assert len(llamadas) == 1                      # la key es la misma: no se reintenta /sunat/ruc
    assert "sunat_profiles" not in ctx.state       # nada del RUC queda cacheado


def test_sunat_403_en_full_sigue_cayendo_al_basico(monkeypatch):
    llamadas: list[str] = []
    monkeypatch.setattr(sunat, "DECOLECTA_API_KEY", "sk_plan_free")
    monkeypatch.setattr(sunat.requests, "get", _fake_get(
        [_Resp(403, "plan"), _Resp(200, data={"ruc": RUC, "razon_social": "FERREYROS S.A.",
                                              "fecha_inicio_actividades": "1925-07-15"})], llamadas))
    ctx = SimpleNamespace(state={})
    out = sunat.query_sunat_decolecta(RUC, ctx)
    assert llamadas[0].endswith("/sunat/ruc/full") and llamadas[1].endswith("/sunat/ruc")
    assert out["razon_social"] == "FERREYROS S.A." and ctx.state["sunat_profiles"][RUC] is out


def test_sunat_401_en_el_basico_tambien_es_no_disponible(monkeypatch):
    llamadas: list[str] = []
    monkeypatch.setattr(sunat, "DECOLECTA_API_KEY", "sk_x")
    monkeypatch.setattr(sunat.requests, "get", _fake_get([_Resp(403, "plan"), _Resp(401, "no")], llamadas))
    out = sunat.query_sunat_decolecta(RUC, SimpleNamespace(state={}))
    assert out["error"] == "sunat_no_disponible" and len(llamadas) == 2


def test_sunat_404_sigue_siendo_ruc_no_encontrado(monkeypatch):
    monkeypatch.setattr(sunat, "DECOLECTA_API_KEY", "sk_ok")
    monkeypatch.setattr(sunat.requests, "get", _fake_get([_Resp(404), _Resp(404)], []))
    assert sunat.query_sunat_decolecta(RUC, SimpleNamespace(state={})) == {"error": "ruc_not_found", "ruc": RUC}


class _Cur:
    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(sql.split()).lower(), tuple(params)))


def test_insert_bandera_omite_duplicados_con_la_expresion_del_indice():
    cur = _Cur()
    shared._insert_bandera(cur, "00000000-0000-0000-0000-000000000001", "c2_unico_postor", "alta",
                           "Un solo postor.", "Art. 5", None, "compliance_agent", {"ok": True})
    sql, params = cur.calls[0]
    assert sql.startswith("insert into banderas")
    assert "where not exists" in sql and sql.endswith("on conflict do nothing")
    assert len(params) == 8 and params[1] == "c2_unico_postor" and params[3] == "Un solo postor."
    # La comparación del agente y el índice único de la migración usan la misma expresión.
    assert "md5(coalesce(b.evidencia::text, ''))" in sql
    with open(os.path.join(_REPO, "backend", "db", "migrations", "27_banderas_unicas.sql"), encoding="utf-8") as f:
        mig = " ".join(f.read().split()).lower()
    assert re.search(r"create unique index if not exists \w+ on banderas \(alerta_id, regla, "
                     r"md5\(coalesce\(evidencia::text, ''\)\)\)", mig)
