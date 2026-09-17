"""Texto por página: Document AI o PyMuPDF (+ Gemini Vision para páginas rasterizadas),
caché de unidades en memoria y caché de texto en BD (documentos_texto)."""

from tools._core import *  # noqa: F401,F403
from collections import OrderedDict as _OrderedDict
from ._base import _sha256_hex, PARSE_CALL_TIMEOUT_MS, PARSE_UNIT_WORKERS, VERSION_PARSER
from .pdf_utils import _analyze_pdf_layout, _render_pdf_pages_to_png


# ── Texto por página: Document AI o PyMuPDF (+ Gemini Vision para páginas rasterizadas) ──
def _paginas_pymupdf(pdf: bytes, page_offset: int) -> tuple[list[dict], list[dict]]:
    """Fallback sin Document AI: texto extraíble por página; las páginas rasterizadas
    (texto < 300 chars con imagen > 25 % del área) se transcriben con Gemini Vision en
    lotes de ≤ 8 PNGs. Devuelve (paginas, recortes)."""
    import fitz
    recortes: list[dict] = []
    layout = _analyze_pdf_layout(pdf)
    d = fitz.open(stream=pdf, filetype="pdf")
    paginas: list[dict] = []
    try:
        for i in range(len(d)):
            t = (d[i].get_text() or "").strip()
            paginas.append({"n": page_offset + i + 1, "texto": t, "chars": len(t)})
    finally:
        d.close()
    need = list(layout.get("needs_render_pages") or [])
    if need:
        try:
            rendered = _render_pdf_pages_to_png(pdf, need, dpi=160)
            for k in range(0, len(rendered), 8):
                lote = rendered[k:k + 8]
                textos = _ocr_paginas_gemini(lote)
                for (idx, _png), txt in zip(lote, textos):
                    if txt and len(txt) > paginas[idx]["chars"]:
                        paginas[idx] = {"n": page_offset + idx + 1, "texto": txt, "chars": len(txt), "ocr": "gemini_vision"}
        except Exception as e:
            recortes.append({"donde": "ocr_gemini_vision", "limite": "fallo",
                             "omitido": f"páginas rasterizadas {[page_offset + i + 1 for i in need][:30]} ({str(e)[:80]})"})
    return paginas, recortes


def _ocr_paginas_gemini(rendered: list[tuple[int, bytes]]) -> list[str]:
    """Transcripción literal de ≤ 8 páginas PNG con Gemini (solo fallback sin Document AI)."""
    from google.genai import types as gtypes
    client = _gemini_client()
    schema = gtypes.Schema(type=gtypes.Type.OBJECT, properties={
        "paginas": gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.OBJECT, properties={
            "indice": gtypes.Schema(type=gtypes.Type.INTEGER), "texto": gtypes.Schema(type=gtypes.Type.STRING)},
            required=["indice", "texto"]))}, required=["paginas"])
    parts = [gtypes.Part.from_text(text=(
        f"Adjunto {len(rendered)} imágenes de páginas escaneadas (índices 0..{len(rendered) - 1}, en ese orden). "
        "Transcribí LITERALMENTE todo el texto de cada una (tablas como filas con ' | '). No resumas, no "
        "inventes, no completes. Si una página es ilegible, devolvé texto vacío para ese índice."))]
    for _idx, png in rendered:
        parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))
    cfg = gtypes.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                       max_output_tokens=65535, temperature=0.0,
                                       http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS))
    with _throttle_gemini():
        resp = _gemini_call_with_retry(lambda: client.models.generate_content(
            model=DEFAULT_GEMINI_MODEL, contents=parts, config=cfg))
    data = _safe_parse_json((resp.text or "").strip()) or {}
    out = [""] * len(rendered)
    for p in (data.get("paginas") or []):
        try:
            i = int(p.get("indice"))
            if 0 <= i < len(out):
                out[i] = str(p.get("texto") or "").strip()
        except Exception:
            continue
    return out


