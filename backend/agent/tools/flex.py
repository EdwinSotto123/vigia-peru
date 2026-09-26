"""Flex PayGo (Vertex, endpoint global): 50 % menos por token, por llamada y con salida a Standard.

Flex NO reserva capacidad para una corrida: cada request HTTP que lleva el encabezado entra
a una cola de prioridad baja, independiente de las demás (doc de Google, 2026-09: "include
the header in your requests"; cuota aparte de 3000 QPM por modelo; timeout por defecto
10 min, máximo 30; "do not retry aggressively"). Un análisis son decenas de requests
sueltas, así que cualquiera puede tardar más o volver 429 sin que las otras se enteren.

Política (la aplica el patch de `model_fallback` a TODA llamada `generate_content`, de ADK o
directa; embeddings y streaming quedan en Standard):
  1. la llamada va por Flex si GEMINI_FLEX (default 1), el agente no está en GEMINI_FLEX_EXCLUIR y
     no hay corte activo; se espera a Flex GEMINI_FLEX_TIMEOUT_S (150 s, ver timeout_flex_ms);
  2. si Flex falla por capacidad o tiempo (429, 503, 504, 499, timeout) o rechaza el modo, se
     repite UNA vez en Standard, mismo modelo y sin espera: el paso del pipeline no se pierde;
  3. cortacircuito del proceso: GEMINI_FLEX_FALLAS fallas en GEMINI_FLEX_VENTANA_S → todo en
     Standard durante GEMINI_FLEX_PAUSA_S (la capacidad de Flex es de Google, no del análisis);
  4. corte por corrida: pasados GEMINI_FLEX_CORTE_S desde el inicio del análisis, lo que falte
     va por Standard para no rozar el techo de 3600 s de Cloud Run (concurrency 1 → un
     análisis por instancia, por eso basta un estado de módulo).
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque

FLEX_HEADERS = {"X-Vertex-AI-LLM-Shared-Request-Type": "flex"}
_CLAVE = "X-Vertex-AI-LLM-Shared-Request-Type"


def _env_num(nombre: str, default: float) -> float:
    try:
        return float(os.getenv(nombre, "") or default)
    except ValueError:
        return float(default)


def flex_activo() -> bool:
    """Flex es el modo por defecto; GEMINI_FLEX=0 lo apaga sin tocar código."""
    return os.getenv("GEMINI_FLEX", "1").strip().lower() not in ("0", "false", "no", "off")


def timeout_flex_ms() -> int:
    """Cuánto se espera a Flex antes de repetir la llamada en Standard (timeout del cliente y
    X-Server-Timeout; una llamada con timeout propio mayor, como el extractor, conserva el suyo).
    Default 150 s. Medido 2026-09-26:
      · en Standard, 6 de ~2.170 llamadas de agentes en 21 días pasaron de 120 s (p99 del
        redactor 138 s);
      · en Flex la cola suma ~5-7 s a 3.6 Flash, pero la llamada del redactor de 1221293 esperó
        603 s sin respuesta y en Standard salió en 28 s.
    Esperar los 10 min por defecto de Google alargaba el análisis de ~5 a 15 min."""
    return int(_env_num("GEMINI_FLEX_TIMEOUT_S", 150) * 1000)


def _excluidos() -> set[str]:
    """Agentes ADK que van siempre por Standard (GEMINI_FLEX_EXCLUIR=report_writer_agent,…).
    ADK marca cada request con la etiqueta `adk_agent_name`."""
    return {a.strip() for a in os.getenv("GEMINI_FLEX_EXCLUIR", "").split(",") if a.strip()}


# ── Estado del proceso ─────────────────────────────────────────────────────────
_LOCK = threading.Lock()
_FALLAS: deque = deque(maxlen=50)
_ESTADO = {"pausa_hasta": 0.0, "corrida_t0": None, "escapes_corrida": 0, "flex_corrida": 0}


def iniciar_corrida() -> None:
    """Marca el inicio de un análisis (lo llama el driver del pipeline)."""
    with _LOCK:
        _ESTADO.update(corrida_t0=time.monotonic(), escapes_corrida=0, flex_corrida=0)


def resumen_corrida() -> dict:
    """Llamadas que fueron por Flex y cuántas escaparon a Standard en la corrida actual."""
    with _LOCK:
        return {"flex": _ESTADO["flex_corrida"], "escapes": _ESTADO["escapes_corrida"],
                "pausa_activa": time.monotonic() < _ESTADO["pausa_hasta"]}


def _corte_por_tiempo(ahora: float) -> bool:
    t0 = _ESTADO["corrida_t0"]
    return t0 is not None and (ahora - t0) > _env_num("GEMINI_FLEX_CORTE_S", 1800)


def agente_de(config) -> str:
    """Nombre del agente ADK que hace la llamada (etiqueta `adk_agent_name`), o ''."""
    labels = (config.get("labels") if isinstance(config, dict) else getattr(config, "labels", None)) or {}
    return str(labels.get("adk_agent_name") or "")


def usar_flex_ahora(agente: str = "") -> bool:
    if not flex_activo() or (agente and agente in _excluidos()):
        return False
    ahora = time.monotonic()
    with _LOCK:
        return ahora >= _ESTADO["pausa_hasta"] and not _corte_por_tiempo(ahora)


def registrar_uso() -> None:
    with _LOCK:
        _ESTADO["flex_corrida"] += 1


def registrar_falla() -> bool:
    """Anota una falla de Flex; devuelve True si con ella se abrió el cortacircuito."""
    ahora = time.monotonic()
    ventana = _env_num("GEMINI_FLEX_VENTANA_S", 600)
    with _LOCK:
        _ESTADO["escapes_corrida"] += 1
        _FALLAS.append(ahora)
        recientes = sum(1 for t in _FALLAS if ahora - t <= ventana)
        if recientes >= _env_num("GEMINI_FLEX_FALLAS", 3) and ahora >= _ESTADO["pausa_hasta"]:
            _ESTADO["pausa_hasta"] = ahora + _env_num("GEMINI_FLEX_PAUSA_S", 900)
            return True
    return False


def es_falla_flex(exc: BaseException) -> bool:
    """Fallas que se arreglan repitiendo en Standard: sin capacidad (429/503), tiempo agotado o
    el modo Flex rechazado. Medido 2026-09-26: al vencer el timeout Vertex responde
    504 DEADLINE_EXCEEDED o 499 CANCELLED; un timeout < 6 s da 400 "server timeout must be at
    least 6 seconds"."""
    nombre = type(exc).__name__.lower()
    s = str(exc)
    ls = s.lower()
    return (
        "timeout" in nombre or "timed out" in ls or "timeout" in ls
        or "429" in s or "resource_exhausted" in ls
        or "503" in s or "unavailable" in ls
        or "504" in s or "deadline" in ls or "499" in s or "cancelled" in ls
        or "flex" in ls or "shared-request-type" in ls or "shared request type" in ls
    )


