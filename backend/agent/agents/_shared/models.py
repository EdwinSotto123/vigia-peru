"""
Modelos Gemini por TIER + helpers de configuración por agente (thinking, temperatura,
tope de salida, schema de salida).

Tiers (env → default; verificado 2026-09-15 en Vertex AI global que responden):
  · SMART   → razonamiento crítico (legal, red de personas, dictamen): gemini-3.6-flash / high
  · DEFAULT → tareas balanceadas con búsqueda/tools (parser, web, prensa, entidad,
              compliance, compliance_extended): gemini-3.6-flash / low
  · FAST    → mecánicas (sanitize de ítems, decisor de índices): gemini-3.5-flash-lite
  · JUDGE   → jueces de la self-eval; DEBE ser distinto del generador: gemini-3.5-flash-lite
              (antes 3.5-flash, el doble de caro que 3.6-flash para clasificar en un enum)

NO existen en Vertex (404, 2026-09-15): gemini-3.6-pro, gemini-3.5-pro, gemini-3.6-flash-lite.

Thinking: la familia Gemini 3 se controla con `thinking_level` (minimal|low|medium|high; los
cuatro aceptados por 3.6-flash, `minimal` ≈ sin pensamiento); 2.5 usa `thinking_budget`.
En ADK 1.19 el thinking va SOLO por `planner=BuiltInPlanner(thinking_config=…)`; ponerlo en
`generate_content_config` lanza ValueError.

Overrides por env: `THINKING_<AGENTE>` (p. ej. THINKING_REPORT_WRITER=medium),
`TEMPERATURE_<AGENTE>`, `MAX_OUTPUT_TOKENS_<AGENTE>`, `OUTPUT_SCHEMA_NATIVO` (0|1).
"""
from __future__ import annotations

import os

_MODEL_SMART = os.getenv("GEMINI_MODEL_SMART", "gemini-3.6-flash")
_MODEL_DEFAULT = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
_MODEL_FAST = os.getenv("GEMINI_MODEL_FAST", "gemini-3.5-flash-lite")
_MODEL_JUDGE = os.getenv("GEMINI_MODEL_JUDGE", "gemini-3.5-flash-lite")

THINKING = frozenset({"minimal", "low", "medium", "high"})

# `output_schema` NATIVO en los LlmAgent. Default apagado: verificado en vivo (2026-09-15,
# tests/test_live_gemini36.py) que en 3.6-flash `response_schema` + `google_search` devuelve
# JSON válido pero `grounding_metadata.grounding_chunks` queda VACÍO (3/3 corridas), o sea las
# URLs del JSON no son verificables. Patrón vigente: JSON en texto + validación pydantic en el
# driver (deterministic._validar_schema) con los schemas de agents/_shared/schemas.py (WS M).
OUTPUT_SCHEMA_NATIVO = os.getenv("OUTPUT_SCHEMA_NATIVO", "0") == "1"


def is_gemini_3(model) -> bool:
    """True si el id del modelo es de la familia Gemini 3.x (thinking_level)."""
    m = str(model or "").lower()
    return m.startswith("gemini-3") or "/gemini-3" in m


def _env_key(agente: str) -> str:
    return agente.upper().replace("-", "_").removesuffix("_AGENT")


def thinking_level_for(agente: str, default: str | None) -> str | None:
    """Nivel de thinking del agente: env `THINKING_<AGENTE>` > default del config.
    `none`/`off`/vacío → sin planner (el modelo decide)."""
    raw = os.getenv(f"THINKING_{_env_key(agente)}")
    val = (raw if raw is not None else default)
    if val is None:
        return None
    val = str(val).strip().lower()
    if val in ("", "none", "off", "0"):
        return None
    if val not in THINKING:
        print(f"[models] THINKING_{_env_key(agente)}={val!r} inválido → {default!r}", flush=True)
        return default if default in THINKING else None
    return val


def _env_float(name: str, default):
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default):
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def build_planner(agente: str, model, default_level: str | None):
    """`BuiltInPlanner` con `thinking_level` (Gemini 3) o `thinking_budget` (2.5, mapeado
    grueso). None si el nivel es None o el modelo no es Gemini."""
    level = thinking_level_for(agente, default_level)
    if level is None:
        return None
    try:
        from google.adk.planners import BuiltInPlanner
        from google.genai import types
    except Exception as e:  # ADK ausente en tests unitarios sin SDK
        print(f"[models] sin BuiltInPlanner: {e}", flush=True)
        return None
    if is_gemini_3(model):
        cfg = types.ThinkingConfig(thinking_level=level, include_thoughts=False)
    else:
        budget = {"minimal": 0, "low": 1024, "medium": 4096, "high": 16384}[level]
        cfg = types.ThinkingConfig(thinking_budget=budget, include_thoughts=False)
    return BuiltInPlanner(thinking_config=cfg)


def build_generate_config(agente: str, temperature=None, max_output_tokens=None):
    """`GenerateContentConfig` con temperatura/tope de salida por agente (config + env). Nunca
    incluye thinking_config/tools/response_schema (ADK los rechaza ahí). Flex no va aquí: lo pone
    por llamada el patch de model_fallback (tools/flex.py)."""
    temp = _env_float(f"TEMPERATURE_{_env_key(agente)}", temperature)
    mot = _env_int(f"MAX_OUTPUT_TOKENS_{_env_key(agente)}", max_output_tokens)
    if temp is None and mot is None:
        return None
    try:
        from google.genai import types
    except Exception:
        return None
    kw = {}
    if temp is not None:
        kw["temperature"] = float(temp)
    if mot is not None:
        kw["max_output_tokens"] = int(mot)
    return types.GenerateContentConfig(**kw)


def resolve_output_schema(nombre: str | None):
    """Clase pydantic `agents._shared.schemas.<nombre>` si existe y OUTPUT_SCHEMA_NATIVO=1;
    None en cualquier otro caso (WS M define los schemas; si el módulo aún no existe → None)."""
    if not nombre or not OUTPUT_SCHEMA_NATIVO:
        return None
    try:
        from agents._shared import schemas  # WS M
        return getattr(schemas, nombre, None)
    except (ImportError, AttributeError):
        return None


def modelos_activos() -> dict:
    """Snapshot para `GET /` del servicio."""
    return {"smart": _MODEL_SMART, "default": _MODEL_DEFAULT, "fast": _MODEL_FAST,
            "judge": _MODEL_JUDGE, "output_schema_nativo": OUTPUT_SCHEMA_NATIVO}