def _texto_de_unidades(unidades: list[dict]) -> dict:
    """Todas las unidades → páginas con numeración GLOBAL continua ({n, texto, chars, archivo}),
    texto con marcadores ⟦archivo: …⟧ / ⟦p.N⟧, motor y recortes."""
    from tools.docai import docai_enabled, extract_docai, marcar_paginas
    use_docai = False
    try:
        use_docai = docai_enabled()
    except Exception:
        pass
    paginas: list[dict] = []
    recortes: list[dict] = []
    motores: set[str] = set()
    truncado = False

    def _ocr_unidad(u: dict, offset: int) -> tuple[list[dict], list[dict], bool, str | None]:
        """OCR de UNA unidad PDF con numeración global desde `offset` →
        (paginas, recortes, truncado, motor). Nunca levanta. El mismo PDF (sha256) dentro
        del proceso (acta repetida en dos ZIPs distintos del mismo lote) se OCR-ea UNA vez."""
        nombre = u["nombre"]
        pdf = u["data"]
        sha_u = _sha256_hex(pdf) if pdf else None
        cached = _unit_cache_get(sha_u) if sha_u else None
        if cached is not None:
            pags = [{**p, "n": offset + i + 1, "archivo": nombre} for i, p in enumerate(cached["paginas"])]
            print(f"[lote] unidad {nombre[:50]} · sha {sha_u[:8]} ya OCR-eada en este proceso → reutilizo {len(pags)} págs", flush=True)
            return pags, [dict(r) for r in cached["recortes"]], cached["truncado"], cached["motor"]
        pags, rec, trunc, motor = _ocr_unidad_real(u, offset)
        if sha_u and pags and not trunc:
            _unit_cache_put(sha_u, {"paginas": [{k: v for k, v in p.items() if k not in ("n", "archivo")} for p in pags],
                                    "recortes": rec, "truncado": trunc, "motor": motor})
        return pags, rec, trunc, motor

    def _ocr_unidad_real(u: dict, offset: int) -> tuple[list[dict], list[dict], bool, str | None]:
        nombre = u["nombre"]
        pdf = u["data"]
        res = None
        if use_docai:
            try:
                res = extract_docai(pdf, page_offset=offset)
            except Exception as e:
                print(f"[lote] docai falló en {nombre[:60]}: {str(e)[:100]}", flush=True)
                res = None
        if res:
            for p in res["paginas"]:
                p["archivo"] = nombre
            return res["paginas"], list(res.get("recortes") or []), bool(res.get("truncado")), "docai"
        try:
            pags, rec = _paginas_pymupdf(pdf, offset)
        except Exception as e:
            return [], [{"donde": f"ocr:{nombre[:80]}", "limite": "pdf_ilegible", "omitido": f"{nombre} ({str(e)[:80]})"}], True, None
        for p in pags:
            p["archivo"] = nombre
        return pags, rec, False, ("pymupdf+gemini_vision" if any(p.get("ocr") for p in pags) else "pymupdf")

    # Offsets de página GLOBALES precalculados (conteo con PyMuPDF, barato) → las unidades PDF
    # se OCR-ean EN PARALELO (PARSE_UNIT_WORKERS) conservando la numeración y el orden. Si
    # alguna unidad no se puede contar, se cae al recorrido secuencial histórico.
    pdf_units = [u for u in unidades if u["kind"] != "paginas"]
    offsets: dict[int, int] | None = {}
    if len(pdf_units) > 1 and PARSE_UNIT_WORKERS > 1:
        acc = 0
        for idx, u in enumerate(unidades):
            offsets[idx] = acc
            if u["kind"] == "paginas":
                acc += len(u["paginas"] or [])
            else:
                n = _n_paginas_pdf(u["data"])
                if n is None:
                    offsets = None
                    break
                acc += n
    else:
        offsets = None

    if offsets is not None:
        resultados: dict[int, tuple] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(PARSE_UNIT_WORKERS, len(pdf_units))) as ex:
            futs = {ex.submit(_ocr_unidad, u, offsets[idx]): idx
                    for idx, u in enumerate(unidades) if u["kind"] != "paginas"}
            for fut in concurrent.futures.as_completed(futs):
                idx = futs[fut]
                try:
                    resultados[idx] = fut.result()
                except Exception as e:  # _ocr_unidad no levanta; por si acaso
                    u = unidades[idx]
                    resultados[idx] = ([], [{"donde": f"ocr:{u['nombre'][:80]}", "limite": "pdf_ilegible",
                                             "omitido": f"{u['nombre']} ({str(e)[:80]})"}], True, None)
        for idx, u in enumerate(unidades):
            if u["kind"] == "paginas":
                offset = offsets[idx]
                for i, p in enumerate(u["paginas"] or []):
                    t = (p.get("texto") or "").strip()
                    paginas.append({"n": offset + i + 1, "texto": t, "chars": len(t), "archivo": u["nombre"]})
                motores.add("texto_nativo")
                continue
            pags, rec, trunc, motor = resultados[idx]
            paginas.extend(pags)
            recortes.extend(rec)
            truncado = truncado or trunc
            if motor:
                motores.add(motor)
    else:
        for u in unidades:
            offset = len(paginas)
            nombre = u["nombre"]
            if u["kind"] == "paginas":
                for i, p in enumerate(u["paginas"] or []):
                    t = (p.get("texto") or "").strip()
                    paginas.append({"n": offset + i + 1, "texto": t, "chars": len(t), "archivo": nombre})
                motores.add("texto_nativo")
                continue
            pags, rec, trunc, motor = _ocr_unidad(u, offset)
            paginas.extend(pags)
            recortes.extend(rec)
            truncado = truncado or trunc
            if motor:
                motores.add(motor)
    # Texto con marcadores; cabecera ⟦archivo⟧ cuando cambia la unidad (contenedores).
    partes: list[str] = []
    cur_archivo = None
    multi = len({p.get("archivo") for p in paginas}) > 1
    for p in paginas:
        if multi and p.get("archivo") != cur_archivo:
            cur_archivo = p.get("archivo")
            partes.append(f"⟦archivo: {cur_archivo}⟧")
        partes.append(f"⟦p.{p['n']}⟧\n{p.get('texto') or ''}")
    texto = "\n".join(partes).strip()
    motor = "+".join(sorted(motores)) if len(motores) > 1 else (next(iter(motores)) if motores else "ninguno")
    return {"paginas": paginas, "texto": texto, "n_paginas": len(paginas), "chars": sum(p["chars"] for p in paginas),
            "motor": motor, "truncado": truncado or any(p.get("error") for p in paginas), "recortes": recortes}


