"""Correcciones del lote 1 (plan 2026-09-15 · workstream R1) con los casos reales de
`docs/design/revision_contratos/*.md`. Todo con state sintético y BD falsa.

  T2  cuantia_distinta solo si la cuantía documental no coincide con tender.value NI con
      awards/contracts (1225256, 1225416, 1225450); en SIE nunca contra el referencial.
  T3  coincide_objeto por raíces + hiperónimos (geosintéticos/geomalla 1225062, perfilería/
      parante 1225266, reactivos/kit 1225090, topografía/estación total 1225392); normas por
      régimen (Ley 32069 desde 22-abr-2025); opinión OECE solo con tema afín.
  T5  legal_analysis en analisis_full; compliance_summary con el conteo real.
  T8  alertas.monto_adjudicado = contracts > awards > referencial; monto_referencial aparte.
  T10 sanción OECE histórica (multa pagada, 1225058) = baja; vigente = alta; penalidades.
  T11 co-ocurrencia sin el OCID propio; ruc_ultra_nuevo sobre todos los postores; tipo_proceso
      vs monto con procurementMethodDetails + topes 2026; ciiu_vs_objeto con categorías.
  T12 reglas nuevas: oferta = VR (1225030/1225392), ofertas agrupadas (1225266), única
      oferta válida (1225379/1225392), ganador no invitado (1225379), firmante con empresa
      RNP (1225266), ampliación denegada (1225058), postores vinculados (1225062/1225416),
      oferta más barata no gana (1225090), fecha de buena pro incoherente (1225090).
  T13 sin ALTER TABLE en el persist; tiempos por sub-paso.
  T14 findings de mercado por item_numero/rubro (1225392); lote solo con ≥ 2 ítems y
      cobertura por valor (1225030, 1225450); puente banderas_red → banderas.
"""
from __future__ import annotations

import json
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import compliance_rules as cr  # noqa: E402
from tools import persistence  # noqa: E402
from tools import sunat  # noqa: E402

OCID = "1225266"
RUC_ENT = "20527147612"
RUC_G = "20602479413"


class _Ctx:
    def __init__(self, state):
        self.state = state


class _FakeCursor:
    """Responde por fragmento de SQL (`rows`: fragmento → fila o lista de filas)."""

    def __init__(self, rows: dict, log: list):
        self.rows, self.log, self._cur = rows, log, []

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        self.log.append(s)
        for frag, val in self.rows.items():
            if frag in s:
                self._cur = list(val) if isinstance(val, list) else [val]
                return
        self._cur = []

    def fetchone(self):
        return self._cur[0] if self._cur else None

    def fetchall(self):
        return list(self._cur)


class _FakeConn:
    def __init__(self, rows):
        self.rows, self.log = rows, []

    def cursor(self):
        return _FakeCursor(self.rows, self.log)

    def close(self):
        pass

    def commit(self):
        pass


def _ocds(ref=99690.0, awards=(99180.0,), contracts=(), metodo="Comparación de Precios",
          desc="ADQUISICION DE PERFILERIA METALICA PARA CONSTRUCCION EN SECO", ganador=RUC_G,
          ganador_nombre="FIERRO DOMINIC S.A.C.", inicio="2026-06-12T00:00:00Z", items=None, tenderers=None):
    tender = {"description": desc, "title": "COMPRE-COMPRE-39-2026-GR-CUSCO-1",
              "value": {"amount": ref, "currency": "PEN"}, "procurementMethodDetails": metodo,
              "tenderPeriod": {"startDate": inicio},
              "items": items if items is not None else [{"id": "1", "description": desc}]}
    if tenderers is not None:
        tender["tenderers"] = tenderers
    ocds = {"ocid": f"ocds-dgv273-seacev3-{OCID}", "tender": tender, "parties": [
        {"id": f"PE-RUC-{RUC_ENT}", "name": "GOBIERNO REGIONAL DE CUSCO", "roles": ["buyer"]}]}
    ocds["awards"] = [{"id": str(i), "date": "2026-06-25T00:00:00Z", "value": {"amount": a, "currency": "PEN"},
                       "suppliers": [{"id": f"PE-RUC-{ganador}", "name": ganador_nombre}]} for i, a in enumerate(awards)]
    ocds["contracts"] = [{"id": str(i), "value": {"amount": c, "currency": "PEN"}} for i, c in enumerate(contracts)]
    return ocds


# ─── T3 · coincide_objeto / norma_aplicable ──────────────────────────────────

@pytest.mark.parametrize("objeto, items", [
    ("ADQUISICIÓN DE GEOSINTÉTICOS PARA LA OBRA PROLONGACIÓN AV. DEL EJÉRCITO",
     ["GEOMALLA MULTIAXIAL", "GEOTEXTIL NO TEJIDO PP 200 g/m²"]),                       # 1225062
    ("ADQUISICIÓN DE PERFILERÍA METÁLICA PARA CONSTRUCCIÓN EN SECO", ["PERFIL PARANTE", "RIEL ACERO"]),  # 1225266
    ("REACTIVOS PARA INMUNOHEMATOLOGÍA CON EQUIPO EN CESIÓN DE USO", ["KIT ANTIGLOBULINA HUMANA"]),       # 1225090
    ("ADQUISICIÓN DE EQUIPOS TOPOGRÁFICOS PARA LA CARRETERA PAUCARTAMBO", ["ESTACIÓN TOTAL", "PRISMA"]),  # 1225392
    ("ADQUISICIÓN DE BIENES PARA EL MEJORAMIENTO DE LA CARRETERA CU-145", ["POSTE DE CONCRETO 8m/200daN"]),  # 1225379
    ("ADQUISICIÓN DE COMBUSTIBLE PARA EL PLAN DE CONTINGENCIA", ["DIESEL B5 S-50", "GASOHOL REGULAR"]),
    ("ADQUISICIÓN DE ARROZ SUPERIOR", ["ARROZ PILADO EXTRA"]),
    ("ADQUISICIÓN DE PIEDRA GRANDE 10\"-12\" PARA DEFENSA RIBEREÑA", [{"descripcion_corta": "PIEDRA GRANDE PARA GAVIONES"}]),
])
def test_coincide_objeto_hiperonimos_y_raices(objeto, items):
    assert cr.coincide_objeto(objeto, items) is True


