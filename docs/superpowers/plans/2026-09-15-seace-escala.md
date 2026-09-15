# SEACE a escala — clasificación tipo×etapa, descarga por lotes, contratos en mapa y lista, procesamiento en vivo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Vigía pueda ingerir progresivamente TODO el SEACE (histórico + actualizaciones) sin re-descargar, clasificar cada contrato por **tipo × etapa** y aplicar solo los agentes que corresponden (o marcarlo *pendiente de procesamiento*), mostrar **cada contrato** en el mapa y en una lista paginada con filtros conectados, y ver el procesamiento **en tiempo real** de forma compacta.

**Architecture:** Cuatro workstreams paralelos con archivos disjuntos. **V** mide el volumen real del SEACE con un script de muestreo y deja la estimación de almacenamiento/costo (sin cifras inventadas). **B** construye el descargador nocturno por lotes (SQLite de estado, checkpoints, dedup por hash, reintentos, logs) + subida a GCS + ingesta en GCP. **C** define la matriz tipo × etapa × agentes × datos × validaciones, la persiste (migración 13) y hace que el dispatcher/orquestador la respeten (lo no soportado queda `pendiente_de_procesamiento`). **F** hace la API y UI de contratos (lista paginada 50, filtros, detalle, puntos en el mapa conectados con la lista) y el panel compacto de procesamiento en vivo.

**Tech Stack:** Python 3.12 (`backend/batch`, `backend/core`, `backend/dispatcher`, `backend/agent`) · Postgres 16 · Hono/TS · Next.js 14 + d3-geo · GCS · Cloud Run Jobs.

**Spec:** este documento + `docs/design/FINANCIA_UNA_AUDITORIA.md` (reglas de independencia §6) + hechos medidos en §0.

## Global Constraints

- Sin menciones a asistentes de IA de terceros en código/docs/commits (atribución: Antigravity). Sin trailers de co-autoría.
- Regla de independencia: la asignación sigue siendo FIFO (`asignar_contribucion`); la clasificación NO cambia el orden, solo decide qué agentes corren.
- Datos personales: DNI/apellidos de naturales por `Redact.tsx`. Nunca exponer emails de financiadores.
- Todo lo que corre contra `.gob.pe` corre desde IP peruana (laptop/VPS), nunca desde GCP. GCP solo consume lo ya descargado.
- Compacto: ninguna pantalla nueva agrega un segundo mapa ni CTAs duplicados. Un solo mapa interactivo (`/app/mapa`). Un botón por destino.
- `convocatorias.ocid` va en formato CORTO (`1249710`); triggers comparan por `ocid_corto()`.
- Cada WS termina con `npx tsc --noEmit` (api y frontend), `python -m compileall -q backend`, `python -m pytest backend -q` en verde. Sin `git commit` (el coordinador integra).

---

## 0. Hechos medidos (2026-09-15, muestra real)

| Dato | Valor | Fuente |
|---|---|---|
| Convocatorias 90 días (15-jun → 14-sep 2026) | **18 413** (~75 k/año) | backfill `oece_ocds` |
| Tipo (`tender.mainProcurementCategory`) | goods 7 896 (43 %) · services 7 103 (39 %) · works 3 327 (18 %) | DB |
| Modalidad (`procurementMethodDetails`, top) | Licitación Pública Abreviada 1 645 · Concurso Público Abreviado 1 292 · Subasta Inversa Electrónica 630 · Comparación de Precios 487 · Licitación Pública 293 · Concurso Público de Servicios 240 · Convenio 113 · Concurso Público para Consultoría 75 · Contratación Internacional 74 · Régimen Especial 73 · Adjudicación Selectiva 27 · Contratación Directa 18 | muestra 5 000 |
| `tender.status` | **siempre null** → la etapa se deriva de `tag` (planning/tender/award/contract/implementation) y de `awards[]`, `contracts[]`, `contracts[].implementation` | 16 records completos |
| Record JSON completo (`/record/<ocid>`) | mediana **12.5 KB**, máx 24 KB | 16 records |
| Documentos por record | mediana **4**, máx 9 (biddingDocuments 34, evaluationReports 10, clarifications 10, awardNotice 9, contractSigned 3) | 76 docs |
| Tamaño por documento (HEAD) | mediana **1.16 MB**, media **6.8 MB**, máx 115 MB (ZIP) | 63 docs |
| Formatos | pdf 61 %, zip 41 % (bases suelen ir en ZIP) | 63 docs |

