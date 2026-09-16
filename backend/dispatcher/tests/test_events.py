from backend.dispatcher.events import FASES, completadas, reduce_event


def _corrida(eventos: list[dict]) -> dict:
    """Aplica una secuencia de eventos como lo hace el dispatcher (state.update por evento)."""
    state: dict = {}
    for i, ev in enumerate(eventos):
        state.update(reduce_event(state, ev, ts=f"2026-09-15T18:00:{i:02d}+00:00"))
    return state


def _ph(name: str, msg: str = "x") -> dict:
    return {"kind": "phase", "name": name, "msg": msg}


def test_phase_conocida_da_indice():
    st = reduce_event({}, {"kind": "phase", "name": "market", "msg": "validando precios"})
    assert st["fase_actual"] == "market" and st["fase_index"] == FASES.index("market")


def test_phase_desconocida_no_rompe():
    st = reduce_event({"fase_actual": "market", "fase_index": 3}, {"kind": "phase", "name": "safety_net", "msg": "x"})
    assert st["fase_actual"] == "safety_net" and st["fase_index"] == 3


def test_final_marca_terminado():
    st = reduce_event({}, {"kind": "final", "final_response": "..."})
    assert st["terminado"] is True and st["fase_index"] == len(FASES)


def test_error_guarda_detalle():
    st = reduce_event({}, {"kind": "error", "agent": "pipeline", "detail": "boom"})
    assert st["error"] == "boom"


def test_eventos_ruidosos_se_ignoran():
    assert reduce_event({}, {"kind": "tool_call", "name": "x"}) == {}


def test_alias_del_orquestador_mapea_a_fase_canonica():
    # deterministic.py emite "legal", "research_parallel", "news" y "compliance_rules"; el público ve las canónicas.
    st = reduce_event({}, {"kind": "phase", "name": "legal"})
    assert st["fase_actual"] == "document_legal_analyst" and st["fase_index"] == 2
    assert reduce_event({}, {"kind": "phase", "name": "research_parallel"})["fase_index"] == FASES.index("web_research")
    assert reduce_event({}, {"kind": "phase", "name": "news"})["fase_actual"] == "news_research"
    st = reduce_event({}, {"kind": "phase", "name": "compliance_rules", "msg": "reglas del perfil otros en código"})
    assert st["fase_actual"] == "compliance_extended" and st["fase_index"] == FASES.index("compliance_extended")


def test_phase_sin_indice_previo_no_inventa_indice():
    st = reduce_event({}, {"kind": "phase", "name": "ocds", "msg": "obteniendo OCDS"})
    assert st["fase_actual"] == "ocds" and "fase_index" not in st
    assert st["fases"]["ocds"]["estado"] == "corriendo"


def test_auxiliares_no_retroceden_el_indice():
    st = {"fase_actual": "report_writer", "fase_index": 9}
    for aux in ("persist_checkpoint", "safety_net", "persist", "self_eval", "dag_join", "perfil", "clasificacion", "started", "deterministic"):
        out = reduce_event(st, _ph(aux))
        assert out["fase_actual"] == aux and out["fase_index"] == 9, aux


def test_indice_es_el_maximo_alcanzado_en_el_dag():
    # En el DAG `market` (3) puede llegar DESPUÉS de `web_research` (4): el índice no retrocede.
    st = {"fase_actual": "web_research", "fase_index": 4, "dag": True}
    out = reduce_event(st, _ph("market"))
    assert out["fase_actual"] == "market" and out["fase_index"] == 4
    out = reduce_event({"fase_index": 4}, _ph("person_network"))
    assert out["fase_index"] == 7


def test_final_abortado_no_cuenta_como_procesado():
    st = reduce_event({}, {"kind": "final", "final_response": "OCDS no disponible — análisis abortado.",
                           "state": {"_aborted": "ocds_unavailable"}})
    assert st["terminado"] is True and st["abortado"] == "ocds_unavailable"
    assert "fase_index" not in st and "ocds_unavailable" in st["error"]


def test_final_con_runner_error_es_abortado():
    st = reduce_event({}, {"kind": "final", "runner_error": {"kind": "runner_exception", "msg": "boom"}})
    assert st["abortado"] == "boom"


# ─── fases {nombre: {estado, desde, hasta}} ───────────────────────────────────

