# Agentes

El análisis de cada contrato: leen el expediente, cruzan registros, revisan normas y precios, y escriben el dictamen y
las banderas en la base. Es código Python con Google ADK como librería (`requirements.txt`), en un pipeline
determinista (`deterministic.py`, `pipeline_*.py`) que corre cada sub-agente de `agents/` con las herramientas de
`tools/`.

## Dónde corre

En AWS Lambda (us-east-2, arm64), con una imagen de contenedor de `Dockerfile.lambda`: el código detrás del Lambda Web
Adapter, que deja pasar el streaming NDJSON (`?stream=1`). Hay una Lambda por red, con el mismo código y su
`PIPELINE_PROFILE`:

| Lambda | Red |
|---|---|
| `vigia-agente-sdk-v2` | bienes |
| `vigia-agente-servicios` | servicios |
| `vigia-agente-obras` | obras |
| `vigia-agente-consultoria` | consultoría |
| `vigia-agente-directas` | directas y convenios (perfil `otros`) |

Cada una tiene una Function URL pública. La protege el propio agente: exige `Authorization: Bearer <AGENTE_TOKEN>`, y
en Lambda sin ese secreto no atiende a nadie (`main.py`).

## Quién los llama

- **`vigia-dispatcher`** (`backend/dispatcher-worker`), cada 5 minutos: los contratos financiados y los reanálisis del
  panel (la cola `procesamientos`).
- **El análisis masivo** y **los reanálisis en lote**: los jobs `tarea:masivo-agentes` y `tarea:reanalisis` de
  `.gitlab-ci.yml` (`backend/scripts/masivo_agentes.py`, `backend/scripts/reanalizar_contratos.py`), directo a las
  Lambdas y con tope de gasto en la base.
- Las rutas `/api/agent/*` de la web (`frontend/app/api/agent`).

## Modelos

Sólo modelos abiertos de Cloudflare Workers AI, por el Worker `vigia-llm` (`backend/llm-worker`): DeepSeek V4.1 Flash
para casi todo y GLM 5.3 para los agentes de juicio complejo (`WORKERS_AI_MODEL_SMART`). Qué modelo responde cada
pedido lo decide `vigia-llm`. Por ejemplo, `agentes.sh` todavía pone por defecto GLM 5.3 Flash en `WORKERS_AI_MODEL`; Workers AI lo
retiró el 2026-11-20 y `vigia-llm` lo responde con DeepSeek V4.1 Flash (`MODELOS_RETIRADOS`).

`MOTOR_AGENTES` elige quién conversa con el modelo (`motores/`): `adk` (por defecto) u otro SDK de agentes (`sdk`). En
los dos casos el pedido va a `vigia-llm`.

## De qué depende

Lo pone `infrastructure/deploy/aws/agentes.sh` en la configuración de cada Lambda. Los secretos salen de SSM y nunca se
imprimen.

| Variable | Para qué |
|---|---|
| `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=verify-full` | la base (RDS) por la VPC, con la CA de RDS que va en la imagen. Rol `vigia_agentes` (escribe) o `vigia_ab` (sólo lectura, para evaluar) |
| `PIPELINE_PROFILE` | la red de la Lambda |
| `USAR_WORKERS_AI`, `WORKERS_AI_URL`, `WORKERS_AI_TOKEN`, `WORKERS_AI_MODEL`, `WORKERS_AI_MODEL_SMART` | el modelo, por `vigia-llm` |
| `ALMACEN_DOCS=r2`, `R2_LECTOR_URL`, `R2_LECTOR_TOKEN` | los documentos, desde R2 por `vigia-r2-sync` |
| `OCR_URL`, `OCR_TOKEN` | el OCR abierto (`vigia-ocr`), si su token está en SSM |
| `PRECIOS_URL`, `PRECIOS_TOKEN` | precios de referencia (`vigia-precios`) |
| `LEGAL_RAG_BACKEND=chroma`, `CHROMA_API_KEY`, `CHROMA_DATABASE` | el RAG normativo (`backend/rag`) |
| `BUSQUEDA_WEB=propia`, `BUSQUEDA_PROVEEDOR` | búsqueda web gratis y sin claves (`tools/busqueda_libre.py`) |
| `AGENTE_TOKEN` | el Bearer que exige la Function URL |
| `OECE_EN_VIVO=0` | el OECE responde 403 desde AWS: el perfil del proveedor sale de la base |

`GOOGLE_CLOUD_PROJECT=no-gcp`: nada de Vertex AI ni de Document AI.

## Probar

```bash
python -m pytest backend/agent/tests -q      # sin red
```

Las pruebas marcadas `live` (`RUN_LIVE=1`) son de cuando el modelo era Gemini en Vertex AI: hoy no aplican.

De punta a punta contra la base: reanalizar un contrato desde el panel (`POST /v1/admin/procesamientos/<ocid>/reanalizar`)
lo encola, y el dispatcher lo toma en su siguiente corrida.

## Desplegar

En GitLab, desde `main` (`.gitlab-ci.yml`), sin llaves: el job pide un token OIDC y asume un rol de AWS.

1. `build:agente`: toma la imagen base de ECR (`AGENTE_BASE`, con las dependencias ya instaladas) y le agrega una capa
   con `backend/agent` (`crane append`, sin Docker). Corre solo con cada push a `main` que cambia `backend/agent`; si
   no, es manual.
2. `deploy:agentes:prod` (manual): pone esa imagen en las cinco Lambdas y la etiqueta `prod-<sha>`, para que la regla
   de ciclo de vida de ECR no la borre.

Si cambia `requirements.txt`, hay que rehacer la imagen base con `Dockerfile.lambda` y subir `AGENTE_BASE`.

La configuración de cada Lambda (variables, memoria, plazo y Function URL) se crea o se cambia con
`bash infrastructure/deploy/aws/agentes.sh <tag>` (`ROL=agentes` para producción; `FUNCION` y `PERFIL` para otra red).

## Lo que queda de Google Cloud

Los agentes corrían antes en Cloud Run con Gemini. Quedan en el código `Dockerfile`, `Procfile`, Document AI
(`tools/docai.py`), RAG Engine y Vertex AI Search (`tools/legal.py`) y la instrumentación de Arize
(`arize_observability.py`). La configuración que pone `agentes.sh` no los activa.
