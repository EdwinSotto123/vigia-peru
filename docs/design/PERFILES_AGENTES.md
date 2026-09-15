# Perfiles de agentes por tipo de contratación · modelos 3.6 · cuatro servicios

Fecha: 2026-09-15 · Workstream P del plan `docs/superpowers/plans/2026-09-15-orquestador-por-tipo.md` ·
Base: `docs/design/AUDITORIA_ORQUESTADOR.md` (§3.3 tiers, §4.2 qué cambia por tipo, §4.3 separación en servicios, §6.3/6.4).

## 1. Un código, cuatro servicios

`backend/agent/` es una sola base de código. La variable `PIPELINE_PROFILE` (leída en
`agents/_shared/profiles.py`) decide qué hace cada servicio:

| Perfil | Servicio Cloud Run | Tipos (`clasificacion.tipo`) | Agentes | Parser (D) | Mercado (M) | Legal (M) | Reglas extra (V) | Topes UIT |
|---|---|---|---|---|---|---|---|---|
| `bienes` | `agent-orchestrator-adk` (histórico) | `bienes` | los 10 | base | `goods_retail` | `bienes` | `fraccionamiento` | LP/CP 400 · AS 8–400 |
| `servicios` | `agente-servicios` | `servicios` | los 10 (market = histórico SEACE, no retail) | + `servicio` | `historico_seace` | `servicios` | `personal_clave_vinculado`, `fraccionamiento` | LP/CP 400 · AS 8–400 |
| `obras` | `agente-obras` | `obras` | los 10 | + `obra` | `presupuesto_obra` | `obras` | `adicional_acumulado`, `consorcio_recurrente` | LP 1 800 · AS 8–1 800 |
| `otros` | `agente-otros` | `consultoria`, `convenio`, `directa`, `otro` | compliance · document_parser · legal · market · web · news · person_network · report_writer | + `sustento_directa` | `cotizaciones` | `otros` | `fraccionamiento`, `directa_recurrente` | CP 400 · AS 8–400 |

Todos: `parse_max_docs = 12`, `doc_prioridad` por perfil (bienes: Bases integradas > Bases > EETT >
Acta/Cuadro comparativo > Contrato/Orden > Adendas > Absolución; servicios: TDR > Bases integradas > …;
obras: Expediente técnico > Presupuesto > Bases > Contrato > Adendas/adicionales > Valorizaciones;
otros: Informe técnico-legal > Acto resolutivo > Cotizaciones > Contrato) y sección fija del dictamen
"Recortes y datos no verificables".

Interfaz (`Profile`, `get_profile()`, `acepta(profile, tipo)`, `perfil_para_tipo(tipo)`,
`Profile.as_state()`) — es la del plan; no cambiar campos sin coordinar con D/V/M.

### Qué hace el driver (`deterministic.py`) con el perfil

1. `state["perfil"] = profile.as_state()`, `state["reglas_activas"]`, `state["topes_uit"]` (V las lee),
   `state["recortes"] = []`, `state["descartes"] = []`. Evento `phase perfil` con agentes activos y estrategia.
2. `permitido(state, agente, profile)` = intersección de la matriz tipo × etapa (`agentes_permitidos`) con
   `profile.agentes`. Los omitidos emiten `phase <agente> omitido: no aplica al perfil …` / `… a tipo/etapa`.
3. Documentos: `tools.doc_select.seleccionar_documentos(ocid, ocds, doc_urls, prioridad, max_docs, doc_ids=…)`
   (D) → `recorte_seleccion(elegidos, omitidos, max_docs)` a `recortes` →
   `tools.documentos.parse_documentos_lote(state, elegidos, parser_bloque=…, prioridad=…)` (D), que escribe
   `parser_raw_consolidated` (con `bloque_servicio|bloque_obra|bloque_sustento_directa`), `documentos_texto`,
   `document_analysis`, `estudio_mercado`, `contrato_final` y `recortes`. Si el lote produjo extracción, la fase
   termina ahí **sin LLM** (evento `info`); si no (lote vacío / D ausente), corre el `document_parser_agent`,
   cuya primera tool es ahora `parse_documentos_seleccionados` (una sola llamada; `list_documents` +
   `parse_document_pdf` quedan como legacy).
4. Mercado: `tools.market.analizar_mercado(state, profile.market_estrategia)` (M) con fallback al fan-out
   retail (`build_market_input` + `analyze_market_sharded`).
