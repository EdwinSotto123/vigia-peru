"""
Monkey-patch del SDK genai — Fallback automático en 503 UNAVAILABLE.

Cuando Google satura un modelo (Pro nuevo o Flash en hora pico) devuelve 503
inmediato. El SDK por default hace retries cortos y luego raise → ADK propaga
como crash del agent loop. Este patch reintenta con backoff y cambia de modelo
según `_FALLBACK_CHAIN`.

Se aplica al IMPORTAR este módulo (idempotente, guard `_vigia_patched`).

También decide Flex PayGo POR LLAMADA (tools/flex.py): pone el encabezado y, si Flex no atiende
(429/503/504/499/timeout), repite esa misma llamada en Standard antes de cualquier backoff.

Es la ÚNICA capa de reintentos del pipeline (los raw calls de tools/_core.py ya no
apilan la suya): cada llamada tiene un techo TOTAL `GEMINI_CALL_DEADLINE_S` (default 600 s)
que acota reintentos + saltos de modelo; superado el techo se propaga el último error.
"""
from __future__ import annotations

import asyncio as _asyncio
import json as _json_mp
import os as _os_mp
import random as _random_mp
import time as _time_mp


# Verificado 2026-09-26 (Vertex global): 3.6-flash, 3.8-flash y 3.5-flash-lite responden.
# Sin gemini-2.5-* en las cadenas: Vertex los retira el 2026-10-20. 3.5-flash va al final
# porque cuesta el doble que 3.6-flash (USD 1,50/9,00 contra 0,75/3,75 por M de tokens);
# 3.8-flash cuesta lo mismo que 3.6 pero no acepta thinking_level=minimal (ver _config_para).
# 3.6-pro / 3.5-pro / 3.6-flash-lite NO existen (404) → nunca en las cadenas.
_FALLBACK_CHAIN = {
    "gemini-3.6-flash":       ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    "gemini-3.8-flash":       ["gemini-3.6-flash", "gemini-3.5-flash-lite"],
    "gemini-3.5-flash":       ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"],
    "gemini-3.5-flash-lite":  ["gemini-3.6-flash", "gemini-3.8-flash"],
    # Nombres viejos que algún env o script todavía pida: se reencaminan a la familia 3.
    "gemini-2.5-pro":         ["gemini-3.6-flash", "gemini-3.8-flash"],
    "gemini-2.5-flash":       ["gemini-3.6-flash", "gemini-3.5-flash-lite"],
    "gemini-2.5-flash-lite":  ["gemini-3.5-flash-lite", "gemini-3.6-flash"],
}

_RETRY_DELAYS = [10, 20, 40, 80]  # segundos por attempt
_MAX_FALLBACK_HOPS = 3            # cuántos modelos distintos probamos antes de raise


def _deadline_s() -> float:
    """Techo TOTAL (segundos) por llamada a generate_content: reintentos + saltos de modelo."""
    try:
        return float(_os_mp.getenv("GEMINI_CALL_DEADLINE_S", "600"))
    except ValueError:
        return 600.0


def _next_wait(t0: float, delay: float):
    """Espera (con jitter) para el próximo intento, o None si excedería el deadline."""
    jitter = _random_mp.uniform(0, 3)
    wait_s = delay + jitter
    if (_time_mp.monotonic() - t0) + wait_s >= _deadline_s():
        return None
    return wait_s


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


def _modelo_no_disponible(exc) -> bool:
    """404/400 porque el modelo no existe o fue retirado: no tiene sentido reintentar el
    mismo, se salta directo al siguiente de la cadena."""
    ls = str(exc).lower()
    return (("404" in ls or "not_found" in ls or "not found" in ls or "400" in ls)
            and ("model" in ls or "publisher" in ls)
            and ("not found" in ls or "was not found" in ls or "retired" in ls
                 or "is not supported" in ls or "does not exist" in ls))


def _config_para(model, config):
    """3.7/3.8-flash rechazan thinking_level=minimal (400): al saltar a ellos se sube a low.
    Devuelve el config original si no hace falta tocarlo."""
    try:
        m = str(model or "").lower()
        if not any(v in m for v in ("gemini-3.7", "gemini-3.8")) or config is None:
            return config
        tc = getattr(config, "thinking_config", None)
        nivel = str(getattr(tc, "thinking_level", "") or "").lower() if tc else ""
        if not nivel.endswith("minimal"):
            return config
        nuevo_tc = tc.model_copy(update={"thinking_level": "low"})
        return config.model_copy(update={"thinking_config": nuevo_tc})
    except Exception:
        return config


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



def _flex():
    """Módulo de política Flex (tools/flex.py); None si no se puede importar (scripts sueltos)."""
    try:
        from tools import flex as _f  # type: ignore
        return _f
    except Exception:
        return None


def _con_flex_o_escape(flex_estado, model, config, llamar):
    """Una llamada: por Flex si toca y, si Flex falla por capacidad/tiempo, la MISMA llamada en
    Standard al instante. `llamar(cfg)` hace la request; `flex_estado["on"]` pasa a False tras el
    primer escape para que los reintentos de esta llamada ya no vuelvan a Flex."""
    f = flex_estado.get("mod")
    if flex_estado.get("on") and f is not None:
        try:
            resp = llamar(_config_para(model, f.con_flex(config)))
            f.registrar_uso()
            return resp
        except Exception as e:
            if not f.es_falla_flex(e):
                raise
            flex_estado["on"] = False
            abierto = f.registrar_falla()
            _mp_log(kind="flex_escape", model=model, tipo=type(e).__name__, error=str(e)[:200],
                    cortacircuito=abierto)
    return llamar(_config_para(model, config))


