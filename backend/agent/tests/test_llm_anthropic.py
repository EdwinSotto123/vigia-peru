"""Adaptador de cliente genai → Anthropic (tools/llm_anthropic.py): traducción de contents/config y de la respuesta."""
import json

from google.genai import types as gt
from pydantic import BaseModel

from tools import llm_anthropic as la


class Veredicto(BaseModel):
    ok: bool
    motivo: str


def test_mensajes_texto_pdf_e_imagen():
    m = la._mensajes([gt.Part.from_text(text="hola"), gt.Part.from_bytes(data=b"%PDF", mime_type="application/pdf"),
                      gt.Part.from_bytes(data=b"\x89PNG", mime_type="image/png")])
    b = m[0]["content"]
    assert [x["type"] for x in b] == ["text", "document", "image"] and b[1]["source"]["media_type"] == "application/pdf"
    assert la._mensajes("x") == [{"role": "user", "content": "x"}]


def test_esquema_genai_y_pydantic():
    s = gt.Schema(type="OBJECT", properties={"a": gt.Schema(type="STRING", nullable=True), "n": gt.Schema(type="ARRAY", items=gt.Schema(type="INTEGER"))})
    j = la._json_schema(s)
    assert j["type"] == "object" and j["properties"]["a"]["type"] == ["string", "null"] and j["properties"]["n"]["items"]["type"] == "integer"
    assert la._json_schema(Veredicto)["properties"]["ok"]["type"] == "boolean"


def test_generate_content_herramienta_forzada(monkeypatch):
    visto = {}

    def post(requests, headers, cuerpo, **k):
        visto.update(cuerpo)
        return {"stop_reason": "tool_use", "content": [{"type": "tool_use", "name": "responder", "input": {"ok": True, "motivo": "x"}}],
                "usage": {"input_tokens": 100, "output_tokens": 20}}

    monkeypatch.setattr(la, "_post", post)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    cfg = gt.GenerateContentConfig(response_mime_type="application/json", response_schema=Veredicto, temperature=0.0,
                                   system_instruction="sé breve", max_output_tokens=500, labels={"vigia_etapa": "self_eval"})
    r = la._Modelos().generate_content(model="gemini-3.5-flash-lite", contents="evalúa", config=cfg)
    assert json.loads(r.text) == {"ok": True, "motivo": "x"}
    assert visto["tool_choice"]["name"] == "responder" and visto["thinking"] == {"type": "disabled"} and visto["system"] == "sé breve"
    assert visto["max_tokens"] == 500 and "temperature" not in visto
    assert r.usage_metadata.prompt_token_count == 100 and r.candidates[0].finish_reason == "STOP"


def test_esquema_no_objeto_se_envuelve(monkeypatch):
    monkeypatch.setattr(la, "_post", lambda *a, **k: {"stop_reason": "tool_use", "usage": {},
                        "content": [{"type": "tool_use", "name": "responder", "input": {"valor": [1, 2]}}]})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    cfg = gt.GenerateContentConfig(response_mime_type="application/json", response_schema=gt.Schema(type="ARRAY", items=gt.Schema(type="INTEGER")))
    assert json.loads(la._Modelos().generate_content(model="m", contents="x", config=cfg).text) == [1, 2]


def test_max_tokens_marca_truncado(monkeypatch):
    monkeypatch.setattr(la, "_post", lambda *a, **k: {"stop_reason": "max_tokens", "content": [{"type": "text", "text": "{"}], "usage": {}})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    r = la._Modelos().generate_content(model="m", contents="x", config=gt.GenerateContentConfig(response_mime_type="application/json"))
    assert r.candidates[0].finish_reason == "MAX_TOKENS" and r.text == "{"


def test_core_usa_el_adaptador(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "anthropic")
    from tools._core import _gemini_client
    assert isinstance(_gemini_client(), la.ClienteAnthropic)


def test_busqueda_devuelve_grounding_sintetico_que_entiende_el_parser_de_precios(monkeypatch):
    """tools=[google_search] → web_search de Anthropic + grounding_metadata con offsets en bytes y URLs reales."""
    from tools.market import goods_retail as g

    t1 = "Ítem 1: El producto \"Laptop HP 15\" se ofrece a S/ 2999.00 por Unidad en HP Perú."
    t2 = "\nÍtem 2: sin precios observados"
    resp = {"stop_reason": "end_turn", "usage": {"input_tokens": 10, "output_tokens": 5, "server_tool_use": {"web_search_requests": 1}},
            "content": [{"type": "server_tool_use", "name": "web_search", "input": {"query": "laptop hp precio peru"}},
                        {"type": "web_search_tool_result", "content": []},
                        {"type": "text", "text": t1, "citations": [{"url": "https://www.hp.com/pe-es/x", "title": "HP", "cited_text": "2999"}]},
                        {"type": "text", "text": t2}]}
    visto = {}
    monkeypatch.setattr(la, "_post", lambda r, h, c, **k: visto.update(c) or resp)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    cfg = gt.GenerateContentConfig(tools=[gt.Tool(google_search=gt.GoogleSearch())], labels={"vigia_etapa": "mercado"})
    r = la._Modelos().generate_content(model="m", contents="precia", config=cfg)
    assert visto["tools"][0]["type"] == "web_search_20250305" and "tool_choice" not in visto
    assert r.text == t1 + t2
    gm = r.candidates[0].grounding_metadata
    assert gm.web_search_queries == ["laptop hp precio peru"]
    out = g._parsear_worker(r.text, gm, [{"numero": "1"}, {"numero": "2"}])
    assert [p["precio"] for p in out["precios"]] == [2999.0] and out["precios"][0]["fuentes"][0]["uri"] == "https://www.hp.com/pe-es/x"
    assert out["sin_precios"] == {"2"}