5. Compliance extendido: si el perfil incluye el agente, corre como antes; si NO (perfil `otros`), las reglas
   activas del perfil corren **en código, sin LLM** (`tools.compliance_rules.REGLAS_POR_NOMBRE`, fase
   `compliance_rules`). `evaluate_normative_compliance` y `persist_alert_from_flags` siempre en el driver.
6. Validación pydantic de `legal_analysis`, `web_research`, `news_research`, `entity_personnel`,
   `person_network` con `agents/_shared/schemas.py` (M): si no valida, la salida se conserva (no se pierde
   información) pero queda en `descartes` y se emite `warn`.
7. Dictamen: mensaje con `dictamen_secciones` del perfil, bloque de validaciones pendientes y bloque
   "Recortes y datos no verificables" (recortes + descartes, máx. 25 líneas y conteo del resto); dictamen
   breve para desierta/cancelada/nula y para directa/convenio. Tras el dictamen,
   `tools.verify.verificar_dictamen` (V) → `state["verificacion_dictamen"]` + `warn` si degradado.
8. `main.py`: gate 409 `tipo_no_aceptado` (JSON, o línea NDJSON `error` con `?stream=1`); `GET /` sin
   `action` → `{ok, perfil, tipos_aceptados, agentes, market_estrategia, modelos, deterministic}`;
   `doc_ids` del body → `state["doc_ids"]`; tras la self-eval, `tools.self_eval.debe_bloquear(evals)` (V)
   → `UPDATE alertas SET estado='revision'` + `warn` `alerta … en REVISIÓN`. La API pública
   (`backend/api/src/routes/alertas.ts`: `GET /alertas` y `GET /alertas/analizadas`) excluye
   `estado = 'revision'`; el detalle por id/código sigue accesible (revisión en admin).

## 2. Modelos

Verificado 2026-09-15 en Vertex AI global (`vivid-spot-480905-a4`): `gemini-3.6-flash`, `gemini-3.5-flash`,
`gemini-3.5-flash-lite`, `gemini-2.5-*` responden; `gemini-3.6-pro`, `gemini-3.5-pro`,
`gemini-3.6-flash-lite` **no existen** (404).

| Tier (env) | Default | Agentes | Thinking |
|---|---|---|---|
| `GEMINI_MODEL_SMART` | `gemini-3.6-flash` | document_legal_analyst, person_network, report_writer | `high` |
| `GEMINI_MODEL` | `gemini-3.6-flash` | orchestrator, compliance, document_parser, market_price, web/news/entity, compliance_extended (ya no flash-lite: emite juicio) | `low` (market_price `medium`) |
| `GEMINI_MODEL_FAST` | `gemini-3.5-flash-lite` | `sanitize_items_with_llm` y decisiones mecánicas (tools) | — |
| `GEMINI_MODEL_JUDGE` | `gemini-3.5-flash` | jueces de la self-eval (`tools/self_eval.py` importa `_MODEL_JUDGE`); ≠ generador | — |

- Thinking por agente: `config.THINKING` → `planner=BuiltInPlanner(ThinkingConfig(thinking_level=…,
  include_thoughts=False))` (`agents/_shared/models.build_planner`). Override por env `THINKING_<AGENTE>`
  (`none` desactiva). En modelos 2.5 se mapea a `thinking_budget` (minimal 0 / low 1024 / medium 4096 / high 16384).
- `generate_content_config` solo con `temperature`/`max_output_tokens` (`TEMPERATURE_<AGENTE>`,
  `MAX_OUTPUT_TOKENS_<AGENTE>`); ADK 1.19 rechaza `thinking_config`, `tools` y `response_schema` ahí.
  Por defecto no se fija temperatura (Gemini 3 recomienda el default).
- `output_schema` nativo: **apagado por defecto** (`OUTPUT_SCHEMA_NATIVO=0`), ver §3.2. Cada `config.py` declara
  `OUTPUT_SCHEMA = "<Clase de schemas.py>"` y el driver valida con pydantic.
- Fallback (`model_fallback.py`): `3.6-flash → [3.5-flash, 2.5-flash]`, `3.5-flash-lite → [2.5-flash-lite,
  3.5-flash]`, y cadenas 2.5 apuntando a 3.x. **Una sola capa** de reintentos con techo total por llamada
  `GEMINI_CALL_DEADLINE_S` (default 600 s): si la próxima espera excedería el techo, se propaga el último error.
