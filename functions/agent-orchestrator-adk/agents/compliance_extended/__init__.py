"""Construye compliance_extended_agent."""

from google.adk.agents import Agent
from agents._shared.callbacks import CALLBACKS
from agents._shared.instructions import with_today_header, make_state_aware_instruction
from . import config
from . import prompt

_instruction = prompt.INSTRUCTION
if config.USES_TODAY_HEADER:
    _instruction = with_today_header(_instruction)

compliance_extended_agent = Agent(
    name="compliance_extended_agent",
    model=config.MODEL,
    description=prompt.DESCRIPTION,
    instruction=_instruction,
    tools=config.TOOLS,
    output_key=config.OUTPUT_KEY,
    **CALLBACKS,
)

if config.STATE_INJECTIONS:
    compliance_extended_agent.instruction = make_state_aware_instruction(
        compliance_extended_agent.instruction, config.STATE_INJECTIONS,
    )
