# Auditoría del orquestador de agentes (`backend/agent/`)

Fecha: 2026-09-15 · Alcance: `main.py`, `deterministic.py`, `agents/**`, `tools/**` (≈15 200 líneas) · Método: lectura completa del código; no se ejecutó nada contra producción. Todo hallazgo lleva `archivo:línea` (rutas relativas a `backend/agent/` salvo que se indique otra cosa). Lo que no se pudo determinar leyendo el código está marcado como **[no verificable en código]**.

Contexto de producción asumido (env del servicio `agent-orchestrator-adk`): `GEMINI_MODEL=gemini-2.5-flash`, `GEMINI_MODEL_SMART=gemini-2.5-flash`, `GEMINI_MODEL_FAST=gemini-2.5-flash-lite`, `DETERMINISTIC_PIPELINE=1`, `PARALLEL_RESEARCH=1`, `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_LOCATION=global`. Nota: `infrastructure/terraform/cloud_run.tf:57-59` declara `GEMINI_MODEL_SMART=gemini-2.5-pro`; hay deriva entre Terraform y el servicio real.

---

## 0. Resumen ejecutivo — los 10 hallazgos de mayor impacto

| # | Hallazgo | Efecto | Dónde |
|---|---|---|---|
| 1 | **Las banderas documentales y de mercado se BORRAN de la BD en el paso 10**: `persist_alert_from_flags` hace `DELETE FROM banderas WHERE alerta_id=%s` (todas) y reinserta solo `pending_flags`; los flags insertados antes por `persist_doc_flags_as_banderas` y `persist_market_flags_as_banderas` (otro `agente_origen`) desaparecen y el `score` se recalcula solo con `pending_flags`. | Pérdida de información en TODA corrida donde disparó ≥1 regla dura/extendida/contextual. | `tools/persistence.py:147`, `:83-84`, `:168-170`; llamada en `deterministic.py:898` |
| 2 | **`pending_market_flags` nunca se consume**: si la alerta no existía al persistir mercado, los flags se guardan en state y ningún código los lee. | Sobreprecios detectados que jamás llegan a `banderas`. | `tools/persistence.py:491-498`; grep sin consumidores |
| 3 | **La regla C2 "único postor" es un falso positivo estructural**: `ofertas` solo recibe ofertas GANADORAS (`ocds.py:324-346`), por lo que `COUNT(DISTINCT p.empresa_ruc)` por ítem es siempre 1 cuando hay award; basta que el ganador ofertara ≥95 % del referencial para disparar "1 solo postor" aunque hubiera 8 postores. `numberOfTenderers` no se usa. | Alucinación determinista de severidad ALTA que luego el dictamen "fundamenta" con opinión OECE. | `tools/compliance_rules.py:20-29,40-47`; `tools/ocds.py:313-346` |
| 4 | **El texto OCR se descarta**: Document AI produce el texto completo del PDF, se le pasa a Gemini y se tira; solo sobrevive un `requerimiento_tecnico_detallado` que el schema define como "RESUMEN NARRATIVO 300-1000 chars". `documentos.texto_extraido` no se escribe en ningún lugar del repo, y `register_convocatoria_in_db` hace `DELETE FROM documentos` en cada corrida. | Resumen-de-resumen: legal, compliance (acto resolutivo), market y dictamen razonan sobre ≤1000 chars por ítem; imposible citar página; re-OCR en cada corrida. | `tools/documentos.py:433-445,769-772,926-957`; `tools/ocds.py:347-357`; `db/migrations/06:20` |
| 5 | **`directa_emergencia_sin_acto_resolutivo` (ALTA) busca el D.S./resolución solo en los resúmenes** (`fundamento_legal` + `requerimiento_tecnico_detallado`), no en el texto del documento; tampoco mira `estudio_mercado.causal_articulo/causal_texto` que el parser sí llena. | Bandera ALTA "sin sustento legal" cuando el acto resolutivo está en el PDF pero no en el resumen. | `tools/compliance_rules.py:348-379,502-520`; campo en `documentos.py:565-568` |
| 6 | **El dictamen no recibe las banderas persistidas**: `get_dictamen_context` no incluye `banderas` ni `entity_personnel` ni los resultados de las 12 reglas extendidas; solo llegan vía `normative_compliance`, que se corta a **10 hallazgos** (`hallazgos[:10]`). Además `_cap` trunca strings a 5 000 chars y listas a 40 (1 400/10 en reintento) sin marcar `truncado`. | El writer omite o inventa banderas; en contratos con >10 hallazgos el resto no existe para él. | `tools/state_loaders.py:414-422,440-442`; `tools/compliance_rules.py:1226` |
| 7 | **Mercado: URLs y `diff_pct` los genera el modelo, no el código**: los workers de precio no usan `response_schema`, descartan `grounding_metadata` (las URIs reales del grounding) y piden al LLM calcular mediana/Δ%/veredicto; el código solo recalcula el total del lote. El prompt del agente fallback trae un ejemplo con marcas/precios/URLs concretos. | Precios y fuentes no verificables; aritmética alucinada; bandera `sobreprecio_*` con norma "Art. 12" sin evidencia trazable. | `tools/market.py:617-651,581-614`; `agents/market_price/prompt.py:348-445` |
| 8 | **Reglas "deterministas" alimentadas por salidas LLM**: `concentracion_entidad` cuenta contratos que `web_research` (grounding) dijo haber visto; `firmante_vinculado_ganador` copia `cruce_firmantes_ganador` de `person_network`. Ambas persisten con `fuente_url=None` o la del LLM y norma "Heurística". | Lavado de alucinación: una suposición del LLM sale como bandera de regla. | `tools/compliance_rules.py:696-753,756-794` |
| 9 | **Tier SMART degradado + FAST para juicio**: en prod `SMART=gemini-2.5-flash` (legal, red de personas, dictamen corren en Flash); `compliance_extended` corre en **flash-lite** y emite 2 banderas de JUICIO (`capacidad_operativa_cuestionable`, `conflicto_interes_funcionario_empresa`). Ningún agente ADK fija `temperature`, `thinking` ni `max_output_tokens`. | Menor calidad justo donde hay que razonar; flags de juicio con el modelo más débil. | `agents/_shared/models.py:12-14`; `agents/compliance_extended/config.py:20,27-35`; ausencia de `generate_content_config`/`planner` en todos los `agents/*/__init__.py` |
| 10 | **Topes silenciosos en la cadena documental**: `list_documents` muestra 12 docs; el agente (LLM) elige "hasta 5"; ZIP/RAR abren solo 3 PDF + 3 DOCX + 3 ZIP anidados + 10 imágenes; `.doc/.xls/.xlsx` no se abren; DocAI a 1 000 000 chars; `max_output_tokens=65535` con reparación de JSON truncado que devuelve parcial sin aviso; presupuesto global de parseo 700 s. Nada de esto deja `truncado=true` en state. | Ítems/firmantes/postores que no existen para el pipeline y nadie lo sabe. | `tools/documentos.py:64,1333-1346,1393-1413,1432-1434,771,610,934-936,1499-1506`; `agents/document_parser/prompt.py:27`; `tools/_core.py:186-248` |

Hallazgos adicionales relevantes (ver secciones): inyección de state cortada a 40 000 chars (`_shared/instructions.py:69`) → JSON inválido a mitad para `person_network_context`; doble capa de reintentos (patch + `_gemini_call_with_retry`) que puede consumir hasta ~1 h por llamada saturada; self-eval que solo anota y no bloquea; `thoughts_token_count` no contabilizado; `_FALLBACK_CHAIN` y tarifas sin Gemini 3.x; `google-adk>=1.0.0` sin pin.

---

## 1. Mapa del flujo real

### 1.1 Entrada y orquestación

