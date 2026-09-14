from backend.dispatcher.events import FASES, reduce_event


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
    # deterministic.py emite "legal", "research_parallel" y "news"; el público ve las fases canónicas.
    assert reduce_event({}, {"kind": "phase", "name": "legal"}) == {"fase_actual": "document_legal_analyst", "fase_index": 2}
    assert reduce_event({}, {"kind": "phase", "name": "research_parallel"})["fase_index"] == FASES.index("web_research")
    assert reduce_event({}, {"kind": "phase", "name": "news"})["fase_actual"] == "news_research"


def test_phase_sin_indice_previo_no_inventa_indice():
    st = reduce_event({}, {"kind": "phase", "name": "ocds", "msg": "obteniendo OCDS"})
    assert st == {"fase_actual": "ocds"}


def test_final_abortado_no_cuenta_como_procesado():
    st = reduce_event({}, {"kind": "final", "final_response": "OCDS no disponible — análisis abortado.",
                           "state": {"_aborted": "ocds_unavailable"}})
    assert st["terminado"] is True and st["abortado"] == "ocds_unavailable"
    assert "fase_index" not in st and "ocds_unavailable" in st["error"]


def test_final_con_runner_error_es_abortado():
    st = reduce_event({}, {"kind": "final", "runner_error": {"kind": "runner_exception", "msg": "boom"}})
    assert st["abortado"] == "boom"