Consecuencia: metadata de **todo** el SEACE cabe en ~10 GB/800 k registros; los documentos de todo el histórico serían **decenas de TB** → política **metadata-first, documentos bajo demanda** (solo de contratos financiados/procesados o de tipos de documento clave), con caché en GCS.

---

## 1. Matriz tipo × etapa × agentes (contrato de C, la implementa `backend/core/clasificacion.py`)

**Tipo** (`tipo_contratacion`), derivado de `mainProcurementCategory` + `procurementMethodDetails`:
`bienes` · `servicios` · `consultoria` (Concurso Público para Consultoría, "consultoría de obra") · `obras` · `convenio` (Convenio, Régimen Especial, Contratación Internacional) · `directa` (Contratación Directa) · `otro`.

**Etapa** (`etapa`), derivada de tags/objetos del record:
`planificacion` (solo planning) · `convocada` (tender, sin awards) · `desierta` (tender.status=unsuccessful o `awards[].status=unsuccessful` sin ninguno active) · `cancelada` (tender.status=cancelled) · `adjudicada` (awards active, sin contracts) · `contratada` (contracts, sin implementation) · `en_ejecucion` (contracts[].implementation con transacciones/milestones) · `finalizada` (contracts[].status=terminated) · `nula` (marcada nula en datos locales `nulos/`) · `desconocida`.

**Agentes** (los 10 del `deterministic.py`): `compliance`, `document_parser`, `document_legal_analyst`, `market`, `web_research`, `news_research`, `entity_personnel`, `person_network`, `compliance_extended`, `report_writer`.

| tipo \ etapa | planificacion | convocada | adjudicada | contratada / en_ejecucion / finalizada | desierta / cancelada / nula |
|---|---|---|---|---|---|
| **bienes** | PENDIENTE (sin postores ni bases) | compliance · document_parser · document_legal_analyst · market · entity_personnel · report_writer | + web_research · news_research · person_network · compliance_extended (proveedor conocido) | todo (+ penalidades/adendas en compliance_extended) | compliance (causal) · report_writer breve |
| **servicios** | PENDIENTE | compliance · document_parser · document_legal_analyst · entity_personnel · report_writer (**sin market**: no hay precio unitario comparable) | + web_research · news_research · person_network · compliance_extended | todo (sin market) | compliance · report_writer breve |
| **consultoria** | PENDIENTE | igual que servicios | igual que servicios | igual que servicios | igual |
| **obras** | PENDIENTE | compliance · document_parser · document_legal_analyst · entity_personnel · report_writer (**sin market**; market de obras = expediente técnico, no soportado) | + web_research · news_research · person_network · compliance_extended | todo + **PENDIENTE parcial**: avance físico INFOBRAS no disponible → se marca `validaciones_pendientes: ["infobras_avance"]` | compliance · report_writer breve |
| **convenio / directa** | PENDIENTE | compliance (causal art. 27) · document_parser · document_legal_analyst · report_writer | + person_network · web_research · news_research | todo | compliance |
| **otro / desconocida** | PENDIENTE DE PROCESAMIENTO (`procesable=false`, motivo `tipo_no_soportado` / `etapa_desconocida`) | | | | |

**Datos requeridos por agente** (si faltan → el agente se omite y queda en `validaciones_pendientes`, nunca se inventa):
`market` ← `tender.items[]` con cantidad+unidad y ≥1 ítem físico · `document_parser` ← ≥1 documento `biddingDocuments|awardNotice|contractSigned` descargable · `person_network`/`web_research`/`news_research` ← RUC de proveedor (awards/contracts) · `entity_personnel` ← RUC de entidad · `compliance_extended` ← proveedor + `osce_sancionados`/`rnp`.

