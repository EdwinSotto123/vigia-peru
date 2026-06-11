"""
Arize AI · Observabilidad del pipeline agéntico de Vigía Perú.

Inyecta tracing OpenTelemetry en:
  · cada llamada a Gemini (input/output/tokens/latency)
  · cada sub-agente del ADK (compliance, parser, market, etc.)
  · cada tool custom decorada con @vigia_trace

Las traces se exportan a Arize Cloud (Phoenix UI). El project_name `vigia-peru`
agrupa todos los runs por OCID.

Setup en Cloud Run:
  ARIZE_API_KEY    = ak-... (secret)
  ARIZE_SPACE_ID   = U3BhY2U6... (secret)
  ARIZE_PROJECT    = vigia-peru (opcional)

Si las env vars no están seteadas, el módulo NO falla — solo loggea un warning
y sigue sin observabilidad. Esto permite seguir testeando local sin Arize.
"""

from __future__ import annotations

import os
import functools
from typing import Any, Callable

_INITIALIZED = False
_TRACER_PROVIDER: Any = None
_TRACER: Any = None


def init_arize_tracing() -> bool:
    """Inicializa el exporter de Arize. Devuelve True si quedó activo.

    Idempotente: solo registra el provider una vez por process.
    """
    global _INITIALIZED, _TRACER_PROVIDER, _TRACER
    if _INITIALIZED:
        return _TRACER_PROVIDER is not None

    api_key = os.getenv("ARIZE_API_KEY")
    space_id = os.getenv("ARIZE_SPACE_ID")
    project = os.getenv("ARIZE_PROJECT", "vigia-peru")

    if not api_key or not space_id:
        print(
            "[arize] ARIZE_API_KEY o ARIZE_SPACE_ID no configurados — "
            "tracing deshabilitado.",
            flush=True,
        )
        _INITIALIZED = True
        return False

    try:
        from arize.otel import register  # type: ignore
        _TRACER_PROVIDER = register(
            space_id=space_id,
            api_key=api_key,
            project_name=project,
        )
        # Dual-export: además de Arize AX, enviamos las trazas a Phoenix Cloud.
        # El track del hackathon usa Phoenix + su MCP server para que el agente
        # introspeccione sus propias trazas en runtime. Mismo OpenInference,
        # segundo destino. Si las env no están, no pasa nada.
        _phx_key = os.getenv("PHOENIX_API_KEY")
        _phx_ep = os.getenv("PHOENIX_COLLECTOR_ENDPOINT")
        if _phx_key and _phx_ep:
            try:
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                    OTLPSpanExporter as _PhxExporter,
                )
                from opentelemetry.sdk.trace.export import BatchSpanProcessor as _PhxBSP
                _TRACER_PROVIDER.add_span_processor(
                    _PhxBSP(_PhxExporter(
                        endpoint=_phx_ep,
                        headers={"Authorization": f"Bearer {_phx_key}"},
                    ))
                )
                print(f"[arize] dual-export a Phoenix Cloud ACTIVO · {_phx_ep}", flush=True)
            except Exception as e:
                print(f"[arize] Phoenix export no configurado: {type(e).__name__}: {e}", flush=True)
        # Instrumentar el SDK de Gemini → captura cada call (Pro, Flash, etc.)
        try:
            from openinference.instrumentation.google_genai import (  # type: ignore
                GoogleGenAIInstrumentor,
            )
            GoogleGenAIInstrumentor().instrument(tracer_provider=_TRACER_PROVIDER)
            print(f"[arize] Gemini instrumentado · project={project}", flush=True)
        except ImportError:
            print(
                "[arize] openinference-instrumentation-google-genai no instalado "
                "— traces de Gemini deshabilitadas.",
                flush=True,
            )

        # Instrumentar el Runner del ADK → spans NATIVOS de la orquestación:
        # el ciclo del agente, cada `transfer_to_agent` (la coreografía entre los
        # 11 sub-agentes) y las tool calls a nivel ADK. Complementa al instrumentor
        # de google-genai (que captura las llamadas a Gemini). En Phoenix se ve la
        # jerarquía completa coordinator → sub-agente → tool.
        try:
            from openinference.instrumentation.google_adk import (  # type: ignore
                GoogleADKInstrumentor,
            )
            GoogleADKInstrumentor().instrument(tracer_provider=_TRACER_PROVIDER)
            print(f"[arize] ADK Runner instrumentado · project={project}", flush=True)
        except ImportError:
            print(
                "[arize] openinference-instrumentation-google-adk no instalado "
                "— spans de orquestación ADK (transfer/runner) deshabilitados.",
                flush=True,
            )

        # Tracer para spans manuales (tools custom)
        from opentelemetry import trace  # type: ignore
        _TRACER = trace.get_tracer("vigia-peru", tracer_provider=_TRACER_PROVIDER)
        print(
            f"[arize] tracing ACTIVO · project={project} · space={space_id[:12]}…",
            flush=True,
        )
        _INITIALIZED = True
        return True
    except Exception as e:
        print(f"[arize] init fallido: {type(e).__name__}: {e}", flush=True)
        _INITIALIZED = True
        return False


