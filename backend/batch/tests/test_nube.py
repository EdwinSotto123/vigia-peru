"""Orden y salidas de la corrida diaria en la nube (backend/batch/nube.py), sin red ni GCS."""
from __future__ import annotations

from backend.batch import nube
from backend.batch.estado_remoto import Ocupado


class FalsoRemoto:
    def __init__(self, ocupado=False):
        self.eventos, self._ocupado = [], ocupado

    def tomar(self, ttl):
        if self._ocupado:
            raise Ocupado("otra corrida")
        self.eventos.append("tomar")

    def bajar(self, destino):
        self.eventos.append("bajar")
        return True

    def subir(self, origen, sanear=()):
        self.eventos.append(f"subir sanear={sanear}")
        return 0

    def soltar(self):
        self.eventos.append("soltar")


def test_candado_ocupado_sale_con_2_sin_tocar_nada(monkeypatch):
    f = FalsoRemoto(ocupado=True)
    monkeypatch.setattr(nube, "EstadoRemoto", lambda bucket: f)
    assert nube.main(["--bucket", "b"]) == 2
    assert f.eventos == []


def test_tandas_hasta_no_tener_pedidos_y_el_estado_vuelve_saneado(monkeypatch):
    f = FalsoRemoto()
    monkeypatch.setattr(nube, "EstadoRemoto", lambda bucket: f)
    pendientes = iter([5, 2, 0])
    tandas = []
    monkeypatch.setattr(nube, "_pedidos_pendientes", lambda: next(pendientes))
    monkeypatch.setattr(nube, "_tanda", lambda a, m: tandas.append(1) or 0)
    assert nube.main(["--bucket", "b"]) == 0
    assert len(tandas) == 2
    assert f.eventos == ["tomar", "bajar", "subir sanear=True", "soltar"]


def test_un_corte_del_seace_no_insiste_y_guarda_el_estado(monkeypatch):
    f = FalsoRemoto()
    monkeypatch.setattr(nube, "EstadoRemoto", lambda bucket: f)
    monkeypatch.setattr(nube, "_pedidos_pendientes", lambda: 10)
    llamadas = []
    monkeypatch.setattr(nube, "_tanda", lambda a, m: llamadas.append(1) or 4)
    assert nube.main(["--bucket", "b"]) == 4
    assert len(llamadas) == 1
    assert f.eventos[-2:] == ["subir sanear=True", "soltar"]
