# backend/scripts/

Utilidades de ingesta, seed y evaluación. El esquema SQL vive en [`../db/`](../db/). Todo corre con Python 3.12+
y `psycopg2` para lo que toca la base de datos. Ninguno se despliega: son
herramientas de operador.

## Conexión a la base de datos

Todos los scripts que tocan Postgres leen la conexión de variables de entorno
con los mismos nombres que usa `psql`:

| Variable | Default | Nota |
|---|---|---|
| `PGHOST` | `127.0.0.1` | IP pública de Cloud SQL o `127.0.0.1` vía Cloud SQL Auth Proxy |
| `PGPORT` | `5432` | |
| `PGUSER` | `postgres` | |
| `PGDATABASE` | `vigia` | |
| `PGPASSWORD` | — | Si falta, se lee de `.cloudsql-password` en la raíz (gitignored, formato `password: xxx`) |
| `PGSSLMODE` | `prefer` | `require` para IP pública de Cloud SQL |

Dev local (sin GCP):

```bash
docker compose -f infrastructure/docker-compose.yml up -d   # Postgres+PostGIS+pgvector en 127.0.0.1:5432, password `vigia`
export PGPASSWORD=vigia
python backend/db/apply_all.py --check
```

Contra Cloud SQL:

```bash
cloud-sql-proxy --port 5432 <PROJECT>:<REGION>:vigia-db   # terminal 1
export PGPASSWORD='...'                                    # terminal 2
python backend/db/apply_all.py --check
```

## 1. Esquema de la base (`backend/db/`)

Migraciones numeradas en `migrations/`, idempotentes (`CREATE ... IF NOT EXISTS`). Se aplican en orden:

| Archivo | Contenido |
|---|---|
| `01_extensions.sql` | postgis, pg_trgm, unaccent, vector |
| `02_core.sql` | entidades, empresas, personas, empresa_personas |
| `03_contrataciones.sql` | convocatorias, convocatoria_items, postores, ofertas (OCDS aplanado) |
| `04_alertas_red.sql` | alertas, banderas, persona_flags, network_expansions |
| `05_mef_cache.sql` | mef_region_budget, mef_entity_budget, reportes_indexados, convergencias |
| `06_documentos_opiniones.sql` | documentos, opiniones_oece, audit_log |
| `07_alertas_extras.sql` | columnas extra de alertas (score, tier, costo) |
| `08_penalidades.sql` | penalidades contractuales |

```bash
python backend/db/apply_all.py          # aplica todas
bash   backend/db/apply_all.sh       # alternativa con psql
```

Esquemas auxiliares en `backend/db/schemas/` (tablas de datasets externos, se cargan por separado):
`rnp_schema.sql` + `rnp_indexes.sql`, `osce_sancionados_schema.sql`,
`onpe_aportantes_schema.sql`, `jne_candidaturas_schema.sql`, `peps_schema.sql`,
`visitas_entidades_schema.sql`, `opiniones_oece_schema.sql` + `opiniones_oece_indexes.sql`.

## 2. Seed y datos de referencia

| Script | Qué hace |
|---|---|
| `seed/seed_db.py` | Carga `seed/mocks.json` + presupuesto MEF en la DB para tener un entorno demo |
| `map_dataset.py` | Cataloga el dataset local (`dataset/`) → `catalog.json` + `catalog_summary.txt` (gitignored) |
| `fetch_peru_geo.py` | Descarga la geometría de los 25 departamentos → `frontend/public/peru-departments.json` (solo stdlib) |
| `fetch_mef_budget.py` | Pre-cachea presupuesto MEF por departamento → `frontend/public/mef-budget.json` |
| `fetch_mef_entities.py` | Pre-cachea ejecución presupuestal por entidad → `frontend/public/mef-entities.json` |

## 3. Ingesta de datasets oficiales

Ver [`README_datasets_peruanos.md`](README_datasets_peruanos.md) para fuentes, formatos y comandos.

| Script | Fuente |
|---|---|
| `ingest/ingest_oece_one.py <ocid>` | Una convocatoria del OECE (OCDS) + RUC vía decolecta → Cloud SQL |
| `ingest/load_sanciones.py` | Sancionados OSCE, inhabilitaciones judiciales, penalidades (dataset local) |
| `load_sancionados_osce.py` | Sancionados OSCE desde datos abiertos |
| `load_aportantes_onpe.py` | Aportantes a partidos (ONPE) |
| `load_jne_candidaturas.py` | Candidaturas (JNE) |
| `load_visitas_entidades.py` | Registro de visitas a entidades |
| `rnp_normalize.py` | Normaliza RNP — Conformación Jurídica (1.44 M filas, CP1252, `\|`) para `COPY` |
| `opiniones_oece_normalize.py` | Normaliza el CSV de opiniones normativas OECE |
| `build_rag_opiniones.py` | Embeddings de opiniones OECE (Vertex `text-embedding-005`) → Parquet en GCS |
| `jsonl_to_parquet_and_upload.py` | Convierte el checkpoint JSONL de embeddings a Parquet y lo sube |
| `cargar_contraloria_informes.py --entorno dev\|prod` | Informes de control de la Contraloría con responsabilidad (presunta) → `informes_control` y su cruce con entidades (migración 90). Desde una PC en el Perú: el buscador no responde a IPs extranjeras |
| `cargar_ppedc_boletin.py --url <pdf> --entorno dev\|prod` | Boletín mensual de la Procuraduría Anticorrupción → `procuraduria_casos_sede` (migración 90) |

