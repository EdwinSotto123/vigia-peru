"""Orquestación del DAG paralelo (deterministic.run_deterministic con PIPELINE_DAG=1) con
stubs de agentes y tools: orden de dependencias, merge de deltas, aislamiento de fallos,
eventos sin pérdida y métricas mergeadas en el event loop."""
from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest

import deterministic as D


# ── Stubs ───────────────────────────────────────────────────────────────────────
class _Log:
    """Registro (nombre, t_inicio, t_fin) de cada tool/agente stub."""

    def __init__(self):
        self.t0 = time.monotonic()
        self.spans: list[tuple[str, float, float]] = []

    def span(self, nombre, ini, fin):
        self.spans.append((nombre, ini - self.t0, fin - self.t0))

    def ini(self, nombre):
        return min(a for n, a, _ in self.spans if n == nombre)

    def fin(self, nombre):
        return max(b for n, _, b in self.spans if n == nombre)

    def names(self):
        return [n for n, _, _ in self.spans]


def _mk_tool(log: _Log, nombre: str, escribe: dict | None = None, dur: float = 0.0, ret=None, raises=False):
    def fn(tool_context=None, **kw):
        a = time.monotonic()
        if dur:
            time.sleep(dur)
        if raises:
            raise RuntimeError(f"{nombre} falló")
        st = tool_context.state
        for k, v in (escribe or {}).items():
            if isinstance(v, list):
                st.setdefault(k, []).extend(v)
            else:
                st[k] = v
        log.span(nombre, a, time.monotonic())
        return ret if ret is not None else {"ok": True, "tool": nombre}
    fn.__name__ = nombre
    return fn


def _agente(nombre):
    return SimpleNamespace(name=nombre, model="gemini-3.6-flash")


