"""
Orquestación DETERMINISTA del pipeline Vigía.

En vez de que el orquestador-LLM decida (y se rinda antes de terminar) qué
sub-agente llamar, ESTE módulo ejecuta la secuencia fija en CÓDIGO. Garantiza
que TODOS los agentes corran SIEMPRE (no más "faltó red de personas").

Modelo de state:
  · UN dict `state` es la fuente de verdad (lo controla el código).
  · TOOLS → se llaman directo con un shim (`shim.state = state`); mutan `state`
    in-place. (Ninguna tool usa `tool_context` más allá de `.state`.)
  · SUB-AGENTES → se corren con un `Runner` sobre una sesión FRESCA sembrada con
    `dict(state)`; al terminar se mergea `session.state` de vuelta a `state`
    (propaga el `output_key` + escrituras de sus tools). Sesión fresca por agente
    = sin contaminación de conversación entre agentes (solo comparten state).

Selección por flag en main.py: `DETERMINISTIC_PIPELINE` (default on).

Concurrencia: con `PIPELINE_DAG=1` (default) las fases independientes corren como ramas
paralelas (compliance ∥ [parser → legal ∥ market] ∥ [proveedor → web ∥ prensa ∥ funcionarios])
y el resto (person_network → compliance_extended → dictamen) tras el join; ver el bloque
"DAG paralelo" más abajo (dependencias y claves que escribe cada rama). `PIPELINE_DAG=0`
vuelve a la secuencia histórica.

Matriz tipo × etapa (backend/core/clasificacion.py): si el state trae
`agentes_permitidos` (lo manda el dispatcher vía `clasificacion` en el body), cada
sub-agente corre solo si está en la lista — los demás emiten un `phase` "omitido: …"
para que el tablero lo muestre. Sin esa clave corren TODOS (análisis a demanda del
admin: flujo idéntico al anterior). `validaciones_pendientes` va al report_writer, que
las lista al final del dictamen sin inventar nada.

Organización del módulo: este archivo conserva SOLO lo que los tests parchean por nombre
sobre `deterministic` (`A`, `T`, `get_profile`, `_seleccionar_documentos`, `_analizar_mercado`,
`_verificar_dictamen`, `_schemas`, `_run_agent*`, `_PIPELINE_DAG`, `_PARALLEL_RESEARCH`, …) y
el driver que los lee (`_pipeline`) — un bare-name lookup solo ve un monkeypatch si vive en el
MISMO módulo que lo lee. El resto vive en módulos hermanos e importa hacia acá sin ciclos:
  · pipeline_runtime.py    — invocación de agentes/tools, parseo de eventos ADK, tarifas/costo,
                              motor de ramas concurrentes del DAG (`_correr_dag`).
  · pipeline_state.py      — bookkeeping del `state` (acumuladores, kwargs por firma, backfill).
  · pipeline_guardrails.py — guardrails de texto del dictamen + bloques de instrucción.
  · pipeline_phases.py     — las 9 fases como funciones que reciben un `PipelineCtx` explícito
                              (construido acá, en `_pipeline`, con los nombres YA resueltos —
                              así el parche de un test llega por referencia, sin que esos
                              módulos necesiten importar nada patcheable).
"""
from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator

import agents as A
import tools as T
from agents._shared.profiles import Profile, get_profile

from pipeline_guardrails import (
    _bloque_recortes,
    _bloque_validaciones,
    _DICTAMEN_BOILERPLATE,
    _DICTAMEN_CTRL,
    _dictamen_problems,
    _MAX_LINEAS_RECORTES,
    _sanitize_dictamen,
    _VALIDACION_TEXTO,
)
from pipeline_phases import (
    PipelineCtx,
    fase_compliance,
    fase_compliance_ext,
    fase_dictamen,
    fase_legal,
    fase_market,
    fase_parser,
    fase_person_network,
    fase_proveedor,
    fase_research,
    t_call,
)
from pipeline_runtime import (
    _correr_dag,
    _DEFAULT_RATE,
    _merge_metrics,
    _metrics_event,
    _MODEL_RATES,
    _parse_event,
    _rate_for_model,
    _run_agent,
    _run_agent_delta,
    _run_agent_isolated,
    _short_args,
    _Shim,
    _tool,
    _truncate_result,
    _usage_tokens,
    APP_NAME,
)
from pipeline_state import (
    _ACUMULADORES,
    _aplicar_delta,
    _backfill_document_analysis,
    _is_empty_output,
    _json_key,
    _kwargs_soportados,
    _registrar_descarte,
    _registrar_recorte,
    _SOLO_DRIVER,
    _va_al_trace,
)