- Entrada HTTP `POST /?stream=1` con `{input, ocds, docs_b64, doc_urls, clasificacion}` (`main.py:1069-1120`). `initial_state` = `ocds_preloaded`, `ocds`, `docs_b64`, `doc_urls`, `clasificacion`, `agentes_permitidos`, `validaciones_pendientes` (`main.py:114-128`).
- Con `DETERMINISTIC_PIPELINE!=0` (default on) el LLM `vigia_orchestrator` **no se ejecuta**: `_safe_run` retorna de inmediato (`main.py:192-194`) y la secuencia la corre `run_deterministic` (`main.py:213-228`). El prompt de 619 líneas de `agents/orchestrator/prompt.py` es código muerto en producción (solo activo con `DETERMINISTIC_PIPELINE=0`).
- Cada sub-agente corre en una **sesión ADK fresca sembrada con `dict(state)`** y al terminar se mergea **todo** `session.state` de vuelta (`deterministic.py:294-336`). En modo paralelo solo se copia el `output_key` (`deterministic.py:354-403,785`).
- Las tools se llaman directo con un shim (`deterministic.py:273-291`). Excepciones de tools se convierten en `{"error": ...}` y el pipeline sigue (`:284-286`).

### 1.2 Secuencia, claves de state y recortes

| Paso | Qué corre | Lee del `state` | Escribe en `state` | Recortes / topes |
|---|---|---|---|---|
| 1 | `fetch_ocds_record` (`ocds.py:15-105`) | `ocds_preloaded`/`ocds` | `ocds` (compiledRelease entero), `ocid` (corto) | `objeto[:300]` solo en el return |
| 1b | `register_convocatoria_in_db` (`ocds.py:194-362`) | `ocds` | — (BD: `convocatorias`, `convocatoria_items`, `postores`, `ofertas`, `documentos`) | `objeto[:2000]`, `descripcion_corta[:80]`; **`DELETE FROM documentos`** y reinserta solo `tender.documents` (no `awards/contracts`) `:347-357`; **`ofertas` solo ganadoras** `:324-346` |
| 2 | `compliance_agent` (Flash, `agents/compliance`) — LLM llama 5 tools + RAG + `persist_alert_from_flags` | `ocds` (vía SQL) | `pending_flags[]`, `alerta_codigo`, `score`, `banderas`, `estado_real`, `analisis_postores`, `compliance_result` (texto libre) | Depende de que el LLM llame las 5 tools; no hay verificación en código de que lo hizo |
| 3 | `document_parser_agent` (Flash) — LLM lista docs y elige cuáles parsear | `ocds`, `docs_b64`, `doc_urls` | `parser_raw_consolidated`, `estudio_mercado`, `contrato_final`, `_parsed_doc_cache`, `_parse_deadline`, `document_analysis` (JSON del LLM) | `list_documents` → `docs[:12]` (`documentos.py:64`); prompt "procesa hasta 5 documentos" (`document_parser/prompt.py:27`); el LLM decide qué docs, sin verificación |
| 3.5 | `_backfill_document_analysis` (`deterministic.py:406-447`) | `parser_raw_consolidated`, `document_analysis` | `document_analysis.items_consolidados` ← raw (autoritativo) | El `warn` de backfill nunca se emite: compara `"BACKFILL" in _bf` pero el mensaje dice "estructura desde la TOOL" (`:619`) |
| 3.6 | `sanitize_items_with_llm` (`documentos.py:1774-1916`) | `parser_raw_consolidated.items_consolidados`, `ocds.tender` | `parser_raw_consolidated`, `document_analysis.items_consolidados` | Catálogo `desc[:200]`; el LLM decide fusiones/descartes (puede fundir ítems distintos); fail-safe conserva crudos |
| 4 | `document_legal_analyst_agent` (SMART=Flash en prod) → `persist_doc_flags_as_banderas` | `read_document_analysis()` (raw gana, `state_loaders.py:483-502`) | `legal_analysis` (JSON string) → BD `banderas` (`agente_origen='document_legal_analyst_agent'`) | `evidencia_textual` "max 300 chars" (prompt), `descr[:500]` al persistir (`persistence.py:262`); **sin documento ni página** en la bandera |
| 5 | `build_market_input` → `analyze_market_sharded` → `persist_market_flags_as_banderas` (`market.py`) | SQL `convocatoria_items`/`ofertas`, `parser_raw_consolidated`, `document_analysis`, `estudio_mercado`, `contrato_final` | `market_input`, `market_analysis` → BD `banderas` (`market_price_agent`) | `descripcion_corta[:300]` (`market.py:77`); chunks de 3 ítems, 8 workers, timeout 300 s (`:573-579`); items del LLM preferidos si son "más" (`:118-122`) |
| 6 | `get_ganador`, `query_oece_perfil` (+ `add_contextual_flag` por señal), `query_sunat_decolecta` (+ fallback web), `read_sunat_profile` | `ocds` | `sunat_decolecta`, `sunat_profiles`, `pending_flags` | `sanciones[:10]` etc. (`sunat.py:293-295`) |
| 6-8 ∥ | `web_research`, `news_research`, `entity_personnel` (Flash + `google_search`) en paralelo (`deterministic.py:748-803`) | inyección `sunat_decolecta` en web_research | `web_research`, `news_research`, `entity_personnel` (JSON string cada uno) | Mensaje de prensa con `objeto[:160]` (`:716`); guardrail de vacío reintenta 1× y deja stub tipado (`:513-530,725-746`) |
| 8b | `batch_person_lookup` sobre `funcionarios_designados` (`:820-828`) | `entity_personnel` | `batch_person_lookup_*` en state | 16 workers; fuzzy `pg_trgm` 0.45 (`personas.py:810,872,924,1116`) |
| 9 | `query_rnp_empresa` (ganador + rivales), `batch_person_lookup`, `detect_puerta_giratoria`, `read_person_network_context`, `person_network_agent` (SMART) | `document_analysis.firmantes*`, `ocds` | `person_network_context`, `person_network` | Contexto: 30 personas máx (`personas.py:536`), 5 aportes/candidaturas/visitas por persona (`:521-529`), 6 socios por postor (`:676`); luego **inyección cortada a 40 000 chars** (`_shared/instructions.py:69`) |
| 10 | `compliance_extended_agent` (FAST=flash-lite) 12 reglas + 2 flags de juicio; luego en el driver `evaluate_normative_compliance` y `persist_alert_from_flags` (`deterministic.py:879-899`) | inyección `sunat_decolecta`, `web_research`, `person_network` | `pending_flags` (+12 reglas), `normative_compliance`, `causal_directa_invocada`, `acto_resolutivo_directa` | `hallazgos[:10]` al RAG (`compliance_rules.py:1226`); **DELETE de todas las banderas** (`persistence.py:147`) |
| 11 | `persist_analysis_outputs` checkpoint (`persistence.py:537-870`) | todo | BD `alertas.analisis_full`, `dictamen_markdown` | `_raw_text[:50000]` si un JSON no parsea (`:589`); `red_flags_*` del parser se eliminan (`:630-631`) |
| 12 | `report_writer_agent` (SMART) con única tool `get_dictamen_context` | ver §1.3 | `final_dictamen` | `_cap(5000/40)` o `(1400/10)` (`state_loaders.py:440-442`); guardrail de degeneración (`deterministic.py:931-974`) |
| 13 | `persist_analysis_outputs` final; en `main.py:329-419` safety-net (writer forzado si falta dictamen) y persist otra vez; self-eval (`main.py:425-573`); `agent_trace` a `analisis_full` (`:577-613`) | | | `final_response = final_dictamen[:2000]` (`deterministic.py:979`) |

### 1.3 Qué ve el report_writer (única fuente para el dictamen)

`get_dictamen_context` (`state_loaders.py:388-443`) devuelve exactamente: `ocds` **compactado** (`description[:800]`, `awards[:10]`, sin `parties`/`items`/`documents`, `:342-368`), `document_analysis`, `legal_analysis` (se elimina en reintento `:423-426`), `market_analysis`, `web_research`, `news_research`, `person_network`, `compliance_result` (texto libre del LLM de compliance), `normative_compliance` (≤10 hallazgos), `alerta_codigo`, `estudio_mercado`, `contrato_final`. **No ve**: `banderas` (lo persistido en BD, ni `state["banderas"]`), `entity_personnel`, `estado_real`, `analisis_postores`, `causal_directa_invocada`, `acto_resolutivo_directa`, `sunat_decolecta`, los resultados de las 12 reglas extendidas (salvo los que entraron en los 10 de `normative_compliance`), `validaciones_pendientes` (llegan por el mensaje, `deterministic.py:74-82`).