@pytest.fixture
def entorno(monkeypatch):
    """Reemplaza agentes, tools, lote/mercado y los runners ADK por stubs deterministas."""
    log = _Log()
    ocid = "ocds-dgv273-seacev3-1245947"

    # Perfil bienes (todos los agentes).
    prof = D.get_profile("bienes")
    monkeypatch.setattr(D, "get_profile", lambda *a, **k: prof)

    agentes = SimpleNamespace(**{
        n: _agente(n) for n in (
            "compliance_agent", "document_parser_agent", "document_legal_analyst_agent",
            "web_research_agent", "news_research_agent", "entity_personnel_agent",
            "person_network_agent", "compliance_extended_agent", "report_writer_agent")})
    monkeypatch.setattr(D, "A", agentes)

    T = SimpleNamespace()
    T._short_ocid = D.T._short_ocid
    T.fetch_ocds_record = _mk_tool(log, "fetch_ocds_record", {"ocds": {"ocid": ocid, "tender": {"title": "Compra"}}, "ocid": ocid})
    T.register_convocatoria_in_db = _mk_tool(log, "register_convocatoria_in_db")
    T.get_ganador = _mk_tool(log, "get_ganador", dur=0.05, ret={
        "ganador": {"ruc": "20100000001", "razon_social": "PROVEEDOR SAC"},
        "entidad": {"ruc": "20131370998", "nombre": "MUNICIPALIDAD", "region": "LIMA"},
        "todos_postores": [{"ruc": "20100000001"}, {"ruc": "20100000002"}]})
    T.query_oece_perfil = _mk_tool(log, "query_oece_perfil", {"oece_perfiles": {"x": 1}}, dur=0.05,
                                   ret={"senales": [{"regla": "senal_oece", "severidad": "media", "evidencia": "e1"}]})
    T.add_contextual_flag = _mk_tool(log, "add_contextual_flag",
                                     {"pending_flags": [{"regla": "senal_oece", "evidencia": "e1", "_source": "proveedor"}]})
    T.query_sunat_decolecta = _mk_tool(log, "query_sunat_decolecta", {"sunat_decolecta": {"ruc": "20100000001"}}, dur=0.05,
                                       ret={"found": True})
    T.query_edad_ciiu_web = _mk_tool(log, "query_edad_ciiu_web")
    T.read_sunat_profile = _mk_tool(log, "read_sunat_profile")
    T.batch_person_lookup = _mk_tool(log, "batch_person_lookup", {"batch_person_lookup_result": {"n": 1}})
    T.query_rnp_empresa = _mk_tool(log, "query_rnp_empresa", ret={"socios": [{"numero_documento": "12345678", "nombre": "JUAN"}]})
    T.detect_puerta_giratoria = _mk_tool(log, "detect_puerta_giratoria")
    T.read_person_network_context = _mk_tool(log, "read_person_network_context", {"person_network_context": "ctx"})
    T.evaluate_normative_compliance = _mk_tool(log, "evaluate_normative_compliance", {"normative_compliance": {"ok": True}})
    T.persist_alert_from_flags = _mk_tool(log, "persist_alert_from_flags")
    T.persist_analysis_outputs = _mk_tool(log, "persist_analysis_outputs")
    T.persist_doc_flags_as_banderas = _mk_tool(log, "persist_doc_flags_as_banderas")
    T.persist_market_flags_as_banderas = _mk_tool(log, "persist_market_flags_as_banderas")
    T.build_market_input = _mk_tool(log, "build_market_input")
    T.analyze_market_sharded = _mk_tool(log, "analyze_market_sharded")
    T.sanitize_items_with_llm = lambda items, objeto: items
    monkeypatch.setattr(D, "T", T)

    # Lote de documentos (sync, "lento") y mercado (sync).
    def _sel(ocid_, ocds, doc_urls, prioridad, max_docs, **kw):
        return [{"id": "d1", "tipo": "bases", "titulo": "Bases", "formato": "pdf"}], []

    def _lote(state, docs, **kw):
        a = time.monotonic()
        time.sleep(0.15)
        state["parser_raw_consolidated"] = {"items_consolidados": [{"numero": 1, "descripcion_corta": "laptop"}],
                                            "firmantes_consolidados": [{"nombre_completo": "ANA", "dni": "11111111"}]}
        state["documentos_texto"] = {"sha1": {"n_paginas": 3}}
        state.setdefault("recortes", []).append({"donde": "parser_lote", "limite": 1, "omitido": "x"})
        log.span("parse_documentos_lote", a, time.monotonic())
        return {"n_docs": 1, "n_ok": 1}

    def _mercado(state, estrategia):
        a = time.monotonic()
        time.sleep(0.1)
        state["market_analysis"] = {"findings": [{"item": "laptop"}]}
        state.setdefault("recortes", []).append({"donde": "market", "limite": 1, "omitido": "y"})
        log.span("analizar_mercado", a, time.monotonic())
        return {"estrategia": estrategia}

    monkeypatch.setattr(D, "_seleccionar_documentos", _sel)
    monkeypatch.setattr(D, "_recorte_seleccion", None)
    monkeypatch.setattr(D, "_parse_documentos_lote", _lote)
    monkeypatch.setattr(D, "_analizar_mercado", _mercado)
    monkeypatch.setattr(D, "_verificar_dictamen", lambda texto, state: {"degradado": False})
    monkeypatch.setattr(D, "_schemas", None)   # sin validación pydantic en el stub

    # Runners ADK → stubs async con latencia y deltas por agente.
    DUR = {"compliance_agent": 0.2, "document_legal_analyst_agent": 0.1, "web_research_agent": 0.1,
           "news_research_agent": 0.1, "entity_personnel_agent": 0.1, "person_network_agent": 0.05,
           "compliance_extended_agent": 0.05, "report_writer_agent": 0.05}
    DELTAS = {
        "compliance_agent": {"compliance_result": "ok", "alerta_codigo": "OECE-1245947",
                             "pending_flags": [{"regla": "unique_bidder", "evidencia": "1 postor"}],
                             "market_findings": []},   # no-op del callback init_state
        "document_legal_analyst_agent": {"legal_analysis": {"estado": "hallado", "red_flags_documentales": []}},
        "web_research_agent": {"web_research": {"hallazgos": [{"x": 1}]}},
        "news_research_agent": {"news_research": {"noticias": [], "sin_menciones_relevantes": True}},
        "entity_personnel_agent": {"entity_personnel": {"funcionarios_designados": [{"nombre": "PEDRO", "cargo": "GERENTE"}]}},
        "person_network_agent": {"person_network": {"vinculos_detectados": [{"a": 1}]}},
        "compliance_extended_agent": {"compliance_extended": "ok"},
        "report_writer_agent": {"final_dictamen": "## Dictamen\n\n" + "x" * 900},
    }
    fallan: set[str] = set()

    async def _delta(agent, msg, base_state, ss, user_id, output_key=None):
        a = time.monotonic()
        await asyncio.sleep(DUR.get(agent.name, 0.05))
        log.span(agent.name, a, time.monotonic())
        if agent.name in fallan:
            raise RuntimeError(f"{agent.name} explotó")
        d = dict(DELTAS.get(agent.name, {}))
        evs = [{"agent": agent.name, "kind": "tool_call", "name": f"tool_de_{agent.name}", "args": {}}]
        return evs, d.get(output_key) if isinstance(d.get(output_key), str) else None, d, \
            {"prompt": 100, "output": 50, "total": 150, "calls": 1, "cost": 0.001, "thoughts": 10}

    async def _isolated(agent, msg, base_state, output_key, ss, user_id):
        evs, ft, d, m = await _delta(agent, msg, base_state, ss, user_id, output_key)
        return evs, ft, {output_key: d[output_key]}, m

    async def _secuencial(agent, msg, state, ss, user_id, metrics):
        evs, ft, d, m = await _delta(agent, msg, state, ss, user_id, None)
        state.update(d)
        state["_last_agent_final"] = ft
        D._merge_metrics(metrics, m)
        for e in evs:
            yield e
        yield D._metrics_event(metrics, agent.name)

    monkeypatch.setattr(D, "_run_agent_delta", _delta)
    monkeypatch.setattr(D, "_run_agent_isolated", _isolated)
    monkeypatch.setattr(D, "_run_agent", _secuencial)

    runner = SimpleNamespace(session_service=object())
    return SimpleNamespace(log=log, ocid=ocid, runner=runner, fallan=fallan, DELTAS=DELTAS)


