"""Pipeline de UN documento del lote: caché de texto → (descarga → expansión → OCR →
persistir) → caché de extracción → (extracción → persistir) → post-proceso. Incluye el
lock por sha256 que evita OCR doble de bytes idénticos dentro del mismo lote."""

from tools._core import *  # noqa: F401,F403
from ._base import (_sha256_hex, PARSE_OVERALL_TIMEOUT_S, PARSE_SKIP_TEXTO_CACHE,
                    PARSER_SCHEMA_VERSION, PARSE_REUSE_EXTRACCION)
from .fetch import _fetch_doc_bytes, _download_from_gcs
from .contenedores import _expandir_contenedor
from .ocr_texto import _texto_de_unidades, _texto_cache_get, _texto_cache_put, _extraccion_cache_put
from .extractor import _extraer_documento
from .evidencia import _post_procesar


def _bytes_de_doc(doc: dict, state: dict) -> tuple[bytes | None, str, str | None]:
    """Bytes del documento: gs:// del DocRef → cadena histórica (_fetch_doc_bytes: b64 inline,
    doc_urls, downloader local, relay, directo)."""
    gs = doc.get("gs")
    if gs:
        blob, err = _download_from_gcs(gs)
        if blob is not None:
            return blob, "gcs", None
        print(f"[lote] gcs falló para {gs[:80]}: {err}", flush=True)
    url = doc.get("url")
    if url:
        class _Ctx:
            __slots__ = ("state",)

            def __init__(self, st):
                self.state = st
        return _fetch_doc_bytes(url, _Ctx(state))
    return None, "failed", "sin gs:// ni url"


_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT: dict[str, threading.Event] = {}


def _sha_por_url_get(ocid: str | None, url: str | None) -> str | None:
    """sha256 conocido para (ocid, url) en `documentos` (migración 17) — evita bajar de nuevo un
    documento que no está en documentos_gcs pero cuyo texto ya está cacheado."""
    if not ocid or not url:
        return None
    try:
        conn = _pg()
    except Exception:
        return None
    try:
        cur = conn.cursor()
        cur.execute("SELECT sha256 FROM documentos WHERE ocid=%s AND blob_url=%s AND sha256 IS NOT NULL LIMIT 1",
                    (_short_ocid(ocid), url))
        row = cur.fetchone()
        return row[0] if row else None
    except Exception:
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _sha_por_url_put(ocid: str | None, url: str | None, sha256: str, doc: dict) -> None:
    if not ocid or not url or not sha256:
        return
    try:
        conn = _pg()
    except Exception:
        return
    try:
        cur = conn.cursor()
        cur.execute("UPDATE documentos SET sha256=%s WHERE ocid=%s AND blob_url=%s", (sha256, _short_ocid(ocid), url))
        if cur.rowcount == 0:
            cur.execute(
                """INSERT INTO documentos (ocid, tipo, nombre, blob_url, metadata, seccion, ocds_doc_id, sha256)
                   VALUES (%s, 'otro', %s, %s, %s, %s, %s, %s) ON CONFLICT (ocid, blob_url) DO UPDATE SET sha256=EXCLUDED.sha256""",
                (_short_ocid(ocid), doc.get("titulo") or "(sin título)", url,
                 json.dumps({"ocds_documentType": doc.get("tipo"), "format": doc.get("formato")}),
                 doc.get("seccion"), str(doc.get("id") or "") or None, sha256))
        conn.commit()
    except Exception as e:
        print(f"[lote] documentos.sha256 no actualizable: {str(e)[:100]}", flush=True)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _esperar_sha(sha: str) -> bool:
    """Si otro hilo del MISMO lote ya está procesando este sha (bytes idénticos publicados
    con dos URLs), espera a que termine y devuelve True (→ leer de caché). Si no, reclama el
    sha y devuelve False."""
    with _INFLIGHT_LOCK:
        ev = _INFLIGHT.get(sha)
        if ev is None:
            _INFLIGHT[sha] = threading.Event()
            return False
    ev.wait(timeout=PARSE_OVERALL_TIMEOUT_S)
    return True


def _liberar_sha(sha: str) -> None:
    with _INFLIGHT_LOCK:
        ev = _INFLIGHT.pop(sha, None)
    if ev is not None:
        ev.set()


