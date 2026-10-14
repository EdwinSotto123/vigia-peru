# vigia-scrapers (Cloudflare Workers)

Los pipelines de `backend/scrapers` corriendo en Cloudflare. Antes eran Cloud Run Jobs con Cloud Scheduler en el
proyecto de agentes de GCP (`backend/cloud_functions/`). Ese proyecto se pausó el 2026-10-14 porque se rechazó
el pago, y los scrapers se pasaron acá.

Es un port a TypeScript, no un contenedor. Hace lo mismo que el Python: mismas fuentes, mismo SQL y mismas
filas. Lo comprueban las pruebas de paridad (ver más abajo).

| Fuente | Qué carga | Cuándo (hora de Lima) |
|---|---|---|
| `oece_ocds` | convocatorias + entidades desde la API OCDS del OECE (la cola real), y `refresh_financiamiento()` | diario 06:00 |
| `pnda_sancionados` | `osce_sancionados` (CSV del Tribunal, `;` y CP1252) | domingos 08:00 |
| `pnda_visitas` | `visitas_entidades` por periodo (XLSX mensual del GORE Loreto) | días 1 y 15, 08:00 |
| `pnda_dji` | `dji_funcionarios` / `dji_empleos` (CSV de 268 y 442 MB) | día 5, 08:00 |
| `jne_infogob` | `jne_autoridades` (XLS del JNE) + DNI desde `onpe_candidatos` | día 5, 08:00 |
| `pnda_oece` | solo crudos (datasets del OECE en la PNDA) | día 1, 08:00 |
| `mef_presupuesto` | `mef_ejecutora_anual` + `mef_departamento_desglose` desde `<año>-Gasto-Diario.zip` → `refrescar_mef_presupuesto()` (migración 47) | lunes 08:00 |
| `onpe_claridad` | `onpe_aportantes` + `onpe_candidatos` con Browser Rendering (Cloudflare de la ONPE pasa con Chromium real) | miércoles 08:00 |
| `onpe_gastos` | `onpe_gastos_proveedores`: a quién le compró cada organización política en campaña (RUC o DNI y monto), mismo portal | miércoles 08:00 |
| `conosce` | `conosce_adjudicaciones` / `conosce_postores` / `conosce_contratos` (todo el país, desde 2018) del portal CONOSCE del OECE | sábados 08:00 |

Lo que no se pasó:
- **`vigia-batch`**: baja documentos de los contratos financiados para los agentes, que siguen en GCP y están pausados.
- **Modos manuales**: `pnda_visitas --xlsx` y `jne_infogob --root` siguen en Python.

### MEF

El MEF quitó `datastore_search_sql`. Lo que queda completo es el ZIP diario por año (2026: 549 MB, 8,95 M filas,
ZIP64). Se baja en streaming, se infla con `fflate` de forma síncrona (`DecompressionStream` acumulaba más de
1 GB y el Worker se caía por memoria) y se agrega por unidad ejecutora y por departamento (`src/mef_agregado.ts`).
Un año por paso, ~125 s de CPU. Los ZIP de 2022-2024 ya no se publican y el API por páginas tarda 60 s cada
32 000 filas: esos años quedan con los datos regionales que ya había en la base.

### CONOSCE

Los reportes del SEACE están sueltos en `conosce.osce.gob.pe/buscador/assets/67ae6c4a/reportes/<carpeta>/<año>/`,
sin login ni WAF, y se regeneran los viernes. Algunos años vienen sólo en XLSX (y los postores siempre): se leen por
rangos desde R2 con `src/xlsx_flujo.ts` (directorio central del ZIP, textos compartidos y la hoja inflada en
streaming con fflate) y salen como CSV, igual que los CSV, a COPY en una tabla temporal con la cabecera del archivo.
SheetJS no entra: la hoja de postores 2024 son 78 MB de XML. Cada año se reemplaza en una transacción.

### Cruces

