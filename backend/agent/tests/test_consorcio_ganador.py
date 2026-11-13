"""Un consorcio ganador se investiga por sus integrantes. En PROD (2026-11-13) el 86 % de las obras y el 84 % de las
consultorías las ganó un consorcio (código del SEACE, sin RUC propio) y quedaban sin prensa, sin red de personas y sin
reglas extendidas («proveedor_sin_ruc»)."""
import asyncio
from types import SimpleNamespace

import pipeline_phases
from pipeline_guardrails import _bloque_validaciones

INVESTIGACION = ("web_research", "news_research", "person_network", "compliance_extended")


def _pc(ruc_ganador: str, monkeypatch, miembros: list[dict]):
    llamadas: list[tuple[str, dict]] = []

    def _tool(fn, fname, state, agent="pipeline", **kw):
        llamadas.append((fname, kw))
        return [], fn(**kw)

    monkeypatch.setattr(pipeline_phases, "_tool", _tool)
    monkeypatch.setattr(pipeline_phases, "flags_from_senales", lambda pc, senales, fuente: [])
    import tools.expediente as expediente
    monkeypatch.setattr(expediente, "integrantes_consorcio", lambda codigo, conn=None: miembros)
    T = SimpleNamespace(
        get_ganador=lambda ocid: {"ganador": {"ruc": ruc_ganador, "razon_social": "CONSORCIO CAFETALEROS"},
                                  "entidad": {"ruc": "20131378972"}, "todos_postores": []},
        query_expediente_proveedor=lambda ruc, entidad_ruc, ocid: {"ruc": ruc, "consorcio": True, "senales": []},
        query_oece_perfil=lambda ruc: {"found": False},
        query_sunat_decolecta=lambda ruc: {"found": False},
        query_edad_ciiu_web=lambda ruc, razon_social: {},
        read_sunat_profile=lambda: {},
    )
    state = {"agentes_permitidos": ["compliance", "document_parser", "report_writer"],
             "validaciones_pendientes": ["proveedor_sin_ruc"]}
    perfil = SimpleNamespace(nombre="obras", agentes=("compliance", "document_parser", *INVESTIGACION, "report_writer"))
    pc = SimpleNamespace(state=state, ctx={}, ocid="1226205", T=T, dag=False, profile=perfil,
                         perm=lambda n: n in state["agentes_permitidos"])
    return pc, llamadas


def _correr(pc):
    async def _run():
        return [e async for e in pipeline_phases.fase_proveedor(pc)]
    return asyncio.run(_run())


def test_un_consorcio_recupera_la_investigacion_por_sus_integrantes(monkeypatch):
    miembros = [{"ruc": "20611756101", "nombre": "KALED & CASAS S.A.C.", "consorcio": "CONSORCIO CAFETALEROS"},
                {"ruc": "20574615942", "nombre": "GRUPO SAN CRISTOBAL S.A.C.", "consorcio": "CONSORCIO CAFETALEROS"}]
    monkeypatch.setenv("OECE_EN_VIVO", "1")
    pc, llamadas = _pc("1808604", monkeypatch, miembros)
    eventos = _correr(pc)
    assert all(pc.perm(a) for a in INVESTIGACION)                       # ya no se saltan
    assert not pc.perm("entity_personnel")                              # lo que no es del proveedor sigue como estaba
    assert [m["ruc"] for m in pc.ctx["integrantes"]] == ["20611756101", "20574615942"]
    assert any("consorcio de 2 integrante" in (e.get("msg") or "") for e in eventos)
    # Con el código del consorcio no se consulta el OECE ni SUNAT en vivo (devolvían «no encontrado» y pisaban las señales).
    assert not {f for f, _ in llamadas} & {"query_oece_perfil", "query_sunat_decolecta", "query_edad_ciiu_web"}


def test_un_consorcio_sin_integrantes_conocidos_sigue_sin_investigacion(monkeypatch):
    pc, _ = _pc("1808604", monkeypatch, [])
    _correr(pc)
    assert not any(pc.perm(a) for a in INVESTIGACION) and pc.ctx["integrantes"] == []


def test_la_nota_de_validacion_dice_que_se_investigo_a_los_integrantes():
    sin = _bloque_validaciones({"validaciones_pendientes": ["proveedor_sin_ruc"]})
    con = _bloque_validaciones({"validaciones_pendientes": ["proveedor_sin_ruc"],
                                "expediente_proveedor": {"consorcio": True, "integrantes": [{"ruc": "20611756101"}]}})
    assert "no se investigó" in sin and "no se investigó" not in con and "integrantes" in con


def test_un_integrante_del_consorcio_ganador_no_es_su_rival():
    """Prueba de oro de obras 2026-11-13: el integrante figuraba también como participante y «compartía» su propio
    socio con el consorcio."""
    from tools.compliance_rules._rules_lote1 import _socios_por_postor
    socio = {"nombre": "QUISPE MAMANI JUAN", "numero_documento": "40111222"}
    state = {"person_network_context": {
        "rnp_proveedor": {"consorcio": True, "integrantes": [{"ruc": "20611756101"}], "socios": [socio]},
        "socios_postores_rivales": [
            {"ruc_postor": "20611756101", "razon_social": "KALED & CASAS S.A.C.", "socios": [{"nombre": socio["nombre"], "dni": "40111222"}]},
            {"ruc_postor": "20574615942", "razon_social": "OTRA S.A.C.", "socios": [{"nombre": "ROJAS PAZ ANA", "dni": "40333444"}]}]}}
    rucs = [x["ruc"] for x in _socios_por_postor(state) if not x.get("es_ganador")]
    assert rucs == ["20574615942"]
