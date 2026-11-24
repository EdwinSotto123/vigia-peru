"""Texto por página: Document AI o PyMuPDF (+ Gemini Vision para páginas rasterizadas),
caché de unidades en memoria y caché de texto en BD (documentos_texto)."""

import random

from tools._core import *  # noqa: F401,F403
from tools.costo_llm import etiquetas
from collections import OrderedDict as _OrderedDict
from ._base import _sha256_hex, PARSE_CALL_TIMEOUT_MS, PARSE_UNIT_WORKERS, VERSION_PARSER, _throttle_parser
from .pdf_utils import _analyze_pdf_layout, _render_pdf_pages_to_png


# ── Texto por página: Document AI o PyMuPDF (+ Gemini Vision para páginas rasterizadas) ──
def _paginas_pymupdf(pdf: bytes, page_offset: int, fin: float | None = None) -> tuple[list[dict], list[dict]]:
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
    # Tope de páginas escaneadas por documento y de tiempo: un expediente puede traer cientos, y el análisis entero
    # corre en una Lambda de 900 s. Lo que no entra queda dicho en `recortes` (no cuenta como OCR fallido).
    _max = int(os.getenv("OCR_MAX_PAGINAS", "40"))
    if len(need) > _max:
        recortes.append({"donde": "ocr_tope_paginas", "limite": _max,
                         "omitido": f"{len(need) - _max} páginas escaneadas de {len(need)} (desde la {page_offset + need[_max] + 1})"})
        need = need[:_max]
    import time as _t0
    if need and fin is not None and fin - _t0.monotonic() < 5:
        # Se acabó el tiempo de OCR de este DOCUMENTO (`fin` lo comparte con los demás PDF de su ZIP): queda el texto
        # extraíble y lo demás se dice en `recortes`. No es un OCR fallido (como el tope de páginas).
        recortes.append({"donde": "ocr_tope_tiempo", "limite": "OCR_DOC_BUDGET_S",
                         "omitido": f"{len(need)} páginas escaneadas (desde la {page_offset + need[0] + 1})"})
        need = []
    if need:
        try:
            import concurrent.futures as _cf
            import time as _time
            rendered = _render_pdf_pages_to_png(pdf, need, dpi=int(os.getenv("OCR_DPI", "130")))
            leido = False
            _tam = max(1, int(os.getenv("OCR_LOTE", "4")))
            lotes = [rendered[k:k + _tam] for k in range(0, len(rendered), _tam)]
            _fin = _time.monotonic() + float(os.getenv("OCR_BUDGET_S", "240"))
            if fin is not None:
                _fin = min(_fin, fin)
            ex = _cf.ThreadPoolExecutor(max_workers=max(1, int(os.getenv("OCR_PARALELO", "2"))))
            try:
                futs = {ex.submit(_ocr_con_paciencia, lote, _fin): lote for lote in lotes}
                pendientes = set(futs)
                while pendientes:
                    hechos, pendientes = _cf.wait(pendientes, timeout=max(0.0, _fin - _time.monotonic()),
                                                  return_when=_cf.FIRST_COMPLETED)
                    if not hechos:   # se acabó el tiempo: lo que falta no se espera
                        faltan = [page_offset + idx + 1 for f in pendientes for idx, _p in futs[f]]
                        recortes.append({"donde": "ocr_gemini_vision", "limite": "tiempo",
                                         "omitido": f"páginas escaneadas {sorted(faltan)[:30]}"})
                        break
                    for f in hechos:
                        lote = futs[f]
                        try:
                            textos = f.result()
                        except Exception as e:  # noqa: BLE001 — un lote caído no tumba a los demás
                            recortes.append({"donde": "ocr_gemini_vision", "limite": "fallo",
                                             "omitido": f"páginas escaneadas {[page_offset + i + 1 for i, _p in lote]} ({str(e)[:80]})"})
                            continue
                        leido = leido or any(textos)
                        for (idx, _png), txt in zip(lote, textos):
                            if txt and len(txt) > paginas[idx]["chars"]:
                                paginas[idx] = {"n": page_offset + idx + 1, "texto": txt, "chars": len(txt), "ocr": "gemini_vision"}
            finally:
                ex.shutdown(wait=False, cancel_futures=True)
            if rendered and not leido and not any(r.get("donde") == "ocr_gemini_vision" for r in recortes):
                # Ninguna página escaneada devolvió texto: es un OCR fallido, no un documento en blanco.
                recortes.append({"donde": "ocr_gemini_vision", "limite": "sin_texto",
                                 "omitido": f"páginas rasterizadas {[page_offset + i + 1 for i in need][:30]}"})
        except Exception as e:
            recortes.append({"donde": "ocr_gemini_vision", "limite": "fallo",
                             "omitido": f"páginas rasterizadas {[page_offset + i + 1 for i in need][:30]} ({str(e)[:80]})"})
    return paginas, recortes


