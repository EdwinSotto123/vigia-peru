# backend/scrapers/

Pipelines de ingesta automática: **descargar → versionar el crudo → normalizar → cargar a Postgres**.
Reemplazan las descargas manuales con las que se armó `dataset/` durante el hackathon.

```
backend/scrapers/
├── _core/
│   ├── http.py          sesión requests con UA de navegador, retries, descarga streaming + sha256
│   ├── pnda.py          cliente de datosabiertos.gob.pe (DKAN): dataset → recursos + fecha de modificación
│   ├── storage.py       dataset/_raw/<fuente>/<fecha|clave>/… + manifest.json (salta lo que no cambió); GCS opcional
│   ├── registro.py      datasets_cargas: sha256 por (fuente, clave) → idempotencia + /admin/cobertura
│   ├── ubigeo.py        nombres (dpto/prov/dist) → ubigeo INEI usando `zonas`
│   └── pipeline.py      clase base Pipeline (fetch/load), CLI común, pg_dsn(), run_loader()
├── pnda_sancionados/    ✅ probado   proveedores sancionados OECE            → osce_sancionados
├── pnda_visitas/        ✅ cargado   registro de visitas (PNDA, mensual, 2025-01→) + export manual del portal PCM → visitas_entidades
├── pnda_dji/            ✅ cargado   declaraciones juradas de intereses      → dji_funcionarios / dji_empleos
├── pnda_oece/           ⚙ listo     datasets OECE (ofertantes, consorcios, SICAN, obras…) → crudos
├── oece_ocds/           ✅ probado   API OCDS, releases por fecha de convocatoria → convocatorias + entidades con ubigeo (cola real)
├── mef_presupuesto/     ⚙ listo     API MEF → mef-budget.json + mef_* en DB
├── onpe_claridad/       ✅ cargado   Playwright + API interna de Claridad (Cloudflare + reCAPTCHA v3) → onpe_aportantes, onpe_candidatos
├── jne_infogob/         ✅ cargado   reporte oficial "Autoridades vigentes/electas" del JNE (PNDA) → jne_autoridades · XLSX Infogob → jne_candidaturas
├── tests/               pytest con fixtures pequeños (sin red ni DB): `PYTHONPATH=. python -m pytest -q backend/scrapers/tests`
├── run_all.py           corre todos los automáticos (cron / batch-nocturno.sh)
└── requirements.txt
```

```bash
pip install -r backend/scrapers/requirements.txt
python -m backend.scrapers.run_all --list
python -m backend.scrapers.pnda_sancionados.pipeline --dry-run        # descarga + parsea, no escribe
python -m backend.scrapers.pnda_visitas.pipeline --since 2026-01       # todos los meses desde enero
python -m backend.scrapers.run_all --only pnda_sancionados,pnda_visitas # cron semanal
```

Conexión a la DB: mismas variables que `backend/db` (`PGHOST`, `PGUSER`, `PGDATABASE`,
`PGPASSWORD`, `PGSSLMODE`). `SCRAPER_GCS_BUCKET=<bucket>` sube cada crudo a `gs://…/raw/`.

---

## Catálogo de fuentes — de dónde sale cada tabla

Verificado el **2026-09-14** con `curl` desde IP peruana. La PNDA
(datosabiertos.gob.pe) resultó ser el origen de casi todo lo que se descargó a
mano: es DKAN, su API CKAN no responde, pero las páginas de dataset exponen
los archivos en `sites/default/files/` con fecha de modificación → scrapeable
sin navegador.