def _procesar_doc(doc: dict, state: dict, bloque: str, prioridad: tuple[str, ...], ocds_ctx: dict) -> dict:
    """Pipeline de UN documento: caché de texto → (descarga → expansión → OCR → persistir) →
    caché de extracción → (extracción → persistir) → post-proceso. Devuelve un dict con
    `tx` (texto), `ext` (extracción), `recortes`, `tiempos`, `sha256`, `cache`."""
    t0 = time.monotonic()
    label = f"{doc.get('titulo') or doc.get('id') or 'documento'}"
    if doc.get("formato"):
        label += f" [{doc['formato']}]"
    out = {"doc": doc, "sha256": doc.get("sha256"), "recortes": [], "tiempos": {}, "cache": {"texto": False, "extraccion": False}}
    ocid = state.get("ocid") or state.get("ocid_preloaded")
    sha = doc.get("sha256") or _sha_por_url_get(ocid, doc.get("url"))
    if sha and not doc.get("sha256"):
        doc["sha256"] = sha
        doc["_sha_desde_documentos"] = True
        out["sha256"] = sha
    reclamado: str | None = None
    if sha:
        if _esperar_sha(sha):
            out["cache"]["esperado_en_lote"] = True
        else:
            reclamado = sha
    try:
        tx = _texto_cache_get(sha) if (sha and not PARSE_SKIP_TEXTO_CACHE) else None
        blob = None
        if tx is None:
            blob, fuente, err = _bytes_de_doc(doc, state)
            out["tiempos"]["descarga_s"] = round(time.monotonic() - t0, 1)
            if blob is None:
                out["error"] = f"download_failed: {err}"
                out["recortes"].append({"donde": f"descarga:{label[:80]}", "limite": "descarga_fallida", "omitido": f"{label} ({err})"})
                return out
            if not sha:
                sha = _sha256_hex(blob)
                out["sha256"] = sha
                doc["sha256"] = sha
                if _esperar_sha(sha):
                    out["cache"]["esperado_en_lote"] = True
                else:
                    reclamado = sha
                tx = None if PARSE_SKIP_TEXTO_CACHE else _texto_cache_get(sha)
            out["fuente"] = fuente
        return _procesar_doc_texto(doc, state, bloque, ocds_ctx, out, label, sha, tx, blob, t0, prioridad)
    finally:
        if reclamado:
            _liberar_sha(reclamado)


def _procesar_doc_texto(doc, state, bloque, ocds_ctx, out, label, sha, tx, blob, t0, prioridad) -> dict:
    """Segunda mitad de _procesar_doc: OCR (si hace falta) + extracción + post-proceso."""
    if tx is not None:
        out["cache"]["texto"] = True
        out["recortes"].extend(tx.get("recortes") or [])   # recortes del OCR original (chunks perdidos, etc.)
        print(f"[lote] texto en caché · {label[:60]} · {tx['n_paginas']} págs · {tx['chars']:,} chars", flush=True)
    else:
        t1 = time.monotonic()
        unidades, rec = _expandir_contenedor(blob, doc.get("titulo") or doc.get("url") or "documento", prioridad)
        out["recortes"].extend(rec)
        if not unidades:
            out["error"] = "sin_contenido_procesable"
            return out
        tx = _texto_de_unidades(unidades)
        tx["extraccion"] = {}
        out["recortes"].extend(tx.get("recortes") or [])
        out["tiempos"]["ocr_s"] = round(time.monotonic() - t1, 1)
        out["unidades"] = [{"nombre": u["nombre"], "kind": u["kind"]} for u in unidades]
        _texto_cache_put(sha, state.get("ocid") or state.get("ocid_preloaded"), doc.get("gs"), doc.get("formato"), tx)
        print(f"[lote] OCR · {label[:60]} · {len(unidades)} unidad(es) · {tx['n_paginas']} págs · {tx['chars']:,} chars · "
              f"{tx['motor']} · {out['tiempos']['ocr_s']}s", flush=True)
    out["tx"] = tx
    # ── extracción (cacheada por bloque + versión de schema + modelo) ──
    model = os.getenv("PARSER_MODEL", DEFAULT_GEMINI_MODEL)
    clave = f"{bloque or 'base'}@{PARSER_SCHEMA_VERSION}@{model}"
    ext = None
    if PARSE_REUSE_EXTRACCION and isinstance(tx.get("extraccion"), dict) and isinstance(tx["extraccion"].get(clave), dict):
        ext = tx["extraccion"][clave]
        out["cache"]["extraccion"] = True
        print(f"[lote] extracción en caché · {label[:60]} · {clave}", flush=True)
    if ext is None:
        t2 = time.monotonic()
        ext = _extraer_documento(tx, label, bloque, ocds_ctx, doc.get("tipo"))
        out["tiempos"]["extraccion_s"] = round(time.monotonic() - t2, 1)
        out["recortes"].extend(ext.get("_recortes") or [])
        ext = _post_procesar(ext, tx, sha, doc)
        _extraccion_cache_put(sha, clave, ext)   # incluye _recortes/_usos: en caché también se reportan
    else:
        out["recortes"].extend(ext.get("_recortes") or [])
    out["ext"] = ext
    out["tiempos"]["total_s"] = round(time.monotonic() - t0, 1)
    # Dejar el sha en `documentos` (ocid, url) también para los que vinieron de documentos_gcs:
    # cuando el blob expire (90 días) el texto sigue localizable por URL sin volver a bajarlo.
    if doc.get("url") and sha and not doc.get("_sha_desde_documentos"):
        _sha_por_url_put(state.get("ocid") or state.get("ocid_preloaded"), doc["url"], sha, doc)
    return out
