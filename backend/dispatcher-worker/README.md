# vigia-dispatcher

El que reparte los análisis. Es el Worker `vigia-dispatcher`, en Cloudflare Workers: cada 5 minutos reclama los
contratos encolados en `procesamientos` y se los manda a las Lambdas de agentes de AWS (`backend/agent`), una por red.

Sólo analiza lo que entra a `procesamientos`: los contratos financiados y los reanálisis que pide el panel. El análisis
masivo y los reanálisis en lote no pasan por aquí: los lanzan los jobs `tarea:masivo-agentes` y `tarea:reanalisis` de
GitLab, directo a las Lambdas (`backend/scripts/masivo_agentes.py`, `backend/scripts/reanalizar_contratos.py`).

Reemplazó el 2026-09-27 al job de Cloud Run `backend/dispatcher`, con la misma semántica y el mismo SQL, sentencia por
sentencia. Estuvo apagado del 14 de octubre al 4 de noviembre de 2026; desde entonces llama a las Lambdas.

## Encender y apagar

Hoy está encendido: `"triggers": { "crons": ["*/5 * * * *"] }` y `"DISPATCHER_ACTIVO": "1"` en `wrangler.jsonc`.

Para apagarlo: `"crons": []` y `"DISPATCHER_ACTIVO": "0"`, y desplegar. Con la variable en 0 el cron no reclama nada.
Apagado, se sigue usando a mano: `POST /ejecutar` (una corrida) y `GET /simular` (una corrida en seco).

## Cómo corre

```
cron */5 o POST /ejecutar ──► corrida: reclamar_procesamientos(PARALLEL, "cloudflare-<id>")
                                │  un Workflow por contrato reclamado = un hilo de la corrida
                                ▼
Workflow ProcesarContratos  c1-preparar → c1-tramo-1 → c1-tramo-2 … → c1-alerta / c1-gracia… → c1-terminar
                            → c1-reclamar (siguiente, si la ventana de reclamo sigue abierta) → c2-… → refrescar-zonas
```

- **Reclamo.** `reclamar_procesamientos(n, worker)` con `FOR UPDATE SKIP LOCKED`. Cada corrida queda como
  `cloudflare-<id>` en `procesamientos.worker`.
- **A qué Lambda.** Por el tipo del contrato (`src/rutas.ts`): bienes, servicios, obras, consultoría y otros
  (directas y convenios). Cada red tiene su URL (`AGENT_URL_<RED>`).
- **Documentos.** Si faltan, abre un pedido de descarga (lo atiende la fuente `documentos` de `vigia-scrapers`) y el
  contrato espera.
- **Llamada.** `POST {lambda}?stream=1` con el Bearer `AGENTE_TOKEN`. El NDJSON se reduce evento por evento y el
  contrato se cierra con `terminar()`.
- **El stream en tramos.** Un análisis dura de 5 a 60 minutos y un paso de Workflows no puede pasar de 30. Cada tramo
  (`DISPATCHER_TRAMO_S`, 20 min por defecto) lee el NDJSON, guarda cada evento visible, late cada 30 s y devuelve un
  checkpoint chico. El stream sigue abierto para el tramo siguiente.
- **Si la instancia se reinicia** a mitad de stream, nunca se vuelve a llamar al agente: espera la alerta en la base y
  cierra `procesado` si apareció, o re-encola (3 intentos) si no.
- **Reintentos.** Las lecturas, 3. Las escrituras no idempotentes, ninguno: si fallan, la fila queda `procesando` sin
  latido y el próximo reclamo la re-encola a los 20 minutos.
- **Base.** Hyperdrive con el rol `vigia_dispatcher`. Una conexión `pg` nueva por paso y sólo sentencias sueltas.
- **OCDS.** Sale de `convocatorias.ocds_payload`. El prefetch al OECE queda de respaldo, pero desde Cloudflare en EE. UU.
  el WAF responde 403.

### Límites de Workflows en los que se apoya

