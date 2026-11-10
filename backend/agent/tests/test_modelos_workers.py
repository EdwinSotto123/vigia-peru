"""El modelo de Workers AI de cada agente: el SMART (p. ej. DeepSeek V4 Pro) sólo para los de juicio complejo."""
import importlib


def test_smart_solo_para_los_agentes_complejos(monkeypatch):
    monkeypatch.setenv("WORKERS_AI_MODEL", "@cf/zai-org/glm-5.3-flash")
    monkeypatch.setenv("WORKERS_AI_MODEL_SMART", "@cf/deepseek-ai/deepseek-v4-pro-0813")
    import agents._shared.models as m
    m = importlib.reload(m)
    try:
        assert m.modelo_workers(m._MODEL_SMART, "report_writer_agent") == "@cf/deepseek-ai/deepseek-v4-pro-0813"
        assert m.modelo_workers(m._MODEL_SMART, "person_network_agent") == "@cf/deepseek-ai/deepseek-v4-pro-0813"
        assert m.modelo_workers(m._MODEL_DEFAULT, "web_research_agent") == "@cf/zai-org/glm-5.3-flash"
        assert m.modelo_workers(m._MODEL_FAST, "report_writer_agent") == m.WORKERS_AI_MODEL_FAST
    finally:
        monkeypatch.delenv("WORKERS_AI_MODEL_SMART")
        importlib.reload(m)


def test_sin_smart_es_el_de_siempre(monkeypatch):
    monkeypatch.delenv("WORKERS_AI_MODEL_SMART", raising=False)
    monkeypatch.setenv("WORKERS_AI_MODEL", "@cf/zai-org/glm-5.3-flash")
    import agents._shared.models as m
    m = importlib.reload(m)
    assert m.modelo_workers(m._MODEL_SMART, "report_writer_agent") == "@cf/zai-org/glm-5.3-flash"
