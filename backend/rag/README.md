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
