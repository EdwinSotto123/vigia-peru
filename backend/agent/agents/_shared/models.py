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

Proveedor (interruptores booleanos, ver `proveedor_para`): por defecto TODO va a Gemini (Vertex).
  · USAR_WORKERS_AI=1            → los agentes que lo permiten pasan a Cloudflare Workers AI
  · USAR_WORKERS_AI_<AGENTE>=1/0 → fuerza un agente (gana sobre el global), p. ej. USAR_WORKERS_AI_PERSON_NETWORK=0
  · Los agentes con `google_search` (grounding de Gemini) SIEMPRE se quedan en Gemini.
  · USAR_ANTHROPIC=1 / USAR_ANTHROPIC_<AGENTE>=1/0 → Claude (API de Anthropic vía LiteLLM); ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID,
    ANTHROPIC_MODEL (default claude-haiku-5-5), ANTHROPIC_MAX_TOKENS (32000), ANTHROPIC_REASONING (low|medium|high; vacío = sin parámetro).
  · WORKERS_AI_MODEL / WORKERS_AI_MODEL_FAST (ids `@cf/...`), WORKERS_AI_URL + WORKERS_AI_TOKEN (Worker vigia-llm).
  · WORKERS_AI_REASONING=low|medium|high (default low): GLM razona sin parar y Workers AI corta con error 3046 (medido 2026-10-12).

