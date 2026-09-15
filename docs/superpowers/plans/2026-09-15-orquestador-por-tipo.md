# Orquestador por tipo de contratación — bienes / servicios / obras / otros, sin pérdida de información ni alucinación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el servicio actual (`agent-orchestrator-adk`) dedicado a **BIENES**, desplegar tres servicios Cloud Run más del mismo código con perfil **SERVICIOS**, **OBRAS** y **OTROS** (consultoría/convenio/directa), enrutar desde el dispatcher por `tipo_contratacion`, capturar los documentos **en lote por id desde GCS** con texto persistido por sha256 y citas de página, migrar a **`gemini-3.6-flash`** (thinking) y corregir las causas de pérdida de información y alucinación halladas en `docs/design/AUDITORIA_ORQUESTADOR.md`.

**Architecture:** Un solo código `backend/agent/` con `PIPELINE_PROFILE=bienes|servicios|obras|otros` (`agents/_shared/profiles.py`) que decide agentes, schema del parser, vectores legales, estrategia de mercado, reglas de compliance y secciones del dictamen. Cuatro servicios Cloud Run con la misma imagen y distinto env. El dispatcher enruta por tipo (`AGENT_URL_<TIPO>`). Los documentos se seleccionan de forma determinista desde `documentos_gcs`, se OCR-ean una sola vez (`documentos_texto` por sha256, con páginas) y todo agente devuelve `evidencia[]` obligatoria que el driver verifica contra OCDS/SUNAT/texto antes de persistir.