- Tarifas (`deterministic._rate_for_model`, USD/1M; `main._rate_for_agent_name` resuelve el modelo real
  del agente). `thoughts_token_count` se suma a la salida y a `llm_metrics.tokens_thoughts`.
  Lista pública consultada 2026-09-15 **[verificar]** contra `cloud.google.com/vertex-ai/generative-ai/pricing`:
  3.6-flash 0.75 / 3.75 (tarifa introductoria hasta 2026-12-31; lista 1.50 / 7.50) · 3.5-flash 1.50 / 9.00 ·
  3.5-flash-lite 0.30 / 2.50 · 2.5-flash 0.30 / 2.50 · 2.5-flash-lite 0.10 / 0.40 · 2.5-pro 1.25 / 10.00.
- `requirements.txt`: `google-adk==1.19.0`, `google-genai==1.52.0` (versiones instaladas y probadas); `openpyxl>=3.1` y `antiword` (Dockerfile) para D.

## 3. Smoke test live (`backend/agent/tests/test_live_gemini36.py`)

Comando (2026-09-15, ADC de gcloud, Vertex global):

```
RUN_LIVE=1 GOOGLE_GENAI_USE_VERTEXAI=1 GOOGLE_CLOUD_LOCATION=global GOOGLE_CLOUD_PROJECT=vivid-spot-480905-a4 \
PGHOST=34.71.244.66 PGPASSWORD=… python -m pytest backend/agent/tests -m live -q -s
```

Resultado:

```
LIVE[thinking_level=minimal] ok 3.2s thoughts=None out=7 text='La capital de Perú es Lima.'
LIVE[thinking_level=low] ok 3.6s thoughts=86 out=7 text='La capital de Perú es Lima.'
LIVE[thinking_level=medium] ok 7.0s thoughts=164 out=7 text='La capital de Perú es Lima.'
LIVE[thinking_level=high] ok 4.9s thoughts=145 out=7 text='La capital de Perú es Lima.'
LIVE[schema=False+google_search] 10.3s grounding_chunks=5 queries=2 json_valido=None
LIVE[schema=True+google_search] 3.6s grounding_chunks=0 queries=1 json_valido=True
LIVE[schema+grounding] NOTA: grounding_chunks=0 con response_schema → mantener 'JSON en texto + validación pydantic en el driver' (models.OUTPUT_SCHEMA_NATIVO=0)
LIVE[2 tools + thinking en ADK] 15.2s function_calls=2 parts_con_thought_signature=3 orden=['buscar_ruc', 'sanciones_por_ruc'] final='El RUC de <EMPRESA DE PRUEBA> S.A.C. es 20100000001 y no cuenta con sanciones vi'
LIVE[parser temp=None] 4.5s items=1 firmantes=1 thoughts=None doc=1248010:gs://vigia-peru-batch/batch/documentos/10/1248010/1f8b4b56.pdf
LIVE[parser temp=0.0] 2.0s items=1 firmantes=1 thoughts=None doc=1248010:gs://vigia-peru-batch/batch/documentos/10/1248010/1f8b4b56.pdf
LIVE[parser] items default=1 cero=1 coincidencias_exactas=1
8 passed, 76 deselected, 4 warnings in 69.04s
```

### 3.1 Qué acepta `gemini-3.6-flash`

- `thinking_level`: **minimal, low, medium y high** aceptados (google-genai 1.52 solo tipa LOW/HIGH; los otros
  pasan como string y el API los honra). `minimal` no reporta `thoughts_token_count`; low/medium/high sí
  (86 / 164 / 145 tokens en la pregunta trivial). `thinking_budget=1024` también funciona (exploración previa).
- `temperature=0.0` funciona (la exploración previa mostró latencia mucho mayor en una llamada trivial: 17 s vs 2–5 s).
- Thought signatures: un `LlmAgent` de ADK 1.19 con `planner` (thinking low) y **2 tools encadenadas** ejecuta
  ambas en orden y responde sin 400; los `Part` llegan con `thought_signature` (3 parts). La restricción
  "una sola tool en el report_writer" ya no es necesaria por este motivo (se conserva por diseño: el writer
  sintetiza, no investiga).
- Parser con `temperature` default vs 0.0: mismos ítems y firmantes sobre el PDF de `1248010`
  (`Archivos del contrato`, 2 páginas). Se deja `PARSER_TEMPERATURE` (D) sin fijar por defecto.

### 3.2 Hallazgo que cambia el plan: `response_schema` + `google_search`

En 3.6-flash (y 3.5-flash) la llamada con `response_schema` **y** `google_search` devuelve JSON válido y
`web_search_queries`, pero `grounding_metadata.grounding_chunks` viene **vacío** (0/3 corridas en la
exploración, 0/1 en el test; sin schema: 3–5 chunks). En 2.5-flash la combinación directamente falla con
400 `controlled generation is not supported with Search tool`. Consecuencia: con schema nativo las URLs del
JSON las escribe el modelo y **no se pueden verificar contra `grounding_chunks`** (justo la fuente de URLs
que exige M para el mercado).