---

## Mapa de archivos por workstream

| WS | Crea | Modifica |
|---|---|---|
| **V** volumen | `backend/batch/muestreo.py`, `backend/batch/tests/test_muestreo.py`, `docs/design/VOLUMEN_SEACE.md` | — |
| **B** batch | `backend/batch/{__init__,estado.py,descargar.py,subir.py,ingestar.py,README.md,requirements.txt}`, `backend/batch/tests/test_estado.py`, `backend/db/migrations/14_lotes.sql`, `infrastructure/deploy/batch-nocturno.sh`, `infrastructure/deploy/ingest-job.sh` | `backend/db/apply_all.py`, `backend/db/apply_all.sh`, `cloudbuild.yaml` (paso `ingest`) |
| **C** clasificación | `backend/core/__init__.py`, `backend/core/clasificacion.py`, `backend/core/tests/test_clasificacion.py`, `backend/db/migrations/13_clasificacion.sql`, `docs/design/MATRIZ_TIPO_ETAPA.md` | `backend/dispatcher/main.py` (consultar `procesable`/agentes), `backend/agent/deterministic.py` (respetar `state["agentes_permitidos"]`), `backend/agent/main.py` (aceptar `clasificacion` en el body), `backend/scrapers/oece_ocds/pipeline.py` (clasificar al ingerir), `backend/api/src/routes/admin.ts` (`/admin/clasificacion/resumen`) |
| **F** frontend+API contratos | `backend/api/src/routes/contratos.ts`, `frontend/lib/contratos.ts`, `frontend/app/(dashboard)/app/contratos/page.tsx`, `frontend/app/(dashboard)/app/contratos/[ocid]/page.tsx`, `frontend/components/contratos/{ContratosLista,ContratoDetalle,FiltrosContratos,ContratoPin}.tsx`, `frontend/components/auditoria/PanelProcesamiento.tsx` | `backend/api/src/index.ts` (montar `/contratos`), `backend/api/src/routes/procesamientos.ts` (`/resumen` enriquecido), `frontend/components/MapaWrapper.tsx` (capa "Contratos" + selección conectada), `frontend/components/PeruChoropleth.tsx` (puntos de contratos), `frontend/components/dashboard/DashboardSidebar.tsx` (ítem "Contratos"), `frontend/app/(dashboard)/app/auditoria/page.tsx` (usar `PanelProcesamiento`) |

**Interfaces compartidas:**

```sql
-- C · migración 13
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS tipo_contratacion TEXT;      -- bienes|servicios|consultoria|obras|convenio|directa|otro
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS etapa TEXT;                  -- planificacion|convocada|adjudicada|contratada|en_ejecucion|finalizada|desierta|cancelada|nula|desconocida
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS modalidad TEXT;              -- procurementMethodDetails tal cual
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS procesable BOOLEAN;
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS motivo_no_procesable TEXT;
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS agentes_aplicables TEXT[];
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS validaciones_pendientes TEXT[];
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS proveedor_ruc CHAR(11);      -- del award/contract, si existe
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS clasificado_at TIMESTAMPTZ;
-- procesamientos.estado admite además 'pendiente_de_procesamiento'
```

```python
# C · backend/core/clasificacion.py
@dataclass
class Clasificacion:
    tipo: str; etapa: str; modalidad: str | None; procesable: bool
    motivo_no_procesable: str | None; agentes: list[str]; validaciones_pendientes: list[str]; proveedor_ruc: str | None
def clasificar(release_o_record: dict) -> Clasificacion: ...
MATRIZ: dict[tuple[str, str], list[str]]   # (tipo, etapa) → agentes
```

