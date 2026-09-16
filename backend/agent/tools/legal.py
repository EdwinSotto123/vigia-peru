"""Tools del dominio: legal."""

from tools._core import *  # noqa: F401,F403

def lookup_opinion_oece(
    norma: str = "",
    articulo_ley: str = "",
    articulo_reglamento: str = "",
    num_opinion: str = "",
    tool_context: ToolContext = None,
) -> dict:
    """Busca opiniones OECE por filtros estructurados (norma + artículo).
    Más preciso que el RAG semántico cuando ya sabés QUÉ artículo de ley
    está en juego. Retorna top-5 opiniones ordenadas por año descendente.

    Args:
        norma: ej. 'Ley 32069', 'Ley 30225', 'Ley 30225 - DL 1444', 'DL 1017'.
               Búsqueda parcial (ILIKE).
        articulo_ley: ej. '2', '11', '34', '55'. Match exacto del texto.
        articulo_reglamento: ej. '64', '100', '161'. Match exacto del texto.
        num_opinion: ej. 'D37-2025', '060-2024'. Match exacto.

    Returns:
        Diccionario con `n_matches`, `filters_aplicados`, `opiniones`
        [{ano, norma, num_opinion, articulo_ley, numeral, literal,
          articulo_reglamento, interpretacion, link}].
    """
    where = []
    params: list = []
    if norma and norma.strip():
        where.append("norma ILIKE %s")
        params.append(f"%{norma.strip()}%")
    if articulo_ley and str(articulo_ley).strip():
        where.append("articulo_ley = %s")
        params.append(str(articulo_ley).strip())
    if articulo_reglamento and str(articulo_reglamento).strip():
        where.append("articulo_reglamento = %s")
        params.append(str(articulo_reglamento).strip())
    if num_opinion and num_opinion.strip():
        where.append("num_opinion = %s")
        params.append(num_opinion.strip())

    if not where:
        return {"error": "Al menos uno de norma/articulo_ley/articulo_reglamento/num_opinion debe especificarse"}

    sql = (
        "SELECT ano, norma, num_opinion, articulo_ley, numeral_art_ley, "
        "literal_art_ley, articulo_reglamento, interpretacion, link "
        "FROM opiniones_oece_estructurado "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY ano DESC, num_opinion DESC LIMIT 5"
    )
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        opiniones = [{
            "ano": r[0],
            "norma": r[1],
            "num_opinion": r[2],
            "articulo_ley": r[3],
            "numeral": r[4],
            "literal": r[5],
            "articulo_reglamento": r[6],
            "interpretacion": (r[7] or "")[:800],  # cap para no inflar prompt
            "link": r[8],
        } for r in rows]
        return {
            "n_matches": len(opiniones),
            "filters_aplicados": {
                "norma": norma or None,
                "articulo_ley": articulo_ley or None,
                "articulo_reglamento": articulo_reglamento or None,
                "num_opinion": num_opinion or None,
            },
            "opiniones": opiniones,
        }
    except Exception as e:
        return {"error": f"db: {str(e)[:200]}"}
    finally:
        conn.close()

def _query_legal_rag_pgvector(question: str, tool_context=None) -> dict:
    """Backend legacy: RAG sobre las opiniones OECE vía pgvector en Cloud SQL.
    Se mantiene como FALLBACK de Vertex AI Search (ver `query_legal_rag`)."""
    # 1) Embebe la pregunta (mismo modelo que los documentos).
    try:
        qvec = _embed_one(question, "RETRIEVAL_QUERY")
    except Exception as e:
        return {"error": f"embedding failed: {str(e)[:200]}"}

    # 2) Búsqueda vectorial EN Cloud SQL (pgvector) — reemplaza a Pinecone.
    #    `<=>` = distancia coseno; score = 1 - distancia = similitud.
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT num_opinion, norma, ano, articulo_ley, articulo_reglamento, "
            "       interpretacion, link, 1 - (embedding <=> %s::vector) AS score "
            "  FROM opiniones_oece_estructurado "
            " WHERE embedding IS NOT NULL "
            " ORDER BY embedding <=> %s::vector "
            " LIMIT 5",
            (_vec_literal(qvec), _vec_literal(qvec)),
        )
        rows = cur.fetchall()
    except Exception as e:
        return {"error": f"pgvector query failed: {str(e)[:200]} "
                         f"(¿corriste build_legal_embeddings?)"}
    finally:
        conn.close()

    matches = [{
        "score": round(float(r[7]), 4),
        "num_opinion": r[0],
        "norma": r[1],
        "ano": r[2],
        "art_ley": r[3],
        "art_reglamento": r[4],
        "interpretacion_snippet": (r[5] or "")[:600],
        "link": r[6],
    } for r in rows]
    return {"question": question, "n_matches": len(matches), "matches": matches, "_source": "pgvector"}


