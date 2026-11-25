# vigia-scrapers

La captura de datos de Vigía y de Gobserva. Es el Worker `vigia-scrapers`, en Cloudflare Workers: cada corrida de una
fuente es una instancia de Workflows (`CorrerFuente`, `src/workflow.ts`). Los archivos que baja quedan en R2 y lo que
carga va a la base (PostgreSQL en AWS RDS).

Empezó el 2026-10-14 como un port a TypeScript de los pipelines de `backend/scrapers`, que corrían como Cloud Run Jobs
(`backend/cloud_functions`). Las fuentes de entonces dan las mismas filas que el Python: lo comprueban las pruebas de
paridad (más abajo). Las que se sumaron después sólo existen aquí.

## Fuentes y calendario

Lo decide `src/calendario.ts`. Hora de Lima (UTC-5, sin horario de verano).

| Fuente | Qué carga | Cuándo |
|---|---|---|
| `oece_ocds` | convocatorias y entidades de la API OCDS del OECE; al final, financiamiento y cruces | diario, 06:00 |
| `documentos` | los documentos de los expedientes de contratos financiados y de los pedidos de lectura, a R2 `vigia-peru-batch` | cada hora, al minuto 40 |
| `seace_cotizaciones` | contrataciones menores abiertas del SEACE (`seace_cotizacion`) | cada hora, al minuto 40 |
| `susalud_detalle` | el detalle de cada establecimiento de RENIPRESS, unas 1 200 por corrida | diario, 03:40 |
| `salud_lima` | prueba de la salida peruana (relay de Lima); no escribe datos | diario, 12:40 |
| `servir_convocatorias` | plazas CAS de SERVIR (`servir_convocatoria`); los jueves, la lectura completa | diario, 08:00 |
| `digemid` | alertas de DIGEMID y precios del Observatorio (Gobserva Salud) | diario, 08:00 |
| `servir_practicas` | prácticas de SERVIR (`servir_practica`) | diario, 09:00 |
| `seace_menores` | contratos menores de hasta 8 UIT (`seace_menores`) | lunes, 05:00 |
| `pnda_sancionados` | `osce_sancionados` (CSV del Tribunal) | domingo, 08:00 |
| `osce_penalidades` | `penalidades` (adjuntos de la wiki del OSCE) | domingo, 08:00 |
| `conosce_ordenes` | órdenes de compra y de servicio de CONOSCE, el año entero | domingo, 08:00 |
| `mef_presupuesto` | gasto del MEF por unidad ejecutora y por departamento | lunes, 08:00 |
| `oece_fichas` | la ficha en el OECE de las empresas sancionadas, hasta 700 por semana | lunes, 08:00 |
| `mtc_car` | listas de autorizados del MTC (Gobserva Car), a R2 `vigia-peru-reportes` | lunes, 08:00 |
| `oece_directas` | contrataciones directas que faltan en `convocatorias` | lunes, 08:00 |
| `mef_opds_etes` | gasto de organismos descentralizados y empresas municipales | martes, 08:00 |
| `sunat_padron` | padrón reducido de RUC de la SUNAT (sólo RUC 20) | martes, 08:00 |
| `onpe_claridad` | `onpe_aportantes` y `onpe_candidatos` | miércoles, 08:00 |
| `onpe_gastos` | `onpe_gastos_proveedores`: a quién le compró cada partido en campaña | miércoles, 08:00 |
| `congreso_visitas` | visitas al Congreso de los últimos 14 días | jueves, 08:00 |
| `infobras` | obras de INFOBRAS (`obra_infobras`) | jueves, 08:00 |
| `invierte_pe` | Banco de Inversiones del MEF (`inversion_mef`) | viernes, 08:00 |
| `susalud` | RENIPRESS, sanciones y demás registros de SUSALUD (Gobserva Salud) | viernes, 08:00 |
| `conosce` | adjudicaciones, postores, contratos y consorcios de CONOSCE (desde 2018) | sábado, 08:00 |
| `pnda_visitas` | `visitas_entidades` (XLSX mensual del GORE Loreto) | días 1 y 15, 08:00 |
| `pnda_oece` | sólo crudos: datasets del OECE en la PNDA | día 1, 08:00 |
| `oece_entidades` | registro de entidades contratantes (`entidad_siaf`) | día 2, 08:00 |
| `pnda_dji` | `dji_funcionarios` y `dji_empleos` | día 5, 08:00 |
| `jne_infogob` | `jne_autoridades` | día 5, 08:00 |
| `contraloria_informes` | informes de control con responsabilidad (`informes_control`), sin nombres ni DNI | día 10, 08:00 |
| `pte_personal` | `planilla_pte`: los dos meses anteriores del Portal de Transparencia | día 20, 08:00 |
| `oece_historico` | procesos adjudicados antes de 2018 (`procesos_historicos`) | sin cron: a mano |

**Segunda vuelta:** a las 15:40, el cron de cada hora vuelve a lanzar una vez `oece_ocds`, `servir_convocatorias` y
`servir_practicas` si su última corrida del día terminó en error.

Lo que sigue en Python, a mano: los modos `pnda_visitas --xlsx` y `jne_infogob --root` (`backend/scrapers`).