```ts
// F · GET /contratos?page=1&size=50&q=&tipo=&etapa=&ubigeo=15&entidad=<ruc>&monto_min=&monto_max=&riesgo=alto|medio|bajo|sin_analizar&orden=fecha|monto|score
//   → { data: ContratoResumen[], total: number, page: number, size: number }
export interface ContratoResumen {
  ocid: string; codigo: string; titulo: string | null; entidad: string | null; entidadRuc: string | null;
  tipo: string | null; etapa: string | null; modalidad: string | null; montoPen: number | null;
  fecha: string | null; ubigeo: string | null; zona: string | null; lat: number | null; lon: number | null;
  procesable: boolean | null; estadoProcesamiento: "sin_analizar" | "pendiente_de_procesamiento" | "encolado" | "procesando" | "procesado" | "error";
  score: number | null; banderas: number; proveedor: string | null; proveedorRuc: string | null;
}
// GET /contratos/:ocid → ContratoResumen & { items: any[]; documentos: {tipo,url,formato}[]; alerta: {...}|null; procesamiento: Procesamiento|null; clasificacion: {...} }
// GET /contratos/geo?tipo=&etapa=&riesgo=&nivel=distrito|provincia → { data: { ubigeo, nombre, lat, lon, total, sinAnalizar, procesados, conSenales }[] }  (agregado por zona; nunca 18k puntos crudos)
// GET /financiamiento/procesamientos/resumen → { porEstado, procesadosHoy, activos: {ocid, faseActual, faseIndex, financiador, desdeSeg}[], lote: {id, total, completados, fallidos, iniciado}|null, descargados24h, agentesActivos: string[] }
```

```python
# B · backend/batch/estado.py (SQLite local dataset/_batch/estado.sqlite)
# tablas: lotes(id, tipo[releases|records|documentos], desde, hasta, estado, creado, actualizado, total, ok, fallidos, nota)
#         items(lote_id, clave, estado[pending|processing|completed|failed], intentos, sha256, bytes, ruta, error, actualizado)
# API: nuevo_lote(tipo, desde, hasta) -> id · reclamar(lote_id, n) -> [clave] · marcar(lote_id, clave, estado, **campos) · pendientes(lote_id) · resumen(lote_id)
```

---

# Workstream V — Volumen real del SEACE (medición, no estimación a ojo)

### Task V1: Script de muestreo reproducible
**Files:** `backend/batch/muestreo.py`, `backend/batch/tests/test_muestreo.py`, `docs/design/VOLUMEN_SEACE.md`

- [ ] `muestreo.py`: CLI `python -m backend.batch.muestreo --records 300 --docs-por-record 6 --anios 2019,2022,2025 --salida dataset/_batch/muestreo.json`. Hace: (a) `count_por_mes(anio)`: para 3 meses de cada año llama `/releasesAfter?size=100&startDate&endDate` y sigue `links.next` contando releases y ocids únicos → extrapola releases/año y contratos/año; (b) toma N ocids al azar de la DB (`convocatorias` — usar `pg_dsn()` de `backend/scrapers/_core/pipeline.py`) estratificados por tipo (goods/services/works) y baja `/record/<ocid>` midiendo bytes del JSON, nº de documentos, `documentType`, `format`; (c) `HEAD` a cada documento (máx `--docs-por-record`) para `content-length`; (d) escribe JSON con percentiles (p50, p90, media, máx) por tipo de contrato y por `documentType`. Reintentos 429/5xx con backoff; UA de navegador (`backend/scrapers/_core/http.session()`); `--reanudar` para no repetir ocids ya medidos (archivo de salida incremental).
- [ ] Test: `test_extrapolar()` sobre un dict de conteos sintético (3 meses → año) y `test_percentiles()`.
- [ ] Ejecutar con `--records 300` (tarda ~30-40 min por los HEAD). Guardar el JSON en `docs/design/volumen_muestra.json` (es chico).
- [ ] `docs/design/VOLUMEN_SEACE.md` con: tabla de conteos por año (medidos y extrapolados), tamaño por record, por documento (por tipo y formato), **estimación total** separada en (1) metadata JSON de todo el histórico, (2) documentos si se bajaran todos, (3) documentos solo `biddingDocuments`+`awardNotice`+`contractSigned`, (4) versiones (releases múltiples por ocid: medir ratio releases/ocid), (5) derivados (alertas, embeddings: estimar desde tamaño medio de `analisis_full` en la DB: `SELECT avg(length(analisis_full::text)) FROM alertas`). Costo GCS con precios públicos us-central1 (**verificar en cloud.google.com/storage/pricing y citar la fecha**): Standard, Nearline, Coldline, Archive, más operaciones y egress. Recomendación de arquitectura de almacenamiento: metadata en Postgres + Parquet en GCS Standard; documentos bajo demanda en Standard con lifecycle → Nearline 30 d → Coldline 90 d; histórico completo de documentos solo si un financiador lo paga.