# ── Vertex AI Search (Agent Builder) — RAG de las 721 opiniones ─────────────
# Data store gestionado + grounding, sin pipeline de embeddings. Backend por env
# LEGAL_RAG_BACKEND ('rag_engine' | 'vertex' [default] | 'pgvector'); ver la sección
# RAG Engine más abajo para el RAG normativo completo (normas + criterios).
_DE_PROJECT = os.getenv("VERTEX_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT", "vivid-spot-480905-a4")
_DE_DATASTORE = os.getenv("LEGAL_RAG_DATASTORE", "vigia-oece")
_DE_ENGINE = os.getenv("LEGAL_RAG_ENGINE", "vigia-oece-search")
_DE_BASE = ("https://discoveryengine.googleapis.com/v1/projects/{p}"
            "/locations/global/collections/default_collection")
LEGAL_RAG_BACKEND = os.getenv("LEGAL_RAG_BACKEND", "vertex").strip().lower()


def _discovery_token() -> str:
    import google.auth
    from google.auth.transport.requests import Request as _AuthReq
    creds, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(_AuthReq())
    return creds.token


def _safe_doc_id(s) -> str:
    import re as _re
    sid = _re.sub(r"[^a-zA-Z0-9_-]", "-", str(s or "").strip())[:60]
    return sid or "op"


def query_legal_rag_vertex(question: str, top_k: int = 5) -> dict:
    """RAG sobre las opiniones OECE vía Vertex AI Search (engine vigia-oece-search)."""
    import requests as _rq
    base = _DE_BASE.format(p=_DE_PROJECT)
    url = f"{base}/engines/{_DE_ENGINE}/servingConfigs/default_search:search"
    body = {"query": question, "pageSize": top_k}
    r = _rq.post(url, headers={"Authorization": f"Bearer {_discovery_token()}",
                               "Content-Type": "application/json",
                               "X-Goog-User-Project": _DE_PROJECT},
                 json=body, timeout=30)
    if r.status_code >= 300:
        return {"error": f"vertex search HTTP {r.status_code}: {r.text[:200]}"}
    data = r.json()
    matches = []
    for res in data.get("results", []):
        sd = ((res.get("document") or {}).get("structData")) or {}
        matches.append({
            "score": None,  # el ranking lo da Vertex; no expone score crudo por default
            "num_opinion": sd.get("num_opinion"),
            "norma": sd.get("norma"),
            "ano": sd.get("ano"),
            "art_ley": sd.get("articulo_ley"),
            "art_reglamento": sd.get("articulo_reglamento"),
            "interpretacion_snippet": (sd.get("interpretacion") or "")[:600],
            "link": sd.get("link"),
        })
    return {"question": question, "n_matches": len(matches),
            "matches": matches, "_source": "vertex_ai_search"}