def get_tracer():
    """Devuelve el tracer OTel (o un no-op si no se inicializó)."""
    if not _INITIALIZED:
        init_arize_tracing()
    return _TRACER


def force_flush_tracing(timeout_millis: int = 20000) -> None:
    """Fuerza el flush de los span processors (Arize AX + Phoenix Cloud).

    CRÍTICO en serverless: el span raíz `vigia_analysis` cierra al FINAL del
    análisis, justo antes de que la instancia de Cloud Run se congele. El
    BatchSpanProcessor exporta en un hilo de fondo cada ~5 s, así que sin un
    flush explícito el span raíz (y sus métricas `vigia.*`) NUNCA llega a
    Arize/Phoenix. Llamar esto tras cerrar el span raíz y antes de responder.
    """
    if _TRACER_PROVIDER is None:
        return
    try:
        _TRACER_PROVIDER.force_flush(timeout_millis)
        print("[arize] force_flush OK · spans empujados a AX + Phoenix", flush=True)
    except Exception as e:
        print(f"[arize] force_flush falló: {type(e).__name__}: {e}", flush=True)


def vigia_trace(name: str | None = None, attrs: dict | None = None):
    """Decorator para envolver una tool/función con una span OTel.

    Ejemplo:
        @vigia_trace("batch_person_lookup")
        def batch_person_lookup(personas, tool_context):
            ...

    Si Arize no está inicializado, es un no-op (cero overhead).
    """
    def _wrap(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def _inner(*args, **kwargs):
            tracer = get_tracer()
            if tracer is None:
                return fn(*args, **kwargs)
            span_name = name or fn.__name__
            with tracer.start_as_current_span(span_name) as span:
                if attrs:
                    for k, v in attrs.items():
                        try:
                            span.set_attribute(k, v)
                        except Exception:
                            pass
                # Atributos genéricos útiles para filtrar en Arize
                span.set_attribute("vigia.tool", fn.__name__)
                try:
                    result = fn(*args, **kwargs)
                    # Marcar status OK + atributos del resultado si es dict
                    if isinstance(result, dict):
                        for key in ("n_personas", "n_queries_ejecutadas",
                                    "duracion_ms", "found", "ok", "score"):
                            if key in result:
                                try:
                                    span.set_attribute(f"vigia.result.{key}", result[key])
                                except Exception:
                                    pass
                    return result
                except Exception as e:
                    span.record_exception(e)
                    raise
        return _inner
    return _wrap


def set_session_attrs(ocid: str | None = None, **extra) -> None:
    """Setea atributos en la span activa para identificar la sesión actual.

    Útil al inicio de cada análisis para que Arize agrupe la trace por OCID.
    """
    tracer = get_tracer()
    if tracer is None:
        return
    try:
        from opentelemetry import trace  # type: ignore
        span = trace.get_current_span()
        if ocid:
            span.set_attribute("vigia.ocid", ocid)
        for k, v in extra.items():
            try:
                span.set_attribute(f"vigia.{k}", v)
            except Exception:
                pass
    except Exception:
        pass