CORRIDA_BIENES = [
    _ph("perfil", "bienes"), _ph("started", "despachando"), _ph("deterministic", "pipeline determinista"),
    _ph("ocds", "obteniendo OCDS de 1225030"), _ph("clasificacion", "matriz bienes/adjudicada"),
    _ph("dag", "ramas en paralelo: compliance ∥ documentos ∥ proveedor"),
    _ph("compliance", "evaluando reglas duras"), _ph("document_parser", "procesando documentos SEACE"),
    _ph("proveedor", "perfilando al proveedor adjudicado"),
    _ph("research_parallel", "investigación paralela: web_research ∥ news_research ∥ entity_personnel"),
    {"kind": "warn", "name": "document_parser", "msg": "ítems canónicos tras sanitización por LLM: 1 (de 2 crudos)"},
    _ph("legal", "análisis legal del requerimiento"), _ph("market", "validando precios de mercado (goods_retail)"),
    _ph("dag_join", "ramas terminadas: compliance, documentos, proveedor"),
    _ph("person_network", "mapeando la red de personas"), _ph("compliance_extended", "cumplimiento normativo extendido"),
    _ph("persist_checkpoint", "checkpoint"), _ph("report_writer", "escribiendo dictamen"),
    _ph("safety_net", "verificando"), _ph("persist", "persistiendo"), _ph("self_eval", "auto-evaluando"),
    {"kind": "final", "final_response": "ok"},
]


def test_corrida_dag_completa_deja_todas_hechas():
    st = _corrida(CORRIDA_BIENES)
    assert st["terminado"] and st["fase_index"] == 10 and st["fase_actual"] == "final"
    fases = st["fases"]
    for f in FASES + ["ocds", "proveedor", "persist_checkpoint", "safety_net", "persist", "self_eval"]:
        assert fases[f]["estado"] == "hecho", f
        assert fases[f]["desde"] and fases[f]["hasta"], f
    assert st["fases_completadas"][:3] == ["ocds", "compliance", "document_parser"]
    assert set(st["fases_completadas"]) == set(fases)


def test_en_el_dag_las_ramas_corren_a_la_vez():
    # tras research_parallel: compliance, document_parser y las 3 investigaciones corren; proveedor ya terminó.
    st = _corrida(CORRIDA_BIENES[:10])
    f = st["fases"]
    assert f["compliance"]["estado"] == "corriendo"
    assert f["document_parser"]["estado"] == "corriendo"
    assert f["proveedor"]["estado"] == "hecho"
    for k in ("web_research", "news_research", "entity_personnel"):
        assert f[k]["estado"] == "corriendo", k
    assert f["ocds"]["estado"] == "hecho"
    assert st["fase_index"] == 4 and st["dag"] is True
    assert "person_network" not in f


def test_legal_y_market_cierran_al_parser_pero_no_a_compliance():
    st = _corrida(CORRIDA_BIENES[:13])
    f = st["fases"]
    assert f["document_parser"]["estado"] == "hecho"
    assert f["document_legal_analyst"]["estado"] == "corriendo" and f["market"]["estado"] == "corriendo"
    assert f["compliance"]["estado"] == "corriendo"       # rama independiente: solo la cierra el join
    assert f["web_research"]["estado"] == "corriendo"
    assert st["fase_index"] == 4                          # market (3) no retrocede el índice


def test_dag_join_cierra_todas_las_ramas():
    st = _corrida(CORRIDA_BIENES[:14])
    f = st["fases"]
    for k in ("compliance", "document_parser", "document_legal_analyst", "market", "proveedor", "web_research", "news_research", "entity_personnel"):
        assert f[k]["estado"] == "hecho", k
    assert st["dag"] is False


def test_sintesis_secuencial_cierra_la_anterior():
    st = _corrida(CORRIDA_BIENES[:16])
    f = st["fases"]
    assert f["person_network"]["estado"] == "hecho" and f["compliance_extended"]["estado"] == "corriendo"
    st = _corrida(CORRIDA_BIENES[:18])
    f = st["fases"]
    assert f["compliance_extended"]["estado"] == "hecho" and f["persist_checkpoint"]["estado"] == "hecho"
    assert f["report_writer"]["estado"] == "corriendo"