# ── Interfaces de otros workstreams (pueden no existir todavía) ─────────────
# Cada import cae a None y el driver conserva el comportamiento actual en ese punto.
try:  # WS D · selección determinista + lote de documentos con texto persistido
    from tools.doc_select import seleccionar_documentos as _seleccionar_documentos
except (ImportError, AttributeError):
    _seleccionar_documentos = None
try:  # WS D · entrada de `recortes` cuando la selección dejó documentos fuera por el tope
    from tools.doc_select import recorte_seleccion as _recorte_seleccion
except (ImportError, AttributeError):
    _recorte_seleccion = None
try:  # WS D
    from tools.documentos import parse_documentos_lote as _parse_documentos_lote
except (ImportError, AttributeError):
    _parse_documentos_lote = None
try:  # WS M · mercado por estrategia del perfil
    from tools.market import analizar_mercado as _analizar_mercado
except (ImportError, AttributeError):
    _analizar_mercado = None
try:  # WS V · verificación determinista del dictamen
    from tools.verify import verificar_dictamen as _verificar_dictamen
except (ImportError, AttributeError):
    _verificar_dictamen = None
try:  # WS V · reglas por slug (para correrlas en código cuando el perfil omite el agente)
    from tools.compliance_rules import REGLAS_POR_NOMBRE as _REGLAS_POR_NOMBRE
except (ImportError, AttributeError):
    _REGLAS_POR_NOMBRE = None
try:  # WS M · schemas pydantic con evidencia obligatoria
    from agents._shared import schemas as _schemas
except (ImportError, AttributeError):
    _schemas = None

# Paralelización de los 3 agentes de investigación INDEPENDIENTES (web ∥ prensa ∥
# funcionarios). Los tres son grounding-only (solo google_search) y escriben ÚNICAMENTE
# su propio output_key (verificado: web_research/news_research/entity_personnel) → no
# tocan acumuladores compartidos, así que correrlos concurrentes y mergear solo su
# output_key es seguro. Corta ~3×latencia-secuencial → ~1×la-del-más-lento en esa franja
# (la causa raíz de que los contratos doc-pesados muriesen en el wall de 3600s de Cloud
# Run). Flag para rollback instantáneo a secuencial sin redeploy.
_PARALLEL_RESEARCH = os.getenv("PARALLEL_RESEARCH", "1") != "0"


def permitido(state: dict, nombre: str, profile: Profile | None = None) -> bool:
    """¿Corre el sub-agente `nombre` (nombre canónico: compliance, document_parser,
    document_legal_analyst, market, web_research, news_research, entity_personnel,
    person_network, compliance_extended, report_writer)?

    = intersección de la matriz tipo × etapa (`agentes_permitidos`, lo manda el dispatcher)
    con los agentes del PERFIL del servicio (`PIPELINE_PROFILE`). Sin `agentes_permitidos`
    → decide solo el perfil (análisis a demanda); sin perfil → bienes (todos)."""
    prof = profile or get_profile()
    if nombre not in prof.agentes:
        return False
    perm = state.get("agentes_permitidos")
    if not isinstance(perm, (list, tuple, set)):
        return True
    return nombre in perm


# Nombres de las fases/agentes que emite este driver (los tests de perfiles verifican que
# `Profile.agentes` ⊆ FASES). Mismo orden que backend/dispatcher/events.FASES.
FASES: tuple[str, ...] = (
    "compliance", "document_parser", "document_legal_analyst", "market",
    "web_research", "news_research", "entity_personnel", "person_network",
    "compliance_extended", "report_writer",
)


def _parse_json_flexible(v):
    """dict desde un output_key que puede venir como dict, str JSON o str con fences."""
    if isinstance(v, dict):
        return v
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    if s.startswith("```"):
        nl = s.find("\n")
        s = s[nl + 1:] if nl > 0 else s
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    try:
        return json.loads(s)
    except Exception:
        i, j = s.find("{"), s.rfind("}")
        if i != -1 and j > i:
            try:
                return json.loads(s[i:j + 1])
            except Exception:
                return None
    return None


