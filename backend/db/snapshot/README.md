# Snapshot y restauración de la base

Cómo sacar una copia completa de `vigia` y levantarla en otra instancia o en otro proyecto. Es lo que se usó para mudar la base de `vivid-spot-480905-a4` a `project-a974c6e5-0cdf-4b11-a86` el 29/09/2026: estructura, filas, dueños y permisos quedaron idénticos.

**La copia tiene datos personales (DNI, nombres). Nunca va al repositorio ni a un bucket público.**

## Qué hay en una copia

| Archivo | Qué trae | De dónde sale |
|---|---|---|
| `vigia-AAAA-MM-DD.sql.gz` | Tablas, filas, funciones, triggers, índices, vistas materializadas y permisos de la mayoría de los objetos | `gcloud sql export sql` (pg_dump de Cloud SQL) |
| `vigia-AAAA-MM-DD-pre.sql` | Extensiones, roles con sus límites y tiempos, membresías, permisos sobre `public` | `globales.py` |
| `vigia-AAAA-MM-DD-post.sql` | Dueños, permisos de cada objeto (incluidos los del dueño), privilegios por defecto, ANALYZE | `globales.py` |

El export de Cloud SQL **no** trae dueños, roles, extensiones ni privilegios por defecto. Sin los dos archivos de `globales.py` la base restaurada tiene todo a nombre de `postgres`, los scrapers (`vigia_jobs`) no pueden truncar sus tablas y faltan permisos en 13 tablas.

Las contraseñas de los roles no están en ningún archivo: viven en Secret Manager (`cloudsql-password`, `cloudsql-password-api`, `-api-admin`, `-mcp`, `-dispatcher`, `-jobs`).

## Sacar una copia

```bash
P=<proyecto>; B=gs://<bucket-privado>
# 1. Datos. --offload usa una instancia temporal y no carga a la de producción (cuesta unos centavos).
gcloud sql export sql vigia-db $B/snapshots/vigia-$(date +%F).sql.gz --database vigia --offload --project $P
gcloud storage cp $B/snapshots/vigia-$(date +%F).sql.gz .
# 2. Globales (solo lectura). IP pública de la instancia con tu IP en authorized-networks.
PGHOST=<ip> PGUSER=postgres PGDATABASE=vigia \
PGPASSWORD="$(gcloud secrets versions access latest --secret cloudsql-password --project $P)" \
  python backend/db/snapshot/globales.py --salida vigia-$(date +%F)
```

La cuenta de servicio de la instancia (`gcloud sql instances describe vigia-db --format='value(serviceAccountEmailAddress)'`) necesita `roles/storage.objectAdmin` en el bucket.

## Restaurar

```bash
P=<proyecto-destino>; B=gs://<bucket-en-destino>; F=vigia-AAAA-MM-DD
# 1. Instancia y base (o terraform apply en infrastructure/terraform)
gcloud sql instances create vigia-db --project $P --database-version POSTGRES_16 --edition ENTERPRISE \
  --tier db-f1-micro --region us-central1 --storage-type SSD --storage-size 10 --storage-auto-increase \
  --root-password="$(gcloud secrets versions access latest --secret cloudsql-password --project $P)" \
  --database-flags=log_min_duration_statement=500,max_connections=40,track_io_timing=on \
  --insights-config-query-insights-enabled --backup-start-time 08:00 --ssl-mode ENCRYPTED_ONLY \
  --authorized-networks <tu-ip>/32
gcloud sql databases create vigia --instance vigia-db --project $P

# 2. Antes del import: extensiones, roles, membresías
psql "host=<ip> user=postgres dbname=vigia sslmode=require" -v ON_ERROR_STOP=1 -f $F-pre.sql

# 3. Import (una sola transacción: todo o nada; 51 min en db-f1-micro, subir de tier acelera)
gcloud storage cp $F.sql.gz $B/snapshots/
gcloud storage buckets add-iam-policy-binding $B --role roles/storage.objectViewer \
  --member serviceAccount:$(gcloud sql instances describe vigia-db --project $P --format='value(serviceAccountEmailAddress)')
gcloud sql import sql vigia-db $B/snapshots/$F.sql.gz --database vigia --user postgres --project $P

# 4. Después del import: dueños, permisos, privilegios por defecto, ANALYZE (~10 min)
psql "host=<ip> user=postgres dbname=vigia sslmode=require" -v ON_ERROR_STOP=1 -f $F-post.sql

# 5. Contraseñas de los roles, desde Secret Manager (no pasan por el log de sentencias)
for par in vigia_api:cloudsql-password-api vigia_api_admin:cloudsql-password-api-admin vigia_mcp:cloudsql-password-mcp \
           vigia_dispatcher:cloudsql-password-dispatcher vigia_jobs:cloudsql-password-jobs; do
  gcloud sql users set-password "${par%%:*}" --instance vigia-db --project $P \
    --password="$(gcloud secrets versions access latest --secret ${par#*:} --project $P)"
done
```

Sin `psql`, los dos archivos se pueden correr con Python y pg8000 (sentencia por sentencia), o subirlos al bucket y usar `gcloud sql import sql` con `--user postgres`.

Para restaurar localmente en Docker: `infrastructure/docker/postgres.Dockerfile` trae PostGIS y pgvector; se corre igual `-pre.sql`, luego `gunzip -c $F.sql.gz | psql`, y al final `-post.sql`.

## Verificar

`python infrastructure/deploy/migracion/herramientas.py comparar-bases` compara dos bases objeto por objeto: funciones, triggers, índices, restricciones, filas de cada tabla, dueños y permisos. Tras la mudanza del 29/09 dio 0 diferencias.