_UNIT_CACHE: "_OrderedDict[str, dict]" = _OrderedDict()
_UNIT_CACHE_LOCK = threading.Lock()
_UNIT_CACHE_MAX = max(0, int(os.getenv("PARSE_UNIT_CACHE_MAX", "64") or 64))


def _unit_cache_get(sha: str) -> dict | None:
    with _UNIT_CACHE_LOCK:
        r = _UNIT_CACHE.get(sha)
        if r is not None:
            _UNIT_CACHE.move_to_end(sha)
        return r


def _unit_cache_put(sha: str, res: dict) -> None:
    if _UNIT_CACHE_MAX <= 0:
        return
    with _UNIT_CACHE_LOCK:
        _UNIT_CACHE[sha] = res
        _UNIT_CACHE.move_to_end(sha)
        while len(_UNIT_CACHE) > _UNIT_CACHE_MAX:
            _UNIT_CACHE.popitem(last=False)


def _n_paginas_pdf(pdf_bytes: bytes) -> int | None:
    """Páginas de un PDF (PyMuPDF); None si no se puede abrir."""
    try:
        import fitz
        src = fitz.open(stream=pdf_bytes, filetype="pdf")
        n = src.page_count
        src.close()
        return n
    except Exception:
        return None


# ── Caché en BD: documentos_texto (+ memoria del proceso: si la BD no está, el mismo PDF
#    publicado 2-3 veces en el lote igual se OCR-ea una sola vez) ─────────────────────────
_TX_MEM: "_OrderedDict[str, dict]" = _OrderedDict()
_TX_MEM_LOCK = threading.Lock()
_TX_MEM_MAX = max(0, int(os.getenv("PARSE_TEXTO_MEM_MAX", "64") or 64))


def _tx_mem_get(sha256: str) -> dict | None:
    with _TX_MEM_LOCK:
        tx = _TX_MEM.get(sha256)
        if tx is not None:
            _TX_MEM.move_to_end(sha256)
            return json.loads(json.dumps(tx, ensure_ascii=False, default=str))
    return None


