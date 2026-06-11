# Vigía Perú · Arquitectura y propuesta de profesionalización

> Estado de la plataforma + propuesta de servicios GCP para llevarla a producción.
> Compañera de [`OBSERVABILITY.md`](OBSERVABILITY.md) (track Arize) y [`SOLUCION.md`](SOLUCION.md).
> **Esto es propuesta** — lo marcado como "construido" ya está; el resto es diseño.

---

## 1. Estado actual (construido)

```
┌──────────────────────────────┐      ┌─────────────────────────────┐
│ Frontend (Next.js)           │      │ Orquestador ADK             │
│ Cloud Run · mapa + búsqueda  │◀────▶│ Cloud Function gen2         │
│ vigia-peru-frontend          │ SSE  │ 8GiB/2cpu · maxInst 3       │
└──────────────────────────────┘      │ 11 sub-agentes (AgentTool)  │
                                       │ Gemini → Vertex AI (global) │
                                       └──────┬──────────────┬───────┘
                                              │              │
                                   ┌──────────▼───┐   ┌──────▼─────────────┐
                                   │ Cloud SQL     │   │ Phoenix Cloud      │
                                   │ Postgres+PostGIS│  │ trazas + evals     │
                                   │ alertas/banderas│  │ (phoenix-mcp)      │
                                   └───────────────┘   └────────────────────┘
```

- **Gemini vía Vertex AI endpoint `global`** (minimiza 429; las convocatorias doc-pesadas ahora completan).
- **Observabilidad**: OpenInference instrumenta **Gemini (`GoogleGenAIInstrumentor`) Y el Runner ADK (`GoogleADKInstrumentor`, transfers entre agentes)** → dual-export Arize AX + Phoenix Cloud; evals como anotaciones de span; el dossier linkea a la traza vía `phoenix_trace_id` (ver `OBSERVABILITY.md`).
- **Parser con Document AI (OCR)**: en vez de rasterizar cada página a PNG y mandarla a Gemini Vision (lento, muchos tokens), **Document AI hace OCR del PDF → texto** y Gemini estructura el texto. Fallback automático al render histórico si Document AI falla. Parser acotado (timeout por-llamada 300s, techo global 700s).
- **Persistencia resiliente**: el análisis completo (`analisis_full`) se persiste en un **checkpoint ANTES del dictamen** (paso más largo) → un timeout ya no deja el dossier vacío.
- **Puente residencial PE (relay)**: VPS en Lima (`LOCAL_DOWNLOADER_URL`) baja OCDS + PDFs por IP peruana (OECE/SEACE dan 403 a IPs de GCP). Cloudflare Worker como fallback.
- **Escala**: orquestador `maxInstances=5`, `concurrency=1` → varios análisis en paralelo (jurados/demo) sin que se aborten.

---

## 2. Propuesta por capa (qué agregar y qué resuelve)

| Servicio GCP | Resuelve | Cómo lo usaríamos | Estado |
|---|---|---|---|
| **Vertex AI Search** 💰 | `cita_evidencia` bajo + regla #6 | Indexar las **721 opiniones normativas OECE** → RAG con grounding; cada bandera cita la opinión D0XX correcta | propuesta |
| **Document AI** (OCR) | Lentitud del parser | OCR gestionado del PDF → **texto** para Gemini (1 llamada barata/shard) en vez de rasterizar página por página a Gemini Vision. Per-use (~$1.50/1000 págs) | **✅ construido** |
| **Vertex AI Agent Engine** 💰 | Orquestador en Cloud Function | Runtime gestionado para ADK: sesiones, escalado, tracing nativo | propuesta |
| **GCP Workflows** | LLM orquestador cuelga/alucina | Orquestación **determinista** de los cruces C1→C8; Gemini solo para extraer/redactar | propuesta |
| **Cloud Scheduler + Pub/Sub + Eventarc** | Ingesta manual | Ingesta diaria SEACE/OECE → cola → trigger automático de análisis y de convergencia ciudadano↔alerta | propuesta |
| **BigQuery** | Cruces pesados (2.5M+1.44M filas) | Capa analítica para C1–C8; Cloud SQL queda para lo transaccional | propuesta |
| **Secret Manager** | API keys en texto plano | Mover PHOENIX/GOOGLE/PINECONE keys a secretos + rotar | **en curso** |
| **Vigía MCP (Cloud Run)** | Exponer datos a agentes externos | MCP remoto: `buscar_alertas`, `riesgo_convocatoria`, `empresa_sancionada` | **construyendo** |
| **Cloud Armor** | Sitio cívico = blanco | WAF + anti-DDoS delante del mapa público | solo costo (no implementar) |
| **Cloud Monitoring/Trace/Error Reporting** | Ops nativa | Dashboards + alertas (ej: corrida que golpea el wall) | propuesta |

