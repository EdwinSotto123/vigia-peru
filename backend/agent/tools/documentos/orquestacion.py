"""Pipeline de UN documento del lote: caché de texto → (descarga → expansión → OCR →
persistir) → caché de extracción → (extracción → persistir) → post-proceso. Incluye el
lock por sha256 que evita OCR doble de bytes idénticos dentro del mismo lote."""

from tools._core import *  # noqa: F401,F403
from ._base import (_sha256_hex, PARSE_OVERALL_TIMEOUT_S, PARSE_SKIP_TEXTO_CACHE,
                    PARSER_SCHEMA_VERSION, PARSE_REUSE_EXTRACCION)
from .fetch import _fetch_doc_bytes, _download_from_gcs
from .contenedores import _expandir_contenedor
from .ocr_texto import _texto_de_unidades, _texto_cache_get, _texto_cache_put, _extraccion_cache_put, _ocr_fallido
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


# Margen tras el plazo del lector (`state["_parse_deadline"]`): una llamada tardía todavía puede leer algo corto.
_GRACIA_S = 60.0


def _restante(state: dict | None) -> float | None:
    """Segundos que le quedan al lector (plazo + margen), o None si nadie fijó un plazo."""
    fin = (state or {}).get("_parse_deadline")
    if not isinstance(fin, (int, float)):
        return None
    return fin + _GRACIA_S - time.monotonic()


def _fuera_de_plazo(state: dict | None) -> bool:
    r = _restante(state)
    return r is not None and r <= 0


def _esperar_sha(sha: str, espera: float | None = None) -> bool | None:
    """Si otro hilo ya está procesando este sha (bytes idénticos publicados con dos URLs, o un hilo de un lote anterior
    que se quedó sin plazo), espera a que termine y devuelve True (→ leer de caché). Si no, reclama el sha y devuelve
    False. Devuelve None si la espera se agota y el otro hilo sigue: sin eso, una fase posterior se quedaba hasta 600 s
    colgada de un hilo huérfano y el análisis entero moría en el límite de la Lambda (2026-11-14, dos contratos)."""
    with _INFLIGHT_LOCK:
        ev = _INFLIGHT.get(sha)
        if ev is None:
            _INFLIGHT[sha] = threading.Event()
            return False
    tope = float(PARSE_OVERALL_TIMEOUT_S) if espera is None else max(1.0, min(float(PARSE_OVERALL_TIMEOUT_S), espera))
    return True if ev.wait(timeout=tope) else None


