"""
Perfiles del pipeline por tipo de contratación (`PIPELINE_PROFILE`).

Un solo código, cuatro servicios Cloud Run con distinto env:
  · bienes    → agent-orchestrator-adk  (servicio histórico; default sin env)
  · servicios → agente-servicios
  · obras     → agente-obras
  · otros     → agente-otros  (consultoría, convenio, directa, otro)

El perfil decide QUÉ agentes corren y en qué orden, qué bloque extra lleva el
schema del parser (WS D), la estrategia de mercado (WS M), los vectores del
análisis legal (WS M), las reglas de compliance activas y sus topes (WS V),
las secciones del dictamen (WS M) y la prioridad/tope de documentos (WS D).

Interfaz compartida por los cuatro workstreams (ver plan 2026-09-15): NO
cambiar nombres de campos sin coordinar.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# Nombres cortos canónicos de los sub-agentes (los mismos que usa
# deterministic.permitido y la matriz tipo × etapa de backend/core/clasificacion.py).
AGENTES_CANONICOS: tuple[str, ...] = (
    "compliance", "document_parser", "document_legal_analyst", "market",
    "web_research", "news_research", "entity_personnel", "person_network",
    "compliance_extended", "report_writer",
)

# Tipos que emite backend/core/clasificacion.py (tipo_contratacion).
TIPOS_BIENES = frozenset({"bienes"})
TIPOS_SERVICIOS = frozenset({"servicios"})
TIPOS_OBRAS = frozenset({"obras"})
TIPOS_OTROS = frozenset({"consultoria", "convenio", "directa", "otro"})

# Topes en UIT por tipo de procedimiento (Ley 32069 / TUO Ley 30225 y Ley de
# Presupuesto). Los usa `tipo_proceso_vs_monto` (WS V) para saber si el
# procedimiento elegido corresponde al monto. Valores de referencia por objeto:
#   bienes/servicios: LP/CP ≥ 400 UIT · AS entre 8 y 400 UIT · ≤ 8 UIT fuera de la ley
#   obras:            LP ≥ 1 800 UIT · AS entre 8 y 1 800 UIT
_TOPES_BIENES_SERVICIOS = {"licitacion_publica": 400.0, "concurso_publico": 400.0,
                           "adjudicacion_simplificada_min": 8.0, "adjudicacion_simplificada_max": 400.0,
                           "excluido_max": 8.0}
_TOPES_OBRAS = {"licitacion_publica": 1800.0, "adjudicacion_simplificada_min": 8.0,
                "adjudicacion_simplificada_max": 1800.0, "excluido_max": 8.0}
_TOPES_CONSULTORIA = {"concurso_publico": 400.0, "adjudicacion_simplificada_min": 8.0,
                      "adjudicacion_simplificada_max": 400.0, "excluido_max": 8.0}

# Reglas de compliance_rules.py (12 extendidas + 3 duras + nuevas de WS V).
_REGLAS_BASE = frozenset({
    "unique_bidder", "sanctioned_provider", "non_competitive_process",
    "plazo_convocatoria", "tipo_proceso_vs_monto", "directa_fundamento",
    "edad_ruc_ganador", "ciiu_vs_objeto", "concentracion_entidad",
    "recurrencia_firmante", "testaferro_multi_ruc", "ruc_ultra_nuevo",
    "postor_unico_mayoritario", "inconsistencia_doc_vs_ocds", "lobby_visits",
})


@dataclass(frozen=True)
class Profile:
    nombre: str                          # "bienes" | "servicios" | "obras" | "otros"
    tipos_aceptados: frozenset[str]      # tipos de clasificacion.tipo que este servicio acepta
    agentes: tuple[str, ...]             # orden de ejecución (nombres cortos canónicos)
    parser_bloque: str | None            # None | "servicio" | "obra" | "sustento_directa"  (WS D)
    market_estrategia: str               # "goods_retail" | "historico_seace" | "presupuesto_obra" | "cotizaciones" (WS M)
    legal_vectores: str                  # clave del prompt parcial del legal (WS M)
    reglas_activas: frozenset[str]       # reglas de compliance_rules activas (WS V)
    topes_uit: dict[str, float]          # topes por procedimiento (WS V)
    dictamen_secciones: tuple[str, ...]  # secciones del dictamen (WS M)
    doc_prioridad: tuple[str, ...]       # prioridad por documentType/título normalizado (WS D)
    parse_max_docs: int                  # tope de documentos a parsear (WS D)

    def as_state(self) -> dict:
        """Snapshot serializable para `state["perfil"]` (las tools lo leen vía tool_context)."""
        return {
            "nombre": self.nombre,
            "tipos_aceptados": sorted(self.tipos_aceptados),
            "agentes": list(self.agentes),
            "parser_bloque": self.parser_bloque,
            "market_estrategia": self.market_estrategia,
            "legal_vectores": self.legal_vectores,
            "reglas_activas": sorted(self.reglas_activas),
            "topes_uit": dict(self.topes_uit),
            "dictamen_secciones": list(self.dictamen_secciones),
            "doc_prioridad": list(self.doc_prioridad),
            "parse_max_docs": self.parse_max_docs,
        }


_BIENES = Profile(
    nombre="bienes",
    tipos_aceptados=TIPOS_BIENES,
    agentes=AGENTES_CANONICOS,
    parser_bloque=None,
    market_estrategia="goods_retail",
    legal_vectores="bienes",
    reglas_activas=_REGLAS_BASE | {"fraccionamiento"},
    topes_uit=_TOPES_BIENES_SERVICIOS,
    dictamen_secciones=(
        "Resumen ejecutivo", "Hechos clave", "Precios unitarios vs mercado",
        "Requerimiento técnico y direccionamiento", "Antecedentes del proveedor",
        "Red de personas", "Cumplimiento normativo", "Recortes y datos no verificables",
    ),
    doc_prioridad=(
        "bases integradas", "bases", "especificaciones tecnicas", "acta", "cuadro comparativo",
        "contrato", "orden de compra", "adenda", "absolucion",
    ),
    parse_max_docs=12,
)

_SERVICIOS = Profile(
    nombre="servicios",
    tipos_aceptados=TIPOS_SERVICIOS,
    # Sin market retail, pero CON market histórico SEACE (tarifa mensual / por entregable).
    agentes=AGENTES_CANONICOS,
    parser_bloque="servicio",
    market_estrategia="historico_seace",
    legal_vectores="servicios",
    reglas_activas=_REGLAS_BASE | {"personal_clave_vinculado", "fraccionamiento"},
    topes_uit=_TOPES_BIENES_SERVICIOS,
    dictamen_secciones=(
        "Resumen ejecutivo", "Hechos clave", "Términos de referencia y proporcionalidad",
        "Costo mensual y por entregable vs histórico SEACE", "Antecedentes del proveedor",
        "Red de personas", "Cumplimiento normativo", "Recortes y datos no verificables",
    ),
    doc_prioridad=(
        "terminos de referencia", "bases integradas", "bases", "acta", "cuadro comparativo",
        "contrato", "orden de servicio", "adenda", "absolucion",
    ),
    parse_max_docs=12,
)

_OBRAS = Profile(
    nombre="obras",
    tipos_aceptados=TIPOS_OBRAS,
    agentes=AGENTES_CANONICOS,
    parser_bloque="obra",
    market_estrategia="presupuesto_obra",
    legal_vectores="obras",
    reglas_activas=_REGLAS_BASE | {"adicional_acumulado", "consorcio_recurrente"},
    topes_uit=_TOPES_OBRAS,
    dictamen_secciones=(
        "Resumen ejecutivo", "Hechos clave", "Expediente técnico, presupuesto y adicionales",
        "Ejecución y ampliaciones", "Antecedentes del contratista y consorciados",
        "Red de personas", "Cumplimiento normativo", "Recortes y datos no verificables",
    ),
    doc_prioridad=(
        "expediente tecnico", "presupuesto", "bases integradas", "bases", "contrato",
        "adenda", "adicional", "valorizacion", "acta",
    ),
    parse_max_docs=12,
)

_OTROS = Profile(
    nombre="otros",
    tipos_aceptados=TIPOS_OTROS,
    # Sin entity_personnel ni compliance_extended completo: la unidad de análisis es
    # causal + expediente de sustento; web/news/person sí investigan al proveedor.
    agentes=("compliance", "document_parser", "document_legal_analyst", "market",
             "web_research", "news_research", "person_network", "report_writer"),
    parser_bloque="sustento_directa",
    market_estrategia="cotizaciones",
    legal_vectores="otros",
    reglas_activas=_REGLAS_BASE | {"fraccionamiento", "directa_recurrente"},
    topes_uit=_TOPES_CONSULTORIA,
    dictamen_secciones=(
        "Resumen ejecutivo", "Hechos clave", "Causal y expediente de sustento",
        "Cotizaciones vs monto adjudicado", "Antecedentes del proveedor",
        "Red de personas", "Cumplimiento normativo", "Recortes y datos no verificables",
    ),
    doc_prioridad=(
        "informe tecnico", "informe legal", "informe", "resolucion", "acto resolutivo",
        "cotizacion", "contrato", "convenio", "orden de",
    ),
    parse_max_docs=12,
)

PROFILES: dict[str, Profile] = {p.nombre: p for p in (_BIENES, _SERVICIOS, _OBRAS, _OTROS)}

# Alias del tipo de clasificación → perfil que lo atiende.
TIPO_A_PERFIL: dict[str, str] = {}
for _p in PROFILES.values():
    for _t in _p.tipos_aceptados:
        TIPO_A_PERFIL[_t] = _p.nombre

PROFILE: str = (os.getenv("PIPELINE_PROFILE") or "bienes").strip().lower()


def get_profile(nombre: str | None = None) -> Profile:
    """Perfil activo (env `PIPELINE_PROFILE`, default bienes). Un valor desconocido cae en
    bienes para no romper el servicio histórico; se loggea una vez."""
    n = (nombre or PROFILE or "bienes").strip().lower()
    p = PROFILES.get(n)
    if p is None:
        print(f'[profiles] PIPELINE_PROFILE="{n}" desconocido → bienes', flush=True)
        return _BIENES
    return p


def perfil_para_tipo(tipo: str | None) -> str | None:
    """Nombre del perfil que atiende un `clasificacion.tipo` (None si el tipo es desconocido)."""
    if not tipo:
        return None
    return TIPO_A_PERFIL.get(str(tipo).strip().lower())


def acepta(profile: Profile, tipo: str | None) -> bool:
    """¿Este servicio acepta la contratación de `tipo`? None → True (análisis a demanda
    sin `clasificacion`, compatibilidad con el flujo del admin)."""
    if tipo is None or str(tipo).strip() == "":
        return True
    return str(tipo).strip().lower() in profile.tipos_aceptados
