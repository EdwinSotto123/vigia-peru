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
