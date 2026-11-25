# Observabilidad de Vigía

Un sistema que marca señales de riesgo no puede ser una caja negra. Al 25 de noviembre de 2026, lo que hace Vigía se mira
en cinco lugares: los registros de cada pieza, la cola en vivo, los libros de costo de la base, las pruebas de calidad y
la página pública `/metricas`. Las piezas están en [ARQUITECTURA.md](ARQUITECTURA.md).

## 1. Registros

- **Workers.** Los doce de `frontend/` y `backend/` (web, API, MCP, captura, dispatcher, modelos, OCR, precios, relays y
  la copia a R2) tienen `"observability": { "enabled": true }` en su `wrangler.jsonc`: sus registros quedan en Workers
  Logs. La portada de `gobserva.cloud` no lo tiene.
- **Análisis.** Cada Lambda de agentes emite sus eventos en NDJSON mientras analiza. El dispatcher guarda cada fase
  visible en `procesamientos`, con un latido cada 30 segundos. Si un análisis pasa 20 minutos sin latido, vuelve a la cola
  (`backend/dispatcher-worker/README.md`).
- **Base.** RDS registra los cambios de esquema y de roles (pgaudit) y las conexiones, y los manda a CloudWatch
  (`cloud_sql/README.md`).
- **Bitácora pública.** `GET /transparencia/bitacora` junta con su fecha las validaciones, las cargas del RAG normativo,
  las tandas del análisis masivo, los refrescos y las cargas de datos.

## 2. En vivo

- **La auditoría en vivo** (`/app/auditoria`) muestra cada análisis fase por fase y su historial
  (`GET /financiamiento/procesamientos`).
- **«Ahora mismo»**, en `/metodologia`, dice lo que se está leyendo en este momento y el ritmo de las últimas 24 horas
  (`GET /transparencia/ahora`).
- **El panel `/admin`** tiene la cola de análisis y la de revisión humana: los dictámenes que no pasaron la
  autoevaluación esperan ahí a que alguien los publique o los descarte.

## 3. Cuánto cuesta

Cada llamada a un modelo suma su costo con la tarifa de su modelo (`backend/agent/tools/costo_llm.py`), y ese costo queda
con el análisis. De ahí salen los libros:

| Tabla | Qué guarda |
|---|---|
| `transparencia_analisis` (migración 300) | Una fila angosta por análisis publicado: red, modelo, costo y lo que dejó la verificación. pg_cron la refresca cada hora. Sin nombres, RUC, OCID ni textos |
| `agente_masivo` (migraciones 272 y 274) | El libro del análisis masivo, con su tope de gasto |
| `documento_lectura`, `menor_lectura`, `pieza_lectura` | Lo que gasta la lectura de documentos |
| `gasto_ia_dia` (migración 336) | Lo que mide Cloudflare de Workers AI, por día y modelo (`backend/scripts/gasto_workers_ai.py`), para compararlo con los libros |
| `costos_mes` (migración 206) y `transparencia_costo` (migración 300) | Las facturas de AWS y Cloudflare, y los costos que se anotan a mano con su fuente |

`gasto_ia_dia` existe porque los libros no lo anotan todo: del 10 al 17 de noviembre de 2026, Workers AI midió cerca de
US$ 3 480 y los libros sumaban cerca de US$ 2 590, un 74 % (migración 336).

## 4. Calidad

- **Antes de guardar.** Cada señal se coteja con el expediente y los registros oficiales. Si no se puede comprobar, se
  descarta.
- **Autoevaluación.** Al final de cada análisis, jueces con el mismo modelo abierto y chequeos en código revisan el
  respaldo de cada señal, sus citas, la plausibilidad de los precios y el tono (`backend/agent/tools/self_eval.py`). Lo
  que no pasa los umbrales queda en revisión humana. Los umbrales se cambian desde el panel.
- **Pruebas de oro.** Contratos leídos a mano, con las señales que deben salir y las que no, por red. Cada corrida guarda
  su precisión, su exhaustividad y su F1 en las tablas `golden_*` (migración 285). El RAG normativo tiene su propia
  prueba de preguntas con el artículo que debe traer (`backend/rag/evaluar_normas.py`).

## 5. La página `/metricas`

Pública, en [vigia.gobserva.cloud/metricas](https://vigia.gobserva.cloud/metricas). Seis pestañas: Cuánto cuesta, Los
agentes (el F1 de cada red), RAG normativo (el acierto entre los 8 primeros resultados), Verificación, Costos y volumen, y
Bitácora. Todo sale de `GET /transparencia` y sus rutas `/gasto`, `/bitacora` y `/ahora`
(`backend/api/src/routes/transparencia.ts`): sólo agregados, con la fecha de cada dato. Lo que no se midió dice «no
medido», nunca se rellena.

## Antes: Arize y Phoenix

En el hackathon y hasta octubre de 2026, el orquestador mandaba trazas OpenInference a Arize AX y a Phoenix Cloud. El
código sigue en `backend/agent/arize_observability.py`, pero el despliegue de las Lambdas
(`infrastructure/deploy/aws/agentes.sh`) no le pasa sus claves, así que hoy no se envían trazas a Arize.