Decisión (distinta al plan P2): **no** se enchufa `output_schema` nativo en los agentes con `google_search`
(market_price, web_research, news_research, entity_personnel, person_network) ni, por uniformidad, en legal.
Patrón vigente: JSON en texto + validación pydantic en el driver (`deterministic._validar_schema`) con los
schemas de M. `OUTPUT_SCHEMA_NATIVO=1` lo activa para todos si en el futuro Vertex devuelve chunks con schema.
Además ADK, con `output_schema`, hace `model_validate_json` sobre la respuesta final y **lanza** si no valida
(el output del agente se perdería), otro motivo para validar en el driver y conservar la salida.

## 4. Dispatcher

`backend/dispatcher/main.py`: `url_para(tipo)` → `AGENT_URL_<PERFIL>`; `AGENT_URL` es fallback **solo**
para bienes y para contratos sin clasificación. Sin URL para el tipo → `dejar_pendiente(ocid, "servicio de
agentes para <tipo> no desplegado …")`. Un `409 tipo_no_aceptado` del servicio (URLs cruzadas) también deja
pendiente sin consumir intento. Log del servicio elegido por contrato. Tests: `backend/dispatcher/tests/test_routing.py`.
`infrastructure/deploy/dispatcher.sh` y el paso `dispatcher` de `cloudbuild.yaml` leen las 4 URLs de los
servicios desplegados (vacía si no existe).

## 5. Despliegue (`infrastructure/deploy/agentes.sh [bienes|servicios|obras|otros|all]`)

1. Imagen única: `gcloud builds submit backend/agent --tag
   us-central1-docker.pkg.dev/vivid-spot-480905-a4/cloud-run-source-deploy/agentes:<sha>` (repositorio ya
   existente; se crea si falta). Árbol sucio → sufijo con hora.
2. `bienes`: `gcloud run services update agent-orchestrator-adk --image … --update-env-vars
   PIPELINE_PROFILE=bienes,GEMINI_MODEL=gemini-3.6-flash,GEMINI_MODEL_SMART=gemini-3.6-flash,
   GEMINI_MODEL_FAST=gemini-3.5-flash-lite,GEMINI_MODEL_JUDGE=gemini-3.5-flash` (**nunca** `--set-env-vars`).
3. `servicios/obras/otros`: `describe --format yaml` del de bienes → se quitan `status`,
   `metadata.{uid,resourceVersion,generation,creationTimestamp,selfLink}`, anotaciones de build/cliente/
   operación, labels `goog-*cloudfunctions*`/`goog-managed-by` → nombre `agente-<perfil>`, imagen,
   `PIPELINE_PROFILE` y modelos → `gcloud run services replace` + `add-iam-policy-binding allUsers
   roles/run.invoker`. Heredan las ~34 variables, 4 secretos, Cloud SQL, 8Gi/2 CPU/3600 s/concurrency 1.
4. Verifica `GET /` de cada uno (`"perfil": "<perfil>"`).

Terraform (`infrastructure/terraform/cloud_run.tf`): recurso `agente_perfil` con `for_each` sobre
servicios/obras/otros, misma forma que `agent`, `ignore_changes` en image/env (el spec vivo lo gestiona
`agentes.sh`); modelos 3.6 en `local.agent_model_env`; IAM pública para los 4; output `agente_urls`.
`cloudbuild.yaml`: paso `agentes` opcional (`_DEPLOY` incluye `agentes`).

### 5.1 Resultado del despliegue 2026-09-15

`bash infrastructure/deploy/agentes.sh all` → build `agentes:17abfdf66ffd-083851` (2m49s), EXIT=0; los tres
servicios nuevos heredaron 36 variables (34 + `PIPELINE_PROFILE` + `GEMINI_MODEL_JUDGE`) y los 4 secretos.

