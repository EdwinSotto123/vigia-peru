"""
Paquete de agentes de Vigía Perú.

Reemplaza el antiguo agents.py monolítico (3285 líneas). Cada agente vive en su
propia carpeta con prompt.py (los strings de prompt) + config.py (modelo, tools,
output_key) + __init__.py (ensambla el Agent). Lo común está en _shared/.

Contrato público (lo que importa main.py):
  · vigia_orchestrator   — el agente raíz
  · report_writer_agent  — usado por el safety-net de main.py

El orden importa: _shared primero (aplica el patch de fallback Gemini), luego el
orquestador (que importa todos los sub-agentes).
"""
# 1. Aplica el monkey-patch de fallback Gemini ANTES de instanciar cualquier Agent.
from agents import _shared  # noqa: F401

# 2. El orquestador importa y arma los 10 sub-agentes.
from agents.orchestrator import vigia_orchestrator

# 3. Re-export del writer (lo usa el safety-net de main.py).
from agents.report_writer import report_writer_agent

# 4. Re-export del resto (por si algún consumidor los necesita directo).
from agents.compliance import compliance_agent
from agents.document_parser import document_parser_agent
from agents.document_legal_analyst import document_legal_analyst_agent
from agents.market_price import market_price_agent
from agents.web_research import web_research_agent
from agents.news_research import news_research_agent
from agents.entity_personnel import entity_personnel_agent
from agents.person_network import person_network_agent
from agents.compliance_extended import compliance_extended_agent

__all__ = [
    "vigia_orchestrator",
    "compliance_agent",
    "document_parser_agent",
    "document_legal_analyst_agent",
    "market_price_agent",
    "web_research_agent",
    "news_research_agent",
    "entity_personnel_agent",
    "person_network_agent",
    "compliance_extended_agent",
    "report_writer_agent",
]
