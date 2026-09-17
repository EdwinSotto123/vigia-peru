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

## 1. Qué se puede agendar desde GCP y qué no (verificado, no supuesto)

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

**Consecuencia práctica:** cada carpeta decide sola si se agenda o no (dentro de su propio
`cloudbuild.yaml`, ver §2). `oece_ocds` y `onpe_claridad` siguen agendados donde ya
funcionaban (VPS de Lima / Task Scheduler de la laptop, `scrapers-job.sh` y
`batch-nocturno.sh` con `ONPE=1`) — Cloud Scheduler no puede arreglar un bloqueo
geográfico/anti-bot, solo cambiaría *cuándo* corre, no *desde dónde*.

## 2. Cada carpeta es un repositorio autocontenido — no hay una imagen ni un script compartido

Esto es importante: **no existe una imagen base compartida ni un script externo que sepa
memoria/cpu/cron de cada fuente.** Cada carpeta tiene TODO lo suyo adentro:

```
backend/cloud_functions/
├── _vendor.py                 ← el ÚNICO archivo compartido: copia el código real (ver abajo)
├── pnda_sancionados/
│   ├── Dockerfile              ← construye la imagen de ESTE scraper, nada más
│   ├── cloudbuild.yaml         ← receta completa: vendorizar → build → push → deploy → scheduler
│   └── vendor/                 ← copia de backend/scrapers (generada, no se edita a mano)
├── pnda_visitas/    { Dockerfile, cloudbuild.yaml, vendor/ }
├── pnda_dji/        { Dockerfile, cloudbuild.yaml, vendor/ }
├── pnda_oece/       { Dockerfile, cloudbuild.yaml, vendor/ }
├── jne_infogob/     { Dockerfile, cloudbuild.yaml, vendor/ }
├── mef_presupuesto/ { Dockerfile, cloudbuild.yaml, vendor/ }
├── oece_ocds/       { Dockerfile, cloudbuild.yaml, vendor/ }   ← cloudbuild.yaml sin paso de scheduler
└── onpe_claridad/   { Dockerfile, cloudbuild.yaml, vendor/ }   ← Dockerfile propio (Playwright+Xvfb)
```

**¿Por qué existe `vendor/` si dije "autocontenido"?** Porque el código real de cada scraper
vive en `backend/scrapers/<fuente>/` (ahí se edita, ahí están los tests) — sería un desastre
mantenerlo duplicado a mano en 8 carpetas. `vendor/` es una **copia exacta**, regenerada por
`_vendor.py` **como primer paso de cada `cloudbuild.yaml`**, así que nunca se construye con
código viejo — pero una vez generada, la carpeta completa (Dockerfile + vendor/) es
autosuficiente: se puede hacer `docker build backend/cloud_functions/pnda_sancionados` sin
tocar nada fuera de esa carpeta. `_vendor.py` es literalmente lo único compartido entre las 8,
y solo hace una cosa (copiar archivos), no despliega nada.

**Desplegar UNA fuente es una sola línea, sin script intermedio:**

```bash
gcloud builds submit . --config backend/cloud_functions/pnda_sancionados/cloudbuild.yaml
```

Abrí `backend/cloud_functions/pnda_sancionados/cloudbuild.yaml` y ahí está TODO explícito:
memoria, cpu, timeout, el cron exacto y por qué, la imagen, el Job, el Scheduler — nada
escondido en un shell script aparte. `infrastructure/deploy/cloud-scrapers.sh` que queda es
un loop de 3 líneas por conveniencia ("desplegar las 8 de una"), no tiene lógica propia.

Cada job corre `python -m backend.scrapers.<fuente>.pipeline` **sin argumentos** — el mismo
comando que ya corre `run_all.py`/`batch-nocturno.sh`, con los valores por defecto de cada
pipeline (incremental: últimos N meses, mes cerrado, etc. — ver `add_arguments` de cada uno).
Conexión a Cloud SQL por el socket de Cloud Run (`--set-cloudsql-instances`, no necesita IP
en `authorized-networks`); el crudo descargado sube además a
`gs://vigia-peru-batch/raw/<fuente>/…` (`SCRAPER_GCS_BUCKET`) — mismo bucket y misma
convención que ya usa `batch-nocturno.sh`, así los CSV/XLSX quedan un clic away en GCS.

## 3. Qué descarga cada uno, en plata — no todos son "un CSV"