## Por dónde sale cada pedido

Varios sitios del Estado filtran por la IP de salida:

- **Directo:** la PNDA, el MEF, CONOSCE y la mayoría.
- **Relay de Zúrich** (`vigia-relay`, binding `RELAY`, secreto `RELAY_TOKEN`): la API OCDS del OECE, que da 403 desde
  Cloudflare en EE. UU., y el SEACE.
- **Relay de Lima** (`backend/relay-lima`, binding `RELAY_LIMA` de Workers VPC, secreto `RELAY_LIMA_TOKEN`): la
  Contraloría (informes e INFOBRAS), SERVIR y la ficha del OECE. Sólo responden a IPs del Perú.
- **Browser Rendering** (binding `BROWSER`): ONPE Claridad, que sólo deja pasar un navegador.

`GET /diagnostico?partes=lima,cgr` dice si la Contraloría llega por cada vía.

## Notas por fuente

### MEF

El MEF quitó `datastore_search_sql`. Lo que queda completo es el ZIP diario por año (2026: 549 MB, 8,95 M filas,
ZIP64). Se baja en streaming, se infla con `fflate` de forma síncrona (`DecompressionStream` acumulaba más de 1 GB y el
Worker se caía por memoria) y se agrega por unidad ejecutora y por departamento (`src/mef_agregado.ts`). Un año por
paso, unos 125 s de CPU. Los años cerrados vienen en `<año>-Gasto.zip` (`ULTIMO_ANUAL` en
`src/fuentes/mef_presupuesto.ts`): un año por corrida (`{"fuente":"mef_presupuesto","desde":"2019","hasta":"2019"}`),
porque la CPU de los pasos de una instancia se suma.

Las OPD (SAT, Serpar, Parque de las Leyendas…) y las empresas municipales no están en ese archivo: `mef_opds_etes`
(`src/mef_agregado_opds_etes.ts`) lee sus ZIP propios y los carga aparte, en `mef_opds_etes_*`. Nunca se suman a las
cifras por departamento. Corre los martes, el día después del SIAF, para que sus refrescos no se crucen.

### CONOSCE

Los reportes del SEACE están sueltos en `conosce.osce.gob.pe/buscador/assets/67ae6c4a/reportes/<carpeta>/<año>/`, sin
login ni WAF, y se regeneran los viernes. Los XLSX se leen por rangos desde R2 con `src/xlsx_flujo.ts` (la hoja se
infla en streaming con fflate) y salen como CSV, igual que los CSV, a COPY en una tabla temporal. Cada año se reemplaza
en una transacción.

- Los CSV escapan la comilla con barra (`\"`) desde el 2026-10-22. Pasan por `NormalizadorCsv` (`src/csv.ts`), que
  avisa lo que tuvo que completar o descartar. Con más de 0,5 % (y 50 registros) la carga falla.
- Las órdenes traen todo el texto en `xl/sharedStrings.xml` (un mes: hasta ~110 MB de XML). `TextosCompartidos`
  (`src/xlsx_flujo.ts`) los guarda compactos.
- Cada archivo de órdenes `<MES><año>` trae lo registrado en ese año con emisión en ese mes, de cualquier año. Por eso
  `conosce_ordenes` carga el año entero (los 12 archivos) y, en enero y febrero, también el anterior. Con ellas,
  `refrescar_fraccionamiento()` arma `ordenes_fraccionadas`.

### Contraloría

`src/fuentes/contraloria_informes.ts` lee el buscador de informes de la Contraloría (JSON sin captcha): los informes con
responsabilidad penal, civil o administrativa, con upsert por código. Cada fila trae el DNI y el nombre de los
funcionarios: sólo se toma una lista cerrada de campos (ni la base ni el crudo en R2 los tienen). Sale por el relay de
Lima. El respaldo a mano es `python backend/scripts/cargar_contraloria_informes.py --entorno prod`, desde una PC en el
Perú. Ver `docs/CORRUPCION.md`.

### Cruces

`oece_ocds`, `conosce`, `conosce_ordenes` y `onpe_gastos` terminan con `refrescar_cruces()`: los ganadores contra ONPE,
JNE, visitas, penalidades, sanciones, CONOSCE y el RNP. La API los muestra en la ficha del contrato y de la entidad.

### ONPE

`src/fuentes/onpe_claridad.ts` abre Claridad con `@cloudflare/puppeteer` y desde la página llama al backend JSON. Lo
que bloquea es Cloudflare por la huella del cliente, y Chromium pasa.

## Cómo corre

```
cron 0 11 * * *  (06:00 Lima) ─┐
cron 0 13 * * *  (08:00 Lima) ─┤                      ┌─ pasos: descargas, cargas, refrescos…
cron 40 * * * *  (cada hora)  ─┼─ src/calendario.ts ──┤   (lecturas con reintento; cargas idempotentes)
cron 0 10 * * 2  (lun 05:00)  ─┤   un Workflow por    └─ src/fuentes/<fuente>.ts
cron 0 14 * * *  (09:00 Lima) ─┤   fuente (CorrerFuente)
POST /correr ──────────────────┘
```

