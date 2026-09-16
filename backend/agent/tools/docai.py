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
# Chunks de un mismo documento (>30 págs) OCR-eados a la vez (orden por índice preservado).
_CHUNK_WORKERS = max(1, int(os.getenv("DOCAI_CHUNK_WORKERS", "3") or 3))

_client = None

# ── Memo por sha256 de los bytes: el MISMO PDF (acta publicada 3 veces en el ZIP de buena
# pro, cuadro "de evaluación" que es copia byte a byte del acta) se OCR-ea UNA sola vez por
# proceso. El resultado se guarda con offset 0 y se re-numera al servirlo. Acotado a
# DOCAI_MEMO_MAX entradas (LRU simple); un hilo que llega mientras otro OCR-ea el mismo sha
# espera al primero en vez de pedir OCR de nuevo. ──
import hashlib as _hashlib
import threading as _threading
from collections import OrderedDict as _OrderedDict

_MEMO_MAX = max(0, int(os.getenv("DOCAI_MEMO_MAX", "48") or 48))
_MEMO: "_OrderedDict[str, dict]" = _OrderedDict()
_MEMO_LOCK = _threading.Lock()
_MEMO_INFLIGHT: dict[str, _threading.Event] = {}
# Contadores observables (tests / diagnóstico): OCRs reales vs servidos desde el memo.
STATS = {"ocr": 0, "memo_hits": 0}


def _memo_get(sha: str) -> dict | None:
    with _MEMO_LOCK:
        r = _MEMO.get(sha)
        if r is not None:
            _MEMO.move_to_end(sha)
        return r


def _memo_put(sha: str, res: dict) -> None:
    if _MEMO_MAX <= 0:
        return
    with _MEMO_LOCK:
        _MEMO[sha] = res
        _MEMO.move_to_end(sha)
        while len(_MEMO) > _MEMO_MAX:
            _MEMO.popitem(last=False)


def _reoffset(res: dict, page_offset: int, memo: bool = False) -> dict:
    """Copia de un resultado (guardado con offset 0) numerada desde `page_offset`."""
    pags = [{**p, "n": page_offset + i + 1} for i, p in enumerate(res["paginas"])]
    recs = []
    for r in res.get("recortes") or []:
        recs.append(dict(r))
    return {**res, "paginas": pags, "texto": marcar_paginas(pags), "recortes": recs, "memo": memo}


def _docai_client():
    global _client
    if _client is None:
        from google.cloud import documentai_v1 as documentai  # type: ignore
        opts = {"api_endpoint": f"{_LOCATION}-documentai.googleapis.com"}
        _client = documentai.DocumentProcessorServiceClient(client_options=opts)
    return _client


def docai_enabled() -> bool:
    return bool(_PROCESSOR_ID)


PAGE_MARK = "⟦p.{n}⟧"


def marcar_paginas(paginas: list[dict]) -> str:
    """Texto plano con marcador ⟦p.N⟧ al inicio de cada página (N = número 1-based
    global del documento). Es lo que ve el extractor para poder citar página."""
    return "\n".join(f"{PAGE_MARK.format(n=p['n'])}\n{p.get('texto') or ''}" for p in paginas).strip()


def _paginas_con_layout(document, page_offset: int = 0) -> list[dict]:
    """Reconstruye el texto OCR POR PÁGINA usando el LAYOUT (tokens + bounding boxes) que
    Document AI ya devuelve GRATIS en la misma respuesta — sin Layout Parser.

    Agrupa tokens en FILAS por coordenada Y y, dentro de cada fila, inserta ' | ' cuando hay
    un salto horizontal grande entre tokens (límite de columna). Así los cuadros (evaluación
    técnica/económica, tabla de ítems) llegan a Gemini como filas legibles. Si una página no
    trae bounding boxes cae a sus `lines`, y si tampoco, al segmento de texto de la página.
    Devuelve [{n, texto, chars}] con n = page_offset + índice (1-based)."""
    full = document.text or ""
    if not full:
        return []

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

    Y_TOL, X_GAP = 0.008, 0.04  # umbrales (coordenadas normalizadas 0..1)
    paginas: list[dict] = []
    for i, page in enumerate(document.pages or []):
        out: list[str] = []
        toks = []
        for t in (page.tokens or []):
            b = _box(t); txt = _seg(t.layout)
            if b and txt.strip():
                toks.append((b[1], b[0], b[2], txt.strip()))  # y, x_izq, x_der, texto
        if toks:
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
        else:  # sin bbox (p.ej. imageless sin layout) → usar líneas
            for line in (page.lines or []):
                lt = _seg(line.layout).replace("\n", " ").strip()
                if lt:
                    out.append(lt)
            if not out:
                try:
                    out.append(_seg(page.layout).strip())
                except Exception:
                    pass
        texto = "\n".join(out).strip()
        paginas.append({"n": page_offset + i + 1, "texto": texto, "chars": len(texto)})
    return paginas


