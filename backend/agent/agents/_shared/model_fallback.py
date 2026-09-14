"""
Monkey-patch del SDK genai — Fallback automático en 503 UNAVAILABLE.

Cuando Google satura un modelo (Pro nuevo o Flash en hora pico) devuelve 503
inmediato. El SDK por default hace retries cortos y luego raise → ADK propaga
como crash del agent loop. Este patch reintenta con backoff y cambia de modelo
según `_FALLBACK_CHAIN`.

Se aplica al IMPORTAR este módulo (idempotente, guard `_vigia_patched`).
Extraído textual del agents.py monolítico.
"""
from __future__ import annotations

import asyncio as _asyncio
import json as _json_mp
import random as _random_mp
import time as _time_mp


_FALLBACK_CHAIN = {
    "gemini-2.5-pro":         ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-flash":       ["gemini-3.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    "gemini-3.5-flash":       ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    "gemini-2.5-flash-lite":  ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-pro"],
}

_RETRY_DELAYS = [10, 20, 40, 80]  # segundos por attempt
_MAX_FALLBACK_HOPS = 3            # cuántos modelos distintos probamos antes de raise


def _mp_log(**fields):
    """Log estructurado de eventos del fallback patch."""
    try:
        print(_json_mp.dumps(
            {"_vigia": True, "ts": _time_mp.time(),
             "kind_module": "model_fallback", **fields},
            ensure_ascii=False, default=str,
        ), flush=True)
    except Exception:
        pass


def _is_503(exc) -> bool:
    """Detecta errores transitorios de cuota/disponibilidad que ameritan
    retry + fallback de modelo:
      · 503 UNAVAILABLE  → modelo saturado / high demand
      · 429 RESOURCE_EXHAUSTED → cuota agotada (quota dinámica Vertex AI)
      · 'quota'/'rate limit' en mensaje → variantes documentadas
    """
    s = str(exc)
    ls = s.lower()
    return (
        "503" in s or "UNAVAILABLE" in s or "high demand" in ls
        or "429" in s or "RESOURCE_EXHAUSTED" in s
        or "quota" in ls or "rate limit" in ls or "rate-limit" in ls
        # 500 INTERNAL transitorio de Vertex (visto en person_network_agent):
        # antes NO se reintentaba y abortaba la rama. Ahora sí (con backoff/fallback).
        or "500 internal" in ls or "internal error encountered" in ls
        or "'status': 'internal'" in ls
    )


def _strip_tool_prefixes(resp):
    """Gemini a veces emite el function_call con prefijo de namespace estilo
    código: `default_api.check_plazo_convocatoria_rule`. ADK busca la tool por
    nombre EXACTO → 'Tool not found' y crashea el agent loop. Acá normalizamos:
    si el nombre trae un punto, nos quedamos con el último segmento (las tools
    reales son identificadores sin puntos). No-op si algo falla."""
    try:
        for cand in (getattr(resp, "candidates", None) or []):
            content = getattr(cand, "content", None)
            for part in (getattr(content, "parts", None) or []):
                fc = getattr(part, "function_call", None)
                name = getattr(fc, "name", None) if fc else None
                if name and "." in name:
                    fixed = name.split(".")[-1]
                    try:
                        fc.name = fixed
                        _mp_log(kind="tool_name_normalized", from_name=name, to_name=fixed)
                    except Exception:
                        pass
    except Exception:
        pass
    return resp


def _apply_gemini_fallback_patch():
    """Aplica el monkey-patch. Idempotente — solo se aplica una vez."""
    try:
        from google.genai import models as _genai_models
        from google.genai import errors as _genai_errors  # noqa: F401
    except Exception as e:
        _mp_log(kind="patch_skipped", reason=f"import failed: {e}")
        return

    AsyncModels = getattr(_genai_models, "AsyncModels", None)
    Models = getattr(_genai_models, "Models", None)

    if AsyncModels is not None and not getattr(AsyncModels.generate_content, "_vigia_patched", False):
        _orig_async = AsyncModels.generate_content

        async def _async_generate_with_fallback(self, *, model, contents, config=None, **kw):
            tried = []
            current = model
            last_exc = None

            for hop in range(_MAX_FALLBACK_HOPS + 1):
                for attempt, delay in enumerate(_RETRY_DELAYS):
                    try:
                        if hop > 0 or attempt > 0:
                            _mp_log(kind="model_call_try", model=current, hop=hop, attempt=attempt)
                        return _strip_tool_prefixes(await _orig_async(self, model=current, contents=contents, config=config, **kw))
                    except Exception as e:
                        if not _is_503(e):
                            raise
                        last_exc = e
                        if attempt < len(_RETRY_DELAYS) - 1:
                            jitter = _random_mp.uniform(0, 3)
                            wait_s = delay + jitter
                            _mp_log(kind="503_retry", model=current, hop=hop, attempt=attempt + 1,
                                    wait_s=round(wait_s, 1))
                            await _asyncio.sleep(wait_s)
                tried.append(current)
                chain = _FALLBACK_CHAIN.get(current, [])
                next_model = next((m for m in chain if m not in tried), None)
                if not next_model:
                    break
                _mp_log(kind="503_fallback", from_model=current, to_model=next_model,
                        already_tried=tried)
                current = next_model

            _mp_log(kind="fallback_exhausted", models_tried=tried)
            raise last_exc if last_exc else RuntimeError("fallback exhausted")

        _async_generate_with_fallback._vigia_patched = True
        AsyncModels.generate_content = _async_generate_with_fallback
        _mp_log(kind="patch_applied", target="AsyncModels.generate_content")

    if Models is not None and not getattr(Models.generate_content, "_vigia_patched", False):
        _orig_sync = Models.generate_content

        def _sync_generate_with_fallback(self, *, model, contents, config=None, **kw):
            tried = []
            current = model
            last_exc = None

            for hop in range(_MAX_FALLBACK_HOPS + 1):
                for attempt, delay in enumerate(_RETRY_DELAYS):
                    try:
                        if hop > 0 or attempt > 0:
                            _mp_log(kind="model_call_try_sync", model=current, hop=hop, attempt=attempt)
                        return _strip_tool_prefixes(_orig_sync(self, model=current, contents=contents, config=config, **kw))
                    except Exception as e:
                        if not _is_503(e):
                            raise
                        last_exc = e
                        if attempt < len(_RETRY_DELAYS) - 1:
                            jitter = _random_mp.uniform(0, 3)
                            wait_s = delay + jitter
                            _mp_log(kind="503_retry_sync", model=current, hop=hop, attempt=attempt + 1,
                                    wait_s=round(wait_s, 1))
                            _time_mp.sleep(wait_s)
                tried.append(current)
                chain = _FALLBACK_CHAIN.get(current, [])
                next_model = next((m for m in chain if m not in tried), None)
                if not next_model:
                    break
                _mp_log(kind="503_fallback_sync", from_model=current, to_model=next_model,
                        already_tried=tried)
                current = next_model

            _mp_log(kind="fallback_exhausted_sync", models_tried=tried)
            raise last_exc if last_exc else RuntimeError("fallback exhausted")

        _sync_generate_with_fallback._vigia_patched = True
        Models.generate_content = _sync_generate_with_fallback
        _mp_log(kind="patch_applied", target="Models.generate_content")


# Auto-aplicar al importar (idempotente). DEBE correr antes de instanciar Agents.
_apply_gemini_fallback_patch()
