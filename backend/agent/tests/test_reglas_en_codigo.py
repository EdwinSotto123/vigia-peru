"""Reglas de cumplimiento en código (pipeline_reglas, REGLAS_EN_CODIGO=1): corren sin LLM, en
todos los perfiles, sin repetir duras ni lote 1, y el juicio contextual solo se pide con datos."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pipeline_reglas as R


def _regla(nombre, llamadas, triggered=False, **extra):
    def fn(ocid, tool_context, **kw):
        llamadas.append(nombre)
        return {"regla": nombre, "triggered": triggered, **extra}
    fn.__name__ = f"check_{nombre}_rule"
    return fn


def _pc(reglas_activas, llamadas, estado=None):
    reg = {s: _regla(s, llamadas, triggered=(s == "unico_postor_alto"), severidad="alta", evidencia="1 postor")
           for s in (*R.REGLAS_DURAS, "plazo_convocatoria_minimo", "fraccionamiento", "oferta_igual_valor_referencial")}

    def detect_estado_real(ocid, tool_context):
        llamadas.append("estado_real")
        return {"estado_inconsistente": False, "evidencia": "OCDS=adjudicado; docs sugieren=adjudicado"}

    def analyze_postores_pattern(ocid, tool_context):
        llamadas.append("postores")
        return {"evidencia": "Analizados 3 postores"}

    def persist_alert_from_flags(ocid, tool_context):
        llamadas.append("persist")
        return {"alerta_codigo": "OECE-1"}
    T = SimpleNamespace(detect_estado_real=detect_estado_real, analyze_postores_pattern=analyze_postores_pattern,
                        persist_alert_from_flags=persist_alert_from_flags,
                        REGLAS_LOTE1={"oferta_igual_valor_referencial": reg["oferta_igual_valor_referencial"]})
    return SimpleNamespace(state=dict(estado or {}), dag=False, ocid="123", reglas_por_nombre=reg, T=T,
                           profile=SimpleNamespace(reglas_activas=frozenset(reglas_activas), nombre="bienes"))


async def _consumir(gen):
    return [e async for e in gen]


def test_fase_compliance_en_codigo_corre_duras_y_crea_alerta():
    llamadas: list = []
    pc = _pc(R.REGLAS_DURAS, llamadas)
    eventos = asyncio.run(_consumir(R.fase_compliance_codigo(pc)))
    assert llamadas == [*R.REGLAS_DURAS, "estado_real", "postores", "persist"]
    assert pc.state["estado_real"]["estado_inconsistente"] is False
    res = pc.state["compliance_result"]
    assert "unico_postor_alto: DISPARÓ (alta)" in res and "Alerta: OECE-1" in res
    assert any(e.get("kind") == "transfer" and e.get("to") == "compliance_agent" for e in eventos)


def test_reglas_extendidas_sin_duras_ni_lote1_y_con_las_del_perfil():
    llamadas: list = []
    activas = {*R.REGLAS_DURAS, "plazo_convocatoria_minimo", "fraccionamiento", "oferta_igual_valor_referencial",
               "regla_sin_implementar"}
    pc = _pc(activas, llamadas)
    eventos = asyncio.run(_consumir(R.reglas_extendidas_codigo(pc, {})))
    assert sorted(llamadas) == ["fraccionamiento", "plazo_convocatoria_minimo"]
    fase = next(e for e in eventos if e.get("name") == "compliance_rules")
    assert "sin implementación: regla_sin_implementar" in fase["msg"]


def test_juicio_solo_con_datos():
    llamadas: list = []
    assert not R.hay_datos_para_juicio(_pc(set(), llamadas, {"sunat_decolecta": {"error": "HTTP 401"}}))
    assert not R.hay_datos_para_juicio(_pc(set(), llamadas, {"web_research": "", "person_network": {}}))
    assert R.hay_datos_para_juicio(_pc(set(), llamadas, {"web_research": {"hallazgos_por_fuente": [{"estado": "hallado"}]}}))


def test_mensaje_juicio_trae_monto_y_reglas_disparadas():
    pc = _pc(set(), [], {"ocds": {"awards": [{"value": {"amount": 50000, "currency": "PEN"},
                                              "suppliers": [{"name": "EMPRESA SAC", "id": "PE-RUC-20123456789"}]}]},
                         "pending_flags": [{"regla": "unico_postor_alto", "severidad": "alta", "evidencia": "1 postor"}]})
    msg = R.mensaje_juicio(pc)
    assert "50000" in msg and "unico_postor_alto" in msg and "OCID 123" in msg
