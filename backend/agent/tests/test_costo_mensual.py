"""Costo mensual de un servicio frente a su contrato anterior y a servicios parecidos (tools/market/costo_mensual.py).
Sin base: el cursor es de mentira y devuelve las filas de `servicio_costo_mensual` que cada prueba arma."""
from __future__ import annotations

import datetime as dt
import os
import sys

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools.market import costo_mensual as CM  # noqa: E402

COLS = ["ocid", "entidad_ruc", "entidad", "objeto", "fecha", "monto", "plazo_dias", "plazo_fuente", "costo_mensual", "n_personal", "sim", "proveedor_ruc"]
ENT = "20100000001"


def _fila(ocid, ent, cm, sim=0.8, fecha=dt.date(2025, 3, 1), personal=None, plazo=360):
    return (ocid, ent, f"Entidad {ent[-2:]}", "Servicio de vigilancia para la sede central", fecha, cm * plazo / 30, plazo, "contrato", cm, personal, sim, None)


class _Cur:
    def __init__(self, filas):
        self.filas, self.description = filas, [(c,) for c in COLS]

    def execute(self, *_a, **_k):
        pass

    def fetchall(self):
        return self.filas


class _Conn:
    def __init__(self, filas):
        self.filas = filas

    def cursor(self):
        return _Cur(self.filas)

    def close(self):
        pass


def _con(monkeypatch, filas):
    monkeypatch.setattr(CM, "_pg", lambda: _Conn(filas))


def test_contrato_anterior_de_la_misma_entidad_y_bandera(monkeypatch):
    _con(monkeypatch, [_fila("1100", ENT, 30000.0, sim=0.82), _fila("1050", ENT, 20000.0, fecha=dt.date(2024, 1, 1))])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de vigilancia para la sede central 2026", 48000.0)
    assert comp["estado"] == "hallado"
    assert comp["previo"]["ocid"] == "1100" and comp["previo"]["diff_pct"] == 60.0     # el más reciente, no el más barato
    state: dict = {}
    f = CM.bandera_costo_mensual(state, comp, "1200", 576000.0, 360)
    assert f and f["regla"] == "costo_mensual_salto" and f["severidad"] == "alta"
    assert "48,000.00 al mes" in f["evidencia"] and "+60 %" in f["evidencia"] and "30,000.00" in f["evidencia"]
    assert state["pending_flags"] == [f]
    assert CM.bandera_costo_mensual(state, comp, "1200", 576000.0, 360) is None         # no se repite