# ── Vertex AI RAG Engine (normas + criterios vinculantes) — backend `rag_engine` ────────
# Plan 2026-09-16 Frente R. Cuatro corpus en RAG Engine (modo serverless, sin costo fijo):
#   normas-vigentes (Ley 32069 + D.S. 009-2025-EF + bases estándar + TUO 27444), normas-historicas
#   (TUO 30225 + D.S. 344-2018-EF), criterios-vinculantes (Acuerdos de Sala Plena + Opiniones DTN,
#   incluidas las 721 filas de opiniones_oece_estructurado) y control-cgr (MAC, directivas CGR).
# El corpus de normas se elige por `norma_aplicable(fecha_convocatoria)`; criterios-vinculantes se
# consulta siempre. Los artículos de las normas están segmentados (un archivo por artículo,
# backend/rag/segmentar.py) y la metadata (documento, url_oficial, régimen) vive en
# gs://<RAG_BUCKET>/catalogo.json. Cascada: rag_engine → vertex (opiniones) → pgvector.
_RAG_LOCATION = os.getenv("RAG_LOCATION", "us-central1")
_RAG_BUCKET = os.getenv("RAG_BUCKET", "vigia-peru-rag")
_RAG_CORPUS_ENV = {
    "normas-vigentes": "RAG_CORPUS_NORMAS_VIGENTES",
    "normas-historicas": "RAG_CORPUS_NORMAS_HISTORICAS",
    "criterios-vinculantes": "RAG_CORPUS_CRITERIOS",
    "control-cgr": "RAG_CORPUS_CONTROL",
}
_RAG_TOP_K = max(1, int(os.getenv("RAG_TOP_K", "5") or 5))
_RAG_CATALOGO_TTL_S = 3600
_rag_catalogo_cache: dict = {"t": 0.0, "data": None}
_RAG_ART_TXT_RE = re.compile(r"/art-(tp-)?(\d{4})\.txt$")
_RAG_ART_CAB_RE = re.compile(r"(?m)^Art[íi]culo\s+([0-9]+|[IVXLC]+)\b")
_RAG_PAG_RE = re.compile(r"\[página\s+(\d+)\]")


def _rag_corpus_resources() -> dict:
    """{nombre_corpus: resource_name} desde las env RAG_CORPUS_* (solo los configurados)."""
    out = {}
    for nombre, env in _RAG_CORPUS_ENV.items():
        v = (os.getenv(env) or "").strip()
        if v:
            out[nombre] = v
    return out


def rag_engine_configurado() -> bool:
    rc = _rag_corpus_resources()
    return bool(rc.get("criterios-vinculantes") or rc.get("normas-vigentes") or rc.get("normas-historicas"))


def _rag_catalogo() -> dict:
    """gs://<RAG_BUCKET>/catalogo.json (uri → metadata), cacheado 1 h. {} si no se puede leer."""
    now = time.time()
    if _rag_catalogo_cache["data"] is not None and now - _rag_catalogo_cache["t"] < _RAG_CATALOGO_TTL_S:
        return _rag_catalogo_cache["data"]
    data = {}
    try:
        from google.cloud import storage
        blob = storage.Client().bucket(_RAG_BUCKET).blob("catalogo.json")
        data = json.loads(blob.download_as_text(encoding="utf-8")) or {}
    except Exception as e:
        print(json.dumps({"legal_rag_catalogo_error": str(e)[:160]}), flush=True)
        if _rag_catalogo_cache["data"] is not None:
            return _rag_catalogo_cache["data"]
    _rag_catalogo_cache.update(t=now, data=data)
    return data


def _rag_corpus_por_regimen(regimen: str) -> list:
    r = str(regimen or "").lower()
    if "30225" in r or r in ("historico", "historicas"):
        normas = ["normas-historicas"]
    elif "32069" in r or r in ("vigente", "vigentes"):
        normas = ["normas-vigentes"]
    else:
        normas = ["normas-vigentes", "normas-historicas"]
    return normas + ["criterios-vinculantes"]


def _rag_regimen_state(tool_context) -> str:
    """Régimen por fecha de convocatoria del state (norma_aplicable); sin state → vigente."""
    try:
        from tools.compliance_rules import norma_aplicable, _fecha_convocatoria_state
        state = getattr(tool_context, "state", None) or {}
        return norma_aplicable(_fecha_convocatoria_state(state))["regimen"]
    except Exception:
        return "ley_32069"


