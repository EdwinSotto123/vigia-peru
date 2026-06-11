"""
Cliente de Google Document AI (OCR) — pago por página (per-use).

Idea: en vez de rasterizar cada página del PDF a PNG y mandársela a Gemini Vision
(muchas llamadas multimodales, muchos tokens, lento), Document AI hace OCR del PDF
COMPLETO y devolvemos UN solo texto. El parser le pasa ese texto a Gemini en UNA
sola llamada para estructurarlo (ítems, specs, banderas).

El `process_document` síncrono limita a 30 páginas por request. Por eso, para
documentos grandes (p.ej. 90 págs), partimos el PDF en chunks de ≤30 págs, hacemos
OCR de cada chunk, y CONCATENAMOS el texto → el caller recibe el documento ENTERO
en un solo string. Así Gemini estructura todo en una sola llamada (90 págs ≈
200-300K chars ≈ 45-80K tokens, entra de sobra en el contexto de Gemini 2.5).

Reversible: si `DOCAI_PROCESSOR_ID` no está seteado o falla, devuelve None y el
parser cae a su path histórico (render PNG + Gemini Vision).
"""
from __future__ import annotations

import os

_PROJECT = os.getenv("DOCAI_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT", "vivid-spot-480905-a4")
_LOCATION = os.getenv("DOCAI_LOCATION", "us")
_PROCESSOR_ID = os.getenv("DOCAI_PROCESSOR_ID", "").strip()

# Document AI sync = 30 págs/llamada. Chunkeаmos a 30 para minimizar #llamadas OCR.
_PAGES_PER_OCR_CALL = 30

_client = None


def _docai_client():
    global _client
    if _client is None:
        from google.cloud import documentai_v1 as documentai  # type: ignore
        opts = {"api_endpoint": f"{_LOCATION}-documentai.googleapis.com"}
        _client = documentai.DocumentProcessorServiceClient(client_options=opts)
    return _client


def docai_enabled() -> bool:
    return bool(_PROCESSOR_ID)


def _ocr_one(pdf_bytes: bytes, mime_type: str = "application/pdf") -> str | None:
    """OCR de UN PDF de ≤30 páginas (una llamada sync). Texto o None."""
    from google.cloud import documentai_v1 as documentai  # type: ignore
    client = _docai_client()
    name = client.processor_path(_PROJECT, _LOCATION, _PROCESSOR_ID)
    raw = documentai.RawDocument(content=pdf_bytes, mime_type=mime_type)
    # imageless_mode: solo queremos TEXTO (no las imágenes de cada página) → más
    # rápido/barato Y sube el límite de 15 a 30 págs/llamada (lo recomienda el
    # propio error PAGE_LIMIT_EXCEEDED del modo normal).
    req = documentai.ProcessRequest(name=name, raw_document=raw, imageless_mode=True)
    result = client.process_document(request=req)
    text = (result.document.text or "").strip()
    n_pages = len(result.document.pages or [])
    print(f"[docai] OCR chunk OK · {n_pages} págs · {len(text):,} chars", flush=True)
    return text or None


def extract_text_docai(pdf_bytes: bytes, mime_type: str = "application/pdf") -> str | None:
    """OCR del PDF COMPLETO → un solo texto.

    Para >30 páginas, parte en chunks de 30, hace OCR de cada uno y concatena.
    Devuelve el texto del documento entero (str) o None si no está configurado/falló.
    """
    if not _PROCESSOR_ID or not pdf_bytes:
        return None

    # Contar páginas con PyMuPDF para decidir si chunkear. (open/close explícito:
    # el `with` no está en pymupdf <1.24.4 y rompería silenciosamente.)
    n_pages = None
    try:
        import fitz  # pymupdf
        _src = fitz.open(stream=pdf_bytes, filetype="pdf")
        n_pages = _src.page_count
        _src.close()
    except Exception:
        n_pages = None

    try:
        # ≤30 págs (o no pudimos contar) → una sola llamada OCR.
        if not n_pages or n_pages <= _PAGES_PER_OCR_CALL:
            return _ocr_one(pdf_bytes, mime_type)

        # >30 págs → chunkeаr, OCR de cada chunk, concatenar el texto.
        import fitz  # pymupdf
        parts: list[str] = []
        src = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            for start in range(0, n_pages, _PAGES_PER_OCR_CALL):
                end = min(n_pages - 1, start + _PAGES_PER_OCR_CALL - 1)
                dst = fitz.open()
                dst.insert_pdf(src, from_page=start, to_page=end)
                chunk_bytes = dst.tobytes()
                dst.close()
                t = _ocr_one(chunk_bytes, mime_type)
                if t:
                    parts.append(f"\n──── páginas {start + 1}-{end + 1} de {n_pages} ────\n{t}")
        finally:
            src.close()
        full = "\n".join(parts).strip()
        print(f"[docai] OCR documento completo · {n_pages} págs en {len(parts)} chunks · {len(full):,} chars totales", flush=True)
        return full or None
    except Exception as e:
        print(f"[docai] OCR falló ({type(e).__name__}: {str(e)[:160]}) → fallback a render", flush=True)
        return None
