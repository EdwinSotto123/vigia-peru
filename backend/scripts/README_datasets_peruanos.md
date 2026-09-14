# Datasets peruanos — de dónde salen y cómo se cargan

> El catálogo completo de fuentes (URL real, estado de acceso verificado, pipeline
> que la automatiza) vive en [`../scrapers/README.md`](../scrapers/README.md).
> Este archivo solo describe las tablas auxiliares que consulta el
> `person_network_agent` y sus loaders manuales.

Las tools (`query_onpe_aportantes`, `query_jne_candidaturas`, `query_pep`,
`query_visitas`) son **schema-aware**: si la tabla no existe devuelven
`dataset_no_disponible: true` sin romper el pipeline.

| Tabla | Esquema | Loader manual | Pipeline automático |
|---|---|---|---|
| `onpe_aportantes` | `../db/schemas/onpe_aportantes_schema.sql` | `load_aportantes_onpe.py --csv <export de Claridad>` | `scrapers/onpe_claridad` (Playwright) |
| `jne_candidaturas` | `../db/schemas/jne_candidaturas_schema.sql` | `load_jne_candidaturas.py --root dataset/ELECCIONES` | `scrapers/jne_infogob` (Playwright) |
| `osce_sancionados` | `../db/schemas/osce_sancionados_schema.sql` | `load_sancionados_osce.py --xlsx <buscador OSCE>` | `scrapers/pnda_sancionados` ✅ |
| `visitas_entidades` | `../db/schemas/visitas_entidades_schema.sql` | `load_visitas_entidades.py --xlsx <mes>` | `scrapers/pnda_visitas` ✅ |
| `dji_funcionarios`, `dji_empleos` | `../db/schemas/dji_schema.sql` | — | `scrapers/pnda_dji` |
| `peps` | `../db/schemas/peps_schema.sql` | — | sin fuente abierta (SBS/UIF); alternativa: servidores públicos SERVIR |

Todos los loaders aceptan `--dsn` (o leen `PGHOST/PGUSER/PGDATABASE/PGPASSWORD`) y
`--dry-run`. Normalizan nombres a mayúsculas sin tildes (`*_norm`) y documentos a
8 (DNI) / 11 (RUC) dígitos para que los cruces del agente sean por igualdad.