---

# Workstream B — Descarga nocturna por lotes y subida a GCP

### Task B1: Estado local en SQLite (con tests)
**Files:** `backend/batch/estado.py`, `backend/batch/tests/test_estado.py`
- [ ] Implementar la API de la interfaz compartida sobre `sqlite3` (WAL, `BEGIN IMMEDIATE` en `reclamar` para que dos procesos no tomen el mismo ítem). `marcar(..., estado="failed")` incrementa `intentos`; `reclamar` ignora `failed` con `intentos >= 3`. `resumen()` → dict con conteos por estado.
- [ ] Tests: crear lote, reclamar 2, marcar 1 completed y 1 failed, reclamar de nuevo devuelve el failed (intentos 1), tras 3 fallos ya no lo devuelve; `resumen` correcto; dos conexiones concurrentes no reclaman el mismo ítem.

### Task B2: Descargador por lotes (releases → records → documentos)
**Files:** `backend/batch/descargar.py`, `backend/batch/README.md`, `backend/batch/requirements.txt`
- [ ] `python -m backend.batch.descargar releases --desde 2016-01-01 --hasta 2026-09-15 --ventana 7d`: recorre ventanas de fecha con `/releasesAfter`, guarda cada página cruda en `dataset/_batch/releases/<ventana>/page-<n>.json.gz` y registra en `items` (clave = ventana+página). Reanudable: ventanas `completed` se saltan. Dedup: hash del contenido; si la ventana ya existe con el mismo hash no se reescribe.
- [ ] `python -m backend.batch.descargar records --lote <id> | --ocids archivo.txt`: por cada ocid nuevo (no presente en `items` tipo records con `completed`) baja `/record/<ocid>` → `dataset/_batch/records/<aa>/<ocid>.json.gz` (aa = 2 últimos dígitos del ocid para no tener 800 k archivos en una carpeta). Registra sha256+bytes. Reintentos con backoff, `--paralelo 4` (hilos), `--max-por-noche 20000`.
- [ ] `python -m backend.batch.descargar documentos --politica clave|todo --lote <id>`: baja documentos de records ya descargados según política (`clave` = biddingDocuments/awardNotice/contractSigned; `todo` = todos) a `dataset/_batch/documentos/<aa>/<ocid>/<sha8>.<ext>`; límite `--max-gb-por-noche 20`; nunca re-baja un sha256 ya presente.
- [ ] Logs a `dataset/_batch/logs/<fecha>.log` (rotación por día) + resumen al final (ok/fallidos/bytes/velocidad). `Ctrl+C` deja el lote en `processing` y se reanuda con el mismo comando.