💰 = candidato a usar el crédito de $1000 de Gen AI / Vertex.

---

## 3. Costos estimados (USD/mes, escala piloto)

> Validado con investigación de pricing oficial de Google Cloud (2026). _Sección poblada por la corrida de hoy._

| Servicio | Modelo de cobro | Estimado piloto | ¿Cubre el crédito $1000? |
|---|---|---|---|
| **Vertex AI Search** | $5/GiB-mes índice · $4/1k queries (Enterprise, incluye respuestas generativas) | **~$0/mes** (entra en free tier: 10 GiB + 10k queries/mes gratis; 721 docs ≈ 0.15 GiB) | **Sí, de sobra** (meses de piloto ≈ $0) |
| **Vertex AI Agent Engine** | $0.0864/vCPU-h + $0.0090/GiB-h (tokens Gemini aparte) | **~$3–35/mes** compute (free tier 50 vCPU-h + 100 GiB-h); 100→500 corridas/mes | Sí (tokens Gemini aparte, también del crédito) |
| **Cloud Armor (Standard) + Load Balancer** | Política $5 + $1/regla + $0.75/M req · LB $0.025/h + $0.008/GiB | **~$30–40/mes** (dominado por el LB ~$18 fijo, NO por Armor) | n/a (no usa crédito Gen AI) |

> Nota Cloud Armor: el costo lo manda el **Load Balancer obligatorio** (~$18/mes fijo), no el WAF (~$11-19). El tier **Managed Protection Plus = $3,000/mes** es ~100× y solo se justifica con DDoS activo / SLA empresarial → **overkill para el MVP**.
> Nota Agent Engine: las unidades de compute son **iguales** a Cloud Function gen2 (ambos sobre Cloud Run) → migrar no encarece; se paga ~lo mismo y se gana runtime gestionado + sesiones + tracing nativo.

---

## 4. Roadmap priorizado (impacto/esfuerzo)

1. **Vertex AI Search** sobre opiniones OECE → arregla `cita_evidencia` + grounding (alto impacto, usa el crédito). ✅ migrado.
2. **Document AI** → mata la lentitud del parser de raíz. ✅ construido (ver §7).
3. **GCP Workflows** → orquestación determinista (mata cuelgues + alucinación; "opción B" ya elegida).
4. **Secret Manager** → higiene de seguridad antes de publicar el repo.
5. **Eventarc/Scheduler/Pub/Sub** → ingesta continua + convergencia automática.
6. **Vigía MCP** → Vigía como fuente para el ecosistema (periodistas/fiscales con su propio LLM).
7. **Cloud Armor + Monitoring** → endurecer para producción pública.

---

## 5. El Vigía MCP (servicio nuevo)

MCP **remoto (HTTP)** en **Cloud Run** que expone, a cualquier cliente LLM
(Gemini/Cursor/etc.), tools read-only sobre los datos de Vigía:

- `buscar_alertas(region, severidad_min)` → alertas de riesgo por zona.
- `riesgo_convocatoria(ocid)` → score + banderas de una convocatoria.
- `empresa_sancionada(ruc)` → estado en OSCE/sanciones.

> Distinto del **Phoenix MCP** (que introspecciona *nuestras* trazas). Acá Vigía
> es el **servidor**: un periodista pregunta desde su propio agente *"dame las
> alertas rojas de Áncash"* y las recibe con su evidencia oficial.

