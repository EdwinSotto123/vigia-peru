"""Reduce el stream NDJSON del orquestador a lo que el público necesita ver.

El orquestador emite una línea JSON por evento (`{kind, ...}`). Solo cuatro
tipos importan para el tablero en vivo: `phase` (arranca una fase), `warn`,
`error` y `final` (terminó). Todo lo demás (tool_call, tool_result, thought,
metrics, eval, transfer, session) es ruido para este propósito.

`FASES` es el contrato con el frontend (`frontend/lib/auditoria.ts`): diez fases
canónicas en el orden real de `backend/agent/deterministic.py`. Algunos nombres
que emite el orquestador difieren del canónico → `ALIASES`.

Desde el DAG paralelo (`_correr_dag`) las fases llegan DESORDENADAS: `market`
puede empezar antes que `web_research`, y tres ramas corren a la vez. Por eso el
estado reducido lleva, además de `fase_actual`/`fase_index` (máximo alcanzado),
un mapa `fases` {nombre: {estado, desde, hasta, motivo}} con el estado de cada
agente (corriendo · hecho · omitido · error) que el frontend pinta como carriles.
Como el orquestador no emite "fase terminada", el fin de cada fase se infiere
del arranque de sus sucesoras (`CIERRA`) o del `dag_join`/`final`.
"""
from __future__ import annotations

import datetime as dt

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

# nombre emitido por deterministic.py / main.py → fase canónica
ALIASES: dict[str, str] = {
    "legal": "document_legal_analyst",
    "research_parallel": "web_research",   # web ∥ prensa ∥ funcionarios arrancan juntas
    "news": "news_research",
    "compliance_rules": "compliance_extended",  # perfil `otros`: las reglas corren en código
}

# Fases auxiliares que se rastrean en `fases` (chips del frontend) aunque no cuenten para el índice.
AUXILIARES_RASTREADAS: set[str] = {"ocds", "proveedor", "persist_checkpoint", "safety_net", "persist", "self_eval"}
RASTREADAS: set[str] = set(FASES) | AUXILIARES_RASTREADAS
# Auxiliares visibles en la bitácora que no son un agente: cambian `fase_actual`, no `fases`.
AUXILIARES_SUELTAS: set[str] = {"started", "deterministic", "perfil", "clasificacion", "dag", "dag_join", "final"}

# Ramas del DAG (todo lo que corre antes del join).
RAMAS: frozenset[str] = frozenset({
    "compliance", "document_parser", "document_legal_analyst", "market",
    "proveedor", "web_research", "news_research", "entity_personnel",
})
_RAMA_DOCUMENTOS = {"document_parser", "document_legal_analyst", "market"}
_RAMA_PROVEEDOR = {"proveedor", "web_research", "news_research", "entity_personnel"}
# nombre de rama en los `error` de _correr_dag → fases que tumba
RAMA_FASES: dict[str, set[str]] = {
    "compliance": {"compliance"},
    "documentos": _RAMA_DOCUMENTOS,
    "proveedor": _RAMA_PROVEEDOR,
}

# Al ARRANCAR la fase clave, las fases del valor que sigan `corriendo` pasan a `hecho`
# (sucesoras reales dentro de cada rama; el join y la síntesis cierran todo lo anterior).
_SINTESIS_PREVIA = set(RAMAS) | {"ocds", "person_network", "compliance_extended"}
CIERRA: dict[str, set[str]] = {
    "compliance": {"ocds"},
    "document_parser": {"ocds"},
    "proveedor": {"ocds"},
    "document_legal_analyst": {"document_parser"},
    "market": {"document_parser"},
    "web_research": {"proveedor"},
    "news_research": {"proveedor", "web_research"},          # solo en modo secuencial
    "entity_personnel": {"proveedor", "news_research"},       # solo en modo secuencial
    "dag_join": set(RAMAS) | {"ocds"},
    "person_network": set(RAMAS) | {"ocds"},
    "compliance_extended": set(RAMAS) | {"ocds", "person_network"},
    "persist_checkpoint": _SINTESIS_PREVIA,
    "report_writer": _SINTESIS_PREVIA | {"persist_checkpoint"},
    "safety_net": _SINTESIS_PREVIA | {"persist_checkpoint", "report_writer"},
    "persist": _SINTESIS_PREVIA | {"persist_checkpoint", "report_writer", "safety_net"},
    "self_eval": _SINTESIS_PREVIA | {"persist_checkpoint", "report_writer", "safety_net", "persist"},
}

