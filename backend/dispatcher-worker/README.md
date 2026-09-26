# vigia-dispatcher (Cloudflare Workers)

Réplica en Workers de `backend/dispatcher` (Cloud Run Job `vigia-dispatcher` + Cloud Scheduler
`vigia-dispatcher-run`, que siguen igual). Misma semántica que `main.py` y `events.py`: reclama
`procesamientos` encolados con `reclamar_procesamientos(n, worker)`, elige el servicio de agentes por
tipo, abre pedido de descarga si faltan documentos, manda `POST {agente}?stream=1` con el mismo cuerpo,
reduce el NDJSON evento por evento y cierra con `terminar()`. El SQL es el mismo, sentencia por sentencia.

Puede correr junto al job: el reclamo es `FOR UPDATE SKIP LOCKED` y cada corrida se identifica como
`cloudflare-<id>` en `procesamientos.worker` (las del job son `<ejecución>-<tarea>-<pid>`).

## Estado: apagado

`"triggers": { "crons": [] }` y `DISPATCHER_ACTIVO = "0"`. Para que el Worker tome la cola solo:

1. `"crons": ["*/5 * * * *"]` y `"DISPATCHER_ACTIVO": "1"` en `wrangler.jsonc` (sin la variable el cron no reclama);
2. `npx wrangler deploy`;
3. pausar el scheduler del job (`gcloud scheduler jobs pause vigia-dispatcher-run --location us-central1`).

Mientras tanto se usa a mano: `POST /ejecutar` (una corrida) y `GET /simular` (corrida en seco).

## Cómo corre (y por qué así)

```
cron */5 · POST /ejecutar ──► corrida: reclamar_procesamientos(PARALLEL, "cloudflare-<id>")
                                │  un Workflow por contrato reclamado = un hilo de la corrida
                                ▼
Workflow ProcesarContratos  c1-preparar → c1-tramo-1 → c1-tramo-2 … → c1-alerta / c1-gracia… → c1-terminar
                            → c1-reclamar (siguiente, si la ventana de reclamo sigue abierta) → c2-… → refrescar-zonas
```

- **Corrida = ejecución del job; Workflow = uno de sus hilos.** Cada hilo procesa su contrato y, mientras
  dure la ventana `plazo_de_reclamo` (misma fórmula y variables que `main.py`) y ningún análisis aborte,
  reclama el siguiente con la misma identidad. Un contrato `pendiente`/`esperando_documentos` se resuelve en
  segundos y el hilo sigue, igual que en Python.
- **El stream en tramos.** Un análisis dura 5–60 min y un paso de Workflows no puede tener timeout de más de
  30 min. Cada tramo (`DISPATCHER_TRAMO_S`, 20 min por defecto) es un paso que lee el NDJSON, persiste cada
  evento visible (`actualizar`), late cada 30 s y devuelve un checkpoint chico (estado reducido, resultado,
  eventos). El stream sigue abierto en memoria para el tramo siguiente, que corre en la misma invocación;
  una lectura pendiente al cerrar un tramo pasa al siguiente sin perder bytes.
- **Si el motor reinicia la instancia** (el paso se reintenta o la manija del stream ya no existe), nunca se
  vuelve a llamar al orquestador: el contrato sigue como un stream cortado de `main.py` → espera de gracia
  sondeando la alerta en DB, y cierra `procesado` si apareció o re-encola (3 intentos) si no.
- **Reintentos.** Lecturas: 3 reintentos. Escrituras no idempotentes (`reclamar`, `dejar_pendiente`,
  `esperar_documentos`, `terminar` ABORT): ninguno; si fallan, la fila queda `procesando` sin latido y el
  próximo reclamo la re-encola a los 20 min, como cuando el job muere.
- **Base.** Una conexión `pg` nueva por paso (la documentación de Workflows lo pide para Hyperdrive); solo
  sentencias sueltas en autocommit (Hyperdrive en modo transacción). `/simular` corre dentro de
  `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`.
