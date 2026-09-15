# backend/batch — descarga nocturna del SEACE por lotes y subida a GCP

Ingesta progresiva de **todo** el SEACE (histórico + actualizaciones) sin re-descargar:
la laptop o el VPS de Lima (IP peruana: la API OCDS y `prod1.seace.gob.pe` responden 403
a GCP) baja releases → records → documentos, los sube a `gs://vigia-peru-batch` y un
Cloud Run Job (`vigia-ingest`) hace el upsert en Cloud SQL. GCP sólo consume lo ya descargado.

```
laptop / VPS (IP PE)                                   GCP
──────────────────────────────────────────────         ─────────────────────────────────────
descargar releases  ─┐                                 vigia-ingest (Cloud Run Job)
descargar records   ─┼─ dataset/_batch/ ── subir ──▶  gs://vigia-peru-batch/batch/…  ──▶  Cloud SQL
descargar documentos ┘   (estado.sqlite)               lotes/<id>/manifest.jsonl          convocatorias · entidades
                                                                                          documentos_gcs · lotes_ingesta
```

## Módulos

| Archivo | Qué hace |
|---|---|
| `estado.py` | Estado local en SQLite (`dataset/_batch/estado.sqlite`): `lotes` e `items` con `pending/processing/completed/failed`, reintentos (máx 3), `reclamar` atómico (`BEGIN IMMEDIATE`), dedup por sha256/URL entre lotes. |
| `descargar.py` | CLI `releases` / `records` / `documentos`. Reanudable, paralelo (hilos), reintentos con backoff, logs por día en `dataset/_batch/logs/`. Imprime el id del lote como última línea de stdout. |
| `subir.py` | Sube los ítems `completed` sin `subido_at` (paralelo, md5 verificado, no re-sube objetos idénticos) y escribe `lotes/<id>/manifest.jsonl` + `lote.json`. |
| `ingestar.py` | Lee el manifiesto desde GCS y hace el upsert (misma normalización que `scrapers/oece_ocds`), clasifica tipo × etapa si `backend.core.clasificacion` existe y registra documentos en `documentos_gcs`. Idempotente por `(lote_id, clave)`. |
| `muestreo.py` | Medición de volumen del SEACE (workstream V, ver `docs/design/VOLUMEN_SEACE.md`). |
| `Dockerfile` | Imagen del job `vigia-ingest` (contexto mínimo armado por `infrastructure/deploy/ingest-job.sh`). |

Migración: `backend/db/migrations/14_lotes.sql` (`lotes_ingesta`, `lotes_items`, `documentos_gcs`).

## Flujo nocturno (una noche)

```bash
# 1. releases de los últimos 7 días, en ventanas de 7 d (una página cruda por archivo)
L1=$(python -m backend.batch.descargar releases --desde 2026-09-08 --hasta 2026-09-15 --ventana 7d | tail -n1)
# 2. /record/<ocid> de los ocids NUEVOS (los ya bajados otra noche se saltan)
L2=$(python -m backend.batch.descargar records --lote "$L1" --max-por-noche 20000 --paralelo 4 | tail -n1)
# 3. documentos clave (biddingDocuments · awardNotice · contractSigned) con tope de GB
L3=$(python -m backend.batch.descargar documentos --lote "$L2" --politica clave --max-gb-por-noche 10 | tail -n1)
# 4. subir + manifiestos
python -m backend.batch.subir --lote "$L1" --lote "$L2" --lote "$L3" --bucket vigia-peru-batch
# 5. ingesta en GCP (o local: python -m backend.batch.ingestar --lote "$L1" --lote "$L2" --lote "$L3")
gcloud run jobs execute vigia-ingest --region us-central1 --args=--lote,$L1,--lote,$L2,--lote,$L3 --wait
```

Todo eso lo hace `infrastructure/deploy/batch-nocturno.sh` (variables `DIAS`, `DESDE/HASTA`,
`MAX_RECORDS`, `MAX_GB`, `POLITICA`, `SIN_DOCUMENTOS`, `SIN_INGESTA`).

### Programarlo

- **VPS Lima (cron):** `30 1 * * *  /opt/vigia/infrastructure/deploy/batch-nocturno.sh >> /var/log/vigia-batch.log 2>&1`
- **Windows (Task Scheduler, diario 01:30):**
  `"C:\Program Files\Git\bin\bash.exe" -lc "/c/Users/usuario/Desktop/PROYECTOS/vigia-peru/infrastructure/deploy/batch-nocturno.sh"`

Requisitos del host: Python 3.12+ con `pip install -r backend/batch/requirements.txt`,
`gcloud auth application-default login` (para `subir`) y `gcloud` autenticado (para ejecutar
el job). `ingestar.py` local necesita además `.cloudsql-password` en la raíz (o `PGPASSWORD`)
y `PGHOST=<ip pública de vigia-db> PGSSLMODE=require`.

### Histórico completo (2016 → hoy), varias noches

