"""El cliente compatible deja de mandar `temperature` a un modelo que la rechaza con HTTP 400."""
import sys
import types
from types import SimpleNamespace

from tools import llm_compatible as lc


class _Resp:
    def __init__(self, status, cuerpo):
        self.status_code, self._cuerpo = status, cuerpo
        self.text = str(cuerpo)

    def json(self):
        return self._cuerpo


def test_reintenta_sin_temperature_y_lo_recuerda(monkeypatch):
    enviados = []

    def post(url, headers=None, json=None, timeout=None):
        enviados.append(dict(json))
        if "temperature" in json:
            return _Resp(400, {"error": {"message": "`temperature` is deprecated for this model."}})
        return _Resp(200, {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]})

    monkeypatch.setitem(sys.modules, "requests", types.SimpleNamespace(post=post))
    monkeypatch.setenv("WORKERS_AI_URL", "https://x.invalid/v1")
    monkeypatch.setenv("LLM_COMPAT_MODEL", "modelo-sin-temp")
    monkeypatch.delenv("WORKERS_AI_REASONING", raising=False)
    lc._SIN_TEMPERATURA.discard("modelo-sin-temp")

    texto, _ = lc._llamar([{"role": "user", "content": "hola"}], 50, SimpleNamespace(temperature=0.2))
    assert texto == "ok"
    assert "temperature" in enviados[0] and "temperature" not in enviados[1]

    enviados.clear()
    lc._llamar([{"role": "user", "content": "hola"}], 50, SimpleNamespace(temperature=0.2))
    assert len(enviados) == 1 and "temperature" not in enviados[0]


def test_otros_400_no_se_reintentan(monkeypatch):
    def post(url, headers=None, json=None, timeout=None):
        return _Resp(400, {"error": {"message": "falta messages"}})

    monkeypatch.setitem(sys.modules, "requests", types.SimpleNamespace(post=post))
    monkeypatch.setenv("WORKERS_AI_URL", "https://x.invalid/v1")
    monkeypatch.setenv("LLM_COMPAT_MODEL", "otro-modelo")
    try:
        lc._llamar([{"role": "user", "content": "hola"}], 50, SimpleNamespace(temperature=None))
    except RuntimeError as e:
        assert "HTTP 400" in str(e)
    else:
        raise AssertionError("debía fallar")