Patrón: Cloud Run (no Cloud Function — maneja conexiones SSE persistentes),
conector Cloud SQL, password vía Secret Manager. Solo lectura, sin datos
personales de ciudadanos (regla innegociable #2).

**Estado:** ✅ construido y validado. URL:
`https://vigia-mcp-36169102688.us-central1.run.app/mcp`.

---

## 6. Plan detallado — Vertex AI Search + Agent Builder

> "Agent Builder" = paraguas de Vertex AI que incluye **Vertex AI Search** (RAG /
> data stores), **Agent Engine** (runtime gestionado de agentes), **Grounding** y
> los agentes no-code. Acá: qué hace cada pieza por Vigía, si conviene, y **qué
> reemplaza**.

### 6.1. Vertex AI Search — RAG del corpus legal OECE

**Qué hace Vigía HOY:** `consulta_rag_opiniones` (`tools/legal.py`) corre RAG sobre
las **723 opiniones normativas OECE** usando **Pinecone** (índice vectorial) +
embeddings Gemini (`_embed_one`) + top-K manual. Aparte, `lookup_opinion_oece`
hace búsqueda estructurada por SQL (norma/artículo exactos).

**Qué haría Vertex AI Search:** un *data store* gestionado que auto-chunkea,
embebe e indexa las 723 opiniones; cada query devuelve las opiniones relevantes
**con grounding** (respuesta sintetizada + cita exacta de la opinión D0XX). Sin
gestionar embeddings, frescura del índice, ni vendor externo.

**Qué REEMPLAZA:**
- ❌ **Pinecone** (`PINECONE_API_KEY`) → ✅ data store de Vertex AI Search. Saca un
  vendor + el pipeline de embeddings + una API key.
- El `_embed_one` + top-K manual en `legal.py` → una sola llamada de búsqueda.
- `lookup_opinion_oece` (SQL exacto) **se queda** — complementa la búsqueda
  semántica con lookups precisos por norma/artículo.

**¿Conviene? ✅ SÍ (alto valor / bajo costo).** Arregla `cita_evidencia` (0-40% →
alto) y la regla #6 (linkear a evidencia oficial), **~$0/mes** (free tier: 10 GiB
+ 10k queries; 721 docs ≈ 0.15 GiB).

> **Estado: ✅ MIGRADO (2026-06-09).** Data store `vigia-oece` + engine
> `vigia-oece-search`; 721 opiniones ingestadas; `query_legal_rag` (legal.py) usa
> Vertex AI Search como primario con **fallback a pgvector** (env
> `LEGAL_RAG_BACKEND`). Nota: el RAG previo ya era **pgvector** (no Pinecone) —
> self-hosted y gratis; esta migración es un upgrade de grounding/relevancia, no
> un quitar-vendor. pgvector queda como red de seguridad.

### 6.2. Agent Engine — runtime gestionado del orquestador

**Qué hace Vigía HOY:** el orquestador ADK corre en **Cloud Function gen2**, con
streaming SSE manual + manejo manual de `session_id`/estado en `main.py`.

**Qué haría Agent Engine:** hospeda el agente ADK **nativamente** (está hecho
para ADK) — sesiones gestionadas, escalado, **tracing nativo** (complementa
Phoenix), **Memory Bank** (memoria persistente entre corridas), Example Store.

**Qué REEMPLAZA:**
- Cloud Function gen2 (hosting) → Agent Engine. Cambia el deploy (SDK de Agent
  Engine, no `gcloud functions`) y el modelo de streaming.
- El plumbing manual de SSE + sesiones en `main.py` → la API gestionada.

**¿Conviene? 🟡 Producción sí, hackathon no.** Mismo costo de compute (~$3-35/mes,
idénticas unidades que Cloud Function). Gana runtime gestionado + sesiones +
tracing nativo + Memory Bank. PERO requiere migrar el deploy **y** la integración
de streaming del frontend (hoy pega al SSE de la Cloud Function; Agent Engine
tiene otra API → cambios en el frontend) + revalidar el dual-export a Phoenix.
Esfuerzo alto. Para el hackathon, ADK en Cloud Function ya satisface el requisito.

