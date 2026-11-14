"""El lector de documentos respeta su plazo (2026-11-14). Dos análisis murieron en el límite de la Lambda (900 s): el
lote agotó su presupuesto con 0 de 6 documentos, sus hilos siguieron con el OCR y el modelo, y la fase siguiente se
quedó esperando hasta 600 s al hilo que aún tenía el mismo documento. Sin red, sin modelo y sin base."""
from __future__ import annotations

import os
import sys
import threading
import time

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

os.environ.pop("DOCAI_PROCESSOR_ID", None)

from tools.documentos import ocr_texto, orquestacion as O  # noqa: E402


def _pdf(textos: list[str]) -> bytes:
    import fitz
    doc = fitz.open()
    for t in textos:
        doc.new_page().insert_text((72, 72), t, fontsize=11)
    b = doc.tobytes()
    doc.close()
    return b


def test_la_espera_por_otro_hilo_tiene_tope_y_avisa():
    sha = "a" * 64
    assert O._esperar_sha(sha) is False                 # lo reclama este hilo
    try:
        t = time.monotonic()
        assert O._esperar_sha(sha, 1.0) is None         # otro lo tiene y no termina: se avisa, no se espera 600 s
        assert time.monotonic() - t < 5
        threading.Timer(0.2, O._liberar_sha, args=(sha,)).start()
        assert O._esperar_sha(sha, 10.0) is True        # terminó a tiempo: se lee de la caché
    finally:
        O._liberar_sha(sha)


def test_documento_en_manos_de_un_hilo_huerfano_no_cuelga_la_fase_siguiente(monkeypatch):
    sha = "b" * 64
    monkeypatch.setattr(O, "_texto_cache_get", lambda *_a, **_k: None)
    assert O._esperar_sha(sha) is False                 # el hilo huérfano del lote anterior
    try:
        state = {"ocid": "x", "_parse_deadline": time.monotonic() - 500}    # plazo vencido hace rato
        t = time.monotonic()
        out = O._procesar_doc({"titulo": "Bases", "sha256": sha, "url": "https://x/y.pdf"}, state, "", (), {})
        assert time.monotonic() - t < 5
        assert out["error"] == "parse timeout" and out["recortes"][-1]["limite"] == "otro_hilo_sin_terminar"
    finally:
        O._liberar_sha(sha)
    assert sha not in O._INFLIGHT                       # quien no lo reclamó no lo libera, y el dueño sí


def test_fuera_de_plazo_no_se_llama_al_modelo(monkeypatch):
    llamadas = []
    monkeypatch.setattr(O, "_extraer_documento", lambda *a, **k: llamadas.append(1) or {})
    tx = {"n_paginas": 1, "chars": 10, "paginas": [{"n": 1, "texto": "hola", "chars": 4}], "recortes": [], "extraccion": {}}
    out = {"doc": {}, "sha256": "c" * 64, "recortes": [], "tiempos": {}, "cache": {}}
    state = {"ocid": "x", "_parse_deadline": time.monotonic() - 500}
    res = O._procesar_doc_texto({"titulo": "Acta"}, state, "", {}, out, "Acta", "c" * 64, tx, None, time.monotonic(), ())
    assert res["error"] == "parse timeout" and not llamadas
    assert res["recortes"][-1]["limite"] == "fuera_de_plazo"


def test_sin_plazo_fijado_nada_cambia():
    assert O._restante({}) is None and O._fuera_de_plazo({}) is False
    assert O._fuera_de_plazo({"_parse_deadline": time.monotonic() + 100}) is False
    assert O._fuera_de_plazo({"_parse_deadline": time.monotonic() - 30}) is False     # dentro del margen de 60 s


def test_ocr_con_el_tiempo_del_documento_agotado_no_rasteriza(monkeypatch):
    pdf = _pdf(["pagina uno", "pagina dos"])
    monkeypatch.setattr(ocr_texto, "_analyze_pdf_layout", lambda _b: {"needs_render_pages": [0, 1]})

    def _no(*_a, **_k):
        raise AssertionError("no debía rasterizar: el documento ya no tiene tiempo de OCR")
    monkeypatch.setattr(ocr_texto, "_render_pdf_pages_to_png", _no)
    paginas, recortes = ocr_texto._paginas_pymupdf(pdf, 0, time.monotonic() - 1)
    assert [p["n"] for p in paginas] == [1, 2] and "pagina uno" in paginas[0]["texto"]
    assert [r["donde"] for r in recortes] == ["ocr_tope_tiempo"]
    assert not ocr_texto._ocr_fallido(recortes)                 # es un tope, no un OCR fallido: el texto sí se guarda