async def _correr(entorno, dag: bool, monkeypatch, state_extra: dict | None = None):
    monkeypatch.setattr(D, "_PIPELINE_DAG", dag)
    state = {"ocid": entorno.ocid, "ocds": {"ocid": entorno.ocid, "tender": {"title": "Compra"}}}
    state.update(state_extra or {})
    trace: list[dict] = []
    metrics = {"prompt": 0, "output": 0, "total": 0, "calls": 0, "cost": 0.0, "thoughts": 0}
    eventos = []
    async for e in D.run_deterministic(entorno.ocid, entorno.runner, "u", "s", state, trace, metrics):
        eventos.append(e)
    return state, trace, metrics, eventos


# ── Tests ───────────────────────────────────────────────────────────────────────
def test_dag_respeta_dependencias_y_paraleliza(entorno, monkeypatch):
    state, trace, metrics, eventos = asyncio.run(_correr(entorno, True, monkeypatch))
    log = entorno.log
    # parser → legal ∥ market (ambos empiezan tras el lote y se solapan entre sí)
    assert log.ini("document_legal_analyst_agent") >= log.fin("parse_documentos_lote")
    assert log.ini("analizar_mercado") >= log.fin("parse_documentos_lote")
    assert log.ini("analizar_mercado") < log.fin("document_legal_analyst_agent")
    # proveedor → research (web/news/entity tras sunat) y research ∥ docs
    assert log.ini("web_research_agent") >= log.fin("read_sunat_profile")
    assert log.ini("web_research_agent") < log.fin("parse_documentos_lote") + 0.5
    # las 3 ramas se solapan: compliance corre mientras el lote (hilo) está en curso
    assert log.ini("compliance_agent") < log.fin("parse_documentos_lote")
    assert log.ini("get_ganador") < log.fin("parse_documentos_lote")
    # person_network solo tras el join (todas las ramas terminadas)
    join = max(log.fin(n) for n in ("compliance_agent", "document_legal_analyst_agent", "analizar_mercado",
                                    "web_research_agent", "news_research_agent", "entity_personnel_agent"))
    assert log.ini("query_rnp_empresa") >= join
    assert log.ini("person_network_agent") >= join
    assert log.ini("compliance_extended_agent") >= log.fin("person_network_agent")
    assert log.ini("report_writer_agent") >= log.fin("compliance_extended_agent")
    # el DAG realmente ahorra tiempo: el wall total es menor que la suma de duraciones
    # (que es lo que tarda la secuencia) — las ramas se solaparon de verdad.
    total = max(b for _, _, b in log.spans)
    suma = sum(b - a for _, a, b in log.spans)
    assert total < 0.8 * suma, (total, suma)
    # dictamen + estado final
    assert state["final_dictamen"].startswith("## Dictamen")
    assert state["_final_response"].startswith("## Dictamen")