def _rag_retrieve(question: str, corpus_resource: str, top_k: int) -> list:
    """POST :retrieveContexts (v1) sobre UN corpus → contextos crudos."""
    import requests as _rq
    url = (f"https://{_RAG_LOCATION}-aiplatform.googleapis.com/v1/projects/{_DE_PROJECT}"
           f"/locations/{_RAG_LOCATION}:retrieveContexts")
    body = {"vertex_rag_store": {"rag_resources": [{"rag_corpus": corpus_resource}]},
            "query": {"text": question, "rag_retrieval_config": {"top_k": int(top_k)}}}
    r = _rq.post(url, headers={"Authorization": f"Bearer {_discovery_token()}",
                               "Content-Type": "application/json"}, json=body, timeout=45)
    if r.status_code >= 300:
        raise RuntimeError(f"retrieveContexts HTTP {r.status_code}: {r.text[:200]}")
    return ((r.json().get("contexts") or {}).get("contexts")) or []


def _rag_enriquecer(ctx: dict, nombre_corpus: str, catalogo: dict) -> dict:
    """Contexto crudo → chunk citable {corpus, documento, articulo, pagina, cita, url_oficial, score}
    + claves legacy (num_opinion, norma, interpretacion_snippet, link) para _elegir_opinion_pertinente."""
    uri = ctx.get("sourceUri") or ctx.get("source_uri") or ""
    texto = ctx.get("text") or ""
    meta = catalogo.get(uri) or {}
    articulo = meta.get("articulo")
    if not articulo:
        m = _RAG_ART_TXT_RE.search(uri)
        if m and not m.group(1):
            articulo = str(int(m.group(2)))
        else:
            m2 = _RAG_ART_CAB_RE.search(texto)
            if m2:
                articulo = m2.group(1)
    pagina = meta.get("pagina")
    if not pagina:
        mp = _RAG_PAG_RE.search(texto)
        if mp:
            pagina = int(mp.group(1))
    if not pagina and isinstance(ctx.get("chunk"), dict):
        ps = ctx["chunk"].get("pageSpan") or ctx["chunk"].get("page_span") or {}
        pagina = ps.get("firstPage") or ps.get("first_page")
    cita = re.sub(r"\s+", " ", texto).strip()[:500]
    documento = (meta.get("documento") or ctx.get("sourceDisplayName") or ctx.get("source_display_name")
                 or uri.rsplit("/", 1)[-1])
    url = meta.get("url_oficial") or ""
    # RAG Engine (Vector Search 2.0) devuelve `score` como DISTANCIA coseno (0,20 = artículo exacto,
    # 0,30 = ruido; medido el 2026-09-16). Se expone similitud = 1 − distancia para que el umbral
    # RAG_MIN_SCORE (0,7) de compliance_rules._elegir_opinion_pertinente siga teniendo sentido.
    dist = ctx.get("score")
    score = round(1.0 - float(dist), 4) if isinstance(dist, (int, float)) else None
    es_norma = meta.get("tipo") in ("norma", "reglamento")
    return {
        "corpus": nombre_corpus, "documento": documento, "numero": meta.get("numero"),
        "tipo": meta.get("tipo"), "regimen": meta.get("regimen"), "articulo": articulo,
        "pagina": pagina, "cita": cita, "url_oficial": url,
        "score": score, "distancia": dist,
        # Corto (≤ ~160 chars): `norma_citada` del schema admite 300 y el modelo agrega el principio.
        "cita_formato": (f"Art. {articulo} de {meta.get('numero') or documento}" if articulo and es_norma
                         else (meta.get("numero") or documento)) + (f" ({url})" if url else ""),
        # legacy (compliance_rules._elegir_opinion_pertinente y prompts que esperan opiniones)
        "num_opinion": meta.get("num_opinion"),
        "norma": meta.get("norma") or meta.get("numero") or documento,
        "ano": meta.get("ano"),
        "art_ley": meta.get("articulo_ley") or (articulo if meta.get("tipo") == "norma" else None),
        "art_reglamento": meta.get("articulo_reglamento") or (articulo if meta.get("tipo") == "reglamento" else None),
        "interpretacion_snippet": cita[:400], "link": url,
    }


