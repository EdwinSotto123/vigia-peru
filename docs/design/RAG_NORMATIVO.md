# RAG normativo en GCP (Frente R · plan 2026-09-16 §3)

**Qué es.** El agente legal y el evaluador de cumplimiento de Vigía Perú citaban solo las 721
opiniones OECE (Vertex AI Search) y el marco normativo "de memoria" del modelo. Este frente carga
las normas primarias (Ley 32069 + D.S. 009-2025-EF; TUO Ley 30225 + D.S. 344-2018-EF), los
criterios vinculantes (Acuerdos de Sala Plena, Opiniones DTN) y las normas de control de la CGR
en **Vertex AI RAG Engine**, segmentadas por artículo, para que cada señal de riesgo cite
"Art. N de <norma> (<url oficial>)" con el texto literal recuperado y no inventado.

Código: `backend/rag/` (ingesta, corpus, consulta, evaluación) y `backend/agent/tools/legal.py`
(backend `rag_engine` de la tool `query_legal_rag`). Base de investigación: `rag-docs/propuesta.md`.

---

## 1. Comparación de arquitecturas y precios (verificados el 2026-09-16)

Escala de referencia: ≈ 6 000 páginas, ≈ 20 000 chunks, ≈ 3 000 consultas/mes (20 contratos/día
× ~5 consultas; cada consulta toca 2 corpus → ≈ 6 000 `retrieveContexts`/mes).

| | **A. Vertex AI RAG Engine (modo *serverless*)** — elegida | A'. RAG Engine modo Spanner, tier Basic (lo que proponía el plan) | **B. Vertex AI Search** (lo que ya usamos para las opiniones) | C. pgvector en Cloud SQL (fallback existente) |
|---|---|---|---|---|
| Costo fijo | **Ninguno**: "Serverless: Free for resource management and orchestration" [1] | **Sí**: instancia Spanner de 100 unidades de procesamiento (0,1 nodo) facturada por hora [2][3]; Spanner Standard us-central1 = US$ 0,90/nodo-hora [4] → 0,1 × 0,90 × 730 h ≈ **US$ 66/mes** (US$ 90/mes si la instancia gestionada usa edición Enterprise, US$ 1,23/nodo-h; la doc no precisa la edición) | Ninguno | Ninguno adicional (la instancia Cloud SQL ya existe) |
| Índice / almacenamiento | Vector Search 2.0 ("Agent Retrieval", payload DB): **US$ 0,000410959 / GiB-hora** (≈ 0,30/GiB-mes); escritura **US$ 0,18 / 100 000 operaciones** [5] → 20 k chunks ≈ 60 MB → < US$ 0,05/mes | incluido en la instancia Spanner | Data Index: **primeros 10 GiB/mes gratis**, luego US$ 0,006849315/GiB-hora (≈ US$ 5/GB-mes) [6] → US$ 0 a nuestra escala | espacio en Cloud SQL (~100 MB) |
| Consultas | Lecturas payload DB: **US$ 0,06 / 100 000** (1 lectura por cada 100 objetos escaneados + 1 por documento devuelto) [5] → 20 k chunks ≈ 205 lecturas/consulta × 6 000 ≈ 1,2 M ≈ **US$ 0,74/mes**; a los 6 k chunks actuales ≈ US$ 0,25/mes | incluido | Search Standard **US$ 1,50 / 1 000 consultas**, con **10 000 consultas/mes gratis por cuenta** [6] → US$ 0/mes a nuestra escala (US$ 9/mes si se pierde la franja gratuita) | gratis |
| Embeddings (una vez + consultas) | `text-multilingual-embedding-002` = "Embeddings for Text (excluding Gemini Embedding)": **US$ 0,000025 / 1 000 caracteres** online [7] → 20 k chunks × ~2 500 chars = 50 M chars ≈ **US$ 1,25 una vez**; consultas 6 000 × 250 chars ≈ US$ 0,04/mes | ídem | los calcula Vertex AI Search (incluidos) | `gemini-embedding-001` (US$ 0,00015 / 1 000 chars [7]) ≈ US$ 7,5 una vez |
| **Total mensual estimado** | **≈ US$ 0,3 – 1,0/mes** (+ ≈ US$ 0,2 – 1,3 una vez) | ≈ US$ 66 – 90/mes | ≈ US$ 0/mes mientras < 10 000 consultas y < 10 GiB | ≈ US$ 0/mes |
| Límites verificados | PDF ≤ 50 MB, DOCX ≤ 50 MB, TXT/HTML/JSON/MD ≤ 10 MB [8]; `RetrieveContexts` **600 RPM** por región; APIs de gestión 60 RPM; **3 imports concurrentes**; **10 000 archivos por ImportRagFiles** [9]; **≤ 25 URIs GCS explícitas por import** (directorios cuentan como una; error observado el 2026-09-16); **el filtro por metadata no está soportado en modo serverless** [10] → se enruta por corpus, no por filtro | ídem + filtro por metadata (solo v1beta1) | 10 000 consultas gratis; QPS según edición | sin límite de servicio |
| Calidad / integración | Chunks con `source_uri` → artículo exacto; corpus por régimen; REST simple desde la tool; también usable como `VertexRagStore` de Gemini | ídem | Extractos con página; sin control del chunking; buena búsqueda híbrida | sin híbrido ni rerank; mantenimiento propio |

