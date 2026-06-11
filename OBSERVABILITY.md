# Vigía Perú · Observabilidad y auto-introspección (Arize / Phoenix)

> Un sistema que detecta corrupción **no puede ser una caja negra**. Vigía es
> *glass-box*: cada decisión de cada agente es trazable, evaluable y mejorable —
> y el propio sistema **se autoaudita** consultando su observabilidad por MCP.

Track del hackathon: **Arize**. Stack: **Gemini + Google ADK (Cloud Run) + Phoenix MCP**.

---

## 1. Tracing (OpenInference → Phoenix + Arize AX)

El orquestador ADK (`functions/agent-orchestrator-adk/`) está instrumentado con
**OpenInference** (`GoogleGenAIInstrumentor`) en
[`arize_observability.py`](functions/agent-orchestrator-adk/arize_observability.py).
Cada run emite un árbol de spans: `invocation` → `agent_run` → `call_llm` /
`execute_tool`, con prompts, tokens y latencia.

**Dual-export**: las trazas se envían **a la vez** a Arize AX y a **Phoenix Cloud**
(`PHOENIX_COLLECTOR_ENDPOINT` + `PHOENIX_API_KEY`). El span raíz lleva métricas de
negocio: `vigia.score`, `vigia.n_banderas`, `vigia.market.cobertura`,
`vigia.market.veredicto`, `vigia.n_agentes`.

## 2. Auto-introspección en runtime vía Phoenix MCP

El **Phoenix MCP server** (`@arizeai/phoenix-mcp`) se configura en
[`.gemini/settings.json`](.gemini/settings.json) y corre **dentro de Gemini CLI**.
Así, el agente **consulta sus propias trazas/evals/datasets como tools, en runtime**:

```bash
export PHOENIX_API_KEY=...        # tu key de Phoenix Cloud
gemini                            # desde la raíz del repo
# luego, en lenguaje natural:
#   "mostrame las últimas trazas del proyecto vigia-peru"
#   "¿qué eval está más bajo y en qué OCID?"
#   "¿qué alucinó el orquestador en el último análisis?"
```

## 3. Evaluación (LLM-as-a-Judge)

Evaluadores creados en Arize (vía `ax` CLI, reproducible):

| Evaluador | Mide | Etiquetas |
|---|---|---|
| `respaldo_de_bandera` | ¿la bandera está respaldada por los datos? | factual / hallucinated |
| `plausibilidad_precio` | ¿el veredicto de sobreprecio se sostiene? | plausible / dudoso |
| `tono_no_acusatorio` | guardrail legal: ¿no acusa de delito? | ok / acusatorio |

Además, un eval offline reproducible:
[`scripts/evals_vigia.py`](scripts/evals_vigia.py) (stdlib + Gemini) corre los 4
evaluadores sobre los análisis y reporta los % de calidad.

## 4. Bonus — auto-mejora (self-improvement loop)

Desde Gemini CLI + Phoenix MCP, el agente puede **cerrar el loop**: detecta un
patrón de falla recurrente en las trazas (p.ej. una alucinación que se repite) y
**propone/crea un evaluador nuevo** con el `ax` CLI — el sistema **escribe sus
propios guardrails** a partir de su observabilidad.

## 5. Guardrails deterministas (no acusar en falso)

La observabilidad detectó falsos positivos (p.ej. "proveedor no apto" sin sanción
real, acusaciones de delito desde grounding). Se endurecieron con **guards de
código deterministas** en `tools/` y `tools/persistence.py` + reglas de prompt,
alineados al principio innegociable: *señal de riesgo, nunca acusación*.

---

### Cómo demostrarlo
1. Correr un análisis (una convocatoria) → genera trazas en Phoenix.
2. Abrir Phoenix Cloud → ver el árbol de los 11 agentes + los eval scores.
3. Desde Gemini CLI (con phoenix-mcp) → preguntarle al agente por su propia salud
   y pedirle que proponga un guardrail. **Eso es self-introspection + self-improve.**
