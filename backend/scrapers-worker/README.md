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
| `mef_presupuesto` | `mef_ejecutora_anual` + `mef_departamento_desglose` desde `<año>-Gasto-Diario.zip` (o `<año>-Gasto.zip` hasta 2024) → `refrescar_mef_presupuesto()` (migraciones 47 y 152) | lunes 08:00 |
| `mef_opds_etes` | `mef_opds_etes_anual` + `mef_opds_etes_gasto`: organismos públicos descentralizados (`<año>-Gasto-OPDS.zip`, desde 2018) y empresas municipales (`<año>-Gastos-ETES.zip`, desde 2015), sólo para las fichas de entidad → `refrescar_mef_presupuesto()` (migración 152) | martes 08:00 |
| `onpe_claridad` | `onpe_aportantes` + `onpe_candidatos` con Browser Rendering (Cloudflare de la ONPE pasa con Chromium real) | miércoles 08:00 |
| `onpe_gastos` | `onpe_gastos_proveedores`: a quién le compró cada organización política en campaña (RUC o DNI y monto), mismo portal | miércoles 08:00 |
| `conosce` | `conosce_adjudicaciones` / `conosce_postores` / `conosce_contratos` / `conosce_consorcios` (todo el país, desde 2018) del portal CONOSCE del OECE | sábados 08:00 |
| `conosce_ordenes` | `conosce_ordenes`: órdenes de compra y de servicio por mes de registro (~275 000 al mes) → `refrescar_fraccionamiento(desde)` (migraciones 51 y 91), `refrescar_personas_ordenes(desde)` y `refrescar_personas_senales()` (personas contratadas, migración 91; `relleno: true` no rehace nada, ver docs/PERSONAS.md) | domingos 08:00 (el año entero, ~6 h; no con `conosce`) |
| `pte_personal` | `planilla_pte`: el personal que cada entidad publica en su Portal de Transparencia (rubro Personal, CSV por mes, sin DNI ni pensionistas) → `refrescar_planilla()` y `refrescar_personas_senales()` (migración 92) | día 20, 08:00 (los dos meses anteriores) |
| `contraloria_informes` | `informes_control`: informes de control de la Contraloría con responsabilidad penal, civil o administrativa (presunta), sin nombres ni DNI → `refrescar_informes_control_entidad()` (migración 90) | sin cron: hoy no llega (ver abajo) |

Lo que no se pasó:
- **`vigia-batch`**: baja documentos de los contratos financiados para los agentes, que siguen en GCP y están pausados.
- **Modos manuales**: `pnda_visitas --xlsx` y `jne_infogob --root` siguen en Python.

### MEF

El MEF quitó `datastore_search_sql`. Lo que queda completo es el ZIP diario por año (2026: 549 MB, 8,95 M filas,
ZIP64). Se baja en streaming, se infla con `fflate` de forma síncrona (`DecompressionStream` acumulaba más de
1 GB y el Worker se caía por memoria) y se agrega por unidad ejecutora y por departamento (`src/mef_agregado.ts`).
Un año por paso, ~125 s de CPU. Los años cerrados vienen en `<año>-Gasto.zip` (el MEF regeneró 2009-2024 del 18 al
20 de octubre de 2026, con las mismas 63 columnas; `ULTIMO_ANUAL` en `src/fuentes/mef_presupuesto.ts`): un año por
corrida (`{"fuente":"mef_presupuesto","desde":"2019","hasta":"2019"}`), porque la CPU de los pasos de una instancia se
suma y cada lectura del ZIP usa ~150-200 s. La ficha de cada entidad lleva todos los años cargados; la de la región,
los 5 últimos.

Las OPD (SAT, Serpar, Parque de las Leyendas…) y las empresas municipales (EPS de agua…) no están en ese archivo: la
fuente `mef_opds_etes` (`src/mef_agregado_opds_etes.ts`) lee sus ZIP propios (~2 MB cada uno, todos los años en una
corrida, ~1 s de CPU por archivo) y los carga aparte, en `mef_opds_etes_*`: nunca se suman a las cifras por departamento.
En las ETE sólo hay PIA, PIM y lo ejecutado (va donde el devengado; girado y comprometido quedan en NULL). Hasta 2018 el
archivo de ETES trae también las OPD con una «ejecución» que no cuadra con su devengado: se saltan (las OPD salen sólo del
de OPDS). Corre los martes, el día después del SIAF, para que sus refrescos no se crucen.

### CONOSCE

Los reportes del SEACE están sueltos en `conosce.osce.gob.pe/buscador/assets/67ae6c4a/reportes/<carpeta>/<año>/`,
sin login ni WAF, y se regeneran los viernes. Algunos años vienen sólo en XLSX (y los postores siempre): se leen por
rangos desde R2 con `src/xlsx_flujo.ts` (directorio central del ZIP, textos compartidos y la hoja inflada en
streaming con fflate) y salen como CSV, igual que los CSV, a COPY en una tabla temporal con la cabecera del archivo.
SheetJS no entra: la hoja de postores 2024 son 78 MB de XML. Cada año se reemplaza en una transacción.

