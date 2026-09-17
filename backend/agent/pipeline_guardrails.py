"""Guardrails de texto del dictamen final del pipeline determinista (backend/agent/deterministic.py):
detección de salida degenerada del report_writer (boilerplate de README, tokens de control,
cabecera perdida) + saneo de último recurso, y los bloques de instrucción que se anexan al
mensaje del report_writer con las validaciones pendientes y los recortes/descartes de la corrida.

Extraído de deterministic.py — funciones puras sobre texto/`state` recibidos por parámetro.
"""
from __future__ import annotations

import json

# ── Guardrail del dictamen ──────────────────────────────────────────────────
# El report_writer (gemini-2.5-pro) ocasionalmente DEGENERA su salida final en
# contratos doc-pesados: pierde la cabecera (queda solo en el "thinking") y anexa
# boilerplate de README + tokens de control. Detectamos eso y reintentamos con
# contexto compacto; si persiste, sanitizamos (cortamos la basura).
_DICTAMEN_BOILERPLATE = (
    "## usage", "## contributing", "## license", "## installation",
    "## getting started", "import main", "some_function", "pip install",
    "this project is licensed", "contributions are welcome",
)
_DICTAMEN_CTRL = ("<ctrl", "<unused", "<pad>", "<extra_id")


def _dictamen_problems(text) -> list[str]:
    """Detecta una salida de dictamen malformada (degeneración del modelo)."""
    t = (text or "").strip()
    probs: list[str] = []
    low = t.lower()
    for m in _DICTAMEN_BOILERPLATE:
        if m in low:
            probs.append(f"boilerplate:{m}")
            break
    for m in _DICTAMEN_CTRL:
        if m in t:
            probs.append(f"ctrl_token:{m}")
            break
    # Cabecera: el dictamen debe empezar con un heading markdown (título) en las
    # primeras líneas. Si arranca a mitad de contenido → cabecera perdida.
    head_lines = [ln for ln in t.splitlines()[:4] if ln.strip()]
    if not head_lines or not head_lines[0].lstrip().startswith("#"):
        probs.append("no_head")
    if len(t) < 800:
        probs.append("too_short")
    return probs


def _sanitize_dictamen(text: str) -> str:
    """Último recurso: corta la cola de basura (boilerplate de README / tokens de
    control) que el modelo pudo anexar. NO inventa contenido — solo recorta."""
    t = text or ""
    low = t.lower()
    cut = len(t)
    for m in _DICTAMEN_BOILERPLATE:
        i = low.find(m)
        if i != -1:
            cut = min(cut, i)
    for m in _DICTAMEN_CTRL:
        i = t.find(m)
        if i != -1:
            cut = min(cut, i)
    t = t[:cut].rstrip()
    # Cerrar un code fence colgante que el recorte pudo dejar abierto.
    if t.count("```") % 2 == 1:
        t = t.rsplit("```", 1)[0].rstrip()
    return t


# Texto de cada validación pendiente para el dictamen (códigos de
# backend/core/clasificacion.VALIDACIONES; el orquestador no importa ese paquete).
_VALIDACION_TEXTO = {
    "infobras_avance": "Avance físico/financiero de la obra (INFOBRAS) no disponible: no se verificó la ejecución.",
    "market_sin_items_fisicos": "Sin ítems físicos con cantidad y unidad: no se comparó precio de mercado.",
    "sin_documentos_descargables": "Sin bases, buena pro ni contrato publicados: no se analizaron documentos.",
    "proveedor_sin_ruc": "El record no identifica al proveedor (RUC): no se investigó a la empresa ni su red.",
    "entidad_sin_ruc": "Sin RUC de la entidad: no se investigó a sus funcionarios.",
}


def _bloque_validaciones(state: dict) -> str:
    """Instrucción para el report_writer con las validaciones pendientes (vacío si no hay)."""
    vals = state.get("validaciones_pendientes")
    if not isinstance(vals, (list, tuple)) or not vals:
        return ""
    lineas = "\n".join(f"- {_VALIDACION_TEXTO.get(str(v), str(v))}" for v in vals)
    return ("\n\nVALIDACIONES PENDIENTES (datos que NO se pudieron verificar en esta corrida). Cerrá el "
            "dictamen con una sección '## Validaciones pendientes' que las liste TAL CUAL, sin inventar "
            "resultados ni conclusiones sobre ellas:\n" + lineas)


_MAX_LINEAS_RECORTES = 25


def _bloque_recortes(state: dict) -> str:
    """Instrucción para el report_writer con los recortes (topes aplicados) y descartes
    (hallazgos sin evidencia verificable) de la corrida. Vacío si no hubo ninguno. Si hay más
    de _MAX_LINEAS_RECORTES, se listan los primeros y el conteo del resto (recorte declarado)."""
    recortes = state.get("recortes") if isinstance(state.get("recortes"), list) else []
    descartes = state.get("descartes") if isinstance(state.get("descartes"), list) else []
    if not recortes and not descartes:
        return ""
    lineas: list[str] = []
    for r in recortes:
        if isinstance(r, dict):
            lineas.append(f"- recorte en {r.get('donde')}: límite {r.get('limite')}, omitido: "
                          f"{json.dumps(r.get('omitido'), ensure_ascii=False, default=str)[:200]}")
        else:
            lineas.append(f"- recorte: {str(r)[:200]}")
    for d in descartes:
        if isinstance(d, dict):
            lineas.append(f"- descarte en {d.get('donde')}: {d.get('motivo')} "
                          f"{json.dumps(d.get('detalle'), ensure_ascii=False, default=str)[:160] if d.get('detalle') else ''}")
        else:
            lineas.append(f"- descarte: {str(d)[:200]}")
    resto = len(lineas) - _MAX_LINEAS_RECORTES
    if resto > 0:
        lineas = lineas[:_MAX_LINEAS_RECORTES] + [f"- … y {resto} recortes/descartes más (ver analisis_full.recortes)"]
    return ("\n\nRECORTES Y DATOS NO VERIFICABLES de esta corrida (topes aplicados por el pipeline y "
            "hallazgos descartados por falta de evidencia). Incluí una sección '## Recortes y datos no "
            "verificables' que los liste TAL CUAL, sin inferir conclusiones a partir de lo omitido:\n"
            + "\n".join(lineas))