def test_dag_mergea_deltas_y_acumuladores(entorno, monkeypatch):
    state, trace, metrics, eventos = asyncio.run(_correr(entorno, True, monkeypatch))
    # compliance (rama aislada) dejó su alerta y su bandera; proveedor (otra rama) su señal:
    # ambas en pending_flags (append-dedupe, sin pisarse).
    reglas = [f["regla"] for f in state["pending_flags"]]
    assert "unique_bidder" in reglas and "senal_oece" in reglas
    assert state["alerta_codigo"] == "OECE-1245947"
    # recortes del parser (hilo) y del mercado (hilo) conviven
    dondes = [r["donde"] for r in state["recortes"]]
    assert "parser_lote" in dondes and "market" in dondes
    # salidas de todos los agentes presentes
    for k in ("compliance_result", "legal_analysis", "market_analysis", "web_research", "news_research",
              "entity_personnel", "person_network", "compliance_extended", "final_dictamen",
              "sunat_decolecta", "normative_compliance", "batch_person_lookup_result"):
        assert state.get(k) not in (None, "", [], {}), k
    # métricas: sumadas SOLO en el event loop, contador monótono en los eventos `metrics`
    assert metrics["calls"] == 8 and metrics["cost"] == pytest.approx(0.008)
    costos = [e["cost_usd"] for e in eventos if e.get("kind") == "metrics"]
    assert costos == sorted(costos) and costos[-1] == pytest.approx(0.008)
    assert not any(e.get("kind") == "_metrics_delta" for e in eventos)


def test_dag_no_pierde_eventos(entorno, monkeypatch):
    state, trace, metrics, eventos = asyncio.run(_correr(entorno, True, monkeypatch))
    tool_calls = [e["name"] for e in eventos if e.get("kind") == "tool_call"]
    for nombre in entorno.log.names():
        if nombre.endswith("_agent"):
            assert f"tool_de_{nombre}" in tool_calls
        else:
            assert nombre in tool_calls, nombre
    # cada tool_call del driver tiene su tool_result (los `tool_de_<agente>` son del stub del agente)
    assert len([e for e in eventos if e.get("kind") == "tool_result"]) ==         len([n for n in tool_calls if not n.startswith("tool_de_")])
    # transfers de todos los agentes (encienden los nodos del grafo)
    tos = {e["to"] for e in eventos if e.get("kind") == "transfer"}
    assert {"compliance_agent", "document_parser_agent", "document_legal_analyst_agent", "market_price_agent",
            "web_research_agent", "news_research_agent", "entity_personnel_agent", "person_network_agent",
            "compliance_extended_agent", "report_writer_agent"} <= tos
    fases = [e["name"] for e in eventos if e.get("kind") == "phase"]
    for f in ("dag", "compliance", "document_parser", "legal", "market", "proveedor", "research_parallel",
              "dag_join", "person_network", "compliance_extended", "persist_checkpoint", "report_writer"):
        assert f in fases, f
    # trace persistido: tool_call/tool_result/transfer/metrics sí; `phase` de progreso no
    assert all(e.get("kind") != "phase" for e in trace)
    assert len([e for e in trace if e.get("kind") == "tool_call"]) == len(tool_calls)


