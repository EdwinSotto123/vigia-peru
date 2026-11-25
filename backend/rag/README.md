# RAG normativo

Las normas y criterios que consulta el agente legal (`backend/agent/tools/legal.py`, `query_legal_rag`). Hoy el índice
vive en Chroma Cloud (`chroma_rag.py`, desde el 2026-10-12). Antes vivía en Vertex AI RAG Engine (más abajo, legado).

## Chroma Cloud

- Cuatro colecciones: `vigia_normas-vigentes`, `vigia_normas-historicas`, `vigia_criterios-vinculantes` y
  `vigia_control-cgr`. La base de Chroma la comparten otros proyectos: sólo se tocan las colecciones con prefijo `vigia_`.
- Los embeddings los calcula Chroma Cloud (Qwen3-Embedding-0.6B), con una instrucción de consulta legal en español.
- Cada fragmento lleva en sus metadatos la ficha del catálogo (documento, número, régimen, URL oficial, artículo,
  página), así que la consulta no depende de ningún bucket.
- Credenciales: `CHROMA_API_KEY`, `CHROMA_TENANT` y `CHROMA_DATABASE` (secretos, nunca en el repo).

```bash
python -m backend.rag.chroma_rag construir --origen <copia local de las fuentes> [--solo <corpus>] [--vaciar]
python -m backend.rag.chroma_rag estado
python -m backend.rag.chroma_rag consultar "plazo entre convocatoria y ofertas en licitación pública" --regimen 32069
python -m backend.rag.evaluar --backend chroma --k 5      # 2026-10-12: recall@5 0,93 (68/73), MRR 0,80
```

`construir` lee las fuentes, el `catalogo.json` y el `corpus.json` desde una copia local del bucket de GCS del RAG
(`RAG_BUCKET`). Ojo: desde el 2026-11-06 GCP está sin facturación.

Estado al 2026-10-12: normas-vigentes 4 341 fragmentos, normas-historicas 1 456, criterios-vinculantes 1 006 y
control-cgr 662.

## Cómo lo usa el agente

La Lambda tiene `LEGAL_RAG_BACKEND=chroma` (`infrastructure/deploy/aws/agentes.sh`). Si Chroma falla o no trae nada,
el respaldo es pgvector en la base.

Con `LEGAL_RAG_BACKEND=vigia` (o `normas`), primero pregunta al RAG normativo propio en la base
(`backend/agent/tools/normas_rag.py`, tablas `norma` y `norma_fragmento`, migración 284): filtra por la fecha de la
convocatoria y ordena por jerarquía. Si no trae nada, sigue con Chroma.

## Vertex AI RAG Engine (legado)

`corpus.py`, `_comun.py` y `requirements.txt` (con `google-cloud-aiplatform`) son del índice anterior en RAG Engine,
que sigue en el código con `LEGAL_RAG_BACKEND=rag_engine`. Necesita un proyecto de GCP con facturación, y hoy no lo hay.
Diseño y evaluación: `docs/design/RAG_NORMATIVO.md`.

```bash
python -m backend.rag.corpus config --serverless   # crea el agente de servicio de RAG Engine
python -m backend.rag.corpus crear                 # imprime los RAG_CORPUS_* para los agentes
python -m backend.rag.corpus importar --rpm 60 --no-esperar
python -m backend.rag.corpus estado
```