Consecuencia directa: el prompt exige "cubre TODAS las banderas" (`report_writer/prompt.py:51-53`) sobre un contexto que no las contiene → el modelo reconstruye banderas desde `compliance_result` (prosa) y `normative_compliance` (10), y completa el resto.

### 1.4 Dónde se pierde información (inventario)

1. **Texto del documento**: OCR → Gemini → solo campos discretos + resumen 300-1000 chars por ítem (`documentos.py:433-445`). El agente-parser tiene un prompt contradictorio que pide "copia LITERAL… tope ~6000 chars" (`document_parser/prompt.py:136`) pero la tool ya resumió a ≤1000. El texto nunca se persiste (no hay escritura de `texto_extraido` en el repo). Re-parseo en cada corrida.
2. **Documentos no leídos**: >12 en `list_documents`; >5 por decisión del LLM; dentro de ZIP/RAR solo 3 PDF + 3 DOCX; `.doc`, `.xls/.xlsx`, `.rar` con solo imágenes, ZIP con `.7z` → error sin registro en state; docs de `awards`/`contracts` sí se listan (`documentos.py:47-54`) pero no se registran en `documentos` (`ocds.py:348`).
3. **Páginas**: fallback sin DocAI renderiza máx 30 páginas rasterizadas (`_core.py:86`, `documentos.py:259`); shards de 12 páginas con solape 1 (`:172-173`); shards que no terminan en el presupuesto quedan como `error: parse timeout` y sus ítems no existen (`:1499-1506`). Con DocAI, si **un** chunk de 30 páginas lanza excepción, `extract_text_docai` devuelve `None` para todo el documento (`docai.py:186-188`) y se cae al render limitado.
4. **JSON truncado**: `max_output_tokens=65535` (`documentos.py:610`); `_safe_parse_json` cierra llaves y devuelve lo que alcanzó (`_core.py:186-248`) → ítems finales perdidos sin marca.
5. **Ítems**: gate `_es_fuente_req` descarta ítems de docs sin `contiene_requerimiento` ni requerimiento >40 chars (`documentos.py:1574-1578`); dedup por descripción+cantidad funde ítems distintos con misma descripción (`:1513-1534`); `sanitize_items_with_llm` puede fundir/descartar por juicio del LLM (`:1774-1916`); `build_market_input` excluye el ítem padre del análisis (`market.py:373-396`).
6. **Firmantes/comité**: gate por `tipo_documento_detectado` (`documentos.py:1589-1593`) descarta comité/motivos si el LLM clasificó mal el tipo; filtro de placeholders (`persistence.py:656-675`, `personas.py:400-417`) razonable.
7. **Banderas**: #1 y #2 del resumen; además `hallazgos[:10]` (`compliance_rules.py:1226`); `banderas[:12]` y `findings[:10]` en self-eval (`self_eval.py:178,203-204`).
8. **Contexto inyectado**: `make_state_aware_instruction` corta el JSON a 40 000 chars **a mitad de string** (`_shared/instructions.py:69`) para `market_input`, `sunat_decolecta`, `person_network_context`, `web_research`, `person_network`. Con 30 personas × (onpe+jne+pep+visitas) el contexto de red supera ese tope con facilidad → el person_network_agent recibe JSON inválido y no lo sabe.
9. **Sobreescrituras**: `state["banderas"]` se pisa en cada `persist_alert_from_flags` (`persistence.py:170`); `_last_agent_final` global (`deterministic.py:336`); `document_analysis` se reemplaza en 3.5 y 3.6; `estudio_mercado`/`contrato_final` "el más completo gana" (`documentos.py:1750-1757`) mezcla documentos distintos (p. ej. dos órdenes de compra).
10. **OCDS**: el writer recibe `ocds` compactado sin `items`, `documents`, `tenderers`, `numberOfTenderers` (`state_loaders.py:342-368`).

---

## 2. Causas de alucinación (ordenadas por impacto)

### 2.1 Alucinación determinista (código)

