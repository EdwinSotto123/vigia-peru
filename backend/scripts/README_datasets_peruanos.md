# Datasets peruanos — de dónde salen y cómo se cargan

> El catálogo completo de fuentes (URL real, estado de acceso verificado, pipeline
> que la automatiza) vive en [`../scrapers/README.md`](../scrapers/README.md).
> Este archivo solo describe las tablas auxiliares que consulta el
> `person_network_agent` y sus loaders manuales. Estado, filas cargadas y cruces con las
> reglas: [`docs/design/DATASETS.md`](../../docs/design/DATASETS.md).

Las tools (`query_onpe_aportantes`, `query_jne_candidaturas`, `query_pep`,
`query_visitas`) son **schema-aware**: si la tabla no existe devuelven
`dataset_no_disponible: true` sin romper el pipeline.

| Tabla | Esquema | Loader manual | Pipeline automático |
|---|---|---|---|
| `onpe_aportantes` (+ `proceso`, `ruc_organizacion`, `sha256`; migración 23) | `../db/schemas/onpe_aportantes_schema.sql` | `load_aportantes_onpe.py --csv <export de Claridad>` | `scrapers/onpe_claridad` ✅ (Playwright + API interna de Claridad, por proceso electoral) |
| `onpe_candidatos` (migración 25) | `../db/migrations/25_onpe_candidatos.sql` | — | `scrapers/onpe_claridad --candidatos` ✅ (padrón de candidatos con DNI) |
| `jne_candidaturas` | `../db/schemas/jne_candidaturas_schema.sql` | `load_jne_candidaturas.py --root dataset/ELECCIONES` | `scrapers/jne_infogob --root` (XLSX de Infogob, manual) |
| `jne_autoridades` (migraciones 23/24) | `../db/migrations/23_datasets.sql` | — | `scrapers/jne_infogob` ✅ (reporte "Autoridades vigentes/electas" del JNE en la PNDA; ubigeo INEI; DNI vía `onpe_candidatos`) |
| `osce_sancionados` | `../db/schemas/osce_sancionados_schema.sql` | `load_sancionados_osce.py --xlsx <buscador OSCE>` | `scrapers/pnda_sancionados` ✅ |
| `visitas_entidades` (+ `fuente`, `periodo`, `sha256`; migración 23) | `../db/schemas/visitas_entidades_schema.sql` | `load_visitas_entidades.py --xlsx <mes>` (o `scrapers/pnda_visitas --xlsx <export del portal PCM>`) | `scrapers/pnda_visitas` ✅ (PNDA = solo GORE Loreto; el portal PCM de todas las entidades tiene Turnstile → export manual) |
| `dji_funcionarios`, `dji_empleos` | `../db/schemas/dji_schema.sql` (= migración 23) | — | `scrapers/pnda_dji` ✅ |
| `datasets_cargas`, vista `datasets_cobertura` | `../db/migrations/23_datasets.sql` | — | lo escriben todos los pipelines (sha256 por fuente/clave; idempotencia y panel `/admin/cobertura`) |
| `peps` | `../db/schemas/peps_schema.sql` | — | sin fuente abierta (SBS/UIF); alternativa: servidores públicos SERVIR |

Todos los loaders aceptan `--dsn` (o leen `PGHOST/PGUSER/PGDATABASE/PGPASSWORD`) y
`--dry-run`. Normalizan nombres a mayúsculas sin tildes (`*_norm`) y documentos a
8 (DNI) / 11 (RUC) dígitos para que los cruces del agente sean por igualdad.