Los dos de corrupción (ver [`docs/CORRUPCION.md`](../../docs/CORRUPCION.md)) entran por el túnel de Session Manager
(`conexion()` de `infrastructure/aws/tunel_rds.py`), no por las variables `PG*`.

Los datasets crudos (SEACE/OECE, RNP) **no** están en el repo por tamaño: se
descargan del Drive del equipo a `dataset/` (gitignored).

## 4. Detección y evaluación

| Script | Qué hace |
|---|---|
| `detect/run_compliance.py <ocid>` | Corre las reglas de compliance sobre una convocatoria ya ingestada |
| `evals_vigia.py` | 4 evaluadores (2 LLM + 2 código) sobre análisis persistidos; alimenta métricas del pitch |

Las tools del orquestador son *schema-aware*: si una tabla auxiliar no existe,
devuelven `dataset_no_disponible: true` sin romper el pipeline.

## 5. Cargadores manuales (desde tu PC)

Lo que no corre solo en el Worker `vigia-scrapers`: cargas desde una PC en el Perú, por el túnel de Session Manager
(`infrastructure/aws/tunel_rds.py`). Escriben en la base que digas (`--entorno dev|prod`, o `dev|prod` como primer
argumento; `cargar_gobiernos.py` va por las variables `PG*`): prueba primero en `dev`, o con `--seco` donde exista. Los
que tienen fuente en la última columna dejan su fila en `datasets_cargas`, que es lo que lee el panel (Cobertura, Fuentes
de datos) para saber cuándo llegó el último dato.

| Script | Qué carga | `datasets_cargas` |
|---|---|---|
| `cargar_contraloria_informes.py --entorno dev\|prod` | Informes de control → `informes_control` (sólo IP peruana) | `contraloria_informes` |
| `cargar_ppedc_boletin.py --url <pdf> --entorno dev\|prod` | Boletín de la Procuraduría → `procuraduria_casos_sede` | `ppedc_boletin` |
| `cargar_obras.py --entorno dev\|prod` | INFOBRAS e Invierte.pe → `obra_infobras`, `inversion_mef` (sólo IP peruana) | `infobras`, `invierte_pe` |
| `cargar_servir_convocatorias.py --entorno dev\|prod` | Plazas CAS de SERVIR → `servir_convocatoria` | `servir_convocatorias` |
| `cargar_entidades_oece.py --entorno dev\|prod` | RUC y código SIAF de cada entidad → `entidad_siaf` | `oece_entidades` |
| `cargar_seace_menores.py --entorno dev\|prod --anio AAAA` | Relleno de compras menores → `seace_menores` | `seace_menores` |
| `cargar_menores_proveedor.py --entorno dev\|prod` | Fichas SUNAT de los ganadores de menores → `seace_proveedor_sunat` | `sunat_ruc` |
| `cargar_visitas_nacional.py --entorno dev\|prod --dir <ventanas>` | Visitas de la plataforma de la PCM → `visitas_entidades` | `portal_visitas_nacional` |
| `cargar_visitas_congreso.py --entorno dev\|prod` | Relleno de visitas al Congreso → `visitas_entidades` | — |
| `cargar_dji_parentesco.py --entorno dev\|prod --csv <Reporte2>` | Parentescos declarados en la DJI → `dji_parentesco` | — |
| `cargar_gobiernos.py` | Quién gobierna cada región, provincia y distrito → `gobierno_periodo` | — |
| `cadena_planilla.py dev\|prod` | No carga: corre en orden los 11 refrescos de la planilla y de las personas | — |

Los scrapers que bajan con navegador real (fichas SUNAT de la Consulta Múltiple, visitas de la PCM) y la carga de las
fichas SUNAT a `empresas` viven en [`backend/scrapers-pc/`](../scrapers-pc/), con sus datos fuera de git. Qué es cada
fuente, dónde corre, cada cuánto y cómo saber si se cayó: [`SCRAPERS.md`](../../SCRAPERS.md), en la raíz del repo.