- **C2 único postor** (`compliance_rules.py:6-50`): ver hallazgo #3. `ofertas` solo contiene ofertas ganadoras (`ocds.py:324-346`), `n=1` siempre que haya award. Verificable con cualquier proceso con `tender.numberOfTenderers>1` y ganador al 100 %.
- **`directa_emergencia_sin_acto_resolutivo` ALTA** (`compliance_rules.py:502-520`) sobre un corpus que no es el documento (`:356-379`).
- **`inconsistencia_doc_vs_ocds`** (`compliance_rules.py:1003-1145`): `items_count_distinto` compara ítems OCDS vs ítems del parser **incluyendo sub-ítems** que el propio prompt pide desglosar (`document_parser/prompt.py:67-107`) → dispara "Indica manipulación de acta o publicación deficiente" (`:1134,1137`) por diseño. `cuantia_distinta` usa `cuantia_total` del primer PDF que la traiga (`documentos.py:1596-1597`), que puede ser el de un shard o un acta parcial.
- **`concentracion_entidad`** (`:696-753`) y **`firmante_vinculado_ganador`** (`:756-794`): reglas que promueven a bandera lo que un LLM con grounding "encontró" (hallazgo #8). Con `n_total=2` y 1 contrato en la misma entidad → 50 % → bandera.
- **`tipo_proceso_vs_monto`** aplica tope AS ≤400 UIT a todo (`:307-319`) aunque el comentario reconoce 1 800 UIT para obras (`:281-285`).
- **`ciiu_vs_objeto`**: keywords `"mayor"`, `"menor"` → categoría alimentos; `"obra"`, `"materiales"` → construcción (`:645-652`). Norma literal "Heurística".

### 2.2 Prompts y esquemas

- **Ejemplos con datos "reales"** que el modelo copia: `web_research/prompt.py:101-163` (RUC `20609860457`, "HIGH BUSINESS SOLUTIONS S.A.C.", "CORONEL SANCHEZ AMANDA ARLENY", 13 fuentes con `estado`), `market_price/prompt.py:348-445` (Yamata FY8500, S/. 3 499, URLs de mercadolibre), `person_network/prompt.py:242-347` (PEREZ TORRES JUAN CARLOS; bandera ejemplo con "Carlos Sanchez Obregon… GORE Arequipa" `:341`). Ya hubo contaminación documentada (`persistence.py:309-316`: carnes → volquetes). La regla "no copies el ejemplo" (`market_price/prompt.py:447-477`) es mitigación, no solución.
- **Obligación de cantidad**: "INCLUYE las 13+ fuentes listadas" (`web_research/prompt.py:169`), "MÍNIMO 15 QUERIES" (`news_research/prompt.py:34`, `web_research/prompt.py:39`), "mínimo 25 queries" (`person_network/prompt.py:108`), "MÍNIMO 8 búsquedas por ítem" (`market_price/prompt.py:128-130`), "LARGO esperado: 3000-6000 palabras" (`report_writer/prompt.py:100`). Exigir volumen sin evidencia induce relleno.
- **Sin cita obligatoria a documento/página**: el schema de `red_flags_documentales` solo pide `evidencia_textual` (`document_legal_analyst/prompt.py:218`) sin `documento`/`pagina`; al persistir queda `evidencia[:500]` y `fuente_url` = URL genérica del proceso (`persistence.py:233,262`). Ninguna bandera del sistema puede rastrearse a una página.
- **Sin "no sé" estructurado en salidas de juicio**: los schemas de agentes son texto libre (no `output_schema`); el "no encontrado" vive en prosa (`_shared/instructions.py:31-33`). Solo el parser y los jueces usan `response_schema`.
- **Campos calculados por el LLM**: `diff_pct`, `precio_mediana_mercado`, `rango_*`, `veredicto`, `total_estimado_mercado`, `sobreprecio_pct` (`market.py:591-595`, `market_price/prompt.py:313-333`). `edad_dias_al_contrato`, `concentracion_cliente_estado_pct` en web_research (`web_research/prompt.py:108,143`).
- **Inyección de JSON truncado** (`_shared/instructions.py:69`): el modelo recibe un objeto cortado y lo completa.
- **Prompt legacy contradictorio**: `document_legal_analyst/prompt.py:292` dice "LEE el state['document_analysis'] que te pasa el orquestador en el mensaje" (no llega en el mensaje); `web_research/prompt.py:25-36` describe un "bloque SUNAT en el mensaje" que no existe.

### 2.3 Parseo de salidas y fallbacks que meten texto libre

- `persist_analysis_outputs._try_parse` devuelve `{"_raw_text": s[:50000], "_parse_failed": true}` (`persistence.py:589`) → se persiste y el frontend lo muestra.
- `get_dictamen_context`: `out[k] = parsed if parsed else v` (`state_loaders.py:433-435`) → si el JSON de un agente no parsea, el writer recibe el string crudo (con posibles fences y prosa).
- `_safe_parse_json` intento 2 usa regex `\{[\s\S]+\}` (`_core.py:174`) → toma desde la primera `{` hasta la última `}`; intento 4 repara truncados sin marcar (`:186-248`).
- `main._rp_eval` (`main.py:467-490`) repite el patrón para self-eval.

### 2.4 Modelos, temperatura y verificación

- Ningún `Agent` fija `generate_content_config` (temperatura Vertex por defecto = 1.0 en 2.5) ni `planner` (thinking por defecto del modelo). Solo los raw calls: parser `temperature=0.0, top_p=0.1` (`documentos.py:608`), sanitize 0.0 (`:1852`), market 0.2 (`market.py:635`), jueces 0.0 (`self_eval.py:36,73,102,128`).
- Tier SMART = Flash en prod para legal/red/dictamen; FAST (flash-lite) para juicio en compliance_extended (hallazgo #9).
- **Sin validación determinista contra OCDS/SUNAT**: no hay chequeo de que los RUC/montos/fechas/razones sociales que aparecen en `legal_analysis`, `web_research`, `person_network` o el dictamen existan en `ocds.parties`, `awards`, `sunat_decolecta` o `rnp_*`. El único guard es `persist_market_flags_as_banderas` por solape de palabras objeto↔ítem (`persistence.py:309-389`).
- **Self-eval no bloquea**: `run_inline_evals` produce scores y razones; `main.py:497-573` solo los emite/persiste. Los jueces juzgan la bandera **sin ver la fuente** (`self_eval.py:180-192`: solo `regla`, `norma`, `evidencia[:400]`), con el mismo modelo que generó (`DEFAULT_GEMINI_MODEL`), y con topes `[:12]`/`[:10]`/`dictamen[:7000]`.
- **Reintento por vacío re-induce relleno**: "NUNCA respondas vacío… devolvé las listas vacías + un campo que lo indique" (`deterministic.py:522-525`) está bien planteado, pero para news el default sintético `resumen_ejecutivo="No se hallaron menciones…"` (`:739-744`) se persiste como si el agente lo hubiera concluido.
- **Guardrail del dictamen**: `_dictamen_problems` detecta README/tokens de control/cabecera (`deterministic.py:157-206`); el reintento reduce contexto (`_dictamen_compact`, `state_loaders.py:423-426,440`) → menos evidencia → más invención. La sanitización antepone un título (`:965-971`) sin marcar el dictamen como degradado.

---

## 3. Uso de modelos

### 3.1 Dónde se usa cada tier hoy

| Consumidor | Modelo (código) | En prod | Config LLM | Reintentos |
|---|---|---|---|---|
| `vigia_orchestrator` | `_MODEL_DEFAULT` (`orchestrator/config.py:8`) | 2.5-flash (no corre) | ninguna | patch `model_fallback` |
| `compliance_agent` | DEFAULT (`compliance/config.py:14`) | 2.5-flash | ninguna | patch |
| `document_parser_agent` (elige docs) | DEFAULT (`document_parser/config.py:9`) | 2.5-flash | ninguna | patch |
| `parse_document_pdf` (extracción) | `DEFAULT_GEMINI_MODEL` = env `GEMINI_MODEL` (default en código `gemini-3.5-flash`, `_core.py:87`) | 2.5-flash | `temp 0.0, top_p 0.1, response_schema, max_output 65535, timeout 120 s` (`documentos.py:607-611`) | `_gemini_call_with_retry` 6× (`_core.py:101-132`) **encima** del patch |
| `sanitize_items_with_llm` | `SANITIZE_ITEMS_MODEL` o DEFAULT (`documentos.py:1858`) | 2.5-flash | `temp 0.0, schema, 8192` | ídem |
| `document_legal_analyst_agent` | SMART (`document_legal_analyst/config.py:10`) | **2.5-flash** | ninguna | patch |
| market workers | `MARKET_WORKER_MODEL` default **hardcoded `gemini-2.5-flash`** (`market.py:570`) — no sigue `GEMINI_MODEL` | 2.5-flash | `temp 0.2, max_output 32768, google_search`, **sin schema** (`:633-637`) | retry 6× + patch |
| `market_price_agent` (fallback) | **hardcoded `gemini-2.5-pro`** (`market_price/config.py:6`) | no corre | ninguna | patch |
| `web_research`, `news_research`, `entity_personnel` | DEFAULT | 2.5-flash + `google_search` | ninguna | patch |
| `person_network_agent` | SMART (`person_network/config.py:6`) | **2.5-flash** | ninguna | patch |
| `compliance_extended_agent` | FAST (`compliance_extended/config.py:20`) | 2.5-flash-lite | ninguna | patch |
| `report_writer_agent` | SMART (`report_writer/config.py:8`) | **2.5-flash** | ninguna | patch |
| jueces self-eval | DEFAULT (`self_eval.py:42,79,108,134`) | 2.5-flash | `temp 0.0, schema` | retry 6× + patch |
| embeddings RAG | `gemini-embedding-001` (`_core.py:91`) | — | — | — |

Observaciones:
- **Reintentos apilados**: el monkey-patch (`model_fallback.py:102-133`: 4 intentos con 10/20/40/80 s + hasta 3 saltos de modelo) envuelve `Models.generate_content`, y los raw calls además lo envuelven con `_gemini_call_with_retry` (6 intentos, backoff ≤60 s). Peor caso por llamada saturada: 6 × (≈150 s × 4 modelos) ≈ 1 h; el `http timeout 120 s` del parser acota cada intento pero no el total. Riesgo real de agotar el wall de 3 600 s (`infrastructure/deploy/agent.sh:21`).
- **Semáforo global de 2** para raw calls (`_core.py:45-48`) — el parser paralelo (4 workers, `documentos.py:174`) se serializa a 2; los workers de mercado lo evitan a propósito (`market.py:639-642`).
- **Costo**: `_rate_for_model` clasifica por substring (`deterministic.py:97-107`); `usage_metadata.thoughts_token_count` no se suma (`deterministic.py:252-269`, `main.py:305-323`) → costo subreportado con modelos con thinking.
- `requirements.txt:2-3` (`google-adk>=1.0.0`, `google-genai>=0.8.0`) sin pin: cada deploy puede resolver una versión distinta de ADK/genai (local hay 1.19.0 / 1.52.0).

### 3.2 Qué hace falta para `gemini-3.6-flash` (y 3.5-flash / 3.5-flash-lite)

Verificado en el ADK instalado (1.19.0) y google-genai 1.52.0:
- `LlmAgent` acepta `generate_content_config`, `planner`, `output_schema` (firma inspeccionada). El validador **rechaza `thinking_config` dentro de `generate_content_config`** ("Thinking config should be set via LlmAgent.planner") y también `tools`/`system_instruction` ahí. → El thinking de cada sub-agente se configura con `planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(...))` en cada `agents/*/__init__.py`.
- `types.ThinkingConfig` expone `include_thoughts`, `thinking_budget`, `thinking_level`. Para la familia Gemini 3 el control es `thinking_level` (`"low"`/`"high"`; `"medium"` según modelo) y `thinking_budget` no aplica; para 2.5 es `thinking_budget`. **[no verificable en código]**: que `gemini-3.6-flash` acepte `medium`/`minimal`; probar con un smoke test antes de fijarlo.
- `output_schema` + tools: ADK usa schema nativo si `GOOGLE_GENAI_USE_VERTEXAI` y modelo ≥2 (`utils/output_schema_utils.py:31-38`); si no, inyecta la tool `set_model_response`. Aplica a 3.x. Que `response_schema` funcione junto a `google_search` grounding en Vertex para 3.6 **[no verificable en código]**; si no, mantener el patrón "JSON en texto + validación pydantic en el driver".
- Thought signatures: Gemini 3 exige devolver `thought_signature` en turnos con function calling. El ADK 1.19 conserva las `Part` completas del evento en la sesión (no hay manejo explícito en `models/google_llm.py`, que es lo esperado: pass-through). El comentario de `report_writer/config.py:13-17` sobre 400 al encadenar tools venía de una versión anterior; re-probar antes de mantener la restricción "una sola tool".
- Temperatura: para Gemini 3 la recomendación pública es mantener el default 1.0 (bajarla degrada/loopea). Los raw calls con `temperature=0.0` (parser, sanitize, jueces) y 0.2 (market) deben re-evaluarse por modelo; hacerlo configurable por env (`PARSER_TEMPERATURE`, etc.).
- `max_output_tokens=65535` es válido en 3.x (tope 65 536).
- `_FALLBACK_CHAIN` (`model_fallback.py:20-25`) no tiene `gemini-3.6-flash` ni `gemini-3.5-flash-lite` → con 3.6 como primario, un 503/429 solo reintenta y luego `raise` (no cambia de modelo). Añadir `"gemini-3.6-flash": ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"]` y `"gemini-3.5-flash-lite": [...]`.
- `_rate_for_model` (`deterministic.py:89-107`) y `main._rate_for_agent_name` (`main.py:57-61`): agregar tarifas 3.x y sumar `thoughts_token_count`.
- `MARKET_WORKER_MODEL` y `market_price/config.py:6` hardcodeados: atarlos a env/tier.
- `docs`/Terraform: `cloud_run.tf:57-59` y `models.py:12-14`.

### 3.3 Tier recomendado por agente (para la migración)

| Agente / llamada | Modelo | Thinking | Salida | Motivo |
|---|---|---|---|---|
| Extracción documental (`parse_document_pdf`) | gemini-3.6-flash | low | `response_schema` + cita de página | Es el cuello de calidad; el texto ya viene de DocAI |
| Selección de documentos | **sin LLM** (determinista por `documentType`/título) | — | — | Evita "hasta 5" y elecciones erráticas |
| `compliance_agent` | **sin LLM** (loop de tools en el driver) o 3.5-flash-lite para la síntesis | — | JSON | Las 5 tools no requieren juicio |
| `document_legal_analyst` | gemini-3.6-flash | high | `output_schema` con `evidencia[]` obligatoria | Razonamiento normativo |
| Market workers | gemini-3.6-flash (o 3.5-flash si costo) | medium/low | JSON validado + `grounding_metadata` | Grounding + aritmética en código |
| `web_research`, `news_research`, `entity_personnel` | gemini-3.5-flash | low | JSON validado | Tareas de búsqueda; volumen |
| `person_network` | gemini-3.6-flash | high | `output_schema` | Cruces con umbral alto |
| `compliance_extended` | 12 reglas **sin LLM**; 2 flags de juicio en 3.6-flash low | — | — | flash-lite no debe emitir juicio |
| `report_writer` | gemini-3.6-flash | high | markdown + validación de citas en código | Síntesis larga |
| `sanitize_items_with_llm` | gemini-3.5-flash-lite | none/low | schema | Decisión de índices |
| Jueces self-eval | gemini-3.5-flash (modelo ≠ generador) | low | schema | Independencia mínima |

---

## 4. Acoplamientos a BIENES

### 4.1 Inventario (qué asume ítems físicos con cantidad × precio unitario)

- **Parser (schema)**: `cantidad`, `unidad`, `precio_unitario_referencial`, `cuantia_referencial_item`, `marca_o_modelo_exigido`, `certificaciones_exigidas` ("al BIEN"), `valores_tecnicos_clave` (potencia HP/kW, capacidad, peso, alcance, año de fabricación, color, material), `garantia` (meses/horas), `condiciones_entrega`, `subitems` (canasta) — `documentos.py:286-449`; prompt PASO 3 `:823-891` ("cilindros, voltajes, presiones"); `estudio_mercado`/`contrato_final` (orden de compra, cronograma de entregas) `:548-603`. Agente-parser: desglose "bienes físicos distintos" `document_parser/prompt.py:67-107`.
- **Legal**: vectores a–f = marca única, certificación del bien, plazo de entrega, experiencia del postor, año de fabricación, specs convergentes (`document_legal_analyst/prompt.py:135-179`).
- **Market**: todo el módulo (`market.py:36-490` mezcla SQL `convocatoria_items` cantidad/precio_unit; `:581-614` retail peruano + factor mayorista por cantidad; `:373-396` padre/sub-ítems); `persist_market_flags_as_banderas` norma "Art. 12 … valor referencial razonable" (`persistence.py:418`). La matriz **omite `market` para servicios/consultoría/obras** (`backend/core/clasificacion.py:111-115,340-343`, `_item_fisico:231-250`) → hoy esos tipos **no tienen ninguna validación de precio**.
- **Compliance**: C2 sobre `convocatoria_items`/`ofertas` (por ítem); `tipo_proceso_vs_monto` topes de bienes/servicios (`compliance_rules.py:281-285`); `ciiu_vs_objeto` keywords (`:645-652`); `inconsistencia_doc_vs_ocds` cuenta ítems (`:1036-1040`).
- **Report writer**: sección fija "Validación de precios contra mercado" con tabla Ítem/Ofertado/Mercado/Δ% (`report_writer/prompt.py:54-63`); "Antecedentes del proveedor" pensado para empresa vendedora.
- **Self-eval**: `plausibilidad_precio` por ítem (`self_eval.py:202-229`); `coherencia_objeto_items` (`:245-274`).
- **Dictamen**: `_VALIDACION_TEXTO` (`deterministic.py:65-71`) ya prevé `infobras_avance` y `market_sin_items_fisicos` pero solo como texto.

### 4.2 Qué cambia por tipo

**SERVICIOS** (TDR, no EETT): unidad de análisis = **entregable/actividad** y **tarifa** (HH, mes, visita, km), no unidad física.
- Parser: nuevo bloque `servicio` con `alcance`, `actividades[]`, `entregables[] {nombre, plazo_dias, porcentaje_pago}`, `plazo_total_dias`, `personal_clave[] {cargo, profesion, experiencia_min_anios, dedicacion}`, `experiencia_postor {monto_facturado_min, n_contratos, rubro}`, `tarifas[] {concepto, unidad, precio_unitario}`, `penalidades[] {tipo, formula, tope_pct}`, `subcontratacion_permitida`, `forma_pago`, `lugar_prestacion`. Sacar `marca`, `garantia horas`, `año fabricación` del schema base (o hacerlos opcionales por perfil).
- Legal: vectores de servicios: personal clave sobre-exigido (grado/años desproporcionados al monto), experiencia en soles > 3× valor, plazo de ejecución irreal, prohibición de subcontratación + personal exclusivo, "servicio personalísimo"/"notoria especialización" como causal (`_CAUSALES_DIRECTA g,i,j` ya existen en `_core.py:73-80`), penalidad de mora atípica.
- Market: comparación **contra histórico SEACE** (misma entidad/otras: `convocatorias` por CUBSO/objeto normalizado, tarifas mes/HH implícitas = monto/plazo/personal) y tarifas de referencia (planillas, colegios profesionales); no marketplaces retail. Veredicto por **costo mensual** y **costo por entregable**.
- Compliance: `tipo_proceso_vs_monto` con topes de servicios; regla nueva `personal_clave_vinculado` (cruce personal clave del TDR vs firmantes/entidad); C2 corregido.
- Dictamen: sección "Términos de referencia y proporcionalidad" en lugar de tabla de precios unitarios.

**OBRAS**: unidad = **expediente técnico + presupuesto + ejecución**.
- Parser: `obra {expediente_tecnico: {memoria, presupuesto_total, partidas[] {codigo, descripcion, metrado, unidad, precio_unitario, parcial}, gastos_generales_pct, utilidad_pct, plazo_dias, cronograma}, residente/supervisor requisitos, garantia_fiel_cumplimiento, adelantos}`; documentos `contractAmendment` → `adicionales[] {n, monto, pct_acumulado, motivo, resolucion}`, `ampliaciones_plazo[]`, `valorizaciones[]`. Los `awards`/`contracts` docs ya se listan (`documentos.py:47-54`) pero no se registran en `documentos` (`ocds.py:348`).
- Legal: adicionales >15 % sin autorización / >50 % (ya citado en `document_legal_analyst/prompt.py:122-124` pero sin datos), ampliaciones reiteradas, supervisor designado por directa, consorcios con capacidad máxima de contratación RNP.
- Market: no aplica precio unitario de bien; comparar **presupuesto vs partidas referenciales** (m², km, m³) e **histórico de obras similares** en SEACE; cruzar con INFOBRAS (avance físico/financiero, paralizaciones) — hoy solo hay el placeholder `infobras_avance` (`deterministic.py:66`).
- Compliance: `tipo_proceso_vs_monto` con 1 800 UIT; regla `adicional_acumulado` (contractAmendment); `consorcio_recurrente`.
- Red de personas: agregar residente/supervisor/consorciados como personas a investigar.

**OTROS (convenio / directa / consultoría)**: unidad = **causal + expediente de sustento**.
- Parser: `sustento_directa {causal_articulo, causal_texto, informe_tecnico {numero, fecha, firmante}, informe_legal {...}, acto_aprobatorio {tipo, numero, fecha}, cotizaciones[] {proveedor, ruc, monto}, proveedor_unico_justificacion, fecha_publicacion_seace}`; para convenio: `entidades_parte[]`, `objeto`, `aportes`, `vigencia`. `estudio_mercado` ya captura parte de esto (`documentos.py:548-576`).
- Legal: causal congruente con objeto (ya en prompt `:246-257`), acto resolutivo presente (usar el **texto completo**, no el resumen: hallazgo #5), publicación ≤10 días hábiles, fraccionamiento (misma entidad + mismo proveedor + mismo objeto en <90 días: query a `convocatorias`), recurrencia del proveedor en directas.
- Market: comparar contra las **cotizaciones del expediente** y el histórico; no retail.
- Dictamen breve por defecto (ya existe `_breve` para etapas negativas, `deterministic.py:915-918`); extender a directas.

### 4.3 Cómo separarlo en servicios Cloud Run

Un único código con **perfil por tipo** (`PIPELINE_PROFILE=bienes|servicios|obras|otros`) y cuatro servicios desplegados con distinto env, en vez de cuatro copias:
- `agents/_shared/profiles.py`: por perfil → lista/orden de agentes, schema del parser (base + bloque de tipo), vectores del legal (prompt parcial), estrategia de market (`goods_retail` | `historico_seace` | `presupuesto_obra` | `cotizaciones`), reglas de compliance activas y sus topes, secciones del dictamen, `_VALIDACION_TEXTO`.
- `deterministic.py` consume el perfil (hoy solo `agentes_permitidos`, `:52-60`).
- El dispatcher (`backend/dispatcher/main.py:262-270`) ya conoce `clasificacion.tipo` → enruta a la URL del servicio por tipo (`AGENT_URL_BIENES`, …).
- Terraform: 4 `google_cloud_run_v2_service` con el mismo `--source` y `PIPELINE_PROFILE` distinto; `--concurrency 1` y `--timeout 3600` como hoy (`infrastructure/deploy/agent.sh:19-22`).

---

## 5. Documentos

### 5.1 Cómo se descargan hoy

Cadena en `_fetch_doc_bytes` (`tools/documentos.py:959-1087`): (1) `state['docs_b64'][url]` inline (`:999-1006`); (2) `state['doc_urls'][url]` → GCS por SDK `gs://` o `https://storage.googleapis.com` (`:1008-1018`, `_download_from_gcs:1089-1127`); (2.5) `LOCAL_DOWNLOADER_URL` (VPS/relay residencial, POST `/download`, 180 s, devuelve `gcs_path`) (`:1024-1052`); (3) `OECE_RELAY_URL` Worker (`:1055-1068`); (4) directo (`:1071-1077`, 403 esperado desde GCP). Matching de URL normalizado (`:979-997`). El dispatcher pasa `doc_urls={url_origen: gs://…}` desde `documentos_vigentes(ocid)` (`backend/dispatcher/main.py:190-203,270`; función SQL en `db/migrations/15:19-25`, vigencia 90 días por `expira_at`).

- **Formatos**: PDF (`%PDF`), DOCX → PDF sintético con python-docx (`:1129-1237`, texto en páginas de 4 500 chars + imágenes), ZIP (recursivo hasta profundidad 2; PDF/DOCX/ZIP/imágenes) (`:1379-1434`), RAR con `unar`/`bsdtar` (`:1314-1367`). **No**: `.doc`, `.xls/.xlsx`, `.7z`, `.odt`, PDF cifrado.
- **Topes**: ZIP 3 PDF + 3 DOCX + 3 ZIP + 10 imágenes; RAR 3 PDF + 3 DOCX; `list_documents` 12; agente "hasta 5"; sin tope de bytes (memoria 8 Gi).
- **OCR**: DocAI si `DOCAI_PROCESSOR_ID` (`docai.py:41-42`), `imageless_mode`, chunks de 30 págs concatenados (`:142-188`), reconstrucción de tablas por layout (`:45-112`). Sin marcadores de página salvo el rango de chunk (>30 págs, `:180`). Fallback: PyMuPDF layout + render PNG 160 dpi de ≤30 páginas rasterizadas (`documentos.py:68-166,259`) + sharding de 12 págs (`:188-217`).
- **Cuántos se leen**: los que el LLM del parser decida (prompt "hasta 5"); en la práctica 1-5 llamadas a `parse_document_pdf`, cada una = OCR completo + 1 llamada Gemini (con DocAI) o N shards.
- **Caché**: solo `_parsed_doc_cache` por URL dentro de la corrida (`:1297-1300,1759-1761`). Nada entre corridas. `documentos.texto_extraido` nunca se escribe; `documentos` se borra y reescribe en cada `register_convocatoria_in_db` (`ocds.py:347`), por lo que no sirve como almacén.
- **Presupuestos de tiempo**: por llamada 120 s, por documento 600 s, global 700 s (`documentos.py:172-185,1476-1511`); `MARKET_TIMEOUT_S=300`.

### 5.2 Qué hace falta para "capturar en lote por id desde `documentos_gcs`" y persistir `texto_extraido`

1. **Tabla de texto por hash, no por corrida**: `documentos_texto (sha256 PK, ocid, url_gcs, formato, n_paginas, motor TEXT, version_parser TEXT, texto TEXT, paginas JSONB [{n, texto, chars}], truncado BOOL, creado_at)`. Clave `sha256` = la de `documentos_gcs` (`db/migrations/14:47`). No usar `documentos` (se borra cada corrida) ni `documentos_gcs` (expira a 90 días; el texto debe sobrevivir al blob).
2. **Selección determinista**: nuevo paso en `deterministic.py` (antes del paso 3) que lee `documentos_gcs` por `ocid` (o recibe `doc_ids[]` en el body), ordena por prioridad de `tipo`/título (Bases integradas > Bases > Resumen ejecutivo/Informe > EETT/TDR/Expediente > Acta/Cuadros > Contrato/Orden > Adendas > Absolución de consultas), y parsea **todos** hasta un tope explícito (`PARSE_MAX_DOCS`, p. ej. 12) registrando en state `documentos_omitidos[] {id, tipo, motivo}` para el dictamen. Elimina la elección por LLM (`document_parser_agent` queda como opcional).
3. **OCR una sola vez**: en `parse_document_pdf` consultar `documentos_texto` por sha256 antes de DocAI; si existe, saltar OCR. Escribir el texto (y por página) tras `extract_text_docai`. Añadir marcadores `⟦p.N⟧` por página en `_texto_con_layout` (bucle `docai.py:78`) y en el fallback (`documentos.py:135-166`) para que el extractor pueda citar página.
4. **Extracción por doc con cita**: el schema del parser agrega a cada ítem/firmante/red flag `evidencia: [{pagina, cita ≤200 chars}]` y `documento_sha256`. Persistir `parser_raw_consolidated` por documento en `documentos_texto.extraccion JSONB` (hoy solo vive en `analisis_full`).
5. **Lote**: endpoint `POST /?action=parse_batch {ocid, doc_ids[]}` o job separado (Cloud Run Job) que llene `documentos_texto` sin correr el pipeline; el orquestador luego solo lee texto. Concurrencia por `_GEMINI_CALL_SEM` (2) debe subir para el lote (env).
6. **Registro de topes**: cada tope (12 docs, 3 PDF por ZIP, 1 000 000 chars, `max_output_tokens`, timeout de shard) debe escribir `state['recortes'][]` con `{donde, limite, omitido}` y el dictamen listarlo (hoy nada de eso se ve).
7. Abrir `.doc/.xls/.xlsx` (LibreOffice headless o `openpyxl`/`xlrd` → texto) y ZIPs sin límite de 3 (usar prioridad, no orden de `namelist()`).

---

## 6. Recomendaciones priorizadas

Esfuerzo: S ≤ 1 día · M 2-4 días · L > 1 semana.

### 6.1 Cero pérdida de información

| P | Recomendación | Archivos | Esf. |
|---|---|---|---|
| 1 | **Corregir el borrado de banderas**: `persist_alert_from_flags` debe borrar solo `agente_origen='compliance_agent'` (patrón ya usado en `scripts/detect/run_compliance.py:328`) y recalcular `score` sumando todas las banderas de la alerta; consumir `pending_market_flags` en `persist_analysis_outputs` igual que `pending_doc_flags`. | `tools/persistence.py:147,83-84,491-498,806-840` | S |
| 2 | **Persistir texto OCR por sha256 y citar página** (§5.2 pts 1-4). | `tools/docai.py`, `tools/documentos.py`, `db/migrations/17_documentos_texto.sql` | M |
| 3 | **Selección determinista de documentos + registro de omitidos** (§5.2 pt 2, 6-7). Subir/abrir topes de ZIP/RAR; escribir `state['recortes']`. | `deterministic.py:604-612`, `tools/documentos.py:64,1333-1346,1393-1413`, `agents/document_parser/prompt.py` | M |
| 4 | **Pasar referencias, no resúmenes, al writer**: incluir en `get_dictamen_context` `banderas` (leídas de BD), `entity_personnel`, resultados de las 12 reglas, `estado_real`, `causal_directa_invocada`, `acto_resolutivo_directa`; sustituir `_cap` por paginación por sección con `truncado=true` y conteo omitido; no eliminar `legal_analysis` en el reintento. Subir `hallazgos[:10]` a todas las banderas (o priorizar por severidad). | `tools/state_loaders.py:388-443`, `tools/compliance_rules.py:1226` | S/M |
| 5 | **No cortar la inyección a 40 000 chars a mitad de JSON**: serializar por secciones y, si excede, recortar listas con marca `_truncado` (o pasar la data por tool en vez de instruction). | `agents/_shared/instructions.py:48-83` | S |
| 6 | **Parser: no resumir**: `requerimiento_tecnico_detallado` pasa a `texto_literal` (extracto literal con página) + campos discretos; el "resumen legible" lo hace el writer. Eliminar el gate `_es_fuente_req` o registrarlo como recorte. | `tools/documentos.py:433-445,1574-1578` | S |
| 7 | **JSON truncado**: si `_safe_parse_json` entra al intento 4 o `finish_reason=MAX_TOKENS`, marcar `_truncado=true` y re-pedir el resto (paginar ítems por rango de páginas). | `tools/_core.py:186-248`, `tools/documentos.py:926-936` | S |
| 8 | Registrar `awards`/`contracts` docs en `documentos` y dejar de borrar la tabla; usar `documentos_gcs` como catálogo. | `tools/ocds.py:347-357` | S |
| 9 | Contabilizar `thoughts_token_count` y tarifas 3.x. | `deterministic.py:89-107,252-269`, `main.py:57-61,305-323` | S |

### 6.2 Cero alucinación

| P | Recomendación | Archivos | Esf. |
|---|---|---|---|
| 1 | **Arreglar C2**: usar `tender.numberOfTenderers`/`parties[role=tenderer]` (ya se calcula en `detect_estado_real`, `compliance_rules.py:1386-1387`) y/o registrar todas las ofertas en `ofertas` (`ganadora=false`) desde `tender.tenderers`. | `tools/compliance_rules.py:6-50`, `tools/ocds.py:313-346` | S |
| 2 | **Acto resolutivo sobre el texto completo** (`documentos_texto`) + `estudio_mercado.causal_articulo/causal_texto`; devolver página y cita. Degradar la bandera a MEDIA con `requiere_verificacion` si solo hay resúmenes. | `tools/compliance_rules.py:348-414,502-520` | S |
| 3 | **Esquema de salida con `evidencia` obligatoria** para legal, market, person_network, web/news/entity: `output_schema` pydantic con `evidencia: list[{documento|url, pagina?, cita}]` y `estado: "hallado"|"sin_dato"|"no_verificable"`; el driver descarta ítems sin evidencia y los cuenta en `state['descartes']`. | `agents/*/config.py` (+ `output_schema`), `agents/_shared/schemas.py` (nuevo), `deterministic.py` | M |
| 4 | **Mercado verificable**: usar `response.candidates[0].grounding_metadata.grounding_chunks` como única fuente de URLs (rechazar URLs que no estén ahí), calcular mediana/Δ%/veredicto en código a partir de `precios_observados` validados, y `response_schema` en los workers (verificar compatibilidad con grounding en 3.6). | `tools/market.py:617-651,794-823`, `tools/persistence.py:405-438` | M |
| 5 | **Verificación determinista contra OCDS/SUNAT/RNP** antes de persistir: todo RUC/razón social/DNI/monto/fecha mencionado en una bandera o en el dictamen debe existir en `ocds.parties/awards/tender.value`, `sunat_decolecta`, `rnp_*`, `batch_person_lookup` o `documentos_texto`; si no, marcar `no_verificable` y no persistir como bandera. Implementar como `tools/verify.py` y llamarlo en `persist_*`. | `tools/verify.py` (nuevo), `tools/persistence.py`, `deterministic.py:977` | M |
| 6 | **Reglas alimentadas por LLM**: `concentracion_entidad` debe contar contratos en `convocatorias` (BD propia) y no en `web_research`; `firmante_vinculado_ganador` exige `fuente_url` verificable y `confianza_match='alta'`. `inconsistencia_doc_vs_ocds`: comparar solo ítems raíz (`padre_ocds_item is null`) y sacar el texto "manipulación de acta" de la evidencia. `tipo_proceso_vs_monto`/`ciiu` por perfil. | `tools/compliance_rules.py:696-794,1036-1040,1117-1137,281-319,645-652` | S/M |
| 7 | **Quitar ejemplos con datos verosímiles** de los prompts (sustituir por `<placeholder>`), y los mínimos de cantidad ("15 queries", "13+ fuentes", "3000-6000 palabras") por criterios de cobertura verificables. | `agents/web_research/prompt.py:101-169`, `market_price/prompt.py:348-445`, `person_network/prompt.py:242-347`, `news_research/prompt.py:34`, `report_writer/prompt.py:100` | S |
| 8 | **Self-eval que bloquea**: si `respaldo`<X o `coherencia=incoherente` o `tono=acusatorio`, marcar la alerta `estado='revision'` y no publicar; jueces con acceso a `documentos_texto`/`ocds` (verificar la cita, no la prosa) y con modelo distinto al generador. | `main.py:497-573`, `tools/self_eval.py` | M |
| 9 | Eliminar el fallback `_raw_text` a `analisis_full` y el `out[k]=v` crudo del writer: si un output no parsea, `sin_dato` + evento `warn`. | `tools/persistence.py:589`, `tools/state_loaders.py:433-435` | S |
| 10 | Dictamen: validación en código de que cada bandera citada existe en `banderas` y cada URL existe en algún output; marcar `degradado=true` cuando se sanitiza. | `deterministic.py:925-974`, `tools/verify.py` | S |

### 6.3 Perfiles por tipo (BIENES / SERVICIOS / OBRAS / OTROS)

| P | Recomendación | Archivos | Esf. |
|---|---|---|---|
| 1 | `agents/_shared/profiles.py` con perfil por `PIPELINE_PROFILE` (agentes, schema del parser por bloque, vectores legales, estrategia de market, reglas/topes, secciones de dictamen) y lectura en `deterministic.py`. | nuevo + `deterministic.py:52-60`, `main.py:82-128` | M |
| 2 | Parser: schema base + bloque por tipo (`servicio`, `obra`, `sustento_directa`) (§4.2). | `tools/documentos.py:263-606,808-923` | M |
| 3 | Market por perfil: `goods_retail` (actual), `historico_seace` (servicios/consultoría: query a `convocatorias`/`convocatoria_items` por CUBSO/objeto + tarifa mensual), `presupuesto_obra` (partidas vs referencias + INFOBRAS), `cotizaciones` (directa). Quitar la omisión ciega de `market` para no-bienes en la matriz. | `tools/market.py`, `backend/core/clasificacion.py:111-115,340-343` | L |
| 4 | Legal por perfil: prompts parciales por tipo; obras con `contractAmendment`. | `agents/document_legal_analyst/prompt.py:135-201` | M |
| 5 | Compliance por perfil: topes UIT por tipo, reglas nuevas (`adicional_acumulado`, `personal_clave_vinculado`, `fraccionamiento`, `directa_recurrente`). | `tools/compliance_rules.py` | M |
| 6 | Dispatcher enruta por tipo a 4 servicios; Terraform 4 servicios mismo `--source`. | `backend/dispatcher/main.py:262-270`, `infrastructure/terraform/cloud_run.tf`, `infrastructure/deploy/agent.sh` | S |

### 6.4 Modelos

| P | Recomendación | Archivos | Esf. |
|---|---|---|---|
| 1 | Restaurar tier SMART real (hoy Flash) y sacar el juicio de flash-lite (§3.3). | env del servicio; `agents/compliance_extended/config.py:20` | S |
| 2 | `planner=BuiltInPlanner(ThinkingConfig(thinking_level=..., include_thoughts=False))` por agente vía `config.THINKING`; `generate_content_config` con `temperature`/`max_output_tokens` por agente desde env; `thinking_config` en los raw calls. | `agents/*/__init__.py`, `agents/*/config.py`, `tools/documentos.py:607`, `tools/market.py:633`, `tools/self_eval.py` | S |
| 3 | `_FALLBACK_CHAIN` y tarifas con 3.6/3.5/3.5-lite; `MARKET_WORKER_MODEL` y `market_price/config.py:6` atados a tiers; pin `google-adk`/`google-genai`. | `agents/_shared/model_fallback.py:20-25`, `deterministic.py:89-107`, `tools/market.py:570`, `requirements.txt` | S |
| 4 | Desapilar reintentos: que los raw calls usen **solo** una capa (el patch) con techo total por llamada (`deadline`), y que el semáforo sea configurable. | `tools/_core.py:45-48,101-132`, `agents/_shared/model_fallback.py:102-133` | S |
| 5 | Smoke test de migración a 3.6-flash: `output_schema`+tools, `google_search`+schema, thought signatures con 2+ tools, `temperature` default vs 0.0 en el parser, `thinking_level` aceptado. | `backend/agent/tests/` (nuevo) | S |
| 6 | Sustituir `compliance_agent` y las 12 reglas de `compliance_extended` por loops en el driver (ya se hizo con RAG/persist en `deterministic.py:888-899`); dejar al LLM solo la síntesis/juicio. | `deterministic.py:595-601,879-887` | S |

### 6.5 Orden sugerido de ejecución

1. Semana 1 (S): 6.1-1, 6.2-1, 6.2-2, 6.2-6, 6.1-4, 6.1-5, 6.4-1, 6.4-3 — corrige las pérdidas y falsos positivos más graves sin cambiar arquitectura.
2. Semana 2 (M): 6.1-2, 6.1-3, 6.1-6/7 — texto persistido con página; selección determinista; parser literal.
3. Semana 3 (M): 6.2-3, 6.2-4, 6.2-5, 6.2-8 — evidencia obligatoria + verificación determinista + self-eval bloqueante.
4. Semana 4+ (M/L): 6.3 perfiles y 4 servicios; 6.4-2/5 migración de modelo con smoke tests.

---

## Anexo A — Constantes y topes encontrados

| Constante | Valor | Ubicación |
|---|---|---|
| `list_documents` | 12 docs | `tools/documentos.py:64` |
| Docs a parsear (prompt) | 5 | `agents/document_parser/prompt.py:27` |
| ZIP: PDF / DOCX / ZIP anidado / imágenes | 3 / 3 / 3 / 10; profundidad 2 | `tools/documentos.py:1393,1397,1406,1413,1387` |
| RAR: PDF / DOCX | 3 / 3 | `:1333,1339` |
| DocAI páginas por llamada | 30 | `tools/docai.py:27` |
| Texto DocAI a Gemini | 1 000 000 chars | `tools/documentos.py:771` |
| Render páginas rasterizadas (fallback) | 30 | `tools/_core.py:86`, `documentos.py:259` |
| Shard páginas / umbral / workers | 12 / 16 / 4 | `tools/documentos.py:172-174` |
| Timeouts parser: llamada / doc / global | 120 s / 600 s / 700 s | `:177-185` |
| `max_output_tokens` parser / sanitize / market | 65 535 / 8 192 / 32 768 | `:610,1853`; `market.py:636` |
| `requerimiento_tecnico_detallado` | "300-1000 chars" | `tools/documentos.py:436` |
| Inyección de state a prompt | 40 000 chars | `agents/_shared/instructions.py:69` |
| `get_dictamen_context` `_cap` | 5 000 chars / 40 ítems; reintento 1 400 / 10 | `tools/state_loaders.py:440-442` |
| `_compact_ocds` | `description[:800]`, `awards[:10]` | `:357,366` |
| `normative_compliance` | 10 hallazgos | `tools/compliance_rules.py:1226` |
| Self-eval | 12 banderas, 10 precios, dictamen 7 000 chars | `tools/self_eval.py:178,204,240` |
| Personas en contexto de red / por persona | 30 / 5 aportes-candidaturas-visitas / 6 socios por postor | `tools/personas.py:536,521-529,676` |
| Fuzzy `pg_trgm` | 0.45 (ONPE/JNE/PEP/visitas), 0.55 (RNP) | `personas.py:810,872,924,1116,206` |
| Market chunk / workers / timeout / retry | 3 / 8 / 300 s / 1 pase extra | `tools/market.py:573-579` |
| `evidencia` bandera | 500 chars; `norma` 200-300 | `tools/persistence.py:51-54,262,516` |
| `_raw_text` fallback | 50 000 chars | `tools/persistence.py:589` |
| Semáforo Gemini raw | 2, intervalo 0.25 s | `tools/_core.py:45-48` |
| Reintentos | patch 4× (10/20/40/80 s) × 3 saltos; `_gemini_call_with_retry` 6× ≤60 s | `model_fallback.py:27-28`, `_core.py:101-132` |
| Cloud Run | 8 Gi / 2 CPU / 3 600 s / concurrency 1 | `infrastructure/deploy/agent.sh:19-22` |

## Anexo B — Cosas que no se pudieron determinar leyendo el código

- Comportamiento exacto de `gemini-3.6-flash`/`3.5-flash` en Vertex respecto a `thinking_level` válidos, `response_schema` junto a `google_search`, y sensibilidad a `temperature=0.0`.
- Versión de `google-adk`/`google-genai` efectivamente instalada en la imagen desplegada (requirements sin pin).
- Si `GOOGLE_API_KEY` está montada en el servicio y `GOOGLE_GENAI_USE_VERTEXAI=true` prevalece (según `_core.py:295-300` sí, si la env está en `true`).
- Distribución real de documentos por proceso (cuántos exceden 12/5, cuántos ZIP superan 3 PDF): requiere consulta a `documentos_gcs`.
- Frecuencia real del falso positivo C2: requiere `SELECT` sobre `alertas.reglas_disparadas @> '{unico_postor_alto}'` cruzado con `numberOfTenderers` del `ocds_payload`.
