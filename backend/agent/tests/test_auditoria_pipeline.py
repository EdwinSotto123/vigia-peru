"""Auditoría del pipeline de agentes (2026-11-14): contexto entre agentes, reglas que se perdían y jerga."""
from types import SimpleNamespace

from tools import verify


def test_decir_que_una_regla_no_disparo_no_es_citar_una_bandera_inexistente():
    md = "Las reglas `proveedor_sancionado_osce` y `unico_postor_alto` no dispararon.\nSe detectó `directa_recurrente` (alta)."
    v = verify.verificar_dictamen(md, {})
    assert "proveedor_sancionado_osce" not in v["banderas_no_existentes"]
    assert "unico_postor_alto" not in v["banderas_no_existentes"]
    assert "directa_recurrente" in v["banderas_no_existentes"]


def test_la_suma_que_calcula_la_regla_esta_respaldada_por_la_regla():
    flag = {"regla": "fraccionamiento", "suma_soles": 562500.0, "procesos_relacionados": [{"cuantia": 85500.0}],
            "evidencia": "Dos procesos con la misma entidad suman S/ 562,500.00 en 90 días."}
    res = verify.verificar_bandera(flag, {})
    assert "monto:562,500.00:calculo_de_la_regla" in res["motivos"] and res["ok"] is True
    del_modelo = {"regla": "red_flag_documental", "_source": "orchestrator_paso_7.7", "suma_soles": 562500.0,
                  "evidencia": "Suman S/ 562,500.00."}
    assert verify.verificar_bandera(del_modelo, {})["ok"] is False


def test_el_dictamen_sale_sin_palabras_internas():
    md = ("No hay banderas persistidas en base de datos en esta corrida. La regla determinista quedó `sin_dato`; "
          "`market_analysis` no trae precios (el modelo compatible no lee imágenes) y hay 12 páginas rasterizadas.")
    limpio, n = verify.quitar_jerga(md)
    for mala in ("persistid", "esta corrida", "determinista", "sin_dato", "market_analysis", "modelo compatible", "rasterizad"):
        assert mala not in limpio, (mala, limpio)
    assert "banderas registradas" in limpio and "este análisis" in limpio and "páginas escaneadas" in limpio and n >= 6


def test_una_evidencia_que_dice_que_no_se_emite_no_registra_bandera():
    from tools.persistence.alert_flags import add_contextual_flag
    ctx = SimpleNamespace(state={})
    r = add_contextual_flag("capacidad_operativa_cuestionable", "media", "NO SE EMITE: empresa consolidada.", "", ctx)
    assert r["ok"] is False and not ctx.state.get("pending_flags")
    assert add_contextual_flag("rubro_ciiu_incongruente", "media", "El giro no coincide con el objeto.", "", ctx)["ok"] is True


def test_tras_varias_busquedas_vacias_el_agente_deja_de_buscar(monkeypatch):
    import asyncio

    from tools import busqueda, busqueda_libre
    llamadas = []

    async def _vacia(consulta):
        llamadas.append(consulta)
        return {"resultados": [], "fuentes_usadas": ["bing_news"], "avisos": []}

    monkeypatch.setenv("BUSQUEDA_PROVEEDOR", "libre")
    monkeypatch.setattr(busqueda_libre, "buscar", _vacia)
    ctx = SimpleNamespace(state={}, invocation_id="inv-1", agent_name="entity_personnel_agent")
    for i in range(8):
        out = asyncio.run(busqueda.google_search(f"consulta {i}", ctx))
    assert len(llamadas) == busqueda._VACIAS_SEGUIDAS and out.get("agotado") is True
    otro = SimpleNamespace(state={}, invocation_id="inv-1", agent_name="web_research_agent")
    asyncio.run(busqueda.google_search("otra", otro))
    assert len(llamadas) == busqueda._VACIAS_SEGUIDAS + 1   # la cuenta es por agente