| Tabla / carpeta local | Fuente real | Acceso hoy | Pipeline | Estado |
|---|---|---|---|---|
| `convocatorias`, `entidades` (cola real, todo el Perú, con ubigeo distrital) | OECE Contrataciones Abiertas — API OCDS `contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter` | ✅ REST sin auth desde PE · ❌ 403 desde GCP (WAF) → laptop/VPS | `oece_ocds` | **probado** (backfill 90 días 2026-09-14) |
| `postores`, `convocatoria_items`, documentos | OECE — API OCDS `record/<ocid>` (expediente completo) | ídem · relay Lima | orquestador (`tools/ocds.py`) | en uso (al analizar) |
| `dataset/{datos_de_la_convocatoria, adjudicacion, contratos, ordenes, PAC, …}` | CONOSCE / `bi.seace.gob.pe` (datos abiertos SEACE) | 🟡 401 anónimo — descarga manual con usuario | — | snapshot mayo 2026 |
| `dataset/listdo_de_ofertantes`, `proveedores_y_consorcios`, `sican_*`, `PRONUNCIAMIENTOS` | PNDA — datasets OECE | ✅ CSV/XLSX directo | `pnda_oece` | listo |
| `rnp_conformacion_juridica` (1.44 M) | OECE RNP — conformación jurídica (portal RNP / CONOSCE) | 🟡 no está en PNDA; descarga manual | — | snapshot |
| `osce_sancionados`, `sancionados` | PNDA — "proveedores sancionados 2025" (Tribunal, sanción vigente) + inhabilitación/multa | ✅ CSV `;` CP1252, 0.9 MB, 2 414 filas | `pnda_sancionados` | **probado** |
| `visitas_entidades` | PNDA — "Reporte de registro de visitas (en línea) – <mes> – <año>": **lo publica el GORE Loreto** (una sola entidad visitada), 2025-01 → 2026-05, tres convenciones de slug (ver docstring) · el registro de **todas** las entidades vive en `visitas.servicios.gob.pe/consultas` (PCM) | ✅ XLSX 2-5 MB/mes · ❌ el portal PCM: `POST /api/consultas-busqueda` exige token de Turnstile (`execute`, interaction-only) que no se emite bajo Playwright (Chromium ni Chrome) → export manual "Excel" con `--xlsx` | `pnda_visitas` | **cargado** 17 meses + export manual abr-may 2026 |
| `onpe_aportantes`, `onpe_candidatos` | **ONPE Claridad** → Consulta de aportantes. NO está en PNDA. Backend JSON `claridad.onpe.gob.pe/claridad-backend/portal/consult/*` (org/find, org/find-detail, org/find-ifa, candidate/find-lastname) con **DNI/RUC completos** | 🟡 Cloudflare (pasa con Chromium con ventana) + reCAPTCHA v3 (el token se genera en la página con `grecaptcha.execute`, sin login) · `requests`/`curl`/headless → 403 | `onpe_claridad` | **cargado** (ERM2018, ECE2020, EG2021, ERM2022, EMC*, EG2026 + IFA2019-2024 + padrón de candidatos) |
| `jne_autoridades` | PNDA — "Autoridades Vigentes JNE" / "Autoridades Electas JNE" (`autoridades_vigentes_<AAAAMMDD>.xls`, 13 237 filas): cargo, organización, región/provincia/distrito, ubigeo (codificación RENIEC, se convierte a INEI), vigencia, reemplazos | ✅ XLS directo · sin DNI (se completa desde `onpe_candidatos` por nombre + organización + proceso) | `jne_infogob` | **cargado** |
| `jne_candidaturas` (`dataset/ELECCIONES/*.xlsx`, `postulantes_congreso`) | **JNE Infogob** → Base de datos → proceso → Candidatos/Autoridades → XLSX | 🟡 Incapsula + formulario con captcha de imagen para descargar → manual (`jne_infogob --root`) | `jne_infogob --root` | snapshot (319 066 filas) |
| `peps` | SBS/UIF — no hay dataset abierto | ❌ | — | vacío (SERVIR como alternativa) |
| `mef_region_budget`, `mef_entity_budget` | MEF Datos Abiertos API `api.datosabiertos.mef.gob.pe/DatosAbiertos/v1` | ✅ | `mef_presupuesto` | en uso |
| `opiniones_oece` (721) + RAG | OECE — corpus de opiniones normativas (`CONOSCE_INTERPRETACIONNORMATIVA_1.xlsx`) | 🟡 manual | `build_rag_opiniones.py` | en uso |
| SUNAT (edad RUC, estado, domicilio) | decolecta `api.decolecta.com/v1` (scrapea SUNAT) | ✅ API con token | tool `sunat.py` | en uso (en vivo) |
| **`dji_funcionarios`, `dji_empleos`** | PNDA — Declaraciones Juradas de Intereses (Contraloría): `Reporte1.csv` 268 MB funcionarios, `Reporte3.csv` 442 MB empleos previos con RUC, `Reporte2.csv` 723 MB familiares (sin nombres) | ✅ CSV directo, actualizado 2026-08/09 | `pnda_dji` | **cargado** (tablas creadas por la migración 23) |
| INFOBRAS (avance físico de obras) | Contraloría `apps.contraloria.gob.pe/ciudadano` | 🟡 200 pero app JS; `appsinfobras` no responde | — | pendiente (cruce C5/C6) |
| El Peruano — designaciones | `busquedas.elperuano.pe` | ✅ 200 (buscador + PDF) | — | pendiente (cruce C8; DJI lo cubre parcialmente) |
| Contraloría — DJ de bienes y rentas | `appdji.contraloria.gob.pe` | ❌ 403 | — | — |