def _validar_schema(state: dict, key: str, schema_name: str) -> dict | None:
    """Valida `state[key]` contra `agents._shared.schemas.<schema_name>` (WS M) en el DRIVER.

    No se usa `output_schema` nativo en los agentes con google_search: verificado en vivo que
    con 3.6-flash `response_schema` + grounding deja `grounding_chunks` vacío (URLs no
    verificables). Aquí el JSON en texto se valida con pydantic; si no valida, la salida se
    conserva tal cual (para no perder información) pero queda anotada en `descartes` y se
    devuelve el evento `warn`. Si el schema aún no existe (WS M) → no-op."""
    if _schemas is None:
        return None
    schema = getattr(_schemas, schema_name, None)
    if schema is None:
        return None
    data = _parse_json_flexible(state.get(key))
    if data is None:
        _registrar_descarte(state, key, "salida_no_json")
        return {"kind": "warn", "name": key, "msg": f"{key}: salida no es JSON (schema {schema_name} no aplicable)"}
    try:
        validado = schema.model_validate(data)
    except Exception as e:
        _registrar_descarte(state, key, "schema_invalido", str(e)[:400])
        return {"kind": "warn", "name": key,
                "msg": f"{key}: no cumple {schema_name} — {str(e)[:160]}"}
    state[key] = validado.model_dump(exclude_none=True)
    # Revisión lote 1 (T4): lo que el schema descartó o degradó NO se queda solo en
    # `descartes_schema` del objeto: va a state['descartes'] (sección "Recortes y datos no
    # verificables" del dictamen, analisis_full) y, si una lista perdió ítems (banderas
    # legales, cruces de red, hallazgos web), se avisa por evento `warn`.
    relevantes = []
    try:
        relevantes = validado.descartes_relevantes() if hasattr(validado, "descartes_relevantes") else (
            validado.descartes() if hasattr(validado, "descartes") else [])
    except Exception:
        relevantes = []
    for d in relevantes:
        _registrar_descarte(state, f"{key}.{d.get('donde')}", str(d.get("motivo")), d.get("detalle"))
    perdidas = []
    for campo in getattr(type(validado), "model_fields", {}):
        antes = data.get(campo) if isinstance(data, dict) else None
        despues = getattr(validado, campo, None)
        if isinstance(antes, list) and isinstance(despues, list) and len(despues) < len(antes):
            perdidas.append(f"{campo} {len(antes)}→{len(despues)}")
    estado_final = getattr(validado, "estado", None)
    if perdidas or (estado_final == "no_verificable" and isinstance(data, dict)
                    and str(data.get("estado") or "").lower() not in ("", "no_verificable")):
        detalle = "; ".join(perdidas) if perdidas else "salida degradada a no_verificable"
        return {"kind": "warn", "name": key,
                "msg": f"{key}: {detalle} por schema ({len(relevantes)} descarte(s) anotados en state.descartes)"}
    return None


def _norm_codigo(ocid: str) -> str:
    """Código de alerta canónico 'OECE-<sufijo>'. Vía _short_ocid soporta los dos
    esquemas: flat ('OECE-1221284') y año-secuencia ('OECE-2026-10404-12'). Antes
    hacía split('-')[-1] → 'OECE-12' (la versión) para los OCID año-secuencia (roto)."""
    c = (ocid or "").strip()
    if not c:
        return c
    if c.startswith("OECE-"):
        return c
    return "OECE-" + T._short_ocid(c)


