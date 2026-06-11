"""Construye vigia_orchestrator — el agente raíz.

Importa los 10 sub-agentes (cada uno desde su paquete) y los envuelve como
AgentTool. El orden de la lista de tools se preserva del monolito original.
Es el ÚLTIMO agente en construirse porque referencia a todos los demás.
"""
from google.adk.agents import Agent
from google.adk.tools import AgentTool

from agents._shared.callbacks import CALLBACKS
from agents._shared.instructions import with_today_header
from . import config
from . import prompt

# ── Tools directas del orquestador (FunctionTools) ──
from tools import (
    fetch_ocds_record_tool,
    get_ganador_tool,
    register_convocatoria_in_db_tool,
    query_sunat_decolecta_tool,
    query_oece_perfil_tool,
    query_edad_ciiu_web_tool,
    query_rnp_persona_tool,
    query_rnp_empresa_tool,
    lookup_opinion_oece_tool,
    query_onpe_aportantes_tool,
    query_jne_candidaturas_tool,
    query_pep_tool,
    query_visitas_de_persona_tool,
    batch_person_lookup_tool,
    detect_puerta_giratoria_tool,
    detect_aporte_a_partido_del_alcalde_tool,
    scrape_jne_hoja_vida_tool,
    persist_doc_flags_as_banderas_tool,
    persist_market_flags_as_banderas_tool,
    list_documents_tool,
    parse_document_pdf_tool,
    build_market_input_tool,
    analyze_market_sharded_tool,
    persist_analysis_outputs_tool,
    read_market_input_tool,
    read_sunat_profile_tool,
    read_person_network_context_tool,
    add_contextual_flag_tool,
    persist_alert_from_flags_tool,
    query_autoridades_entidad_tool,
)

# ── Sub-agentes (cada uno desde su paquete) ──
from agents.compliance import compliance_agent
from agents.document_parser import document_parser_agent
from agents.document_legal_analyst import document_legal_analyst_agent
from agents.market_price import market_price_agent
from agents.web_research import web_research_agent
from agents.news_research import news_research_agent
from agents.entity_personnel import entity_personnel_agent
from agents.person_network import person_network_agent
from agents.compliance_extended import compliance_extended_agent
from agents.report_writer import report_writer_agent


vigia_orchestrator = Agent(
    name="vigia_orchestrator",
    model=config.MODEL,
    description=prompt.DESCRIPTION,
    instruction=with_today_header(prompt.INSTRUCTION),
    tools=[
        # Tools directas (orden preservado del monolito)
        fetch_ocds_record_tool,
        get_ganador_tool,
        register_convocatoria_in_db_tool,
        query_sunat_decolecta_tool,
        query_oece_perfil_tool,   # perfil OECE: estado + sanciones/inhab + aptitud (sin cuota, vía downloader)
        query_edad_ciiu_web_tool, # fallback edad+CIIU (universidadperu) si decolecta sin cuota
        query_rnp_persona_tool,
        query_rnp_empresa_tool,
        lookup_opinion_oece_tool,
        # Datasets peruanos (schema-aware) — fallback; el path principal es batch.
        query_onpe_aportantes_tool,
        query_jne_candidaturas_tool,
        query_pep_tool,
        query_visitas_de_persona_tool,
        # 🚀 BATCH LOOKUP — colapsa "5 queries × N personas" en 1 (ThreadPool 16).
        batch_person_lookup_tool,
        detect_puerta_giratoria_tool,
        detect_aporte_a_partido_del_alcalde_tool,
        scrape_jne_hoja_vida_tool,
        persist_doc_flags_as_banderas_tool,
        persist_market_flags_as_banderas_tool,
        list_documents_tool,            # fallback manual de parsing
        parse_document_pdf_tool,        # fallback manual de parsing
        build_market_input_tool,
        # 🚀 FAN-OUT de precios: chunks de ~10 ítems en paralelo. Path PRINCIPAL
        # del análisis de mercado (el AgentTool de abajo queda solo como fallback).
        analyze_market_sharded_tool,
        # Sub-agentes como AgentTool
        AgentTool(compliance_agent),
        AgentTool(document_parser_agent),
        AgentTool(document_legal_analyst_agent),
        AgentTool(market_price_agent),  # fallback — el path principal es analyze_market_sharded
        AgentTool(web_research_agent),
        AgentTool(news_research_agent),
        AgentTool(entity_personnel_agent),
        AgentTool(person_network_agent),
        AgentTool(compliance_extended_agent),
        AgentTool(report_writer_agent),
        persist_analysis_outputs_tool,
        # State-cache loaders (pre-fetch antes de delegar a agentes con google_search)
        read_market_input_tool,
        read_sunat_profile_tool,
        read_person_network_context_tool,
        # Razonamiento contextual del orquestador
        add_contextual_flag_tool,
        # Persiste TODAS las banderas (contextuales + compliance extendido)
        persist_alert_from_flags_tool,
        # Capa 2: autoridades electas vigentes de la entidad
        query_autoridades_entidad_tool,
    ],
    **CALLBACKS,
)