### Hallazgo: puerta giratoria (cruce nuevo, C9)

`Reporte3.csv` de las DJI trae, por cada funcionario, sus **empleos previos con RUC
del empleador**. Cruzado con `adjudicaciones.ruc_proveedor` y `miembros_comite`
permite detectar: *el funcionario que evaluó/firmó la adjudicación trabajó antes
en la empresa ganadora* (o pasó a trabajar en ella después). No está en el
catálogo C1–C8 y no depende de scraping frágil. La vista `dji_puerta_giratoria`
lo deja listo para el `compliance_agent`.

## Frecuencia sugerida (cron) — y dónde corre cada uno hoy

Desde el 2026-09-16, 6 de los 8 pipelines corren de verdad en GCP como Cloud Run Jobs
agendados con Cloud Scheduler (`backend/cloud_functions/`, `infrastructure/deploy/cloud-scrapers.sh`):
se comprobó con un `Cloud Build` (IP de GCP) que la PNDA y el API del MEF responden sin WAF,
así que no hace falta IP peruana para ellos. `oece_ocds` (API OCDS del OECE, WAF) y
`onpe_claridad` (Cloudflare + navegador con ventana) sí la necesitan — 403 confirmado desde
IP de nube — y siguen agendados donde ya funcionaban. Detalle completo, matriz e imágenes:
**`backend/cloud_functions/README.md`**.

| Pipeline | Cuándo | Dónde | Por qué |
|---|---|---|---|
| `pnda_sancionados` | semanal (domingo) | ☁ Cloud Scheduler → `scraper-pnda-sancionados` | el Tribunal resuelve todas las semanas |
| `pnda_visitas` | días 1 y 15 | ☁ Cloud Scheduler → `scraper-pnda-visitas` | la PNDA publica el mes cerrado con 2-3 meses de retraso; `datasets_cargas` evita recargar meses con el mismo sha256 |
| `pnda_dji` | día 5 | ☁ Cloud Scheduler → `scraper-pnda-dji` | Contraloría actualiza los CSV cada 1-2 meses; TRUNCATE+COPY solo si cambió el sha256 |
| `jne_infogob` | día 5 | ☁ Cloud Scheduler → `scraper-jne-infogob` | el JNE republica el reporte tras cada proclamación/vacancia |
| `pnda_oece` | mensual (día 1) | ☁ Cloud Scheduler → `scraper-pnda-oece` | datasets pesados; `--discover` avisa si aparece uno nuevo |
| `mef_presupuesto` | mensual, día 12 | ☁ Cloud Scheduler → `scraper-mef-presupuesto` | devengado cerrado |
| `oece_ocds` | diario 06:00 | 🖥 VPS de Lima / laptop, `infrastructure/deploy/scrapers-job.sh` (o `docker run` con la imagen de `backend/cloud_functions/oece_ocds/`) | **403 desde IP de nube** (WAF) — ventana rodante de 7 días, upsert idempotente, todo el Perú |
| `onpe_claridad` | mensual (`ONPE=1 bash batch-nocturno.sh`, día 10 sugerido); semanal en campaña | 🖥 VPS de Lima / laptop con sesión gráfica (o `docker run` con la imagen de `backend/cloud_functions/onpe_claridad/`, Xvfb) | **403 desde IP de nube** (Cloudflare) + necesita Chromium **con ventana** |