# ── DAG paralelo ─────────────────────────────────────────────────────────────
# PIPELINE_DAG=1 (default): las fases que no dependen entre sí corren a la vez:
#
#     ocds → registro ─┬─ compliance (agente)
#                      ├─ document_parser (tools, hilo) → [legal (agente) ∥ market (tools, hilo)]
#                      └─ proveedor (tools, hilo)       → [web ∥ prensa ∥ funcionarios] (agentes)
#                      ▼ join
#              person_network → compliance_extended → RAG normativo → persist → dictamen
#
# Dependencias reales (verificadas leyendo qué claves del state usa cada mensaje/agente):
#   · compliance: reglas SQL sobre el OCID + crea la alerta → no lee salida de otro agente.
#   · document_parser: `ocds`/`doc_urls`. legal: `parser_raw_consolidated`/`document_analysis`
#     (read_document_analysis). market: ítems del parser (`document_analysis`, `estudio_mercado`).
#   · proveedor (get_ganador/oece/sunat): `ocds`. web/news/entity: RUC/razón/entidad del
#     proveedor (`sunat_decolecta` inyectado a web_research) → tras proveedor.
#   · person_network: firmantes/comité del parser + RNP del ganador + funcionarios de entity
#     + web_research → tras el join. compliance_extended: sunat + web + person_network.
#   · report_writer: todo (get_dictamen_context). self_eval (main.py): dictamen.
#
# Claves del state que escribe cada rama (DISTINTAS entre ramas; los acumuladores de lista
# se mergean por append-dedupe en `_aplicar_delta`, nunca por overwrite):
#   compliance : compliance_result, alerta_codigo, banderas, score, estado_real,
#                analisis_postores, causal_directa_invocada, acto_resolutivo_directa,
#                pending_flags(+), descartes(+)
#   parser     : parser_raw_consolidated, documentos_texto, document_analysis, estudio_mercado,
#                contrato_final, _parse_deadline, _parsed_doc_cache, recortes(+)
#   legal      : legal_analysis, pending_doc_flags, descartes(+)
#   market     : market_analysis, market_input, market_findings, market_queries,
#                market_grounding, grounding_urls(+), pending_market_flags, recortes(+),
#                descartes(+), validaciones_pendientes(+)
#   proveedor  : oece_perfiles, sunat_profiles, sunat_decolecta, pending_flags(+),
#                web_research, news_research, entity_personnel, batch_person_lookup_result,
#                descartes(+)
# Las tools SÍNCRONAS de una rama corren en un hilo (`asyncio.to_thread`) para que la rama
# async (agentes ADK) avance a la vez; `metrics` y `events_trace` se actualizan SOLO desde el
# event loop (el driver consume los eventos de cada rama por una cola). PIPELINE_DAG=0 →
# secuencia histórica (mismas fases, mismos eventos, sin concurrencia).
_PIPELINE_DAG = os.getenv("PIPELINE_DAG", "1") != "0"


async def run_deterministic(input_str: str, runner, user_id: str, session_id: str,
                            state: dict, events_trace: list[dict], metrics: dict) -> AsyncIterator[dict]:
    """Ejecuta el pipeline COMPLETO (DAG paralelo con PIPELINE_DAG=1, secuencia fija con 0).
    Yields cada evento (ya appended a events_trace cuando corresponde). Muta `state`
    (fuente de verdad para el tail de main.py). `metrics` y `events_trace` se tocan SOLO
    acá (event loop), nunca desde las ramas ni desde hilos."""
    async for e in _pipeline(input_str, runner, user_id, state, metrics):
        if e.get("kind") == "_metrics_delta":
            # Sub-run aislado terminado: sumar sus tokens/costo al global y emitir UN evento
            # `metrics` con el total (contador monótono para el tablero).
            _merge_metrics(metrics, e.get("metrics") or {})
            e = _metrics_event(metrics, e.get("agent") or "agent")
        if _va_al_trace(e):
            events_trace.append(e)
        yield e