Dos cambios de formato del 2026-10-22/23 (cargas caídas desde el 2026-10-24):
- Los CSV escapan la comilla con barra (`\"`) en vez de doblarla, y COPY partía esos registros ("missing data for
  column"). Pasan por `NormalizadorCsv` (`src/csv.ts`): lee `\"` y `""`, deja todo como CSV estándar del ancho de la
  cabecera, y lo que tenga que completar, recortar o descartar lo avisa (WARNING y `arreglos` en el resumen); con más
  de 0,5 % (y 50 registros) completados o descartados la carga falla.
- Las órdenes traen todo el texto en `xl/sharedStrings.xml` (agosto de 2026: 722 mil textos, 53 MB de XML; un
  diciembre, ~110 MB). `TextosCompartidos` (`src/xlsx_flujo.ts`) los guarda compactos: una pasada previa por la hoja
  cuenta los usos; los repetidos quedan tal cual y los que se usan una vez, comprimidos por bloque (node:zlib). Con
  las órdenes de agosto ocupan ~20 MB (antes, ~95 MB de heap).
- Y cada archivo de órdenes trae otra cosa: `<MES><año>` ya no son las registradas en ese mes sino las registradas en
  ese año con emisión en ese mes, de cualquier año (AGOSTO2026: emitidas en agosto de 2021 a 2026). `conosce_ordenes`
  reconoce la partición por las fechas de las filas: con la nueva reemplaza las órdenes del año con ese mes de
  emisión, y anio/mes siguen siendo los de registro. Por eso el sábado carga el año entero (los 12 archivos, también los
  meses que no llegaron), y en enero y febrero también el anterior.

Las órdenes (`conosce_ordenes`) vienen un XLSX por mes de registro (`ordenes/<año>/CONOSCE_ORDENESCOMPRA<MES><año>_0.xlsx`,
60–90 MB): cada mes se reemplaza en una transacción; por defecto los últimos 3 (`desde`/`hasta` en AAAA o AAAA-MM
para otros). Con ellas `refrescar_fraccionamiento()` arma `ordenes_fraccionadas`: días en que una entidad le
emitió a una misma empresa (RUC 20) varias órdenes "hasta 8 UIT" que juntas pasan el tope.

### Contraloría

`src/fuentes/contraloria_informes.ts` lee el Buscador de Informes de la Contraloría (`BusquedaInformesCGR.ashx`, JSON
sin captcha): los ~14 100 informes con responsabilidad penal, civil, administrativa de la entidad o PAS, 15 páginas de
1 000, una por paso, con upsert por código. Cada fila trae en `Text` el DNI y el nombre de los funcionarios: sólo se
toma una lista cerrada de campos (ni la base ni el crudo en R2 los tienen). Al final, `refrescar_informes_control_entidad()`
pone ubigeo y RUC (cruce por nombre con `entidades`; lo ambiguo queda sin RUC). Ver `docs/CORRUPCION.md`.

**No llega desde Cloudflare:** el servidor de la Contraloría sólo responde a IPs del Perú (2026-10-21: 522 directo, 522
por el relay de Zúrich, timeout con Browser Rendering y desde AWS us-east-2). Por eso no tiene cron y la carga mensual
es `python backend/scripts/cargar_contraloria_informes.py --entorno prod` desde una PC en el Perú (mismos campos y mismo
upsert). `GET /diagnostico?partes=cgr` dice si ya llega por alguna vía.

### Cruces

`oece_ocds` (diario), `conosce`, `conosce_ordenes` y `onpe_gastos` terminan con `refrescar_cruces()` (migraciones
48, 50 y 51): los ganadores contra ONPE, JNE, visitas, penalidades, sanciones, CONOSCE (también las órdenes del
mismo día) y el RNP. La API los muestra en la ficha del
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
| 60 s por sentencia en Hyperdrive (documentado). El 2026-10-14 no lo aplicaba, pero el 2026-10-15 cortó `refrescar_cruces` a los ~10 min ("Timed out while waiting for a message from another Hyperdrive node"): ninguna sentencia debe acercarse a eso (la migración 56 dejó los cruces en ~3 min) | El CSV de DJI va en varias sentencias COPY de ≤ 40 s, cortadas en fin de registro; la primera lleva `HEADER`. El `UPDATE … ruc_entidad` va por rangos de páginas (ctid). |
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
| `GET /diagnostico[?partes=db,relay,oece,pnda,mef,r2,paso]` | prueba base (con un COPY a una tabla temporal), relay, OECE directo (debe dar 403), PNDA, MEF y R2. `paso` hace lo mismo dentro de un Workflow. `cgr` (aparte) prueba el buscador de la Contraloría directo, por el relay y con Browser Rendering. |
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