| Servicio | URL | `GET /` |
|---|---|---|
| `agent-orchestrator-adk` | https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app | `{"ok": true, "perfil": "bienes", "tipos_aceptados": ["bienes"], "market_estrategia": "goods_retail", "modelos": {"smart": "gemini-3.6-flash", "default": "gemini-3.6-flash", "fast": "gemini-3.5-flash-lite", "judge": "gemini-3.5-flash", "output_schema_nativo": false}, "deterministic": true}` |
| `agente-servicios` | https://agente-servicios-oq3gq6a4ka-uc.a.run.app | `{"ok": true, "perfil": "servicios", "tipos_aceptados": ["servicios"], "market_estrategia": "historico_seace", …}` |
| `agente-obras` | https://agente-obras-oq3gq6a4ka-uc.a.run.app | `{"ok": true, "perfil": "obras", "tipos_aceptados": ["obras"], "market_estrategia": "presupuesto_obra", …}` |
| `agente-otros` | https://agente-otros-oq3gq6a4ka-uc.a.run.app | `{"ok": true, "perfil": "otros", "tipos_aceptados": ["consultoria", "convenio", "directa", "otro"], "market_estrategia": "cotizaciones", …}` |

Gate verificado: `POST agente-obras` con `clasificacion.tipo=bienes` → HTTP 409. Env de bienes tras el
update: `PIPELINE_PROFILE=bienes`, `GEMINI_MODEL=gemini-3.6-flash`, `GEMINI_MODEL_SMART=gemini-3.6-flash`,
`GEMINI_MODEL_FAST=gemini-3.5-flash-lite`, `GEMINI_MODEL_JUDGE=gemini-3.5-flash`, `DETERMINISTIC_PIPELINE=1`.

`bash infrastructure/deploy/dispatcher.sh` → job `vigia-dispatcher` con `AGENT_URL_BIENES/SERVICIOS/OBRAS/OTROS`
apuntando a las 4 URLs de arriba (+ `AGENT_URL` = bienes como fallback).

### 5.2 Cuota de memoria (hallazgo operativo)

La cuota **"Total memory allocation"** de Cloud Run en `us-central1` es de **40 GiB para todo el proyecto**
(`gcloud alpha services quota list --service=run.googleapis.com`), compartida con ~40 servicios ajenos a
Vigía. Cuatro servicios de agentes de 8 GiB son 32 GiB con **una** instancia cada uno. Al redesplegar con
instancias corriendo (health checks, análisis en curso o despliegues concurrentes) aparecen `Quota exceeded
for total allowable memory per project per region`, `no available instance` (429 "Rate exceeded") o
revisiones que "no escuchan en el puerto" sin ningún log del contenedor (no se llegó a programar).

Mitigación aplicada: `agentes.sh` crea los perfiles nuevos con `maxScale=1` (`MAX_INSTANCES_PERFIL`) y
`agente-servicios`/`agente-otros` ya quedaron en 1 (obras sigue en 5 hasta un rollout exitoso; bienes en 3).
Recomendación: pedir aumento de cuota a >= 128 GiB (Cloud Run -> Quotas -> Total memory allocation,
us-central1) antes de correr análisis en paralelo en los 4 perfiles; con 40 GiB el dispatcher no debería
superar `DISPATCHER_PARALLEL=2`. Estado al cierre (14:20 UTC): los 4 servicios responden `GET /` (servicios
con 429 transitorios mientras otra instancia ocupaba la cuota); imagen `sha256:053f5a7c…` (build 085405,
código de D/V/M/P al completo) en bienes, servicios y otros; obras sirve la 083851 (misma base, lote con
consolidación por LLM) hasta que un rollout entre en cuota.

Pendiente para la integración (coordinador): prueba real por tipo (`1216608` bienes, `1248872` servicios,
`1248010` consultoría, obras/directa por cobertura) contra estos servicios.

## 6. Puntos con fallback a la espera de otros WS

Todos los enganches usan `try/except (ImportError, AttributeError)` + `_kwargs_soportados(fn, …)` (filtra
kwargs por firma) para que el driver funcione con o sin el código de D/V/M:

| Punto | Con el WS | Sin el WS |
|---|---|---|
| `tools.doc_select.seleccionar_documentos` + `tools.documentos.parse_documentos_lote` (D) | lote determinista, agente solo consolida | el agente elige y parsea (`parse_document_pdf`) |
| `tools.market.analizar_mercado(state, estrategia)` (M) | estrategia del perfil | `build_market_input` + `analyze_market_sharded` (retail) |
| `agents._shared.schemas.*` (M) | validación pydantic en el driver | sin validación |
| `tools.verify.verificar_dictamen` (V) | `verificacion_dictamen` + warn | nada |
| `tools.self_eval.debe_bloquear` (V) | `estado='revision'` + warn | nunca bloquea |
| `run_inline_evals(..., state=)` (V) | jueces con `documentos_texto`/`ocds` | firma anterior |
| `compliance_rules.REGLAS_POR_NOMBRE` / kwargs `reglas_activas`, `topes_uit` (V) | reglas por slug y parámetros | `getattr(T, f"check_{slug}_rule")`, sin kwargs (leen `state`) |