def test_omitido_no_cambia_fase_actual_ni_indice():
    st = {"fase_actual": "market", "fase_index": 3}
    out = reduce_event(st, _ph("person_network", "omitido: no aplica a bienes/desierta"))
    assert "fase_actual" not in out and out["fase_index"] == 3
    assert out["fases"]["person_network"] == {"estado": "omitido", "desde": out["fases"]["person_network"]["desde"],
                                              "hasta": out["fases"]["person_network"]["hasta"], "motivo": "no aplica a bienes/desierta"}
    assert out["fases_completadas"] == []


def test_compliance_rules_reabre_al_extendido_omitido():
    st = _corrida([_ph("compliance_extended", "omitido: no aplica al perfil otros"),
                   _ph("compliance_rules", "reglas del perfil otros en código (sin LLM): split_contract")])
    assert st["fases"]["compliance_extended"]["estado"] == "corriendo"
    assert st["fase_actual"] == "compliance_extended"


def test_error_de_agente_marca_la_fase_y_el_reintento_la_reabre():
    st = _corrida(CORRIDA_BIENES[:10] + [
        {"kind": "error", "agent": "entity_personnel_agent", "detail": "run: Tool 'google:google_search' not found."},
    ])
    assert st["fases"]["entity_personnel"]["estado"] == "error"
    assert "google_search" in st["fases"]["entity_personnel"]["motivo"]
    assert st["error"].startswith("run: Tool")
    st = _corrida(CORRIDA_BIENES[:10] + [
        {"kind": "error", "agent": "entity_personnel_agent", "detail": "run: boom"},
        {"kind": "warn", "name": "entity_personnel", "msg": "entity_personnel vacío — reintento"},
    ])
    assert st["fases"]["entity_personnel"]["estado"] == "corriendo"
    st = _corrida(CORRIDA_BIENES[:10] + [
        {"kind": "warn", "name": "entity_personnel", "msg": "entity_personnel vacío — reintento"},
        {"kind": "warn", "name": "entity_personnel", "msg": "entity_personnel vacío tras reintento — default tipado"},
    ])
    assert st["fases"]["entity_personnel"]["estado"] == "hecho"
    assert "sin resultados" in st["fases"]["entity_personnel"]["motivo"]


def test_error_de_rama_tumba_sus_fases():
    st = _corrida(CORRIDA_BIENES[:10] + [
        {"kind": "error", "agent": "pipeline", "name": "documentos", "detail": "rama documentos: RuntimeError: x"},
    ])
    assert st["fases"]["document_parser"]["estado"] == "error"
    assert st["fases"]["compliance"]["estado"] == "corriendo"
    assert st["fases"]["web_research"]["estado"] == "corriendo"


def test_final_abortado_deja_lo_corriendo_en_error():
    st = _corrida(CORRIDA_BIENES[:4] + [{"kind": "final", "state": {"_aborted": "ocds_unavailable"}}])
    assert st["fases"]["ocds"]["estado"] == "error" and "abortado" in st["fases"]["ocds"]["motivo"]


def test_flujo_secuencial_sin_dag_cierra_por_orden():
    st = _corrida([_ph("ocds"), _ph("compliance"), _ph("document_parser"), _ph("legal"), _ph("market"),
                   _ph("proveedor"), _ph("web_research"), _ph("news"), _ph("entity_personnel"), _ph("person_network")])
    f = st["fases"]
    for k in ("ocds", "compliance", "document_parser", "document_legal_analyst", "market", "proveedor", "web_research", "news_research", "entity_personnel"):
        assert f[k]["estado"] == "hecho", k
    assert f["person_network"]["estado"] == "corriendo"
    assert completadas(f) == ["ocds", "compliance", "document_parser", "document_legal_analyst", "market", "proveedor",
                              "web_research", "news_research", "entity_personnel"]


def test_eventos_guardados_con_nombre_canonico_tambien_expanden_la_investigacion():
    # El dispatcher guarda el evento con el nombre canónico (web_research) y el msg con "∥": al
    # re-reducir (backfill / fallback del frontend) las tres investigaciones arrancan igual.
    st = _corrida([_ph("web_research", "investigación paralela: web_research ∥ news_research ∥ entity_personnel")])
    assert {k for k, v in st["fases"].items() if v["estado"] == "corriendo"} == {"web_research", "news_research", "entity_personnel"}


def test_warn_sin_reintento_no_cambia_nada():
    assert reduce_event({"fases": {"market": {"estado": "corriendo"}}},
                        {"kind": "warn", "name": "market", "msg": "sin ítems comparables"}) == {}
