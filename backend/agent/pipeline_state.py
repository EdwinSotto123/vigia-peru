"""Bookkeeping del `state` compartido del pipeline determinista (backend/agent/deterministic.py):
filtrado de kwargs por firma, registro de recortes/descartes, detección de salida vacía,
merge de deltas de sub-agentes aislados (acumuladores vs overwrite) y backfill determinista
de `document_analysis` desde la extracción cruda del parser.

Extraído de deterministic.py — ver su docstring para el modelo de state. Funciones puras
sobre `state`/`delta` recibidos por parámetro; no leen globals de deterministic.py.
"""
from __future__ import annotations

import inspect
import json


def _kwargs_soportados(fn, **extra) -> dict:
    """Filtra `extra` a los kwargs que `fn` acepta (para pasar parámetros de perfil a tools
    de otros WS que pueden no haberlos incorporado todavía)."""
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return {}
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return dict(extra)
    return {k: v for k, v in extra.items() if k in params}


def _registrar_recorte(state: dict, donde: str, limite, omitido) -> None:
    """Todo tope aplicado queda registrado (ningún recorte silencioso)."""
    state.setdefault("recortes", []).append({"donde": donde, "limite": limite, "omitido": omitido})


def _registrar_descarte(state: dict, donde: str, motivo: str, detalle=None) -> None:
    state.setdefault("descartes", []).append({"donde": donde, "motivo": motivo, "detalle": detalle})


def _is_empty_output(val) -> bool:
    """True si la salida de un sub-agente es 'vacía' (quirk Gemini+google_search:
    tokens al grounding, texto final ''). Una salida ESTRUCTURADA con al menos un
    campo con contenido (ej. sin_data_publica:true, noticias:[...]) NO es vacía —
    solo dispara el guardrail lo realmente hueco (''/{}/[] o dict todo-vacío)."""
    if val is None:
        return True
    if isinstance(val, str):
        return val.strip() in ("", "{}", "[]")
    if isinstance(val, dict):
        return not any(v not in (None, "", [], {}) for v in val.values())
    if isinstance(val, (list, tuple, set)):
        return len(val) == 0
    return not val


# Acumuladores de lista compartidos: al aplicar el delta de un sub-agente aislado se AÑADEN
# los elementos nuevos (dedupe por JSON) en vez de pisar la lista (otra rama pudo agregar).
_ACUMULADORES = ("pending_flags", "recortes", "descartes", "grounding_urls", "validaciones_pendientes")
_SOLO_DRIVER = ("banderas", "score", "alerta_codigo")


def _json_key(x) -> str:
    try:
        return json.dumps(x, sort_keys=True, default=str, ensure_ascii=False)
    except Exception:
        return repr(x)


def _aplicar_delta(state: dict, delta: dict) -> None:
    """Mergea el delta de un sub-agente al state compartido: claves normales → overwrite;
    acumuladores (`_ACUMULADORES`) → append de los elementos que aún no están."""
    for k, v in (delta or {}).items():
        if k in _SOLO_DRIVER:
            continue  # las escribe persistence desde el driver (score/banderas): un snapshot viejo las pisaría
        if k in _ACUMULADORES and isinstance(v, list):
            cur = state.get(k)
            if not isinstance(cur, list):
                state[k] = list(v)
                continue
            vistos = {_json_key(x) for x in cur}
            for x in v:
                kx = _json_key(x)
                if kx not in vistos:
                    cur.append(x)
                    vistos.add(kx)
        else:
            state[k] = v


def _backfill_document_analysis(state: dict) -> str:
    """Backfill DETERMINISTA de `document_analysis` desde `parser_raw_consolidated`.

    `parse_document_pdf` (tool) extrae los ítems REALES y los stashea en
    `state['parser_raw_consolidated']`; al agente le devuelve solo un RESUMEN compacto
    (conteos), por lo que el LLM document_parser A VECES escribe `items_consolidados`
    GENÉRICO ("Item N del proceso de selección") o vacío aunque OCR'eó los reales (bug
    intermitente verificado: 1212446 → 1 genérico; 1211719 → vacío; pero 1202511 → 35
    reales en la MISMA revisión). Acá, en CÓDIGO, preferimos la extracción autoritativa
    de la tool sobre el placeholder del LLM, de modo que legal/market/compliance reciban
    los ítems reales (el rescate equivalente en persist no alcanzaba porque depende de que
    `parser_raw_consolidated` siga en state al final). Idempotente; no-op si la tool no
    extrajo nada o si el agente ya trae ítems reales. Devuelve un log de conteos."""
    raw = state.get("parser_raw_consolidated")
    raw = raw if isinstance(raw, dict) else {}
    da = state.get("document_analysis")
    if isinstance(da, str):
        try:
            da = json.loads(da)
        except Exception:
            da = {}
    da = da if isinstance(da, dict) else {}
    raw_items = raw.get("items_consolidados") or []
    da_items = da.get("items_consolidados") or []
    msg = f"raw={len(raw_items)} da={len(da_items)}"
    # La tool (parse_document_pdf) es la AUTORIDAD de extracción estructurada: al AGENTE
    # se le devuelve solo un RESUMEN con conteos (NO los ítems), así que su
    # document_analysis a veces es PLACEHOLDER del schema ("Descripción corta del Ítem N
    # extraída de las Bases", "POSTOR DE BASES 1", "NOMBRE FIRMANTE BASES"). Por eso, si la
    # tool extrajo algo, GANA SIEMPRE (incondicional — antes se gateaba con n_raw>n_da y
    # los placeholders, contados como "reales", empataban y ganaban). Se conserva el
    # `resumen_ejecutivo`/`modalidad`/etc. narrativos del agente.
    if raw_items:
        da["items_consolidados"] = raw_items
        for k in ("firmantes_consolidados", "firmantes", "postores_consolidados",
                  "postores_extraidos", "comite_evaluacion", "motivos_adjudicacion",
                  "lugar_fecha_acta", "cuantia_total"):
            if raw.get(k) not in (None, "", [], {}):
                da[k] = raw[k]
        state["document_analysis"] = da
        msg += f" → estructura desde la TOOL (items={len(raw_items)}, autoritativa sobre el LLM)"
    return msg


def _va_al_trace(ev: dict) -> bool:
    """Qué eventos del driver se guardan en `events_trace` (agent_trace persistido): todo
    salvo los `phase` de progreso (los `phase` "omitido: …" sí, el tablero los muestra)."""
    if ev.get("kind") != "phase":
        return True
    return str(ev.get("msg") or "").startswith("omitido")
