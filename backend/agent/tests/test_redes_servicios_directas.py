"""Redes de SERVICIOS y de DIRECTAS (perfil `otros`): lo propio de cada tipo. Sin base de datos ni red.

  Servicios (tools/market/historico_seace.py): el plazo sale del contrato o las bases ya leídos cuando el parser no
  trae el bloque `servicio`; el monto del proceso es la suma de sus adjudicaciones; un plazo menor a un mes no se
  lleva a «costo mensual».
  Directas (tools/market/cotizaciones.py y tools/compliance_rules/_rules_directa.py): RUC del cotizante en 11 dígitos,
  sin mediana cuando sólo cotizó el adjudicatario, cotizaciones por mes llevadas a la misma unidad, personas naturales
  con un apellido tapado y sin RUC 10; causal leída del bloque `sustento_directa`, catálogo con proveedor único e
  inmuebles, tipo de proceso desde el OCDS, expediente ilegible en severidad media y acto aprobatorio por campos.
"""
from __future__ import annotations

import json

import tools.market as mk
from agents.document_legal_analyst.prompt import build_instruction
from tools import compliance_rules as cr
from tools.compliance_rules._rules_directa import _identificar_causal_directa
from tools.documentos.extractor import _prompt_lote
from tools.market.cotizaciones import _mercado_cotizaciones
from tools.market.historico_seace import _finding_historico, _mercado_historico_seace, _monto_del_record

GANADOR = "20123456789"


class _Ctx:
    def __init__(self, state):
        self.state = state


class _Cur:
    def __init__(self, fila):
        self.fila = fila

    def execute(self, sql, params=()):
        pass

    def fetchone(self):
        return self.fila

    def fetchall(self):
        return [self.fila] if self.fila else []


class _Conn:
    def __init__(self, fila):
        self.fila = fila

    def cursor(self):
        return _Cur(self.fila)

    def close(self):
        pass


def _sin_comparables(monkeypatch):
    monkeypatch.setattr(mk.historico_seace, "_comparables_convocatorias", lambda *a, **k: [])
    monkeypatch.setattr(mk.cotizaciones, "_comparables_convocatorias", lambda *a, **k: [])


def _ocds(*adjudicados, ganador=GANADOR, nombre="SERVICIOS ANDINOS SAC", metodo="Contratación Directa"):
    return {"ocid": "ocds-dgv273-seacev3-1230001",
            "tender": {"description": "SERVICIO DE VIGILANCIA DE LA SEDE CENTRAL", "procurementMethodDetails": metodo},
            "awards": [{"id": f"a{i}", "value": {"amount": m},
                        "suppliers": [{"id": f"PE-RUC-{ganador}", "name": nombre}]}
                       for i, m in enumerate(adjudicados, 1)]}


# ─── SERVICIOS: costo mensual y por entregable ──────────────────────────────

def test_costo_mensual_con_el_plazo_del_contrato_leido(monkeypatch):
    """Bases escaneadas: no hay bloque `servicio`, pero el lector del contrato ya tiene el plazo."""
    _sin_comparables(monkeypatch)
    st = {"ocds": _ocds(120000.0),
          "parser_raw_consolidated": {"servicio": {}},
          "lecturas_documentos": {"contrato": {"salida": {"es_contrato": True, "plazo_dias": 360}},
                                  "bases": {"salida": {"es_bases": True, "plazo_dias": 365,
                                                       "personal_clave": [{"cargo": "Supervisor", "experiencia_anios": 3},
                                                                          {"cargo": "Jefe de grupo", "experiencia_anios": 2}]}}}}
    ind = _mercado_historico_seace(st)["indicadores_servicio"]
    assert ind["estado"] == "hallado" and ind["plazo_dias"] == 360 and "contrato" in ind["plazo_fuente"]
    assert ind["costo_mensual_implicito"] == 10000.0
    assert ind["n_personal_clave"] == 2 and ind["costo_mensual_por_persona"] == 5000.0
    assert "no es el total de trabajadores" in ind["costo_mensual_por_persona_base"]