_RAG_QUERY_CACHE: dict = {}
_RAG_QUERY_CACHE_TTL_S = float(os.getenv("RAG_QUERY_CACHE_TTL_S", "900") or 900)


def query_legal_rag_engine(question: str, regimen: str = "", top_k: int = _RAG_TOP_K,
                           incluir_control: bool = False) -> dict:
    """Consulta RAG Engine: corpus de normas según régimen + criterios-vinculantes (+ control-cgr
    si se pide). Devuelve {question, regimen, corpus, n_matches, matches, por_corpus, _source}.
    Caché por proceso (15 min): la cuota de embeddings del proyecto es baja (5 RPM para
    textembedding-gecko, ver docs/design/RAG_NORMATIVO.md §4) y cada corpus consultado gasta una."""
    clave = (question.strip().lower(), str(regimen or ""), int(top_k), bool(incluir_control))
    hit = _RAG_QUERY_CACHE.get(clave)
    if hit and time.time() - hit[0] < _RAG_QUERY_CACHE_TTL_S:
        return json.loads(hit[1])
    recursos = _rag_corpus_resources()
    nombres = _rag_corpus_por_regimen(regimen)
    if incluir_control:
        nombres.append("control-cgr")
    catalogo = _rag_catalogo()
    por_corpus, errores = {}, {}
    for nombre in nombres:
        rn = recursos.get(nombre)
        if not rn:
            errores[nombre] = "sin RAG_CORPUS_* configurado"
            continue
        try:
            crudos = _rag_retrieve(question, rn, top_k)
            por_corpus[nombre] = [_rag_enriquecer(c, nombre, catalogo) for c in crudos]
        except Exception as e:
            errores[nombre] = str(e)[:200]
    matches = [m for lst in por_corpus.values() for m in lst]
    matches.sort(key=lambda m: -(m["score"] or 0.0))
    out = {"question": question, "regimen": regimen or None, "corpus": nombres,
           "n_matches": len(matches), "matches": matches[: max(top_k, 5) * 2],
           "por_corpus": por_corpus, "_source": "rag_engine"}
    if errores:
        out["errores_corpus"] = errores
    if not por_corpus:
        out["error"] = "rag_engine sin corpus consultables: " + "; ".join(f"{k}: {v}" for k, v in errores.items())
    elif matches:
        if len(_RAG_QUERY_CACHE) > 500:
            _RAG_QUERY_CACHE.clear()
        _RAG_QUERY_CACHE[clave] = (time.time(), json.dumps(out, ensure_ascii=False))
    return out


def _publicar_urls_grounding(tool_context, matches: list) -> None:
    """Las url_oficial devueltas por el RAG las produce el CÓDIGO (catálogo), no el modelo: se
    publican en state['grounding_urls'] para que verify.py las acepte en banderas y dictamen."""
    state = getattr(tool_context, "state", None)
    if state is None:
        return
    try:
        urls = state.get("grounding_urls") or []
        if not isinstance(urls, list):
            urls = list(urls) if isinstance(urls, (set, tuple)) else []
        vistos = set(urls)
        for m in matches:
            u = (m.get("url_oficial") or "").strip()
            if u and u not in vistos:
                urls.append(u)
                vistos.add(u)
        state["grounding_urls"] = urls
    except Exception:
        pass