# Posición en el flujo SECUENCIAL (sin DAG, o tras el join): arrancar una fase cierra las
# anteriores que sigan corriendo. Dentro del DAG este orden no vale (ramas concurrentes).
_ORDEN: dict[str, float] = {**{f: float(i) for i, f in enumerate(FASES)},
                            "ocds": -1.0, "proveedor": 3.5,
                            "persist_checkpoint": 8.5, "safety_net": 9.5, "persist": 9.6, "self_eval": 9.7}

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


def _ahora() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def canonico(raw: str | None) -> str:
    """Nombre canónico de una fase/agente: aplica ALIASES y quita el sufijo `_agent`."""
    n = str(raw or "").strip()
    if n.endswith("_agent"):
        n = n[: -len("_agent")]
    return ALIASES.get(n, n)


def _nombres_en_msg(msg: str | None) -> list[str]:
    """Nombres de fase listados en un msg tipo 'investigación paralela: a ∥ b ∥ c'."""
    if not msg:
        return []
    cola = msg.split(":", 1)[1] if ":" in msg else msg
    return [canonico(t) for t in cola.replace(",", "∥").split("∥") if canonico(t) in RASTREADAS]


def completadas(fases: dict) -> list[str]:
    """Fases `hecho`, en el orden del pipeline (canónicas primero)."""
    orden = sorted(fases, key=lambda n: (_ORDEN.get(n, 99.0), n))
    return [n for n in orden if (fases[n] or {}).get("estado") == "hecho"]


def _cerrar(fases: dict, nombres: set[str], ts: str, estado: str = "hecho", motivo: str | None = None) -> bool:
    cambio = False
    for n in nombres:
        f = fases.get(n)
        if f and f.get("estado") == "corriendo":
            f["estado"], f["hasta"] = estado, ts
            if motivo:
                f["motivo"] = motivo
            cambio = True
    return cambio


def _arrancar(fases: dict, nombre: str, ts: str, msg: str | None) -> None:
    prev = fases.get(nombre) or {}
    fases[nombre] = {"estado": "corriendo", "desde": ts, "hasta": None, "msg": (msg or None) and str(msg)[:160]}
    if prev.get("desde") and prev.get("estado") == "corriendo":
        fases[nombre]["desde"] = prev["desde"]   # re-arranque (reintento): conserva el inicio