def _paginas_planas(document, page_offset: int = 0) -> list[dict]:
    """Texto plano por página (segmentos de `page.layout`), sin reconstrucción de tablas."""
    full = document.text or ""
    paginas: list[dict] = []
    for i, page in enumerate(document.pages or []):
        try:
            texto = "".join(full[int(s.start_index or 0):int(s.end_index or 0)]
                            for s in page.layout.text_anchor.text_segments).strip()
        except Exception:
            texto = ""
        paginas.append({"n": page_offset + i + 1, "texto": texto, "chars": len(texto)})
    if not paginas and full.strip():
        paginas.append({"n": page_offset + 1, "texto": full.strip(), "chars": len(full.strip())})
    return paginas


def _texto_con_layout(document) -> str:
    """Compat: texto de todo el documento con marcadores ⟦p.N⟧ (una página por bloque)."""
    return marcar_paginas(_paginas_con_layout(document))


def _ocr_one_paginas(pdf_bytes: bytes, mime_type: str = "application/pdf",
                     page_offset: int = 0) -> list[dict]:
    """OCR de UN PDF de ≤30 páginas (una llamada sync) → [{n, texto, chars}] (n global)."""
    from google.cloud import documentai_v1 as documentai  # type: ignore
    client = _docai_client()
    name = client.processor_path(_PROJECT, _LOCATION, _PROCESSOR_ID)
    raw = documentai.RawDocument(content=pdf_bytes, mime_type=mime_type)
    # imageless_mode: solo queremos TEXTO (no las imágenes de cada página) → más
    # rápido/barato Y sube el límite de 15 a 30 págs/llamada (lo recomienda el
    # propio error PAGE_LIMIT_EXCEEDED del modo normal).
    req = documentai.ProcessRequest(name=name, raw_document=raw, imageless_mode=True)
    result = client.process_document(request=req)
    planas = _paginas_planas(result.document, page_offset)
    paginas = planas
    # Aprovechar el LAYOUT (gratis) para reordenar filas/columnas de tablas. Solo se
    # adopta si NO perdió texto vs el plano (guard anti-regresión, por página). Flag
    # para poder revertir sin redeploy.
    if os.getenv("DOCAI_LAYOUT_TEXT", "1") != "0":
        try:
            con_layout = _paginas_con_layout(result.document, page_offset)
            if con_layout and len(con_layout) == len(planas):
                paginas = [
                    l if l["chars"] >= 0.85 * p["chars"] else p
                    for l, p in zip(con_layout, planas)
                ]
        except Exception as e:
            print(f"[docai] layout reconstruct falló ({type(e).__name__}: {str(e)[:100]}) → texto plano", flush=True)
    n_chars = sum(p["chars"] for p in paginas)
    print(f"[docai] OCR chunk OK · {len(paginas)} págs · {n_chars:,} chars", flush=True)
    return paginas


def _ocr_one(pdf_bytes: bytes, mime_type: str = "application/pdf") -> str | None:
    """Compat: texto (con ⟦p.N⟧) de UN PDF de ≤30 páginas. Texto o None."""
    paginas = _ocr_one_paginas(pdf_bytes, mime_type)
    return marcar_paginas(paginas) or None


def _n_paginas(pdf_bytes: bytes) -> int | None:
    """Cuenta páginas con PyMuPDF (open/close explícito: el `with` no está en pymupdf
    <1.24.4 y rompería silenciosamente). None si no se pudo abrir."""
    try:
        import fitz  # pymupdf
        _src = fitz.open(stream=pdf_bytes, filetype="pdf")
        n = _src.page_count
        _src.close()
        return n
    except Exception:
        return None