Overrides por env: `THINKING_<AGENTE>` (p. ej. THINKING_REPORT_WRITER=medium),
`TEMPERATURE_<AGENTE>`, `MAX_OUTPUT_TOKENS_<AGENTE>`, `OUTPUT_SCHEMA_NATIVO` (0|1).
"""
from __future__ import annotations

import os

_MODEL_SMART = os.getenv("GEMINI_MODEL_SMART", "gemini-3.6-flash")
_MODEL_DEFAULT = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
_MODEL_FAST = os.getenv("GEMINI_MODEL_FAST", "gemini-3.5-flash-lite")
_MODEL_JUDGE = os.getenv("GEMINI_MODEL_JUDGE", "gemini-3.5-flash-lite")

# ── Proveedor de modelos: Gemini (Vertex) o Cloudflare Workers AI ─────────────────────────────────
_VERDADERO = ("1", "true", "yes", "si", "sí", "on")
WORKERS_AI_MODEL = os.getenv("WORKERS_AI_MODEL", "@cf/zai-org/glm-5.3-flash")  # verificado 2026-10-12: ~9x más barato que glm-5.3
WORKERS_AI_MODEL_FAST = os.getenv("WORKERS_AI_MODEL_FAST", WORKERS_AI_MODEL)
WORKERS_AI_URL = os.getenv("WORKERS_AI_URL", "")     # base OpenAI-compatible, p. ej. https://vigia-llm.<cuenta>.workers.dev/v1
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-5-5")
_SOLO_GEMINI = ("google_search", "url_context", "google_maps", "code_execution", "vertex_ai_search")


def _bool_env(nombre: str):
    raw = os.getenv(nombre)
    if raw is None or raw.strip() == "":
        return None
    return raw.strip().lower() in _VERDADERO


def usa_busqueda_gemini(tools) -> bool:
    """True si alguna tool es del grounding/servidor de Gemini (no funciona con otros modelos)."""
    for t in tools or []:
        if getattr(t, "_propia", False):
            continue
        nombre = str(getattr(t, "name", "") or getattr(t, "__name__", "") or type(t).__name__).lower()
        if any(k in nombre for k in _SOLO_GEMINI):
            return True
    return False


def proveedor_para(agente: str, tools=None) -> str:
    """'gcp' (Gemini en Vertex), 'cloudflare' (Workers AI) o 'anthropic' (Claude) para ese agente.
    Orden: tools solo-Gemini → gcp; interruptor puntual (USAR_ANTHROPIC_<AGENTE>, luego USAR_WORKERS_AI_<AGENTE>);
    interruptor global (USAR_ANTHROPIC, luego USAR_WORKERS_AI); si no, gcp.
    Sin URL/clave del proveedor no hay a dónde llamar → gcp (nunca se rompe un agente por falta de config)."""
    if usa_busqueda_gemini(tools):
        return "gcp"
    k = _env_key(agente)
    hay_cf, hay_an = bool(WORKERS_AI_URL), bool(os.getenv("ANTHROPIC_API_KEY"))
    for proveedor, hay, nombre in (("anthropic", hay_an, f"USAR_ANTHROPIC_{k}"), ("cloudflare", hay_cf, f"USAR_WORKERS_AI_{k}")):
        puntual = _bool_env(nombre)
        if puntual is not None:
            return proveedor if (puntual and hay) else "gcp"
    for proveedor, hay, nombre in (("anthropic", hay_an, "USAR_ANTHROPIC"), ("cloudflare", hay_cf, "USAR_WORKERS_AI")):
        if hay and _bool_env(nombre):
            return proveedor
    return "gcp"


def resolver_modelo(modelo, agente: str, tools=None):
    """Lo que se pasa a `Agent(model=...)`: el id de Gemini tal cual, o un `LiteLlm` hacia Workers AI / Anthropic."""
    proveedor = proveedor_para(agente, tools)
    if proveedor == "gcp":
        return modelo
    try:
        from google.adk.models.lite_llm import LiteLlm  # noqa: F401
    except Exception as e:  # sin litellm instalado: cae a Gemini en vez de romper
        print(f"[models] {proveedor} pedido para {agente} pero falta litellm ({e}); uso Gemini", flush=True)
        return modelo
    if proveedor == "anthropic":
        # LiteLLM le pone a Anthropic un tope de salida bajo (~4 k) y el JSON final de agentes como entity_personnel o
        # legal quedaba cortado (finish MAX_TOKENS → "output_key ausente", medido 2026-10-12): se fija uno amplio.
        extra = {"max_tokens": int(os.getenv("ANTHROPIC_MAX_TOKENS", "32000"))}
        if os.getenv("ANTHROPIC_REASONING"):
            extra["reasoning_effort"] = os.environ["ANTHROPIC_REASONING"]
        ws = os.getenv("ANTHROPIC_WORKSPACE_ID")  # claves sin workspace propio lo exigen en cada llamada
        if ws:
            extra["extra_headers"] = {"anthropic-workspace-id": ws}
        return _litellm_con_log()(model=f"anthropic/{ANTHROPIC_MODEL}", api_key=os.environ["ANTHROPIC_API_KEY"],
                                  timeout=float(os.getenv("ANTHROPIC_TIMEOUT_S", "240")), **extra)
    rapido = modelo in (_MODEL_FAST, _MODEL_JUDGE)
    cf = WORKERS_AI_MODEL_FAST if rapido else WORKERS_AI_MODEL
    return _litellm_con_log()(model=f"openai/{cf}", api_base=WORKERS_AI_URL, api_key=os.getenv("WORKERS_AI_TOKEN", "sin-token"),
                              timeout=float(os.getenv("WORKERS_AI_TIMEOUT_S", "240")),
                              reasoning_effort=os.getenv("WORKERS_AI_REASONING", "low"))


_LITELLM_LOG = []


def _litellm_con_log():
    """`LiteLlm` que deja en el log el error REAL de Workers AI (LiteLLM solo imprime 'debug this error') y el tiempo
    de cada llamada. Mismo comportamiento que LiteLlm: vuelve a lanzar la excepción."""
    if _LITELLM_LOG:
        return _LITELLM_LOG[0]
    import json as _json
    import time as _time
    from google.adk.models.lite_llm import LiteLlm

    class LiteLlmConLog(LiteLlm):
        async def generate_content_async(self, llm_request, stream: bool = False):
            t0 = _time.time()
            try:
                async for r in super().generate_content_async(llm_request, stream=stream):
                    yield r
            except Exception as e:  # noqa: BLE001
                print(_json.dumps({"_vigia": True, "kind": "workers_ai_error", "modelo": str(self.model),
                                   "segundos": round(_time.time() - t0, 1), "error": f"{type(e).__name__}: {str(e)[:700]}"},
                                  ensure_ascii=False), flush=True)
                raise

    _LITELLM_LOG.append(LiteLlmConLog)
    return LiteLlmConLog


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


def build_planner(agente: str, model, default_level: str | None, tools=None):
    """`BuiltInPlanner` con `thinking_level` (Gemini 3) o `thinking_budget` (2.5, mapeado
    grueso). None si el nivel es None, el modelo no es Gemini o el agente corre en Workers AI."""
    if proveedor_para(agente, tools) == "cloudflare":
        return None
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
            "judge": _MODEL_JUDGE, "output_schema_nativo": OUTPUT_SCHEMA_NATIVO,
            "workers_ai": {"url": bool(WORKERS_AI_URL), "modelo": WORKERS_AI_MODEL, "modelo_fast": WORKERS_AI_MODEL_FAST,
                           "global": bool(_bool_env("USAR_WORKERS_AI"))}}
