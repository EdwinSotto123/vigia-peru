"""Clasifica una visita del Registro de Visitas (Ley 28024) respecto de UN proceso.

Una visita no es un vínculo. Que un funcionario municipal visite el Congreso, un ministerio o un
organismo regulador es gestión institucional ordinaria. Solo se destaca cuando hay algo MÁS:
  · la visita fue a la entidad que contrata este proceso Y quien visita no es de esa entidad, o
  · el motivo menciona al proveedor ganador o al proceso.
El resto queda como contexto, sin trazo en el grafo ni puntaje. Función pura: sin acceso a base
de datos, sin modelo.

Quien es de la PROPIA entidad (figura en su comité, entre sus firmantes o sus funcionarios, o el registro dice que venía
en su representación) entra a su lugar de trabajo: su «visita» no dice nada del proveedor. Tampoco una visita de más de
dos años antes del análisis. (Dictamen del proceso 1231028, 2026-11-16: tres visitas de miembros del comité a su propia
entidad, una de cuatro años atrás, salían como «lo que pide revisión».)
"""
from __future__ import annotations

import datetime as _dt
import re
import unicodedata

UMBRAL_IDENTIDAD = 0.9      # por debajo, la coincidencia es por nombre aproximado: no se usa
DIAS_VISITA_VIGENTE = 730   # una visita más vieja que esto no se toma por cercana al proceso
_STOP = {"DE", "DEL", "LA", "LOS", "LAS", "Y", "EL", "EN", "SAC", "SA", "SRL", "EIRL", "SAA", "S", "A", "C", "R", "L"}


def _tokens(s: str | None) -> set[str]:
    s = "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn").upper()
    return {t for t in re.sub(r"[^A-Z0-9 ]", " ", s).split() if t not in _STOP and len(t) > 1}


def _misma_entidad(a: str | None, b: str | None) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / min(len(ta), len(tb)) >= 0.8


def _misma_persona(a: str | None, b: str | None) -> bool:
    """Dos nombres son de la misma persona si las palabras del más corto (2 o más) están todas en el otro: el acta
    escribe «JUAN PEREZ QUISPE» y el registro de visitas «PEREZ QUISPE JUAN CARLOS»."""
    ta, tb = _tokens(a), _tokens(b)
    corta, larga = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return len(corta) >= 2 and corta <= larga


def _antigua(fecha, referencia) -> bool:
    try:
        f = _dt.date.fromisoformat(str(fecha)[:10])
        r = _dt.date.fromisoformat(str(referencia)[:10]) if referencia else _dt.date.today()
    except (TypeError, ValueError):
        return False
    return (r - f).days > DIAS_VISITA_VIGENTE


def clasificar_visita(v: dict, *, entidad_contratante: str | None, ganador_razon: str | None,
                      es_de_la_entidad: bool = False, fecha_referencia: str | None = None) -> dict:
    """Devuelve {categoria, razon}. categoria: 'relevante' | 'institucional' | 'descartada'."""
    dni_ok = bool(str(v.get("dni") or "").strip()) and float(v.get("match_score") or 0) >= 1.0
    if not dni_ok and float(v.get("match_score") or 0) < UMBRAL_IDENTIDAD:
        return {"categoria": "descartada", "razon": "coincidencia solo aproximada por nombre: no identifica a la persona"}
    visitada = v.get("entidad_visitada")
    if _misma_entidad(visitada, entidad_contratante):
        if es_de_la_entidad or _misma_entidad(v.get("entidad_visitante"), entidad_contratante):
            return {"categoria": "institucional",
                    "razon": "quien visita es de la propia entidad (comité, firmante o funcionario): no dice nada del proveedor"}
        if _antigua(v.get("fecha"), fecha_referencia):
            return {"categoria": "institucional", "razon": "la visita es de más de dos años antes del análisis"}
        return {"categoria": "relevante", "razon": "la visita fue a la entidad que contrata este proceso"}
    t_ganador = _tokens(ganador_razon)
    if t_ganador and len(t_ganador & _tokens(v.get("motivo"))) >= max(2, len(t_ganador) // 2 + 1):
        return {"categoria": "relevante", "razon": "el motivo de la visita menciona al proveedor ganador"}
    return {"categoria": "institucional",
            "razon": "visita institucional ordinaria: no se relaciona con la entidad ni con el proveedor de este proceso"}


def resumir_visitas(visitas_por_persona: dict[str, list[dict]], *, entidad_contratante: str | None,
                    ganador_razon: str | None, max_relevantes: int = 6,
                    personas_de_la_entidad: list[str] | tuple[str, ...] = (), fecha_referencia: str | None = None) -> dict:
    """{relevantes[], n_institucionales, n_descartadas}; solo las relevantes llevan detalle.

    `personas_de_la_entidad`: los nombres del comité, los firmantes y los funcionarios de la entidad que contrata (sin
    el ganador ni los postores, que también firman): sus visitas a esa entidad no son relevantes."""
    relevantes, n_inst, n_desc = [], 0, 0
    for persona, visitas in visitas_por_persona.items():
        de_la_entidad = any(_misma_persona(persona, x) for x in personas_de_la_entidad or ())
        for v in visitas or []:
            c = clasificar_visita(v, entidad_contratante=entidad_contratante, ganador_razon=ganador_razon,
                                  es_de_la_entidad=de_la_entidad, fecha_referencia=fecha_referencia)
            if c["categoria"] == "relevante":
                relevantes.append({"persona": persona, "entidad_visitada": v.get("entidad_visitada"),
                                   "entidad_representada": v.get("entidad_visitante"),
                                   "funcionario_anfitrion": v.get("funcionario"), "fecha": v.get("fecha"),
                                   "motivo": v.get("motivo"), "razon": c["razon"]})
            elif c["categoria"] == "institucional":
                n_inst += 1
            else:
                n_desc += 1
    return {"relevantes": relevantes[:max_relevantes], "n_relevantes": len(relevantes),
            "n_institucionales": n_inst, "n_descartadas": n_desc}
