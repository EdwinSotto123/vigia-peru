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


def _texto_con_layout(document) -> str:
    """Reconstruye el texto OCR usando el LAYOUT (tokens + bounding boxes) que
    Document AI ya devuelve GRATIS en la misma respuesta — sin Layout Parser.

    Agrupa tokens en FILAS por coordenada Y y, dentro de cada fila, inserta ' | '
    cuando hay un salto horizontal grande entre tokens (límite de columna). Así
    los cuadros (evaluación técnica/económica, tabla de ítems) llegan a Gemini
    como filas legibles en vez de texto plano desordenado. Devuelve "" si no hay
    bounding boxes (el caller cae al texto plano)."""
    full = document.text or ""
    if not full:
        return ""

    def _seg(layout) -> str:
        try:
            return "".join(full[int(s.start_index or 0):int(s.end_index or 0)]
                           for s in layout.text_anchor.text_segments)
        except Exception:
            return ""

    def _box(el):
        try:
            bp = el.layout.bounding_poly
            vs = list(bp.normalized_vertices) or list(bp.vertices)
            if not vs:
                return None
            xs = [v.x for v in vs]; ys = [v.y for v in vs]
            return (min(xs), sum(ys) / len(ys), max(xs))  # x_izq, y_centro, x_der
        except Exception:
            return None

    out: list[str] = []
    Y_TOL, X_GAP = 0.008, 0.04  # umbrales (coordenadas normalizadas 0..1)
    for page in (document.pages or []):
        toks = []
        for t in (page.tokens or []):
            b = _box(t); txt = _seg(t.layout)
            if b and txt.strip():
                toks.append((b[1], b[0], b[2], txt.strip()))  # y, x_izq, x_der, texto
        if not toks:  # sin bbox (p.ej. imageless sin layout) → usar líneas
            for line in (page.lines or []):
                lt = _seg(line.layout).replace("\n", " ").strip()
                if lt:
                    out.append(lt)
            out.append("")
            continue
        toks.sort(key=lambda z: (round(z[0], 3), z[1]))
        rows, cur, cy = [], [], None
        for y, xl, xr, txt in toks:
            if cy is None or abs(y - cy) <= Y_TOL:
                cur.append((xl, xr, txt)); cy = y if cy is None else cy
            else:
                rows.append(cur); cur = [(xl, xr, txt)]; cy = y
        if cur:
            rows.append(cur)
        for row in rows:
            row.sort(key=lambda z: z[0])
            parts, prev_xr = [], None
            for xl, xr, txt in row:
                if prev_xr is not None:
                    parts.append(" | " if (xl - prev_xr) > X_GAP else " ")
                parts.append(txt)
                prev_xr = xr
            line = "".join(parts).strip()
            if line:
                out.append(line)
        out.append("")
    return "\n".join(out).strip()


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
    # Aprovechar el LAYOUT (gratis) para reordenar filas/columnas de tablas. Solo
    # se adopta si NO perdió texto vs el plano (guard anti-regresión). Flag para
    # poder revertir sin redeploy.
    if text and os.getenv("DOCAI_LAYOUT_TEXT", "1") != "0":
        try:
            rebuilt = _texto_con_layout(result.document)
            if rebuilt and len(rebuilt) >= 0.85 * len(text):
                text = rebuilt
        except Exception as e:
            print(f"[docai] layout reconstruct falló ({type(e).__name__}: {str(e)[:100]}) → texto plano", flush=True)
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
