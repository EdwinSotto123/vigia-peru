# Entorno DEV

Una copia de Vigía para probar cambios con datos reales antes de que lleguen a producción. Nada de lo que pasa en DEV
se ve en producción: tiene su propia base, sus propios Workers y sus propios secretos.

| Pieza | Producción | DEV |
|---|---|---|
| Web | `vigia-web.vigiaperu.workers.dev` | `vigia-web-dev.vigiaperu.workers.dev` (pide usuario y clave) |
| API | `vigia-api.vigiaperu.workers.dev` | `vigia-api-dev.vigiaperu.workers.dev` |
| Scrapers | `vigia-scrapers` (con crons) | `vigia-scrapers-dev` (sin crons: sólo a mano) |
| Base | RDS `vigia-db` (db.t4g.large, 8 GB) | RDS `vigia-db-dev` (db.t4g.micro), un clon de producción |
| Roles de la base | `vigia_api`, `vigia_api_admin`, `vigia_jobs` | `dev_api`, `dev_api_admin`, `dev_jobs` (sólo existen en `vigia-db-dev`) |
| Hyperdrive | `vigia-api`, `vigia-api-admin`, `vigia-jobs` | `vigia-dev-api`, `vigia-dev-api-admin`, `vigia-dev-jobs` |
| R2 | `vigia-web-cache`, `vigia-peru-crudos`, `vigia-peru-batch` | los mismos con `-dev` |
| Secretos | Workers y Secret Manager | Workers `-dev`, guardados en SSM `/vigia/dev/` |

Los Workers DEV están en `env.dev` de cada `wrangler.jsonc` (`backend/api`, `frontend`, `backend/scrapers-worker`).

## El día a día

```bash
# 1. Cambiar el código (sin commitear todavía).
# 2. Si hay una migración nueva, aplicarla primero en DEV:
bash infrastructure/deploy/dev.sh migrar backend/db/migrations/84_precio_item.sql
bash infrastructure/deploy/dev.sh sql "SELECT refrescar_precio_item()"
# 3. Desplegar la copia de trabajo a DEV (la API en segundos, la web en ~10 min):
bash infrastructure/deploy/dev.sh api
bash infrastructure/deploy/dev.sh web
# 4. Mirarlo en https://vigia-web-dev.vigiaperu.workers.dev (usuario `vigia`, clave en SSM /vigia/dev/web-clave).
# 5. Si está bien: commit y desplegar a producción como siempre (migración en RDS, wrangler deploy, web-cloudflare-remoto.sh).
```

A diferencia de producción, que empaqueta el último commit (`git archive HEAD`), DEV despliega **la copia de trabajo**,
con lo que no está commiteado.

Otros comandos:

```bash
bash infrastructure/deploy/dev.sh scrapers                                   # desplegar vigia-scrapers-dev
bash infrastructure/deploy/dev.sh correr '{"fuente":"oece_ocds","seco":true}' # una corrida a mano contra la base DEV
bash infrastructure/deploy/dev.sh estado                                     # base, API y web DEV
bash infrastructure/deploy/dev.sh detener                                    # apagar la base DEV (sólo se paga el disco)
bash infrastructure/deploy/dev.sh encender
bash infrastructure/deploy/dev.sh clonar                                     # traer de nuevo los datos de producción (~40 min)
```

## Por qué DEV es más lento que producción

- **Es chica a propósito:** `vigia-db-dev` es db.t4g.micro (1 GB de RAM; producción, db.t4g.large con 8 GB). Lo que las
  páginas usan no le cabe en memoria y va a disco: sirve para probar que algo funciona, no cuánto tarda.
- **Recién clonada, cada bloque baja de S3 la primera vez que se lee**, mucho más lento que el disco. Después de `clonar`,
  correr `dev.sh precalentar` (lee todo una vez, ~30-40 min).
- **Para medir tiempos:** `dev.sh tamano db.t4g.large`, medir, y `dev.sh tamano db.t4g.micro` para volver (cada cambio son
  unos minutos sin base; la grande cuesta unos US$0.13 por hora).

## Lo que DEV no hace (a propósito)

- **No escribe en producción.** Los roles `dev_*` sólo existen en `vigia-db-dev`: aunque se filtraran, no entran a la base
  de producción. La API DEV no tiene dispatcher ni acceso a Cloud Storage.
- **No corre solo.** Sin crons en la API ni en los scrapers: los datos de DEV son los del último `clonar`.
- **No sube archivos.** Las subidas de la web (comprobantes, fotos de denuncias) van a Cloud Storage con una cuenta de
  servicio que DEV no tiene: en DEV fallan.
- **No lee contratos con agentes.** Para probar agentes contra DEV, apuntar una Lambda de evaluación a `vigia-db-dev`.
- **Captcha de prueba.** Usa las claves de prueba de Cloudflare Turnstile, que siempre pasan.
- **Login.** Usa el mismo proyecto de Firebase y los mismos administradores que producción. El dominio DEV está en los
  dominios autorizados de Firebase.

## Cómo está armado

- `vigia-db-dev` es un restore *point in time* de `vigia-db`, en la misma VPC, subred y grupo de seguridad, con el mismo
  grupo de parámetros. Tiene su propia clave maestra (SSM `/vigia/dev/db-admin`). Cuesta unos US$15 al mes encendida.
  AWS la vuelve a encender sola a los 7 días de detenida.
- Los Workers llegan a ella por el mismo camino que a producción: Hyperdrive → túnel → PgBouncer en `vigia-db-proxy`.
  PgBouncer tiene una base más, `vigia_dev`, que apunta a `vigia-db-dev`.
- **Si se recrea el proxy** (un `terraform apply` que cambie su `user_data` lo reemplaza), la base `vigia_dev` desaparece de
  PgBouncer: correr `bash infrastructure/deploy/dev.sh base`, que la vuelve a agregar. A propósito no está en
  `arranque.sh.tftpl`: cambiar esa plantilla reemplazaría el proxy de producción.
- La web DEV es el mismo build de OpenNext (con la API y el Turnstile de DEV) envuelto en `frontend/worker-dev.js`, que
  pide usuario y clave, agrega `X-Robots-Tag: noindex` y una franja "ENTORNO DEV". El código de la web no cambia.
- El script es `infrastructure/deploy/dev.sh`; lo que habla con AWS, la base y Cloudflare está en
  `infrastructure/dev/dev.py`.
