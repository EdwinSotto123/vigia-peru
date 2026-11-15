"""RAG normativo con fecha y jerarquía (tools/normas_rag.py): cupos por aplicación, sin repetir artículo, y la advertencia
de los criterios emitidos bajo la otra ley. Sin base ni red: la conexión es de mentira."""
from __future__ import annotations

import datetime as dt
import os
import sys

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import normas_rag as N  # noqa: E402

COLS = ["id", "slug", "documento", "numero", "tipo", "jerarquia", "regimen", "aplica", "fecha_emision", "vigencia_desde", "vigencia_hasta",
        "articulo", "epigrafe", "pagina", "texto", "url_oficial", "rango_palabras", "rango_vector", "puntaje"]


def _f(i, slug, tipo, aplica, art=None, puntaje=1.0, regimen="32069", numero=None):
    return (i, slug, f"Documento {slug}", numero or slug, tipo, 1, regimen, aplica, dt.date(2025, 4, 22), None, None, art, None, None,
            f"Texto del fragmento {i} de {slug}", "https://www.gob.pe/x", 1, 1, puntaje)


class _Cur:
    def __init__(self, filas):
        self.filas, self.description, self.pedido = filas, [(c,) for c in COLS], None

    def execute(self, sql, params):
        if "version_de" in sql:          # la consulta de versiones por fecha
            self.pedido_version, self.sirve = params, "versiones"
            return
        self.pedido, self.sirve = params, "filas"

    def fetchall(self):
        return self.filas if getattr(self, "sirve", "filas") == "filas" else getattr(self, "versiones", [])


class _Conn:
    def __init__(self, filas):
        self.cur = _Cur(filas)

    def cursor(self):
        return self.cur

    def close(self):
        pass


def test_cupos_orden_y_advertencia_del_regimen_anterior():
    filas = [
        _f(1, "opinion-29-2022", "opinion", "criterio_anterior", "11", 0.99, "30225", "Opinión N° 29-2022/DTN"),
        _f(2, "ley-32069", "ley", "norma", "30", 0.95, numero="Ley N° 32069"),
        _f(3, "ley-32069", "ley", "norma", "30", 0.90),                      # el mismo artículo otra vez: fuera
        _f(4, "opinion-10-2026", "opinion", "criterio", "30", 0.80, numero="Opinión N° 10-2026/DTN"),
        _f(5, "opinion-74-2022", "opinion", "criterio_anterior", "11", 0.70, "30225"),
        _f(6, "opinion-80-2022", "opinion", "criterio_anterior", "11", 0.60, "30225"),   # tercer anterior: fuera del cupo
        _f(7, "bases-1", "bases_estandar", "norma", None, 0.5), _f(8, "bases-2", "bases_estandar", "norma", None, 0.4),
        _f(9, "bases-3", "bases_estandar", "norma", None, 0.3),                  # tercera de bases estándar: fuera
    ]
    conn = _Conn(filas)
    r = N.buscar_normas("impedimentos para contratar parientes", "2026-05-10", conn=conn, vector=None)
    assert r["regimen"] == "32069" and r["busqueda"] == "solo_palabras" and conn.cur.pedido[2] == dt.date(2026, 5, 10)
    m = r["matches"]
    assert [x["aplica"] for x in m] == ["norma", "norma", "norma", "criterio", "criterio_anterior", "criterio_anterior"]
    assert m[0]["cita_formato"].startswith("Art. 30 de Ley N° 32069") and m[0]["score"] == round(0.95 / 0.99, 4)
    assert sum(1 for x in m if x["tipo"] == "bases_estandar") == 2
    viejo = m[-1]
    assert "Ley N° 30225" in viejo["advertencia"] and "NO rige" in viejo["advertencia"] and "advertencia" not in m[0]
    assert viejo["corpus"] == "criterios-regimen-anterior"


def test_la_fecha_decide_el_regimen_y_sin_resultados_es_error():
    assert N.buscar_normas("x", "2024-03-01", conn=_Conn([]), vector=None)["regimen"] == "30225"
    assert N.buscar_normas("x", "2025-04-22", conn=_Conn([]), vector=None)["error"] == "normas_sin_resultados"
    assert N.buscar_normas("x", "2025-04-21", conn=_Conn([]), vector=None)["regimen"] == "30225"


def test_sin_credenciales_no_hay_vector(monkeypatch):
    monkeypatch.delenv("WORKERS_AI_URL", raising=False)
    assert N.embeber_pregunta("plazo") is None


def test_un_proceso_anterior_recibe_el_texto_que_regia_en_su_fecha():
    """El Reglamento cambió el 14-01-2026: un proceso de 2025 lee el artículo como estaba, y se le dice."""
    filas = [_f(1, "ds-009-2025-ef", "reglamento", "norma", "46", 0.9, numero="009-2025-EF"),
             _f(2, "ds-009-2025-ef", "reglamento", "norma", "50", 0.8, numero="009-2025-EF")]
    conn = _Conn(filas)
    conn.cur.versiones = [("ds-009-2025-ef", "46", "ds-009-2025-ef-anterior", "Reglamento, texto anterior al 14-01-2026", dt.date(2026, 1, 13),
                           "Artículo 46 como regía en 2025")]
    r = N.buscar_normas("estrategia de contratación", "2025-09-01", conn=conn, vector=None)
    m = r["matches"]
    assert conn.cur.pedido_version[2] == dt.date(2025, 9, 1) and conn.cur.pedido_version[0] == ["ds-009-2025-ef", "ds-009-2025-ef"]
    assert m[0]["cita"] == "Artículo 46 como regía en 2025" and m[0]["documento"].endswith("anterior al 14-01-2026")
    assert m[0]["version"] == "texto que regía hasta el 13-01-2026" and m[0]["cita_formato"].startswith("Art. 46 de 009-2025-EF")
    assert "version" not in m[1] and m[1]["cita"].startswith("Texto del fragmento 2")

