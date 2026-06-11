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


# ── Vertex AI Search (Agent Builder) — backend nuevo del RAG legal ───────────
# Reemplaza a pgvector: data store gestionado + grounding, sin pipeline de
# embeddings. pgvector queda como FALLBACK. Backend por env LEGAL_RAG_BACKEND
# ('vertex' [default] | 'pgvector').
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


def query_legal_rag(question: str, tool_context: ToolContext) -> dict:
    """Consulta el RAG de las 723 opiniones normativas OECE/CONOSCE para hallar
    las opiniones jurídicas más relevantes a una pregunta o señal de riesgo.
    Devuelve hasta 5 opiniones con norma, número, artículos, snippet y URL.

    Usa **Vertex AI Search** (grounding gestionado) con FALLBACK automático a
    pgvector si Vertex falla o no devuelve resultados.

    Args:
        question: pregunta/señal en lenguaje natural. Ej: 'adenda mayor al 25%
                  del monto original' o 'único postor al 100% del referencial'.

    Returns:
        Diccionario con `matches` (top-K con metadata) + `_source` o `error`.
    """
    if LEGAL_RAG_BACKEND == "pgvector":
        return _query_legal_rag_pgvector(question, tool_context)
    try:
        res = query_legal_rag_vertex(question)
        if not res.get("error") and res.get("n_matches"):
            return res
        _why = res.get("error") or "vertex_sin_resultados"
    except Exception as e:
        _why = f"vertex_exc: {str(e)[:150]}"
    fb = _query_legal_rag_pgvector(question, tool_context)
    if isinstance(fb, dict):
        fb["_fallback_desde_vertex"] = _why
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
