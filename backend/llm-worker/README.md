# vigia-llm

La puerta única a los modelos de Vigía. Es el Worker `vigia-llm`: Cloudflare Workers AI detrás de una API con forma de
OpenAI. URL: `https://vigia-llm.vigiaperu.workers.dev`. Los demás Workers lo llaman por service binding (`LLM`).

**Sólo modelos abiertos de Workers AI** desde el 10 de noviembre de 2026. El respaldo con otro proveedor está apagado
(`RESPALDO_APAGADO=1`).

## Modelos

| Uso | Modelo de Workers AI |
|---|---|
| Por defecto (`MODELO_DEFECTO`) | DeepSeek V4.1 Flash (`@cf/deepseek-ai/deepseek-v4.1-flash-1017`) |
| Juicio complejo | GLM 5.3 (`@cf/zai-org/glm-5.3`) |
| Embeddings | BGE-M3 (`@cf/baai/bge-m3`, 1 024 dimensiones) |

- **`NATIVO_MODELOS`** dice qué modelo responde en `/nativo`. Los nombres que piden los clientes ahí son alias internos,
  no modelos: el Worker los traduce a DeepSeek V4.1 Flash o a GLM 5.3. Lo que no está en la lista va a DeepSeek V4.1
  Flash. Las imágenes van a `NATIVO_MODELO_VISION` (DeepSeek V4.1 Flash).
- **`MODELOS_RETIRADOS`**: Workers AI retiró varios modelos el 20 de noviembre de 2026 (entre ellos GLM 5.3 Flash). Quien
  todavía pide uno de ésos recibe el que lo reemplaza (GLM 5.3 Flash, por ejemplo, lo responde DeepSeek V4.1 Flash).
- **`MODELOS_HERMANOS`**: si un modelo llegó a su tope por minuto (error 3021) o de capacidad (3040), el pedido pasa a
  otro de la lista antes de fallar.
- **`MODELOS_PERMITIDOS`**: la lista blanca. Un token filtrado no puede gastar en cualquier modelo.
- `REASONING_EFFORT_DEFECTO` (`low`) y `MAX_TOKENS_DEFECTO` (16 000) se aplican si el pedido no los trae.

La cabecera `x-vigia-modelo` de cada respuesta dice qué modelo contestó (`workers-ai:<id>`).

## Rutas

Todas piden `Authorization: Bearer <LLM_TOKEN>` (o `x-api-key`), menos `/salud`.

| Ruta | Qué hace |
|---|---|
| `POST /v1/chat/completions` | chat con herramientas y `stream` |
| `GET /v1/models` | la lista blanca |
| `POST /v1/embeddings` | vectores de BGE-M3, hasta 64 textos por pedido |
| `POST /nativo/v1/messages` y `/nativo/v1/messages/count_tokens` | otro formato de mensajes, traducido a Workers AI (`src/nativoWorkers.ts`); sin streaming |
| `GET /salud` | `{ok, respaldo}` |

La cabecera `x-vigia-respaldo: nunca` pide el error en vez del respaldo. Con el respaldo apagado ya es lo que pasa.

## Quién lo usa

- Los agentes (`backend/agent`, en AWS Lambda), con `WORKERS_AI_URL` y `WORKERS_AI_TOKEN`.
- La lectura de documentos (`backend/lector`) y la lectura previa (`backend/scripts/lectura_previa.py`).
- La API: el chat, el asistente y la lectura de bases de plazas.
- `vigia-scrapers`: las alertas de DIGEMID.
- `vigia-precios-lab`: la ficha del producto y el juicio de cada oferta.

## Variables y secretos

Variables: las de arriba, en `wrangler.jsonc`. Binding: `AI` (Workers AI).

Secretos (`npx wrangler secret put <NOMBRE>`):

- `LLM_TOKEN`: el token de los clientes (copia en SSM `/vigia/llm/token`).
- Respaldo, hoy sin uso: `RESPALDO_URL`, `RESPALDO_MODELO`, `RESPALDO_TOKEN`, `RESPALDO_CABECERAS`,
  `RESPALDO_NATIVO_URL` y `RESPALDO_NATIVO_CABECERA`. Para volver a usarlo: `RESPALDO_APAGADO` y `NATIVO_EN_WORKERS_AI`
  en `"0"`.

El Worker no registra el contenido de los mensajes: pueden traer datos de contratos.

## Probar y desplegar

```bash
cd backend/llm-worker
npm ci
npm run dev                                         # wrangler dev en el puerto 8813
bash infrastructure/deploy/cloudflare/worker.sh llm # producción, desde la raíz del repo
```

`worker.sh` se niega si la carpeta tiene cambios sin commitear. No hay pruebas automáticas.