Al cierre de este WS, D, V y M ya estaban en disco (los imports resuelven); los fallbacks quedan como red de
seguridad para despliegues parciales.

## 7. Decisiones distintas al plan y por qué

1. **`output_schema` nativo apagado** (§3.2): con schema, `grounding_chunks` llega vacío → URLs no verificables.
2. **Perfil `otros` corre sus reglas de compliance en código** (fase `compliance_rules`): el plan omite el
   agente `compliance_extended` para `otros`, pero `directa_fundamento`, `directa_recurrente`, `fraccionamiento`
   son justamente las reglas de ese perfil; se ejecutan como tools deterministas sin LLM (recomendación 6.4-6),
   sin banderas de juicio.
3. **`GET /` sin `action` devuelve el health** y `?action=list|load|random` siguen igual (el único consumidor
   externo de GET es `?action=random` del frontend).
4. **Estado `revision`** (no `en_revision`): la migración 18 (V) amplía el CHECK de `alertas.estado`; la API
   pública excluye solo `revision` en las listas.
5. **`document_parser_agent` no corre cuando el lote determinista produjo extracción** (D ya escribe
   `document_analysis`); queda solo como fallback con `parse_documentos_seleccionados` como tool principal.
6. **`_rate_for_agent_name` resuelve el modelo real del agente** en vez de un set fijo de "agentes Pro".
7. **Sin tier `RESEARCH` separado**: 3.5-flash cuesta más que 3.6-flash (1.50/9.00 vs 0.75/3.75), así que
   web/news/entity usan DEFAULT (3.6-flash, thinking low) y no 3.5-flash como sugería §3.3.

## 8. Latencia

Medición 2026-09-15, perfil `bienes`, contrato `1245947` (7 documentos, texto ya en `documentos_texto`),
orquestador corrido **en local** contra Cloud SQL (34.71.244.66) y Vertex AI global — mismo código que
Cloud Run pero con más latencia de BD por consulta (compliance/OCDS salen más lentos que en producción).
Cliente: `POST {url}?stream=1` con el body del dispatcher, timestamp por evento `phase`.

### 8.1 Qué cambió

| # | Cambio | Dónde | Flag / rollback |
|---|---|---|---|
| 1 | **DAG paralelo**: `compliance ∥ [parser → legal ∥ market] ∥ [proveedor → web ∥ prensa ∥ funcionarios]`, luego `person_network → compliance_extended → dictamen`. Tools síncronas de cada rama en hilo (`asyncio.to_thread`); agentes ADK en sesión aislada con merge **solo de las claves que escribieron** (`_run_agent_delta` + `_aplicar_delta`: acumuladores por append-dedupe); eventos de las ramas por cola (en vivo, orden entre ramas libre); `metrics`/`events_trace` solo desde el event loop. | `deterministic.py` (bloque "DAG paralelo": dependencias y claves por rama) | `PIPELINE_DAG=0` → secuencia histórica |
| 2 | Concurrencia de llamadas directas a Gemini 2 → 4 (el semáforo serializaba el lote de 3 documentos y los jueces) | `tools/_core.py` | `GEMINI_CALL_CONCURRENCY`, `GEMINI_MIN_INTERVAL_S` |
| 3 | Parser: documentos del lote en paralelo (`PARSE_CONCURRENCY`, default 3, alias `PARSE_LOTE_WORKERS`), **unidades de un ZIP** OCR-eadas a la vez con offsets de página precalculados, **chunks Document AI** (>30 págs) en paralelo, **rangos** de un documento largo (>600 k chars) extraídos en paralelo. Orden de prioridad conservado (resultados por índice), lock por sha256 y recortes intactos. | `tools/documentos.py`, `tools/docai.py` | `PARSE_CONCURRENCY=1`, `PARSE_UNIT_WORKERS=1`, `DOCAI_CHUNK_WORKERS=1`; `PARSE_SKIP_TEXTO_CACHE=1` solo para medir |
| 4 | Self-eval: los 4 jueces LLM (respaldo, precio, tono, coherencia) en un pool de hilos; `run_inline_evals` en `asyncio.to_thread` desde `main.py` | `tools/self_eval.py`, `main.py` | `EVAL_CONCURRENCY=1` |
| 5 | Thinking `high → medium` en `report_writer` y `person_network` (legal sigue en `high`); `MAX_OUTPUT_TOKENS_REPORT_WRITER = 16384` (antes default 65 k; el tope incluye los tokens de thinking) | `agents/report_writer/config.py`, `agents/person_network/config.py` | `THINKING_REPORT_WRITER=high`, `THINKING_PERSON_NETWORK=high` |
| 6 | Contexto del writer sin redundancias: `requerimiento_tecnico_detallado` (alias de `texto_literal`, hasta 4 000 chars por ítem), `firmantes_consolidados`/`postores_consolidados` (duplicados de `firmantes`/`postores_extraidos`), telemetría de `documentos[*]` (gs, url, sha256, cache, tiempos, usos), `documento_sha256` por evidencia, `perfil` completo. Sin quitar información única. | `tools/state_loaders.py::_compact_document_analysis` | — |
| 7 | Corrección: los acumuladores de lista que una tool de un sub-agente extiende **in-place** (`state.setdefault("pending_flags", []).append(...)`) se perdían al cerrar la sesión ADK si la clave ya existía al sembrarla (el runner trabaja sobre una copia profunda y persiste solo `state_delta`) — afectaba a las 12 reglas de `compliance_extended`. `after_tool_log` ahora "toca" la clave para que viaje en el delta. Reproducido y verificado en `tests/test_state_acumuladores.py`. | `agents/_shared/callbacks.py` | — |

