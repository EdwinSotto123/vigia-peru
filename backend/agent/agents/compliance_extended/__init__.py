"""Construye compliance_extended_agent."""

from google.adk.agents import Agent
from agents._shared.callbacks import CALLBACKS
from agents._shared.instructions import with_today_header, make_state_aware_instruction
from agents._shared.models import build_planner, build_generate_config, resolve_output_schema
from . import config
from . import prompt

_instruction = prompt.INSTRUCTION
if config.USES_TODAY_HEADER:
    _instruction = with_today_header(_instruction)

# Thinking (Gemini 3: thinking_level) va por `planner`; temperatura/tope por
# `generate_content_config`; ADK 1.19 rechaza thinking_config/tools/schema dentro de este último.
_kw = {}
_planner = build_planner("compliance_extended_agent", config.MODEL, getattr(config, "THINKING", None))
if _planner is not None:
    _kw["planner"] = _planner
_gcc = build_generate_config("compliance_extended_agent", getattr(config, "TEMPERATURE", None),
                             getattr(config, "MAX_OUTPUT_TOKENS", None))
if _gcc is not None:
    _kw["generate_content_config"] = _gcc
_schema = resolve_output_schema(getattr(config, "OUTPUT_SCHEMA", None))
if _schema is not None:
    _kw["output_schema"] = _schema

compliance_extended_agent = Agent(
    name="compliance_extended_agent",
    model=config.MODEL,
    description=prompt.DESCRIPTION,
    instruction=_instruction,
    tools=config.TOOLS,
    output_key=config.OUTPUT_KEY,
    **_kw,
    **CALLBACKS,
)

if config.STATE_INJECTIONS:
    compliance_extended_agent.instruction = make_state_aware_instruction(
        compliance_extended_agent.instruction, config.STATE_INJECTIONS,
    )

# Variante de solo juicio (REGLAS_EN_CODIGO=1): mismo nombre, para que el tablero y las trazas
# sigan mostrando el mismo nodo; una sola tool y un prompt sin las 12 reglas. Antes el agente
# gastaba ~15 turnos por análisis reenviando ~12,6 k tokens cada uno solo para llamar reglas
# deterministas (620 llamadas en septiembre).
compliance_criterio_agent = Agent(
    name="compliance_extended_agent",
    model=config.MODEL,
    description=prompt.DESCRIPTION,
    instruction=make_state_aware_instruction(prompt.INSTRUCTION_CRITERIO, config.STATE_INJECTIONS or []),
    tools=config.TOOLS_CRITERIO,
    output_key=config.OUTPUT_KEY,
    **_kw,
    **CALLBACKS,
)