`batch-nocturno.sh` (VPS/laptop) ya NO dispara `pnda_sancionados`/`pnda_visitas`/`pnda_dji`/
`jne_infogob` por defecto (paso 6): correr esas cuatro ahí sería redundante con su Cloud
Scheduler (`datasets_cargas` lo haría inofensivo igual, por sha256, pero es trabajo de más).
Sigue disponible a mano con `DATASETS=<fuentes> bash infrastructure/deploy/batch-nocturno.sh`
si algún mes hay que forzar una recarga fuera de agenda.

## Cola real (`oece_ocds`) — de dónde salen los contratos que se financian

La cola de auditoría (`cola_auditoria` → `zona_estado` → mapa y `/financiar/[ubigeo]`) se
llena con **todas las convocatorias del Perú** publicadas en la API OCDS del OECE, mapeadas
al distrito de la entidad convocante. Es una ingesta *liviana*: no llama a SUNAT ni baja
documentos; el análisis completo lo hace el orquestador cuando un aporte financia el contrato.

Lo que se verificó de la API (2026-09-14, desde IP peruana):

| Endpoint | Sirve para | Gotcha |
|---|---|---|
| `GET /api/v1/releasesAfter?size=100&startDate=D&endDate=D` | **backfill y diario** | `startDate`/`endDate` filtran por `tender.tenderPeriod.startDate` (fecha de convocatoria), inclusivos. Cursor en `links.next`; sin tope de resultados. |
| `GET /api/v1/releases?page=N&date_gte=D` | explorar a mano | Devuelve **siempre 20** por página (ignora `limit`/`size`) y corta en **10 000** resultados. No usar para volumen. |
| `GET /api/v1/record/<ocid>` | expediente completo (orquestador) | 403 desde GCP → relay Lima. |

Detalles que importan:

- Un proceso aparece en muchos releases (planning, tender, award… ~10 por proceso): se deduplica
  por ocid quedándose con el release más reciente. Un día hábil ≈ 3 000-5 000 releases ≈ 250-400 convocatorias.
- `convocatorias.ocid` guarda el **sufijo corto** del OCID (`1249710`, `2026-10404-12`), igual que
  `tools/_core._short_ocid` en el orquestador: así la alerta que persiste el pipeline cierra la asignación.
- `parties[buyer].address = {department, region (=provincia), locality (=distrito)}` →
  `_core/ubigeo.py` resuelve el ubigeo INEI por nombre normalizado (tildes, guiones, mayúsculas) y
  por prefijo cuando el OCDS trunca el distrito (`SANTA CRUZ DE TOLED`). Backfill 2026-06-15 → 09-14:
  **18 370 convocatorias, 100 % con ubigeo, 99,5 % a nivel distrito**; los pocos a nivel provincia son
  distritos nuevos que faltan en `backend/db/seed/zonas.csv` (p. ej. San Antonio, Mariscal Nieto, 180107).
- `ON CONFLICT` no pisa lo que ya cargó el orquestador (objeto, cuantía, `ocds_payload` completo);
  sólo completa vacíos y actualiza `estado_tender`.
- Al final llama `refresh_financiamiento()` (≈30 s con 18 k filas): el mapa y `/financiamiento/estado` quedan al día.
- 429/5xx/timeouts: reintentos progresivos (2 → 40 s) además del `Retry` de la sesión.

