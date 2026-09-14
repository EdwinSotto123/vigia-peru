"""Construye person_network_agent."""

from google.adk.agents import Agent
from agents._shared.callbacks import CALLBACKS
from agents._shared.instructions import with_today_header, make_state_aware_instruction
from . import config
from . import prompt

_instruction = prompt.INSTRUCTION
if config.USES_TODAY_HEADER:
    _instruction = with_today_header(_instruction)

person_network_agent = Agent(
    name="person_network_agent",
    model=config.MODEL,
    description=prompt.DESCRIPTION,
    instruction=_instruction,
    tools=config.TOOLS,
    output_key=config.OUTPUT_KEY,
    **CALLBACKS,
)

if config.STATE_INJECTIONS:
    person_network_agent.instruction = make_state_aware_instruction(
        person_network_agent.instruction, config.STATE_INJECTIONS,
    )