def test_lectura_que_no_es_del_documento_no_da_plazo(monkeypatch):
    _sin_comparables(monkeypatch)
    st = {"ocds": _ocds(120000.0),
          "lecturas_documentos": {"contrato": {"salida": {"es_contrato": False, "plazo_dias": 30}},
                                  "bases": {"salida": {"es_bases": False, "plazo_dias": 90, "personal_clave": [{"cargo": "X"}]}}}}
    ind = _mercado_historico_seace(st)["indicadores_servicio"]
    assert ind == {"estado": "sin_dato", "motivo": "sin_bloque_servicio_del_parser",
                   "comparacion_tarifa_mensual": {"estado": "sin_dato", "motivo": "comparables_sin_plazo_en_bd"}}


def test_el_bloque_del_parser_sigue_valiendo(monkeypatch):
    _sin_comparables(monkeypatch)
    st = {"ocds": _ocds(90000.0),
          "parser_raw_consolidated": {"servicio": {"plazo_total_dias": 90, "entregables": [{"nombre": "E1"}, {"nombre": "E2"}],
                                                   "personal_clave": [{"cargo": "Coordinador"}]}}}
    ind = _mercado_historico_seace(st)["indicadores_servicio"]
    assert ind["plazo_fuente"] == "términos de referencia (parser)"
    assert ind["costo_mensual_implicito"] == 30000.0 and ind["costo_por_entregable"] == 45000.0


def test_plazo_menor_a_un_mes_no_se_lleva_a_costo_mensual(monkeypatch):
    """10 días por S/ 30 000 no son S/ 90 000 al mes."""
    _sin_comparables(monkeypatch)
    st = {"ocds": _ocds(30000.0), "parser_raw_consolidated": {"servicio": {"plazo_total_dias": 10}}}
    ind = _mercado_historico_seace(st)["indicadores_servicio"]
    assert ind["costo_mensual_implicito"] is None and ind["estado"] == "sin_dato"
    assert ind["motivo"] == "plazo_menor_a_un_mes" and ind["plazo_dias"] == 10


def test_monto_del_proceso_suma_las_adjudicaciones_por_item(monkeypatch):
    _sin_comparables(monkeypatch)
    ocds = _ocds(100000.0, 200000.0)
    ocds["awards"].append({"id": "a3", "status": "cancelled", "value": {"amount": 999.0}})
    assert _monto_del_record(ocds, {}, total=True) == (300000.0, "adjudicado")
    # Sin `total`, como lo llama la red de obras (tools/market/presupuesto_obra.py): igual que antes.
    assert _monto_del_record(ocds, {}) == (100000.0, "adjudicado")
    res = _mercado_historico_seace({"ocds": ocds, "parser_raw_consolidated": {"servicio": {"plazo_total_dias": 300}}})
    assert res["monto_base"] == 300000.0 and res["indicadores_servicio"]["costo_mensual_implicito"] == 30000.0


def test_cita_del_historico_sin_punto_medio():
    comp = [{"ocid": "1", "objeto": "SERVICIO DE VIGILANCIA", "cuantia_referencial": 1000.0, "url": "https://x/1"}]
    f = _finding_historico("SERVICIO DE VIGILANCIA", "1", 900.0, "adjudicado", comp)
    assert "·" not in f["evidencia"][0]["cita"] and "S/ 1,000.00" in f["evidencia"][0]["cita"]


# ─── DIRECTAS: cotizaciones del expediente ──────────────────────────────────

def _directa(cotizaciones, *adjudicados, **kw):
    return {"ocds": _ocds(*adjudicados, **kw),
            "parser_raw_consolidated": {"sustento_directa": {"cotizaciones": cotizaciones}}}


def test_ruc_del_cotizante_con_texto_es_el_del_adjudicatario(monkeypatch):
    """«RUC N° 20123456789» no era igual a «20123456789»: la cotización del ganador contaba como de un tercero."""
    _sin_comparables(monkeypatch)
    st = _directa([{"proveedor": "Otra razón social", "ruc": "RUC N° 20123456789 ", "monto": 100000},
                   {"proveedor": "B SAC", "ruc": "20-55555555-1", "monto": 130000},
                   {"proveedor": "C SAC", "ruc": "20666666662", "monto": 150000}], 100000.0)
    r = _mercado_cotizaciones(st)
    assert r["cotizante_ganador"]["match"] == "ruc" and r["ganador_es_el_mas_barato"] is True
    f = r["findings"][0]
    assert f["n_cotizaciones_terceros"] == 2 and f["precio_mediana_mercado"] == 140000.0
    assert r["cotizaciones"][1]["ruc"] == "20555555551"


