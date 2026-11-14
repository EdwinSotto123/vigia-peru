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


def test_el_perfil_sunat_sale_de_la_base_y_no_de_un_servicio_externo(monkeypatch):
    """2026-11-13: la SUNAT nunca se consulta afuera. El perfil es el del padrón que está en la base."""
    import tools.expediente as expediente

    def _sin_red(*a, **kw):
        raise AssertionError("no debe salir a la red por la SUNAT")

    monkeypatch.setattr(sunat.requests, "get", _sin_red)
    monkeypatch.setattr(sunat.requests, "post", _sin_red)
    monkeypatch.setattr(expediente, "expediente_proveedor_bd", lambda ruc, *a, **kw: {
        "ruc": ruc, "persona_natural": False, "rnp": [], "historial": {},
        "sunat": {"razon_social": "FERREYROS S.A.", "estado": "ACTIVO", "condicion": "HABIDO",
                  "fecha_inicio_actividades": "1925-07-15", "edad_dias_al_contratar": 36900, "actividad": "VENTA"}})
    ctx = SimpleNamespace(state={})
    out = sunat.query_sunat_decolecta(RUC, ctx)
    assert out["estado"] == "ACTIVO" and out["_source"] == "padron_sunat_vigia"
    assert ctx.state["sunat_profiles"][RUC] is out
    assert sunat.query_edad_ciiu_web(RUC, "FERREYROS", ctx)["edad_dias"] == 36900
    assert not hasattr(sunat, "DECOLECTA_API_KEY")


def test_una_persona_natural_lleva_su_trayectoria_y_no_un_sunat_no_disponible(monkeypatch):
    import tools.expediente as expediente
    monkeypatch.setattr(expediente, "expediente_proveedor_bd", lambda ruc, *a, **kw: {
        "ruc": ruc, "persona_natural": True, "rnp": [], "historial": {"procesos": 2, "primera": "2021-03-01"},
        "persona": {"ordenes": 14, "primera": "2019-05-02"}})
    out = sunat.query_sunat_decolecta("10439608801", SimpleNamespace(state={}))
    assert out["tipo"] == "PERSONA NATURAL" and out["contrata_con_el_estado_desde"] == "2019-05-02"
    assert "error" not in out and out.get("found") is not False


def test_un_ruc_que_no_esta_en_la_base_es_no_encontrado(monkeypatch):
    import tools.expediente as expediente
    monkeypatch.setattr(expediente, "expediente_proveedor_bd", lambda ruc, *a, **kw: {
        "ruc": ruc, "persona_natural": False, "rnp": [], "historial": {}})
    out = sunat.query_sunat_decolecta(RUC, SimpleNamespace(state={}))
    assert out["found"] is False and "error" not in out


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
    assert len(params) == 11 and params[1] == "c2_unico_postor" and params[3] == "Un solo postor."
    # La comparación del agente y el índice único de la migración usan la misma expresión.
    assert "md5(coalesce(b.evidencia::text, ''))" in sql
    with open(os.path.join(_REPO, "backend", "db", "migrations", "27_banderas_unicas.sql"), encoding="utf-8") as f:
        mig = " ".join(f.read().split()).lower()
    assert re.search(r"create unique index if not exists \w+ on banderas \(alerta_id, regla, "
                     r"md5\(coalesce\(evidencia::text, ''\)\)\)", mig)