def reduce_event(state: dict, ev: dict, ts: str | None = None) -> dict:
    """Devuelve SOLO los cambios de estado que produce `ev` (dict vacío si es ruido).

    - `phase` canónica → `fase_actual`; `fase_index` = MÁXIMO alcanzado (en el DAG las
      fases llegan desordenadas: nunca retrocede).
    - `phase` auxiliar (ocds, started, safety_net, persist…) → `fase_actual` cambia y
      `fase_index` conserva el último valor conocido (no retrocede ni se inventa).
    - `phase` "omitido: …" → la fase queda `omitido` con el motivo; ni `fase_actual` ni
      `fase_index` cambian.
    - `fases` {nombre: {estado, desde, hasta, motivo, msg}} y `fases_completadas` [..] se
      devuelven completos cada vez que cambian (el dispatcher los persiste enteros).
    - `final` → `terminado=True`, índice = len(FASES), todo lo corriendo → hecho; si el
      orquestador abortó (`state._aborted` o `runner_error`) → `abortado` + `error`,
      lo corriendo → error, sin índice final.
    - `error` → `error` con el detalle recortado; la fase/rama afectada → `error`.
    - `warn` → visible (se registra como evento); solo un "reintento" reabre la fase.
    """
    kind = ev.get("kind")
    if kind not in VISIBLES:
        return {}
    ts = ts or _ahora()
    out: dict = {}
    fases: dict = {k: dict(v) for k, v in (state.get("fases") or {}).items()}
    fases_cambiaron = False

    if kind == "phase":
        raw = str(ev.get("name") or "")
        name = canonico(raw)
        msg = str(ev.get("msg") or "")
        if msg.startswith("omitido"):
            if name in RASTREADAS:
                motivo = msg.split(":", 1)[1].strip() if ":" in msg else "no aplica"
                fases[name] = {"estado": "omitido", "desde": ts, "hasta": ts, "motivo": motivo[:160]}
                fases_cambiaron = True
            if state.get("fase_index") is not None:
                out["fase_index"] = state["fase_index"]
        else:
            out["fase_actual"] = name
            if name in FASES:
                out["fase_index"] = max(int(state.get("fase_index") or 0), FASES.index(name))
            elif state.get("fase_index") is not None:
                out["fase_index"] = state["fase_index"]  # fase auxiliar: el progreso se mantiene
            if name == "dag":
                out["dag"] = True
            elif name == "dag_join":
                out["dag"] = False
            en_dag = out.get("dag", state.get("dag", False))
            # cierre de las predecesoras
            if name in CIERRA:
                fases_cambiaron |= _cerrar(fases, CIERRA[name], ts)
            if not en_dag and name in _ORDEN:
                previas = {n for n in fases if _ORDEN.get(n, 99.0) < _ORDEN[name]}
                fases_cambiaron |= _cerrar(fases, previas, ts)
            # arranque
            if name in RASTREADAS:
                _arrancar(fases, name, ts, msg)
                fases_cambiaron = True
            if raw == "research_parallel" or (name in RASTREADAS and "∥" in msg):
                # "investigación paralela: web_research ∥ news_research ∥ entity_personnel": arrancan juntas
                # (también al re-reducir eventos ya guardados, donde el nombre viene canónico).
                for extra in _nombres_en_msg(msg) or ["news_research", "entity_personnel"]:
                    if extra != name and extra in RASTREADAS:
                        _arrancar(fases, extra, ts, None)
                        fases_cambiaron = True
    elif kind == "final":
        out["terminado"] = True
        aborted = _aborted_reason(ev)
        if aborted:
            # El orquestador cerró el stream pero NO analizó (p. ej. fuente OECE caída):
            # no es un procesamiento válido; el dispatcher lo re-encola sin gastar intento.
            out["abortado"] = aborted
            out["error"] = f"análisis abortado por el orquestador: {aborted}"[:500]
            fases_cambiaron |= _cerrar(fases, set(fases), ts, "error", f"abortado: {aborted}"[:160])
        else:
            out["fase_actual"] = "final"
            out["fase_index"] = len(FASES)
            fases_cambiaron |= _cerrar(fases, set(fases), ts)
    elif kind == "error":
        detalle = str(ev.get("detail") or ev.get("msg") or "error")[:500]
        out["error"] = detalle
        objetivo = canonico(ev.get("name")) if ev.get("name") else ""
        agente = canonico(ev.get("agent"))
        afectadas: set[str] = set()
        if objetivo in RAMA_FASES and agente == "pipeline":
            afectadas = RAMA_FASES[objetivo]
        elif objetivo in RASTREADAS:
            afectadas = {objetivo}
        elif agente in RASTREADAS:
            afectadas = {agente}
        if afectadas:
            fases_cambiaron |= _cerrar(fases, afectadas, ts, "error", detalle[:160])
    elif kind == "warn":
        name = canonico(ev.get("name") or ev.get("agent"))
        msg = str(ev.get("msg") or "")
        if name in RASTREADAS and "reintento" in msg.lower():
            f = fases.get(name)
            if "tras reintento" in msg.lower():
                # segunda pasada también vacía: la fase termina con un default tipado (sin datos)
                fases_cambiaron |= _cerrar(fases, {name}, ts, "hecho", "sin resultados (default tipado)")
            elif f and f.get("estado") != "corriendo":
                f.update(estado="corriendo", hasta=None, motivo=None)
                fases_cambiaron = True

    if fases_cambiaron:
        out["fases"] = fases
        out["fases_completadas"] = completadas(fases)
    return out