# ── Config por llamada ─────────────────────────────────────────────────────────
def _http_options(config):
    if config is None:
        return None
    if isinstance(config, dict):
        return config.get("http_options")
    return getattr(config, "http_options", None)


def con_flex(config):
    """Copia de `config` con el encabezado de Flex y su timeout (el mayor entre el propio y
    GEMINI_FLEX_TIMEOUT_S). No muta el original: el reintento en Standard lo reusa tal cual."""
    from google.genai import types

    ho = _http_options(config)
    if isinstance(ho, dict):
        ho = types.HttpOptions(**ho)
    headers = dict(getattr(ho, "headers", None) or {})
    headers.update(FLEX_HEADERS)
    timeout = max(int(getattr(ho, "timeout", None) or 0), timeout_flex_ms())
    nuevo_ho = ho.model_copy(update={"headers": headers, "timeout": timeout}) if ho is not None \
        else types.HttpOptions(headers=headers, timeout=timeout)
    if config is None:
        return types.GenerateContentConfig(http_options=nuevo_ho)
    if isinstance(config, dict):
        return {**config, "http_options": nuevo_ho}
    return config.model_copy(update={"http_options": nuevo_ho})


def es_flex(config) -> bool:
    ho = _http_options(config)
    headers = (ho.get("headers") if isinstance(ho, dict) else getattr(ho, "headers", None)) or {}
    return str(headers.get(_CLAVE, "")).lower() == "flex"


def _reiniciar_para_tests() -> None:
    with _LOCK:
        _FALLAS.clear()
        _ESTADO.update(pausa_hasta=0.0, corrida_t0=None, escapes_corrida=0, flex_corrida=0)