### 6.3. Grounding con Google Search

**Qué hace Vigía HOY:** `web_research_agent` hace búsqueda web ad-hoc (scraping
`.gob.pe`, tool `google_search`).
**Qué haría:** Grounding con Google Search de Vertex — integrado, confiable, con
citas. **Reemplaza** el scraping frágil. Esfuerzo bajo, costo incluido. 🟡 opcional.

### 6.4. Veredicto

| Pieza | Reemplaza | ¿Conviene? | Esfuerzo | Costo |
|---|---|---|---|---|
| **Vertex AI Search** (corpus OECE) | **Pinecone** + embeddings manuales | ✅ **SÍ** | medio día | ~$0/mes |
| **Agent Engine** (runtime) | Cloud Function + plumbing manual | 🟡 producción sí | alto (deploy + frontend) | ~igual |
| **Grounding c/ Google Search** | scraping ad-hoc del web_research | 🟡 opcional | bajo | incluido |

**Secuencia recomendada:** (1) Vertex AI Search para OECE — el mayor impacto y
saca Pinecone; (2) Grounding con Google Search para el web_research; (3) Agent
Engine — diferir a producción.

---

## 7. Document AI (OCR) — el nuevo flujo del parser ✅

**El problema que resuelve.** El cuello de botella medido en runs doc-pesados NO
eran los 429: era la **latencia de rasterizar cada página a PNG y mandarla a
Gemini Vision**, shard por shard (un doc de 85 págs → ~7 llamadas Gemini
multimodales lentas, muchos tokens de imagen). El análisis completo podía tardar
~60 min y chocar el wall de Cloud Run (3600s).

**El flujo nuevo (per-use, pago por página):**

```
PDF (shard ≤30 págs)
   │
   ├─▶ Document AI · OCR_PROCESSOR (1 llamada sync, ~1-2s, ~$0.0015/pág)
   │      └─▶ texto plano de alta fidelidad (incluye tablas y páginas rasterizadas)
   │
   └─▶ Gemini (1 llamada de TEXTO con schema estructurado)
          └─▶ ítems, specs, marca exigida, banderas documentales  → state['document_analysis']
```

Antes: `PDF + N×PNG → Gemini Vision` (N llamadas con imágenes).
Ahora: `Document AI → texto → 1× Gemini texto` (sin rasterizar).

**Implementación:**
- `tools/docai.py` — `extract_text_docai(pdf_bytes)` llama al processor OCR
  (`OCR_PROCESSOR`, location `us`). Síncrono, límite 30 págs/llamada.
- `tools/documentos.py::_parse_single_pdf_with_gemini` — intenta Document AI
  primero; si devuelve texto, lo adjunta como `Part.from_text` y **omite el render
  de PNGs**; si falla o no está configurado, **fallback** automático al render
  histórico (cero ruptura).
- Shards de ≤30 págs (`PARSE_PAGES_PER_SHARD`) para que cada shard entre en una
  sola llamada sync de Document AI.

**Config (env del orquestador):** `DOCAI_PROCESSOR_ID`, `DOCAI_LOCATION=us`,
`DOCAI_PROJECT` (default = `GOOGLE_CLOUD_PROJECT`). SA del orquestador con
`roles/documentai.apiUser`.

**Por qué Gemini sigue:** Document AI hace el OCR (texto), pero la **estructuración
inteligente** (qué es ítem, qué specs son decisivas, qué patrón es bandera,
desglose de lotes compuestos) la sigue haciendo **Gemini** sobre el texto. Es lo
mejor de ambos: OCR gestionado + razonamiento del LLM, en menos llamadas.

**Costo:** OCR ~$1.50/1000 págs (free tier 1M págs/mes los primeros). Un análisis
típico (≤200 págs) ≈ $0.30 de OCR — despreciable frente a los tokens de Gemini que
ahorra (ya no se mandan imágenes).
