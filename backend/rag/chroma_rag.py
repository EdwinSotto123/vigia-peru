"""
RAG normativo en Chroma Cloud (reemplaza a Vertex AI RAG Engine).

Cuatro colecciones `vigia_<corpus>` (normas-vigentes, normas-historicas, criterios-vinculantes, control-cgr) dentro de la
base de Chroma Cloud (`CHROMA_DATABASE`, default `simplia-vect`). Los embeddings los calcula Chroma Cloud
(Qwen3-Embedding-0.6B, multilingüe) con una instrucción de consulta legal en español: no hay modelo de embeddings propio.
Solo se tocan colecciones con prefijo `vigia_`: la base la comparten otros proyectos.

Cada chunk guarda en su metadata la ficha del catálogo (documento, numero, tipo, regimen, url_oficial, articulo, pagina…),
así la consulta no depende del bucket.

    # construir/actualizar desde una copia local del bucket (gcloud storage cp -r gs://<RAG_BUCKET> <dir>)
    python -m backend.rag.chroma_rag construir --origen C:/Users/usuario/vigia-respaldo/vigia-rag-753067078557
    python -m backend.rag.chroma_rag estado
    python -m backend.rag.chroma_rag consultar "plazo entre convocatoria y ofertas en licitación pública" --regimen 32069

Env: CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE. Sin CHROMA_API_KEY intenta leer ~/.chroma/credentials (perfil `simplia`).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

CORPUS = ("normas-vigentes", "normas-historicas", "criterios-vinculantes", "control-cgr")
PREFIJO = "vigia_"
_INSTRUCCION = ("Dada una pregunta sobre contratación pública en el Perú, recupera el artículo de ley o reglamento, "
                "o el criterio u opinión del OSCE/Tribunal, que la responde")
_MAX_CHARS = 1800     # un artículo corto = un chunk; lo largo se parte con solape
_SOLAPE = 200
_LOTE = 100


def _credenciales() -> tuple[str, str, str]:
    clave = os.getenv("CHROMA_API_KEY", "")
    tenant = os.getenv("CHROMA_TENANT", "")
    if not clave or not tenant:
        try:
            import tomllib
            c = tomllib.load(open(os.path.expanduser("~/.chroma/credentials"), "rb"))
            perfil = c.get(os.getenv("CHROMA_PROFILE", "simplia")) or {}
            clave, tenant = clave or perfil.get("api_key", ""), tenant or perfil.get("tenant_id", "")
        except Exception:
            pass
    if not clave:
        raise RuntimeError("falta CHROMA_API_KEY (o el perfil de `chroma login`)")
    os.environ.setdefault("CHROMA_API_KEY", clave)
    return clave, tenant, os.getenv("CHROMA_DATABASE", "simplia-vect")


def cliente():
    import chromadb
    clave, tenant, db = _credenciales()
    return chromadb.CloudClient(tenant=tenant or None, database=db, api_key=clave)


def _embedding():
    from chromadb.utils.embedding_functions import ChromaCloudQwenEmbeddingFunction as Q
    from chromadb.utils.embedding_functions.chroma_cloud_qwen_embedding_function import (
        ChromaCloudQwenEmbeddingModel as M, ChromaCloudQwenEmbeddingTarget as T)
    return Q(model=M.QWEN3_EMBEDDING_0p6B, task="legal_es",
             instructions={"legal_es": {T.DOCUMENTS: "", T.QUERY: _INSTRUCCION}})


def coleccion(cl, corpus: str, crear: bool = False):
    nombre = PREFIJO + corpus
    if crear:
        return cl.get_or_create_collection(nombre, embedding_function=_embedding(), metadata={"hnsw:space": "cosine"})
    return cl.get_collection(nombre, embedding_function=_embedding())


# ── troceo ────────────────────────────────────────────────────────────────────────────────────────
def partir(texto: str) -> list[str]:
    t = re.sub(r"[ \t]+", " ", texto or "").strip()
    if len(t) <= _MAX_CHARS:
        return [t] if t else []
    out, i = [], 0
    while i < len(t):
        fin = min(len(t), i + _MAX_CHARS)
        if fin < len(t):  # cortar en fin de oración/párrafo si hay uno cerca
            corte = max(t.rfind("\n", i, fin), t.rfind(". ", i, fin))
            if corte > i + _MAX_CHARS // 2:
                fin = corte + 1
        out.append(t[i:fin].strip())
        if fin >= len(t):
            break
        i = max(fin - _SOLAPE, i + 1)
    return [x for x in out if x]


def _meta(ficha: dict, uri: str, chunk: int, pagina=None) -> dict:
    """Solo str/int/float/bool (Chroma no admite None ni anidados)."""
    m = {k: v for k, v in ficha.items() if isinstance(v, (str, int, float, bool)) and k not in ("sha256", "nota", "descargado_at")}
    m["uri"] = uri
    m["chunk"] = chunk
    if pagina is not None:
        m["pagina"] = int(pagina)
    return m


def _texto_pdf(ruta: Path) -> list[tuple[int, str]]:
    import fitz  # PyMuPDF
    with fitz.open(ruta) as doc:
        return [(i + 1, p.get_text("text")) for i, p in enumerate(doc)]


def unidades(origen: Path):
    """Itera (corpus, uri, ficha, [(pagina|None, chunk_texto)]) de cada entrada del catálogo con texto utilizable."""
    cat = json.loads((origen / "catalogo.json").read_text(encoding="utf-8"))
    for uri, ficha in cat.items():
        rel = re.sub(r"^gs://[^/]+/", "", uri)
        ruta = origen / rel
        if not ruta.exists():
            yield ficha.get("corpus"), uri, ficha, None
            continue
        if ruta.suffix == ".txt":
            trozos = [(ficha.get("pagina"), t) for t in partir(ruta.read_text(encoding="utf-8", errors="replace"))]
        elif ruta.suffix == ".pdf":
            trozos = []
            for pag, txt in _texto_pdf(ruta):
                trozos += [(pag, t) for t in partir(txt)]
        else:
            continue
        yield ficha.get("corpus"), uri, ficha, trozos


def _id(uri: str, n: int) -> str:
    return hashlib.sha1(f"{uri}#{n}".encode()).hexdigest()


def _subir(col, ids, docs, metas) -> None:
    for i in range(0, len(ids), _LOTE):
        col.upsert(ids=ids[i:i + _LOTE], documents=docs[i:i + _LOTE], metadatas=metas[i:i + _LOTE])


def construir(origen: str, solo: list[str] | None = None, vaciar: bool = False) -> dict:
    cl = cliente()
    base = Path(origen)
    cols, lotes, resumen, faltan = {}, {}, {}, []
    for corpus, uri, ficha, trozos in unidades(base):
        corpus = corpus or "normas-vigentes"
        if solo and corpus not in solo:
            continue
        if trozos is None:
            faltan.append(uri)
            continue
        if corpus not in cols:
            if vaciar:
                try:
                    cl.delete_collection(PREFIJO + corpus)
                except Exception:
                    pass
            cols[corpus], lotes[corpus] = coleccion(cl, corpus, crear=True), ([], [], [])
        ids, docs, metas = lotes[corpus]
        for n, (pag, t) in enumerate(trozos):
            ids.append(_id(uri, n)); docs.append(t); metas.append(_meta(ficha, uri, n, pag))
        resumen[corpus] = resumen.get(corpus, 0) + len(trozos)
        if len(ids) >= _LOTE:
            _subir(cols[corpus], ids, docs, metas)
            lotes[corpus] = ([], [], [])
            print(f"  {corpus}: {resumen[corpus]} chunks", flush=True)
    for corpus, (ids, docs, metas) in lotes.items():
        if ids:
            _subir(cols[corpus], ids, docs, metas)
    return {"chunks": resumen, "sin_archivo": faltan}


# ── consulta (misma forma que el RAG Engine: ver agent/tools/legal.py) ────────────────────────────
def consultar(pregunta: str, corpus: list[str], top_k: int = 5, cl=None) -> dict[str, list[dict]]:
    """{corpus: [{sourceUri, text, score(distancia coseno), meta}]}"""
    cl = cl or cliente()
    out = {}
    for c in corpus:
        try:
            col = coleccion(cl, c)
        except Exception:
            out[c] = []  # colección aún no construida
            continue
        r = col.query(query_texts=[pregunta], n_results=int(top_k), include=["documents", "metadatas", "distances"])
        out[c] = [{"sourceUri": (m or {}).get("uri", ""), "text": d, "score": dist, "meta": m or {}}
                  for d, m, dist in zip(r["documents"][0], r["metadatas"][0], r["distances"][0])]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sp = ap.add_subparsers(dest="cmd", required=True)
    c = sp.add_parser("construir")
    c.add_argument("--origen", required=True)
    c.add_argument("--solo", nargs="*")
    c.add_argument("--vaciar", action="store_true", help="borra y recrea las colecciones vigia_* indicadas")
    sp.add_parser("estado")
    q = sp.add_parser("consultar")
    q.add_argument("pregunta")
    q.add_argument("--regimen", default="")
    q.add_argument("--top", type=int, default=5)
    a = ap.parse_args()
    if a.cmd == "construir":
        print(json.dumps(construir(a.origen, a.solo, a.vaciar), ensure_ascii=False, indent=1))
    elif a.cmd == "estado":
        cl = cliente()
        for corpus in CORPUS:
            try:
                print(f"{PREFIJO}{corpus}: {coleccion(cl, corpus).count()} chunks")
            except Exception as e:
                print(f"{PREFIJO}{corpus}: no existe ({str(e)[:60]})")
    else:
        r = a.regimen
        nombres = (["normas-historicas"] if "30225" in r else ["normas-vigentes"] if "32069" in r else ["normas-vigentes", "normas-historicas"]) + ["criterios-vinculantes"]
        for c, lst in consultar(a.pregunta, nombres, a.top).items():
            print(f"── {c}")
            for h in lst:
                m = h["meta"]
                print(f"  d={h['score']:.3f} {m.get('numero') or m.get('documento')} art={m.get('articulo')} p={m.get('pagina')} | {h['text'][:110].replace(chr(10), ' ')}")


if __name__ == "__main__":
    sys.exit(main())
