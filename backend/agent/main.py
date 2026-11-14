"""
agent-orchestrator-adk · Cloud Function HTTP que corre el agente ADK real.

Endpoint:
  POST /
  Body: {
    "input": "1203694",                           // código o OCID
    "ocds": { ...compiledRelease... },            // pre-fetched para evitar WAF
    "docs_b64": { url: base64, ... },             // PDFs pre-cargados (mismo motivo)
    "clasificacion": {                            // opcional (dispatcher): matriz tipo × etapa
      "tipo": "bienes", "etapa": "convocada",     //   (backend/core/clasificacion.py)
      "agentes": ["compliance", ...],             //   solo estos sub-agentes corren
      "validaciones_pendientes": ["infobras_avance"]  // el dictamen las lista, sin inventar
    },                                            // sin `clasificacion` → corren TODOS (análisis a demanda)
    "doc_ids": ["..."]                            // opcional: restringe el lote de documentos a estos ids
  }

  Perfil del servicio: env PIPELINE_PROFILE=bienes|servicios|obras|otros
  (agents/_shared/profiles.py). Si `clasificacion.tipo` no es del perfil → HTTP 409
  {error:"tipo_no_aceptado", perfil, tipo} (evento NDJSON `error` con ?stream=1).
  GET / (sin action) → {ok, perfil, modelos}.

Response:
  {
    "session_id": "...",
    "events": [                                   // trace del agent loop
      { "agent": "vigia_orchestrator", "kind": "tool_call",  "name": "fetch_ocds_record", "args": {...}, "result": {...} },
      { "agent": "vigia_orchestrator", "kind": "transfer",   "to": "document_parser_agent" },
      { "agent": "document_parser_agent", "kind": "tool_call", "name": "parse_document_pdf", ... },
      ...
    ],
    "final_response": "...",                      // mensaje final del orquestador
    "state": { "alerta_codigo": "...", "dictamen": "...", "banderas": [...] }
  }

Organización del módulo (ver también main_stream.py/main_queries.py): este archivo es SOLO
el entrypoint HTTP — `orchestrate` es el `--target` que arranca functions-framework (ver
Dockerfile: `functions-framework --target=orchestrate`, sin `--source`, así que DEBE seguir
siendo un atributo de nivel-módulo de `main.py`, aunque el resto del contenido se mudó). La
corrida del agente (streaming + safety-net + self-eval) vive en main_stream.py; las consultas
de solo-lectura para GET (list/load/random) en main_queries.py. `main_stream` se importa ACÁ
antes que cualquier otra cosa relacionada a Gemini: ese import dispara, en el orden correcto,
el patch de `model_fallback` + `init_arize_tracing()` (ver el comentario detallado en
main_stream.py) — invertir ese orden rompe la instrumentación de Arize.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

# Pocas arenas de malloc antes de que arranquen los hilos: con una por hilo, la memoria de leer documentos grandes queda
# fragmentada y retenida en el contenedor de Lambda (MALLOC_ARENA_MAX=2 del Dockerfile.lambda sólo llega al rehacer la
# base). M_ARENA_MAX = -8 en glibc.
try:
    import ctypes as _ctypes
    _ctypes.CDLL("libc.so.6").mallopt(-8, int(os.getenv("MALLOC_ARENA_MAX", "2")))
except (OSError, AttributeError, ValueError):
    pass

import functions_framework

from main_stream import _run, _run_streaming
from main_queries import _list_analyzed, _load_analyzed, _random_convocatoria

from agents._shared.profiles import acepta, get_profile, perfil_para_tipo
from agents._shared.models import modelos_activos


PROFILE = get_profile()

# Cada cuánto se escribe un `{"kind": "latido"}` si la corrida no emitió nada: el analista legal o el escritor pasan
# minutos sin eventos, y en la prueba de oro del 2026-11-10 dos corridas terminaron bien en la Lambda (574 s) pero el
# cliente nunca recibió el `final` y esperó 40 min. El dispatcher y ab_modelos ignoran los tipos que no conocen.
LATIDO_S = float(os.getenv("STREAM_LATIDO_S", "20"))


def _ndjson_con_latidos(fuente, latido_s: float | None = None):
    """Corre el generador asíncrono `fuente()` en un hilo y devuelve sus eventos como líneas NDJSON, con un latido
    cada `latido_s` segundos de silencio."""
    import queue as _queue
    import threading
    import time as _time

    espera = LATIDO_S if latido_s is None else latido_s
    q: "_queue.Queue[Any]" = _queue.Queue(maxsize=512)
    fin = object()

    def _worker():
        async def _async():
            try:
                async for ev in fuente():
                    q.put(ev)
            except Exception as ex:  # noqa: BLE001
                q.put({"kind": "error", "detail": str(ex)[:400]})
            finally:
                q.put(fin)
        asyncio.run(_async())

    threading.Thread(target=_worker, daemon=True).start()
    _t0_flujo = _time.time()
    while True:
        try:
            ev = q.get(timeout=espera) if espera and espera > 0 else q.get()
        except _queue.Empty:
            yield json.dumps({"kind": "latido", "ts": round(_time.time(), 1)}) + "\n"
            continue
        if ev is fin:
            break
        try:
            if isinstance(ev, dict) and "t" not in ev:
                ev["t"] = round(_time.time() - _t0_flujo, 1)
            yield json.dumps(ev, ensure_ascii=False, default=str) + "\n"
        except Exception as ex:  # noqa: BLE001
            yield json.dumps({"kind": "error", "detail": str(ex)[:200]}) + "\n"


def _rss_mb() -> int:
    try:
        with open("/proc/self/status", encoding="ascii") as f:
            for linea in f:
                if linea.startswith("VmRSS:"):
                    return int(linea.split()[1]) // 1024
    except (OSError, ValueError):
        pass
    return -1


def _liberar_memoria(etiqueta: str) -> None:
    """Devuelve al sistema la memoria del análisis que terminó. En Lambda el contenedor se reusa y el pico de leer
    documentos grandes quedaba retenido: 2026-11-10 obras llegó a 3 004 de 3 008 MB y el análisis siguiente murió
    con Runtime.OutOfMemory. Corre después del último evento, antes de cerrar la respuesta."""
    import gc
    antes = _rss_mb()
    gc.collect()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass
    print(json.dumps({"_vigia": True, "kind": "memoria", "ocid": str(etiqueta)[:40], "rss_antes_mb": antes,
                      "rss_despues_mb": _rss_mb()}), flush=True)


@functions_framework.http
def orchestrate(request):
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    if request.method == "OPTIONS":
        return ("", 204, cors)

    # Fuera de Cloud Run (p. ej. Lambda con Function URL pública) no hay IAM delante: AGENTE_TOKEN exige
    # `Authorization: Bearer <token>`. Sin la variable no cambia nada.
    token = os.getenv("AGENTE_TOKEN")
    if token:
        import hmac
        dado = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(dado.encode(), token.encode()):
            return (json.dumps({"error": "no autorizado"}), 401, {"Content-Type": "application/json", **cors})

    # GET routing: sin action → health con perfil y modelos; ?action=list|load|random
    if request.method == "GET":
        action = request.args.get("action")
        if not action:
            return (json.dumps({"ok": True, "perfil": PROFILE.nombre,
                                "tipos_aceptados": sorted(PROFILE.tipos_aceptados),
                                "agentes": list(PROFILE.agentes),
                                "market_estrategia": PROFILE.market_estrategia,
                                "modelos": modelos_activos(),
                                "deterministic": os.getenv("DETERMINISTIC_PIPELINE", "1") != "0"},
                               ensure_ascii=False), 200,
                    {"Content-Type": "application/json; charset=utf-8", **cors})
        try:
            if action == "list":
                limit = int(request.args.get("limit", "20"))
                result = _list_analyzed(limit=min(limit, 100))
            elif action == "load":
                ocid = (request.args.get("ocid") or "").strip()
                if not ocid:
                    return (json.dumps({"error": "missing 'ocid'"}), 400,
                            {"Content-Type": "application/json", **cors})
                result = _load_analyzed(ocid)
            elif action == "random":
                excluir = request.args.get("excluir_analizadas", "1") != "0"
                result = _random_convocatoria(excluir_analizadas=excluir)
            else:
                return (json.dumps({"error": f"unknown action: {action}"}), 400,
                        {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "query_failed", "detail": str(e)[:200]}),
                    500, {"Content-Type": "application/json", **cors})
        return (json.dumps(result, ensure_ascii=False, default=str), 200,
                {"Content-Type": "application/json; charset=utf-8", **cors})

    # POST: run agent
    body = request.get_json(silent=True) or {}

    # ── ADMIN (one-shot): poblar embeddings del RAG legal en pgvector ──
    if body.get("admin_action") == "build_legal_embeddings":
        try:
            from tools.legal import build_legal_embeddings
            res = build_legal_embeddings()
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "build_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    # ── ADMIN: probar el RAG legal (dispatcher: Vertex + fallback pgvector) ──
    if body.get("admin_action") == "test_legal_rag":
        try:
            from tools.legal import query_legal_rag
            res = query_legal_rag(body.get("question") or "único postor gana al 100% del valor referencial", None)
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "test_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    # ── ADMIN (one-shot): ingestar las opiniones OECE a Vertex AI Search ──
    if body.get("admin_action") == "ingest_opinions_to_vertex_search":
        try:
            from tools.legal import ingest_opinions_to_vertex_search
            res = ingest_opinions_to_vertex_search()
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "ingest_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    # ── ADMIN: probar SOLO el backend Vertex AI Search (sin fallback) ──
    if body.get("admin_action") == "test_legal_rag_vertex":
        try:
            from tools.legal import query_legal_rag_vertex
            res = query_legal_rag_vertex(body.get("question") or "adenda mayor al 25% del monto original")
            return (json.dumps(res, ensure_ascii=False, default=str), 200,
                    {"Content-Type": "application/json", **cors})
        except Exception as e:
            return (json.dumps({"error": "test_failed", "detail": str(e)[:500]}),
                    500, {"Content-Type": "application/json", **cors})

    input_str = (body.get("input") or "").strip()
    if not input_str:
        return (json.dumps({"error": "missing 'input'"}), 400,
                {"Content-Type": "application/json", **cors})

    _es_stream = request.args.get("stream") in ("1", "true", "yes")

    # ── Gate por perfil: este servicio solo analiza los tipos de su PIPELINE_PROFILE.
    #    Sin `clasificacion` (o sin tipo) → acepta (análisis a demanda del admin).
    _tipo_req = None
    if isinstance(body.get("clasificacion"), dict):
        _tipo_req = body["clasificacion"].get("tipo")
    if not acepta(PROFILE, _tipo_req):
        _rechazo = {"error": "tipo_no_aceptado", "perfil": PROFILE.nombre, "tipo": _tipo_req,
                    "perfil_correcto": perfil_para_tipo(_tipo_req)}
        if _es_stream:
            from flask import Response  # type: ignore
            _line = json.dumps({"kind": "error", "agent": "pipeline", "error_kind": "tipo_no_aceptado",
                                "detail": f"perfil {PROFILE.nombre} no acepta tipo {_tipo_req!r}", **_rechazo},
                               ensure_ascii=False) + "\n"
            return Response(_line, status=409,
                            headers={"Content-Type": "application/x-ndjson; charset=utf-8", **cors})
        return (json.dumps(_rechazo, ensure_ascii=False), 409,
                {"Content-Type": "application/json; charset=utf-8", **cors})

    # ── STREAMING MODE: ?stream=1 → NDJSON line-per-event ──
    # Cada línea es un JSON con `{kind, ...}`. La última tiene `kind: "final"`.
    if _es_stream:
        ocds_p = body.get("ocds")
        docs_b64_p = body.get("docs_b64")
        doc_urls_p = body.get("doc_urls")
        clas_p = body.get("clasificacion")
        doc_ids_p = body.get("doc_ids")

        def _generate():
            yield from _ndjson_con_latidos(
                lambda: _run_streaming(input_str, ocds_p, docs_b64_p, doc_urls_p, clas_p, doc_ids_p))
            _liberar_memoria(input_str)

        from flask import Response  # type: ignore
        return Response(
            _generate(),
            status=200,
            headers={
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",  # nginx: disable buffering
                **cors,
            },
        )

    try:
        result = asyncio.run(_run(
            input_str,
            body.get("ocds"),
            body.get("docs_b64"),
            body.get("doc_urls"),
            body.get("clasificacion"),
            body.get("doc_ids"),
        ))
    except Exception as e:
        return (json.dumps({"error": "runner_failed", "detail": str(e)}),
                500, {"Content-Type": "application/json", **cors})

    return (
        json.dumps(result, ensure_ascii=False),
        200,
        {"Content-Type": "application/json; charset=utf-8", **cors},
    )