`oece_ocds` (diario), `conosce` y `onpe_gastos` terminan con `refrescar_cruces()` (migraciones 48 y 50): los
ganadores contra ONPE, JNE, visitas, penalidades, sanciones, CONOSCE y el RNP. La API los muestra en la ficha del
contrato y de la entidad.

### ONPE

`src/fuentes/onpe_claridad.ts` abre Claridad con `@cloudflare/puppeteer` (binding `BROWSER`) y desde la página
llama al backend JSON (`org/find`, `find-ifa`, `find-detail` en tandas de 40, `candidate/...`). El backend no
valida el reCAPTCHA; lo que bloquea es Cloudflare por huella del cliente, y Chromium pasa.

## Cómo corre

```
cron 0 11 * * * (06:00 Lima) ─┐                    ┌─ paso: zonas, días del OCDS, descargas, cargas…
cron 0 13 * * * (08:00 Lima) ─┼─ src/calendario.ts ─┤   (lecturas con reintento; cargas idempotentes)
POST /correr ─────────────────┘   un Workflow por   └─ src/fuentes/<fuente>.ts
                                  fuente (CorrerFuente)
```

- **Base.** Hyperdrive `vigia-jobs`, con el rol de los jobs (`vigia_jobs`, dueño de las tablas de datasets).
  El recorrido es Workers VPC → túnel → PgBouncer del proxy EC2 → RDS. Se usa una conexión por paso y las
  cargas van en una transacción (reemplazo por clave o upsert). Un reintento no duplica nada.
- **OECE.** Responde 403 desde Cloudflare en EE.UU. (los Workflows corren en Miami). Los GET salen por el Worker
  `vigia-relay`, que corre en Zúrich, mediante un service binding y con `RELAY_TOKEN`. La PNDA responde directo.
- **Crudos.** Van a R2 `vigia-peru-crudos`, en `raw/<fuente>/<clave o día>/<archivo>`. Cada fuente tiene un
  `manifest.json`, como `_core/storage.py`. En Cloud Run el disco era efímero; acá el manifiesto persiste y un
  archivo que la fuente no cambió no se vuelve a bajar. La idempotencia de la carga sigue siendo
  `datasets_cargas` (sha256 por fuente y clave). `gcs_uri` queda como `r2://vigia-peru-crudos/raw/…`.

### Límites que condicionan el código

| Límite | Cómo se respeta |
|---|---|
| 128 MB de memoria por isolate | Los CSV grandes van de R2 a COPY en streaming. El XLS del JNE se lee con `src/xls.ts`, un lector propio que usa ~4 MB; SheetJS ocupaba ~150 MB. Los XLSX (~3-5 MB) sí van con SheetJS. |
| 60 s por sentencia en Hyperdrive (documentado; el 2026-10-14 todavía no lo aplicaba) | El CSV de DJI va en varias sentencias COPY de ≤ 40 s, cortadas en fin de registro; la primera lleva `HEADER`. El `UPDATE … ruc_entidad` va por rangos de páginas (ctid). |
| CPU por invocación | `limits.cpu_ms` = 300 000. Un release OCDS cuesta ~0,08 ms y el XLS del JNE ~0,3 s. |
| Un paso devuelve ≤ 1 MiB | Las filas del OCDS de cada día se guardan en R2 y se unen en el paso de carga. |

### Diferencias con Python (a propósito)

- Una fecha `AAAAMMDD` inválida en sancionados queda en null. Python lanzaba `ValueError` y cortaba toda la carga.
- `oece_ocds` toma "hoy" en hora de Lima. El contenedor tomaba la de UTC; a las 06:00 Lima es el mismo día.
- `pnda_oece` corre a las 08:00 y no a las 09:00.
- `pnda_dji` en seco carga en una tabla temporal igual a la destino y la descarta, en vez de solo contar
  líneas. Eso valida el CSV contra el esquema sin tocar las tablas.

## Endpoints