def extract_docai(pdf_bytes: bytes, mime_type: str = "application/pdf",
                  page_offset: int = 0) -> dict | None:
    """OCR del PDF COMPLETO → {"paginas": [{n, texto, chars}], "texto": str con ⟦p.N⟧,
    "n_paginas": int, "motor": "docai", "truncado": bool, "recortes": [...]}.

    Para >30 páginas, parte en chunks de 30 y hace OCR de cada uno. Si UN chunk falla, el
    resto del documento igual se devuelve: las páginas del chunk fallido quedan con texto
    vacío, `truncado=True` y un recorte {donde, limite, omitido} con el rango perdido (antes
    un chunk fallido devolvía None para TODO el documento). None solo si Document AI no está
    configurado o el PDF no se pudo abrir en absoluto."""
    if not _PROCESSOR_ID or not pdf_bytes:
        return None
    sha = _hashlib.sha256(pdf_bytes).hexdigest()
    memo = _memo_get(sha)
    if memo is None and _MEMO_MAX > 0:
        # ¿otro hilo está OCR-eando estos mismos bytes? → esperar y servir del memo.
        with _MEMO_LOCK:
            ev = _MEMO_INFLIGHT.get(sha)
            if ev is None:
                _MEMO_INFLIGHT[sha] = _threading.Event()
        if ev is not None:
            ev.wait(timeout=900)
            memo = _memo_get(sha)
    if memo is not None:
        STATS["memo_hits"] += 1
        print(f"[docai] memo hit sha {sha[:8]} · {len(memo['paginas'])} págs (sin OCR)", flush=True)
        return _reoffset(memo, page_offset, memo=True)
    try:
        res = _extract_docai_uncached(pdf_bytes, mime_type, 0)
    finally:
        with _MEMO_LOCK:
            ev = _MEMO_INFLIGHT.pop(sha, None)
        if ev is not None:
            ev.set()
    if res is None:
        return None
    _memo_put(sha, res)
    STATS["ocr"] += 1
    return _reoffset(res, page_offset)


def _extract_docai_uncached(pdf_bytes: bytes, mime_type: str = "application/pdf",
                            page_offset: int = 0) -> dict | None:
    """OCR real (sin memo). Ver `extract_docai`."""
    n_pages = _n_paginas(pdf_bytes)
    recortes: list[dict] = []
    paginas: list[dict] = []
    try:
        # ≤30 págs (o no pudimos contar) → una sola llamada OCR.
        if not n_pages or n_pages <= _PAGES_PER_OCR_CALL:
            paginas = _ocr_one_paginas(pdf_bytes, mime_type, page_offset)
        else:
            # >30 págs → chunkear, OCR de cada chunk, concatenar páginas.
            import concurrent.futures
            import fitz  # pymupdf
            src = fitz.open(stream=pdf_bytes, filetype="pdf")
            chunks: list[tuple[int, int, bytes]] = []
            try:
                for start in range(0, n_pages, _PAGES_PER_OCR_CALL):
                    end = min(n_pages - 1, start + _PAGES_PER_OCR_CALL - 1)
                    dst = fitz.open()
                    dst.insert_pdf(src, from_page=start, to_page=end)
                    chunks.append((start, end, dst.tobytes()))
                    dst.close()
            finally:
                src.close()

            def _ocr_chunk(start: int, end: int, chunk_bytes: bytes) -> tuple[list[dict], dict | None]:
                try:
                    return _ocr_one_paginas(chunk_bytes, mime_type, page_offset + start), None
                except Exception as e:
                    msg = f"{type(e).__name__}: {str(e)[:140]}"
                    print(f"[docai] chunk págs {start + 1}-{end + 1} falló ({msg}) → páginas vacías", flush=True)
                    rec = {"donde": "ocr_docai", "limite": "chunk_fallido",
                           "omitido": f"páginas {page_offset + start + 1}-{page_offset + end + 1} ({msg})"}
                    return [{"n": page_offset + i + 1, "texto": "", "chars": 0, "error": msg}
                            for i in range(start, end + 1)], rec

            # Chunks en paralelo (_CHUNK_WORKERS), resultados reordenados por índice.
            resultados: list = [None] * len(chunks)
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(_CHUNK_WORKERS, len(chunks))) as ex:
                futs = {ex.submit(_ocr_chunk, a, b, cb): i for i, (a, b, cb) in enumerate(chunks)}
                for fut in concurrent.futures.as_completed(futs):
                    resultados[futs[fut]] = fut.result()
            for pags, rec in resultados:
                paginas.extend(pags)
                if rec:
                    recortes.append(rec)
    except Exception as e:
        print(f"[docai] OCR falló ({type(e).__name__}: {str(e)[:160]}) → fallback a render", flush=True)
        return None
    if not paginas:
        return None
    total = sum(p["chars"] for p in paginas)
    print(f"[docai] OCR documento completo · {len(paginas)} págs · {total:,} chars totales"
          + (f" · {len(recortes)} chunk(s) perdidos" if recortes else ""), flush=True)
    return {"paginas": paginas, "texto": marcar_paginas(paginas), "n_paginas": len(paginas),
            "motor": "docai", "truncado": bool(recortes), "recortes": recortes}


def extract_text_docai(pdf_bytes: bytes, mime_type: str = "application/pdf") -> str | None:
    """Compat: OCR del PDF COMPLETO → un solo texto con marcadores ⟦p.N⟧ por página.
    None si Document AI no está configurado o falló del todo (ver `extract_docai`)."""
    res = extract_docai(pdf_bytes, mime_type)
    if not res:
        return None
    return res["texto"] or None
