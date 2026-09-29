# Mudar Vigía a otro proyecto de GCP

La receta completa para llevar la plataforma a un proyecto nuevo (por ejemplo, uno más grande y financiado), probada en la mudanza `vivid-spot-480905-a4` → `project-a974c6e5-0cdf-4b11-a86` del 29/09/2026.

Cómo terminó esa mudanza:

- Tras el corte y un snapshot de la base nueva (`backend/db/snapshot/`), en vivid-spot se borraron la instancia de Cloud SQL, la VM de PgBouncer, los 4 agentes, los 10 jobs y sus Schedulers.
- Quedaron la entrada pública y los buckets.
- Las imágenes siguen en Artifact Registry, para volver a desplegar si hiciera falta.

**Ningún código ni script tiene un proyecto fijo.** Mudarse es:

1. Poner el proyecto nuevo en `PROJECT_ID` (`infrastructure/deploy/_common.sh` y `infrastructure/terraform/terraform.tfvars`).
2. Correr las fases de `migrar-proyecto.sh`.
3. Hacer el corte.

## Los tres proyectos que puede haber

| Variable (`_common.sh`) | Qué vive ahí | Hoy |
|---|---|---|
| `PROJECT_ID` | Cloud SQL, los 4 agentes (Vertex AI, Document AI, RAG Engine, Vertex AI Search), PgBouncer + túnel de Cloudflare, scrapers, ingesta, Secret Manager | `project-a974c6e5-0cdf-4b11-a86` |
| `ENTRADA_PROJECT_ID` | Entrada pública: Firebase Hosting `vigia-peru.web.app` y Cloud Run web, API y MCP | `vivid-spot-480905-a4` |
| `BUCKETS_PROJECT_ID` | Buckets `vigia-peru-*` (documentos, batch, reportes, privado), referenciados por URL en la base | `vivid-spot-480905-a4` |

En un proyecto único, las tres son iguales. La entrada deja de hacer falta cuando el dominio propio apunte a Cloudflare (`frontend/CLOUDFLARE.md`).

Fuera de GCP, sin cambios en una mudanza:

- **Firebase Auth:** `simplia-project`.
- **Cloudflare:** Workers, R2, Hyperdrive y el túnel `vigia-db`, que sigue a la VM de PgBouncer esté donde esté.

## Fases

```bash
export ORIGEN=<proyecto-actual> DESTINO=<proyecto-nuevo>
# Si son cuentas distintas:
export CUENTA_ORIGEN=<cuenta> CUENTA_DESTINO=<cuenta>
M=infrastructure/deploy/migracion/migrar-proyecto.sh
bash $M apis
bash $M identidades
bash $M secretos
bash $M base
bash $M ia
DOCAI=<id> INVOCADORES="<cuentas que llaman a los agentes>" bash $M agentes
bash $M pgbouncer
bash $M jobs
bash $M corte     # imprime los comandos del corte
```

| Fase | Qué hace | Tiempo medido (f1-micro) |
|---|---|---|
| `apis` | 14 APIs | 1 min |
| `identidades` | Agentes de servicio de Vertex; cuentas `vigia-agentes@` y `vigia-jobs@` con sus roles; roles para Cloud Build | 2 min |
| `secretos` | 13 secretos, sin imprimirlos | 1 min |
| `base` | Instancia, roles y extensiones; export del origen; import; dueños y permisos; contraseñas; comparación | ~12 min de creación, 12 de export, 51 de import, 10 de ANALYZE |
| `ia` | Procesador OCR, bucket del RAG, catálogo reescrito, 4 corpus, import y Vertex AI Search | 5 min, más ~1 h de import del RAG en segundo plano |
| `agentes` | Imagen, los 4 servicios desde `herramientas.py agentes-yaml` y los invocadores | 10 min |
| `pgbouncer` | VM e2-micro con PgBouncer, proxy a la base nueva y `cloudflared` | 5 min |
| `jobs` | 8 scrapers con sus Schedulers e ingesta | ~40 min |

Antes del corte, probá un análisis de punta a punta contra la base nueva: llamá al agente con el mismo cuerpo que arma el dispatcher (`backend/dispatcher-worker/src/stream.ts:cuerpo`). El análisis se guarda dos veces: primero sin dictamen y, ~50 s después, con dictamen y costos.

## Corte

`bash migrar-proyecto.sh corte` imprime los comandos con los valores reales. En resumen:

1. **Pausar escrituras.** Schedulers del origen en pausa y base del origen en solo lectura:
   ```sql
   ALTER DATABASE vigia SET default_transaction_read_only = on;
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'vigia' AND pid <> pg_backend_pid();
   ```
   Nada puede escribir en la base vieja y lo que lo intente falla, en vez de perderse.
