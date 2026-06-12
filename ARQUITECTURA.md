# Vigía Perú · Arquitectura (as-built)

> Arquitectura **realmente construida** de Vigía Perú — qué servicios existen, qué hace cada uno
> y cómo se conectan. Compañera de [`OBSERVABILITY.md`](OBSERVABILITY.md) (track de Arize) y
> [`SOLUCION.md`](SOLUCION.md) (flujo de datos end-to-end).
>
> **Contexto:** Google Cloud Rapid Agent Hackathon · track de observabilidad **Arize**.
> Lo que sigue es lo desplegado y funcionando, no un diseño futuro (el roadmap está al final, §8).

---

## 1. Vista de servicios (lo construido)

```
                 ┌─────────────────────────────┐
   Browser ─────▶│ vigia-peru-frontend         │──REST──▶ vigia-peru-api ──read──▶ Cloud SQL
   (mapa,        │ Next.js 14 · Cloud Run      │         (Hono/TS · Cloud Run        (PostgreSQL
   dossiers,     │ mapa · dossiers · denuncias │          · cache + gzip)             + PostGIS)
   denuncias)    └──────────────┬──────────────┘                                          ▲
                        POST /analyze (stream NDJSON)                                      │ write
                                 ▼                                                         │
                 ┌─────────────────────────────────────────────────────────┐             │
                 │ agent-orchestrator-adk · Cloud Run (Cloud Functions gen2) │─────────────┘
                 │ Python + Google ADK · 11 agentes · maxInst 5 · conc 1     │
                 └───┬─────────┬──────────┬───────────┬──────────┬───────────┘
                     ▼         ▼          ▼           ▼          ▼
              Vertex AI   Document AI  Vertex AI   Cloud       relay (Lima) ──▶ OECE/SEACE
              Gemini 2.5   OCR         Search       Storage    + Cloudflare      SUNAT·INFOBRAS
              Flash/Lite               (RAG 721                 Worker           ONPE·JNE·MEF
              (global)                  opiniones OECE)
                     │
                     ▼  spans OTEL (OpenInference)
              Arize AX + Phoenix Cloud   ·   Secret Manager inyecta credenciales

   vigia-mcp · Cloud Run (MCP) ──read──▶ Cloud SQL   →   clientes LLM externos (periodista/fiscal)
```

---

## 2. Componentes construidos

| Servicio | Runtime | Qué hace | Estado |
|---|---|---|---|
| **vigia-peru-frontend** | Cloud Run · Next.js 14 | Mapa interactivo, dossiers, formulario de denuncias; dispara análisis (stream NDJSON) y lee dossiers vía la API | ✅ |
| **vigia-peru-api** | Cloud Run · Hono/TS | API de **lectura** (dossiers/alertas/entidades/reportes) con cache + gzip; descarga al orquestador | ✅ |
| **agent-orchestrator-adk** | Cloud Run (Cloud Functions gen2) · Python + ADK | Pipeline de **11 agentes**; único servicio de escritura; `maxInstances=5`, `concurrency=1` | ✅ |
| **vigia-mcp** | Cloud Run · MCP | Expone alertas + evidencia como tools read-only a clientes LLM externos | ✅ |
| **relay (downloader)** | VPS Lima · FastAPI | IP residencial PE para leer portales `.gob.pe` (dan 403 a IPs de nube); stagea PDFs a GCS | ✅ |
| **oece-relay** | Cloudflare Worker | Proxy de fallback que bypassa el WAF del OECE | ✅ |
| **Vertex AI (Gemini 2.5)** | Servicio GCP | Razonamiento de los agentes: **Flash** (principal) + **Flash-Lite** (extracción), endpoint **global** | ✅ |
| **Document AI** | Servicio GCP | OCR de los PDFs del expediente (per-use, imageless) | ✅ |
| **Vertex AI Search** | Servicio GCP | RAG sobre **721 opiniones normativas del OECE** (con fallback a pgvector) | ✅ |
| **Cloud SQL (PostgreSQL + PostGIS)** | Datastore GCP | Ciclo de vida, alertas, banderas, red empresarial, pines geo | ✅ |
| **Cloud Storage** | Datastore GCP | Staging de documentos y fotos de reportes | ✅ |
| **Secret Manager** | GCP | 4 secretos (Cloud SQL, Google API, Phoenix, Pinecone) — sin claves en texto plano | ✅ |
| **Firebase Authentication** | GCP | Login de la demo | ✅ |
| **Arize AX + Phoenix Cloud** | SaaS | Recibe spans OTEL (OpenInference) del orquestador — track de observabilidad del hackathon | ✅ |

---

## 3. Decisiones técnicas clave (y por qué)

- **Gemini vía Vertex AI endpoint `global`.** Los proyectos nuevos sufren 429 agresivos por región;
  el endpoint global enruta entre regiones y permite que las convocatorias doc-pesadas completen.
- **Document AI en vez de Gemini Vision página por página.** Se hace OCR del documento completo
  (imageless, chunks de ≤30 págs) y se concatena el texto → **una sola llamada a Gemini por
  documento**. Más rápido, más barato, sin truncar (detalle en §7).
