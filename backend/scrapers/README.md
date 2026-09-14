# backend/scrapers/

Pipelines de ingesta automática: **descargar → versionar el crudo → normalizar → cargar a Postgres**.
Reemplazan las descargas manuales con las que se armó `dataset/` durante el hackathon.

```
backend/scrapers/
├── _core/
│   ├── http.py          sesión requests con UA de navegador, retries, descarga streaming + sha256
│   ├── pnda.py          cliente de datosabiertos.gob.pe (DKAN): dataset → recursos + fecha de modificación
│   ├── storage.py       dataset/_raw/<fuente>/<fecha>/… + manifest.json (salta lo que no cambió); GCS opcional
│   └── pipeline.py      clase base Pipeline (fetch/load), CLI común, pg_dsn(), run_loader()
├── pnda_sancionados/    ✅ probado   proveedores sancionados OECE            → osce_sancionados
├── pnda_visitas/        ✅ probado   registro de visitas en línea (mensual)  → visitas_entidades
├── pnda_dji/            ⚙ listo     declaraciones juradas de intereses      → dji_funcionarios / dji_empleos
├── pnda_oece/           ⚙ listo     datasets OECE (ofertantes, consorcios, SICAN, obras…) → crudos
├── oece_ocds/           ⚙ listo     API OCDS, releases nuevos por fecha/región → convocatorias
├── mef_presupuesto/     ⚙ listo     API MEF → mef-budget.json + mef_* en DB
├── onpe_claridad/       🧭 esqueleto Playwright sobre Claridad (Cloudflare) → onpe_aportantes
├── jne_infogob/         🧭 esqueleto Playwright sobre Infogob (SPA)         → jne_candidaturas
├── run_all.py           corre todos los automáticos (cron / Cloud Run Job)
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
| `convocatorias`, `postores`, `convocatoria_items` | OECE Contrataciones Abiertas — API OCDS `contratacionesabiertas.oece.gob.pe/api/v1` | ✅ REST sin auth desde PE · ❌ 403 desde GCP (WAF) → relay Lima | `oece_ocds` | en uso (orquestador) |
| `dataset/{datos_de_la_convocatoria, adjudicacion, contratos, ordenes, PAC, …}` | CONOSCE / `bi.seace.gob.pe` (datos abiertos SEACE) | 🟡 401 anónimo — descarga manual con usuario | — | snapshot mayo 2026 |
| `dataset/listdo_de_ofertantes`, `proveedores_y_consorcios`, `sican_*`, `PRONUNCIAMIENTOS` | PNDA — datasets OECE | ✅ CSV/XLSX directo | `pnda_oece` | listo |
| `rnp_conformacion_juridica` (1.44 M) | OECE RNP — conformación jurídica (portal RNP / CONOSCE) | 🟡 no está en PNDA; descarga manual | — | snapshot |
| `osce_sancionados`, `sancionados` | PNDA — "proveedores sancionados 2025" (Tribunal, sanción vigente) + inhabilitación/multa | ✅ CSV `;` CP1252, 0.9 MB, 2 414 filas | `pnda_sancionados` | **probado** |
| `visitas_entidades` | PNDA — "Reporte de registro de visitas en línea – <mes> – <año>" (PCM) | ✅ XLSX 2.7 MB/mes · último publicado **mayo 2026** · el portal vivo `visitas.servicios.gob.pe` tiene Turnstile | `pnda_visitas` | **probado** |
| `onpe_aportantes` | **ONPE Claridad** → Financiamiento privado → Aportes → exportar. NO está en PNDA (el slug `aportantes-onpe` redirige al buscador) | ❌ 403 / challenge Cloudflare a `requests` → navegador real + IP PE | `onpe_claridad` | esqueleto Playwright |
| `jne_candidaturas` (`dataset/ELECCIONES/*.xlsx`, `postulantes_congreso`) | **JNE Infogob** → Base de datos → proceso → Candidatos/Autoridades → XLSX (la nomenclatura `EG2016_Candidatos_Congresal.xlsx` es de Infogob) | 🟡 SPA (212 bytes sin JS) + reCAPTCHA · API `apiplataformaelectoral3.jne.gob.pe` sin doc | `jne_infogob` | esqueleto Playwright |
| `peps` | SBS/UIF — no hay dataset abierto | ❌ | — | vacío (SERVIR como alternativa) |
| `mef_region_budget`, `mef_entity_budget` | MEF Datos Abiertos API `api.datosabiertos.mef.gob.pe/DatosAbiertos/v1` | ✅ | `mef_presupuesto` | en uso |
| `opiniones_oece` (721) + RAG | OECE — corpus de opiniones normativas (`CONOSCE_INTERPRETACIONNORMATIVA_1.xlsx`) | 🟡 manual | `build_rag_opiniones.py` | en uso |
| SUNAT (edad RUC, estado, domicilio) | decolecta `api.decolecta.com/v1` (scrapea SUNAT) | ✅ API con token | tool `sunat.py` | en uso (en vivo) |
| **`dji_funcionarios`, `dji_empleos`** (nuevo) | PNDA — Declaraciones Juradas de Intereses (Contraloría): `Reporte1.csv` 268 MB funcionarios, `Reporte3.csv` 442 MB empleos previos con RUC, `Reporte2.csv` 723 MB familiares (sin nombres) | ✅ CSV directo, actualizado 2026-08/09 | `pnda_dji` | listo (esquema en `backend/db/schemas/dji_schema.sql`) |
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

## Frecuencia sugerida (cron)

| Pipeline | Cuándo | Por qué |
|---|---|---|
| `oece_ocds` | diario 06:00 | releases nuevos del día anterior, por región piloto |
| `pnda_sancionados` | semanal | el Tribunal resuelve todas las semanas |
| `pnda_visitas` | mensual, día 15 | la PNDA publica el mes cerrado con ~2 semanas de retraso |
| `pnda_dji` | mensual | Contraloría actualiza los CSV cada 1-2 meses |
| `pnda_oece` | mensual | datasets pesados; `--discover` avisa si aparece uno nuevo |
| `mef_presupuesto` | mensual, día 12 | devengado cerrado |
| `onpe_claridad` | mensual / semanal en campaña | a mano o desde el VPS (navegador) |
| `jne_infogob` | por proceso electoral | 2026: generales (abril) y regionales-municipales (octubre) |

Dónde correrlos: **no en GCP** (los `.gob.pe` bloquean IPs de nube). Opciones: el VPS
de Lima (`backend/relay`) con `cron`, o una laptop con `Task Scheduler`. Con
`SCRAPER_GCS_BUCKET` los crudos quedan en GCS y la carga a Cloud SQL puede correr
después desde un Cloud Run Job.

## Cómo agregar una fuente

1. `mkdir backend/scrapers/<fuente>` + `__init__.py` + `pipeline.py` con una subclase de `Pipeline`.
2. `fetch()` usa `self.store.fetch(url, filename, modified)` — el manifiesto evita re-bajar.
3. `load()` delega en un loader de `backend/scripts/` (`run_loader`) o hace `COPY` directo (ver `pnda_dji`).
4. Registrarla en `run_all.py` (AUTOMATIC o BROWSER) y en la tabla de arriba.
5. Si crea tablas nuevas: esquema en `backend/db/schemas/`.