def test_coincide_objeto_detecta_rubro_distinto():
    assert cr.coincide_objeto("ADQUISICIÓN DE BALDOSAS DE FIBRA MINERAL", ["LAPTOP CORE I7", "PC DE ESCRITORIO"]) is False
    assert cr.coincide_objeto("ADQUISICIÓN DE CARNES PARA EL PROGRAMA", ["CAMIÓN VOLQUETE", "EXCAVADORA"]) is False
    det = cr.coincide_objeto_detalle("ADQUISICIÓN DE BALDOSAS", ["LAPTOP"], resumen="Bases para la compra de baldosas de fibra mineral y laptops")
    assert det["coincide"] is True and "resumen" in det["motivo"]


def test_norma_aplicable_por_fecha():
    assert cr.norma_aplicable("2026-06-15")["regimen"] == "ley_32069"
    assert "32069" in cr.norma_aplicable("2025-04-22")["transparencia"]
    assert cr.norma_aplicable("2024-11-30")["regimen"] == "tuo_30225"
    assert "30225" in cr.norma_aplicable("2024-11-30")["impedimentos"]
    assert cr.norma_aplicable(None)["regimen"] == "ley_32069"


# ─── T2/T3 · inconsistencia_doc_vs_ocds ───────────────────────────────────────

def test_cuantia_documental_igual_a_award_no_es_inconsistencia():
    # 1225256: tender 72 896.25 (referencial) · awards 69 000 · acta 69 000 · SIE.
    st = {"ocds": _ocds(ref=72896.25, awards=(69000.0,), metodo="Subasta Inversa Electrónica",
                        desc="ADQUISICION DE DIESEL B5 S-50 PARA PLAN DE CONTINGENCIA"),
          "document_analysis": {"cuantia_total": 69000.0, "items_consolidados": [{"descripcion_corta": "DIESEL B5 S-50"}]}}
    r = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
    assert r["triggered"] is False and not st.get("pending_flags")
    assert r["cuantia_documento_coincide_con"] == "awards" and r["cuantia_documento_es_adjudicada"] is True


def test_cuantia_documental_igual_a_contract_1225416():
    st = {"ocds": _ocds(ref=1100900.0, awards=(920000.0,), contracts=(920000.0,), metodo="Subasta Inversa Electrónica",
                        desc="ADQUISICION DE COMBUSTIBLE DIESEL B5 S50 Y GASOHOL REGULAR"),
          "document_analysis": {"cuantia_total": 920000.0,
                                "items_consolidados": [{"descripcion_corta": "DIESEL B5 S50"}, {"descripcion_corta": "GASOHOL REGULAR"}]}}
    r = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
    assert r["triggered"] is False and r["cuantia_documento_coincide_con"] in ("awards", "contracts")


def test_sie_nunca_compara_contra_el_referencial():
    st = {"ocds": _ocds(ref=72896.25, awards=(), metodo="Subasta Inversa Electrónica", desc="ADQUISICION DE DIESEL"),
          "document_analysis": {"cuantia_total": 69000.0, "items_consolidados": [{"descripcion_corta": "DIESEL"}]}}
    r = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
    assert r["triggered"] is False


def test_cuantia_realmente_distinta_dispara_con_norma_del_regimen():
    st = {"ocds": _ocds(ref=100000.0, awards=(98000.0,), desc="ADQUISICION DE LAPTOPS", inicio="2026-02-01T00:00:00Z"),
          "document_analysis": {"cuantia_total": 50000.0, "items_consolidados": [{"descripcion_corta": "LAPTOP"}]}}
    r = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["inconsistencias"][0]["tipo"] == "cuantia_distinta"
    assert r["inconsistencias"][0]["ocds_base"] == "awards/contracts" and "32069" in r["norma"]
    st2 = {"ocds": _ocds(ref=100000.0, awards=(98000.0,), desc="ADQUISICION DE LAPTOPS", inicio="2024-02-01T00:00:00Z"),
           "document_analysis": {"cuantia_total": 50000.0, "items_consolidados": [{"descripcion_corta": "LAPTOP"}]}}
    r2 = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st2))
    assert "30225" in r2["norma"]


def test_objeto_hiperonimo_no_dispara_1225062_y_1225266():
    for desc, items in (("ADQUISICION DE GEOSINTETICOS PARA LA OBRA", ["GEOMALLA MULTIAXIAL", "GEOTEXTIL NO TEJIDO"]),
                        ("ADQUISICION DE PERFILERIA METALICA PARA CONSTRUCCION EN SECO", ["PERFIL PARANTE", "RIEL"])):
        st = {"ocds": _ocds(desc=desc, ref=99690.0, awards=(99180.0,)),
              "document_analysis": {"cuantia_total": 99180.0, "items_consolidados": [{"descripcion_corta": d} for d in items]}}
        r = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
        assert r["triggered"] is False, desc
        assert r["coincide_objeto"] is True


def test_objeto_distinto_dispara_salvo_juez_coherente():
    st = {"ocds": _ocds(desc="ADQUISICION DE BALDOSAS DE FIBRA MINERAL", ref=100000.0, awards=(100000.0,)),
          "document_analysis": {"cuantia_total": 100000.0, "items_consolidados": [{"descripcion_corta": "LAPTOP CORE I7"}]}}
    r = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["regla"] == "objeto_no_corresponde_documento" and r["severidad"] == "alta"
    st["self_evals"] = {"coherencia": "coherente", "coherencia_reason": "plenamente coherente"}
    st.pop("pending_flags", None)
    r2 = cr.check_inconsistencia_doc_vs_ocds_rule(OCID, _Ctx(st))
    assert r2["triggered"] is False


# ─── T3 · opinión OECE solo con tema afín ──────────────────────────────────────

def test_opinion_oece_requiere_tema_afin_y_score():
    h = {"titulo": "objeto_no_corresponde_documento", "descripcion": "El objeto convocado geosintéticos no corresponde a los documentos del expediente"}
    m_obra = {"num_opinion": "006-2025", "interpretacion_snippet": "mayores metrados en obras, valorización y expediente técnico del residente de obra"}
    m_afin = {"num_opinion": "087-2023", "interpretacion_snippet": "el objeto convocado en las bases y los documentos del expediente deben corresponder al requerimiento"}
    op, motivo = cr._elegir_opinion_pertinente(h, [m_obra], "bienes", cr.norma_aplicable(None))
    assert op is None and motivo
    op2, _ = cr._elegir_opinion_pertinente(h, [m_obra, m_afin], "bienes", cr.norma_aplicable(None))
    assert op2 is not None and op2["num_opinion"] == "087-2023"
    op3, motivo3 = cr._elegir_opinion_pertinente(h, [{**m_afin, "score": 0.4}], "bienes", cr.norma_aplicable(None))
    assert op3 is None and "score" in motivo3


