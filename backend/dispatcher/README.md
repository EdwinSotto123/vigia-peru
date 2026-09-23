# backend/dispatcher

Procesa **solo** los contratos que ya están asignados a una contribución pagada
(`asignaciones` → trigger → `procesamientos`, migración 12). Nunca elige contratos:
la asignación es `asignar_contribucion()` (FIFO en SQL).

```
procesamientos.estado:  encolado → procesando (fase_actual avanza) → procesado
                            ↘ esperando_documentos (sin docs en GCS → batch nocturno → encolado)
                            ↘ pendiente_de_procesamiento (tipo/etapa sin análisis aplicable)
                                                                  ↘ error (3 intentos)
```

Cada ejecución (Cloud Run Job `vigia-dispatcher`, disparado por Cloud Scheduler
`vigia-dispatcher-run` cada 5 min):

1. `reclamar_procesamientos(n, worker)` — toma hasta `DISPATCHER_PARALLEL` contratos
   encolados con `FOR UPDATE SKIP LOCKED` (varias ejecuciones solapadas no se pisan) y
   re-encola los que llevan >20 min sin latido.
2. Elige el **servicio de agentes por tipo** (`url_para(tipo)`, tabla de abajo) y hace
   `POST {AGENT_URL_<PERFIL>}?stream=1` con `{"input", "ocds", "doc_urls", "clasificacion"}` →
   lee el NDJSON del orquestador. Si el servicio del tipo no está desplegado, el contrato queda
   `pendiente_de_procesamiento` (nunca se manda servicios/obras/otros al de bienes). Un `409
   tipo_no_aceptado` (perfil ≠ tipo: URLs mal configuradas) también lo deja pendiente.
3. Por cada evento `phase | warn | error | final` actualiza `fase_actual`, `fase_index`
   (máximo alcanzado: en el DAG las fases llegan desordenadas), `fases` (migración 20:
   `{fase: {estado: corriendo|hecho|omitido|error, desde, hasta, motivo}}`, el fin de cada
   fase se infiere del arranque de sus sucesoras o del `dag_join`/`final`), `latido_at` y
   anexa el evento a `eventos` (`events.py` reduce el stream; las fases canónicas son las 10
   de `FASES`, compartidas con `frontend/lib/auditoria.ts`, que replica la reducción en
   `reducirFases()` para filas anteriores a la migración). `backfill_fases.py` rellena
   `fases` desde `eventos` en filas viejas.
4. Al recibir `final` **y** existir la alerta en DB marca `procesado` con la hora real de
   término (desde la migración 20 el trigger `trg_alertas_cerrar_procesamiento` no cierra un
   procesamiento con worker vivo: la alerta se inserta en el checkpoint, antes del dictamen). Si el
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
| `AGENT_URL_BIENES` | — | servicio `agent-orchestrator-adk` (`PIPELINE_PROFILE=bienes`) |
| `AGENT_URL_SERVICIOS` | — | servicio `agente-servicios` (tipo `servicios`) |
| `AGENT_URL_OBRAS` | — | servicio `agente-obras` (tipo `obras`) |
| `AGENT_URL_OTROS` | — | servicio `agente-otros` (tipos `consultoria`, `convenio`, `directa`, `otro`) |
| `AGENT_URL` | — | fallback histórico: SOLO para `bienes` y para contratos sin clasificación (a demanda) |
| `PGHOST` `PGPORT` `PGUSER` `PGDATABASE` `PGPASSWORD` `PGSSLMODE` | libpq | Cloud SQL (socket `/cloudsql/…` en el job) |
| `DISPATCHER_PARALLEL` | 2 | análisis concurrentes por ejecución |
| `DISPATCHER_MAX_MINUTES` | 55 | ventana para reclamar contratos |
| `DISPATCHER_STREAM_TIMEOUT` | 1200 | segundos sin datos del stream antes de darlo por cortado |
| `DISPATCHER_GRACE_MINUTES` | 20 | si el stream corta sin `final`, cuánto esperar (sondeando la DB) a que el orquestador —que sigue corriendo— persista la alerta |
| `DISPATCHER_PREFETCH_OCDS` | 1 | intenta bajar el `compiledRelease` desde esta IP y lo pasa precargado al orquestador (sirve desde laptop/VPS en Perú; desde GCP el WAF lo bloquea y el orquestador usa su cadena relay → Worker → directo) |
| `AGENT_ID_TOKEN` | — | solo local: ID token para servicios de agentes IAM-only (`$(gcloud auth print-identity-token)`). En Cloud Run no hace falta: `auth.py` lo pide al servidor de metadatos (audiencia = URL del servicio, caché 50 min). Un 401/403 del servicio re-encola sin consumir intento y corta la corrida |
| `DISPATCHER_REQUIERE_DOCS_GCS` | 1 | si el contrato no tiene documentos vigentes en GCS (`documentos_vigentes()`, migración 15) no se procesa: abre un `pedido_descarga`, queda `esperando_documentos` y el batch nocturno (`descargar pedidos`) lo baja desde IP peruana; la ingesta lo re-encola al día siguiente. Con `0` (corrida manual con relay/downloader vivo) se procesa igual |

## Correr local (contra prod, un contrato)

```bash
export PGPASSWORD="$(sed -n 's/.*password:[[:space:]]*//p' .cloudsql-password | tr -d '\r')"
AGENT_URL=https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app PGHOST=34.71.244.66 PGSSLMODE=require \
DISPATCHER_PARALLEL=1 DISPATCHER_MAX_MINUTES=15 python -m backend.dispatcher.main
```

Tests: `python -m pytest backend/dispatcher/tests -v` (`test_routing.py` cubre tipo → servicio).
Deploy: `bash infrastructure/deploy/dispatcher.sh` (lee las 4 URLs de los servicios desplegados con
`infrastructure/deploy/agentes.sh all`; las que no existan quedan vacías y su tipo espera).

## Operación

- Ver el tablero: `GET /financiamiento/procesamientos` (público) · `GET /admin/procesamientos` (con `worker`, `error`, `latido_at`).
- Re-encolar a mano: `POST /admin/procesamientos/:ocid/reencolar` o
  `UPDATE procesamientos SET estado='encolado', intentos=0, error=NULL, worker=NULL WHERE ocid='…';`
- Logs: `gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="vigia-dispatcher"' --limit 50`