- **RAG legal con Vertex AI Search.** Las 721 opiniones del OECE indexadas → cada bandera cita la
  opinión normativa exacta (regla #6). Fallback a pgvector vía `LEGAL_RAG_BACKEND`.
- **Observabilidad (track Arize).** OpenInference instrumenta **Gemini (`GoogleGenAIInstrumentor`)
  y el Runner ADK (`GoogleADKInstrumentor`** — transfers entre agentes) → dual-export a **Arize AX
  + Phoenix Cloud**. El dossier linkea a su traza vía `phoenix_trace_id`. Self-eval inline: 6
  evaluadores (4 LLM-as-judge + 2 deterministas).
- **Persistencia resiliente.** El `analisis_full` se persiste en un **checkpoint ANTES del
  dictamen** (el paso más largo) → un timeout ya no deja el dossier vacío.
- **Relay residencial PE.** VPS en Lima (`LOCAL_DOWNLOADER_URL`) baja OCDS + PDFs por IP peruana;
  Cloudflare Worker como fallback. Sin esto, la capa máquina queda ciega.
- **Lectura ≠ escritura.** Los dossiers cacheados se sirven por `vigia-peru-api` (barato); el
  orquestador (caro) solo corre análisis **nuevos**.
- **Escala para demo.** Orquestador `maxInstances=5`, `concurrency=1` → varios análisis en paralelo
  (jurados) sin abortarse entre sí.
- **Optimizaciones de costo/latencia.** Caché de parseo por URL (no re-OCR del mismo PDF en un run)
  y dedup semántico de ítems (no tasar el mismo ítem dos veces contra el mercado).

---

## 4. Costos (medidos)

| Concepto | Valor |
|---|---|
| **Por análisis completo** | **≈ 1 sol (US$0.30)** · ≈ 12 llamadas Gemini · ≈ 245K tokens |
| OCR (Document AI) | per-use, ~$1.50/1000 págs (free tier 1M págs/mes); ≤200 págs/análisis ≈ $0.30 |
| Vertex AI Search | **~$0/mes** (free tier 10 GiB + 10k queries; 721 docs ≈ 0.15 GiB) |
| Compute (Cloud Run × 4 servicios) | dentro del free tier / créditos en escala piloto |

> El número que importa: **vigilar un contrato del Estado cuesta lo mismo que un café**.

---

## 5. El servidor Vigía MCP

MCP **remoto (HTTP)** en **Cloud Run** que expone, a cualquier cliente LLM (Gemini/Cursor/etc.),
tools **read-only** sobre los datos de Vigía:

- `buscar_alertas(region, severidad_min)` → alertas de riesgo por zona.
- `riesgo_convocatoria(ocid)` → score + banderas de una convocatoria.
- `empresa_sancionada(ruc)` → estado en OSCE/sanciones.

Solo lectura, sin datos personales de ciudadanos (regla innegociable #2), password vía Secret
Manager. Distinto del **Phoenix MCP** (que introspecciona *nuestras* trazas): acá Vigía es el
**servidor** — un periodista pregunta desde su propio agente *"dame las alertas rojas de Áncash"*
y las recibe con su evidencia oficial. **Estado: ✅ desplegado.**

---

## 6. Flujo de datos del análisis

Detalle end-to-end en [`SOLUCION.md`](SOLUCION.md). En resumen, al pegar un código:
OCDS (vía relay) → reglas duras (compliance) → Document AI OCR + Gemini → precios vs mercado →
red empresarial + personas → RAG legal (Vertex AI Search) → **checkpoint de persistencia** →
dictamen. Todo trazado en Arize/Phoenix.

---

## 7. Document AI (OCR) — el flujo del parser

**El problema que resolvía.** El cuello de botella en runs doc-pesados era rasterizar cada página
a PNG y mandarla a Gemini Vision, shard por shard (un doc de 85 págs → ~7 llamadas multimodales
lentas, muchos tokens de imagen) — podía tardar ~60 min y chocar el wall de Cloud Run.

**El flujo construido (per-use, pago por página):**

```
PDF (cualquier tamaño)
   ├─▶ Document AI · OCR (imageless, chunks de ≤30 págs)  →  texto de alta fidelidad
   │       (concatena los chunks → documento completo en texto)
   └─▶ Gemini (1 llamada de TEXTO con schema)  →  ítems, specs, banderas → state['document_analysis']
   (fallback automático al render PNG + Gemini Vision si Document AI falla)
```

**Implementación:**
- `tools/docai.py::extract_text_docai(pdf_bytes)` — OCR del PDF (chunks de 30 págs, concatenación).
- `tools/documentos.py::_parse_single_pdf_with_gemini` — intenta Document AI primero; si hay texto
  lo manda como `Part.from_text` y **omite el render de PNGs**; si falla, fallback al render.
- **Caché por URL** + **dedup semántico de ítems** evitan re-OCR y doble tasación.

**Config (env):** `DOCAI_PROCESSOR_ID`, `DOCAI_LOCATION=us`. SA del orquestador con
`roles/documentai.apiUser`. **Por qué Gemini sigue:** Document AI hace el OCR; la estructuración
inteligente (qué es ítem, qué specs son decisivas, qué patrón es bandera) la hace Gemini sobre el
texto — OCR gestionado + razonamiento del LLM, en menos llamadas.

---

## 8. Roadmap (no construido — futuro)

Lo de abajo **no está implementado**; es la dirección a producción:

| Próximo paso | Resuelve |
|---|---|
| **Cloud Scheduler + Pub/Sub + Eventarc** | Ingesta diaria SEACE/OECE + convergencia automática alerta↔reporte ciudadano |
| **GCP Workflows** | Orquestación determinista de los cruces C1→C8 (Gemini solo extrae/redacta) |
| **BigQuery** | Cruces pesados sobre el dataset completo (2.5M + 1.44M filas) |
| **Vertex AI Agent Engine** | Runtime gestionado para ADK (sesiones, escalado, Memory Bank) — migración a producción |
| **Cloud Armor + Load Balancer** | WAF / anti-DDoS delante del mapa público |
| **Grounding con Google Search** | Reemplazar el scraping ad-hoc del `web_research_agent` |

Y a nivel producto: cruces C3–C8 completos, cobertura nacional, moderación de reportes (2 reportes
independientes en ≤30 días) y hand-off formal a periodistas / Contraloría / Fiscalía.