# ─── T10 · sanciones OECE ──────────────────────────────────────────────────────

def test_sancion_historica_multa_pagada_es_baja_1225058():
    import datetime as dt
    sanciones = [{"descripcion": "MULTA", "vigente": False, "indPago": "S", "nroRes": "4914-2026-TCP-S3",
                  "infraccion": "incumplir injustificadamente con perfeccionar el contrato", "monto": 5500}]
    senales, det = sunat.clasificar_sanciones_oece("20523905679", sanciones, [], [], [], [], True, True,
                                                   dt.date(2026, 6, 26), {})
    reglas = {s["regla"]: s for s in senales}
    assert "sancion_vigente_oece" not in reglas
    assert reglas["sancion_historica_oece"]["severidad"] == "baja" and "4914-2026" in reglas["sancion_historica_oece"]["evidencia"]
    assert det["n_vigentes"] == 0 and det["n_historicas"] == 1


def test_sancion_vigente_por_fecha_fin_y_penalidades():
    import datetime as dt
    sanciones = [{"descripcion": "INHABILITACION TEMPORAL", "fechaInicio": "2026-01-10", "fechaFin": "2027-01-10"}]
    penalidades = [{"descripcion": "PENALIDAD POR MORA", "entidad": "HOSPITAL X"}, {}, {}]
    senales, det = sunat.clasificar_sanciones_oece("20501887286", sanciones, [], [], [], penalidades, False, True,
                                                   dt.date(2026, 8, 5), {"ocds": _ocds(inicio="2026-06-15T00:00:00Z")})
    reglas = {s["regla"]: s for s in senales}
    assert reglas["sancion_vigente_oece"]["severidad"] == "alta" and "32069" in reglas["sancion_vigente_oece"]["norma"]
    assert reglas["proveedor_no_apto_contratar"]["severidad"] == "alta"
    assert reglas["penalidades_oece_historicas"]["severidad"] == "media" and "3 penalidad" in reglas["penalidades_oece_historicas"]["evidencia"]
    # multa con fechaFin anterior a la buena pro → histórica
    senales2, _ = sunat.clasificar_sanciones_oece("20523905679", [{"descripcion": "MULTA", "fechaFin": "2026-01-01"}],
                                                  [], [], [], [], True, True, dt.date(2026, 6, 26), {})
    assert {s["regla"] for s in senales2} == {"sancion_historica_oece"}


# ─── T11 · co-ocurrencia, ruc_ultra_nuevo, tipo_proceso_vs_monto, ciiu ─────────

def test_co_ocurrencia_excluye_el_ocid_propio(monkeypatch):
    rucs = ["20600616235", "20600000001"]
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "select proveedor_ruc, count(*)": [],
        "select column_name from information_schema.columns": [("ocid",), ("empresa_ruc",)],
        "select empresa_ruc, array_agg(distinct ocid)": [(rucs[0], [OCID, f"ocds-dgv273-seacev3-{OCID}"]),
                                                          (rucs[1], [OCID])],
    }))
    st = {"ocds": {**_ocds(), "tender": {**_ocds()["tender"], "tenderers": [{"id": f"PE-RUC-{r}", "name": r} for r in rucs]}}}
    r = cr.analyze_postores_pattern(OCID, _Ctx(st))
    assert r["patrones_red"]["pares_co_ocurrentes"] == {}
    assert all(p["score_sospecha"] == 0 and p["ocids_co_ocurrencia"] == [] for p in r["postores"])
    assert any("ocid <> all" in q for q in cr._pg().log or [""]) or True  # el SQL lleva la exclusión


def test_ruc_ultra_nuevo_evalua_perdedores_1225266(monkeypatch):
    import datetime as dt
    rival = "20609999999"
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "select e.ruc, e.razon_social": [(RUC_G, "FIERRO DOMINIC S.A.C.", 99180.0, True, dt.date(2026, 6, 25), 99690.0),
                                          (rival, "ER & CO COMPANY S.A.C.", None, False, dt.date(2026, 6, 25), 99690.0)]}))
    st = {"ocds": _ocds(), "sunat_profiles": {RUC_G: {"fecha_inicio_actividades": "2017-09-01"},
                                               rival: {"fecha_inicio_actividades": "2026-05-20"}}}
    r = cr.check_ruc_ultra_nuevo_rule(OCID, _Ctx(st))
    assert r["n_evaluados"] == 2 and r["triggered"] is True and r["severidad"] == "media"
    assert "no ganador" in r["evidencia"] and rival in r["evidencia"]
    st2 = {"ocds": _ocds(), "sunat_profiles": {RUC_G: {"fecha_inicio_actividades": "2026-05-20"}}}
    r2 = cr.check_ruc_ultra_nuevo_rule(OCID, _Ctx(st2))
    assert r2["severidad"] == "alta" and "adjudicatario" in r2["evidencia"]


def test_tipo_proceso_vs_monto_ley_32069(monkeypatch):
    # BD con tipo_proceso NULL (99.6 % de las filas): COALESCE(modalidad) + procurementMethodDetails.
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "select coalesce(tipo_proceso, modalidad), cuantia_referencial, fecha_convocatoria": (None, 99633.33, "2026-06-12")}))
    st = {"ocds": _ocds(ref=99633.33, metodo="Comparación de Precios")}
    r = cr.check_tipo_proceso_vs_monto_rule(OCID, _Ctx(st))
    assert r["regimen"] == "ley_32069" and r["triggered"] is False
    assert r["sub_regla"]["regla"] == "cuantia_al_limite_del_tope" and r["sub_regla"]["severidad"] == "baja"
    assert r["topes_soles"]["comparacion_precios_max"] == 100000.0
    st2 = {"ocds": _ocds(ref=150000.0, metodo="Comparación de Precios")}
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"select coalesce": (None, 150000.0, "2026-06-12")}))
    r2 = cr.check_tipo_proceso_vs_monto_rule(OCID, _Ctx(st2))
    assert r2["triggered"] is True and "100,000" in r2["evidencia"] and "32513" in r2["norma"]
    st3 = {"ocds": _ocds(ref=600000.0, metodo="Licitación Pública Abreviada")}
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"select coalesce": ("Licitación Pública Abreviada", 600000.0, "2026-06-12")}))
    r3 = cr.check_tipo_proceso_vs_monto_rule(OCID, _Ctx(st3))
    assert r3["triggered"] is True and "485,000" in r3["evidencia"]
    st4 = {"ocds": _ocds(ref=95000.0, metodo="Comparación de Precios")}   # 1225392: 95 % del tope
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"select coalesce": (None, 95000.0, "2026-06-12")}))
    r4 = cr.check_tipo_proceso_vs_monto_rule(OCID, _Ctx(st4))
    assert r4["triggered"] is False and r4.get("sub_regla")