def test_sin_cotizaciones_de_terceros_no_hay_mediana(monkeypatch):
    """La cotización del propio adjudicatario no es un «estimado de mercado»."""
    _sin_comparables(monkeypatch)
    r = _mercado_cotizaciones(_directa([{"proveedor": "SERVICIOS ANDINOS S.A.C.", "ruc": GANADOR, "monto": 100000}], 100000.0))
    f = r["findings"][0]
    assert f["precio_mediana_mercado"] is None and r["total_estimado_mercado"] is None and r["n_con_mediana"] == 0
    assert "todas del proveedor adjudicado" in f["comentario"] and r["veredicto_global"] == "sin_dato"
    assert any("no consta indagación con terceros" in o for o in r["observaciones_clave"])


def test_cotizaciones_por_mes_se_comparan_por_mes(monkeypatch):
    """Alquiler: S/ 5 000 al mes por 36 meses = S/ 180 000. Contra S/ 5 500 y S/ 6 000 no es «+3 030 %»."""
    _sin_comparables(monkeypatch)
    st = _directa([{"proveedor": "A", "ruc": GANADOR, "monto": 5000},
                   {"proveedor": "B SAC", "ruc": "20555555551", "monto": 5500},
                   {"proveedor": "C SAC", "ruc": "20666666662", "monto": 6000}], 180000.0)
    r = _mercado_cotizaciones(st)
    f = r["findings"][0]
    assert f["periodos_inferidos"] == 36 and f["monto_comparado"] == 5000.0
    assert f["veredicto"] == "alineado" and f["diff_pct"] == -13.04
    assert f["diff_fuente"] == "cotizaciones_expediente" and r["total_estimado_mercado"] == 207000.0


def test_cotizacion_mas_barata_no_es_un_periodo(monkeypatch):
    """Sin ganador reconocido, una cotización a mitad de precio es sólo más barata (otra iguala el adjudicado)."""
    _sin_comparables(monkeypatch)
    st = _directa([{"proveedor": "Sin nombre claro", "monto": 100000}, {"proveedor": "B SAC", "monto": 50000},
                   {"proveedor": "C SAC", "monto": 80000}], 100000.0)
    f = _mercado_cotizaciones(st)["findings"][0]
    assert f["periodos_inferidos"] is None and f["diff_pct"] == 25.0 and f["veredicto"] == "elevado"


def test_adjudicatario_que_no_cotizo_lo_mas_bajo(monkeypatch):
    _sin_comparables(monkeypatch)
    st = _directa([{"proveedor": "A", "ruc": GANADOR, "monto": 120000}, {"proveedor": "B SAC", "ruc": "20555555551", "monto": 90000},
                   {"proveedor": "C SAC", "ruc": "20666666662", "monto": 100000}], 120000.0)
    r = _mercado_cotizaciones(st)
    assert r["ganador_es_el_mas_barato"] is False and r["veredicto_global"] == "elevado"
    assert any("no es la más baja" in o for o in r["observaciones_clave"])


def test_persona_natural_sin_ruc_10_y_con_un_apellido_tapado(monkeypatch):
    _sin_comparables(monkeypatch)
    st = _directa([{"proveedor": "ROJAS QUISPE ELENA", "ruc": "10456789012", "monto": 40000},
                   {"proveedor": "MAMANI CONDORI JUAN", "ruc": "10111222333", "monto": 45000},
                   {"proveedor": "B SAC", "ruc": "20555555551", "monto": 50000}], 40000.0,
                  ganador="10456789012", nombre="ROJAS QUISPE ELENA")
    st["parser_raw_consolidated"]["sustento_directa"]["informe_tecnico"] = {"numero": "012-2026", "firmante": "PEREZ SOTO LUIS"}
    r = _mercado_cotizaciones(st)
    publicado = json.dumps(r, ensure_ascii=False)
    assert "10456789012" not in publicado and "10111222333" not in publicado
    for claro in ("ROJAS QUISPE ELENA", "MAMANI CONDORI JUAN", "PEREZ SOTO LUIS"):
        assert claro not in publicado and claro in st["_nombres_tapar"]
    assert r["ganador"] == {"ruc": None, "nombre": "ROJAS ••• ELENA"}
    assert r["cotizante_ganador"]["proveedor"] == "ROJAS ••• ELENA" and r["cotizante_ganador"]["match"] == "ruc"
    assert r["sustento"]["informe_tecnico"]["firmante"] == "PEREZ ••• LUIS"
    assert r["cotizaciones"][2]["ruc"] == "20555555551"          # una empresa conserva su RUC