Tests: `backend/agent/tests/test_dag.py` (orden de dependencias con stubs, merge de deltas/acumuladores,
fallo de una rama sin tumbar a las otras, ningún evento perdido, métricas monótonas, modo secuencial) y
`tests/test_state_acumuladores.py` (LLM simulado, sin red). `python -m pytest backend/agent/tests -q` → 115 passed.

### 8.2 Antes / después por fase (mismo contrato, local)

Columnas: **Cloud Run antes** = medición del 2026-09-15 en el servicio desplegado (referencia del pedido);
**local antes** = código previo, `PIPELINE_DAG=0`; **local después** = todos los cambios (dos corridas: B y C).
En el DAG las fases de las tres ramas se solapan: se listan sus duraciones individuales (∥) y, en negrita, la
duración del bloque completo (camino crítico = `parser → legal`).

| Fase | Cloud Run antes | Local antes (A) | Local después (B) | Local después (C) |
|---|---:|---:|---:|---:|
| ocds + registro | 1 s | 16.8 s | 15.0 s | 14.0 s |
| compliance | 13 s | 77.7 s | 62.3 s ∥ | 42.9 s ∥ |
| document_parser (7 docs en caché + sanitize) | 94 s | 39.6 s | 28.7 s ∥ | 23.9 s ∥ |
| legal (thinking high) | 48 s | 50.5 s | 130.7 s ∥ | 52.8 s ∥ |
| market goods_retail | 20 s | 63.4 s | 39.9 s ∥ | 21.8 s ∥ |
| proveedor (OECE + SUNAT) | 126 s (relay caído) | 7.3 s | 10.4 s ∥ | 8.3 s ∥ |
| research_parallel (web ∥ prensa ∥ funcionarios) | 25 s | 140.7 s | 71.8 s ∥ | 42.8 s ∥ |
| **bloque DAG (las 3 ramas)** | 326 s (suma) | 379 s (suma) | **160.8 s** | **76.7 s** |
| person_network (tools RNP/DATOS_PERU + agente) | 76 s | 84.5 s | 75.4 s (43 + 32) | 65.2 s (40 + 25) |
| compliance_extended + RAG normativo + persist | 5 s | 41.1 s | 25.7 s | 27.3 s |
| checkpoint | — | 3.1 s | 3.3 s | 3.4 s |
| report_writer | 139 s | 144.1 s | 79.9 s | 42.3 s |
| persist final | — | 3.4 s | 3.6 s | 3.3 s |
| self_eval | 22 s | 114.3 s | 40.5 s | 32.7 s |
| **Total** | **570 s** | **786.5 s** | **404.9 s (−48 %)** | **266.4 s (−66 %)** |
| `llm_metrics.cost_usd` | 0.2409 | 0.2118 | 0.1942 | 0.1912 |
| llamadas LLM / tokens | 20 / 169 k | 19 / 148 k | 20 / 146 k | 20 / 147 k |

Variación entre B y C: latencia de Vertex (legal 131 s vs 53 s con los mismos datos, 5 llamadas en ambas)
y del grounding de Google Search. Con el DAG, el total queda gobernado por `max(rama)` + la cola
secuencial (`person_network → compliance_extended → writer → self_eval`), que ya es la mitad del wall.

### 8.3 Medidas aisladas (misma entrada, para separar cada cambio)