2. **Comparar:** `herramientas.py comparar-bases`. Si difiere, repetir la fase `base`.
3. **Repuntar la entrada.** La API y el MCP de Cloud Run van directo a la base nueva, por conector de Cloud SQL, con `roles/cloudsql.client` para sus cuentas en el proyecto nuevo. El frontend pasa al agente nuevo.
4. **Túnel.** Levantar la VM nueva (fase `pgbouncer`) y detener la vieja. Hyperdrive y los Workers de Cloudflare no se tocan: el túnel `vigia-db` sigue a su conector.
5. **Cloudflare.** Actualizar las URLs de los agentes:
   - dispatcher (`AGENT_URL_*`) y web (`VIGIA_AGENT_URL`);
   - en la API, `AGENT_HOST_SUFFIX`;
   - después, `npx wrangler deploy`.
6. **Validar.** Reanalizar un contrato desde el panel (`POST /v1/admin/procesamientos/<ocid>/reanalizar`) y `POST /ejecutar` en el dispatcher. Tiene que quedar `procesado`, con dictamen y costo.
7. **Detener la base vieja** (`--activation-policy NEVER`). No se borra: queda de respaldo pagando solo el disco.

**Vuelta atrás mientras la base vieja siga intacta:**

- `ALTER DATABASE vigia RESET default_transaction_read_only`;
- `gcloud sql instances patch vigia-db --activation-policy ALWAYS`;
- revertir los pasos 3 a 5.

## Trampas encontradas

- **Lo que el export no trae.** `gcloud sql export sql` no trae dueños, roles, extensiones ni privilegios por defecto. Además, tras el import faltaban los permisos propios del dueño en 13 tablas. Lo resuelve `backend/db/snapshot/globales.py`, con sus archivos pre y post.
- **Import en una sola transacción.** Mientras dura, otras sesiones no ven las tablas.
- **`postgres` no es superusuario en Cloud SQL.** Sí puede hacer `ALTER DATABASE` (es miembro de `cloudsqlsuperuser`, dueño de la base) y cortar sesiones de otros roles.
- **Agentes de servicio de Vertex.** Un proyecto nuevo no los tiene. Sin `service-N@gcp-sa-vertex-rag` y `gcp-sa-vectorsearch`, RAG Engine serverless falla con `vectorsearch.collections.create denied`. El agente del RAG también necesita escribir en su bucket (`_import/`).
- **Catálogo del RAG.** `catalogo.json` guarda URIs con el nombre del bucket: al copiarlo hay que reescribirlas (`herramientas.py catalogo-rag`).
- **Cuota de embeddings.** En vivid-spot era de 5 por minuto y el corpus `criterios-vinculantes` nunca terminó de cargar (10 de 731). En el proyecto nuevo cargó todo en ~1 h a 60 por minuto.
- **Organizaciones nuevas.** Traen `iam.automaticIamGrantsForDefaultServiceAccounts`: la cuenta de Compute que usa Cloud Build no tiene roles, y `identidades` se los da.
- **Deploy por YAML.** `gcloud run services replace` con los YAML de `agentes-yaml` deja los 4 servicios iguales a los de producción.
- **Cloud Build y `${PROJECT_ID}`.** Para usarlo dentro de `substitutions` hace falta `options.dynamicSubstitutions: true`. Los `cloudbuild.yaml` de los scrapers ya lo tienen.
- **gcloud en Windows.** Las salidas terminan en CRLF (`tr -d '\r'` al iterar). En Git Bash, `--path=/x` se convierte en una ruta de Windows.
- **Proyecto por defecto de gcloud.** `_common.sh` exporta `CLOUDSDK_CORE_PROJECT` solo para el script. Antes hacía `gcloud config set project`, que cambiaba el de toda la máquina.

## Después de mudarse

- **Buckets.** Moverlos (`BUCKETS_PROJECT_ID`) es copiar con `gcloud storage rsync` y reescribir en la base las URLs `gs://vigia-peru-*` (`documentos.url_gcs` y afines). Hasta entonces, las cuentas nuevas tienen permiso sobre los buckets viejos.
- **Prueba gratis.** Si el proyecto nuevo está en prueba gratis, Google detiene sus recursos al terminar y los borra a los 30 días. Antes de eso: pasar la facturación a pago, o volver a mudarse con esta misma receta.
- **Terraform.** `infrastructure/terraform` crea la base de un proyecto nuevo (APIs, cuentas, roles, Cloud SQL, buckets, secretos, Document AI y Vertex AI Search) con solo cambiar `project_id` en `terraform.tfvars`. Los datos (base, RAG) y los servicios se cargan con estas fases.