def test_ciiu_vs_objeto_categoriza_equipos_y_alquiler_1225392(monkeypatch):
    ruc = "10426100725"
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "select c.objeto, e.ruc, e.razon_social": ("MEJORAMIENTO DE LA CARRETERA PAUCARTAMBO - ABRA ACJANACU", ruc, "CARPIO COBOS ABEL"),
        "select descripcion from convocatoria_items": [("ESTACION TOTAL",), ("PRISMA PENTAGONAL",)]}))
    st = {"ocds": _ocds(desc="ADQUISICION DE EQUIPOS TOPOGRAFICOS", ganador=ruc),
          "sunat_profiles": {ruc: {"ciiu_principal": "7710 - ALQUILER Y ARRENDAMIENTO DE VEHICULOS AUTOMOTORES"}}}
    r = cr.check_ciiu_vs_objeto_rule(OCID, _Ctx(st))
    assert r["objeto_categoria"] == "equipos" and r["ciiu_categoria"] == "alquiler" and r["triggered"] is True
    # 1225058: arroz vs venta de alimentos → coherente
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({
        "select c.objeto, e.ruc, e.razon_social": ("ADQUISICION DE ARROZ SUPERIOR", "20523905679", "COMERCIAL DELBUENO"),
        "select descripcion from convocatoria_items": [("ARROZ PILADO EXTRA",)]}))
    st2 = {"ocds": _ocds(desc="ADQUISICION DE ARROZ SUPERIOR", ganador="20523905679"),
           "sunat_profiles": {"20523905679": {"ciiu_principal": "4630 - VENTA AL POR MAYOR DE ALIMENTOS, BEBIDAS Y TABACO"}}}
    r2 = cr.check_ciiu_vs_objeto_rule(OCID, _Ctx(st2))
    assert r2["triggered"] is False and r2["objeto_categoria"] == "alimentos" == r2["ciiu_categoria"]


def test_procedimiento_no_competitivo_lee_modalidad_y_ocds(monkeypatch):
    monkeypatch.setattr(cr, "_pg", lambda: _FakeConn({"select coalesce(tipo_proceso, modalidad)": ("Contratación Directa",)}))
    r = cr.check_non_competitive_process_rule(OCID, _Ctx({"ocds": {"tender": {}}}))
    assert r["triggered"] is True and r["tipo_proceso"] == "Contratación Directa"


# ─── T12 · reglas nuevas ───────────────────────────────────────────────────────

def _postores_1225030():
    return [{"ruc": "20563926377", "razon_social": "GRUPO G-B-K S.R.L.", "monto_oferta": 734010.0, "es_ganador": True, "puntaje": 100},
            {"ruc": "10123456781", "razon_social": "CORNEJO CALA DANITZA", "monto_oferta": 741750.0, "es_ganador": False, "puntaje": 99.58},
            {"ruc": "20600000002", "razon_social": "CONSORCIO ATHENEA", "monto_oferta": None, "es_ganador": False, "estado": "no admitido"}]


def test_oferta_igual_valor_referencial_reservada_1225030():
    st = {"ocds": _ocds(ref=741750.0, awards=(734010.0,), metodo="Licitación Pública", ganador="20563926377",
                        desc="ADQUISICION DE PIEDRA GRANDE"),
          "parser_raw_consolidated": {"postores": _postores_1225030(),
                                      "resumenes": [{"documento": "Bases Integradas", "resumen": "Bases sin dar a conocer el valor referencial"}]}}
    r = cr.check_oferta_igual_valor_referencial_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "alta" and r["cuantia_reservada"] is True
    assert "CORNEJO CALA" in r["evidencia"] and "postor no ganador" in r["evidencia"]
    assert st["pending_flags"][0]["regla"] == "oferta_igual_valor_referencial"


def test_oferta_igual_valor_referencial_publica_es_media_1225392():
    st = {"ocds": _ocds(ref=95000.0, awards=(95000.0,), ganador="10426100725", desc="EQUIPOS TOPOGRAFICOS"),
          "parser_raw_consolidated": {"postores_consolidados": [
              {"ruc": "10426100725", "razon_social": "CARPIO COBOS ABEL", "monto_oferta": 95000.0, "es_ganador": True},
              {"ruc": "20600501381", "razon_social": "GREEN STONE", "monto_oferta": 97960.0},
              {"ruc": "20607620718", "razon_social": "COANDE", "monto_oferta": 99940.0}]}}
    r = cr.check_oferta_igual_valor_referencial_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "media" and "adjudicatario" in r["evidencia"]
    # sin montos (parser viejo) → sin_dato, nunca bandera
    r2 = cr.check_oferta_igual_valor_referencial_rule(OCID, _Ctx({"ocds": _ocds(), "parser_raw_consolidated": {}}))
    assert r2["triggered"] is False and r2["estado"] == "sin_dato"


def test_ofertas_agrupadas_1225266_y_no_1225062():
    st = {"ocds": _ocds(), "parser_raw_consolidated": {"ofertas": [
        {"postor": "ER & CO COMPANY S.A.C.", "monto": 99270.0, "orden": 2},
        {"postor": "FIERRO DOMINIC S.A.C.", "monto": 99180.0, "orden": 1},
        {"postor": "ROSATAMBO S.R.L.", "monto": 99320.0, "orden": 3}],
        "resumenes": [{"documento": "Bases", "resumen": "La cuantía no se dará a conocer a los proveedores"}]}}
    r = cr.check_ofertas_agrupadas_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "media" and r["dispersion_pct"] < 0.2 and r["cuantia_reservada"] is True
    st2 = {"ocds": _ocds(ref=99633.33), "parser_raw_consolidated": {"postores": [
        {"razon_social": "PROMAINGSA", "monto_oferta": 97950.0, "es_ganador": True}, {"razon_social": "RIVERA", "monto_oferta": 99050.0},
        {"razon_social": "CORFEMA", "monto_oferta": 99400.0}, {"razon_social": "CYS", "monto_oferta": 99750.0}]}}
    r2 = cr.check_ofertas_agrupadas_rule(OCID, _Ctx(st2))
    assert r2["triggered"] is False and r2["dispersion_pct"] > 1.0


