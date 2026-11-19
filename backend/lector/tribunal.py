"""Lector de las resoluciones del Tribunal de Contrataciones (TCE / TCP) que resuelven recursos de apelación.

El dato lo lee el modelo (GLM por Workers AI, motor_workers.MotorWorkers.llamar_texto); el código sólo enruta (¿es una
apelación?), recorta (el encabezado y la parte resolutiva) y comprueba (la cita literal del resolutivo está en el texto,
y cada procedimiento citado también). Ver docs/DATOS_Y_SENALES.md §15.1: las apelaciones fundadas y las nulidades de
oficio son la verdad de la etapa de selección con la que se validan las señales de competencia.
"""
from __future__ import annotations

import re

VERSION = "v1"

SISTEMA = """Lees resoluciones del Tribunal de Contrataciones del Perú (antes TCE, hoy TCP) que resuelven un RECURSO DE
APELACIÓN contra un acto de un procedimiento de selección (la buena pro, una descalificación, la declaratoria de desierto).
Devuelves sólo lo que la resolución dice, con sus palabras. No inventes: si un dato no figura, déjalo vacío.

- «procedimientos»: cada procedimiento de selección impugnado, copiado tal como aparece (por ejemplo «Licitación Pública
  Abreviada de Obras N° 003-2026-MDH/C-1» o «Adjudicación Simplificada N° 12-2025-GRA/CS - Primera Convocatoria»), con
  sus ítems si la resolución los nombra.
- «entidad»: la entidad que convocó, con su nombre completo como figura.
- «impugnante»: quien apeló (empresa o consorcio), como figura.
- «resultado»: lo que decide el Tribunal sobre el recurso. fundado | fundado_en_parte | infundado | improcedente |
  nulidad_de_oficio (el Tribunal declara nulo el procedimiento o parte de él, aunque también se pronuncie sobre el
  recurso) | desistimiento | otro.
- «efectos»: lo que ordena: revoca_buena_pro, otorga_buena_pro_al_impugnante, retrotrae (vuelve a una etapa anterior),
  nulidad (anula el procedimiento o ítems), descalifica_al_adjudicatario, confirma_buena_pro.
- «motivo»: en una oración, por qué decide así (el vicio que encontró o por qué no lo encontró).
- «cita_resolutivo»: copia LITERAL del primer punto de la parte resolutiva («1. Declarar …»), hasta 300 caracteres.
- «fecha»: la fecha de la resolución (AAAA-MM-DD)."""

ESQUEMA = {
    "type": "object",
    "properties": {
        "procedimientos": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "entidad": {"type": "string"},
        "impugnante": {"type": "string"},
        "resultado": {"type": "string", "enum": ["fundado", "fundado_en_parte", "infundado", "improcedente",
                                                  "nulidad_de_oficio", "desistimiento", "otro"]},
        "efectos": {"type": "array", "items": {"type": "string", "enum": [
            "revoca_buena_pro", "otorga_buena_pro_al_impugnante", "retrotrae", "nulidad", "descalifica_al_adjudicatario",
            "confirma_buena_pro"]}},
        "motivo": {"type": "string"},
        "cita_resolutivo": {"type": "string"},
        "fecha": {"type": "string"},
    },
    "required": ["procedimientos", "entidad", "resultado", "cita_resolutivo"],
}

PEDIDO = "Lee esta resolución del Tribunal y devuelve sus datos con la herramienta «salida»."

_ESPACIOS = re.compile(r"\s+")
_RESUELVE = re.compile(r"(?:LA SALA RESUELVE|SE RESUELVE|RESUELVE)\s*:?", re.I)


def plano(t: str) -> str:
    return _ESPACIOS.sub(" ", t or "").strip()


def tipo_de(texto: str) -> str:
    """Enruta sin modelo, por el encabezado: apelacion | sancion | otro (sustituciones, nulidades sueltas, otros)."""
    ini = plano(texto)[:4000]
    if re.search(r"recurso de apelaci[oó]n", ini, re.I):
        return "apelacion"
    if re.search(r"sancionador|imposici[oó]n de sanci[oó]n|inhabilitaci[oó]n", ini, re.I):
        return "sancion"
    return "otro"


def recorte(texto: str, cabeza: int = 7000, cola: int = 5000) -> str:
    """Lo que el modelo necesita: el encabezado (sumilla, visto, el procedimiento y las partes) y la parte resolutiva."""
    t = plano(texto)
    m = None
    for m in _RESUELVE.finditer(t):   # la última «RESUELVE» es la parte resolutiva
        pass
    fin = t[m.start():m.start() + cola] if m else t[-cola:]
    return t[:cabeza] + "\n\n[…]\n\n" + fin


def _compacto(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", plano(s).lower().replace("°", "").replace("º", ""))


def comprobar(salida: dict, texto: str) -> dict:
    """La cita del resolutivo y cada procedimiento deben estar en el texto (sin espacios ni signos): si no, no se usan."""
    t = _compacto(texto)
    cita = salida.get("cita_resolutivo") or ""
    salida["_cita_ok"] = bool(cita) and _compacto(cita[:160]) in t
    salida["_procedimientos_ok"] = [p for p in (salida.get("procedimientos") or []) if len(_compacto(p)) >= 8 and _compacto(p) in t]
    return salida


def normalizar(salida: dict) -> dict:
    salida["procedimientos"] = [plano(p) for p in (salida.get("procedimientos") or []) if plano(p)][:6]
    for k in ("entidad", "impugnante", "motivo", "cita_resolutivo", "fecha"):
        if k in salida:
            salida[k] = plano(salida.get(k) or "")
    return salida