def _tx_mem_put(sha256: str, tx: dict) -> None:
    if _TX_MEM_MAX <= 0 or not sha256:
        return
    with _TX_MEM_LOCK:
        _TX_MEM[sha256] = {k: v for k, v in tx.items() if k != "extraccion"} | {"extraccion": dict(tx.get("extraccion") or {})}
        _TX_MEM.move_to_end(sha256)
        while len(_TX_MEM) > _TX_MEM_MAX:
            _TX_MEM.popitem(last=False)


def _texto_cache_get(sha256: str) -> dict | None:
    """Fila de documentos_texto con la versión actual del extractor de texto, o None
    (antes, la copia en memoria del proceso)."""
    if not sha256:
        return None
    mem = _tx_mem_get(sha256)
    if mem is not None:
        return mem
    try:
        conn = _pg()
    except Exception:
        return None
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT n_paginas, texto, paginas, truncado, motor, formato, extraccion, recortes
                 FROM documentos_texto WHERE sha256=%s AND version_parser=%s""",
            (sha256, VERSION_PARSER),
        )
        row = cur.fetchone()
        if not row:
            return None
        n_paginas, texto, paginas, truncado, motor, formato, extraccion, recortes = row
        if isinstance(paginas, str):
            paginas = json.loads(paginas)
        if isinstance(extraccion, str):
            extraccion = json.loads(extraccion)
        if isinstance(recortes, str):
            recortes = json.loads(recortes)
        return {"n_paginas": n_paginas, "texto": texto or "", "paginas": paginas or [], "truncado": bool(truncado),
                "motor": motor, "formato": formato, "extraccion": extraccion or {}, "recortes": recortes or [],
                "chars": sum(int(p.get("chars") or 0) for p in (paginas or []))}
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (get): {str(e)[:120]}", flush=True)
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _texto_cache_put(sha256: str, ocid: str | None, url_gcs: str | None, formato: str | None, tx: dict) -> bool:
    if not sha256:
        return False
    _tx_mem_put(sha256, tx)
    try:
        conn = _pg()
    except Exception:
        return False
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO documentos_texto (sha256, ocid, url_gcs, formato, n_paginas, motor, version_parser,
                                             texto, paginas, truncado, recortes, actualizado_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, now())
               ON CONFLICT (sha256) DO UPDATE SET
                 ocid=COALESCE(EXCLUDED.ocid, documentos_texto.ocid), url_gcs=COALESCE(EXCLUDED.url_gcs, documentos_texto.url_gcs),
                 formato=EXCLUDED.formato, n_paginas=EXCLUDED.n_paginas, motor=EXCLUDED.motor,
                 version_parser=EXCLUDED.version_parser, texto=EXCLUDED.texto, paginas=EXCLUDED.paginas,
                 truncado=EXCLUDED.truncado, recortes=EXCLUDED.recortes, extraccion=NULL, actualizado_at=now()""",
            (sha256, _short_ocid(ocid) if ocid else None, url_gcs, formato, tx["n_paginas"], tx["motor"], VERSION_PARSER,
             tx["texto"], json.dumps(tx["paginas"], ensure_ascii=False), bool(tx["truncado"]),
             json.dumps(tx.get("recortes") or [], ensure_ascii=False)),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (put): {str(e)[:120]}", flush=True)
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _extraccion_cache_put(sha256: str, clave: str, extraccion: dict) -> bool:
    if not sha256:
        return False
    with _TX_MEM_LOCK:
        if sha256 in _TX_MEM:
            _TX_MEM[sha256].setdefault("extraccion", {})[clave] = json.loads(json.dumps(extraccion, ensure_ascii=False, default=str))
    try:
        conn = _pg()
    except Exception:
        return False
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE documentos_texto
                  SET extraccion = COALESCE(extraccion, '{}'::jsonb) || %s::jsonb, actualizado_at = now()
                WHERE sha256 = %s""",
            (json.dumps({clave: extraccion}, ensure_ascii=False, default=str), sha256),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (extraccion): {str(e)[:120]}", flush=True)
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass
