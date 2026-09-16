# backend/cloud_functions/ — un Cloud Run Job por scraper, agendado con Cloud Scheduler

Cada carpeta es una unidad desplegable independiente (imagen propia, job propio, agenda
propia) que envuelve el pipeline ya probado de `backend/scrapers/<fuente>/pipeline.py` —
la lógica de scraping no se duplica aquí, solo se empaqueta para correr sola en la nube.

**Por qué "Cloud Run Jobs" y no "Cloud Functions" literales:** varios pipelines tardan
minutos (`pnda_dji` baja hasta 700 MB) y `onpe_claridad` necesita Chromium con perfil
completo — Cloud Functions (1.ª y 2.ª gen) tiene límites de tiempo/tamaño de imagen poco
cómodos para eso, y no permite un `Dockerfile` propio con dependencias del sistema
(Xvfb, libgtk, etc.). Cloud Run Jobs sí, corre hasta 24 h, y es el mismo mecanismo que ya
usa este repo para `vigia-ingest` (`infrastructure/deploy/ingest-job.sh`). Cloud Scheduler
agenda ambos igual (`jobs create http … :run`), así que para el usuario es indistinguible.

## Qué se puede agendar desde GCP y qué no (verificado, no supuesto)

`.gob.pe` bloquea IPs de nube para varios de estos sitios — no es un rumor, se
comprobó lanzando un `Cloud Build` (que corre con IP de GCP) que le pega a cada host:

```
$ gcloud builds submit --no-source --config cloudbuild-probe.yaml   # 2026-09-16
PROBE 403 https://contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter?size=1   ← WAF del OECE
PROBE 200 https://www.datosabiertos.gob.pe                                         ← PNDA, abierta
PROBE 404 https://api.datosabiertos.mef.gob.pe/…                                   ← host OK (ruta de prueba nomás)
PROBE 403 https://claridad.onpe.gob.pe/claridad-backend/portal/consult/org/find    ← Cloudflare
PROBE 403 https://claridadportal.onpe.gob.pe                                       ← Cloudflare
PROBE 200 https://visitas.servicios.gob.pe                                         ← la página carga; el
                                                                                        POST de búsqueda igual
                                                                                        exige Turnstile (no es IP)
```

| Carpeta | Fuente real | ¿Cloud Scheduler? | Motivo |
|---|---|---|---|
| `pnda_sancionados/` | PNDA (`datosabiertos.gob.pe`) | ✅ sí | host abierto, sin WAF |
| `pnda_visitas/` | PNDA (mensual) | ✅ sí | ídem — el portal PCM con Turnstile es aparte y sigue manual (`--xlsx`, ver `backend/scrapers/README.md`) |
| `pnda_dji/` | PNDA | ✅ sí | ídem |
| `pnda_oece/` | PNDA | ✅ sí | ídem |
| `jne_infogob/` | PNDA (reporte oficial JNE) | ✅ sí | ídem — el snapshot de Infogob (`--root`) sigue manual |
| `mef_presupuesto/` | API MEF | ✅ sí | host abierto |
| `oece_ocds/` | API OCDS del OECE | ❌ no | **403 confirmado** desde IP de nube (WAF) — la imagen se construye igual, para correr con `docker run` en el VPS de Lima o la laptop (mismo Dockerfile, IP peruana), igual que hoy con `infrastructure/deploy/scrapers-job.sh` |
| `onpe_claridad/` | ONPE Claridad | ❌ no | **403 confirmado** (Cloudflare) + necesita Chromium con ventana; imagen propia con Xvfb para correr en el VPS/laptop con `docker run`, alternativa a la instalación local de Playwright |

**Consecuencia práctica:** `infrastructure/deploy/cloud-scrapers.sh` construye las 8
imágenes pero solo crea Cloud Scheduler para las 6 primeras. `oece_ocds` y `onpe_claridad`
siguen agendados donde ya funcionaban (VPS de Lima / Task Scheduler de la laptop,
`scrapers-job.sh` y `batch-nocturno.sh` con `ONPE=1`) — Cloud Scheduler no puede arreglar
un bloqueo geográfico/anti-bot, solo cambiaría *cuándo* corre, no *desde dónde*.