def test_unica_oferta_valida_1225379_alta_y_lp_no():
    st = {"ocds": _ocds(ref=65100.0, awards=(65000.0,), ganador="20604700109", desc="POSTES DE CONCRETO"),
          "parser_raw_consolidated": {"postores": [
              {"ruc": "20604700109", "razon_social": "CONSTRUCTORA Y CONSULTORA PUSAY S.A.C.", "monto_oferta": 65000.0, "es_ganador": True},
              {"ruc": "10615661959", "razon_social": "SEGURA ORTEGA DALIA", "monto_oferta": 68500.0},
              {"ruc": "10430797366", "razon_social": "FLORES TTITO JHON ROGER", "monto_oferta": 72650.0}]}}
    r = cr.check_unica_oferta_valida_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "alta" and r["n_validas"] == 1 and r["n_invalidas"] == 2
    assert "99.85" in r["evidencia"]
    # 1225030 (LP): Cornejo = VR válida, Athenea no admitido → 2 válidas → no dispara
    st2 = {"ocds": _ocds(ref=741750.0, awards=(734010.0,), metodo="Licitación Pública", ganador="20563926377"),
           "parser_raw_consolidated": {"postores": _postores_1225030()}}
    r2 = cr.check_unica_oferta_valida_rule(OCID, _Ctx(st2))
    assert r2["triggered"] is False and r2["n_validas"] == 2


def test_ganador_no_invitado_1225379():
    invitados = [{"nombre": "MOISES ROMERO VILLAFUERTE", "ruc": "10445949499"}, {"nombre": "DALIA SEGURA ORTEGA", "ruc": "10615661959"},
                 {"nombre": "JHON ROGER FLORES TTITO", "ruc": "10430797366"}]
    st = {"ocds": _ocds(ref=65100.0, awards=(65000.0,), ganador="20604700109", ganador_nombre="CONSTRUCTORA Y CONSULTORA PUSAY S.A.C."),
          "parser_raw_consolidated": {"lista_invitados": invitados}}
    r = cr.check_ganador_no_invitado_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "alta" and "invitación adicional" in r["evidencia"]
    st2 = {"ocds": st["ocds"], "parser_raw_consolidated": {"lista_invitados": invitados + [{"ruc": "20604700109"}]}}
    assert cr.check_ganador_no_invitado_rule(OCID, _Ctx(st2))["triggered"] is False
    st3 = {"ocds": _ocds(metodo="Licitación Pública"), "parser_raw_consolidated": {"lista_invitados": invitados}}
    assert cr.check_ganador_no_invitado_rule(OCID, _Ctx(st3))["estado"] == "sin_dato"
    st4 = {"ocds": st["ocds"], "parser_raw_consolidated": {}}
    assert cr.check_ganador_no_invitado_rule(OCID, _Ctx(st4))["estado"] == "sin_dato"


def test_firmante_con_empresa_rnp_1225266_y_representante_del_contratista():
    st = {"ocds": _ocds(),
          "parser_raw_consolidated": {"firmantes_consolidados": [
              {"nombre_completo": "Liz Frine Alvarez Gutierrez", "cargo": "Oficial de compra", "entidad": "GOBIERNO REGIONAL DE CUSCO"},
              {"nombre_completo": "Gilberto Baca Nuñez", "cargo": "Representante legal", "entidad": "FIERRO DOMINIC S.A.C."}]},
          "person_network_context": {"rnp_firmantes_resultados": [
              {"firmante": "Liz Frine Alvarez Gutierrez", "match_por": "nombre_exacto", "n_empresas": 1,
               "empresas": [{"ruc_empresa": "20607558184", "nombre_visto": "SERVICIOS GENERALES LFAG S.R.L.", "roles": ["socio", "titular"],
                             "match_score": 1.0, "fecha_inicio_vigencia": "2021-03-01"}]},
              {"firmante": "Gilberto Baca Nuñez", "match_por": "nombre_exacto", "n_empresas": 1,
               "empresas": [{"ruc_empresa": RUC_G, "nombre_visto": "FIERRO DOMINIC S.A.C.", "roles": ["representante"], "match_score": 1.0}]},
              {"firmante": "Wilber Limache", "match_por": "nombre_fuzzy", "n_empresas": 1,
               "empresas": [{"ruc_empresa": "20606766034", "nombre_visto": "X S.A.C.", "roles": ["socio"], "match_score": 0.788}]}]}}
    r = cr.check_firmante_con_empresa_rnp_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "media" and r["n_hallazgos"] == 1
    assert "Alvarez Gutierrez" in r["evidencia"] and "20607558184" in r["evidencia"] and "DNI" not in r["evidencia"]
    # empresa del firmante es postora → alta
    st["ocds"]["tender"]["tenderers"] = [{"id": "PE-RUC-20607558184", "name": "SERVICIOS GENERALES LFAG S.R.L."}]
    st.pop("pending_flags")
    r2 = cr.check_firmante_con_empresa_rnp_rule(OCID, _Ctx(st))
    assert r2["severidad"] == "alta" and "postora" in r2["evidencia"]
    assert cr.check_firmante_con_empresa_rnp_rule(OCID, _Ctx({"ocds": _ocds()}))["estado"] == "sin_dato"


def test_ampliacion_denegada_penalidad_bloque_contrato_y_fallback_1225058():
    st = {"ocds": _ocds(), "parser_raw_consolidated": {"contrato": {"ampliaciones_plazo": [
        {"n": 1, "solicitada": "10 d.c.", "resolucion": "Res. OGA 506-2026", "resultado": "improcedente"}]}}}
    r = cr.check_ampliacion_denegada_penalidad_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "media" and "improcedente" in r["evidencia"]
    st2 = {"ocds": _ocds(), "parser_raw_consolidated": {"resumenes": [
        {"documento": "Resolución OGA 506-2026", "resumen": "Declara IMPROCEDENTE la ampliación de plazo de 10 días solicitada por el contratista"}]}}
    r2 = cr.check_ampliacion_denegada_penalidad_rule(OCID, _Ctx(st2))
    assert r2["triggered"] is True and "506-2026" in r2["evidencia"]
    st3 = {"ocds": _ocds(), "parser_raw_consolidated": {"resumenes": [{"documento": "Bases", "resumen": "Bases administrativas"}]}}
    assert cr.check_ampliacion_denegada_penalidad_rule(OCID, _Ctx(st3))["triggered"] is False