def query_legal_rag(question: str, tool_context: ToolContext, regimen: str = "") -> dict:
    """Consulta el RAG normativo de contratación pública peruana: artículos de la ley y el
    reglamento aplicables al expediente (Ley 32069 + D.S. 009-2025-EF para convocatorias desde el
    22-04-2025; TUO Ley 30225 + D.S. 344-2018-EF para las anteriores), Acuerdos de Sala Plena del
    Tribunal y Opiniones de la DTN del OSCE/OECE. Devuelve chunks citables con `documento`,
    `articulo`, `pagina`, `cita` (texto literal), `url_oficial` y `cita_formato`
    ("Art. N de <norma> (<url>)"). Cita SOLO lo que devuelve esta tool; nunca inventes artículos.

    Backend `rag_engine` (Vertex AI RAG Engine) con FALLBACK en cascada a Vertex AI Search
    (solo opiniones) y a pgvector si falla o no devuelve resultados.

    Args:
        question: pregunta/señal en lenguaje natural. Ej: 'plazo mínimo entre convocatoria y
                  presentación de ofertas en licitación pública' o 'único postor al 100% del
                  valor referencial'.
        regimen: opcional. '32069' | '30225'. Si se omite se toma de la fecha de convocatoria
                 del expediente en curso (norma_aplicable).

    Returns:
        Diccionario con `matches` (top-K con metadata) + `_source` o `error`.
    """
    if LEGAL_RAG_BACKEND == "pgvector":
        return _query_legal_rag_pgvector(question, tool_context)
    fallos = []
    if LEGAL_RAG_BACKEND == "rag_engine" and rag_engine_configurado():
        try:
            reg = (regimen or "").strip() or _rag_regimen_state(tool_context)
            res = query_legal_rag_engine(question, regimen=reg)
            if not res.get("error") and res.get("n_matches"):
                _publicar_urls_grounding(tool_context, res["matches"])
                # Respuesta compacta para el LLM: `matches` ya trae todo; `por_corpus` lo duplica.
                res = {k: v for k, v in res.items() if k != "por_corpus"}
                res["matches"] = res["matches"][:8]
                return res
            fallos.append(res.get("error") or "rag_engine_sin_resultados")
        except Exception as e:
            fallos.append(f"rag_engine_exc: {str(e)[:150]}")
    try:
        res = query_legal_rag_vertex(question)
        if not res.get("error") and res.get("n_matches"):
            if fallos:
                res["_fallback_desde"] = fallos
            return res
        fallos.append(res.get("error") or "vertex_sin_resultados")
    except Exception as e:
        fallos.append(f"vertex_exc: {str(e)[:150]}")
    fb = _query_legal_rag_pgvector(question, tool_context)
    if isinstance(fb, dict):
        fb["_fallback_desde"] = fallos
        fb["_fallback_desde_vertex"] = fallos[-1] if fallos else None
    return fb


def ingest_opinions_to_vertex_search() -> dict:
    """ADMIN — lee las opiniones de Cloud SQL y las importa al data store de
    Vertex AI Search (import inline, batches de 100, reconciliación INCREMENTAL
    por id → idempotente). Correr una vez tras crear el data store."""
    import requests as _rq
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT num_opinion, norma, ano, articulo_ley, articulo_reglamento, "
            "       interpretacion, link FROM opiniones_oece_estructurado")
        rows = cur.fetchall()
    finally:
        conn.close()
    docs = []
    for r in rows:
        docs.append({
            "id": _safe_doc_id(r[0]),
            "structData": {
                "num_opinion": r[0], "norma": r[1], "ano": r[2],
                "articulo_ley": r[3], "articulo_reglamento": r[4],
                "interpretacion": (r[5] or "")[:5000], "link": r[6],
            },
        })
    if not docs:
        return {"error": "no_opinions_in_db"}
    base = _DE_BASE.format(p=_DE_PROJECT)
    url = f"{base}/dataStores/{_DE_DATASTORE}/branches/0/documents:import"
    token = _discovery_token()
    n_ok, n_err, errs = 0, 0, []
    for i in range(0, len(docs), 100):
        batch = docs[i:i + 100]
        body = {"inlineSource": {"documents": batch}, "reconciliationMode": "INCREMENTAL"}
        resp = _rq.post(url, headers={"Authorization": f"Bearer {token}",
                                      "Content-Type": "application/json",
                                      "X-Goog-User-Project": _DE_PROJECT},
                        json=body, timeout=120)
        if resp.status_code < 300:
            n_ok += len(batch)
        else:
            n_err += len(batch)
            errs.append(f"HTTP {resp.status_code}: {resp.text[:150]}")
    return {"total_opiniones": len(docs), "enviadas_ok": n_ok, "errores": n_err,
            "detalle_errores": errs[:3],
            "nota": "La indexación de Vertex AI Search tarda unos minutos tras el import."}