### Task B3: Subida a GCS y manifiestos
**Files:** `backend/batch/subir.py`
- [ ] `python -m backend.batch.subir --lote <id> --bucket vigia-peru-documentos --prefijo batch/`: sube solo ítems `completed` sin `subido_at` (columna nueva en `items`), en paralelo (`google-cloud-storage`), verifica md5, escribe `batch/<lote_id>/manifest.jsonl` (una línea por ítem: clave, ruta gs://, sha256, bytes) y marca `subido_at`. Reanudable.

### Task B4: Ingesta en GCP desde el bucket
**Files:** `backend/batch/ingestar.py`, `backend/db/migrations/14_lotes.sql`, `infrastructure/deploy/ingest-job.sh`, `cloudbuild.yaml`
- [ ] Migración 14: tabla `lotes_ingesta(id TEXT PK, tipo, manifest_uri, estado, total, ok, fallidos, iniciado_at, finalizado_at, error)` y `lotes_items(lote_id, clave, estado, error, procesado_at, PRIMARY KEY(lote_id, clave))`.
- [ ] `ingestar.py`: lee `manifest.jsonl` de GCS, para releases/records hace upsert en `convocatorias` (misma normalización que `oece_ocds.normalize_release` — **importarla**, no duplicarla; para records además `awards`/`contracts` → `proveedor_ruc`, y llama a `backend.core.clasificacion.clasificar` si el módulo existe, con `try/except ImportError` para no depender del orden de merge); para documentos registra en `documentos(ocid, tipo, url_gcs, sha256, bytes)` (crear tabla si no existe en la misma migración). Idempotente por `(lote_id, clave)`. Cloud Run Job `vigia-ingest` (deploy script igual al del dispatcher) que acepta `--lote <id>` o procesa todos los `estado='pending'`.
- [ ] `infrastructure/deploy/batch-nocturno.sh`: orquesta en la laptop: `descargar releases` (últimos 7 d) → `descargar records` (nuevos) → `descargar documentos --politica clave --max-gb-por-noche 10` → `subir` → `gcloud run jobs execute vigia-ingest --args=--lote,<id>`. Documentar en README cómo programarlo (Task Scheduler / cron) y cómo hacer el histórico completo por años (`--desde 2016-01-01`, varias noches, reanudable).

---

# Workstream C — Clasificación tipo × etapa y pipeline extensible

### Task C1: Módulo de clasificación (con tests contra records reales)
**Files:** `backend/core/__init__.py`, `backend/core/clasificacion.py`, `backend/core/tests/test_clasificacion.py`, `docs/design/MATRIZ_TIPO_ETAPA.md`
- [ ] Implementar `clasificar()` según §1 (tipo por `mainProcurementCategory` + `procurementMethodDetails`; etapa por tags/awards/contracts/status; `procesable` y `motivo_no_procesable`; `agentes` = `MATRIZ[(tipo, etapa)]` menos los que no tienen datos; `validaciones_pendientes`). Tolerante: acepta release recortado (como el `ocds_payload` guardado) o record completo.
- [ ] Tests con 8 fixtures JSON reales guardadas en `backend/core/tests/fixtures/` (tomar de la DB: 2 goods convocada, 1 goods contratada, 1 services adjudicada, 1 works contratada, 1 consultoría, 1 convenio, 1 solo planning). Esperados explícitos por fixture.
- [ ] `docs/design/MATRIZ_TIPO_ETAPA.md`: la tabla de §1 + reglas de derivación + qué queda PENDIENTE y por qué.

### Task C2: Persistir la clasificación
**Files:** `backend/db/migrations/13_clasificacion.sql`, `backend/scrapers/oece_ocds/pipeline.py`, `backend/db/apply_all.py`, `backend/db/apply_all.sh`
- [ ] Migración 13 (interfaz compartida) + índices `(tipo_contratacion, etapa)`, `(procesable)`, `(proveedor_ruc)`; `procesamientos` CHECK ampliado con `'pendiente_de_procesamiento'`; vista `cola_auditoria` filtra `procesable IS DISTINCT FROM false` (los no procesables no entran a la cola financiable: no se cobra por lo que no se puede analizar).
- [ ] `oece_ocds.pipeline.normalize_release` llama a `clasificar` y el upsert escribe las columnas nuevas. Script único `python -m backend.core.clasificacion --reclasificar` que recorre `convocatorias` (18 k) y actualiza; ejecutarlo contra Cloud SQL y reportar la distribución tipo × etapa × procesable.

### Task C3: Dispatcher y orquestador respetan la matriz
**Files:** `backend/dispatcher/main.py`, `backend/agent/main.py`, `backend/agent/deterministic.py`, `backend/api/src/routes/admin.ts`
- [ ] Dispatcher: al reclamar, lee `tipo_contratacion, etapa, procesable, agentes_aplicables, validaciones_pendientes` de `convocatorias`; si `procesable=false` → `UPDATE procesamientos SET estado='pendiente_de_procesamiento', error=motivo` y no llama al orquestador; si procesable → body incluye `"clasificacion": {tipo, etapa, agentes, validaciones_pendientes}`.
- [ ] `agent/main.py`: si viene `clasificacion`, la pone en `initial_state["clasificacion"]` y `initial_state["agentes_permitidos"]`.
- [ ] `deterministic.py`: cada `_agent(A.xxx_agent, …)` se envuelve en `if permitido("xxx")` (helper que lee `state["agentes_permitidos"]`; sin clave = todos permitidos, para compatibilidad con el análisis a demanda del admin). Los omitidos emiten `{"kind":"phase","name":"<agente>","msg":"omitido: no aplica a <tipo>/<etapa>"}` para que el tablero lo muestre. El `report_writer` recibe en su contexto `validaciones_pendientes` y las lista en el dictamen bajo "Validaciones pendientes" (sin inventar).
- [ ] Redeploy del orquestador con `bash infrastructure/deploy/agent.sh` (solo `--update-env-vars`, sin tocar variables). Probar el análisis a demanda de un contrato ya analizado (`1216608`) para verificar que sin `clasificacion` el flujo es idéntico.
- [ ] `GET /admin/clasificacion/resumen` → conteos tipo × etapa × procesable + top motivos no procesables.

---

# Workstream F — Contratos en mapa y lista + procesamiento en vivo compacto

### Task F1: API de contratos
**Files:** `backend/api/src/routes/contratos.ts`, `backend/api/src/index.ts`
- [ ] Implementar los 3 endpoints de la interfaz compartida. `/contratos` con `LIMIT/OFFSET` (size máx 100), `count(*) OVER()` para `total`, búsqueda `q` por `texto_busqueda`/objeto/entidad/ocid (usar `pg_trgm` si hay índice; si no, `ILIKE`), filtros por igualdad; `riesgo` mapea `score` (≥70 alto, 40-69 medio, <40 bajo, null sin_analizar). Zona/lat/lon desde `convocatoria_zona`+`zonas`. `estadoProcesamiento` desde `procesamientos` (o `sin_analizar`). Cache 60 s.
- [ ] `/contratos/geo` agrega por `nivel` (default distrito) con `zonas.lat/lon`. Cache 300 s.
- [ ] `/contratos/:ocid` devuelve además `ocds_payload->'tender'->'items'` y `documents`, la alerta (código, score, banderas resumidas) y el procesamiento.

### Task F2: Lista paginada con filtros y detalle
**Files:** `frontend/lib/contratos.ts`, `frontend/app/(dashboard)/app/contratos/page.tsx`, `frontend/app/(dashboard)/app/contratos/[ocid]/page.tsx`, `frontend/components/contratos/{ContratosLista,ContratoDetalle,FiltrosContratos}.tsx`, `frontend/components/dashboard/DashboardSidebar.tsx`
- [ ] `/app/contratos?page=&q=&tipo=&etapa=&ubigeo=&entidad=&monto_min=&monto_max=&riesgo=&orden=`: filtros en la URL (server component lee `searchParams`, pasa a `FiltrosContratos` cliente que navega con `router.replace`), tabla densa de 50 filas (código, título 1 línea, entidad, zona, tipo·etapa como badges, monto, fecha, estado de procesamiento con `EstadoPill` de `components/auditoria`, score), paginación arriba y abajo con total. Fila → `/app/contratos/[ocid]`. Sidebar: ítem **Contratos** en Explorar (entre Mapa y Auditoría en vivo).
- [ ] Detalle `/app/contratos/[ocid]`: cabecera (título, entidad → `/entidad/[ruc]`, zona → `/app/mapa?region=`), badges tipo/etapa/modalidad, monto, fechas, proveedor (si hay; `Redact` si es persona natural con DNI), ítems (tabla), documentos (links oficiales), estado de análisis: si `procesado` → score, banderas y link a `/app/convocatoria/[ocid]`; si `procesando/encolado` → `ContratoEnVivo` embebido; si `sin_analizar` y `procesable` → "Financiar la auditoría de {zona}" → `/app/financiar/[ubigeo]`; si `pendiente_de_procesamiento` → motivo y qué falta (`validaciones_pendientes`). Metadata OG con título.

### Task F3: Contratos en el mapa, conectados con la lista
**Files:** `frontend/components/MapaWrapper.tsx`, `frontend/components/PeruChoropleth.tsx`, `frontend/components/contratos/ContratoPin.tsx`
- [ ] Capa **Contratos** (toggle junto a Alertas/Denuncias): puntos agregados por distrito desde `/contratos/geo?nivel=distrito` (radio ∝ √total, color por % con señales), clic → abre en el panel de zona la pestaña **Cola** con la lista paginada filtrada por ese distrito (`ContratosLista` embebida con `size=20`), y actualiza la URL `?region=&ubigeo=`. Con región seleccionada se muestran solo sus distritos.
- [ ] Conexión lista ↔ mapa: `MapaWrapper` expone en la URL `?ocid=`; `ContratosLista` (dentro del panel) al pasar el mouse/seleccionar una fila resalta el punto (anillo) y hace `scrollIntoView` del punto; clic en un punto con un solo contrato selecciona la fila. Sin segundo mapa: todo ocurre en `/app/mapa`.
- [ ] `PeruChoropleth`: prop `points?: {id, lat, lon, r, color, selected}[]` + `onPointClick` (si ya existe `MapPoint`, extenderlo; no duplicar).

### Task F4: Panel de procesamiento en vivo (compacto)
**Files:** `frontend/components/auditoria/PanelProcesamiento.tsx`, `frontend/app/(dashboard)/app/auditoria/page.tsx`, `backend/api/src/routes/procesamientos.ts`
- [ ] `/financiamiento/procesamientos/resumen` enriquecido (interfaz compartida): `activos[]` con fase actual y segundos desde inicio, `lote` actual desde `lotes_ingesta` (si la tabla existe; `try/catch` → null), `descargados24h` = convocatorias creadas en 24 h, `agentesActivos` = fases actuales distintas de los activos.
- [ ] `PanelProcesamiento` (cliente, poll 5 s): **una sola franja** de 6 cifras (descargados 24 h · en cola · procesando · procesados hoy · con error · pendientes de procesamiento) + fila "ahora mismo": chips por contrato activo (`fase n/10`, tiempo) + chips de agentes activos + barra del lote de ingesta si hay. Sin gráficos grandes. Se monta arriba del `TableroAuditoria` en `/app/auditoria` reemplazando los 3 KPIs actuales.

---

## Integración (coordinador)
- [ ] Merge en orden C → B → F → V (V solo docs). Aplicar migraciones 13 y 14 en Cloud SQL. `reclasificar` los 18 k. Typecheck/build/tests. Deploy api, frontend, agent (update-env-vars), dispatcher, ingest job.
- [ ] Recorrido en navegador: `/app/contratos` (filtros, paginación) → detalle → mapa con capa Contratos → clic en distrito → lista en panel → `/app/auditoria` con `PanelProcesamiento`. Capturas.
- [ ] Correr `backend/batch/descargar releases --desde 2026-09-08` en la laptop como prueba de humo del flujo nocturno (sin documentos), `subir`, `vigia-ingest`.
- [ ] Actualizar notas operativas locales, memoria, commit, push.
