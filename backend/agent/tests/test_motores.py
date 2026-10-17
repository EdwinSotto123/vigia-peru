"""Selector de motor de agentes y motor por SDK, con un SDK falso (sin el paquete real ni red)."""
import asyncio
import sys
import types
from dataclasses import dataclass, field

import pytest

import motores
from motores import motor_sdk
from motores.motor_sdk import herramientas as h


# ─── selector ──────────────────────────────────────────────────────────────────
def test_por_defecto_es_adk(monkeypatch):
    monkeypatch.delenv("MOTOR_AGENTES", raising=False)
    assert motores.nombre() == "adk"
    from pipeline_runtime import _run_agent
    assert motores.funciones()[0] is _run_agent


def test_sdk_y_valor_invalido(monkeypatch):
    monkeypatch.setenv("MOTOR_AGENTES", "sdk")
    assert motores.funciones()[2] is motor_sdk.run_agent_delta
    monkeypatch.setenv("MOTOR_AGENTES", "otro")
    with pytest.raises(ValueError):
        motores.nombre()


# ─── piezas ────────────────────────────────────────────────────────────────────
def test_esquema_json_de_declaracion_genai():
    from google.genai import types as gt
    s = gt.Schema(type="OBJECT", properties={"ruc": gt.Schema(type="STRING", description="RUC"),
                                             "n": gt.Schema(type="INTEGER")}, required=["ruc"])
    assert h.esquema_json(s) == {"type": "object", "required": ["ruc"],
                                 "properties": {"ruc": {"type": "string", "description": "RUC"}, "n": {"type": "integer"}}}


def test_inyeccion_del_prompt_como_adk():
    st = {"ocid": "123", "perfil": {"a": 1}}
    out = motor_sdk._inyectar('OCID {ocid} · {perfil} · {falta?} · {falta} · JSON {"x": 1}', st)
    assert out == 'OCID 123 · {"a": 1} ·  · {falta} · JSON {"x": 1}'


# ─── corrida con un SDK falso ──────────────────────────────────────────────────
@dataclass
class AssistantMessage:
    content: list


@dataclass
class TextBlock:
    text: str


@dataclass
class ResultMessage:
    result: str
    structured_output: dict | None
    usage: dict = field(default_factory=lambda: {"input_tokens": 100, "output_tokens": 20})
    is_error: bool = False
    subtype: str = "success"
    errors: list = field(default_factory=list)


def _sdk_falso(registro: dict):
    m = types.ModuleType("sdk_falso")

    def tool(nombre, desc, schema):
        def deco(f):
            return types.SimpleNamespace(name=nombre, handler=f, schema=schema)
        return deco

    def create_sdk_mcp_server(nombre, tools=None, version="1"):
        registro["tools"] = tools or []
        return {"nombre": nombre}

    class FalsoAgentOptions:
        def __init__(self, **kw):
            registro["opciones"] = kw

    async def query(prompt, options):
        # El "modelo" llama la herramienta y responde con la salida estructurada.
        t = registro["tools"][0]
        r = await t.handler({"ruc": "20100000001"})
        registro["resultado_tool"] = r
        yield AssistantMessage(content=[TextBlock(text="listo")])
        yield ResultMessage(result="listo", structured_output={"hallazgos": 1})

    m.tool, m.create_sdk_mcp_server, m.FalsoAgentOptions, m.query = tool, create_sdk_mcp_server, FalsoAgentOptions, query
    return m


def test_run_agent_delta_con_sdk_falso(monkeypatch):
    reg: dict = {}
    sys.modules["sdk_falso"] = _sdk_falso(reg)
    monkeypatch.setenv("MOTOR_SDK_MODULO", "sdk_falso")
    monkeypatch.setenv("MOTOR_SDK_MODELO", "modelo-x")
    monkeypatch.setenv("MOTOR_SDK_ESQUEMA", "0")

    def consultar_ruc(ruc: str, tool_context=None) -> dict:
        tool_context.state.setdefault("pending_flags", []).append({"regla": "x", "ruc": ruc})
        return {"ok": True, "ruc": ruc}

    from google.adk.tools import FunctionTool
    agente = types.SimpleNamespace(name="web_research_agent", instruction="Analiza {ocid}.",
                                   tools=[FunctionTool(consultar_ruc)], output_key="web_research")
    base = {"ocid": "999", "pending_flags": [{"regla": "previa"}]}
    evs, texto, delta, metr = asyncio.run(motor_sdk.run_agent_delta(agente, "hola", base, None, "u", "web_research"))

    assert texto == "listo"
    assert delta["web_research"] == {"hallazgos": 1}
    assert delta["pending_flags"] == [{"regla": "previa"}, {"regla": "x", "ruc": "20100000001"}]
    assert base["pending_flags"] == [{"regla": "previa"}]            # el estado compartido no se toca
    assert reg["opciones"]["system_prompt"] == "Analiza 999."
    assert reg["opciones"]["allowed_tools"] == ["mcp__vigia__consultar_ruc"] and reg["opciones"]["tools"] == []
    assert [e["kind"] for e in evs if e["kind"] in ("tool_call", "tool_result")] == ["tool_call", "tool_result"]
    assert metr["prompt"] == 100 and metr["output"] == 20
    assert '"ok": true' in reg["resultado_tool"]["content"][0]["text"]