async def _con_flex_o_escape_async(flex_estado, model, config, llamar):
    """Versión async de `_con_flex_o_escape` (ADK)."""
    f = flex_estado.get("mod")
    if flex_estado.get("on") and f is not None:
        try:
            resp = await llamar(_config_para(model, f.con_flex(config)))
            f.registrar_uso()
            return resp
        except Exception as e:
            if not f.es_falla_flex(e):
                raise
            flex_estado["on"] = False
            abierto = f.registrar_falla()
            _mp_log(kind="flex_escape", model=model, tipo=type(e).__name__, error=str(e)[:200],
                    cortacircuito=abierto)
    return await llamar(_config_para(model, config))


def _estado_flex(config=None):
    f = _flex()
    return {"mod": f, "on": bool(f and f.usar_flex_ahora(f.agente_de(config)))}


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
            flex_estado = _estado_flex(config)
            tried = []
            current = model
            last_exc = None
            t0 = _time_mp.monotonic()
            agotado = False

            for hop in range(_MAX_FALLBACK_HOPS + 1):
                for attempt, delay in enumerate(_RETRY_DELAYS):
                    try:
                        if hop > 0 or attempt > 0:
                            _mp_log(kind="model_call_try", model=current, hop=hop, attempt=attempt)
                        _m = current
                        return _strip_tool_prefixes(await _con_flex_o_escape_async(
                            flex_estado, _m, config,
                            lambda cfg: _orig_async(self, model=_m, contents=contents, config=cfg, **kw)))
                    except Exception as e:
                        if _modelo_no_disponible(e):
                            last_exc = e
                            _mp_log(kind="model_unavailable", model=current, error=str(e)[:200])
                            break
                        if not _is_503(e):
                            raise
                        last_exc = e
                        if attempt < len(_RETRY_DELAYS) - 1:
                            wait_s = _next_wait(t0, delay)
                            if wait_s is None:
                                agotado = True
                                break
                            _mp_log(kind="503_retry", model=current, hop=hop, attempt=attempt + 1,
                                    wait_s=round(wait_s, 1))
                            await _asyncio.sleep(wait_s)
                tried.append(current)
                if agotado:
                    break
                chain = _FALLBACK_CHAIN.get(current, [])
                next_model = next((m for m in chain if m not in tried), None)
                if not next_model:
                    break
                _mp_log(kind="503_fallback", from_model=current, to_model=next_model,
                        already_tried=tried)
                current = next_model

            _mp_log(kind="fallback_exhausted", models_tried=tried,
                    elapsed_s=round(_time_mp.monotonic() - t0, 1), deadline_s=_deadline_s())
            raise last_exc if last_exc else RuntimeError("fallback exhausted")

        _async_generate_with_fallback._vigia_patched = True
        AsyncModels.generate_content = _async_generate_with_fallback
        _mp_log(kind="patch_applied", target="AsyncModels.generate_content")

    if Models is not None and not getattr(Models.generate_content, "_vigia_patched", False):
        _orig_sync = Models.generate_content

        def _sync_generate_with_fallback(self, *, model, contents, config=None, **kw):
            flex_estado = _estado_flex(config)
            tried = []
            current = model
            last_exc = None
            t0 = _time_mp.monotonic()
            agotado = False

            for hop in range(_MAX_FALLBACK_HOPS + 1):
                for attempt, delay in enumerate(_RETRY_DELAYS):
                    try:
                        if hop > 0 or attempt > 0:
                            _mp_log(kind="model_call_try_sync", model=current, hop=hop, attempt=attempt)
                        _m = current
                        return _strip_tool_prefixes(_con_flex_o_escape(
                            flex_estado, _m, config,
                            lambda cfg: _orig_sync(self, model=_m, contents=contents, config=cfg, **kw)))
                    except Exception as e:
                        if _modelo_no_disponible(e):
                            last_exc = e
                            _mp_log(kind="model_unavailable_sync", model=current, error=str(e)[:200])
                            break
                        if not _is_503(e):
                            raise
                        last_exc = e
                        if attempt < len(_RETRY_DELAYS) - 1:
                            wait_s = _next_wait(t0, delay)
                            if wait_s is None:
                                agotado = True
                                break
                            _mp_log(kind="503_retry_sync", model=current, hop=hop, attempt=attempt + 1,
                                    wait_s=round(wait_s, 1))
                            _time_mp.sleep(wait_s)
                tried.append(current)
                if agotado:
                    break
                chain = _FALLBACK_CHAIN.get(current, [])
                next_model = next((m for m in chain if m not in tried), None)
                if not next_model:
                    break
                _mp_log(kind="503_fallback_sync", from_model=current, to_model=next_model,
                        already_tried=tried)
                current = next_model

            _mp_log(kind="fallback_exhausted_sync", models_tried=tried,
                    elapsed_s=round(_time_mp.monotonic() - t0, 1), deadline_s=_deadline_s())
            raise last_exc if last_exc else RuntimeError("fallback exhausted")

        _sync_generate_with_fallback._vigia_patched = True
        Models.generate_content = _sync_generate_with_fallback
        _mp_log(kind="patch_applied", target="Models.generate_content")


# Auto-aplicar al importar (idempotente). DEBE correr antes de instanciar Agents.
_apply_gemini_fallback_patch()
