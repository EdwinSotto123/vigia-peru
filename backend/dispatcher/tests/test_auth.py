"""ID token para los servicios de agentes IAM-only (backend/dispatcher/auth.py) y qué hace el
dispatcher cuando Cloud Run rechaza la invocación. Sin red: requests es falso."""
from __future__ import annotations

import pytest
import requests

from backend.dispatcher import auth, main


class _Resp:
    def __init__(self, status: int = 200, text: str = "tok-1"):
        self.status_code = status
        self.text = text
        self.headers = {"content-type": "application/json"}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture(autouse=True)
def _limpio(monkeypatch):
    monkeypatch.delenv("AGENT_ID_TOKEN", raising=False)
    auth._cache.clear()
    auth._estado.update(sin_metadatos=False, avisado=False)
    yield
    auth._cache.clear()
    auth._estado.update(sin_metadatos=False, avisado=False)


def test_audiencia_es_el_origen_del_servicio():
    assert auth.audiencia_de("https://agente-obras-x-uc.a.run.app/?stream=1") == "https://agente-obras-x-uc.a.run.app"


def test_token_del_servidor_de_metadatos_con_cache(monkeypatch):
    pedidos: list[dict] = []

    def _get(url, params=None, headers=None, timeout=None):
        pedidos.append({"url": url, "params": params, "headers": headers})
        return _Resp(200, "tok-1\n")

    monkeypatch.setattr(auth.requests, "get", _get)
    h = auth.cabeceras("https://bienes.run.app/?stream=1")
    assert h == {"Authorization": "Bearer tok-1"}
    assert pedidos[0]["url"] == auth.METADATA_IDENTITY
    assert pedidos[0]["params"] == {"audience": "https://bienes.run.app"}
    assert pedidos[0]["headers"] == {"Metadata-Flavor": "Google"}
    auth.cabeceras("https://bienes.run.app")          # misma audiencia → caché
    assert len(pedidos) == 1


def test_local_sin_metadatos_no_manda_cabecera_y_no_reintenta(monkeypatch):
    n = {"get": 0}

    def _get(*a, **kw):
        n["get"] += 1
        raise requests.ConnectionError("metadata.google.internal no resuelve")

    monkeypatch.setattr(auth, "EN_CLOUD_RUN", False)
    monkeypatch.setattr(auth.requests, "get", _get)
    assert auth.cabeceras("https://bienes.run.app") == {}
    assert auth.cabeceras("https://obras.run.app") == {}
    assert n["get"] == 1


def test_agent_id_token_manual(monkeypatch):
    monkeypatch.setenv("AGENT_ID_TOKEN", " manual ")
    monkeypatch.setattr(auth.requests, "get", lambda *a, **kw: pytest.fail("no debe pedir metadatos"))
    assert auth.cabeceras("https://bienes.run.app") == {"Authorization": "Bearer manual"}


@pytest.mark.parametrize("status", [401, 403])
def test_invocacion_rechazada_reencola_sin_consumir_intento(monkeypatch, status):
    monkeypatch.setenv("AGENT_URL", "https://bienes.run.app")
    monkeypatch.setattr(main, "clasificacion_de", lambda ocid: None)
    monkeypatch.setattr(main, "documentos_en_gcs", lambda ocid: {"a.pdf": "gs://b/a.pdf"})
    monkeypatch.setattr(main, "record_en_db", lambda ocid: {"tender": {}})
    monkeypatch.setattr(main, "cabeceras_invocacion", lambda url: {"Authorization": "Bearer t"})
    enviado: dict = {}

    def _post(url, json=None, headers=None, stream=None, timeout=None):
        enviado.update(url=url, headers=headers)
        return _Resp(status)

    monkeypatch.setattr(main.requests, "post", _post)
    cierres: list[tuple] = []
    monkeypatch.setattr(main, "terminar", lambda ocid, res, err: cierres.append((ocid, res, err)))
    assert main.procesar("1225030") == main.ABORT
    assert enviado["url"] == "https://bienes.run.app?stream=1"
    assert enviado["headers"] == {"Authorization": "Bearer t"}
    assert cierres[0][1] == main.ABORT and f"HTTP {status}" in cierres[0][2]