- **OCDS.** Primero `convocatorias.ocds_payload` (se reenvía el texto tal cual lo guarda Postgres); el
  prefetch al OECE queda como respaldo, pero desde Cloudflare en EE.UU. el WAF responde 403.

### Límites de Workflows en los que se apoya

| Límite (docs, 2026-09) | Valor | Cómo se respeta |
|---|---|---|
| Timeout de un paso | ≤ 30 min ([reglas](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)) | tramos de ≤ 25 min con timeout de 30; gracia en pasos de ≤ 10 min |
| Tiempo de pared de un paso | sin límite ([límites](https://developers.cloudflare.com/workflows/reference/limits/)); la espera de red no cuenta como CPU | el stream se lee esperando E/S |
| CPU por invocación | 30 s por defecto en Workers Paid (hasta 5 min con `limits.cpu_ms`); **10 ms en Free** | reducir una corrida real de 1,3 MB cuesta ~5–9 ms más el protocolo de Postgres: **hace falta Workers Paid**, como en la API y el frontend |
| Subpedidos | 10 000 por invocación en Paid (50 en Free) | por contrato: 1 al orquestador, ≤ 1 canje de token, ≤ 1 al OECE y una conexión por paso |
| Resultado de un paso | ≤ 1 MiB | el checkpoint lleva solo el estado reducido; el OCDS nunca sale de un paso |
| Instancias corriendo a la vez | 100 en Free, 50 000 en Paid | una por hilo de corrida |
| Historial de instancias | 3 días en Free, 30 en Paid | — |

Alternativas descartadas: un cron, un consumidor de Queues o una alarma de Durable Object cortan a los 15 min
de pared; un Durable Object sin alarma necesita un cliente conectado durante todo el análisis.

## Endpoints

| | |
|---|---|
| `POST /ejecutar` | una corrida ahora (aunque `DISPATCHER_ACTIVO` sea 0): `{worker, reclamados, instancias, plazo}` |
| `GET /simular?n=5&tokens=1` | en seco: qué se re-encolaría por latido vencido, qué está en curso (y de qué réplica), los próximos `n` que se reclamarían con su clasificación, servicio, documentos, OCDS, decisión y texto de `error` que quedaría; `tokens=1` prueba el canje del ID token para cada servicio. No reclama ni escribe nada |
| `GET /instancias/<id>` | estado de un Workflow (`cloudflare-<id>-<hilo>`) |
| `GET /salud` | `{ok, activo}` (sin autenticación) |

Los tres primeros piden `Authorization: Bearer <DISPATCHER_TOKEN>` (comparación en tiempo constante); sin el
secreto configurado responden 401 a todo.

## Variables y secretos

Las de `infrastructure/deploy/dispatcher.sh` con los mismos valores; las de conexión (`PG*`) las reemplaza el
binding `HYPERDRIVE` (id `5616f9f3183941adb536f06fa2287bd3`, rol `vigia_dispatcher`).

| Variable | Valor | Uso |
|---|---|---|
| `AGENT_URL_BIENES` `…_SERVICIOS` `…_OBRAS` `…_OTROS` `AGENT_URL` | URLs de los 4 servicios | enrutado por tipo (`src/rutas.ts` = `url_para`) |
| `DISPATCHER_PARALLEL` | 1 | hilos por corrida |
| `DISPATCHER_MAX_MINUTES` · `DISPATCHER_TASK_TIMEOUT_S` · `DISPATCHER_ANALISIS_MAX_S` | 25 · 7200 · 3600 | ventana de reclamo (`plazo_de_reclamo`) |
| `DISPATCHER_STREAM_TIMEOUT` | 1200 | segundos sin datos antes de dar el stream por cortado |
| `DISPATCHER_GRACE_MINUTES` | 20 | espera de la alerta tras un corte |
| `DISPATCHER_MAX_EVENTOS` | 400 | tope de `procesamientos.eventos` |
| `DISPATCHER_PREFETCH_OCDS` · `DISPATCHER_REQUIERE_DOCS_GCS` | 1 · 1 | como en `main.py` |
| `DISPATCHER_ACTIVO` | 0 | solo Workers: el cron reclama únicamente con 1 |
| `DISPATCHER_TRAMO_S` | 1200 | solo Workers: duración de cada tramo del stream (10–1500) |
| `DISPATCHER_OECE_BASE` | (API del OECE) | solo Workers: base del prefetch (para pruebas) |

Secretos (`npx wrangler secret put …`): `GCP_SA_KEY` (llave JSON de una cuenta con `roles/run.invoker` en los 4
servicios de agentes; sin ella el orquestador responde 401/403 y el contrato vuelve a la cola sin gastar
intento) y `DISPATCHER_TOKEN`. `AGENT_ID_TOKEN` solo para desarrollo.

## Desarrollo y pruebas

```bash
npm install
npm run typecheck
npm test                 # port de backend/dispatcher/tests + stream, cierre y semántica de Python
npm run build            # wrangler deploy --dry-run --outdir .wrangler-dist (no despliega)

# Paridad del reductor: mismos bytes por events.py/main.py y por este Worker (Python con requests y psycopg2)
PYTHON=…/python node scripts/paridad_eventos.ts corrida_A.ndjson corrida_B.ndjson …
```

Punta a punta contra una base de **staging** (nunca producción), comparando la fila que deja el job de Python
con la que deja el Worker ante el mismo orquestador falso:

```bash
node scripts/agente_falso.ts 8840 corrida.ndjson &                 # orquestador falso
cp .dev.vars.example .dev.vars                                      # y poner un DISPATCHER_TOKEN; .e2e/token con el mismo valor
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://usuario:clave@localhost:55432/vigia?sslmode=disable"
npx wrangler dev --port 8831 &
PG…=… python scripts/e2e_staging.py --ocid <con docs y alerta> --ocid-sin-docs <sin docs>
```

`scripts/e2e_staging.py` fotografía y restaura cada fila que toca y se niega a correr si hay otros
procesamientos encolados o en curso. `test/vectores_py.json` sale de `scripts/vectores_py.py`.

## Diferencias conocidas con el job

- **Reintento del motor a mitad de stream después del `final`:** si la instancia se reinicia justo entre el
  `final` y el checkpoint del tramo, el cierre lo decide la espera de gracia (la alerta ya está en DB desde el
  checkpoint del orquestador, así que normalmente queda `procesado`); el job lo daría por procesado sin mirar.
- **`DISPATCHER_PARALLEL` > 1:** un aborto frena solo a su hilo (en el job, a la corrida entera), un hilo que
  termina reclama al toque pero los hilos no re-sondean la cola cada 30 s, y `zona_estado` se refresca al
  final de cada hilo. Con 1 (el valor desplegado) es idéntico.
- **Sin tope de tarea:** el job muere a los `DISPATCHER_TASK_TIMEOUT_S`; acá la variable solo entra en la
  ventana de reclamo, y el stream termina por el timeout de 3600 s del servicio de agentes o por
  `DISPATCHER_STREAM_TIMEOUT`.
- **Tiempos de espera HTTP:** requests separa conexión (30 s) y lectura (1200 s); acá se espera hasta
  `DISPATCHER_STREAM_TIMEOUT` (máx. 25 min) a las cabeceras.
- **Lecturas reintentadas:** una consulta de solo lectura que falla se reintenta (3 veces) en vez de
  fallar el contrato.
- **Números en textos:** `str()` de un float entero del stream (`1.0`) sale `1` (JSON.parse no distingue
  int de float); solo afecta si `msg`, `detail` o `_aborted` vienen como número. El OCDS del prefetch se
  re-serializa; el de la base se reenvía tal cual.
- **Separadores de línea:** se replica `str.splitlines()` de `iter_lines` al carácter, incluido que un
  U+2028/U+2029/U+0085 dentro de un texto del stream parte la línea y ese evento se descarta (en los dos).
