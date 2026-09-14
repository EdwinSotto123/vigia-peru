# backend/dispatcher

Procesa **solo** los contratos que ya están asignados a una contribución pagada
(`asignaciones` → trigger → `procesamientos`, migración 12). Nunca elige contratos:
la asignación es `asignar_contribucion()` (FIFO en SQL).

```
procesamientos.estado:  encolado → procesando (fase_actual avanza) → procesado
                                                                  ↘ error (3 intentos)
```

Cada ejecución (Cloud Run Job `vigia-dispatcher`, disparado por Cloud Scheduler
`vigia-dispatcher-run` cada 5 min):

1. `reclamar_procesamientos(n, worker)` — toma hasta `DISPATCHER_PARALLEL` contratos
   encolados con `FOR UPDATE SKIP LOCKED` (varias ejecuciones solapadas no se pisan) y
   re-encola los que llevan >20 min sin latido.
2. `POST {AGENT_URL}?stream=1` con `{"input": "<ocid>"}` → lee el NDJSON del orquestador.
3. Por cada evento `phase | warn | error | final` actualiza `fase_actual`, `fase_index`,
   `latido_at` y anexa el evento a `eventos` (`events.py` reduce el stream; las fases
   canónicas son las 10 de `FASES`, compartidas con `frontend/lib/auditoria.ts`).
4. Al recibir `final` **y** existir la alerta en DB marca `procesado` (el trigger
   `trg_alertas_cerrar_procesamiento` suele hacerlo antes, al persistirse la alerta). Si el
   stream corta sin `final` (NAT/proxy/idle en fases silenciosas largas), espera hasta
   `DISPATCHER_GRACE_MINUTES` a que la alerta aparezca en DB (el orquestador termina igual en su
   contenedor) y recién ahí vuelve a `encolado` (o `error` al tercer intento). Si el orquestador
   **abortó** (`state._aborted`, p. ej. OCDS inaccesible), vuelve a `encolado` sin consumir
   intento y la corrida se detiene: el scheduler reintenta a los 5 min.
5. Termina al vaciar la cola o a los `DISPATCHER_MAX_MINUTES` (default 55; deja de
   reclamar, los análisis en curso se completan).

## Variables

| Variable | Default | Uso |
|---|---|---|
| `AGENT_URL` | — | URL del orquestador (`agent-orchestrator-adk`) |
| `PGHOST` `PGPORT` `PGUSER` `PGDATABASE` `PGPASSWORD` `PGSSLMODE` | libpq | Cloud SQL (socket `/cloudsql/…` en el job) |
| `DISPATCHER_PARALLEL` | 2 | análisis concurrentes por ejecución |
| `DISPATCHER_MAX_MINUTES` | 55 | ventana para reclamar contratos |
| `DISPATCHER_STREAM_TIMEOUT` | 1200 | segundos sin datos del stream antes de darlo por cortado |
| `DISPATCHER_GRACE_MINUTES` | 20 | si el stream corta sin `final`, cuánto esperar (sondeando la DB) a que el orquestador —que sigue corriendo— persista la alerta |
| `DISPATCHER_PREFETCH_OCDS` | 1 | intenta bajar el `compiledRelease` desde esta IP y lo pasa precargado al orquestador (sirve desde laptop/VPS en Perú; desde GCP el WAF lo bloquea y el orquestador usa su cadena relay → Worker → directo) |

## Correr local (contra prod, un contrato)

```bash
export PGPASSWORD="$(sed -n 's/.*password:[[:space:]]*//p' .cloudsql-password | tr -d '\r')"
AGENT_URL=https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app PGHOST=34.71.244.66 PGSSLMODE=require \
DISPATCHER_PARALLEL=1 DISPATCHER_MAX_MINUTES=15 python -m backend.dispatcher.main
```

Tests: `python -m pytest backend/dispatcher/tests -v`. Deploy: `bash infrastructure/deploy/dispatcher.sh`.

## Operación

- Ver el tablero: `GET /financiamiento/procesamientos` (público) · `GET /admin/procesamientos` (con `worker`, `error`, `latido_at`).
- Re-encolar a mano: `POST /admin/procesamientos/:ocid/reencolar` o
  `UPDATE procesamientos SET estado='encolado', intentos=0, error=NULL, worker=NULL WHERE ocid='…';`
- Logs: `gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="vigia-dispatcher"' --limit 50`