## Arquitectura

```
backend/cloud_functions/
├── _base/Dockerfile        imagen compartida: python:3.12-slim + requirements de
│                            backend/scrapers + el código de backend/scrapers y backend/scripts
│                            (sin navegador — la usan los 7 que no son onpe_claridad)
├── pnda_sancionados/Dockerfile   FROM <base> + ENTRYPOINT del pipeline (una línea)
├── pnda_visitas/Dockerfile
├── pnda_dji/Dockerfile
├── pnda_oece/Dockerfile
├── jne_infogob/Dockerfile
├── mef_presupuesto/Dockerfile
├── oece_ocds/Dockerfile
└── onpe_claridad/Dockerfile      imagen propia (mcr.microsoft.com/playwright/python, con Xvfb)
```

Cada job corre `python -m backend.scrapers.<fuente>.pipeline` **sin argumentos** — el mismo
comando que ya corre `run_all.py`/`batch-nocturno.sh`, con los valores por defecto de cada
pipeline (incremental: últimos N meses, mes cerrado, etc. — ver `add_arguments` de cada uno).
Conexión a Cloud SQL por el socket de Cloud Run (`--set-cloudsql-instances`, no necesita IP
en `authorized-networks`); el crudo descargado sube además a
`gs://vigia-peru-batch/raw/<fuente>/…` (`SCRAPER_GCS_BUCKET`) — mismo bucket y misma
convención que ya usa `batch-nocturno.sh`, así los CSV/XLSX quedan un clic away en GCS.

**Límite conocido:** el manifiesto de descarga (`backend/scrapers/_core/storage.py`, evita
re-bajar un archivo si no cambió) vive en el disco efímero del contenedor, así que cada
ejecución programada vuelve a descargar el archivo del mes/semana — no rompe nada (la
idempotencia real es `datasets_cargas` en Postgres, por sha256: si el contenido no cambió,
no se vuelve a cargar), solo gasta ancho de banda de más. No se resolvió aquí por ser
mensual/semanal (bajo impacto); si se vuelve un problema, cachear el manifiesto en el mismo
bucket es el siguiente paso natural.

## Desplegar

```bash
bash infrastructure/deploy/cloud-scrapers.sh                      # build base + 8 imágenes + 6 jobs + 6 Cloud Scheduler
bash infrastructure/deploy/cloud-scrapers.sh --solo pnda_dji       # una sola fuente
bash infrastructure/deploy/cloud-scrapers.sh --sin-scheduler       # solo build + deploy de los Jobs, sin tocar Cloud Scheduler
gcloud run jobs execute scraper-pnda-sancionados --region us-central1 --wait   # correr una a mano
gcloud scheduler jobs run scraper-pnda-sancionados --location us-central1     # disparar el cron ahora mismo
gcloud scheduler jobs list --location us-central1                              # ver las 6 agendas
```

## Cómo agregar un scraper nuevo a este esquema

1. Primero el pipeline en `backend/scrapers/<fuente>/` (ver "Cómo agregar una fuente" en
   `backend/scrapers/README.md`) — probado localmente con `--dry-run`.
2. Verificar si el host responde desde GCP (no asumir): agregar la URL al
   `cloudbuild-probe.yaml` de ejemplo de este README y correrlo, o simplemente desplegar el
   job y mirar el primer log — un 403/timeout sistemático es la señal de "Peru-only".
3. `mkdir backend/cloud_functions/<fuente>` + un `Dockerfile` de 3 líneas
   (`FROM …/scrapers-base:latest` + `ENTRYPOINT ["python","-m","backend.scrapers.<fuente>.pipeline"]`).
4. Fila nueva en el diccionario `CLOUD_SAFE` (o `PERU_ONLY`) de
   `infrastructure/deploy/cloud-scrapers.sh` con memoria/cpu/timeout/cron.
5. `bash infrastructure/deploy/cloud-scrapers.sh --solo <fuente>`.
