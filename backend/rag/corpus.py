"""Gestión de los corpus de Vertex AI RAG Engine (modo serverless) del RAG normativo.

Subcomandos:
    python -m backend.rag.corpus config                 # modo del proyecto (serverless | spanner basic/scaled)
    python -m backend.rag.corpus config --serverless    # cambia el proyecto a modo serverless (sin costo fijo)
    python -m backend.rag.corpus crear [--corpus X]     # crea los corpus que falten (embedding gemini-embedding-001)
    python -m backend.rag.corpus importar [--corpus X]  # import_files desde gs://vigia-peru-rag/<corpus>/ según catalogo.json
    python -m backend.rag.corpus listar                 # corpus + nº de archivos
    python -m backend.rag.corpus estado                 # detalle: archivos por corpus, resource names, catálogo
    python -m backend.rag.corpus borrar --corpus X --si # borra un corpus (pide --si)

Los resource names quedan en gs://vigia-peru-rag/corpus.json y se imprimen como variables
RAG_CORPUS_* listas para `gcloud run services update --update-env-vars`.

Chunking: 512 tokens / solape 100 (los artículos ya vienen segmentados: un archivo por artículo;
los PDF enteros —bases estándar, acuerdos, opiniones, manuales— se trocean por tokens).
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import requests

from ._comun import (BUCKET, CATALOGO_BLOB, CORPUS, CORPUS_ESTADO_BLOB, EMBEDDING_MODEL, LOCATION, PROJECT,
                     escribir_json_gcs, gcs_uri, leer_json_gcs, rag_api, token_acceso)

CHUNK_SIZE = 512
CHUNK_OVERLAP = 100
ENV_POR_CORPUS = {
    "normas-vigentes": "RAG_CORPUS_NORMAS_VIGENTES",
    "normas-historicas": "RAG_CORPUS_NORMAS_HISTORICAS",
    "criterios-vinculantes": "RAG_CORPUS_CRITERIOS",
    "control-cgr": "RAG_CORPUS_CONTROL",
}


def _init():
    import vertexai
    vertexai.init(project=PROJECT, location=LOCATION)
    from vertexai import rag  # GA (muestra aviso de deprecación hacia `agentplatform`, que aún no expone RAG)
    return rag


def _hdr():
    return {"Authorization": f"Bearer {token_acceso()}", "Content-Type": "application/json"}


# ── config del proyecto (modo serverless / spanner) ─────────────────────────
def cmd_config(args) -> int:
    url = f"{rag_api('v1beta1')}/ragEngineConfig"
    if args.serverless:
        body = {"name": f"projects/{PROJECT}/locations/{LOCATION}/ragEngineConfig",
                "ragManagedDbConfig": {"serverless": {}}}
        r = requests.patch(url, headers=_hdr(), json=body, timeout=60)
        print(json.dumps(r.json(), indent=1))
        return 0 if r.ok else 1
    r = requests.get(url, headers=_hdr(), timeout=60)
    cfg = r.json()
    modo = "serverless" if "serverless" in (cfg.get("ragManagedDbConfig") or {}) else "spanner"
    print(f"modo RAG Engine del proyecto {PROJECT}/{LOCATION}: {modo}")
    print(json.dumps(cfg, indent=1))
    if modo != "serverless":
        print("AVISO: el modo Spanner (tier Basic) factura una instancia Spanner de 100 PU por hora. "
              "Usá `config --serverless` antes de crear corpus.", file=sys.stderr)
    return 0


# ── corpus ──────────────────────────────────────────────────────────────────
def _corpus_existentes(rag) -> dict[str, object]:
    return {c.display_name: c for c in rag.list_corpora()}


def _guardar_estado(rag) -> dict:
    est = {}
    for nombre, c in _corpus_existentes(rag).items():
        if nombre in CORPUS:
            est[nombre] = {"resource_name": c.name, "env": ENV_POR_CORPUS[nombre]}
    escribir_json_gcs(CORPUS_ESTADO_BLOB, est)
    return est


def cmd_crear(args) -> int:
    rag = _init()
    existentes = _corpus_existentes(rag)
    objetivo = [args.corpus] if args.corpus else list(CORPUS)
    for nombre in objetivo:
        if nombre in existentes:
            print(f"  = {nombre}: ya existe ({existentes[nombre].name})")
            continue
        emb = rag.RagEmbeddingModelConfig(
            vertex_prediction_endpoint=rag.VertexPredictionEndpoint(
                publisher_model=f"publishers/google/models/{EMBEDDING_MODEL}"))
        c = rag.create_corpus(
            display_name=nombre,
            description=f"Vigía Perú · RAG normativo · {nombre}",
            backend_config=rag.RagVectorDbConfig(rag_embedding_model_config=emb),
        )
        print(f"  + {nombre}: {c.name}")
    est = _guardar_estado(rag)
    _imprimir_env(est)
    return 0


def _imprimir_env(est: dict) -> None:
    print("\nVariables para Cloud Run (--update-env-vars):")
    pares = [f"{v['env']}={v['resource_name']}" for v in est.values()]
    print("  " + ",".join(pares))


def _uris_a_importar(catalogo: dict, corpus: str) -> list[str]:
    """Del catálogo: artículos y opiniones (.txt) + PDF marcados importar_pdf (no segmentados)."""
    out = []
    for uri, meta in catalogo.items():
        if meta.get("corpus") != corpus:
            continue
        if uri.endswith(".txt") or meta.get("importar_pdf"):
            out.append(uri)
    return sorted(out)


def _paths_import(uris: list[str]) -> list[str]:
    """RAG Engine acepta ≤ 25 URIs explícitas por ImportRagFiles: los .txt (artículos, opiniones)
    se importan por DIRECTORIO (gs://…/<corpus>/<slug>/ o …/opiniones/) y los PDF uno a uno."""
    dirs, files = set(), []
    for u in uris:
        if u.endswith(".txt"):
            dirs.add(u.rsplit("/", 1)[0] + "/")
        else:
            files.append(u)
    return sorted(dirs) + files


def _lotes(paths: list[str], n: int = 25):
    for i in range(0, len(paths), n):
        yield paths[i:i + n]


def cmd_importar(args) -> int:
    rag = _init()
    existentes = _corpus_existentes(rag)
    catalogo = leer_json_gcs(CATALOGO_BLOB, default={}) or {}
    if not catalogo:
        print("catálogo vacío: corré descargar.py / segmentar.py / opiniones.py primero", file=sys.stderr)
        return 1
    objetivo = [args.corpus] if args.corpus else list(CORPUS)
    tc = rag.TransformationConfig(chunking_config=rag.ChunkingConfig(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP))
    rc = 0
    for nombre in objetivo:
        c = existentes.get(nombre)
        if not c:
            print(f"  ✗ {nombre}: no existe (corré `crear`)", file=sys.stderr)
            rc = 1
            continue
        uris = _uris_a_importar(catalogo, nombre)
        if not uris:
            print(f"  · {nombre}: nada que importar")
            continue
        paths = _paths_import(uris)
        print(f"  → {nombre}: importando {len(uris)} archivos vía {len(paths)} rutas "
              f"(chunk {CHUNK_SIZE}/{CHUNK_OVERLAP})…")
        for i, lote in enumerate(_lotes(paths)):
            t0 = time.time()
            sink = f"gs://{BUCKET}/_import/{nombre}-{time.strftime('%Y%m%d-%H%M%S')}-{i}.ndjson"
            if args.no_esperar:
                # Lanza la operación (LRO del lado del servidor) y sigue: útil cuando la cuota de
                # embeddings hace que un import tarde horas. Estado: `corpus.py estado` / `listar`.
                op = _import_async(c.name, lote, int(args.rpm), sink)
                print(f"     lote de {len(lote)} rutas lanzado: {op}")
                continue
            # RAG Engine deduplica por gcs uri: re-importar es idempotente (los ya cargados se saltan).
            resp = rag.import_files(corpus_name=c.name, paths=lote, transformation_config=tc,
                                    max_embedding_requests_per_min=int(args.rpm), timeout=3600,
                                    import_result_sink=sink)
            print(f"     lote de {len(lote)} rutas: importados={resp.imported_rag_files_count} "
                  f"saltados={resp.skipped_rag_files_count} fallidos={resp.failed_rag_files_count} "
                  f"en {time.time()-t0:.0f}s")
            if resp.failed_rag_files_count:
                rc = 1
                _resumen_errores(sink)
    _guardar_estado(rag)
    return rc


def _import_async(corpus_name: str, paths: list[str], rpm: int, sink: str) -> str:
    """POST ragFiles:import (REST v1) sin esperar la operación. Devuelve el nombre de la LRO."""
    body = {"importRagFilesConfig": {
        "gcsSource": {"uris": paths},
        "ragFileTransformationConfig": {"ragFileChunkingConfig": {"fixedLengthChunking": {
            "chunkSize": CHUNK_SIZE, "chunkOverlap": CHUNK_OVERLAP}}},
        "maxEmbeddingRequestsPerMin": rpm,
        "importResultGcsSink": {"outputUriPrefix": sink},
    }}
    url = f"https://{LOCATION}-aiplatform.googleapis.com/v1/{corpus_name}/ragFiles:import"
    r = requests.post(url, headers=_hdr(), json=body, timeout=120)
    if r.status_code >= 300:
        raise RuntimeError(f"import HTTP {r.status_code}: {r.text[:300]}")
    return r.json().get("name", "?")


def _resumen_errores(sink: str, max_lineas: int = 5) -> None:
    """Lee el import_result_sink (NDJSON en GCS) y agrupa los motivos de fallo."""
    try:
        from google.cloud import storage
        bucket, prefijo = sink[5:].split("/", 1)
        client = storage.Client(project=PROJECT)
        motivos: dict[str, int] = {}
        ejemplos: dict[str, str] = {}
        for blob in client.list_blobs(bucket, prefix=prefijo):
            for ln in blob.download_as_text(encoding="utf-8").splitlines():
                try:
                    d = json.loads(ln)
                except Exception:
                    continue
                if d.get("status") == "SUCCESS" or not d.get("error") and d.get("status") in ("SUCCESS", "SKIPPED"):
                    continue
                err = d.get("error") or d.get("status") or "?"
                clave = str(err)[:160]
                motivos[clave] = motivos.get(clave, 0) + 1
                ejemplos.setdefault(clave, d.get("fileUri") or d.get("file_uri") or d.get("source") or "")
        for clave, n in sorted(motivos.items(), key=lambda kv: -kv[1])[:max_lineas]:
            print(f"     ✗ {n}× {clave}  (p. ej. {ejemplos[clave]})")
        print(f"     detalle: {sink}")
    except Exception as e:
        print(f"     (no se pudo leer el sink {sink}: {str(e)[:120]})")


def cmd_listar(args) -> int:
    rag = _init()
    for c in rag.list_corpora():
        n = sum(1 for _ in rag.list_files(corpus_name=c.name))
        print(f"  {c.display_name:24s} {n:5d} archivos  {c.name}")
    return 0


def cmd_estado(args) -> int:
    rag = _init()
    catalogo = leer_json_gcs(CATALOGO_BLOB, default={}) or {}
    est = _guardar_estado(rag)
    print(f"modo: ", end="")
    cfg = requests.get(f"{rag_api('v1beta1')}/ragEngineConfig", headers=_hdr(), timeout=60).json()
    print("serverless" if "serverless" in (cfg.get("ragManagedDbConfig") or {}) else "spanner")
    for nombre in CORPUS:
        v = est.get(nombre)
        if not v:
            print(f"  {nombre}: (no creado)")
            continue
        archivos = list(rag.list_files(corpus_name=v["resource_name"]))
        en_cat = _uris_a_importar(catalogo, nombre)
        por_tipo: dict[str, int] = {}
        for uri in en_cat:
            t = catalogo[uri].get("tipo") or "?"
            por_tipo[t] = por_tipo.get(t, 0) + 1
        print(f"  {nombre}: {len(archivos)} archivos en RAG Engine / {len(en_cat)} en catálogo "
              f"{por_tipo}\n     {v['resource_name']}")
    print(f"  catálogo total: {len(catalogo)} entradas (gs://{BUCKET}/{CATALOGO_BLOB})")
    _imprimir_env(est)
    return 0


def cmd_borrar(args) -> int:
    if not args.si:
        print("agregá --si para confirmar", file=sys.stderr)
        return 2
    rag = _init()
    c = _corpus_existentes(rag).get(args.corpus)
    if not c:
        print(f"no existe {args.corpus}")
        return 1
    rag.delete_corpus(corpus_name=c.name)
    print(f"borrado {args.corpus} ({c.name})")
    _guardar_estado(rag)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("config"); p.add_argument("--serverless", action="store_true"); p.set_defaults(fn=cmd_config)
    p = sub.add_parser("crear"); p.add_argument("--corpus", choices=CORPUS); p.set_defaults(fn=cmd_crear)
    p = sub.add_parser("importar"); p.add_argument("--corpus", choices=CORPUS)
    p.add_argument("--rpm", default=5, help="max_embedding_requests_per_min (cuota efectiva del proyecto: 5)")
    p.add_argument("--no-esperar", action="store_true", help="lanza la LRO y no espera (imports de horas)")
    p.set_defaults(fn=cmd_importar)
    p = sub.add_parser("listar"); p.set_defaults(fn=cmd_listar)
    p = sub.add_parser("estado"); p.set_defaults(fn=cmd_estado)
    p = sub.add_parser("borrar"); p.add_argument("--corpus", required=True, choices=CORPUS)
    p.add_argument("--si", action="store_true"); p.set_defaults(fn=cmd_borrar)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