**Fuentes (consultadas el 2026-09-16):**
[1] https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/deployment-modes ("Serverless … Free for resource management and orchestration"; "Spanner … Pricing depends on choice of tier"; Spanner es el modo por defecto de los proyectos nuevos).
[2] https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/spanner-mode (Basic = 100 unidades de procesamiento; Scaled = 1-10 nodos con autoscaling; Unprovisioned borra la instancia y detiene la facturación).
[3] https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/rag-engine/rag-engine-billing ("RAG Engine surfaces Spanner costs from your corresponding RAG-managed project to your Google Cloud project"; parser por defecto gratis; embeddings facturados al proyecto).
[4] https://cloud.google.com/spanner/pricing (Iowa us-central1, por nodo-hora: Standard US$ 0,90, Enterprise US$ 1,23, Enterprise Plus US$ 1,71; instancias granulares de 100 PU se facturan a prorrata).
[5] https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing → sección "Agent Retrieval" (Vector Search 2.0): Data Stored US$ 0,000410959/GiB-h; Read Operations US$ 0,06/100 000; Write/Update/Delete US$ 0,18/100 000; CU de ANN Performance-Optimized US$ 0,065/h (no usada: KNN sobre la payload DB basta a esta escala).
[6] https://cloud.google.com/generative-ai-app-builder/pricing (Search Standard US$ 1,50/1 000 consultas; Enterprise US$ 4,00; "10,000 queries per account, per month at no cost"; Data Index 0-10 GiB gratis, luego US$ 0,006849315/GiB-h).
[7] https://cloud.google.com/vertex-ai/generative-ai/pricing → "Embedding costs": Gemini Embedding input US$ 0,00015/1 000 (online); Embeddings for Text (excluding Gemini Embedding) US$ 0,000025/1 000 (online).
[8] https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/rag-engine/supported-documents.
[9] https://docs.cloud.google.com/vertex-ai/generative-ai/docs/quotas → "RAG Engine": data management 60 RPM, RetrievalContexts 600 RPM, textembedding-gecko 1 500 RPM (valor por defecto del documento; **en este proyecto el límite efectivo es 5 RPM**, ver §4), 3 ImportRagFiles concurrentes, 10 000 archivos por import.
[10] https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/use-metadata-search ("Not supported in serverless mode"; solo v1beta1).

No verificado: la edición de Spanner que usa la instancia gestionada del tier Basic (Standard vs Enterprise) — por eso el rango US$ 66-90/mes. La "RagManagedDb Basic sin costo de infraestructura" que suponía el plan **no existe**: Basic es una instancia Spanner de 100 PU facturada por hora. Lo gratuito hoy es el **modo serverless** (Vector Search 2.0 por uso).

### Decisión