def test_un_integrante_del_consorcio_y_un_postor_repetido_no_son_otra_oferta():
    from tools.compliance_rules._base import _sin_oferta, _sin_repetidos
    assert _sin_oferta("integrante_consorcio") and not _sin_oferta("admitida")
    assert len(_sin_repetidos([{"razon_social": "CONSORCIO VIAL S.A.C."}, {"razon_social": "Consorcio Vial SAC"}, {"razon_social": "OTRA"}])) == 2


def test_el_resumen_del_expediente_no_lleva_el_ruc_de_una_persona_natural():
    from tools.expediente import resumen_para_agentes
    exp = {"consorcio": True, "nombre": "CONSORCIO X", "integrantes": [
        {"ruc": "10123456789", "persona_natural": True, "nombre": "PEREZ ••• JUAN", "historial": {"procesos": 2}},
        {"ruc": "20100000001", "persona_natural": False, "nombre": "EMPRESA SAC", "historial": {"procesos": 8, "con_esta_entidad": {"procesos": 3}}}]}
    r = resumen_para_agentes(exp)
    assert "10123456789" not in str(r) and r["integrantes"][1]["contratos_con_el_estado"]["procesos"] == 8


def test_lo_verificado_en_codigo_no_pasa_por_el_juez_de_respaldo():
    """PROD 2026-11-14: 2 088 análisis retenidos sólo porque el juez, que ve el OCDS, rechazaba reglas del acta."""
    from tools.self_eval import _verificada_en_codigo
    ok = {"ok": True, "motivos": []}
    assert _verificada_en_codigo({"regla": "unica_oferta_valida", "agente_origen": "compliance_agent", "verificacion": ok}, None)
    assert _verificada_en_codigo({"regla": "red_flag_documental", "agente_origen": "document_legal_analyst_agent", "verificacion": ok}, None)
    assert not _verificada_en_codigo({"regla": "cobertura_prensa_adversa", "agente_origen": "news_research_agent", "verificacion": ok}, None)
    assert not _verificada_en_codigo({"regla": "capacidad_operativa_cuestionable", "_source": "orchestrator_paso_7.7", "verificacion": ok}, None)
    assert not _verificada_en_codigo({"regla": "unica_oferta_valida", "agente_origen": "compliance_agent", "verificacion": {"ok": False}}, None)


def test_el_archivo_publicado_como_contrato_es_de_otra_compra(monkeypatch):
    """Directas 1226155: una orden de compra de 2025 a otro proveedor, colgada en un proceso de 2026."""
    from types import SimpleNamespace

    from tools.compliance_rules import _base, _rules_directa as R
    monkeypatch.setattr(_base, "ganadores_evaluables", lambda ocid, state, cur=None: [
        {"ruc": "20100000001", "nombre": "GANADOR SAC", "fecha_buena_pro": "2026-07-15"}])
    base = {"ocds": {"ocid": "X", "tender": {"value": {"amount": 18000, "currency": "PEN"}}},
            "document_analysis": {"cuantia_total": 0, "items_consolidados": []}, "pending_flags": []}
    ajeno = {"contratista": {"ruc": "20999999999"}, "fecha_suscripcion": "2025-08-28", "es_contrato": False, "moneda": "S/",
             "objeto": "Tarjeta de video"}
    st = {**base, "pending_flags": [], "lecturas_documentos": {"contrato": {"salida": ajeno}}}
    r = R.check_inconsistencia_doc_vs_ocds_rule("X", SimpleNamespace(state=st))
    tipos = [i["tipo"] for i in r["inconsistencias"]]
    assert "contrato_publicado_es_otro_documento" in tipos and "de otra compra" in r["evidencia"]
    # Un solo indicio (el lector dudó de que fuera un contrato) no alcanza.
    propio = {"contratista": {"ruc": "20100000001"}, "fecha_suscripcion": "2026-07-20", "es_contrato": False, "moneda": "S/"}
    st2 = {**base, "pending_flags": [], "lecturas_documentos": {"contrato": {"salida": propio}}}
    r2 = R.check_inconsistencia_doc_vs_ocds_rule("X", SimpleNamespace(state=st2))
    assert "contrato_publicado_es_otro_documento" not in [i["tipo"] for i in r2["inconsistencias"]]