- **Base.** Hyperdrive con el rol `vigia_jobs` (dueño de las tablas de datasets). El camino: Workers VPC, túnel de
  Cloudflare, PgBouncer en el proxy de EC2 y RDS. Una conexión por paso; cada carga va en una transacción (reemplazo
  por clave o upsert), así que un reintento no duplica nada.
- **Crudos.** Van a R2 `vigia-peru-crudos`, en `raw/<fuente>/<clave o día>/<archivo>`, con un `manifest.json` por
  fuente: un archivo que no cambió no se vuelve a bajar. La idempotencia de la carga es `datasets_cargas` (sha256 por
  fuente y clave).
- **Modelo.** `digemid` le pide a `vigia-llm` (binding `LLM`) los productos y lotes de cada alerta.

### Límites que condicionan el código

| Límite | Cómo se respeta |
|---|---|
| 128 MB de memoria por isolate | Los CSV grandes van de R2 a COPY en streaming. El XLS del JNE se lee con `src/xls.ts`, un lector propio que usa unos 4 MB. |
| Sentencias largas por Hyperdrive | Ninguna debe acercarse a los 60 s documentados. El CSV de DJI va en varias sentencias COPY de 40 s o menos, cortadas en fin de registro. |
| CPU por invocación | `limits.cpu_ms` = 300 000. |
| Un paso devuelve 1 MiB o menos | Lo grande se guarda en R2 y se une en el paso de carga. |

## Rutas

| Ruta | Qué hace |
|---|---|
| `POST /correr` | `{fuente, seco?, forzar?, desde?, hasta?}`: lanza una corrida y devuelve `{instancia}`. `seco` parsea sin escribir; `forzar` recarga aunque el sha256 ya esté cargado. |
| `GET /instancias/<id>` | estado y resultado de una corrida (`<fuente>-<AAAAMMDD>-<HHMM>-<xxxx>`, hora de Lima) |
| `GET /diagnostico[?partes=…]` | prueba la base, el relay, el OECE directo (debe dar 403), la PNDA, el MEF y R2; `lima`, `cgr` y `pte` van aparte; `paso` corre lo mismo dentro de un Workflow |
| `GET /salud` | `{ok, activo}`, sin token |

Todas menos `/salud` piden `Authorization: Bearer <SCRAPERS_TOKEN>` (copia en SSM `/vigia/scrapers/token`).

```bash
curl -X POST https://vigia-scrapers.vigiaperu.workers.dev/correr -H "Authorization: Bearer $TOKEN" \
     -d '{"fuente": "oece_ocds", "seco": true, "desde": "2026-10-06", "hasta": "2026-10-13"}'
npx wrangler workflows instances list vigia-scrapers-correr     # las últimas corridas
```

## Variables, bindings y secretos (`wrangler.jsonc`)

| Nombre | Tipo | Para qué |
|---|---|---|
| `SCRAPERS_ACTIVO` | variable | `"1"`: los crons lanzan corridas. `"0"`: sólo registran qué habría corrido; `/correr` sigue andando |
| `HYPERDRIVE` | Hyperdrive | la base, rol `vigia_jobs` |
| `CRUDOS` | R2 `vigia-peru-crudos` | los crudos de cada descarga |
| `DOCUMENTOS` | R2 `vigia-peru-batch` | los documentos de los expedientes (los mismos que leen los agentes) |
| `MEDIOS` | R2 `vigia-peru-reportes` | las listas de Gobserva Car |
| `RELAY` | Worker `vigia-relay` | salida por Zúrich |
| `RELAY_LIMA` | servicio de Workers VPC | salida por Lima |
| `LLM` | Worker `vigia-llm` | el modelo |
| `BROWSER` | Browser Rendering | ONPE Claridad |
| `CORRER` | Workflow `vigia-scrapers-correr` | una corrida por fuente |

Secretos (`npx wrangler secret put`): `SCRAPERS_TOKEN`, `RELAY_TOKEN`, `RELAY_LIMA_TOKEN` y `LLM_TOKEN`.

El entorno `dev` (`vigia-scrapers-dev`) no tiene crons, usa la base `vigia-db-dev` y buckets `*-dev`. Se despliega con
`bash infrastructure/deploy/dev.sh scrapers` y se corre con `bash infrastructure/deploy/dev.sh correr '{...}'`.

## Pruebas

```bash
cd backend/scrapers-worker
npm ci
npm test                    # node --test test/*.test.ts: parsers, cargas y paridad con vectores del Python
npm run typecheck
npm run vectores            # regenera test/vectores_py.json con el código de backend/scrapers
python scripts/paridad_ocds.py 2026-10-06 2026-10-13 && node scripts/paridad_ocds.ts   # releases reales (IP peruana)
python scripts/paridad_archivos.py <carpeta> && node scripts/paridad_archivos.ts <carpeta>   # XLS, XLSX y CSV reales
```

Los datos reales de la paridad quedan en `.paridad/`, que no se sube.

## Desplegar

`bash infrastructure/deploy/cloudflare/worker.sh scrapers`, desde la raíz del repo. Se niega si la carpeta tiene
cambios sin commitear.