**A (RAG Engine en modo serverless)** para los 4 corpus. El proyecto estaba en modo Spanner/Basic
por defecto (sin corpus aún, así que sin instancia facturada); se cambió a serverless con
`PATCH …/ragEngineConfig {"ragManagedDbConfig":{"serverless":{}}}` **antes** de crear el primer
corpus (`python -m backend.rag.corpus config --serverless`). B sigue sirviendo las opiniones como
fallback (dentro de su franja gratuita); C queda como último fallback. No se creó ningún recurso
con costo por hora (ni Spanner, ni CU de ANN, ni Enterprise edition).

Honestidad sobre B: a nuestra escala también costaría ≈ US$ 0. A se prefiere por (i) chunking
controlado: un archivo por artículo → cita exacta "Art. N"; (ii) un corpus por régimen y por peso
epistémico, elegido en código por `norma_aplicable(fecha_convocatoria)`; (iii) mismo mecanismo
para normas, criterios y control; (iv) escala lineal si entra `resoluciones-tce` (miles de PDF)
sin pasar a un tier con costo fijo.

---

## 2. Diseño

### 2.1 Corpus (RAG Engine, `us-central1`, embedding `text-multilingual-embedding-002`)

| Corpus | Contenido cargado (fase 1) | Uso |
|---|---|---|
| `normas-vigentes` | Ley 32069 consolidada (OECE, hasta 19-07-2026: incluye D.L. 1715, Leyes 32513/32515) · Reglamento D.S. 009-2025-EF consolidado (hasta 09-01-2026: incluye D.S. 001-2026-EF) · Ley 32513 (Presupuesto 2026) · TUO Ley 27444 · Directiva 0005-2025-EF/54.01 + 8 bases estándar 2025 (LP bienes, LP abreviada bienes, LP obras, CP servicios, CP abreviado, SIE, comparación de precios, no competitivos) | convocatoria ≥ 2025-04-22 |
| `normas-historicas` | TUO Ley 30225 (D.S. 082-2019-EF) · Reglamento D.S. 344-2018-EF consolidado por el OSCE (hasta 21-12-2024) | convocatoria < 2025-04-22 |
| `criterios-vinculantes` | Acuerdos de Sala Plena 004-2019, 008-2021, 002-2022, 002-2023, 003-2023, 004-2023/TCE, 002-2025, 003-2025/TCP · Opiniones 047-2021 y 093-2020/DTN · **721 filas** de `opiniones_oece_estructurado` (un .txt por interpretación) | siempre |
| `control-cgr` | Manual de Auditoría de Cumplimiento (versión integrada) · Directiva 013-2022-CG/NORM (control simultáneo) · Directiva 018-2022-CG/GMPL (control concurrente, versión integrada) · Ley 31288 · Ley 31358 | dictamen (Condición/Criterio/Causa/Efecto), bajo demanda (`incluir_control=True`) |
| `resoluciones-tce` | **fase 2, no creado** | precedentes por causal |

Las URL de las fichas de `rag-docs/propuesta.md` estaban en su mayoría rotas (404 en
`elperuano.pe/normas/pdf/...` y `busquedas.elperuano.pe`, IDs de gob.pe que redirigen a otra norma,
`portal.osce.gob.pe` sin respuesta). Cada fuente se re-localizó en gob.pe (página oficial + PDF en
`cdn.www.gob.pe`) y `descargar.py` verifica que la página responda 200 sin salir del dominio
institucional (con alias osce→oece). Las 3 fuentes no cargadas y sus motivos están en
`backend/rag/fuentes.yaml` (`activa: false`): Opinión 014-2019/DTN (PDF oficial no localizado),
Directiva 016-2023-CG/GMPL (PDF escaneado sin texto) y la Directiva 003-2025-CG/GMPL de la ficha 10
(no localizada; se cargó la 018-2022 que la precede).

### 2.2 Layout en GCS (`gs://vigia-peru-rag`, us-central1, Standard, sin lifecycle)