def test_salto_menor_al_umbral_o_con_mas_personal_no_da_bandera(monkeypatch):
    _con(monkeypatch, [_fila("1100", ENT, 40000.0)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de vigilancia para la sede central", 48000.0)
    assert comp["previo"]["diff_pct"] == 20.0 and CM.bandera_costo_mensual({}, comp, "1200", 576000.0, 360) is None
    # Sube 60 %, pero las bases piden más personal clave que antes: el servicio creció.
    _con(monkeypatch, [_fila("1100", ENT, 30000.0, personal=2)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de vigilancia para la sede central", 48000.0, n_personal=5)
    assert comp["previo"]["alcance_crecio"] is True and CM.bandera_costo_mensual({}, comp, "1200", 576000.0, 360) is None


def test_salto_grande_con_objeto_apenas_parecido_es_media(monkeypatch):
    _con(monkeypatch, [_fila("1100", ENT, 20000.0, sim=0.70)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de vigilancia", 48000.0)
    assert CM.bandera_costo_mensual({}, comp, "1200", 576000.0, 360)["severidad"] == "media"


def test_servicios_de_una_vez_otro_alcance_o_plantilla_no_dan_bandera(monkeypatch):
    # El «mismo» objeto de plantilla con similitud 0,60 (mantenimiento de OTRO camino): no es contrato anterior.
    _con(monkeypatch, [_fila("1100", ENT, 20000.0, sim=0.60)])
    assert "previo" not in CM.comparar_costo_mensual("1200", ENT, "Mantenimiento periódico del camino X", 48000.0)
    # +4 000 %: otro alcance.
    _con(monkeypatch, [_fila("1100", ENT, 1000.0)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de intermediación laboral", 41000.0)
    assert comp["previo"]["comparable"] is False and CM.bandera_costo_mensual({}, comp, "1200", 492000.0, 360) is None
    # El anterior duró 60 días: no es un servicio continuo.
    _con(monkeypatch, [_fila("1100", ENT, 30000.0, plazo=60)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de mantenimiento", 48000.0)
    assert comp["previo"]["comparable"] is False and CM.bandera_costo_mensual({}, comp, "1200", 576000.0, 360) is None
    # Supervisión de obra: cada contrato es de otra obra.
    _con(monkeypatch, [_fila("1100", ENT, 30000.0)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Consultoría de obra para la supervisión de la ejecución de la obra X", 48000.0)
    assert comp["previo"]["comparable"] is False and CM.bandera_costo_mensual({}, comp, "1200", 576000.0, 360) is None
    # Éste dura 90 días, o su plazo es 4 veces el del anterior: tampoco.
    _con(monkeypatch, [_fila("1100", ENT, 30000.0, plazo=180)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de vigilancia", 48000.0)
    assert CM.bandera_costo_mensual({}, comp, "1200", 144000.0, 90) is None
    assert CM.bandera_costo_mensual({}, comp, "1200", 1152000.0, 720) is None
    assert CM.bandera_costo_mensual({}, comp, "1200", 576000.0, 360)["severidad"] == "alta"


def test_otras_entidades_dan_rango_pero_nunca_bandera(monkeypatch):
    filas = [_fila(str(2000 + i), f"201000001{i:02d}", cm) for i, cm in enumerate([10000.0, 11000.0, 12000.0, 13000.0, 14000.0])]
    filas.append(_fila("2099", "20100000100", 9000.0, fecha=dt.date(2024, 6, 1)))        # la misma entidad dos veces: cuenta una
    _con(monkeypatch, filas)
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de vigilancia para la sede central", 30000.0)
    assert "previo" not in comp and comp["pares"]["n"] == 5 and comp["pares"]["comparable"] is True
    assert comp["pares"]["posicion"] == "sobre_p75" and comp["pares"]["diff_vs_p50_pct"] == 150.0
    assert CM.bandera_costo_mensual({}, comp, "1200", 360000.0, 360) is None


def test_pares_muy_dispersos_no_se_comparan(monkeypatch):
    _con(monkeypatch, [_fila(str(2000 + i), f"201000001{i:02d}", cm) for i, cm in enumerate([1000.0, 2000.0, 30000.0, 90000.0, 200000.0])])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de mantenimiento", 30000.0)
    assert comp["pares"]["comparable"] is False and comp["pares"]["posicion"] is None and comp["pares"]["nota"]


def test_sin_costo_o_sin_base_es_sin_dato(monkeypatch):
    assert CM.comparar_costo_mensual("1", ENT, "Servicio", None)["estado"] == "sin_dato"

    def _cae():
        raise RuntimeError("sin red")
    monkeypatch.setattr(CM, "_pg", _cae)
    assert CM.comparar_costo_mensual("1", ENT, "Servicio de limpieza", 100.0)["estado"] == "sin_dato"
    _con(monkeypatch, [])
    assert CM.comparar_costo_mensual("1", ENT, "Servicio de limpieza", 100.0)["motivo"].startswith("sin_contrato_anterior")


def test_los_numeros_de_la_evidencia_estan_en_la_bandera(monkeypatch):
    from tools import verify as V
    _con(monkeypatch, [_fila("1100", ENT, 30000.0)])
    comp = CM.comparar_costo_mensual("1200", ENT, "Servicio de vigilancia para la sede central", 48000.0)
    f = CM.bandera_costo_mensual({}, comp, "1200", 576000.0, 360)
    nums = V._numeros_de_la_regla(f)
    assert {48000.0, 30000.0, 576000.0, 360000.0, 360.0, 60.0} <= nums
    assert "costo_mensual_salto" in V.RULE_SLUGS
