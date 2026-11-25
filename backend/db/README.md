# Base de datos

Una sola base PostgreSQL 16 (`vigia`) en AWS RDS, us-east-2. Extensiones: PostGIS, pgvector (`vector`), pg_trgm,
unaccent, btree_gin, pg_stat_statements y pg_cron. Desde el 2026-10-21 no acepta conexiones de internet.

La infraestructura (Terraform, con el estado en S3) y cómo mover los datos están en `cloud_sql/README.md`.

## Cómo se llega

| Quién | Cómo |
|---|---|
| Workers de Cloudflare (API, MCP, dispatcher, scrapers) | Hyperdrive, por un servicio de Workers VPC y un túnel de Cloudflare hasta PgBouncer (proxy de EC2), y de ahí a RDS |
| Agentes (AWS Lambda) | directo por la VPC, con TLS verificado (`PGSSLMODE=verify-full`) |
| Jobs de GitLab | túnel de Session Manager por el proxy, con el rol `vigia_ci` |
| Una PC | `python infrastructure/aws/tunel_rds.py prod` (o `dev`): abre `127.0.0.1:15432` (o `15433`) hasta Ctrl+C |

## Roles

| Rol | Uso |
|---|---|
| `vigia_api` | API, rutas públicas (10 s por sentencia) |
| `vigia_api_admin` | API, panel y crons (120 s) |
| `vigia_mcp` | MCP, sólo lectura |
| `vigia_dispatcher` | dispatcher |
| `vigia_jobs` | scrapers; dueño de las tablas de datasets |
| `vigia_agentes` | agentes en producción: escriben alertas y banderas (migración 43) |
| `vigia_ab` | agentes en evaluación: sólo lectura (migración 44) |
| `vigia_ci` | jobs de GitLab; miembro de `vigia_jobs` |

Los cinco primeros son de la migración 37. `postgres` queda para las migraciones y los scripts del operador. Las
contraseñas viven en AWS SSM, nunca en el repo.

## Migraciones

`migrations/` tiene un archivo `.sql` por cambio, numerado. Se aplican de a uno, en una transacción, por el túnel:

```bash
bash infrastructure/deploy/dev.sh migrar backend/db/migrations/<archivo>.sql                  # DEV (vigia-db-dev)
python -X utf8 backend/scripts/aplicar_migracion.py prod backend/db/migrations/<archivo>.sql   # producción
```

Primero en DEV, después en producción. `apply_all.py` sólo conoce las 21 primeras (su lista `ORDER`): no pone al día
una base.

## Otras carpetas

- `schemas/`: esquemas sueltos de algunos datasets (DJI, JNE, ONPE, RNP, visitas, opiniones del OECE).
- `seed/zonas.csv`: las zonas con su ubigeo.
- `cleanup/`: limpiezas de una sola vez, con su fecha.
- `snapshot/`: el procedimiento de copia de cuando la base estaba en Cloud SQL (legado).
- `cargar_grafo.py`: carga el grafo de la estructura del Estado (migración 126).