```
<corpus>/<slug>.pdf                       PDF oficial (siempre, aunque esté segmentado)
<corpus>/<slug>.metadata.json             documento, numero, emisor, regimen, tipo, vigencia, url_oficial(+verificada), sha256, páginas
<corpus>/<slug>/art-NNNN.txt              normas segmentadas: un archivo por artículo (cabecera: norma · Artículo N — título · [página p])
<corpus>/<slug>/disposiciones-complementarias.txt
<corpus>/<slug>.articulos.json            índice de artículos (fuera de la carpeta: la carpeta se importa entera)
criterios-vinculantes/opiniones/<id>.txt  721 opiniones (cabecera: Opinión N° · norma · artículos)
catalogo.json                             gs:// uri → metadata (lo lee legal.py, caché 1 h)
corpus.json                               resource names por corpus
_import/*.ndjson                          import_result_sink de cada ImportRagFiles (diagnóstico)
```

Metadata en modo serverless: el filtro por metadata de RAG Engine no está disponible [10], así que
la metadata no viaja dentro del índice: el chunk devuelve `source_uri` y la tool la resuelve
contra `catalogo.json` (`documento`, `articulo`, `pagina`, `url_oficial`, `regimen`, `tipo`).

### 2.3 Segmentación por artículo (`segmentar.py`)

pypdf por página → se quitan cabeceras/pies del diario oficial → regex `^Artículo N[.\-]` (y
romanos del Título Preliminar) → **secuencia creciente más larga** (descarta los 3 artículos del
D.S. aprobatorio y las referencias sueltas; tolera saltos ≤ 3 y encabezados repetidos) → un .txt
por artículo con cabecera; lo posterior al último artículo va a `disposiciones-complementarias.txt`.
Resultado: Ley 32069 = 100 artículos + DC; D.S. 009-2025-EF = 387 + DC; TUO 30225 = 62 + DC;
D.S. 344-2018-EF = 265 + DC; TUO 27444 = 6 romanos + 265 + DC; Ley 32513 = 86.

Chunking en RAG Engine: 512 tokens / solape 100 (`corpus.py`). Los artículos cortos quedan en un
chunk; los largos en varios, pero todos conservan el artículo vía `source_uri`.

### 2.4 Tool (`backend/agent/tools/legal.py`, `LEGAL_RAG_BACKEND=rag_engine`)

```
query_legal_rag(question, tool_context, regimen="")
  regimen ← argumento | norma_aplicable(fecha_convocatoria del OCDS en state)
  corpus  ← {normas-vigentes | normas-historicas} + criterios-vinculantes   (control-cgr con incluir_control=True)
  POST {us-central1}-aiplatform/v1/…:retrieveContexts por corpus (top_k = RAG_TOP_K, default 5)
  chunk → {corpus, documento, numero, tipo, regimen, articulo, pagina, cita, url_oficial, score, cita_formato}
          + claves legacy (num_opinion, norma, art_ley, art_reglamento, interpretacion_snippet, link)
  url_oficial → state["grounding_urls"]  (verify.py las acepta como URLs respaldadas por código)
  fallback en cascada: rag_engine → Vertex AI Search (opiniones) → pgvector
```

Variables: `LEGAL_RAG_BACKEND`, `RAG_CORPUS_NORMAS_VIGENTES`, `RAG_CORPUS_NORMAS_HISTORICAS`,
`RAG_CORPUS_CRITERIOS`, `RAG_CORPUS_CONTROL` (resource names), `RAG_LOCATION`, `RAG_BUCKET`,
`RAG_TOP_K`. Sin las `RAG_CORPUS_*` la tool se comporta como antes (Vertex → pgvector).

Prompt del agente legal (`agents/document_legal_analyst/prompt.py`): `norma_citada` copia
`cita_formato` tal cual y solo puede citar artículos/URLs devueltos por la tool.
`verify.py`: `elperuano.pe` se suma a los dominios oficiales; las `url_oficial` del catálogo
llegan por `grounding_urls`.

---

## 3. Operación

