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


def test_la_mejor_directiva_tiene_un_lugar_aunque_la_ley_cope_el_cupo():
    filas = [_f(i, "ley-32069", "ley", "norma", str(40 + i), 1 - i / 100) for i in range(1, 8)]
    filas += [_f(20, "directiva-017-2025-oece-cd", "directiva", "norma", "6.1", 0.2), _f(21, "directiva-018-2025-oece-cd", "directiva", "norma", "7.1", 0.1)]
    m = N.elegir([dict(zip(COLS, x)) for x in filas])
    assert len(m) == 5 and [x["slug"] for x in m][-1] == "directiva-017-2025-oece-cd"
    assert [x["articulo"] for x in m[:4]] == ["41", "42", "43", "44"]
    # Si ya entró una directiva por su puntaje, no se toca.
    filas[1] = _f(2, "directiva-003-2025-oece-cd", "directiva", "norma", "5.2", 0.98)
    m = N.elegir([dict(zip(COLS, x)) for x in filas])
    assert [x["slug"] for x in m].count("directiva-003-2025-oece-cd") == 1 and "directiva-017-2025-oece-cd" not in [x["slug"] for x in m]


def test_la_bandera_recibe_el_articulo_y_la_opinion_por_separado():
    """Con la búsqueda por fecha, el primer resultado es un artículo: no debe quedar como «opinión del OECE»."""
    from tools import compliance_rules as cr
    h = {"titulo": "Fraccionamiento", "descripcion": "Varias órdenes del mismo objeto fraccionan la contratación para evitar el procedimiento de selección"}
    base = {"score": 0.9, "interpretacion_snippet": "el fraccionamiento de varias órdenes del mismo objeto para evitar el procedimiento de selección está prohibido"}
    matches = [
        {**base, "aplica": "norma", "tipo": "bases_estandar", "documento": "Bases estándar 2026", "articulo": "3.5"},
        {**base, "aplica": "norma", "tipo": "ley", "documento": "Ley N° 32069", "numero": "Ley N° 32069", "articulo": "50", "cita_formato": "Art. 50 de Ley N° 32069"},
        {**base, "aplica": "criterio_anterior", "tipo": "opinion", "documento": "Opinión N° 88-2023/DTN", "num_opinion": "88-2023"},
        {**base, "aplica": "criterio", "tipo": "opinion", "documento": "Opinión D000050-2026-OECE-DTN", "num_opinion": "D000050-2026"},
    ]
    norma = cr.norma_aplicable("2026-05-01")
    art = cr._elegir_norma_aplicable(h, matches, "bienes", norma)
    assert art["articulo"] == "50" and art["tipo"] == "ley"                      # la base estándar no es fundamento
    op, _ = cr._elegir_opinion_pertinente(h, cr._solo_criterios(matches), "bienes", norma)
    assert op["num_opinion"] == "D000050-2026" and not op.get("_regimen_distinto")   # primero la del régimen del proceso
    solo_vieja, _ = cr._elegir_opinion_pertinente(h, cr._solo_criterios(matches[:3]), "bienes", norma)
    assert solo_vieja["num_opinion"] == "88-2023" and solo_vieja["_regimen_distinto"] is True
    # El respaldo anterior no trae `aplica`: la lista no se toca y no hay artículo aparte.
    viejos = [{**base, "num_opinion": "10-2024", "norma": "Ley 30225"}]
    assert cr._solo_criterios(viejos) is viejos and cr._elegir_norma_aplicable(h, viejos, "bienes", norma) is None



def test_las_citas_fijas_de_las_reglas_son_los_articulos_correctos():
    """Comprobadas contra el texto oficial (2026-11-15): fraccionamiento art. 50, comparación de precios art. 25 del TUO,
    y la cuantía NO es el art. 12 del Reglamento (ese es la participación de Perú Compras)."""
    from tools import compliance_rules as cr
    nueva, vieja = cr.norma_aplicable("2026-03-01"), cr.norma_aplicable("2024-03-01")
    assert nueva["fraccionamiento"].startswith("Art. 50 Ley 32069") and vieja["fraccionamiento"].startswith("Art. 20 TUO Ley 30225")
    assert vieja["comparacion_precios"].startswith("Art. 25 TUO") and "97 y 98" in nueva["comparacion_precios"]
    assert nueva["cuantia"].startswith("Art. 48 Ley 32069") and "Art. 12" not in nueva["cuantia"] and "32 y 34" in vieja["cuantia"]
    assert "Anexo IV" not in vieja["procedimientos"]


def test_el_acuerdo_de_sala_plena_tiene_un_lugar_entre_los_criterios():
    filas = [_f(1, "ley-32069", "ley", "norma", "88", 0.9)]
    filas += [_f(10 + i, f"opinion-{i}", "opinion", "criterio", None, 0.8 - i / 100) for i in range(5)]
    filas += [_f(30, "acuerdo-sala-plena-004-2026-tcp", "acuerdo_sala_plena", "criterio", None, 0.3)]
    m = N.elegir([dict(zip(COLS, x)) for x in filas])
    crit = [x["slug"] for x in m if x["aplica"] == "criterio"]
    assert crit == ["acuerdo-sala-plena-004-2026-tcp", "opinion-0", "opinion-1"]        # 3 cupos: el acuerdo primero
    # Sin acuerdo entre los candidatos, nada cambia.
    m = N.elegir([dict(zip(COLS, x)) for x in filas[:-1]])
    assert [x["slug"] for x in m if x["aplica"] == "criterio"] == ["opinion-0", "opinion-1", "opinion-2"]


def test_una_opinion_ocupa_un_solo_cupo_de_criterio():
    filas = [_f(1, "ley-32069", "ley", "norma", "50", 0.9)]
    filas += [_f(10 + i, "opinion-d000059-2025-oece-dtn", "opinion", "criterio", None, 0.8 - i / 100) for i in range(3)]
    filas += [_f(20, "opinion-d000013-2025-oece-dtn", "opinion", "criterio", None, 0.5)]
    m = N.elegir([dict(zip(COLS, x)) for x in filas])
    assert [x["slug"] for x in m if x["aplica"] == "criterio"] == ["opinion-d000059-2025-oece-dtn", "opinion-d000013-2025-oece-dtn"]

