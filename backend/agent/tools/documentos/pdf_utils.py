"""Análisis de layout y render de páginas PDF (PyMuPDF) + page-sharding — usado por el
OCR fallback del lote y por el parser legacy."""

from tools._core import *  # noqa: F401,F403
from ._base import PARSE_PAGES_PER_SHARD, PARSE_SHARD_THRESHOLD


def _analyze_pdf_layout(blob: bytes) -> dict:
    """Analiza la estructura de un PDF para detectar páginas cuyo contenido
    está rasterizado como imagen (es decir, el PDF tiene texto extraíble bajo,
    pero las páginas tienen imágenes grandes que cubren la mayoría del área).
    Estas páginas necesitan ser renderizadas a PNG y pasadas a Gemini Vision
    porque el OCR implícito del SDK sobre el bytestream del PDF muchas veces
    no recupera bien el contenido.

    Returns:
        {
          "n_pages": int,
          "needs_render_pages": [indices 0-based],
          "low_text_pages": [indices con <300 chars],
          "total_text_chars": int,
          "es_pdf_completamente_escaneado": bool,
        }
    """
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        return {"error": f"pymupdf not available: {e}", "needs_render_pages": []}

    doc = fitz.open(stream=blob, filetype="pdf")
    needs_render: list[int] = []
    low_text: list[int] = []
    total_chars = 0
    n = len(doc)
    for i in range(n):
        page = doc[i]
        text = (page.get_text() or "").strip()
        n_chars = len(text)
        total_chars += n_chars
        if n_chars < 300:
            low_text.append(i)
        if n_chars >= 600:
            # página con texto suficiente — no requiere render
            continue
        # ¿hay imágenes cubriendo el área de la página?
        try:
            page_area = float(page.rect.width * page.rect.height) or 1.0
        except Exception:
            page_area = 1.0
        img_area = 0.0
        try:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    for r in page.get_image_rects(xref):
                        img_area += float(r.width * r.height)
                except Exception:
                    # algunas builds no exponen image_rects con xref
                    pass
        except Exception:
            pass
        ratio = img_area / page_area if page_area else 0.0
        if ratio > 0.25:
            needs_render.append(i)
    es_escaneado = len(low_text) >= max(3, int(0.7 * n))
    doc.close()
    return {
        "n_pages": n,
        "needs_render_pages": needs_render,
        "low_text_pages": low_text,
        "total_text_chars": total_chars,
        "es_pdf_completamente_escaneado": es_escaneado,
    }

def _render_pdf_pages_to_png(
    blob: bytes, page_indices: list[int], dpi: int = 160,
) -> list[tuple[int, bytes]]:
    """Renderiza páginas específicas de un PDF a PNG bytes.

    Args:
        blob: bytes del PDF.
        page_indices: lista de índices 0-based de páginas a renderizar.
        dpi: resolución de render. 160 DPI = ~1300x1700 px en página A4, balance
             OCR vs tamaño.

    Returns:
        Lista de tuples (page_index_0based, png_bytes).
    """
    try:
        import fitz
    except Exception:
        return []
    doc = fitz.open(stream=blob, filetype="pdf")
    out: list[tuple[int, bytes]] = []
    try:
        for i in page_indices:
            if i < 0 or i >= len(doc):
                continue
            try:
                pix = doc[i].get_pixmap(dpi=dpi)
                out.append((i, pix.tobytes("png")))
            except Exception:
                continue
    finally:
        doc.close()
    return out


def _split_pdf_by_pages(blob: bytes, label: str,
                        pages_per_shard: int = PARSE_PAGES_PER_SHARD,
                        threshold: int = PARSE_SHARD_THRESHOLD,
                        overlap: int = 1) -> list[tuple[str, bytes]]:
    """Si el PDF supera `threshold` páginas, lo parte en sub-PDFs de
    ~`pages_per_shard` páginas (con `overlap` págs de solape para no cortar un
    ítem a la mitad). Devuelve [(label, blob)] tal cual si es chico o si falla."""
    try:
        import fitz
        src = fitz.open(stream=blob, filetype="pdf")
        n = src.page_count
        if n <= threshold:
            src.close()
            return [(label, blob)]
        shards: list[tuple[str, bytes]] = []
        for start in range(0, n, pages_per_shard):
            a = max(0, start - overlap)
            b = min(n - 1, start + pages_per_shard - 1)
            dst = fitz.open()
            dst.insert_pdf(src, from_page=a, to_page=b)
            shards.append((f"{label} [pp.{a + 1}-{b + 1}/{n}]", dst.tobytes()))
            dst.close()
            if b >= n - 1:
                break
        src.close()
        print(json.dumps({"pdf_sharded": label[:80], "n_pages": n, "n_shards": len(shards)}), flush=True)
        return shards or [(label, blob)]
    except Exception as e:
        print(json.dumps({"pdf_shard_error": str(e)[:160], "label": label[:80]}), flush=True)
        return [(label, blob)]
