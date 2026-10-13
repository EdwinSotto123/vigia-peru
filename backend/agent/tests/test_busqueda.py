"""Búsqueda web propia (tools/busqueda.py): parseo de la respuesta de Anthropic, URLs a grounding_urls, selector."""
import asyncio

from tools import busqueda

RESP = {
    "content": [
        {"type": "server_tool_use", "name": "web_search"},
        {"type": "web_search_tool_result", "content": [
            {"type": "web_search_result", "title": "Contraloría", "url": "https://www.gob.pe/contraloria", "page_age": "2026"},
            {"type": "web_search_result", "title": "Wiki", "url": "https://es.wikipedia.org/wiki/X"}]},
        {"type": "text", "text": "La sede es gob.pe/contraloria.",
         "citations": [{"url": "https://www.gob.pe/contraloria", "title": "Contraloría", "cited_text": "Portal oficial"},
                       {"url": "https://otra.pe/nota", "title": "Nota", "cited_text": "x"}]},
    ],
    "usage": {"input_tokens": 1000, "output_tokens": 200, "server_tool_use": {"web_search_requests": 2}},
}


def test_parsear_fuentes_citas_y_uso():
    r = busqueda._parsear(RESP)
    assert [f["url"] for f in r["fuentes"]] == ["https://www.gob.pe/contraloria", "https://es.wikipedia.org/wiki/X", "https://otra.pe/nota"]
    assert len(r["citas"]) == 2 and r["resumen"].startswith("La sede")
    assert r["_busquedas"] == 2


def test_publicar_en_grounding_sin_duplicar():
    st = {"grounding_urls": ["https://www.gob.pe/contraloria"]}
    busqueda._publicar(st, busqueda._parsear(RESP)["fuentes"])
    assert st["grounding_urls"].count("https://www.gob.pe/contraloria") == 1 and len(st["grounding_urls"]) == 3


def test_sin_clave_no_revienta(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = asyncio.run(busqueda.google_search("x"))
    assert "error" in r and r["fuentes"] == []


def test_selector_y_proveedor(monkeypatch):
    monkeypatch.setenv("BUSQUEDA_WEB", "anthropic")
    assert busqueda.herramienta_busqueda() is busqueda.google_search
    from agents._shared.models import usa_busqueda_gemini
    assert usa_busqueda_gemini([busqueda.google_search]) is False
    monkeypatch.setenv("BUSQUEDA_WEB", "google")
    assert usa_busqueda_gemini([busqueda.herramienta_busqueda()]) is True


def test_resultados_externos_serper_brave_tavily():
    s = busqueda._resultados_externos("serper", {"organic": [{"title": "A", "link": "https://a.pe", "snippet": "x"}],
                                                  "answerBox": {"snippet": "resp", "link": "https://b.pe", "title": "B"}})
    assert [r["url"] for r in s] == ["https://b.pe", "https://a.pe"]
    b = busqueda._resultados_externos("brave", {"web": {"results": [{"title": "A", "url": "https://a.pe", "description": "d", "age": "1d"}]}})
    assert b[0]["extracto"] == "d"
    t = busqueda._resultados_externos("tavily", {"results": [{"title": "A", "url": "https://a.pe", "content": "c"}, {"title": "sin url"}]})
    assert len(t) == 1


def test_externo_sin_clave_y_publica_urls(monkeypatch):
    monkeypatch.setenv("BUSQUEDA_PROVEEDOR", "serper")
    monkeypatch.delenv("SERPER_API_KEY", raising=False)
    assert "SERPER_API_KEY" in asyncio.run(busqueda.google_search("x"))["error"]

    class R:
        status_code = 200
        text = ""
        def json(self): return {"organic": [{"title": "A", "link": "https://a.pe", "snippet": "dato"}]}

    class Cli:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return R()

    import httpx
    monkeypatch.setenv("SERPER_API_KEY", "k")
    monkeypatch.setattr(httpx, "AsyncClient", lambda **k: Cli())

    class Ctx:
        state = {}

    ctx = Ctx()
    r = asyncio.run(busqueda.google_search("x", ctx))
    assert r["fuentes"][0]["url"] == "https://a.pe" and ctx.state["grounding_urls"] == ["https://a.pe"] and "dato" in r["resumen"]