def _ocupado(out: dict, label: str) -> dict:
    out["error"] = "parse timeout"
    out["recortes"].append({"donde": f"lector:{label[:80]}", "limite": "otro_hilo_sin_terminar",
                            "omitido": f"{label} (otro hilo todavía lo procesa y se acabó el plazo)"})
    return out


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
        _e = _esperar_sha(sha, _restante(state))
        if _e is None:
            return _ocupado(out, label)
        if _e:
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
                _e = _esperar_sha(sha, _restante(state))
                if _e is None:
                    return _ocupado(out, label)
                if _e:
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
        # Tope de OCR por DOCUMENTO: `OCR_BUDGET_S` es por PDF, y un ZIP con 16 PDF escaneados sumaba 380 s.
        _fin_ocr = time.monotonic() + float(os.getenv("OCR_DOC_BUDGET_S", "240"))
        _r = _restante(state)
        if _r is not None:
            _fin_ocr = min(_fin_ocr, time.monotonic() + max(0.0, _r - _GRACIA_S))
        tx = _texto_de_unidades(unidades, _fin_ocr)
        tx["extraccion"] = {}
        out["recortes"].extend(tx.get("recortes") or [])
        out["tiempos"]["ocr_s"] = round(time.monotonic() - t1, 1)
        out["unidades"] = [{"nombre": u["nombre"], "kind": u["kind"]} for u in unidades]
        if not _ocr_fallido(tx.get("recortes")):   # OCR fallido: la próxima corrida lo intenta de nuevo
            _texto_cache_put(sha, state.get("ocid") or state.get("ocid_preloaded"), doc.get("gs"), doc.get("formato"), tx)
        print(f"[lote] OCR · {label[:60]} · {len(unidades)} unidad(es) · {tx['n_paginas']} págs · {tx['chars']:,} chars · "
              f"{tx['motor']} · {out['tiempos']['ocr_s']}s", flush=True)
    out["tx"] = tx
    # ── documentos casi idénticos (la misma acta publicada como «Otorgamiento» y como «Calificación»): se extrae uno ──
    dup = _duplicado_de(state.get("ocid") or state.get("ocid_preloaded"), sha, tx, label)
    if dup:
        out["recortes"].append({"donde": f"extraccion:{label[:80]}", "limite": "duplicado_texto",
                                "omitido": f"{label} tiene las mismas páginas que «{dup}»: se extrae una sola vez"})
        out["ext"] = {"items": [], "_duplicado_de": dup}
        out["cache"]["duplicado"] = True
        out["tiempos"]["total_s"] = round(time.monotonic() - t0, 1)
        print(f"[lote] duplicado · {label[:60]} = {dup[:60]}: sin extracción", flush=True)
        return out
    # ── extracción (cacheada por bloque + versión de schema + modelo QUE RESPONDE) ──
    # Con LLM_BACKEND=compatible el nombre pedido sigue siendo el de Gemini, pero responde vigia-llm: con ese nombre en
    # la clave, Haiku reusaba las extracciones que Gemini hizo en octubre (2026-11-05: 314 de 382 dictámenes).
    model = modelo_extractor()
    clave = f"{bloque or 'base'}@{PARSER_SCHEMA_VERSION}@{model}"
    ext = None
    # Una extracción que salió TRUNCADA no se reutiliza para siempre: se reintenta una vez cuando
    # cambia la política de razonamiento (con menos thinking queda más tope de salida).
    politica = os.getenv("THINKING_EXTRACTOR", "low").strip().lower() or "low"
    if PARSE_REUSE_EXTRACCION and isinstance(tx.get("extraccion"), dict) and isinstance(tx["extraccion"].get(clave), dict):
        previa = tx["extraccion"][clave]
        if previa.get("_truncado") and previa.get("_politica_thinking") != politica:
            print(f"[lote] extracción en caché TRUNCADA · {label[:60]} · se reintenta con thinking={politica}", flush=True)
        else:
            ext = previa
            out["cache"]["extraccion"] = True
            print(f"[lote] extracción en caché · {label[:60]} · {clave}", flush=True)
    if ext is None and _fuera_de_plazo(state):
        # El lote ya dio este documento por perdido: seguir sólo gastaría modelo y tiempo que nadie va a leer. El texto
        # (si hubo OCR) ya quedó en caché para la próxima corrida.
        out["error"] = "parse timeout"
        out["recortes"].append({"donde": f"lector:{label[:80]}", "limite": "fuera_de_plazo", "omitido": f"extracción de {label}"})
        return out
    if ext is None:
        t2 = time.monotonic()
        # La sección del documento (tender/award/contract) decide qué bloques opcionales se piden (schema.py).
        ext = _extraer_documento(tx, label, bloque, {**(ocds_ctx or {}), "_seccion": doc.get("seccion")}, doc.get("tipo"))
        out["tiempos"]["extraccion_s"] = round(time.monotonic() - t2, 1)
        out["recortes"].extend(ext.get("_recortes") or [])
        ext = _post_procesar(ext, tx, sha, doc)
        ext["_politica_thinking"] = politica
        if not ext.get("_bloques_pendientes"):   # con la 2.ª pasada fallida no se cachea: se reintenta
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


# ── Documentos casi idénticos dentro de un contrato ──
# En 1226674 «Documentos de Otorgamiento de Buena Pro» y «Documentos de Calificación y Evaluación» eran la misma acta
# (667 mil caracteres cada una, un tercio del expediente) y el modelo extraía las dos (2026-11-24). La huella de un
# documento son sus páginas con texto (≥ 200 caracteres), sin espacios ni mayúsculas; si el 90 % de ellas ya está en otro
# documento del mismo contrato, es un duplicado. El primero que termina su texto se queda con la extracción.
_HUELLAS: dict[str, dict[str, tuple[str, set]]] = {}
_HUELLAS_LOCK = threading.Lock()
_HUELLAS_TOPE = 200          # contratos recordados (una Lambda caliente procesa varios)
_PAGINA_HUELLA_MIN = 200
_PARECIDO = 0.9


def _huellas(tx: dict) -> set:
    import hashlib
    return {hashlib.md5(re.sub(r"\s+", "", (p.get("texto") or "").lower()).encode("utf-8")).hexdigest()
            for p in (tx.get("paginas") or []) if len(p.get("texto") or "") >= _PAGINA_HUELLA_MIN}


def _duplicado_de(ocid: str | None, sha: str | None, tx: dict, label: str) -> str | None:
    """El título del documento del mismo contrato con las mismas páginas, o None (y éste queda registrado)."""
    if not ocid or not sha:
        return None
    h = _huellas(tx)
    if len(h) < 3:
        return None
    with _HUELLAS_LOCK:
        reg = _HUELLAS.setdefault(ocid, {})
        for otro_sha, (otro_label, otro_h) in reg.items():
            if otro_sha != sha and len(h & otro_h) >= _PARECIDO * len(h):
                return otro_label
        reg[sha] = (label, h)
        while len(_HUELLAS) > _HUELLAS_TOPE:
            _HUELLAS.pop(next(iter(_HUELLAS)))
    return None