def test_dag_fallo_en_una_rama_no_tumba_a_las_otras(entorno, monkeypatch):
    def _lote_roto(state, docs, **kw):
        raise RuntimeError("Document AI caído")
    monkeypatch.setattr(D, "_parse_documentos_lote", _lote_roto)
    entorno.fallan.add("compliance_agent")
    state, trace, metrics, eventos = asyncio.run(_correr(entorno, True, monkeypatch))
    # rama documentos: el lote falló → warn + fallback al agente parser (que corre igual)
    assert any(e.get("kind") == "warn" and "lote de documentos falló" in (e.get("msg") or "") for e in eventos)
    assert "document_parser_agent" in entorno.log.names()
    # rama compliance: explotó → evento error de la rama, sin propagar
    errs = [e for e in eventos if e.get("kind") == "error" and "rama compliance" in (e.get("detail") or "")]
    assert errs and "explotó" in errs[0]["detail"]
    # las otras ramas terminaron: proveedor + research + mercado + dictamen
    for k in ("web_research", "news_research", "entity_personnel", "market_analysis", "sunat_decolecta",
              "person_network", "final_dictamen"):
        assert state.get(k), k
    assert "report_writer_agent" in entorno.log.names()


def test_secuencial_conserva_el_orden_historico(entorno, monkeypatch):
    monkeypatch.setattr(D, "_PARALLEL_RESEARCH", False)   # secuencia 100 % histórica
    state, trace, metrics, eventos = asyncio.run(_correr(entorno, False, monkeypatch))
    n = entorno.log.names()
    orden = ["compliance_agent", "parse_documentos_lote", "document_legal_analyst_agent", "analizar_mercado",
             "get_ganador", "web_research_agent", "person_network_agent", "compliance_extended_agent",
             "report_writer_agent"]
    idx = [n.index(x) for x in orden]
    assert idx == sorted(idx)
    # nada se solapa en secuencial
    spans = sorted(entorno.log.spans, key=lambda s: s[1])
    for (_, _, b1), (_, a2, _) in zip(spans, spans[1:]):
        assert a2 >= b1 - 1e-6
    assert metrics["calls"] == 8
    assert not any(e.get("kind") == "phase" and e.get("name") == "dag" for e in eventos)
    assert state["final_dictamen"].startswith("## Dictamen")


def test_aplicar_delta_acumuladores_y_overwrite():
    state = {"pending_flags": [{"regla": "a"}], "recortes": [], "x": 1}
    D._aplicar_delta(state, {"pending_flags": [{"regla": "a"}, {"regla": "b"}], "x": 2, "nuevo": "v",
                             "recortes": [{"donde": "d"}]})
    assert state["pending_flags"] == [{"regla": "a"}, {"regla": "b"}]   # dedupe + append
    assert state["recortes"] == [{"donde": "d"}] and state["x"] == 2 and state["nuevo"] == "v"
    # acumulador ausente → se crea como copia
    st2 = {}
    D._aplicar_delta(st2, {"descartes": [{"m": 1}]})
    assert st2["descartes"] == [{"m": 1}]


def test_va_al_trace():
    assert D._va_al_trace({"kind": "tool_call"})
    assert D._va_al_trace({"kind": "transfer"})
    assert D._va_al_trace({"kind": "phase", "name": "x", "msg": "omitido: no aplica"})
    assert not D._va_al_trace({"kind": "phase", "name": "x", "msg": "procesando"})