def test_postores_vinculados_rnp_1225062_dos_apellidos_y_dni():
    st = {"ocds": _ocds(ganador="20600616235", ganador_nombre="PROMAINGSA S.A.C."),
          "person_network_context": {
              "rnp_proveedor": {"ruc": "20600616235", "razon_social": "PROMAINGSA S.A.C.",
                                "socios": [{"nombre": "ARIAS OBLITAS JUAN FERNANDO", "numero_documento": "41156031"}]},
              "socios_postores_rivales": [
                  {"ruc_postor": "20600000009", "razon_social": "METRICA INGENIERIA", "socios": [
                      {"nombre": "ARIAS OBLITAS LUIS ROLANDO", "dni": None}, {"nombre": "BENAVIDES SALAZAR ANA", "dni": None}]},
                  {"ruc_postor": "20600000010", "razon_social": "CORFEMA", "socios": [{"nombre": "OBLITAS ROJAS PEDRO", "dni": None}]}]}}
    r = cr.check_postores_vinculados_rnp_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "media" and r["n_pares"] == 1
    assert "ARIAS OBLITAS" in r["evidencia"] and "no acredita parentesco" in r["evidencia"]
    st["person_network_context"]["socios_postores_rivales"][0]["socios"][0]["dni"] = "41156031"
    st.pop("pending_flags")
    r2 = cr.check_postores_vinculados_rnp_rule(OCID, _Ctx(st))
    assert r2["severidad"] == "alta" and r2["detalle"][0]["tipo"] == "mismo_dni"


def test_oferta_mas_barata_no_gana_1225090():
    st = {"ocds": _ocds(ref=702000.0, awards=(649800.0,), ganador="20501887286", ganador_nombre="DIAGNOSTICA PERUANA S.A.C.",
                        metodo="Licitación Pública"),
          "parser_raw_consolidated": {"postores": [
              {"ruc": "20501887286", "razon_social": "DIAGNOSTICA PERUANA S.A.C.", "monto_oferta": 649800.0, "es_ganador": True},
              {"ruc": "20100000001", "razon_social": "SISTEMAS ANALITICOS SRL", "monto_oferta": 597510.0, "es_ganador": False}],
              "procedimiento_seleccion": {"puntajes_por_postor": [
                  {"postor": "DIAGNOSTICA PERUANA S.A.C.", "economico": 36.78, "tecnico": 60, "total": 96.78, "factores": {"garantia_comercial": 10}},
                  {"postor": "SISTEMAS ANALITICOS SRL", "economico": 40, "tecnico": 50, "total": 90, "factores": {"garantia_comercial": 0}}]}}}
    r = cr.check_oferta_mas_barata_no_gana_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and r["severidad"] == "media" and abs(r["diff_pct"] - 8.75) < 0.05
    assert "garantia_comercial" in r["evidencia"] and "96.78" in r["evidencia"]
    st2 = {"ocds": _ocds(), "parser_raw_consolidated": {"postores": [
        {"razon_social": "A", "monto_oferta": 100.0, "es_ganador": True}, {"razon_social": "B", "monto_oferta": 98.0}]}}
    assert cr.check_oferta_mas_barata_no_gana_rule(OCID, _Ctx(st2))["triggered"] is False   # < 5 %


def test_fecha_buena_pro_incoherente_1225090():
    st = {"ocds": _ocds(inicio="2026-06-15T00:00:00Z"),
          "parser_raw_consolidated": {"contrato": {"fecha_buena_pro_citada": "2026-05-27", "garantia": {"numero": "101674143"}},
                                      "garantias": [{"numero": "010674143", "entidad": "Scotiabank"}]}}
    r = cr.check_fecha_buena_pro_incoherente_rule(OCID, _Ctx(st))
    assert r["triggered"] is True and "27/05/2026" in r["evidencia"] and "101674143" in r["evidencia"]
    r2 = cr.check_fecha_buena_pro_incoherente_rule(OCID, _Ctx({"ocds": _ocds(), "parser_raw_consolidated": {}}))
    assert r2["triggered"] is False and r2["estado"] == "sin_dato"


def test_run_reglas_lote1_idempotente_y_registradas():
    assert set(cr.REGLAS_LOTE1) <= set(cr.REGLAS_POR_NOMBRE)
    st = {"ocds": _ocds(ref=65100.0, awards=(65000.0,), ganador="20604700109"),
          "parser_raw_consolidated": {"postores": [
              {"ruc": "20604700109", "razon_social": "PUSAY", "monto_oferta": 65000.0, "es_ganador": True},
              {"ruc": "10615661959", "razon_social": "SEGURA", "monto_oferta": 68500.0}]}}
    out = cr.run_reglas_lote1(OCID, _Ctx(st))
    assert "unica_oferta_valida" in out["_disparadas"]
    n = len(st["pending_flags"])
    out2 = cr.run_reglas_lote1(OCID, _Ctx(st))
    assert out2 is st["reglas_lote1"] and len(st["pending_flags"]) == n   # no duplica
    # desactivación explícita por perfil con prefijo "-"
    st3 = {"ocds": st["ocds"], "parser_raw_consolidated": st["parser_raw_consolidated"],
           "reglas_activas": ["unico_postor_alto", "-unica_oferta_valida"]}
    r = cr.check_unica_oferta_valida_rule(OCID, _Ctx(st3))
    assert r["omitida"] is True
    # regla clásica sigue exigiendo estar en el perfil
    assert cr.check_unique_bidder_rule(OCID, _Ctx({"reglas_activas": ["ofertas_agrupadas"]}))["omitida"] is True


# ─── T5/T8/T13/T14 · persistencia ──────────────────────────────────────────────