```bash
# entorno (una vez)
python -m venv backend/rag/.venv && backend/rag/.venv/Scripts/python -m pip install -r backend/rag/requirements.txt
PY=backend/rag/.venv/Scripts/python

$PY -m backend.rag.corpus config --serverless          # ANTES del primer corpus (evita la instancia Spanner)
$PY -m backend.rag.descargar                            # PDF + metadata → GCS, catalogo.json
$PY -m backend.rag.segmentar                            # artículos → GCS
PGHOST=<ip pública Cloud SQL> $PY -m backend.rag.opiniones   # 721 opiniones → GCS (password de .cloudsql-password)
$PY -m backend.rag.corpus crear                         # 4 corpus (imprime las env RAG_CORPUS_*)
$PY -m backend.rag.corpus importar --rpm 5 --no-esperar # LRO del lado del servidor (horas con 5 RPM); ver §4
$PY -m backend.rag.corpus estado
$PY -m backend.rag.consultar "plazo mínimo entre convocatoria y presentación de ofertas en licitación pública" --regimen 32069 --top 5
$PY -m backend.rag.evaluar                              # recall@5 por corpus (objetivo ≥ 0,8)
```

Permisos: el agente de servicio de RAG Engine
(`service-<nº proyecto>@gcp-sa-vertex-rag.iam.gserviceaccount.com`) necesita leer el bucket y
escribir el `import_result_sink` → `roles/storage.objectAdmin` sobre `gs://vigia-peru-rag` (dado el
2026-09-16). Los servicios Cloud Run corren con la SA de cómputo por defecto, que ya tiene
`roles/aiplatform.user` y `roles/storage.objectAdmin`: no hizo falta IAM adicional.

Añadir una fuente: entrada en `fuentes.yaml` → `descargar.py --solo <slug>` (→ `segmentar.py` si
es norma) → `corpus.py importar --corpus <corpus>`. Todo es idempotente (sha256 en GCS; RAG Engine
salta los `gcs uri` ya importados).

---

## 4. Bitácora de implementación (2026-09-16)

- **Modelo de embeddings.** `gemini-embedding-001` (el que usa pgvector) fue rechazado al crear el
  corpus: `400 Publisher model is not allowed for use in Vertex RAG yet`. Se usa
  `text-multilingual-embedding-002` (multilingüe; `text-embedding-005` es inglés-céntrico y para
  textos legales en español el multilingüe es la opción razonable). Cambiar de modelo obliga a
  recrear el corpus.
- **API Vector Search.** El modo serverless exige habilitar `vectorsearch.googleapis.com`
  (`PERMISSION_DENIED … Vector Search API has not been used in project …`). Habilitada.
- **≤ 25 URIs por import.** `InvalidArgument: GCS URIs cannot be specified more than 25 times` →
  los .txt se importan por directorio (`<corpus>/<slug>/`, `opiniones/`) y los PDF uno a uno, en
  lotes de 25 rutas. Por eso el índice `articulos.json` se movió fuera de la carpeta de artículos.
- **Cuota de embeddings: 5 RPM.** El primer import falló en 799 de 858 archivos con
  `429 Quota exceeded for aiplatform.googleapis.com/online_prediction_requests_per_base_model
  (base model: textembedding-gecko)`. El límite efectivo del proyecto para
  `OnlinePredictionRequestsPerMinutePerProjectPerRegionPerBaseModel` / textembedding-gecko en
  us-central1 es **5** (también 5 para gemini-embedding y text-embedding-large-001 en todas las
  regiones). Se pidió aumento a 300, 60 y 20 vía Cloud Quotas API: **denegado automáticamente**
  ("5 was granted"). RAG Engine hace ≈ 1 petición de embedding por archivo, así que con
  `max_embedding_requests_per_min=5` la carga avanza a ≈ 5 archivos/min (medido: 101 artículos de
  la Ley 32069 en ≈ 20 min). Consecuencias: (i) el import completo (~1 950 archivos) tarda ≈ 6-7 h y
  corre en segundo plano; (ii) el TUO 27444 se cargó solo en `normas-vigentes` (duplicarlo en
  `normas-historicas` son 274 archivos más); (iii) las consultas no se ven afectadas (1 embedding
  por consulta y corpus; 3 000-6 000/mes ≪ 5 RPM sostenidos… **ojo**: 5 RPM también limita las
  consultas concurrentes: con 4 servicios analizando en paralelo y 2 corpus por consulta se puede
  tocar el límite; la tool cae a Vertex AI Search/pgvector en ese caso). Pendiente: pedir el
  aumento por consola con justificación (la API lo rechaza).