| | |
|---|---|
| `POST /correr` | `{fuente, seco?, forzar?, desde?, hasta?}` lanza una corrida ahora y devuelve `{instancia}`. `seco` parsea sin escribir; `forzar` recarga aunque el sha256 ya esté cargado; `desde`/`hasta` son `AAAA-MM-DD` en oece_ocds y `AAAA-MM` en pnda_visitas. |
| `GET /instancias/<id>` | estado y resultado de una corrida (`<fuente>-<AAAAMMDD>-<HHMM>-<xxxx>`, hora de Lima) |
| `GET /diagnostico[?partes=db,relay,oece,pnda,mef,r2,paso]` | prueba base (con un COPY a una tabla temporal), relay, OECE directo (debe dar 403), PNDA, MEF y R2. `paso` hace lo mismo dentro de un Workflow. |
| `GET /salud` | `{ok, activo}`, sin autenticación |

Todos menos `/salud` piden `Authorization: Bearer <SCRAPERS_TOKEN>`. El token está en SSM:
`aws ssm get-parameter --name /vigia/scrapers/token --with-decryption --profile founder.edwin --region us-east-2`.

```bash
curl -X POST https://vigia-scrapers.vigiaperu.workers.dev/correr -H "Authorization: Bearer $TOKEN" \
     -d '{"fuente": "oece_ocds", "seco": true, "desde": "2026-10-06", "hasta": "2026-10-13"}'
curl https://vigia-scrapers.vigiaperu.workers.dev/instancias/<id> -H "Authorization: Bearer $TOKEN"
npx wrangler workflows instances list vigia-scrapers-correr     # las últimas corridas
```

## Variables y secretos

| | |
|---|---|
| `SCRAPERS_ACTIVO` | `"1"`: los crons lanzan corridas. `"0"`: solo registran qué habría corrido; `/correr` sigue andando. |
| `SCRAPERS_TOKEN` (secreto) | endpoints manuales; copia en SSM `/vigia/scrapers/token` |
| `RELAY_TOKEN` (secreto) | lo exige `/raw` del relay: es el `local-downloader-token` de los jobs; copia en SSM `/vigia/relay/token` |

Bindings: Hyperdrive `vigia-jobs` (`5bdb5027…`), R2 `vigia-peru-crudos`, service `vigia-relay` y Workflow `vigia-scrapers-correr`.
La contraseña de `vigia_jobs` está en la userlist de PgBouncer (SSM `/vigia/proxy/userlist`, ver
`cloud_sql/archivos/preparar_proxy.sh`) y en la config de Hyperdrive.

## Pruebas

```bash
npm test                    # paridad con Python sobre vectores sintéticos (test/vectores_py.json) y los fixtures
npm run typecheck
python scripts/vectores_py.py                                  # regenera los vectores con el código de Python
python scripts/paridad_ocds.py 2026-10-06 2026-10-13 && node scripts/paridad_ocds.ts   # releases reales (local, IP peruana)
python scripts/paridad_archivos.py <carpeta> && node scripts/paridad_archivos.ts <carpeta>   # XLS/XLSX/CSV reales
```

Los datos reales quedan en `.paridad/`, que no se sube.

Verificado el 2026-10-14:
- 4 467 releases reales del OCDS dieron 1 186 convocatorias iguales campo por campo, también corriendo en Cloudflare.
- Los XLS del JNE (13 237 y 208 filas), el CSV de sancionados (2 414) y dos meses de visitas (5 049 y 2 540)
  salieron idénticos.
- El lector de XLS coincide con xlrd celda por celda.

## Desplegar

`npx wrangler deploy` desde esta carpeta.

Para volver a GCP: `"SCRAPERS_ACTIVO": "0"` acá y reanudar los jobs `scraper-*` de Cloud Scheduler. Esos jobs
no deben correr a la vez que este Worker: sería trabajo doble, aunque las cargas son idempotentes.