```bash
python -m backend.scrapers.oece_ocds.pipeline --since 2026-09-13 --max-pages 2 --dry-run  # lista tríos sin ubigeo
python -m backend.scrapers.oece_ocds.pipeline --since 2026-06-15 --until 2026-07-31       # backfill (≈5 min / 45 días)
python -m backend.scrapers.oece_ocds.pipeline                                             # diario: últimos 7 días
bash infrastructure/deploy/scrapers-job.sh                                                # lo que corre el cron
```

**Dónde corre**: no en GCP. `infrastructure/deploy/scrapers-job.sh` está pensado para `crontab` en el
VPS de Lima o Task Scheduler + Git Bash en una laptop. La IP pública del host tiene que estar en
`authorized-networks` de Cloud SQL: `gcloud sql instances patch vigia-db --authorized-networks=<IP>/32`
(la contraseña la lee de `.cloudsql-password` o `PGPASSWORD`).

## Datasets externos (Frente D) — cómo corren y cómo se verifican

Todo lo que toca `.gob.pe` corre desde IP peruana (`infrastructure/deploy/batch-nocturno.sh`, paso 6):
el crudo sube a `gs://vigia-peru-batch/raw/<fuente>/<clave>/` (`SCRAPER_GCS_BUCKET`), la carga va
directa a Cloud SQL y cada archivo queda en `datasets_cargas (fuente, clave, sha256, filas, gcs_uri)`.
La vista `datasets_cobertura` (una fila por fuente) es lo que puede leer `/admin/cobertura → Fuentes externas`.

```bash
export PGHOST=34.71.244.66 PGSSLMODE=require SCRAPER_GCS_BUCKET=vigia-peru-batch
python -m backend.scrapers.pnda_visitas.pipeline --desde 2025-01 --hasta 2026-05      # backfill (17 meses, ~3 min)
python -m backend.scrapers.pnda_visitas.pipeline --xlsx dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx   # export manual del portal PCM
python -m backend.scrapers.jne_infogob.pipeline --dry-run                            # autoridades vigentes: ubigeo INEI resuelto, sin escribir
python -m backend.scrapers.onpe_claridad.pipeline --proceso EG2021 --max-orgs 2 --dry-run   # abre Chromium, baja 2 JSON, no escribe
python -m backend.scrapers.onpe_claridad.pipeline --ifa && python -m backend.scrapers.onpe_claridad.pipeline --candidatos
python -m backend.scrapers.pnda_dji.pipeline                                         # 700 MB, ~10 min
DATASETS=pnda_visitas,jne_infogob SIN_PEDIDOS=1 SIN_DOCUMENTOS=1 bash infrastructure/deploy/batch-nocturno.sh   # lo que hace el cron
```

Filas cargadas, últimas fechas, cruces con las reglas y bloqueos con evidencia: `docs/design/DATASETS.md`.

## Cómo agregar una fuente

1. `mkdir backend/scrapers/<fuente>` + `__init__.py` + `pipeline.py` con una subclase de `Pipeline`.
2. `fetch()` usa `self.store.fetch(url, filename, modified)` — el manifiesto evita re-bajar.
3. `load()` delega en un loader de `backend/scripts/` (`run_loader`) o hace `COPY` directo (ver `pnda_dji`).
   Antes de escribir: `ya_cargado(cur, fuente, clave, sha256)`; al terminar: `registrar(cur, Carga(...))`
   (`_core/registro.py`). Reemplazo por clave (periodo/proceso), nunca `INSERT` a ciegas.
4. Registrarla en `run_all.py` (AUTOMATIC o BROWSER), en la tabla de arriba y en `batch-nocturno.sh` (paso 6).
5. Si crea tablas nuevas: migración numerada en `backend/db/migrations/` con `fuente, sha256, descargado_at`.
6. Test con fixture pequeño en `tests/fixtures/` (sin red ni DB) y fila en `docs/design/DATASETS.md`.
