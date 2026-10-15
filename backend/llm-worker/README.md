# vigia-llm — Cloudflare Workers AI con forma de API OpenAI

`https://vigia-llm.vigiaperu.workers.dev/v1/chat/completions` (Bearer `LLM_TOKEN`; el mismo valor está en AWS SSM
`/vigia/llm/token`, rotado el 2026-10-14). Lista blanca de modelos en `MODELOS_PERMITIDOS` (`wrangler.jsonc`); sin
`model` (o `"default"`) va `MODELO_DEFECTO`, hoy `@cf/zai-org/glm-5.3-flash`.

## Respaldo

Si Workers AI falla (error, corte 3046 o respuesta vacía), la misma petición va a un proveedor con API compatible
con OpenAI. Se configura sólo con secretos del Worker, no en el repo: `RESPALDO_URL` (la URL completa de
`…/v1/chat/completions`), `RESPALDO_MODELO` y `RESPALDO_TOKEN`. Sin los tres no hay respaldo. La cabecera
`x-vigia-modelo` de la respuesta dice quién contestó; `x-vigia-respaldo: forzar` en la petición lo prueba directo.
`GET /salud` dice si el respaldo está configurado.

Verificado 2026-10-12 con una llamada real: **`@cf/zai-org/glm-5.3-flash`** (por defecto: ~7 neuronas vs ~60 de `glm-5.3` en la misma petición), `@cf/zai-org/glm-5.3`, `@cf/zai-org/glm-5.2`, `@cf/zai-org/glm-4.7-flash`, `@cf/openai/gpt-oss-120b`,
`@cf/meta/llama-3.3-70b-instruct-fp8-fast` y `@cf/qwen/qwen3-30b-a3b-fp8` responden. Los modelos de
razonamiento devuelven el pensamiento en `reasoning` y gastan tokens en él: usar `max_tokens` holgado.

## Interruptores en los agentes (variables de entorno de Cloud Run)

| Variable | Efecto |
|---|---|
| `WORKERS_AI_URL=https://vigia-llm.vigiaperu.workers.dev/v1` | sin ella, todo va a Gemini (nunca se rompe) |
| `WORKERS_AI_TOKEN` | el `LLM_TOKEN` (de Secret Manager: `workers-ai-token`) |
| `USAR_WORKERS_AI=1` | los agentes que pueden pasan a Workers AI |
| `USAR_WORKERS_AI_<AGENTE>=1\|0` | fuerza un agente (gana sobre el global), p. ej. `USAR_WORKERS_AI_REPORT_WRITER=1` |
| `WORKERS_AI_MODEL`, `WORKERS_AI_MODEL_FAST` | ids `@cf/...` (smart/default y fast/judge) |

Reglas fijas: los agentes con `google_search` (web_research, news_research, market_price, entity_personnel) y el
orquestador se quedan en Gemini; en Workers AI no se usa el planner de thinking de Gemini. Document AI, RAG Engine y
la self-eval con `google.genai` directo siguen en GCP.

Antes de encender un agente: compararlo con `backend/scripts/evals_vigia.py` contra Gemini.

```bash
cd backend/llm-worker && npm i && npx wrangler deploy
printf '%s' "$TOKEN" | npx wrangler secret put LLM_TOKEN
```
