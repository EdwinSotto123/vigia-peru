"""OCR de páginas escaneadas con el servicio abierto vigia-ocr (Docling en un Cloudflare Container), sin modelo de lenguaje.

Con OCR_URL (y OCR_TOKEN) el OCR de tools/documentos/ocr_texto.py va aquí en vez de al modelo de visión de Workers AI:
en 7 días, 4 143 de 4 684 análisis perdieron páginas por el límite de uso de ese modelo (2026-11-24). El servicio sólo
saca TEXTO (las tablas como tablas Markdown); ordenarlo lo hace después el extractor.

Las páginas que el servicio marca «dudosas» (una tabla con números de ítem no correlativos, una cantidad con un símbolo
suelto, filas de ítem fuera de una tabla) se releen con el modelo de visión sólo si OCR_RESPALDO_LLM=1; si no, queda el
texto de Docling (en 1231921: 96 % de las filas de ítem idénticas a las del modelo).
"""
from __future__ import annotations

import base64
import os
import random
import time


def disponible() -> bool:
    return bool(os.getenv("OCR_URL"))


def _pedir(pngs: list[bytes], fin: float) -> list[dict]:
    """POST /ocr con reintentos ante 429/5xx o un corte (la instancia puede estar arrancando) mientras quede tiempo."""
    import requests
    url = os.environ["OCR_URL"].rstrip("/") + "/ocr"
    cab = {"authorization": f"Bearer {os.getenv('OCR_TOKEN', '')}", "content-type": "application/json"}
    cuerpo = {"paginas": [base64.b64encode(p).decode() for p in pngs]}
    espera = 5.0
    while True:
        try:
            r = requests.post(url, json=cuerpo, headers=cab, timeout=float(os.getenv("OCR_SERVICIO_TIMEOUT_S", "300")))
            if r.status_code < 400:
                return list(r.json().get("paginas") or [])
            if r.status_code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"vigia-ocr HTTP {r.status_code}: {r.text[:200]}")
            motivo = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            motivo = type(e).__name__
        if time.monotonic() + espera + 10 > fin:
            raise RuntimeError(f"vigia-ocr sin respuesta a tiempo ({motivo})")
        time.sleep(espera + random.uniform(0, 2))
        espera = min(espera * 2, 30.0)


def ocr_paginas(rendered: list[tuple[int, bytes]], fin: float, respaldo=None) -> list[str]:
    """El texto de cada página (PNG) en el orden recibido. `respaldo(rendered)` (el modelo de visión) relee las dudosas
    si OCR_RESPALDO_LLM=1."""
    out: list[str] = []
    dudosas: list[int] = []
    tam = max(1, int(os.getenv("OCR_SERVICIO_LOTE", "4")))
    for k in range(0, len(rendered), tam):
        lote = rendered[k:k + tam]
        res = _pedir([png for _idx, png in lote], fin)
        for j, (_idx, _png) in enumerate(lote):
            r = res[j] if j < len(res) else {}
            out.append(str(r.get("markdown") or ""))
            if r.get("dudosa", True):
                dudosas.append(k + j)
    if dudosas and respaldo is not None and os.getenv("OCR_RESPALDO_LLM", "0").strip().lower() in ("1", "true", "si", "sí"):
        try:
            for k, t in zip(dudosas, respaldo([rendered[k] for k in dudosas])):
                if t:
                    out[k] = t
        except Exception as e:  # noqa: BLE001 — sin respaldo queda el texto de Docling
            print(f"[ocr] respaldo con el modelo falló: {str(e)[:120]}", flush=True)
    return out
