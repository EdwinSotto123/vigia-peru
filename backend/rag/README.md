# RAG normativo (Chroma Cloud · antes Vertex RAG Engine)

**Backend actual: Chroma Cloud** (`chroma_rag.py`, 2026-10-12). Colecciones `vigia_<corpus>` en la base `simplia-vect` (compartida con
otros proyectos: solo se tocan las que empiezan con `vigia_`). Embeddings Qwen3-Embedding-0.6B calculados por Chroma Cloud, con una
instrucción de consulta legal en español. Cada chunk lleva en su metadata la ficha del catálogo, así que no depende de GCS.

```bash
gcloud storage cp -r gs://vigia-rag-753067078557 <dir>        # copia local del bucket (hay una en C:/Users/usuario/vigia-respaldo)
python -m backend.rag.chroma_rag construir --origen <dir>/vigia-rag-753067078557 [--solo <corpus>] [--vaciar]
python -m backend.rag.chroma_rag estado
python -m backend.rag.evaluar --backend chroma --k 5          # 2026-10-12: recall@5 0,93 (68/73), MRR 0,80; ~2,8 s por consulta
```

Estado 2026-10-12: normas-vigentes 4.341 chunks · normas-historicas 1.456 · criterios-vinculantes 1.006 · control-cgr 662.
El agente lo usa con `LEGAL_RAG_BACKEND=chroma` (por defecto si hay `CHROMA_API_KEY`; respaldo: pgvector) y `CHROMA_TENANT`/`CHROMA_DATABASE`.
Lo de abajo describe el backend anterior (RAG Engine), que sigue disponible con `LEGAL_RAG_BACKEND=rag_engine`.

# RAG normativo (RAG Engine)

4 corpus serverless con normativa y criterios:

- `normas-vigentes`
- `normas-historicas`
- `criterios-vinculantes`
- `control-cgr`

Las fuentes, `catalogo.json` y `corpus.json` viven en el bucket `RAG_BUCKET`. Diseño y evaluación: `docs/design/RAG_NORMATIVO.md`.

## Cambiar de proyecto

Variables (`_comun.py`); ninguna tiene un proyecto fijo:

| Variable | Valor |
|---|---|
| `VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT` | Sin ellas: el de las credenciales |
| `RAG_BUCKET` | Hoy `vigia-rag-753067078557` |
| `RAG_LOCATION` | `us-central1` |

Pasos (la fase `ia` de `infrastructure/deploy/migracion/migrar-proyecto.sh` los hace todos):

```bash
gcloud storage rsync -r gs://<bucket-viejo> gs://<bucket-nuevo> --exclude "_import/.*"
python infrastructure/deploy/migracion/herramientas.py catalogo-rag --proyecto <p> --bucket-viejo <b> --bucket-nuevo <b2>
export VERTEX_PROJECT=<p> RAG_BUCKET=<b2>
python -m backend.rag.corpus config --serverless   # crea el agente de servicio de RAG Engine
python -m backend.rag.corpus crear                 # imprime los RAG_CORPUS_* para los agentes
python -m backend.rag.corpus importar --rpm 60 --no-esperar
python -m backend.rag.corpus estado                # ~1 h hasta 1.923 de 1.923
```

Requisitos de un proyecto nuevo:

- los agentes de servicio `gcp-sa-vertex-rag` (`roles/aiplatform.ragServiceAgent`) y `gcp-sa-vectorsearch` (`roles/vectorsearch.serviceAgent`);
- escritura del agente del RAG en el bucket, porque deja los resultados del import en `_import/`.

El catálogo guarda las URIs con el nombre del bucket, por eso hay que reescribirlo al copiarlo.