- **Una operación por corpus.** `FAILED_PRECONDITION: There are other operations running on the
  RagCorpus` → no se puede lanzar un segundo import sobre el mismo corpus hasta que termine el
  anterior (sí se pueden importar corpus distintos en paralelo, pero comparten los 5 RPM).
  `corpus.py importar --no-esperar` lanza la LRO del lado del servidor y devuelve el control: el
  import sigue aunque el cliente muera; el estado se ve con `corpus.py estado`.
- **Carrera en `catalogo.json`.** Dos procesos de ingesta en paralelo (segmentar.py y opiniones.py)
  leen el catálogo al inicio y lo escriben al final: el segundo pisó las 721 entradas del primero
  y el import de `criterios-vinculantes` salió sin opiniones. Se re-ejecutó opiniones.py (idempotente).
  Regla: correr descargar → segmentar → opiniones en serie, nunca en paralelo.
- **PDF escaneado.** `directiva-016-2023-cg-gmpl.pdf` no tiene capa de texto ("PDF was invalid or
  file contains no text pages"). Desactivada; fase 2 con el layout parser de Document AI.
- **Permisos del agente RAG.** `service-…@gcp-sa-vertex-rag` sin `storage.objects.create` para el
  sink → `roles/storage.objectAdmin` en el bucket.

### Evaluación (recall@5)

Ver §5 (se actualiza con cada intento).

---

## 5. Estado real (2026-09-16 03:25, hora Lima; importación en curso)

**Modo del proyecto:** RAG Engine serverless (`ragManagedDbConfig.serverless`), región `us-central1`,
embeddings `text-multilingual-embedding-002`, chunk 512/100. Bucket `gs://vigia-peru-rag` (Standard,
us-central1, sin lifecycle): 31 PDF (≈ 1 700 páginas) + 1 176 artículos .txt + 721 opiniones .txt;
`catalogo.json` con 1 929 entradas.

| Corpus | Resource name | Archivos en catálogo (a importar) | Importados al cierre de este informe |
|---|---|---|---|
| `normas-vigentes` | `projects/vivid-spot-480905-a4/locations/us-central1/ragCorpora/1916096923492679680` | 858 (101 Ley 32069 · 388 D.S. 009-2025-EF · 274 TUO 27444 · 86 Ley 32513 · 9 PDF bases estándar) | 400 (Ley 32069 completa; D.S. 009-2025-EF 159/388; TUO 27444 111/274; Ley 32513 29/86; PDF 0/9) — LRO en curso |
| `normas-historicas` | `projects/vivid-spot-480905-a4/locations/us-central1/ragCorpora/1959303332417765376` | 329 (63 TUO 30225 · 266 D.S. 344-2018-EF) | 0 — LRO `…/operations/2186792344039194624` en cola |
| `criterios-vinculantes` | `projects/vivid-spot-480905-a4/locations/us-central1/ragCorpora/5416519733866397696` | 731 (10 PDF acuerdos/opiniones + 721 opiniones .txt) | 0 — LRO de los 10 PDF `…/operations/5558299615079432192` en cola; el import de `opiniones/` se lanza al terminar (una operación por corpus) |
| `control-cgr` | `projects/vivid-spot-480905-a4/locations/us-central1/ragCorpora/5967507000777506816` | 5 PDF | 3 (MAC, Ley 31288, Ley 31358; faltan 2 directivas — LRO `…/operations/7034776605415178240`) |

Ritmo medido: ≈ 5-6 archivos/min (cuota 5 RPM, §4) → faltan ≈ 1 500 archivos ≈ 4,5-5 h.

**Comandos para retomar / comprobar** (desde la raíz del repo, `PY=backend/rag/.venv/Scripts/python`):

```bash
$PY -m backend.rag.corpus estado                         # archivos por corpus vs catálogo, modo, env RAG_CORPUS_*
$PY -m backend.rag.corpus importar --rpm 5 --no-esperar  # relanza lo que falte en los 4 corpus (idempotente: salta lo ya importado;
                                                         #   si un corpus tiene una operación viva devuelve FAILED_PRECONDITION → esperar)
$PY -m backend.rag.corpus importar --corpus criterios-vinculantes --rpm 5 --no-esperar   # opiniones (cuando termine la LRO de los PDF)
$PY -m backend.rag.evaluar                               # recall@5 por corpus (73 preguntas); exit 0 si total ≥ 0,8
```

**Evaluación parcial (2026-09-16 03:22, `backend/rag/.cache/eval-20260916-032230.json`, k=5, 73
preguntas de `evalset.jsonl`):** recall@5 total **0,14** (10/73) — cifra NO representativa: solo
`normas-vigentes` tenía contenido (400/858) y el import en curso consumía la cuota de embeddings, así
que 56 de las 73 consultas devolvieron `429 RESOURCE_EXHAUSTED` (lista vacía). Sobre las 17
consultas que sí respondieron, **10 acertaron en rank 1** (fraccionamiento ley y reglamento —
arts. 50 / 45—, cuantía art. 48, contratos menores art. 34, impedimentos art. 39 Regl., sanciones
arts. 90-91, RNP art. 29, garantías art. 113/139/61, requisitos de calificación art. 72, presunción
de veracidad art. 51 TUO 27444) y las 7 que fallaron esperaban artículos aún no importados
(cronograma art. 64, ampliación de plazo art. 142, penalidad por mora art. 120, PDF de bases
estándar). Es decir: recall@5 = 1,0 y MRR = 1,0 sobre lo ya cargado y con cuota disponible.
**Repetir `evaluar.py` cuando `corpus.py estado` muestre los 4 corpus completos y sin operaciones
vivas**; anotar aquí el resultado. Si no llega a 0,8: revisar primero las preguntas de
`criterios-vinculantes` (opiniones cortas: quizá subir `top_k` a 8 para ese corpus) y las de
bases estándar (PDF largos con chunking por tokens: probar chunk 1 024).

**Despliegue (2026-09-16):** imagen `agentes:7929ab6978ca-031504` en los 4 servicios
(`agent-orchestrator-adk` rev 00275, `agente-servicios`, `agente-obras`, `agente-otros`) con
`LEGAL_RAG_BACKEND=rag_engine`, `RAG_LOCATION`, `RAG_BUCKET`, `RAG_TOP_K`,
`RAG_CORPUS_NORMAS_VIGENTES`, `RAG_CORPUS_NORMAS_HISTORICAS`, `RAG_CORPUS_CRITERIOS`,
`RAG_CORPUS_CONTROL` (vía `agentes.sh` → `--update-env-vars` / spec heredado). Smoke desde el
servicio (`POST / {"admin_action":"test_legal_rag","question":"prohibición de fraccionamiento…"}`):
`_source: rag_engine`, primer chunk Art. 50 Ley 32069 con `url_oficial` y `cita_formato`. Mientras
el import consume la cuota, las consultas pueden recibir 429 y la tool cae a Vertex AI Search
(opiniones) → pgvector, como antes de este frente.

**Costo real hasta ahora:** embeddings ≈ 4 M caracteres importados × US$ 0,000025/1 000 ≈ US$ 0,10;
almacenamiento < 20 MB; sin recursos por hora. Estimación en régimen: ≈ US$ 0,3-1/mes (§1).

**Pendientes**
1. Terminar la importación (≈ 5 h) y correr `evaluar.py`; anotar recall@5 final aquí.
2. Pedir por consola el aumento de cuota `Online prediction requests per base model per minute per
   region` para `textembedding-gecko` en us-central1 (5 → ≥ 300): la API lo rechazó tres veces. Sin
   esto, imports lentos y consultas concurrentes con 429 (cubiertas por el fallback).
3. Fase 2: TUO 27444 también en `normas-historicas`; Opinión 014-2019/DTN; Directiva 016-2023-CG/GMPL
   (OCR); opiniones DTN del OECE 2025-2026 (167) y OSCE (2 432); directivas OECE vigentes (18);
   bases estándar 2026 (DOCX); Ley 30225 con modificatorias posteriores al TUO; `resoluciones-tce`.
4. Cuando el RAG Engine esté completo y evaluado, decidir si se apaga el data store de Vertex AI
   Search `vigia-oece` (hoy dentro de la franja gratuita; sigue como fallback).