def test_sustento_del_expediente_llega_al_mercado(monkeypatch):
    _sin_comparables(monkeypatch)
    st = _directa([], 50000.0)
    st["parser_raw_consolidated"]["sustento_directa"].update({
        "acto_aprobatorio": {"tipo": "Resolución de Alcaldía", "numero": "045-2026-MDSJ", "fecha": "2026-03-02"},
        "proveedor_unico_justificacion": "Único distribuidor autorizado", "informe_legal": {"numero": None},
        "convenio": {"entidades_parte": ["MUNICIPALIDAD X", "SIMA PERU"], "objeto": None}})
    s = _mercado_cotizaciones(st)["sustento"]
    assert s["acto_aprobatorio"]["numero"] == "045-2026-MDSJ" and "informe_legal" not in s
    assert s["convenio"]["entidades_parte"] == ["MUNICIPALIDAD X", "SIMA PERU"]


# ─── DIRECTAS: la causal ────────────────────────────────────────────────────

def _regla(monkeypatch, state, fila=("CONTRATACION DIRECTA", "LICENCIAS DE SOFTWARE")):
    monkeypatch.setattr(cr._rules_directa, "_pg", lambda: _Conn(fila))
    return cr.check_directa_fundamento_rule("1230001", _Ctx(state))


def test_causal_del_bloque_sustento_directa(monkeypatch):
    """`fundamento_legal` sólo cita la ley; la causal está en el bloque del perfil. Antes: «sin causal», alta."""
    st = {"document_analysis": {"fundamento_legal": ["Ley N° 32069"]},
          "parser_raw_consolidated": {"sustento_directa": {
              "causal_texto": "El bien sólo puede obtenerse de un determinado proveedor: proveedor único con derechos exclusivos"}}}
    r = _regla(monkeypatch, st)
    assert r["triggered"] is False and not st.get("pending_flags")
    assert r["causal_invocada"]["causal_clave"] == "proveedor_unico" and r["causal_invocada"]["causal_letra"] == "e"


def test_catalogo_de_causales_con_los_literales_de_la_ley():
    casos = {"situación de emergencia por lluvias intensas": ("emergencia", "b", True),
             "desabastecimiento inminente de oxígeno": ("desabastecimiento", "c", True),
             "contratación entre entidades públicas": ("entre_entidades", "a", False),
             "arrendamiento de bienes inmuebles para la sede": ("inmuebles", "j", False),
             "por ser el único proveedor en el mercado nacional": ("proveedor_unico", "e", False),
             "servicios personalísimos": ("personalisimo", "f", False)}
    for texto, (clave, letra, acto) in casos.items():
        c = _identificar_causal_directa([texto])
        assert (c["causal_clave"], c["causal_letra"], c["requiere_acto_resolutivo"]) == (clave, letra, acto), texto
    assert _identificar_causal_directa(["Ley 32069"])["match"] is False


def test_gana_la_causal_que_el_texto_nombra_primero(monkeypatch):
    """«Proveedor único … para evitar el desabastecimiento» no es la causal de desabastecimiento (que pide acto)."""
    st = {"document_analysis": {"fundamento_legal": ["Art. 55 Ley 32069"]},
          "estudio_mercado": {"causal_texto": "Causal de proveedor único, a fin de evitar el desabastecimiento del servicio"}}
    r = _regla(monkeypatch, st)
    assert r["triggered"] is False and r["causal_invocada"]["causal_clave"] == "proveedor_unico"
    assert "acto_resolutivo_directa" not in st