def _vec_literal(vec) -> str:
    """Serializa un vector a literal pgvector: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{float(x):.6f}" for x in vec) + "]"


def _embed_one(text: str, task_type: str):
    """Embebe UN texto con gemini-embedding-001 (768 dims)."""
    from google.genai import types as gtypes
    client = _gemini_client()

    def _call():
        return client.models.embed_content(
            model=EMBED_MODEL_RAG,
            contents=[text],
            config=gtypes.EmbedContentConfig(task_type=task_type, output_dimensionality=768),
        )

    with _throttle_gemini():
        resp = _gemini_call_with_retry(_call)
    return list(resp.embeddings[0].values)


def _embed_batch(texts: list, task_type: str):
    """Embebe N textos en una sola llamada (más rápido para la carga inicial)."""
    from google.genai import types as gtypes
    client = _gemini_client()

    def _call():
        return client.models.embed_content(
            model=EMBED_MODEL_RAG,
            contents=texts,
            config=gtypes.EmbedContentConfig(task_type=task_type, output_dimensionality=768),
        )

    with _throttle_gemini():
        resp = _gemini_call_with_retry(_call)
    return [list(e.values) for e in resp.embeddings]


def build_legal_embeddings() -> dict:
    """ADMIN — correr UNA vez (idempotente). Habilita pgvector, agrega la columna
    `embedding vector(768)` a opiniones_oece_estructurado y la puebla embebiendo
    `interpretacion` con gemini-embedding-001 (RETRIEVAL_DOCUMENT). Reemplaza a
    Pinecone: el RAG semántico pasa a vivir 100% en Cloud SQL. Re-ejecutable:
    solo embebe filas con embedding NULL.
    """
    stats = {"extension": False, "column": False, "pendientes": 0,
             "embedded": 0, "errores": 0}
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        stats["extension"] = True
        cur.execute("ALTER TABLE opiniones_oece_estructurado "
                    "ADD COLUMN IF NOT EXISTS embedding vector(768)")
        stats["column"] = True
        conn.commit()

        cur.execute(
            "SELECT ctid, norma, articulo_ley, articulo_reglamento, interpretacion "
            "  FROM opiniones_oece_estructurado WHERE embedding IS NULL"
        )
        rows = cur.fetchall()
        stats["pendientes"] = len(rows)

        BATCH = 20
        batch: list = []  # (ctid, texto)
        def _flush(b):
            if not b:
                return
            try:
                vecs = _embed_batch([t for _, t in b], "RETRIEVAL_DOCUMENT")
                for (ctid, _), vec in zip(b, vecs):
                    cur.execute(
                        "UPDATE opiniones_oece_estructurado SET embedding = %s::vector "
                        "WHERE ctid = %s",
                        (_vec_literal(vec), ctid),
                    )
                    stats["embedded"] += 1
                conn.commit()
            except Exception as e:
                stats["errores"] += len(b)
                print(json.dumps({"legal_embed_error": str(e)[:160]}), flush=True)

        for ctid, norma, art_ley, art_reg, interp in rows:
            texto = " ".join(filter(None, [
                (norma or ""),
                (f"art. {art_ley}" if art_ley else ""),
                (f"reglamento art. {art_reg}" if art_reg else ""),
                (interp or "")[:3000],
            ])).strip()
            if not texto:
                continue
            batch.append((ctid, texto))
            if len(batch) >= BATCH:
                _flush(batch); batch = []
        _flush(batch)

        # Índice HNSW coseno (después de poblar). 723 filas → barato y rápido.
        try:
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_opiniones_emb "
                "ON opiniones_oece_estructurado USING hnsw (embedding vector_cosine_ops)"
            )
            conn.commit()
            stats["index"] = True
        except Exception as e:
            stats["index_error"] = str(e)[:160]
        return stats
    finally:
        conn.close()


# ── FunctionTool wrappers ──
query_legal_rag_tool = FunctionTool(func=query_legal_rag)
lookup_opinion_oece_tool = FunctionTool(func=lookup_opinion_oece)