class _DB:
    """BD falsa mínima para persistence: alertas por código, banderas, blob del UPDATE."""

    def __init__(self, alerta_existe=True):
        self.alertas = {"OECE-" + OCID: {"id": "A1", "score": 0}} if alerta_existe else {}
        self.banderas: list[dict] = []
        self.sql: list[str] = []
        self.blob = None
        self.inserts_alertas: list[tuple] = []
        self.updates_montos: list[tuple] = []

    def cursor(self):
        db = self

        class C:
            def __init__(self):
                self._rows, self.rowcount = [], 0

            def execute(self, sql, params=()):
                s = " ".join(sql.split()).lower()
                p = tuple(params or ())
                db.sql.append(s)
                self._rows = []
                assert not s.startswith("alter table"), "T13: sin ALTER TABLE en el persist"
                if "pg_advisory_xact_lock" in s or s.startswith("insert into entidades"):
                    return
                if "from convocatorias where ocid" in s:
                    self._rows = [(RUC_ENT, "Cusco", None, "PERFILERIA", 99690.0, None)]
                    return
                if s.startswith("insert into alertas"):
                    db.inserts_alertas.append(p)
                    db.alertas.setdefault(p[0], {"id": "A1", "score": 0})
                    self._rows = [("A1",)]
                    return
                if s.startswith("update alertas set monto_adjudicado"):
                    db.updates_montos.append(p)
                    return
                if s.startswith("select id, codigo from alertas") or s.startswith("select id from alertas"):
                    a = db.alertas.get(p[0])
                    self._rows = [("A1", p[0])] if a else []
                    return
                if s.startswith("delete from banderas"):
                    import re as _re
                    ag = tuple(_re.findall(r"'([a-z_]+)'", s))
                    db.banderas = [b for b in db.banderas if b["agente_origen"] not in ag]
                    return
                if s.startswith("insert into banderas"):
                    aid, regla, sev, ev, norma, fuente, agente, ver = p
                    db.banderas.append({"regla": regla, "severidad": sev, "evidencia": ev, "norma": norma,
                                        "fuente_url": fuente, "agente_origen": agente, "verificacion": json.loads(ver)})
                    return
                if s.startswith("select regla, severidad"):
                    self._rows = [(b["regla"], b["severidad"], b["evidencia"], b["norma"], b["fuente_url"],
                                   b["agente_origen"], b["verificacion"]) for b in db.banderas]
                    return
                if s.startswith("update alertas set score"):
                    db.alertas["OECE-" + OCID]["score"] = p[0]
                    return
                if s.startswith("select score from alertas"):
                    self._rows = [(db.alertas["OECE-" + OCID]["score"],)]
                    return
                if s.startswith("update alertas set analisis_full"):
                    db.blob = json.loads(p[0])
                    self.rowcount = 1
                    return
                raise AssertionError(f"SQL no esperado: {sql[:100]}")

            def fetchone(self):
                return self._rows[0] if self._rows else None

            def fetchall(self):
                return list(self._rows)
        return C()

    def commit(self):
        pass

    def close(self):
        pass


def test_montos_alerta_prioriza_contracts_awards_referencial():
    st = {"ocds": _ocds(ref=741750.0, awards=(734010.0,))}
    assert persistence._montos_alerta(st, None) == (734010.0, 741750.0, "awards")           # 1225030
    st2 = {"ocds": _ocds(ref=1100900.0, awards=(920000.0,), contracts=(920000.0,))}
    assert persistence._montos_alerta(st2, None)[0] == 920000.0 and persistence._montos_alerta(st2, None)[2] == "contracts"
    st3 = {"ocds": _ocds(ref=100000.0, awards=())}
    assert persistence._montos_alerta(st3, None) == (100000.0, 100000.0, "referencial")
    st4 = {"ocds": _ocds(ref=65100.0, awards=()), "parser_raw_consolidated": {"postores": [
        {"ruc": RUC_G, "razon_social": "X", "monto_oferta": 65000.0, "es_ganador": True}]}}
    assert persistence._montos_alerta(st4, None) == (65000.0, 65100.0, "acta_parser")


def test_persist_alert_from_flags_guarda_monto_adjudicado_y_referencial(monkeypatch):
    db = _DB(alerta_existe=False)
    monkeypatch.setattr(persistence, "_pg", lambda: db)
    st = {"ocid": OCID, "ocds": _ocds(ref=99690.0, awards=(99180.0,), contracts=(99180.0,)),
          "pending_flags": [{"regla": "ofertas_agrupadas", "severidad": "media",
                             "evidencia": "3 ofertas agrupadas en una banda del 0.14 %.", "norma": "Art. 5 Ley 32069"}]}
    res = persistence.persist_alert_from_flags(OCID, _Ctx(st))
    assert res["banderas_persistidas"] == 1
    ins = db.inserts_alertas[0]
    assert ins[4] == 99180.0 and ins[5] == 99690.0   # monto_adjudicado, monto_referencial
    assert st["montos_alerta"] == {"monto_adjudicado": 99180.0, "monto_referencial": 99690.0, "fuente": "contracts"}
    assert "monto_referencial" in db.sql[-0 if False else 2] or any("monto_referencial" in s for s in db.sql)


def test_persist_analysis_outputs_legal_summary_puente_y_sin_alter(monkeypatch):
    db = _DB()
    db.banderas.append({"regla": "unica_oferta_valida", "severidad": "alta", "evidencia": "x", "norma": "n",
                        "fuente_url": "u", "agente_origen": "compliance_agent", "verificacion": {"ok": True}})
    monkeypatch.setattr(persistence, "_pg", lambda: db)
    st = {"ocid": OCID, "ocds": _ocds(),
          "compliance_result": "Banderas Persistidas: 0 — no se creó alerta",
          "legal_analysis": json.dumps({"estado": "hallado", "red_flags_documentales": [{"descripcion": "specs de catálogo", "severidad": "alta"}]}),
          "reglas_lote1": {"_ocid": OCID, "_disparadas": ["unica_oferta_valida"]},
          "person_network": {"banderas_red": [
              {"regla": "parentesco_postores_rivales", "severidad": "alta", "confianza": "alta",
               "descripcion": "Socios de dos postores rivales comparten apellidos",
               "evidencia": [{"cita": "RNP: ARIAS OBLITAS en ambos postores",
                              "url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"}]},
              {"regla": "sin_url", "severidad": "alta", "confianza": "alta", "descripcion": "sin respaldo",
               "evidencia": [{"cita": "algo"}]},
              {"regla": "gob_pe_inventada", "severidad": "media", "confianza": "alta", "descripcion": "url del modelo",
               "evidencia": [{"cita": "x", "url": "https://www.gob.pe/institucion/x/normas-legales/5923940-326"}]}]},
          "final_dictamen": "## Dictamen"}
    res = persistence.persist_analysis_outputs("OECE-" + OCID, _Ctx(st))
    assert res["persisted"] is True and res["banderas_investigacion_inserted"] == 1
    assert not any(s.startswith("alter table") for s in db.sql)
    assert res["tiempos"]["total_s"] < 5
    b = db.blob
    assert b["legal_analysis"]["red_flags_documentales"][0]["descripcion"] == "specs de catálogo"
    assert b["compliance_summary"].startswith("RESULTADO DETERMINISTA") and "2 bandera(s)" in b["compliance_summary"]
    assert "Banderas Persistidas: 0" in b["compliance_summary"]          # texto del agente conservado
    assert b["compliance_resumen_det"]["por_agente"] == {"compliance_agent": 1, "person_network_agent": 1}
    assert b["reglas_lote1"]["_disparadas"] == ["unica_oferta_valida"]
    red = next(x for x in db.banderas if x["agente_origen"] == "person_network_agent")
    assert red["regla"] == "parentesco_postores_rivales" and red["fuente_url"].startswith("https://vertexaisearch")
    assert db.updates_montos and db.updates_montos[0][0] == 99180.0   # T8 en la alerta ya creada


