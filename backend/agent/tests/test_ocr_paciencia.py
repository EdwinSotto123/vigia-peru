"""El OCR de páginas escaneadas no se rinde ante el límite de uso (tools/documentos/ocr_texto.py `_ocr_con_paciencia`):
en tres días, 277 de 500 análisis perdieron páginas escaneadas por 429 (2026-11-24; 1231921 vio 1 ítem de ~40)."""
from __future__ import annotations

import os
import sys
import time

import pytest

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools.documentos import ocr_texto as O  # noqa: E402


def test_reintenta_el_429_hasta_leer(monkeypatch):
    llamadas = {"n": 0}

    def falso(lote):
        llamadas["n"] += 1
        if llamadas["n"] < 3:
            raise RuntimeError('LLM compatible HTTP 429: {"error":{"message":"3021: rate limiting"}}')
        return ["texto"] * len(lote)

    monkeypatch.setattr(O, "_ocr_paginas_gemini", falso)
    monkeypatch.setattr(time, "sleep", lambda s: None)
    assert O._ocr_con_paciencia([(0, b"x")], time.monotonic() + 300) == ["texto"]
    assert llamadas["n"] == 3


def test_sin_tiempo_o_error_de_verdad_se_rinde(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    monkeypatch.setattr(O, "_ocr_paginas_gemini", lambda lote: (_ for _ in ()).throw(RuntimeError("HTTP 429 rate limiting")))
    with pytest.raises(RuntimeError):
        O._ocr_con_paciencia([(0, b"x")], time.monotonic() + 10)   # no quedan 5 s + 20 s
    monkeypatch.setattr(O, "_ocr_paginas_gemini", lambda lote: (_ for _ in ()).throw(ValueError("esquema inválido")))
    with pytest.raises(ValueError):
        O._ocr_con_paciencia([(0, b"x")], time.monotonic() + 300)


def test_png_con_transparencia_pasa_a_jpeg():
    import fitz
    from tools.llm_compatible import _bloque_imagen
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 4, 4), 1)   # RGBA
    pix.clear_with(255)
    b = _bloque_imagen(pix.tobytes("png"), "image/png")
    assert b["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_con_el_servicio_abierto_no_usa_el_modelo(monkeypatch):
    """Con OCR_URL el OCR va a vigia-ocr; las dudosas se releen con el modelo sólo si OCR_RESPALDO_LLM=1."""
    from tools.documentos import ocr_servicio as S
    monkeypatch.setenv("OCR_URL", "https://ocr.prueba")
    llamadas = {"modelo": 0}

    def modelo(lote):
        llamadas["modelo"] += 1
        return ["del modelo"] * len(lote)

    monkeypatch.setattr(O, "_ocr_paginas_gemini", modelo)
    monkeypatch.setattr(S, "_pedir", lambda pngs, fin: [{"markdown": "| 01 | FILTRO | 04 |", "dudosa": False},
                                                          {"markdown": "| 01 | a |\n| 90 | b |", "dudosa": True}][:len(pngs)])
    monkeypatch.delenv("OCR_RESPALDO_LLM", raising=False)
    assert O._ocr_con_paciencia([(0, b"a"), (1, b"b")], time.monotonic() + 300) == ["| 01 | FILTRO | 04 |", "| 01 | a |\n| 90 | b |"]
    assert llamadas["modelo"] == 0
    monkeypatch.setenv("OCR_RESPALDO_LLM", "1")
    assert O._ocr_con_paciencia([(0, b"a"), (1, b"b")], time.monotonic() + 300) == ["| 01 | FILTRO | 04 |", "del modelo"]
    assert llamadas["modelo"] == 1