def test_tipo_de_proceso_desde_el_ocds_cuando_la_base_no_lo_tiene(monkeypatch):
    """`tipo_proceso` NULL (o sin fila): la regla terminaba sin evaluar y sin decir por qué."""
    st = {"ocds": _ocds(50000.0),
          "document_analysis": {"fundamento_legal": ["Reglamento interno"], "resumen_ejecutivo": "Informe de sustento"}}
    for fila in ((None, None), None):
        st.pop("pending_flags", None)
        r = _regla(monkeypatch, st, fila=fila)
        assert r["triggered"] is True and r["regla"] == "directa_sin_fundamento" and r["severidad"] == "alta"
    r = _regla(monkeypatch, {"document_analysis": {"fundamento_legal": []}}, fila=None)
    assert r["triggered"] is False and r["estado"] == "sin_dato"
    r = _regla(monkeypatch, {"ocds": _ocds(1.0, metodo="Licitación Pública")}, fila=(None, None))
    assert r["triggered"] is False and r["motivo"] == "no es contratación directa"


def test_expediente_ilegible_es_media_con_verificacion(monkeypatch):
    """El parser corrió y no leyó nada (PDF escaneado): los diccionarios existen, vacíos. No es «alta»."""
    vacio = {"items_consolidados": [], "fundamento_legal": [], "firmantes": [], "documentos": [{"titulo": "Informe.pdf"}],
             "requerimiento_disponible": False, "_source": "parse_documentos_lote"}
    st = {"document_analysis": dict(vacio), "parser_raw_consolidated": {**vacio, "sustento_directa": {}}}
    r = _regla(monkeypatch, st)
    assert r["triggered"] is True and r["severidad"] == "media" and r["requiere_verificacion"] is True
    assert "No se pudo leer" in r["evidencia"]
    # Con texto leído y sin causal, sigue siendo alta.
    st2 = {"document_analysis": {**vacio, "resumen_ejecutivo": "Informe técnico que sustenta la compra"}}
    r2 = _regla(monkeypatch, st2)
    assert r2["severidad"] == "alta" and r2["requiere_verificacion"] is False


def test_acto_aprobatorio_extraido_por_campos(monkeypatch):
    """«Resolución de Alcaldía» + «045-2026-MDSJ» (sin «N°») no calzaba con los patrones: bandera sin motivo."""
    st = {"document_analysis": {"fundamento_legal": ["situación de emergencia por desastre"]},
          "parser_raw_consolidated": {"sustento_directa": {
              "acto_aprobatorio": {"tipo": "Resolución de Alcaldía", "numero": "045-2026-MDSJ", "fecha": "2026-03-02", "pagina": 4}}}}
    r = _regla(monkeypatch, st)
    acto = st["acto_resolutivo_directa"]
    assert r["triggered"] is False and acto["encontrado"] is True and acto["numero"] == "045-2026-MDSJ"
    assert acto["fuente"] == "parser_bloque_tipado" and acto["pagina"] == 4


def test_evidencia_de_emergencia_sin_literal_equivocado(monkeypatch):
    st = {"document_analysis": {"fundamento_legal": ["situación de emergencia por desastre"]}}
    r = _regla(monkeypatch, st)
    assert r["regla"] == "directa_emergencia_sin_acto_resolutivo"
    assert "lit. a" not in r["evidencia"] and "lit. a)" not in r["norma"] and "lit. b)" in r["norma"]


# ─── Parser y analista legal: lo propio de las dos redes ─────────────────────

def test_el_parser_pide_las_unidades_que_usa_el_mercado():
    srv = _prompt_lote("TDR", "servicio", {"objeto": "X", "entidad": "Y"}, None, None)
    assert "`plazo_total_dias` es el plazo de TODO el servicio en DÍAS" in srv
    sd = _prompt_lote("Informe", "sustento_directa", {"objeto": "X", "entidad": "Y"}, None, None)
    assert "TOTAL cotizado por toda la prestación" in sd and "11 dígitos" in sd


def test_vectores_legales_dicen_donde_esta_el_dato():
    srv = build_instruction("servicios")
    assert "bases.personal_clave[].experiencia_anios" in srv and "bases.experiencia_postor.monto_minimo" in srv
    otros = build_instruction("otros")
    assert "CONVENIO O CONTRATACIÓN ENTRE ENTIDADES" in otros and "`estudio_mercado`" in otros
    # Un solo cotizante que es el adjudicatario es «cotizaciones insuficientes», no «recurrencia».
    e = otros.split("e) RECURRENCIA DEL PROVEEDOR")[1].split("f) COTIZACIONES")[0]
    assert "cotizante" not in e