| Componente | Antes | Después | Notas |
|---|---:|---:|---|
| Parser sin caché (`1216608`, perfil otros, 4 docs / 31 págs, `PARSE_SKIP_TEXTO_CACHE=1`) | 172.3 s (1 worker, semáforo 2) | **82.2 s** (3 workers, semáforo 4) | mismos 4/4 OK, mismo orden de consolidación, ZIP de 2 unidades OCR-eado en paralelo (9.1 → 7.9 s); ítems 1 vs 2 por variación del extractor |
| report_writer sobre el state final de A (2 corridas por nivel) | high: 54.5 s / 44.9 s · out 10.6 k / 8.5 k tok · 0.0549 / 0.0471 USD | **medium: 42.7 s / 42.7 s** · out 8.4 k / 8.0 k tok · 0.0467 / 0.0452 USD | prompt 26.9 k → 20.2 k tokens por el contexto recortado (62 019 → 48 128 chars en este contrato; −22 %, más en contratos con muchos ítems) |
| person_network sobre el mismo `person_network_context` | high: 40.1 s · out 7.6 k tok · 0.0339 USD | **medium: 28.8 s** · out 5.1 k tok · 0.0245 USD | misma `persona_principal` (DNI 02546088), 0 vínculos en ambos, todas las secciones del schema |
| self_eval sobre el mismo state (4 banderas, 1 ítem con precios) | 46.2 s (`EVAL_CONCURRENCY=1`) | **26.7 s** (`=4`) | veredictos idénticos: respaldo 4/4, precio 1/1, tono ok |

### 8.4 Calidad del dictamen (thinking high vs medium, mismo contexto)

`tools.verify.verificar_dictamen` sobre las cuatro salidas del writer (8.3):

| | high #1 | high #2 | medium #1 | medium #2 |
|---|---|---|---|---|
| banderas citadas | red_flag_documental, sobreprecio_lote_muy_elevado, sobreprecio_muy_elevado | ídem | ídem | ídem |
| banderas inexistentes / URLs / RUC / DNI sin respaldo | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| longitud | 14 436 chars | 10 808 | 14 523 | 13 073 |
| secciones del perfil (resumen, hechos, precios, requerimiento, proveedor, red, cumplimiento, recortes) | todas | todas | todas | todas |
| `_dictamen_problems` | ninguno | ninguno | ninguno | ninguno |

`medium` se mantiene para writer y person_network. `legal` queda en `high`.

### 8.5 Qué NO mejoró y por qué

- **Camino crítico `parser → legal`**: legal es el agente más caro (5 llamadas, ~55 k tokens de prompt, thinking
  high) y ahora define el bloque DAG (53–131 s según latencia de Vertex). No se bajó su thinking (razonamiento
  normativo) ni su contexto; sería el siguiente candidato (RAG legal prefetch en código, menos idas y vueltas).
- **Cola secuencial tras el join** (`person_network` 65–75 s, `compliance_extended` 26 s, writer 42–80 s,
  self_eval 33–40 s): `person_network` necesita firmantes (parser) + funcionarios (entity) + RNP, y
  `compliance_extended` inyecta `person_network`; el writer necesita todo. De los ~40 s de tools previas a
  `person_network` (RNP del ganador y de 4 postores + `batch_person_lookup`, consultas a BD en serie) no se
  tocó nada: son el candidato obvio (fan-out de `query_rnp_empresa`).
- **OCDS (14–17 s) y compliance (43–78 s) en local**: dominados por la latencia de Cloud SQL desde fuera de GCP
  (en Cloud Run miden 1 s y 13 s); el DAG los solapa pero no los acorta.
- **Mercado no determinista**: en A el grounding devolvió 3 precios (mediana S/ 1.6 → `muy_elevado`); en B
  1 precio y en C 3 con un outlier descartado → `sin_dato`, sin bandera de sobreprecio y por eso sin alerta
  nueva ni `alerta_codigo` en el state (el writer vio `banderas: null`; los 9–10 k chars de B/C no son
  comparables con A). No es efecto del DAG (mismo `_modo`, mismas queries, misma duración); la comparación de
  calidad del writer se hizo con el mismo state (8.4).
- **`max_output_tokens` del writer no acelera** por sí mismo: solo acota una degeneración (README/boilerplate
  anexado). 16 k y no 8 k porque el tope incluye los tokens de thinking (3–5 k en `medium`, 5–6 k en `high`).
- **Cloud Run**: no se desplegó; los números de producción se deben re-medir tras el deploy (la latencia de BD
  desaparece y el bloque DAG debería quedar en ~max(parser+legal, compliance, proveedor+research)).