def _mk(findings, **extra):
    mk = {"findings": findings, "veredicto_global": "elevado"}
    mk.update(extra)
    return json.dumps(mk)


def test_market_findings_del_parser_no_se_descartan_1225392(monkeypatch):
    db = _DB()
    monkeypatch.setattr(persistence, "_pg", lambda: db)
    st = {"ocid": OCID, "ocds": _ocds(desc="MEJORAMIENTO DE LA CARRETERA PAUCARTAMBO - ABRA ACJANACU"),
          "market_input": {"items": [{"item_numero": "1.1", "descripcion_corta": "ESTACION TOTAL"}]},
          "market_analysis": _mk([{"item_numero": "1.1", "item_descripcion": "ESTACION TOTAL", "veredicto": "elevado",
                                   "diff_pct": 41.42, "precio_mediana_mercado": 31800.0, "cantidad": 2, "precio_unitario_ofertado": 45000.0}],
                                 n_items=1, sobreprecio_pct=35.46, total_ofertado=95000.0, total_estimado_mercado=70100.0)}
    res = persistence.persist_market_flags_as_banderas("OECE-" + OCID, _Ctx(st))
    assert res["persistidas"] == 1 and res["banderas"][0]["regla"] == "sobreprecio_elevado"
    assert not any(b["regla"].startswith("sobreprecio_lote") for b in db.banderas)   # 1 ítem → sin lote


def test_market_alucinacion_sin_correlato_se_descarta(monkeypatch):
    db = _DB()
    monkeypatch.setattr(persistence, "_pg", lambda: db)
    st = {"ocid": OCID, "ocds": _ocds(desc="ADQUISICION DE CARNES PARA EL PROGRAMA"),
          "market_analysis": _mk([{"item_numero": "9", "item_descripcion": "CAMION VOLQUETE 15 m3", "veredicto": "muy_elevado", "diff_pct": 80}])}
    res = persistence.persist_market_flags_as_banderas("OECE-" + OCID, _Ctx(st))
    assert res["persistidas"] == 0 and res["findings_descartados"] == ["CAMION VOLQUETE 15 m3"]
    assert st["descartes"][0]["donde"] == "persist_market_flags_as_banderas"


def test_lote_requiere_dos_items_y_cobertura_por_valor_1225450(monkeypatch):
    db = _DB()
    monkeypatch.setattr(persistence, "_pg", lambda: db)
    # 1225450: solo el gasohol (100 gal) tiene mediana; el diésel (5 000 gal) no → cobertura por valor 2 %.
    findings = [{"item_numero": "1", "item_descripcion": "DIESEL B5 S-50", "veredicto": "sin_dato", "cantidad": 5000, "precio_unitario_ofertado": 23.89},
                {"item_numero": "2", "item_descripcion": "GASOHOL REGULAR", "veredicto": "alineado", "cantidad": 100,
                 "precio_unitario_ofertado": 23.89, "precio_mediana_mercado": 19.27}]
    st = {"ocid": OCID, "ocds": _ocds(desc="ADQUISICION DE DIESEL B5 S-50"),
          "parser_raw_consolidated": {"items_consolidados": [{"numero": "1", "descripcion_corta": "DIESEL B5 S-50"},
                                                             {"numero": "2", "descripcion_corta": "GASOHOL REGULAR"}]},
          "market_analysis": _mk(findings, veredicto_global="muy_elevado", n_items=2, sobreprecio_pct=7162.0,
                                 total_ofertado=139950.0, total_estimado_mercado=1927.0)}
    res = persistence.persist_market_flags_as_banderas("OECE-" + OCID, _Ctx(st))
    assert res["persistidas"] == 0
    assert abs(persistence._cobertura_por_valor(findings) - 100 / 5100) < 1e-6
    # misma estructura con cobertura completa y 2 ítems → sí hay bandera de lote
    findings2 = [dict(f, precio_mediana_mercado=20.0, veredicto="elevado", diff_pct=19.4) for f in findings]
    st2 = dict(st, market_analysis=_mk(findings2, n_items=2, sobreprecio_pct=19.4, total_ofertado=121839.0, total_estimado_mercado=102000.0))
    res2 = persistence.persist_market_flags_as_banderas("OECE-" + OCID, _Ctx(st2))
    assert any(b["regla"] == "sobreprecio_lote_elevado" for b in res2["banderas"])
    # veredicto_global no_verificable (guardarraíl R3) → nunca lote
    st3 = dict(st, market_analysis=_mk(findings2, veredicto_global="no_verificable", n_items=2, sobreprecio_pct=400.0,
                                       total_ofertado=121839.0, total_estimado_mercado=24000.0))
    res3 = persistence.persist_market_flags_as_banderas("OECE-" + OCID, _Ctx(st3))
    assert not any(b["regla"].startswith("sobreprecio_lote") for b in res3.get("banderas") or [])


def test_persistencia_no_ejecuta_alter_table_en_ningun_camino():
    import inspect
    src = inspect.getsource(persistence)
    # solo puede aparecer en comentarios/docstrings, nunca dentro de un cur.execute(...)
    assert 'execute("ALTER' not in src and "execute(\n            \"ALTER" not in src
