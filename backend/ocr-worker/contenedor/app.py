"""Servicio de OCR abierto (Docling: RapidOCR + estructura de tablas) para las páginas escaneadas de los documentos.

Sólo saca TEXTO (las tablas, como tablas Markdown): ordenarlo y clasificarlo lo hace después el modelo de lenguaje. Corre
en un Cloudflare Container detrás del Worker vigia-ocr (src/index.ts); sin modelo de lenguaje ni límite de uso.

  GET  /salud                       → {"ok": true, "listo": bool}
  POST /ocr  {"paginas": [b64, …]}  → {"paginas": [{"markdown": str, "dudosa": bool, "segundos": float}], "segundos": float}

Una página «dudosa» (tabla con números de ítem que no son correlativos, una cantidad con un símbolo de moneda suelto o
filas de ítem fuera de toda tabla) es la que conviene leer con otro motor: lo decide quien llama.
"""
from __future__ import annotations

import torch  # noqa: F401  (antes que las demás: así lo carga Docling)

import base64
import os
import re
import threading
import time
from io import BytesIO

from docling.datamodel.base_models import DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions, TableFormerMode
from docling.document_converter import DocumentConverter, ImageFormatOption
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

torch.set_num_threads(int(os.getenv("OCR_HILOS", str(os.cpu_count() or 4))))


def convertidor() -> DocumentConverter:
    op = PdfPipelineOptions()
    op.do_ocr = True
    op.do_table_structure = True
    op.table_structure_options.mode = TableFormerMode.ACCURATE
    op.table_structure_options.do_cell_matching = True
    op.images_scale = float(os.getenv("OCR_ESCALA", "2.0"))
    op.ocr_options = RapidOcrOptions(force_full_page_ocr=True, lang=["es"])
    return DocumentConverter(format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=op)})


_FILA_ITEM = re.compile(r"^\|\s*(\d{1,3})\s*\|", re.M)
_CANTIDAD_RARA = re.compile(r"\|\s*[^|\s]*[€$£¥@][^|]*\|")


def numeracion_corregida(md: str) -> str:
    """Un número de ítem que rompe la secuencia y al revés sí calza («07, 80, 09» → «08») era el OCR leyendo los dígitos
    invertidos. Sólo ese caso."""
    lineas = md.split("\n")
    nums = [(i, int(m.group(1)), m.group(1)) for i, l in enumerate(lineas) for m in [_FILA_ITEM.match(l)] if m]
    for k, (i, n, txt) in enumerate(nums):
        prev = nums[k - 1][1] if k > 0 else None
        if prev is None or n == prev + 1 or len(txt) != 2:
            continue
        if int(txt[::-1]) == prev + 1:
            lineas[i] = lineas[i].replace(txt, txt[::-1], 1)
            nums[k] = (i, int(txt[::-1]), txt[::-1])
    return "\n".join(lineas)


def tabla_dudosa(md: str) -> bool:
    bloques, actual = [], []
    for l in md.split("\n"):
        if l.lstrip().startswith("|"):
            actual.append(l)
        elif actual:
            bloques.append(actual)
            actual = []
    if actual:
        bloques.append(actual)
    for b in bloques:
        nums = [int(m.group(1)) for l in b for m in [_FILA_ITEM.match(l.strip())] if m]
        if any(n != p + 1 and n != 1 for p, n in zip(nums, nums[1:])):
            return True
        if any(_CANTIDAD_RARA.search(l) for l in b):
            return True
    sueltas = [l for l in md.split("\n") if not l.lstrip().startswith("|") and re.match(r"^\s*\d{2}\s+[A-ZÁÉÍÓÚÑ]{3,}", l)]
    return len(sueltas) >= 3


app = FastAPI()
_estado: dict = {}
_lock = threading.Lock()   # una página a la vez por instancia: Docling ya usa todos los núcleos


def _conv() -> DocumentConverter:
    with _lock:
        if "c" not in _estado:
            _estado["c"] = convertidor()
        return _estado["c"]


class Pedido(BaseModel):
    paginas: list[str]


@app.get("/salud")
def salud() -> dict:
    return {"ok": True, "listo": "c" in _estado}


@app.post("/ocr")
def ocr(p: Pedido) -> dict:
    if not p.paginas or len(p.paginas) > 16:
        raise HTTPException(400, "entre 1 y 16 páginas por pedido")
    conv = _conv()
    t0 = time.monotonic()
    out = []
    for b64 in p.paginas:
        t = time.monotonic()
        try:
            datos = base64.b64decode(b64)
            with _lock:
                r = conv.convert(DocumentStream(name="p.png", stream=BytesIO(datos)))
            md = numeracion_corregida(r.document.export_to_markdown()).strip()
            out.append({"markdown": md, "dudosa": len(md) < 40 or tabla_dudosa(md), "segundos": round(time.monotonic() - t, 2)})
        except Exception as e:  # noqa: BLE001 — una página rota no tumba el pedido
            out.append({"markdown": "", "dudosa": True, "error": f"{type(e).__name__}: {str(e)[:200]}",
                        "segundos": round(time.monotonic() - t, 2)})
    return {"paginas": out, "segundos": round(time.monotonic() - t0, 2)}