| Fuente | ¿Qué es lo que baja? | ¿Escribe en Postgres? |
|---|---|---|
| `pnda_sancionados` | 1 **CSV** ("Relación de proveedores sancionados...con sanción vigente.csv", ~0.9 MB, ~2 400 filas) + 1 **XLSX** (aún sin parser) | sí → `osce_sancionados` |
| `pnda_visitas` | 1 **XLSX** mensual ("REPORTE DE REGISTRO DE VISITAS EN LINEA - `<MES>` - `<AÑO>`.xlsx", 2-5 MB) — hoy solo lo publica el GORE Loreto en la PNDA | sí → `visitas_entidades` |
| `pnda_dji` | 2 **CSV** grandes: `dji_funcionarios.csv` (~268 MB) y `dji_empleos.csv` (~442 MB) — declaraciones juradas de intereses de la Contraloría | sí → `dji_funcionarios` / `dji_empleos` |
| `pnda_oece` | 7 datasets (**CSV/XLSX**, según lo que publique la PNDA cada vez): ofertantes, proveedores y consorcios, profesionales SICAN, pronunciamientos, cuadernos de obra digital (×2), valorizaciones de obras | **no** — solo descarga y versiona en GCS; cargar a DB es un paso aparte (`rnp_normalize.py` / `load_sancionados_osce.py` / consultarlo con DuckDB) |
| `jne_infogob` | 2 **XLS** ("autoridades_vigentes_`<fecha>`.xls", "autoridades_electas_`<fecha>`.xls") — reporte oficial del JNE publicado en la PNDA | sí → `jne_autoridades` (+ completa DNI cruzando con `onpe_candidatos`) |
| `mef_presupuesto` | **nada de archivo** — son consultas SQL en vivo a una API (`datastore_search_sql`) por departamento/año, la respuesta es **JSON** | sí → `mef_region_budget` / `mef_entity_budget` (hoy roto, ver README raíz de `backend/scrapers/`) |
| `oece_ocds` | **nada de archivo** — es la API OCDS del OECE (`releasesAfter`), contratos como **JSON** estructurado, consultado en vivo | sí → `convocatorias` / `entidades` |
| `onpe_claridad` | **nada de archivo tampoco** — API interna de ONPE Claridad consultada con un navegador (Playwright), la respuesta es **JSON** por aportante/candidato | sí → `onpe_aportantes` / `onpe_candidatos` |

Es decir: **5 de los 8 sí bajan un archivo real** (CSV/XLS/XLSX) que queda además en
`gs://vigia-peru-batch/raw/<fuente>/…`; **3 son APIs** que se consultan en vivo y el
resultado (JSON) se procesa directo, sin un "archivo" de por medio que guardar. Y de los 5
que sí bajan archivo, **`pnda_oece` es el único que NO llega solo hasta Postgres** — deja el
archivo listo en GCS pero falta un paso manual de carga.

**Límite conocido:** el manifiesto de descarga (`backend/scrapers/_core/storage.py`, evita
re-bajar un archivo si no cambió) vive en el disco efímero del contenedor, así que cada
ejecución programada vuelve a descargar el archivo del mes/semana — no rompe nada (la
idempotencia real es `datasets_cargas` en Postgres, por sha256: si el contenido no cambió,
no se vuelve a cargar), solo gasta ancho de banda de más. No se resolvió aquí por ser
mensual/semanal (bajo impacto); si se vuelve un problema, cachear el manifiesto en el mismo
bucket es el siguiente paso natural.

## 4. Desplegar

```bash
# una sola fuente (esto es TODO lo que hace falta — la receta vive en su propia carpeta):
gcloud builds submit . --config backend/cloud_functions/pnda_sancionados/cloudbuild.yaml

# las 8 de una (loop de conveniencia, sin lógica propia):
bash infrastructure/deploy/cloud-scrapers.sh
bash infrastructure/deploy/cloud-scrapers.sh pnda_dji jne_infogob   # un subconjunto

# probar el vendor/ en local sin gastar un build de Cloud Build:
python backend/cloud_functions/_vendor.py pnda_sancionados
docker build -t prueba-local backend/cloud_functions/pnda_sancionados

# operar lo ya desplegado:
gcloud run jobs execute scraper-pnda-sancionados --region us-central1 --wait   # correr una a mano
gcloud scheduler jobs run scraper-pnda-sancionados --location us-central1     # disparar el cron ahora mismo
gcloud scheduler jobs list --location us-central1                              # ver las 6 agendas
```

## 5. Cómo agregar un scraper nuevo a este esquema

1. Primero el pipeline en `backend/scrapers/<fuente>/` (ver "Cómo agregar una fuente" en
   `backend/scrapers/README.md`) — probado localmente con `--dry-run`.
2. Verificar si el host responde desde GCP (no asumir): un `gcloud builds submit --no-source
   --config <cloudbuild con un curl al host>` rápido, o simplemente desplegar el job y mirar
   el primer log — un 403/timeout sistemático es la señal de "Peru-only".
3. `mkdir backend/cloud_functions/<fuente>` + copiar el `Dockerfile` de una fuente parecida
   (cambiar el nombre en el `ENTRYPOINT`) + agregar la fuente a `FUENTES` en `_vendor.py` (y a
   `SCRIPTS_POR_FUENTE` si su `pipeline.py` invoca algo de `backend/scripts/`) + un
   `cloudbuild.yaml` (copiar uno existente y cambiar `_IMAGE`/`_JOB`/memoria/cpu/timeout/cron —
   quitar el paso 5 entero si es Peru-only).
4. `gcloud builds submit . --config backend/cloud_functions/<fuente>/cloudbuild.yaml`.