_TRANSITORIO = ("429", "rate limit", "RESOURCE_EXHAUSTED", "503", "502", "504", "UNAVAILABLE", "timeout", "Timeout",
                "sin conexión", "sin respuesta")


def _ocr_con_paciencia(rendered: list[tuple[int, bytes]], fin: float) -> list[str]:
    """`_ocr_paginas_gemini` que no se rinde ante el límite de uso: un 429 (o un 5xx o un corte) se reintenta con espera
    creciente (5, 10, 20, 30 s…) mientras quede tiempo de OCR. El cliente reintentaba 3 veces en 6 s y la página quedaba
    sin leer: en tres días, 277 de 500 análisis perdieron páginas escaneadas, casi todas por 429 (2026-11-24; 1231921:
    el requerimiento con ~40 ítems estaba escaneado dentro del Word y el análisis vio uno solo)."""
    import time as _time
    espera = 5.0
    while True:
        try:
            return _ocr_paginas_gemini(rendered)
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if not any(t in msg for t in _TRANSITORIO) or _time.monotonic() + espera + 20 > fin:
                raise
            _time.sleep(espera + random.uniform(0, 2))
            espera = min(espera * 2, 30.0)


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
        "Transcribe LITERALMENTE todo el texto de cada una (tablas como filas con ' | '; conserva números, montos, "
        "fechas, RUC y nombres tal como están). No resumas, no inventes, no completes. Si una página es ilegible, "
        "devuelve texto vacío para ese índice. Devuelve un elemento por cada imagen."))]
    for _idx, png in rendered:
        parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))
    cfg = gtypes.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                       max_output_tokens=65535, temperature=0.0,
                                       http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS),
                                       # Transcribir literal no necesita razonamiento.
                                       thinking_config=thinking_crudo("ocr", DEFAULT_GEMINI_MODEL, "minimal"),
                                       labels=etiquetas("ocr"))
    with _throttle_parser():
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


def _ocr_fallido(recortes) -> bool:
    """¿Algún recorte dice que el OCR falló (Vision o un tramo de Document AI)? Ese texto no se cachea: un fallo
    pasajero dejaba para siempre un contrato escaneado con 0 caracteres."""
    return any(isinstance(r, dict) and r.get("donde") in ("ocr_gemini_vision", "ocr_docai") for r in (recortes or []))


def _texto_de_unidades(unidades: list[dict], fin: float | None = None) -> dict:
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
            pags, rec = _paginas_pymupdf(pdf, offset, fin)
        except Exception as e:
            return [], [{"donde": f"ocr:{nombre[:80]}", "limite": "pdf_ilegible", "omitido": f"{nombre} ({str(e)[:80]})"}], True, None
        for p in pags:
            p["archivo"] = nombre
        # Con el OCR de las páginas escaneadas fallido el texto va incompleto: `truncado` evita que se cachee.
        return pags, rec, _ocr_fallido(rec), ("pymupdf+gemini_vision" if any(p.get("ocr") for p in pags) else "pymupdf")

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
        if _ocr_fallido(recortes):   # filas guardadas antes con el OCR fallido: se vuelve a leer
            return None
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