| Límite (docs, 2026-09) | Valor | Cómo se respeta |
|---|---|---|
| Timeout de un paso | 30 min o menos ([reglas](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)) | tramos de hasta 25 min con timeout de 30; gracia en pasos de hasta 10 min |
| Tiempo de pared de un paso | sin límite ([límites](https://developers.cloudflare.com/workflows/reference/limits/)); la espera de red no cuenta como CPU | el stream se lee esperando E/S |
| CPU por invocación | 30 s por defecto en Workers Paid; 10 ms en Free | reducir una corrida real cuesta unos 5 a 9 ms más el protocolo de Postgres: hace falta Workers Paid |
| Subpedidos | 10 000 por invocación en Paid | por contrato: 1 al agente, 1 al OECE como mucho y una conexión por paso |
| Resultado de un paso | 1 MiB o menos | el checkpoint lleva sólo el estado reducido; el OCDS nunca sale de un paso |

Alternativas descartadas: un cron, un consumidor de Queues o una alarma de Durable Object cortan a los 15 minutos de
pared; un Durable Object sin alarma necesita un cliente conectado durante todo el análisis.

## Rutas

| Ruta | Qué hace |
|---|---|
| `POST /ejecutar` | una corrida ahora, aunque `DISPATCHER_ACTIVO` sea 0: `{worker, reclamados, instancias, plazo}` |
| `GET /simular?n=5` | en seco: qué se re-encolaría, qué está en curso y los próximos `n` que se reclamarían, con su red, documentos, decisión y el error que quedaría. No escribe nada |
| `GET /instancias/<id>` | estado de un Workflow (`cloudflare-<id>-<hilo>`) |
| `GET /salud` | `{ok, activo}`, sin token |

Las tres primeras piden `Authorization: Bearer <DISPATCHER_TOKEN>`. Sin el secreto configurado responden 401.

La API las usa: `POST /v1/admin/dispatcher/run` y los lotes del panel llaman a `POST /ejecutar` por service binding.

## Variables y secretos (`wrangler.jsonc`)

| Variable | Valor hoy | Para qué |
|---|---|---|
| `AGENT_URL_BIENES`, `_SERVICIOS`, `_OBRAS`, `_CONSULTORIA`, `_OTROS` | Function URL de cada Lambda | a qué agente va cada tipo |
| `AGENT_URL` | la de bienes | respaldo para bienes y para contratos sin clasificar |
| `DISPATCHER_ACTIVO` | 1 | el cron reclama sólo con 1 |
| `DISPATCHER_PARALLEL` | 1 | hilos por corrida |
| `DISPATCHER_MAX_MINUTES`, `DISPATCHER_TASK_TIMEOUT_S`, `DISPATCHER_ANALISIS_MAX_S` | 25, 7200, 3600 | la ventana de reclamo (`plazo_de_reclamo`) |
| `DISPATCHER_STREAM_TIMEOUT` | 1200 | segundos sin datos antes de dar el stream por cortado |
| `DISPATCHER_GRACE_MINUTES` | 20 | espera de la alerta tras un corte |
| `DISPATCHER_MAX_EVENTOS` | 400 | tope de `procesamientos.eventos` |
| `DISPATCHER_PREFETCH_OCDS`, `DISPATCHER_REQUIERE_DOCS_GCS` | 1, 1 | como en el job de Python |
| `DISPATCHER_TRAMO_S` | 1200 | duración de cada tramo del stream (de 10 a 1500) |

Bindings: `HYPERDRIVE` (rol `vigia_dispatcher`) y el Workflow `PROCESAR` (`vigia-dispatcher-procesar`).

Secretos (`npx wrangler secret put`):

- `AGENTE_TOKEN`: el Bearer de las Lambdas (copia en SSM `/vigia/agente/token`).
- `DISPATCHER_TOKEN`: las rutas manuales.
- `GCP_SA_KEY`: sólo si se volviera a Cloud Run. `AGENT_ID_TOKEN`, sólo para desarrollo.

## Pruebas

```bash
cd backend/dispatcher-worker
npm ci
npm run typecheck
npm test                 # node --test test/*.test.ts: stream, cierre, rutas y la semántica del job de Python
npm run build            # wrangler deploy --dry-run --outdir .wrangler-dist (no despliega)
PYTHON=<python con requests y psycopg2> npm run paridad -- corrida_A.ndjson   # el reductor da lo mismo que el de Python
```

De punta a punta contra una base de prueba (nunca producción): el mismo contrato pasa por el dispatcher de Python
(`backend/dispatcher`) y por este Worker, los dos contra un agente falso, y se comparan las filas que dejan.

```bash
node scripts/agente_falso.ts 8840 corrida.ndjson &
cp .dev.vars.example .dev.vars                       # y poner un DISPATCHER_TOKEN
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://<usuario>:<clave>@127.0.0.1:<puerto>/vigia?sslmode=require"
npx wrangler dev --port 8831 &
PGHOST=… PGUSER=… PGPASSWORD=… python scripts/e2e_staging.py --ocid <con docs y alerta> --ocid-sin-docs <sin docs>
```

`scripts/e2e_staging.py` fotografía y restaura cada fila que toca, y se niega a correr si hay otros procesamientos
encolados o en curso.

## Desplegar

`bash infrastructure/deploy/cloudflare/worker.sh dispatcher`, desde la raíz del repo. Se niega si la carpeta tiene
cambios sin commitear.

## Diferencias con el job de Python

- **Reinicio después del `final`:** si la instancia se reinicia entre el `final` y el checkpoint del tramo, el cierre lo
  decide la espera de gracia. El job lo daba por procesado sin mirar.
- **`DISPATCHER_PARALLEL` mayor que 1:** un aborto frena sólo a su hilo, no a la corrida entera. Con 1 (el valor
  desplegado) es idéntico.
- **Sin tope de tarea:** `DISPATCHER_TASK_TIMEOUT_S` sólo entra en la ventana de reclamo.
- **Lecturas reintentadas:** una consulta de sólo lectura que falla se reintenta 3 veces en vez de fallar el contrato.
- **Números en textos:** un float entero del stream (`1.0`) sale `1`. Sólo afecta si `msg`, `detail` o `_aborted`
  vienen como número.
