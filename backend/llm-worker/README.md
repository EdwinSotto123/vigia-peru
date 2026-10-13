# vigia-llm — Cloudflare Workers AI con forma de API OpenAI

`https://vigia-llm.vigiaperu.workers.dev/v1/chat/completions` (Bearer `LLM_TOKEN`; el mismo valor está en el
secreto de GCP `workers-ai-token`). Lista blanca de modelos en `MODELOS_PERMITIDOS` (`wrangler.jsonc`).

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
