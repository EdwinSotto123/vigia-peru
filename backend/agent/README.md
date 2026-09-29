# Agentes (orquestador ADK)

El análisis de cada contrato. Es un mismo código en 4 servicios de Cloud Run, que se distinguen por `PIPELINE_PROFILE`:

| Servicio | Perfil |
|---|---|
| `agent-orchestrator-adk` | bienes |
| `agente-servicios` | servicios |
| `agente-obras` | obras |
| `agente-otros` | consultoría, convenio, directa, otro |

Los llaman el dispatcher y la web de Cloudflare, y el frontend y la API de la entrada. Solo los invocan cuentas con `roles/run.invoker`.

## Desplegar

| Caso | Comando |
|---|---|
| Actualizar el código en el proyecto actual | `bash infrastructure/deploy/agentes.sh [bienes\|servicios\|obras\|otros\|all]` |
| Crear los 4 en un proyecto nuevo | `DOCAI=<id> INVOCADORES="<cuentas>" bash infrastructure/deploy/migracion/migrar-proyecto.sh agentes` |

`agentes.sh` construye la imagen una vez y copia el spec vivo de bienes a los otros tres.

El proyecto nuevo sale de `herramientas.py agentes-yaml`, con la misma configuración de producción: modelos, Flex, límites y secretos.

## Qué depende del proyecto

Todo por variable. El código no tiene ningún proyecto fijo (`tools/_proyecto.py`):

| Variable | Valor |
|---|---|
| `GOOGLE_CLOUD_PROJECT`, `VERTEX_PROJECT` | Proyecto de Vertex AI (Gemini), Document AI, RAG Engine y Vertex AI Search. Sin ellas: el de las credenciales |
| `PGHOST` | `/cloudsql/<proyecto>:us-central1:vigia-db`, o `CLOUD_SQL_CONNECTION` |
| `DOCAI_PROCESSOR_ID` | Id del procesador OCR del proyecto (`terraform output docai_processor_id`) |
| `RAG_BUCKET`, `RAG_CORPUS_*` | Bucket y corpus del RAG (`gs://<RAG_BUCKET>/corpus.json`) |
| Secretos | `cloudsql-password`, `google-api-key`, `phoenix-api-key`, `pinecone-api-key`, `arize-api-key`, `decolecta-api-key`, `local-downloader-token` |

La cuenta `vigia-agentes@<proyecto>` necesita lectura de los buckets de documentos, que hoy están en `vivid-spot-480905-a4`.

## Probar

```bash
python -m pytest backend/agent/tests -q                 # 287 pruebas, sin red
RUN_LIVE=1 python -m pytest backend/agent/tests -m live  # llama a Gemini con tus credenciales (ADC)
```

De punta a punta, contra la base: reanalizar un contrato desde el panel (`POST /v1/admin/procesamientos/<ocid>/reanalizar`) y `POST /ejecutar` en el dispatcher. El análisis se guarda dos veces: primero sin dictamen y, ~50 s después, con dictamen, costo y métricas de Flex.
