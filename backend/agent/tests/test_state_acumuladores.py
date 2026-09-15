"""Los acumuladores de lista del state (`pending_flags`, `recortes`, …) que una tool de un
sub-agente ADK extiende IN-PLACE (`state.setdefault(k, []).append(x)`) deben sobrevivir al
cierre de la sesión aunque la clave ya existiera al sembrarla.

Sin la corrección de `agents/_shared/callbacks.after_tool_log` se perdían: el runner trabaja
sobre una copia profunda de la sesión y solo persiste `state_delta` (escrituras por setitem);
un append a una lista pre-existente no entra al delta. Con un LLM simulado (sin red) se
verifica que `deterministic._run_agent_delta` y `_run_agent` reciben la bandera agregada."""
from __future__ import annotations

import asyncio
from typing import AsyncGenerator

import pytest
from google.adk.agents import LlmAgent
from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.adk.sessions import InMemorySessionService
from google.adk.tools import ToolContext
from google.genai import types as gtypes

import deterministic as D
from agents._shared.callbacks import CALLBACKS


def agrega_bandera(regla: str, tool_context: ToolContext) -> dict:
    """Agrega una bandera de prueba a state['pending_flags'] (append in-place)."""
    tool_context.state.setdefault("pending_flags", []).append({"regla": regla, "evidencia": "test"})
    return {"ok": True}


class _LlmFalso(BaseLlm):
    """1ª llamada: pide la tool; 2ª: responde texto final."""
    model: str = "falso"
    _n: int = 0

    async def generate_content_async(self, llm_request: LlmRequest, stream: bool = False
                                     ) -> AsyncGenerator[LlmResponse, None]:
        hay_respuesta_de_tool = any(
            p.function_response for c in (llm_request.contents or []) for p in (c.parts or []))
        if not hay_respuesta_de_tool:
            yield LlmResponse(content=gtypes.Content(role="model", parts=[
                gtypes.Part(function_call=gtypes.FunctionCall(name="agrega_bandera", args={"regla": "nueva"}))]))
        else:
            yield LlmResponse(content=gtypes.Content(role="model", parts=[gtypes.Part(text="listo")]))


def _agente():
    return LlmAgent(name="prueba_acumulador", model=_LlmFalso(), instruction="usá la tool",
                    tools=[agrega_bandera], output_key="salida_prueba", **CALLBACKS)


@pytest.mark.parametrize("seed_previo", [False, True])
def test_append_in_place_sobrevive_con_run_agent_delta(seed_previo):
    ss = InMemorySessionService()
    base = {"pending_flags": [{"regla": "previa", "evidencia": "x"}]} if seed_previo else {}
    evs, final, delta, _m = asyncio.run(D._run_agent_delta(_agente(), "hola", base, ss, "u", "salida_prueba"))
    assert final == "listo" and delta.get("salida_prueba") == "listo"
    reglas = [f["regla"] for f in delta.get("pending_flags") or []]
    assert "nueva" in reglas, (delta, evs)
    # y el merge al state compartido conserva lo previo + lo nuevo
    state = dict(base)
    D._aplicar_delta(state, delta)
    assert [f["regla"] for f in state["pending_flags"]] == (["previa", "nueva"] if seed_previo else ["nueva"])


def test_append_in_place_sobrevive_con_run_agent_secuencial():
    ss = InMemorySessionService()
    state = {"pending_flags": [{"regla": "previa", "evidencia": "x"}]}
    metrics = {"prompt": 0, "output": 0, "total": 0, "calls": 0, "cost": 0.0}

    async def _go():
        return [e async for e in D._run_agent(_agente(), "hola", state, ss, "u", metrics)]
    asyncio.run(_go())
    assert [f["regla"] for f in state["pending_flags"]] == ["previa", "nueva"]
