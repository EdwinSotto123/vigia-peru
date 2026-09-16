"""Recuperación (retrieveContexts) sobre los corpus de RAG Engine + enriquecimiento con el
catálogo (documento, artículo, página, url_oficial). Lo usan consultar.py y evaluar.py; la tool
del agente (backend/agent/tools/legal.py) replica esta lógica sin depender de este paquete.
"""
from __future__ import annotations

import re
import time

import requests

from ._comun import CATALOGO_BLOB, CORPUS, CORPUS_ESTADO_BLOB, INICIO_LEY_32069, leer_json_gcs, rag_api, token_acceso

_ART_TXT_RE = re.compile(r"/art-(tp-)?(\d{4})\.txt$")
_ART_CAB_RE = re.compile(r"(?m)^Art[íi]culo\s+([0-9]+|[IVXLC]+)\b")
_PAG_RE = re.compile(r"\[página\s+(\d+)\]")
_catalogo_cache: dict | None = None
_corpus_cache: dict | None = None


def catalogo() -> dict:
    global _catalogo_cache
    if _catalogo_cache is None:
        _catalogo_cache = leer_json_gcs(CATALOGO_BLOB, default={}) or {}
    return _catalogo_cache


def corpus_resource_names() -> dict[str, str]:
    """{nombre_corpus: resource_name} desde gs://…/corpus.json (lo escribe corpus.py)."""
    global _corpus_cache
    if _corpus_cache is None:
        est = leer_json_gcs(CORPUS_ESTADO_BLOB, default={}) or {}
        _corpus_cache = {k: v["resource_name"] for k, v in est.items() if v.get("resource_name")}
    return _corpus_cache


def corpus_para_regimen(regimen: str | None) -> list[str]:
    """Corpus de normas según régimen + siempre criterios-vinculantes."""
    r = str(regimen or "").lower()
    if r in ("30225", "tuo_30225", "historico", "historicas"):
        normas = ["normas-historicas"]
    elif r in ("32069", "ley_32069", "vigente", "vigentes"):
        normas = ["normas-vigentes"]
    else:
        normas = ["normas-vigentes", "normas-historicas"]
    return normas + ["criterios-vinculantes"]


def regimen_por_fecha(fecha_convocatoria: str | None) -> str:
    """Corte temporal (mismo criterio que compliance_rules.norma_aplicable)."""
    if fecha_convocatoria and str(fecha_convocatoria)[:10] < INICIO_LEY_32069:
        return "30225"
    return "32069"


def retrieve_contexts(pregunta: str, corpus_resource: str, top_k: int = 5,
                      distancia_max: float | None = None, timeout: int = 60) -> list[dict]:
    """Una llamada REST a :retrieveContexts sobre UN corpus. Devuelve los contextos crudos."""
    body = {
        "vertex_rag_store": {"rag_resources": [{"rag_corpus": corpus_resource}]},
        "query": {"text": pregunta, "rag_retrieval_config": {"top_k": int(top_k)}},
    }
    if distancia_max is not None:
        body["query"]["rag_retrieval_config"]["filter"] = {"vector_distance_threshold": float(distancia_max)}
    r = requests.post(f"{rag_api('v1')}:retrieveContexts",
                      headers={"Authorization": f"Bearer {token_acceso()}", "Content-Type": "application/json"},
                      json=body, timeout=timeout)
    if r.status_code >= 300:
        raise RuntimeError(f"retrieveContexts HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    return ((data.get("contexts") or {}).get("contexts")) or []


def enriquecer(ctx: dict, nombre_corpus: str, cat: dict | None = None) -> dict:
    """Contexto crudo → {corpus, documento, articulo, pagina, cita, url_oficial, score, ...}."""
    cat = catalogo() if cat is None else cat
    uri = ctx.get("sourceUri") or ctx.get("source_uri") or ""
    texto = ctx.get("text") or ""
    meta = cat.get(uri) or {}
    articulo = meta.get("articulo")
    if not articulo:
        m = _ART_TXT_RE.search(uri)
        if m:
            articulo = str(int(m.group(2))) if not m.group(1) else None
        if not articulo:
            m2 = _ART_CAB_RE.search(texto)
            if m2:
                articulo = m2.group(1)
    pagina = meta.get("pagina")
    if not pagina:
        mp = _PAG_RE.search(texto)
        if mp:
            pagina = int(mp.group(1))
    if not pagina and isinstance(ctx.get("chunk"), dict):
        pm = (ctx["chunk"].get("pageSpan") or ctx["chunk"].get("page_span") or {})
        pagina = pm.get("firstPage") or pm.get("first_page")
    cita = re.sub(r"\s+", " ", texto).strip()
    # RAG Engine (Vector Search 2.0) devuelve `score` como DISTANCIA coseno (observado el 2026-09-16:
    # 0,20 para el artículo exacto, 0,30 para ruido). Se expone `distancia` y un `score` de similitud
    # = 1 − distancia, coherente con el umbral RAG_MIN_SCORE (0,7) de compliance_rules.
    dist = ctx.get("score")
    score = round(1.0 - float(dist), 4) if isinstance(dist, (int, float)) else None
    return {
        "corpus": nombre_corpus,
        "documento": meta.get("documento") or ctx.get("sourceDisplayName") or ctx.get("source_display_name") or uri.rsplit("/", 1)[-1],
        "numero": meta.get("numero"),
        "tipo": meta.get("tipo"),
        "regimen": meta.get("regimen"),
        "articulo": articulo,
        "pagina": pagina,
        "cita": cita[:700],
        "url_oficial": meta.get("url_oficial") or "",
        "url_oficial_verificada": meta.get("url_oficial_verificada"),
        "score": score,
        "distancia": dist,
        "source_uri": uri,
    }


def consultar(pregunta: str, regimen: str | None = None, top: int = 5, corpus: list[str] | None = None,
              distancia_max: float | None = None) -> dict:
    """Consulta los corpus pertinentes y devuelve {matches (ordenados por score), por_corpus, ms}."""
    nombres = corpus or corpus_para_regimen(regimen)
    rn = corpus_resource_names()
    t0 = time.time()
    por_corpus, errores = {}, {}
    for n in nombres:
        if n not in rn:
            errores[n] = "corpus no creado"
            continue
        try:
            crudos = retrieve_contexts(pregunta, rn[n], top_k=top, distancia_max=distancia_max)
            por_corpus[n] = [enriquecer(c, n) for c in crudos]
        except Exception as e:
            errores[n] = str(e)[:200]
    todos = [m for lst in por_corpus.values() for m in lst]
    # `score` ya es similitud (1 − distancia): mayor = más parecido
    todos.sort(key=lambda m: -(m["score"] or 0))
    return {"pregunta": pregunta, "regimen": regimen, "corpus": nombres, "matches": todos,
            "por_corpus": por_corpus, "errores": errores, "ms": int((time.time() - t0) * 1000)}