async def _pipeline(input_str: str, runner, user_id: str, state: dict, metrics: dict) -> AsyncIterator[dict]:
    ss = runner.session_service
    dag = _PIPELINE_DAG
    ocid = (state.get("ocid") or input_str or "").strip()

    _clas = state.get("clasificacion") if isinstance(state.get("clasificacion"), dict) else {}
    _tipo_etapa = f"{_clas.get('tipo') or '?'}/{_clas.get('etapa') or '?'}"

    # ── Perfil del servicio (PIPELINE_PROFILE): agentes, estrategia de mercado, reglas,
    # topes, prioridad de documentos, secciones del dictamen. Va al state para que las
    # tools de los otros WS lo lean vía tool_context.state["perfil"].
    profile = get_profile()
    state["perfil"] = profile.as_state()
    # WS V lee estas dos claves directamente (compliance_rules._perfil_reglas/_perfil_topes).
    state["reglas_activas"] = sorted(profile.reglas_activas)
    state["topes_uit"] = dict(profile.topes_uit)
    state.setdefault("recortes", [])    # [{donde, limite, omitido}] — ningún tope silencioso
    state.setdefault("descartes", [])   # [{donde, motivo, detalle}] — nada sin evidencia se persiste
    _agentes_activos = [a for a in profile.agentes if permitido(state, a, profile)]
    yield {"kind": "phase", "name": "perfil",
           "msg": f"{profile.nombre} · mercado={profile.market_estrategia} · "
                  f"agentes: {', '.join(_agentes_activos) or 'ninguno'}"}

    # Contexto compartido de las fases (pipeline_phases.PipelineCtx): los nombres patcheables
    # por los tests (A, T, _seleccionar_documentos, _analizar_mercado, _verificar_dictamen,
    # _run_agent*, _PARALLEL_RESEARCH, …) se leen ACÁ por nombre simple — así ve el monkeypatch
    # de tests/test_dag.py — y de acá en más viajan como datos; `perm`/`validar` son los dos
    # casos que siguen atados a este módulo (permitido lee get_profile; _validar_schema lee
    # _schemas). ocid/alerta_codigo se completan abajo, apenas se conocen.
    pc = PipelineCtx(
        state=state, metrics=metrics,
        ctx={"ganador": {}, "ruc": "", "razon": "", "entidad": {}, "postores": []},
        profile=profile, dag=dag, ss=ss, user_id=user_id, ocid=ocid, alerta_codigo="",
        clas=_clas, tipo_etapa=_tipo_etapa, A=A, T=T,
        seleccionar_documentos=_seleccionar_documentos, recorte_seleccion=_recorte_seleccion,
        parse_documentos_lote=_parse_documentos_lote, analizar_mercado=_analizar_mercado,
        verificar_dictamen=_verificar_dictamen, reglas_por_nombre=_REGLAS_POR_NOMBRE,
        parallel_research=_PARALLEL_RESEARCH,
        run_agent=_run_agent, run_agent_isolated=_run_agent_isolated, run_agent_delta=_run_agent_delta,
        perm=lambda nombre: permitido(state, nombre, profile),
        validar=lambda key, schema_name: _validar_schema(state, key, schema_name),
    )

    # ── 1. OCDS + registro ──
    yield {"kind": "phase", "name": "ocds", "msg": f"obteniendo OCDS de {ocid}"}
    evs, _ = await t_call(pc, T.fetch_ocds_record, "fetch_ocds_record", ocid=ocid)
    for e in evs:
        yield e
    ocid = (state.get("ocid") or ocid).strip()  # normalizado por la tool
    alerta_codigo = _norm_codigo(ocid)
    state["alerta_codigo"] = alerta_codigo   # verify/persist lo usan como fallback para leer banderas de la BD
    pc.ocid = ocid
    pc.alerta_codigo = alerta_codigo

    # ABORT honesto: si no se obtuvo el OCDS (relay VPS / WAF caído), los ~12 pasos
    # siguientes correrían sobre datos VACÍOS y producirían un análisis basura que
    # igual se persistiría y dictaminaría. Mejor abortar y dejar constancia clara.
    _ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    _ocds_ok = isinstance(_ocds, dict) and (_ocds.get("tender") or _ocds.get("awards") or _ocds.get("ocid"))
    if not _ocds_ok:
        yield {"kind": "warn", "name": "ocds",
               "msg": "OCDS no disponible (fuente OECE inaccesible) — abortando análisis"}
        state["final_dictamen"] = (
            f"## Análisis no disponible — {alerta_codigo}\n\n"
            f"No se pudo obtener el registro OCDS del proceso `{ocid}` desde la fuente oficial "
            f"(OECE Contrataciones Abiertas inaccesible en este momento). El análisis NO puede "
            f"continuar sin los datos base del proceso y se aborta para no emitir conclusiones "
            f"sobre información vacía. Reintentar cuando la fuente esté disponible.")
        state["_final_response"] = "OCDS no disponible — análisis abortado."
        state["_aborted"] = "ocds_unavailable"
        evs, _ = await t_call(pc, T.persist_analysis_outputs, "persist_analysis_outputs", alerta_codigo=alerta_codigo)
        for e in evs:
            yield e
        return

    evs, _ = await t_call(pc, T.register_convocatoria_in_db, "register_convocatoria_in_db", ocid=ocid)
    for e in evs:
        yield e

    if state.get("agentes_permitidos"):
        yield {"kind": "phase", "name": "clasificacion",
               "msg": f"matriz tipo × etapa {_tipo_etapa}: agentes {', '.join(state['agentes_permitidos'])}"}

    # ── Ejecución: DAG paralelo o secuencia histórica ──
    if dag:
        async for e in _correr_dag(
            [("compliance", [lambda: fase_compliance(pc)]),
             ("documentos", [lambda: fase_parser(pc),
                             ("paralelo", [lambda: fase_legal(pc), lambda: fase_market(pc)])]),
             ("proveedor", [lambda: fase_proveedor(pc), lambda: fase_research(pc)])]):
            yield e
    else:
        for fase in (fase_compliance, fase_parser, fase_legal, fase_market, fase_proveedor, fase_research):
            async for e in fase(pc):
                yield e
    for fase in (fase_person_network, fase_compliance_ext, fase_dictamen):
        async for e in fase(pc):
            yield e
