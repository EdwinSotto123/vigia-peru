"""Enrutado por tipo de contratación → servicio de agentes (AGENT_URL_<PERFIL>)."""
import pytest

from backend.dispatcher.main import PERFIL_DE_TIPO, perfil_de, url_para

ENV_COMPLETO = {
    "AGENT_URL": "https://viejo.run.app/",
    "AGENT_URL_BIENES": "https://bienes.run.app",
    "AGENT_URL_SERVICIOS": "https://servicios.run.app/",
    "AGENT_URL_OBRAS": "https://obras.run.app",
    "AGENT_URL_OTROS": "https://otros.run.app",
}


@pytest.mark.parametrize("tipo,perfil", [
    ("bienes", "bienes"), ("servicios", "servicios"), ("obras", "obras"),
    ("consultoria", "otros"), ("convenio", "otros"), ("directa", "otros"), ("otro", "otros"),
    ("OBRAS", "obras"), (" directa ", "otros"),
])
def test_perfil_de_tipo(tipo, perfil):
    assert perfil_de(tipo) == perfil


def test_perfil_desconocido_o_vacio():
    assert perfil_de(None) is None and perfil_de("") is None and perfil_de("x") is None
    assert set(PERFIL_DE_TIPO.values()) == {"bienes", "servicios", "obras", "otros"}


def test_url_por_tipo_con_todas_configuradas():
    assert url_para("bienes", ENV_COMPLETO) == ("https://bienes.run.app", "bienes")
    assert url_para("servicios", ENV_COMPLETO) == ("https://servicios.run.app", "servicios")  # sin barra final
    assert url_para("obras", ENV_COMPLETO) == ("https://obras.run.app", "obras")
    for t in ("consultoria", "convenio", "directa", "otro"):
        assert url_para(t, ENV_COMPLETO) == ("https://otros.run.app", "otros")


def test_fallback_agent_url_solo_para_bienes_y_sin_clasificacion():
    env = {"AGENT_URL": "https://viejo.run.app/"}
    assert url_para("bienes", env) == ("https://viejo.run.app", "bienes")
    assert url_para(None, env) == ("https://viejo.run.app", "bienes")
    # servicios/obras/otros NUNCA van al de bienes: quedan pendientes
    assert url_para("servicios", env) == (None, "servicios")
    assert url_para("obras", env) == (None, "obras")
    assert url_para("directa", env) == (None, "otros")


def test_tipo_desconocido_no_enruta():
    assert url_para("misterioso", ENV_COMPLETO) == (None, None)


def test_sin_ninguna_url():
    assert url_para("bienes", {}) == (None, "bienes")
    assert url_para(None, {}) == (None, None)


def test_agent_url_bienes_tiene_prioridad_sobre_agent_url():
    env = {"AGENT_URL": "https://viejo.run.app", "AGENT_URL_BIENES": "https://bienes.run.app"}
    assert url_para("bienes", env) == ("https://bienes.run.app", "bienes")
    # sin clasificación se usa el histórico (a demanda, acepta cualquier tipo)
    assert url_para(None, env) == ("https://viejo.run.app", "bienes")