```bash
# noche 1: releases de todo un año (ventanas de 7 d; reanudable con --lote <id>)
DESDE=2016-01-01 HASTA=2016-12-31 MAX_RECORDS=20000 MAX_GB=10 bash infrastructure/deploy/batch-nocturno.sh
# noches siguientes: mismo año hasta que `descargar records --lote <releases-…>` diga "nada nuevo que bajar";
# el lote de releases NO se vuelve a bajar: reusá su id
python -m backend.batch.descargar records --lote releases-2016… --max-por-noche 20000
```

Con `--max-por-noche 20000` y ~35 records/s medidos, un año (~75 k procesos) son 4 noches de
records; los releases de un año se bajan en minutos. Documentos: sólo los `clave` y con tope
de GB (política *metadata-first*, ver `docs/design/VOLUMEN_SEACE.md`).

## Reanudar / operar

- `Ctrl+C` deja los ítems en `processing`; el mismo comando con `--lote <id>` los retoma
  (`--reponer` los devuelve a `pending` de inmediato; si no, se retoman a los 30 min).
- Una ventana de releases guarda el cursor (`links.next`) por página: se retoma en la página siguiente.
- `subir` es reanudable (sólo ítems sin `subido_at`); el manifiesto se reescribe completo al final.
- `ingestar` sin `--lote` descubre en el bucket los manifiestos que aún no están `ok` en `lotes_ingesta`.
- Estado: `python -c "from backend.batch.estado import Estado; e=Estado(); [print(l) for l in e.lotes()]"`.
- Bloqueo del SEACE: el WAF de `prod1.seace.gob.pe` devuelve HTTP 403 **por ráfaga**, no de forma
  permanente (verificado 2026-09-15: 219 descargas con 4 hilos → 217 × 403; la misma URL vuelve a
  dar 200 minutos después con `curl` y con `requests`). Por eso `descargar documentos` va con un
  solo hilo, `--pausa 1.5` s entre archivos y, ante un 403, espera 60 → 180 → 420 s antes de
  reintentar el mismo archivo. Si aun así acumula 25 × 403 seguidos, corta la noche (los ítems
  quedan `failed` con intentos < 3 y se reintentan otra noche con `--lote <id> --reponer`).

## Retención (90 días) y pedidos de descarga bajo demanda — migración 15

- **Metadata para siempre, documentos 90 días.** `convocatorias` (release/record, ~14 KB) se conserva
  siempre. Los documentos en `gs://vigia-peru-batch/batch/documentos/` pasan a Nearline a los 30 días
  y **se borran a los 90** (lifecycle del bucket: `infrastructure/deploy/gcs-lifecycle-batch.json`,
  aplicado con `gcloud storage buckets update gs://vigia-peru-batch --lifecycle-file=…`). En la DB
  `documentos_gcs.expira_at` (= subida + `RETENCION_DIAS`, default 90) dice hasta cuándo son legibles;
  `documentos_vigentes(ocid)` es la única fuente de verdad para el dispatcher y la API.
- **Si alguien financia un contrato sin documentos vigentes** (nunca bajados o ya expirados), el
  dispatcher (`DISPATCHER_REQUIERE_DOCS_GCS=1`) no lo procesa: llama `esperar_documentos(ocid)` →
  fila en `pedidos_descarga` + procesamiento en `esperando_documentos` (visible en `/app/auditoria`,
  el detalle del contrato y `/admin/procesamientos`).
- **Esa noche** `batch-nocturno.sh` corre primero `descargar pedidos` (los toma como `descargando`,
  baja el **record de nuevo** —puede haber adjudicación/contrato nuevos— y **todos** sus documentos,
  sin filtro de tipo), los sube y `vigia-ingest` los registra renovando `expira_at`; al cerrar la
  corrida `cerrar_pedidos_atendidos()` marca el pedido `listo` y re-encola el procesamiento → el
  dispatcher lo analiza en su siguiente corrida (≤ 5 min), es decir, **al día siguiente**.
- Tres noches sin conseguir los documentos → pedido `fallido`, procesamiento `error` con motivo;
  en `/admin/procesamientos` se puede **Reintentar** (vuelve a `pendiente`).
- Si un contrato se procesa dos veces (p. ej. re-análisis meses después), el ciclo se repite solo:
  documentos expirados → pedido → descarga → análisis. Nada se re-descarga mientras esté vigente.

## Layout local (`dataset/_batch/`, gitignored)

```
estado.sqlite · ultimo_lote · logs/<fecha>.log
releases/<desde>_<hasta>/page-0001.json.gz      respuesta cruda de /releasesAfter (100 releases)
records/<aa>/<ocid>.json.gz                      records[0] de /record/<ocid> (aa = 2 últimos dígitos)
documentos/<aa>/<ocid>/<sha8>.<ext>
```

En el bucket el objeto se nombra por contenido (`batch/records/47/1248010.json.gz`), no por lote:
un mismo record o PDF nunca se sube dos veces. Los manifiestos van en `batch/lotes/<id>/`.

## Deploy del job

```bash
bash infrastructure/deploy/ingest-job.sh                # build (contexto mínimo) + deploy vigia-ingest
bash infrastructure/deploy/ingest-job.sh --build-only   # sólo docker build local, para verificar
gcloud builds submit --config cloudbuild.yaml --substitutions=_DEPLOY=ingest
```

## Tests

```bash
python -m pytest backend/batch -q
python -m compileall -q backend/batch
```