**Tech Stack:** Python 3.12 · Google ADK 1.19 · google-genai 1.52 · Vertex AI global (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`; verificado 2026-09-15 que responden; **no existe 3.6-pro**) · Postgres 16 · Cloud Run.

**Spec:** `docs/design/AUDITORIA_ORQUESTADOR.md` (hallazgos con archivo:línea; §3.3 tiers por agente; §4.2 qué cambia por tipo; §5.2 documentos en lote; §6 recomendaciones). Este plan ejecuta 6.1, 6.2, 6.3 y 6.4 completos.

## Global Constraints

- Sin menciones a asistentes de IA de terceros en código/docs/commits. Sin `git commit` (integra el coordinador).
- **Nunca** `--set-env-vars` en `agent-orchestrator-adk` (borra ~40 variables y secretos); solo `--update-env-vars`. Los servicios nuevos se crean copiando el spec del actual (ver Task P5).
- Vocabulario: "señal de riesgo", nunca "corrupto"; datos personales solo de funcionarios/empresas.
- Cada agente devuelve `estado: "hallado" | "sin_dato" | "no_verificable"` y `evidencia[]`; **nada sin evidencia se persiste como bandera**.
- Ningún tope silencioso: todo recorte se registra en `state["recortes"]` `[{donde, limite, omitido}]` y aparece en el dictamen.
- Compatibilidad: sin `PIPELINE_PROFILE` (o `=bienes`) y sin `clasificacion` en el body, el flujo del análisis a demanda del admin sigue funcionando.
- Verificación por WS: `python -m compileall -q backend/agent backend/dispatcher`, `python -m pytest backend/agent/tests backend/dispatcher/tests -q` en verde; los tests que llaman a Gemini se marcan `@pytest.mark.live` y se corren con `RUN_LIVE=1` (ADC de gcloud, proyecto `vivid-spot-480905-a4`, `GOOGLE_GENAI_USE_VERTEXAI=1`, `GOOGLE_CLOUD_LOCATION=global`).
- Contratos de prueba reales (ya en DB con record completo y documentos en GCS): bienes `1216608` (analizado antes: sirve de regresión), servicios `1248872`, consultoría `1248010`; para obras y directa el agente elige uno de `SELECT ocid FROM cobertura_contratos WHERE tipo='obras' AND docs_vigentes>0 LIMIT 1` (o baja uno con `python -m backend.batch.descargar pedidos` tras `SELECT pedir_descarga('<ocid>','admin')`).

---

## Mapa de archivos por workstream (disjuntos)

| WS | Crea | Modifica |
|---|---|---|
| **P** perfiles · modelos · servicios | `backend/agent/agents/_shared/profiles.py`, `backend/agent/tests/{__init__,conftest,test_profiles,test_live_gemini36}.py`, `infrastructure/deploy/agentes.sh`, `docs/design/PERFILES_AGENTES.md` | `backend/agent/agents/_shared/{models,model_fallback}.py`, `backend/agent/agents/*/config.py`, `backend/agent/agents/*/__init__.py`, `backend/agent/deterministic.py`, `backend/agent/main.py`, `backend/agent/requirements.txt`, `backend/dispatcher/main.py`, `backend/dispatcher/README.md`, `infrastructure/deploy/agent.sh`, `infrastructure/terraform/cloud_run.tf`, `cloudbuild.yaml` |
| **D** documentos en lote · texto persistido · parser por tipo | `backend/agent/tools/doc_select.py`, `backend/db/migrations/17_documentos_texto.sql`, `backend/agent/tests/test_doc_select.py` | `backend/agent/tools/documentos.py`, `backend/agent/tools/docai.py`, `backend/agent/tools/ocds.py`, `backend/agent/agents/document_parser/prompt.py`, `backend/db/apply_all.py`, `backend/db/apply_all.sh` |
| **V** verificación · persistencia · reglas · contexto del dictamen | `backend/agent/tools/verify.py`, `backend/agent/tests/{test_verify,test_compliance_c2}.py` | `backend/agent/tools/persistence.py`, `backend/agent/tools/compliance_rules.py`, `backend/agent/tools/state_loaders.py`, `backend/agent/tools/_core.py`, `backend/agent/tools/self_eval.py`, `backend/agent/agents/_shared/instructions.py` |
| **M** mercado por perfil · schemas con evidencia · prompts | `backend/agent/agents/_shared/schemas.py`, `backend/agent/tests/test_schemas.py` | `backend/agent/tools/market.py`, `backend/agent/agents/{market_price,web_research,news_research,person_network,entity_personnel,document_legal_analyst,report_writer,compliance_extended}/prompt.py`, `backend/core/clasificacion.py` (market ya no se omite a ciegas para no-bienes: lo decide el perfil) |

### Interfaces compartidas (los cuatro WS las respetan al pie de la letra)

```python
# P · agents/_shared/profiles.py
PROFILE = os.getenv("PIPELINE_PROFILE", "bienes")   # bienes | servicios | obras | otros
@dataclass(frozen=True)
class Profile:
    nombre: str                       # "bienes"…
    tipos_aceptados: frozenset[str]   # bienes → {"bienes"}; otros → {"consultoria","convenio","directa","otro"}; servicios → {"servicios"}; obras → {"obras"}
    agentes: tuple[str, ...]          # orden de ejecución; nombres cortos: compliance, document_parser, document_legal_analyst, market, web_research, news_research, entity_personnel, person_network, compliance_extended, report_writer
    parser_bloque: str | None         # None | "servicio" | "obra" | "sustento_directa"  (D: bloque extra del schema del parser)
    market_estrategia: str            # "goods_retail" | "historico_seace" | "presupuesto_obra" | "cotizaciones"  (M)
    legal_vectores: str               # clave del prompt parcial en document_legal_analyst/prompt.py: "bienes"|"servicios"|"obras"|"otros" (M)
    reglas_activas: frozenset[str]    # nombres de reglas de compliance_rules (V las respeta vía parámetro `reglas`)
    topes_uit: dict[str, float]       # p.ej. {"licitacion_publica": 400, ...} por tipo (V)
    dictamen_secciones: tuple[str, ...]  # M: report_writer/prompt.py las lee
    doc_prioridad: tuple[str, ...]    # D: orden de prioridad por documentType/título
    parse_max_docs: int               # D
def get_profile() -> Profile
def acepta(profile: Profile, tipo: str | None) -> bool   # None → True (a demanda)
```

```python
# D · tools/doc_select.py
def seleccionar_documentos(ocid: str, ocds: dict, doc_urls: dict[str, str], prioridad: tuple[str, ...], max_docs: int
                           ) -> tuple[list[DocRef], list[dict]]:
    """Devuelve (elegidos, omitidos). DocRef = {id, url, gs, tipo, titulo, seccion, formato, sha256|None}.
    Lee documentos_gcs por ocid (vigentes) y los documentos del record (tender/awards/contracts); nunca llama a un LLM."""
# D · tools/documentos.py
def parse_documentos_lote(state: dict, docs: list[DocRef]) -> dict:
    """OCR una sola vez (documentos_texto por sha256, páginas con marcadores ⟦p.N⟧), extracción con schema
    (base + bloque del perfil) y evidencia {documento_sha256, pagina, cita}. Escribe state['parser_raw_consolidated'],
    state['documentos_texto'] = {sha256: {n_paginas, chars, truncado}}, y añade a state['recortes']."""
```

```python
# V · tools/verify.py
def verificar_bandera(flag: dict, state: dict) -> dict:   # añade flag["verificacion"] = {"ok": bool, "motivos": [...]}; RUC/DNI/montos/fechas/URLs contra ocds, sunat_decolecta, rnp_*, batch_person_lookup, documentos_texto, grounding_urls
def verificar_dictamen(md: str, state: dict) -> dict:     # {banderas_no_existentes: [...], urls_no_respaldadas: [...], degradado: bool}
# V · tools/self_eval.py
def debe_bloquear(resultado_eval: dict) -> tuple[bool, str]   # P lo llama en main.py y marca alertas.estado='revision'
# V · tools/compliance_rules.py — todas las reglas aceptan `reglas_activas: frozenset[str] | None` y `topes_uit: dict | None` (P se los pasa desde el perfil)
```

```python
# M · agents/_shared/schemas.py  (pydantic v2; P los enchufa como output_schema en agents/*/__init__.py)
class Evidencia(BaseModel): documento: str | None; url: str | None; pagina: int | None; cita: str  # cita ≤ 240 chars, literal
class Hallazgo(BaseModel): estado: Literal["hallado","sin_dato","no_verificable"]; evidencia: list[Evidencia]
class LegalOutput, MarketOutput, WebResearchOutput, NewsOutput, EntityPersonnelOutput, PersonNetworkOutput(BaseModel) ...
# M · tools/market.py
def analizar_mercado(state: dict, estrategia: str) -> dict   # "goods_retail"|"historico_seace"|"presupuesto_obra"|"cotizaciones"; URLs SOLO desde grounding_metadata; mediana/Δ%/veredicto en código
```

```python
# P · body del orquestador (main.py) — sin cambios de forma; se agregan:
#   "doc_ids": [..] opcional (D los usa para restringir el lote); "perfil" en la respuesta/eventos ({"kind":"phase","name":"perfil","msg":"servicios"})
# P · dispatcher: AGENT_URL_BIENES / AGENT_URL_SERVICIOS / AGENT_URL_OBRAS / AGENT_URL_OTROS (fallback AGENT_URL); tipo→servicio; si el servicio del tipo no está configurado → esperar (no mandar servicios al de bienes)
```

---

# Workstream P — Perfiles, modelos 3.6, cuatro servicios y enrutado

### Task P1: `profiles.py` + gate en `main.py`
- [ ] Implementar `Profile`/`get_profile()`/`acepta()` con los cuatro perfiles según §4.2 y §3.3 de la auditoría (agentes: bienes = los 10; servicios = sin `market` retail pero **con** market `historico_seace`; obras = market `presupuesto_obra`; otros = compliance, document_parser, document_legal_analyst, market `cotizaciones`, web/news/person, report_writer). `doc_prioridad` por perfil (bienes: Bases integradas > Bases > EETT > Acta/Cuadro comparativo > Contrato/Orden > Adendas > Absolución; servicios: TDR > Bases integradas > … ; obras: Expediente técnico > Presupuesto > Bases > Contrato > Adendas/adicionales > Valorizaciones; otros: Informe técnico-legal > Acto resolutivo > Cotizaciones > Contrato). `parse_max_docs` 12.
- [ ] `main.py`: al recibir un body con `clasificacion.tipo` que el perfil no acepta → HTTP 409 `{error:"tipo_no_aceptado", perfil, tipo}` (y evento NDJSON `error` si `?stream=1`); sin `clasificacion` → acepta (a demanda). Emite evento `{"kind":"phase","name":"perfil","msg":<perfil>}` al inicio. `GET /` responde `{ok, perfil, modelos}`.
- [ ] `deterministic.py`: lee `get_profile()`; `agentes_permitidos` = intersección de la matriz (body) con `profile.agentes`; pasa `profile.reglas_activas/topes_uit` a las reglas (V), `profile.market_estrategia` a `analizar_mercado` (M), `profile.parser_bloque/doc_prioridad/parse_max_docs` a D; inicializa `state["recortes"]=[]` y `state["descartes"]=[]` y los entrega al writer. Los agentes omitidos siguen emitiendo `phase … omitido`.
- [ ] Tests `test_profiles.py`: cada perfil acepta su tipo y rechaza los demás; `acepta(p, None)` True; los nombres de agentes existen en `deterministic.FASES`.

### Task P2: Modelos — 3.6-flash con thinking, tiers reales, fallbacks, tarifas
- [ ] `models.py`: `_MODEL_SMART` default `gemini-3.6-flash`, `_MODEL_DEFAULT` `gemini-3.6-flash`, `_MODEL_FAST` `gemini-3.5-flash-lite`, `_MODEL_JUDGE` (`GEMINI_MODEL_JUDGE`, default `gemini-3.5-flash`, ≠ generador). `THINKING = {"low","medium","high"}` por agente desde `config.THINKING` (env `THINKING_<AGENTE>` override).
- [ ] `agents/*/__init__.py`: `planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_level=…, include_thoughts=False))` cuando el modelo es 3.x; `generate_content_config=types.GenerateContentConfig(temperature=…, max_output_tokens=…)` desde config/env (sin `thinking_config` ahí: ADK lo rechaza). `output_schema=schemas.<X>` para legal, market, web, news, entity, person_network (los schemas los define M; si el archivo aún no existe cuando pruebes, usa `try/except ImportError` con `output_schema=None`). `compliance_extended/config.py`: MODEL = DEFAULT (no flash-lite) para las 2 banderas de juicio.
- [ ] `model_fallback.py`: `_FALLBACK_CHAIN["gemini-3.6-flash"] = ["gemini-3.5-flash","gemini-2.5-flash"]`, `["gemini-3.5-flash-lite"] = ["gemini-2.5-flash-lite","gemini-3.5-flash"]`; desapilar reintentos (una sola capa con `deadline` total por llamada, env `GEMINI_CALL_DEADLINE_S`, default 600).
- [ ] Tarifas 3.x y `thoughts_token_count` en `deterministic._rate_for_model` y `main._rate_for_agent_name` (precios públicos de Vertex al 2026-09-15; si no los puedes verificar, deja `[verificar]` y úsalos como los de 2.5-flash).
- [ ] `requirements.txt`: pin `google-adk==1.19.0`, `google-genai==1.52.0` (o las versiones instaladas que verifiques con `pip show`).
- [ ] `test_live_gemini36.py` (`@pytest.mark.live`): (1) `thinking_level` low/high aceptados por 3.6-flash; (2) `response_schema` + `google_search` grounding en la misma llamada devuelve JSON válido **y** `grounding_metadata` (si falla, documentar y dejar el patrón "JSON en texto + pydantic"); (3) function calling con 2 tools encadenadas (thought signatures) no da 400; (4) parser con `temperature` default vs 0.0 sobre un PDF corto de `documentos_gcs` — comparar que extraiga los mismos ítems. Ejecutarlo de verdad con `RUN_LIVE=1` y pegar el resultado en `docs/design/PERFILES_AGENTES.md`.

### Task P3: Dispatcher por tipo
- [ ] `backend/dispatcher/main.py`: `url_para(tipo)` → `AGENT_URL_<TIPO>` (bienes/servicios/obras/otros; consultoria|convenio|directa|otro → OTROS) con fallback a `AGENT_URL` **solo** para bienes; sin URL para el tipo → `dejar_pendiente(ocid, "servicio de agentes para <tipo> no desplegado")`. Log del servicio elegido. README: tabla de variables.
- [ ] `infrastructure/deploy/dispatcher.sh`: `--update-env-vars AGENT_URL_BIENES=…,AGENT_URL_SERVICIOS=…,AGENT_URL_OBRAS=…,AGENT_URL_OTROS=…` (URLs de Task P5).
- [ ] Test en `backend/dispatcher/tests/test_routing.py` con stubs de env.

### Task P4: `main.py` — self-eval bloqueante y estado `revision`
- [ ] Tras la self-eval, llamar `self_eval.debe_bloquear()` (V); si bloquea → `UPDATE alertas SET estado='revision'` y evento `warn` con el motivo; la alerta no aparece en `/alertas` públicas (verifica cómo filtra `backend/api/src/routes/alertas.ts` por `estado` y, si no filtra, añade `AND estado <> 'revision'` — es el único archivo de la API que este WS puede tocar).

### Task P5: Cuatro servicios Cloud Run con el mismo código
- [ ] `infrastructure/deploy/agentes.sh [bienes|servicios|obras|otros|all]`: (1) `gcloud builds submit backend/agent --tag us-central1-docker.pkg.dev/vivid-spot-480905-a4/cloud-run-source-deploy/agentes:<sha>`; (2) para **bienes**: `gcloud run services update agent-orchestrator-adk --image <tag> --update-env-vars PIPELINE_PROFILE=bienes,GEMINI_MODEL=gemini-3.6-flash,GEMINI_MODEL_SMART=gemini-3.6-flash,GEMINI_MODEL_FAST=gemini-3.5-flash-lite,GEMINI_MODEL_JUDGE=gemini-3.5-flash` (nunca set); (3) para los otros: `gcloud run services describe agent-orchestrator-adk --format yaml` → quitar campos de solo lectura (`status`, `metadata.uid/resourceVersion/…`, annotations de revisión) → cambiar `metadata.name` a `agente-<perfil>`, `PIPELINE_PROFILE`, la imagen → `gcloud run services replace` + `add-iam-policy-binding allUsers roles/run.invoker` (igual que el de bienes). Así heredan las ~40 variables, secretos y Cloud SQL sin transcribirlos. `--concurrency 1 --timeout 3600 --memory 8Gi` se conservan del spec.
- [ ] `infrastructure/terraform/cloud_run.tf`: 3 recursos nuevos (`agente_servicios/obras/otros`) parametrizados por `for_each` sobre los perfiles con la misma imagen y env; nota en el archivo de que el spec vivo se gestiona con `agentes.sh`.
- [ ] `cloudbuild.yaml`: paso `agentes` opcional (`_DEPLOY` incluye `agentes`).
- [ ] Ejecutar `bash infrastructure/deploy/agentes.sh all` y verificar `GET /` de los 4 servicios devuelve su perfil. Ejecutar `bash infrastructure/deploy/dispatcher.sh` con las 4 URLs.

---

# Workstream D — Documentos en lote por id, texto persistido, parser por tipo

### Task D1: Migración 17 `documentos_texto`
- [ ] `documentos_texto (sha256 TEXT PK, ocid TEXT, url_gcs TEXT, formato TEXT, n_paginas INT, motor TEXT, version_parser TEXT, texto TEXT, paginas JSONB, truncado BOOL DEFAULT false, extraccion JSONB, creado_at TIMESTAMPTZ DEFAULT now(), actualizado_at TIMESTAMPTZ)`; índice por `ocid`. Registrar en `apply_all.py/.sh` y **aplicar en Cloud SQL** (`PGHOST=34.71.244.66 PGSSLMODE=require`, password en `.cloudsql-password`).
- [ ] `tools/ocds.py`: `register_convocatoria_in_db` deja de borrar `documentos`; registra también docs de `awards[]`/`contracts[]` con `seccion`; `ofertas` registra **todos** los `tender.tenderers`/`parties[role=tenderer]` con `ganadora=false` (V arregla la regla C2 sobre eso; acuerda el nombre de columna `ganadora` BOOL — si no existe, créala en la migración 17).

### Task D2: Selección determinista `doc_select.py`
- [ ] Implementar `seleccionar_documentos()` (interfaz compartida): fuentes = `documentos_gcs` vigentes por ocid (url_gcs + sha256) ∪ documentos del record (tender/awards/contracts); prioridad por `prioridad` (matching por `documentType` y por título normalizado: "bases integradas", "bases", "términos de referencia|tdr", "especificaciones técnicas|eett", "expediente técnico", "presupuesto", "acta", "cuadro comparativo", "contrato", "orden de", "adenda|adicional", "absolución", "informe", "resolución|acto"); dedupe por sha256/url; tope `max_docs` → resto a `omitidos` con motivo `tope_docs`; si el body trae `doc_ids`, restringe a esos. Tests con fixtures sintéticas (≥ 8 casos, incluye ZIP dentro de award y títulos con tildes).

### Task D3: OCR una sola vez, páginas con marcador, sin resumir
- [ ] `docai.py`: marcadores `⟦p.N⟧` por página en `_texto_con_layout` y en el fallback PyMuPDF (`documentos.py`); devolver `paginas=[{n, texto, chars}]` además del texto plano.
- [ ] `documentos.py`: `parse_documentos_lote()` (interfaz): por doc → sha256 (de `documentos_gcs` o calculado) → si `documentos_texto` tiene el sha con `version_parser` actual, saltar OCR; si no, bajar (cadena actual: `doc_urls` GCS primero), extraer (ZIP/RAR: **sin** tope de 3 — usar prioridad por título; abrir `.xls/.xlsx` con openpyxl y `.doc` con `antiword`/LibreOffice si están; si no, registrar recorte `formato_no_soportado`), guardar texto+páginas en `documentos_texto`. Extracción con `response_schema` (base + bloque `servicio`/`obra`/`sustento_directa` según `parser_bloque`, §4.2): `requerimiento_tecnico_detallado` → `texto_literal` (extracto literal ≤ 4 000 chars con página) + campos discretos; cada ítem/firmante/red flag lleva `evidencia: [{pagina, cita}]` y `documento_sha256`. `temperature` desde env `PARSER_TEMPERATURE` (default: sin fijar). Si `finish_reason=MAX_TOKENS` o el JSON llega truncado → `_truncado=true`, re-pedir por rango de páginas y registrar recorte. `state["recortes"]` con cada tope aplicado.
- [ ] `document_parser/prompt.py`: ya no elige documentos ("hasta 5" fuera); describe el schema y la obligación de citar página; si `document_parser_agent` sigue existiendo como LlmAgent, su tool ahora es `parse_documentos_lote` (una llamada).
- [ ] Prueba real (`RUN_LIVE=1`): `parse_documentos_lote` sobre `1248872` (servicios, RAR) y `1248010` (consultoría, PDF) desde GCS; segunda corrida no vuelve a OCR (verificar en `documentos_texto`). Reportar n_paginas, chars, tiempos.

---

# Workstream V — Verificación determinista, persistencia sin pérdidas, reglas sin falsos positivos, dictamen completo

### Task V1: Persistencia
- [ ] `persist_alert_from_flags`: borrar solo `agente_origen='compliance_agent'`; recalcular `score` con **todas** las banderas de la alerta; consumir `pending_market_flags` en `persist_analysis_outputs`; eliminar el fallback `_raw_text` a `analisis_full` (→ `sin_dato` + evento `warn`); `banderas.verificacion JSONB` (añade la columna en una migración `18_verificacion.sql` propia de este WS — **aplícala** en Cloud SQL) con el resultado de `verify.verificar_bandera`; **no persistir** banderas con `verificacion.ok=false` (van a `state["descartes"]`).
- [ ] Test `test_verify.py` con state sintético: RUC inexistente → descartada; URL no en grounding → `no_verificable`; monto ≠ OCDS → motivo.

### Task V2: `verify.py`
- [ ] `verificar_bandera` y `verificar_dictamen` según interfaz: extrae RUC (11 dígitos), DNI (8), montos (S/), fechas y URLs del texto/evidencia de la bandera y los busca en `state["ocds"]` (parties, awards, contracts, tender.value), `state["sunat_decolecta"]`, `rnp_*`, `batch_person_lookup`, `documentos_texto` (por sha en state), `state["grounding_urls"]` (M lo llena). Resultado `{ok, motivos[]}`; `ok=false` si hay un identificador/monto no respaldado.

### Task V3: Reglas
- [ ] C2 único postor: usar `tender.numberOfTenderers` / `parties[role=tenderer]` / `ofertas` con `ganadora=false` (D las registra): ALTA solo si `n_postores == 1` **y** oferta ≥ 95 %; si no hay dato de postores → `sin_dato` (no bandera).
- [ ] `directa_emergencia_sin_acto_resolutivo`: buscar en `documentos_texto` (texto completo, por sha en state) y `estudio_mercado.causal_*`; devolver página y cita; si solo hay resúmenes → MEDIA con `requiere_verificacion`.
- [ ] `concentracion_entidad` cuenta en `convocatorias` (BD propia); `firmante_vinculado_ganador` exige `fuente_url` verificable y `confianza_match='alta'`; `inconsistencia_doc_vs_ocds` solo ítems raíz y sin el texto "manipulación de acta"; `tipo_proceso_vs_monto`/`ciiu` leen `topes_uit`/`reglas_activas` del perfil (parámetros nuevos, default = comportamiento actual). Reglas nuevas: `adicional_acumulado` (obras: `contracts[].amendments`/docs `contractAmendment` > 15 %/50 %), `personal_clave_vinculado` (servicios: personal clave del parser vs firmantes/entidad), `fraccionamiento` (misma entidad + mismo proveedor + objeto similar < 90 días en `convocatorias`), `directa_recurrente` (proveedor con ≥ 3 directas en 12 meses).
- [ ] `test_compliance_c2.py`: 1 postor → ALTA; 5 postores → nada; sin dato → `sin_dato`.

### Task V4: Contexto del dictamen y núcleo
- [ ] `state_loaders.get_dictamen_context`: incluir `banderas` (leídas de BD), `entity_personnel`, las 12 reglas extendidas, `estado_real`, `causal_directa_invocada`, `acto_resolutivo_directa`, `recortes`, `descartes`, `validaciones_pendientes`; sustituir `_cap` por paginación por sección con `truncado=true` + conteo; `hallazgos` sin el corte a 10 (priorizar por severidad si supera 60); no eliminar `legal_analysis` en el reintento.
- [ ] `instructions.py`: no cortar a 40 000 chars a mitad de JSON: serializar por secciones y recortar listas con `_truncado` (o mover la data a tool).
- [ ] `_core.py`: `_safe_parse_json` marca `_truncado=true` en el intento 4 / `MAX_TOKENS`; una sola capa de reintentos con `deadline` (coordinar con P: P deja `model_fallback` con una capa; V deja `_core` sin la suya duplicada).
- [ ] `self_eval.py`: `debe_bloquear()` (interfaz) con umbrales por env (`EVAL_MIN_RESPALDO=0.6`, tono acusatorio, incoherente); jueces reciben `documentos_texto`/`ocds` para verificar citas, modelo `_MODEL_JUDGE`.

---

# Workstream M — Mercado por perfil, schemas con evidencia, prompts sin datos verosímiles

### Task M1: `schemas.py`
- [ ] Pydantic v2: `Evidencia`, `Hallazgo`, `LegalOutput` (vectores[] con norma, artículo, evidencia), `MarketOutput` (precios_observados[] {producto, precio, unidad, url, fecha}, sin mediana/Δ% — los calcula el código), `WebResearchOutput`, `NewsOutput`, `EntityPersonnelOutput`, `PersonNetworkOutput` (relaciones[] con `confianza` y evidencia). Test `test_schemas.py`: ejemplos válidos e inválidos (cita > 240, sin evidencia con estado `hallado`).

### Task M2: Mercado por estrategia
- [ ] `analizar_mercado(state, estrategia)`: `goods_retail` (actual, refactorizado): URLs **solo** desde `grounding_metadata.grounding_chunks` (rechazar el resto → `descartes`), `response_schema=MarketOutput`, mediana/Δ%/veredicto en código, `state["grounding_urls"]` con todas las URLs reales. `historico_seace`: query a `convocatorias`/`convocatoria_items` por CUBSO y objeto normalizado (unaccent + trigram si existe) de los últimos 24 meses, tarifa mensual implícita = monto / plazo / personal (del bloque `servicio` del parser); veredicto por costo mensual y por entregable con percentiles. `presupuesto_obra`: partidas del bloque `obra` vs presupuesto total (suma, GG/utilidad %), comparación con obras similares en `convocatorias` (misma categoría/objeto, monto/m² si hay metrado); `infobras` como `validacion_pendiente` explícita si no hay dato. `cotizaciones`: del bloque `sustento_directa` vs monto adjudicado (Δ%, cotizante = ganador, cotizantes vinculados vía `person_network`). Todas registran `sin_dato` cuando no hay base de comparación; nunca inventan referencias.
- [ ] `backend/core/clasificacion.py`: la matriz deja de omitir `market` para servicios/obras/otros (lo decide `market_estrategia` del perfil); `validaciones_pendientes` `market_sin_items_fisicos` solo aplica a bienes. Actualiza los tests de `backend/core/tests` que cambien y `docs/design/MATRIZ_TIPO_ETAPA.md`.

### Task M3: Prompts
- [ ] `market_price`, `web_research`, `news_research`, `person_network`, `entity_personnel`: quitar ejemplos con marcas/RUC/nombres verosímiles (→ `<placeholder>`), quitar mínimos de cantidad ("15 queries", "13+ fuentes") por criterios de cobertura; exigir `estado` y `evidencia` (schema), "sin_dato" explícito; prohibir inferir vínculos por apellido solo.
- [ ] `document_legal_analyst/prompt.py`: prompts parciales por `legal_vectores` (bienes / servicios: personal clave, experiencia > 3× valor, plazo irreal, subcontratación, causal "personalísimo" / obras: adicionales, ampliaciones, supervisor por directa, capacidad RNP de consorcios / otros: causal congruente, acto resolutivo, publicación ≤ 10 días hábiles, fraccionamiento, recurrencia). Cada vector con `evidencia` obligatoria.
- [ ] `report_writer/prompt.py`: secciones por `dictamen_secciones` (bienes: "Precios unitarios vs mercado"; servicios: "Términos de referencia y proporcionalidad"; obras: "Expediente técnico, presupuesto y adicionales"; otros: "Causal y expediente de sustento"); sección fija "Recortes y datos no verificables" (de `recortes`/`descartes`/`validaciones_pendientes`); prohibido citar banderas que no estén en `banderas`; sin "3000-6000 palabras" (extensión según hallazgos). `compliance_extended/prompt.py`: las 2 banderas de juicio con evidencia.

---

## Integración (coordinador)
- [ ] Merge P → D → V → M (conflictos posibles solo en `deterministic.py`/`main.py`, que son de P). Migraciones 17 y 18 aplicadas. `compileall` + `pytest` (unit) + `RUN_LIVE=1 pytest -m live`.
- [ ] `bash infrastructure/deploy/agentes.sh all`, `bash infrastructure/deploy/dispatcher.sh`. Verificar `GET /` de los 4 servicios.
- [ ] Prueba real por tipo desde `/admin/analisis` (o `POST ?stream=1` directo): bienes `1216608` (comparar con el dictamen anterior: mismas banderas o más, ninguna inventada), servicios `1248872`, consultoría `1248010`, obras y directa (elegidos por cobertura). Revisar: evidencia con página en cada bandera, `recortes` visibles, sin RUC/URL no verificables, `documentos_texto` poblado, costo/tiempo por corrida.
- [ ] Actualizar `docs/design/MATRIZ_TIPO_ETAPA.md`, `backend/agent/README` (si existe) y memoria; commit y push.
