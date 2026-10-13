"""Interruptores de proveedor de modelos: Gemini (Vertex) por defecto, Workers AI solo si se pide y se puede."""
import importlib

import pytest


def _cargar(monkeypatch, **env):
    for k in ("USAR_WORKERS_AI", "USAR_WORKERS_AI_PERSON_NETWORK", "USAR_WORKERS_AI_WEB_RESEARCH", "WORKERS_AI_URL"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    from agents._shared import models
    return importlib.reload(models)


class _Busqueda:
    name = "google_search"


def test_por_defecto_todo_es_gemini(monkeypatch):
    m = _cargar(monkeypatch)
    assert m.proveedor_para("person_network_agent") == "gcp"
    assert m.resolver_modelo("gemini-3.6-flash", "person_network_agent") == "gemini-3.6-flash"


def test_sin_url_no_hay_a_donde_llamar_y_se_queda_en_gemini(monkeypatch):
    m = _cargar(monkeypatch, USAR_WORKERS_AI="1")
    assert m.proveedor_para("person_network_agent") == "gcp"


def test_global_activo_pasa_a_cloudflare(monkeypatch):
    m = _cargar(monkeypatch, USAR_WORKERS_AI="1", WORKERS_AI_URL="https://llm.example/v1")
    assert m.proveedor_para("person_network_agent") == "cloudflare"


def test_interruptor_por_agente_gana_sobre_el_global(monkeypatch):
    m = _cargar(monkeypatch, USAR_WORKERS_AI="1", USAR_WORKERS_AI_PERSON_NETWORK="0", WORKERS_AI_URL="https://llm.example/v1")
    assert m.proveedor_para("person_network_agent") == "gcp"
    assert m.proveedor_para("report_writer_agent") == "cloudflare"


def test_solo_un_agente_encendido(monkeypatch):
    m = _cargar(monkeypatch, USAR_WORKERS_AI_WEB_RESEARCH="1", WORKERS_AI_URL="https://llm.example/v1")
    assert m.proveedor_para("web_research_agent") == "cloudflare"
    assert m.proveedor_para("person_network_agent") == "gcp"


def test_agente_con_google_search_nunca_sale_de_gemini(monkeypatch):
    m = _cargar(monkeypatch, USAR_WORKERS_AI="1", USAR_WORKERS_AI_WEB_RESEARCH="1", WORKERS_AI_URL="https://llm.example/v1")
    assert m.proveedor_para("web_research_agent", [_Busqueda()]) == "gcp"


def test_en_cloudflare_no_hay_planner_de_gemini(monkeypatch):
    m = _cargar(monkeypatch, USAR_WORKERS_AI="1", WORKERS_AI_URL="https://llm.example/v1")
    assert m.build_planner("person_network_agent", "gemini-3.6-flash", "high") is None


def test_resolver_modelo_cloudflare_arma_litellm_o_cae_a_gemini(monkeypatch):
    m = _cargar(monkeypatch, USAR_WORKERS_AI="1", WORKERS_AI_URL="https://llm.example/v1")
    r = m.resolver_modelo("gemini-3.6-flash", "person_network_agent")
    try:
        import litellm  # noqa: F401
    except Exception:
        assert r == "gemini-3.6-flash"  # sin litellm no se rompe: vuelve a Gemini
    else:
        assert not isinstance(r, str)


@pytest.fixture(autouse=True)
def _restaurar():
    yield
    from agents._shared import models
    importlib.reload(models)


def test_anthropic_por_agente_y_global(monkeypatch):
    import importlib
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-x")
    monkeypatch.setenv("WORKERS_AI_URL", "https://x/v1")
    from agents._shared import models
    importlib.reload(models)
    monkeypatch.setenv("USAR_ANTHROPIC_REPORT_WRITER", "1")
    assert models.proveedor_para("report_writer_agent") == "anthropic"
    assert models.proveedor_para("person_network_agent") == "gcp"
    monkeypatch.setenv("USAR_WORKERS_AI", "1")
    assert models.proveedor_para("person_network_agent") == "cloudflare"
    monkeypatch.setenv("USAR_ANTHROPIC", "1")
    assert models.proveedor_para("person_network_agent") == "anthropic"
    monkeypatch.setenv("USAR_ANTHROPIC_REPORT_WRITER", "0")
    assert models.proveedor_para("report_writer_agent") == "gcp"
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert models.proveedor_para("person_network_agent") == "cloudflare"


def test_tarifa_haiku():
    from tools import costo_llm
    assert costo_llm.tarifa("anthropic/claude-haiku-5-5") == (0.10, 0.50)
