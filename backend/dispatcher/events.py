"""Reduce el stream NDJSON del orquestador a lo que el público necesita ver.

El orquestador emite una línea JSON por evento (`{kind, ...}`). Solo cuatro
tipos importan para el tablero en vivo: `phase` (arranca una fase), `warn`,
`error` y `final` (terminó). Todo lo demás (tool_call, tool_result, thought,
metrics, eval, transfer, session) es ruido para este propósito.

`FASES` es el contrato con el frontend (`frontend/lib/auditoria.ts`): diez fases
canónicas en el orden real de `backend/agent/deterministic.py`. Algunos nombres
que emite el orquestador difieren del canónico → `ALIASES`.
"""
from __future__ import annotations

FASES: list[str] = [
    "compliance",
    "document_parser",
    "document_legal_analyst",
    "market",
    "web_research",
    "news_research",
    "entity_personnel",
    "person_network",
    "compliance_extended",
    "report_writer",
]

# nombre emitido por deterministic.py → fase canónica
ALIASES: dict[str, str] = {
    "legal": "document_legal_analyst",
    "research_parallel": "web_research",   # web ∥ prensa ∥ funcionarios arrancan juntas
    "news": "news_research",
}

VISIBLES = {"phase", "warn", "error", "final"}


def _aborted_reason(ev: dict) -> str | None:
    """Motivo del aborto en un evento `final`, o None si el análisis terminó de verdad."""
    st = ev.get("state")
    if isinstance(st, dict) and st.get("_aborted"):
        return str(st["_aborted"])[:120]
    if ev.get("runner_error"):
        re_ = ev["runner_error"]
        return str(re_.get("msg") if isinstance(re_, dict) else re_)[:120] or "runner_error"
    return None


def reduce_event(state: dict, ev: dict) -> dict:
    """Devuelve SOLO los cambios de estado que produce `ev` (dict vacío si es ruido).

    - `phase` conocida → `fase_actual` + `fase_index`.
    - `phase` auxiliar (ocds, started, safety_net, persist…) → `fase_actual` cambia y
      `fase_index` conserva el último valor conocido (no retrocede ni se inventa).
    - `final` → `terminado=True`, índice = len(FASES); si el orquestador abortó
      (`state._aborted` o `runner_error`) → además `abortado` + `error`, sin índice final.
    - `error` → `error` con el detalle recortado.
    - `warn` → visible (se registra como evento) pero no cambia el estado.
    """
    kind = ev.get("kind")
    if kind not in VISIBLES:
        return {}
    out: dict = {}
    if kind == "phase":
        raw = str(ev.get("name") or "")
        name = ALIASES.get(raw, raw)
        out["fase_actual"] = name
        if name in FASES:
            out["fase_index"] = FASES.index(name)
        elif state.get("fase_index") is not None:
            out["fase_index"] = state["fase_index"]  # fase auxiliar: el progreso se mantiene
    elif kind == "final":
        out["terminado"] = True
        aborted = _aborted_reason(ev)
        if aborted:
            # El orquestador cerró el stream pero NO analizó (p. ej. fuente OECE caída):
            # no es un procesamiento válido; el dispatcher lo re-encola sin gastar intento.
            out["abortado"] = aborted
            out["error"] = f"análisis abortado por el orquestador: {aborted}"[:500]
        else:
            out["fase_actual"] = "final"
            out["fase_index"] = len(FASES)
    elif kind == "error":
        out["error"] = str(ev.get("detail") or ev.get("msg") or "error")[:500]
    return out
