"""Tests del WS V: verificación determinista (tools/verify.py), persistencia sin
pérdidas (tools/persistence.py), paginación del contexto del dictamen, inyección
de state sin cortar JSON y marca de truncado en _safe_parse_json.

Todo con state sintético y una BD falsa: no toca Cloud SQL ni Gemini.
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

from tools import verify  # noqa: E402
from tools import persistence  # noqa: E402
from tools import state_loaders  # noqa: E402
from tools._core import _safe_parse_json  # noqa: E402
from agents._shared import instructions  # noqa: E402

RUC_GANADOR = "20123456789"
RUC_ENTIDAD = "20131380951"
RUC_FALSO = "20999999991"
DNI_REAL = "45678901"
DNI_FALSO = "11111111"
SHA = "a" * 64


def _state(**extra) -> dict:
    st = {
        "ocid": "1216608",
        "alerta_codigo": "OECE-1216608",
        "ocds": {
            "ocid": "ocds-dgv273-seacev3-1216608",
            "buyer": {"id": f"PE-RUC-{RUC_ENTIDAD}", "name": "MUNICIPALIDAD DE PRUEBA"},
            "parties": [
                {"id": f"PE-RUC-{RUC_ENTIDAD}", "name": "MUNICIPALIDAD DE PRUEBA", "roles": ["buyer"]},
                {"id": f"PE-RUC-{RUC_GANADOR}", "name": "PROVEEDOR EJEMPLO S.A.C.", "roles": ["tenderer", "supplier"]},
            ],
            "tender": {
                "title": "AS-SM-1-2026-MDP-1",
                "description": "ADQUISICION DE EQUIPOS DE LABORATORIO",
                "value": {"amount": 250000.0, "currency": "PEN"},
                "numberOfTenderers": 3,
                "tenderers": [{"id": f"PE-RUC-{RUC_GANADOR}", "name": "PROVEEDOR EJEMPLO S.A.C."}],
                "tenderPeriod": {"startDate": "2026-03-01T00:00:00Z"},
                "items": [{"id": "1", "description": "ESPECTROFOTOMETRO", "quantity": 2}],
                "documents": [{"title": "Bases", "documentType": "biddingDocuments", "url": "https://prod1.seace.gob.pe/x"}],
            },
            "awards": [{"id": "1", "date": "2026-04-10T00:00:00Z",
                        "suppliers": [{"id": f"PE-RUC-{RUC_GANADOR}", "name": "PROVEEDOR EJEMPLO S.A.C."}],
                        "value": {"amount": 245000.0, "currency": "PEN"}}],
        },
        "sunat_decolecta": {RUC_GANADOR: {"razon_social": "PROVEEDOR EJEMPLO S.A.C.",
                                         "fecha_inicio_actividades": "2019-05-20"}},
        "batch_person_lookup_firmantes": {"personas": [{"nombre": "JUAN PEREZ", "dni": DNI_REAL}]},
        "documentos_texto": {SHA: {"n_paginas": 2, "chars": 200,
                                   "texto": "⟦p.1⟧ BASES DEL PROCESO. Mediante D.S. N° 045-2026-PCM se declara "
                                            "la emergencia. ⟦p.2⟧ Firma: JUAN PEREZ DNI 45678901. RUC 20123456789."}},
        "grounding_urls": ["https://www.mercadolibre.com.pe/item-1"],
    }
    st.update(extra)
    return st


@pytest.fixture(autouse=True)
def _sin_bd(monkeypatch):
    """La verificación no consulta la BD propia ni la tabla documentos_texto en tests."""
    monkeypatch.setattr(verify, "_en_bd", lambda kind, valor: False)
    monkeypatch.setattr(verify, "_texto_documento", lambda sha: None)
    verify._bd_cache.clear()
    verify._texto_cache.clear()


# ─── verificar_bandera ───────────────────────────────────────────────────────

def test_ruc_inexistente_descarta():
    flag = {"regla": "ruc_ganador_muy_nuevo", "severidad": "alta",
            "evidencia": f"EMPRESA X (RUC {RUC_FALSO}) tiene 3 meses de antigüedad."}
    res = verify.verificar_bandera(flag, _state())
    assert res["ok"] is False
    assert f"ruc:{RUC_FALSO}:no_respaldado" in res["motivos"]
    assert flag["verificacion"] is res


def test_ruc_en_ocds_respalda():
    flag = {"regla": "x", "evidencia": f"PROVEEDOR EJEMPLO S.A.C. (RUC {RUC_GANADOR}) adjudicado."}
    res = verify.verificar_bandera(flag, _state())
    assert res["ok"] is True
    assert any(m.startswith(f"ruc:{RUC_GANADOR}:") and m.endswith("fuente_determinista") for m in res["motivos"])


def test_ruc_persona_natural_respaldado_por_dni():
    """RUC 10 + DNI + dígito: se acepta si el DNI está en batch_person_lookup."""
    flag = {"regla": "x", "evidencia": f"Persona natural RUC 10{DNI_REAL}3."}
    res = verify.verificar_bandera(flag, _state())
    assert res["ok"] is True
    assert any("dni_de_ruc_natural" in m for m in res["motivos"])


def test_url_no_en_grounding_es_no_verificable_no_descarta():
    flag = {"regla": "x", "evidencia": "Precio visto en https://tienda-desconocida.com/p/1 ."}
    res = verify.verificar_bandera(flag, _state())
    assert res["ok"] is True
    assert "url:https://tienda-desconocida.com/p/1:no_en_grounding" in res["motivos"]
    # sin registro de grounding → no_verificable (no "falsa")
    st = _state()
    st.pop("grounding_urls")
    res2 = verify.verificar_bandera(dict(flag), st)
    assert res2["ok"] is True
    assert "url:https://tienda-desconocida.com/p/1:no_verificable" in res2["motivos"]


def test_url_oficial_o_en_grounding_respaldada():
    flag = {"regla": "x", "evidencia": "Ver https://contratacionesabiertas.oece.gob.pe/proceso/1216608 y "
                                       "https://www.mercadolibre.com.pe/item-1"}
    res = verify.verificar_bandera(flag, _state())
    assert res["ok"] is True
    assert any(m.endswith(":oficial_o_determinista") for m in res["motivos"])
    assert "url:https://www.mercadolibre.com.pe/item-1:grounding" in res["motivos"]


def test_monto_distinto_a_ocds_motivo_y_descarte():
    flag = {"regla": "sobreprecio", "evidencia": "Monto adjudicado S/. 999,999.00 según acta."}
    res = verify.verificar_bandera(flag, _state())
    assert res["ok"] is False
    assert "monto:999,999.00:no_respaldado" in res["motivos"]


def test_monto_igual_a_ocds_respaldado():
    flag = {"regla": "x", "evidencia": "Adjudicado por S/. 245,000.00 (valor referencial 250000.00 soles)."}
    res = verify.verificar_bandera(flag, _state())
    assert res["ok"] is True
    assert "monto:245,000.00:fuente_determinista" in res["motivos"]
    assert "monto:250000.00:fuente_determinista" in res["motivos"]


def test_monto_respaldado_por_market_analysis():
    st = _state(market_analysis={"total_estimado_mercado": 180000.0, "findings": []})
    flag = {"regla": "sobreprecio_lote_elevado",
            "evidencia": "Lote completo: precio ofertado total S/. 245,000.00 vs estimado de mercado S/. 180,000.00"}
    res = verify.verificar_bandera(flag, st)
    assert res["ok"] is True
    assert "monto:180,000.00:market_analysis" in res["motivos"]


def test_dni_con_contexto_en_batch_lookup_o_descartado():
    ok = verify.verificar_bandera({"evidencia": f"Firmante JUAN PEREZ (DNI {DNI_REAL})"}, _state())
    assert ok["ok"] is True
    bad = verify.verificar_bandera({"evidencia": f"Firmante X, DNI N° {DNI_FALSO}"}, _state())
    assert bad["ok"] is False and f"dni:{DNI_FALSO}:no_respaldado" in bad["motivos"]


def test_ocho_digitos_sin_contexto_no_se_toman_como_dni():
    res = verify.verificar_bandera({"evidencia": "Resolución N° 12345678-2026 emitida."}, _state())
    assert res["ok"] is True
    assert not any(m.startswith("dni:") for m in res["motivos"])


def test_sin_identificadores_ok():
    res = verify.verificar_bandera({"regla": "procedimiento_no_competitivo",
                                    "evidencia": "Tipo de proceso: Contratación Directa"}, _state())
    assert res["ok"] is True and res["motivos"] == ["sin_identificadores_verificables"]


def test_documentos_texto_respalda_y_da_pagina():
    st = _state()
    st["ocds"]["parties"] = []          # el RUC solo vive en el texto del documento
    st["ocds"]["tender"]["tenderers"] = []
    st["ocds"]["awards"] = []
    st.pop("sunat_decolecta")
    res = verify.verificar_bandera({"evidencia": f"RUC {RUC_GANADOR} figura en bases."}, st)
    assert res["ok"] is True and f"ruc:{RUC_GANADOR}:documentos_texto" in res["motivos"]
    hit = verify.buscar_en_documentos(st, r"D\.S\.\s*N°\s*\d{3}-\d{4}-PCM")
    assert hit and hit["pagina"] == 1 and hit["sha256"] == SHA and "045-2026-PCM" in hit["cita"]
    hit2 = verify.buscar_en_documentos(st, DNI_REAL)
    assert hit2 and hit2["pagina"] == 2


# ─── verificar_dictamen ──────────────────────────────────────────────────────

def test_dictamen_bandera_inexistente_y_url_sin_respaldo():
    st = _state(banderas=[{"regla": "unico_postor_alto", "severidad": "alta", "evidencia": "..."}],
                web_research={"fuentes": [{"url": "https://elcomercio.pe/nota-real"}]})
    md = ("## Dictamen\nLa bandera `unico_postor_alto` se confirma; además `proveedor_sancionado_osce` "
          "(inventada). Fuente: https://elcomercio.pe/nota-real y https://blog-inventado.com/x")
    res = verify.verificar_dictamen(md, st)
    assert res["banderas_no_existentes"] == ["proveedor_sancionado_osce"]
    assert res["urls_no_respaldadas"] == ["https://blog-inventado.com/x"]
    assert res["degradado"] is True
    assert "unico_postor_alto" in res["banderas_citadas"]


def test_dictamen_limpio_no_degradado():
    st = _state(banderas=[{"regla": "unico_postor_alto", "severidad": "alta", "evidencia": "..."}])
    md = (f"## Dictamen\nPROVEEDOR EJEMPLO S.A.C. (RUC {RUC_GANADOR}) ganó por S/ 245,000.00; "
          f"bandera unico_postor_alto. Fuente https://contratacionesabiertas.oece.gob.pe/proceso/1216608")
    res = verify.verificar_dictamen(md, st)
    assert res["degradado"] is False
    assert res["rucs_no_respaldados"] == [] and res["urls_no_respaldadas"] == []


def test_dictamen_ruc_inventado():
    st = _state(banderas=[])
    res = verify.verificar_dictamen(f"Empresa fantasma RUC {RUC_FALSO}.", st)
    assert res["rucs_no_respaldados"] == [RUC_FALSO] and res["degradado"] is True


# ─── Persistencia: regresión "no borrar banderas de otros agentes" ───────────

class _FakeCursor:
    def __init__(self, db):
        self.db = db
        self._rows = []
        self.rowcount = 0

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        p = tuple(params or ())
        self._rows = []
        if "pg_advisory_xact_lock" in s or s.startswith("alter table") or s.startswith("insert into entidades"):
            return
        if s.startswith("update alertas set monto_adjudicado"):   # T8 (R1): montos adjudicado/referencial
            return
        if "from convocatorias where ocid" in s:
            return                                   # convocatoria no registrada → fallback OCDS
        if s.startswith("insert into alertas"):
            codigo = p[0]
            self.db.alertas.setdefault(codigo, {"id": "A1", "score": 0, "codigo": codigo})
            self._rows = [("A1",)]
            return
        if s.startswith("select id, codigo from alertas") or s.startswith("select id from alertas"):
            a = self.db.alertas.get(p[0])
            self._rows = [(a["id"], a["codigo"])] if a else []
            return
        if s.startswith("delete from banderas"):
            self.db.deletes.append(s)
            aid = p[0]
            if "agente_origen='compliance_agent'" in s:
                self.db.banderas = [b for b in self.db.banderas
                                    if not (b["alerta_id"] == aid and b["agente_origen"] == "compliance_agent")]
            elif "agente_origen='market_price_agent'" in s:
                self.db.banderas = [b for b in self.db.banderas
                                    if not (b["alerta_id"] == aid and b["agente_origen"] == "market_price_agent")]
            elif "agente_origen in" in s:
                # lista literal del SQL: ('document_parser_agent','document_legal_analyst_agent') o
                # ('person_network_agent','web_research_agent','news_research_agent') (puente lote 1)
                import re as _re
                agentes = tuple(_re.findall(r"'([a-z_]+)'", s.split("agente_origen in", 1)[1]))
                self.db.banderas = [b for b in self.db.banderas
                                    if not (b["alerta_id"] == aid and b["agente_origen"] in agentes)]
            else:
                raise AssertionError(f"DELETE global de banderas prohibido: {sql}")
            return
        if s.startswith("insert into banderas"):
            aid, regla, sev, ev, norma, fuente, agente, ver = p
            self.db.banderas.append({"alerta_id": aid, "regla": regla, "severidad": sev, "evidencia": ev,
                                     "norma": norma, "fuente_url": fuente, "agente_origen": agente,
                                     "verificacion": json.loads(ver) if ver else None})
            return
        if s.startswith("select regla, severidad, evidencia, norma, fuente_url, agente_origen, verificacion from banderas"):
            self._rows = [(b["regla"], b["severidad"], b["evidencia"], b["norma"], b["fuente_url"],
                           b["agente_origen"], b["verificacion"]) for b in self.db.banderas if b["alerta_id"] == p[0]]
            return
        if s.startswith("update alertas set score"):
            score, reglas, aid = p
            for a in self.db.alertas.values():
                if a["id"] == aid:
                    a["score"] = score
                    a["reglas_disparadas"] = reglas
            return
        if s.startswith("select score from alertas"):
            for a in self.db.alertas.values():
                if a["id"] == p[0]:
                    self._rows = [(a["score"],)]
            return
        if s.startswith("update alertas set monto_adjudicado"):
            return  # T8: corrección de montos en el checkpoint (sin efecto en el fake)
        if s.startswith("update alertas set analisis_full"):
            self.rowcount = 1 if p[2] in self.db.alertas else 0
            return
        raise AssertionError(f"SQL no esperado en el fake: {sql[:120]}")

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class _FakeDB:
    def __init__(self):
        self.alertas = {}
        self.banderas = []
        self.deletes = []
        self.commits = 0

    def cursor(self):
        return _FakeCursor(self)

    def commit(self):
        self.commits += 1

    def close(self):
        pass


class _Ctx:
    def __init__(self, state):
        self.state = state


def test_persist_alert_from_flags_no_borra_otros_agentes_y_suma_score(monkeypatch):
    db = _FakeDB()
    db.alertas["OECE-1216608"] = {"id": "A1", "score": 0, "codigo": "OECE-1216608"}
    db.banderas = [
        {"alerta_id": "A1", "regla": "red_flag_documental", "severidad": "media", "evidencia": "marca única",
         "norma": "Art. 16", "fuente_url": "u", "agente_origen": "document_legal_analyst_agent", "verificacion": None},
        {"alerta_id": "A1", "regla": "red_flag_documental", "severidad": "baja", "evidencia": "plazo corto",
         "norma": "Art. 16", "fuente_url": "u", "agente_origen": "document_legal_analyst_agent", "verificacion": None},
        {"alerta_id": "A1", "regla": "sobreprecio_elevado", "severidad": "media", "evidencia": "Ítem 1: +20%",
         "norma": "Art. 12", "fuente_url": "u", "agente_origen": "market_price_agent", "verificacion": None},
        {"alerta_id": "A1", "regla": "vieja_compliance", "severidad": "alta", "evidencia": "obsoleta",
         "norma": "x", "fuente_url": "u", "agente_origen": "compliance_agent", "verificacion": None},
    ]
    monkeypatch.setattr(persistence.alert_flags, "_pg", lambda: db)
    st = _state(pending_flags=[
        {"regla": "unico_postor_alto", "severidad": "alta", "evidencia": "Un solo postor al 98% del referencial.",
         "norma": "Art. 27", "fuente_url": "https://contratacionesabiertas.oece.gob.pe/proceso/1216608"},
        {"regla": "unico_postor_alto", "severidad": "alta", "evidencia": "Un solo postor al 98% del referencial.",
         "norma": "Art. 27"},   # duplicado → se dedupe
        {"regla": "procedimiento_no_competitivo", "severidad": "baja", "evidencia": "Tipo de proceso: Directa",
         "norma": "Art. 55"},
        {"regla": "ruc_ganador_muy_nuevo", "severidad": "alta",
         "evidencia": f"EMPRESA FANTASMA (RUC {RUC_FALSO}) creada hace 2 meses.", "norma": "Art. 50"},
    ])
    res = persistence.persist_alert_from_flags("1216608", _Ctx(st))

    assert res["banderas_persistidas"] == 2 and res["banderas_descartadas"] == 1
    origenes = sorted(b["agente_origen"] for b in db.banderas)
    assert origenes == ["compliance_agent", "compliance_agent", "document_legal_analyst_agent",
                        "document_legal_analyst_agent", "market_price_agent"]
    assert not any(b["regla"] == "vieja_compliance" for b in db.banderas)   # solo borró las propias
    assert all("alerta_id=%s and agente_origen" in d for d in db.deletes)
    # score = legal (12 + 5) + market (12) + compliance (35 + 8) = 72
    assert res["score"] == 72 and db.alertas["OECE-1216608"]["score"] == 72
    assert res["banderas_total_alerta"] == 5 and len(st["banderas"]) == 5
    assert st["descartes"] and st["descartes"][0]["regla"] == "ruc_ganador_muy_nuevo"
    assert f"ruc:{RUC_FALSO}:no_respaldado" in st["descartes"][0]["motivos"]
    persistida = next(b for b in db.banderas if b["regla"] == "unico_postor_alto")
    assert persistida["verificacion"]["ok"] is True
    assert sorted(db.alertas["OECE-1216608"]["reglas_disparadas"]) == [
        "procedimiento_no_competitivo", "red_flag_documental", "sobreprecio_elevado", "unico_postor_alto"]


def test_persist_analysis_outputs_consume_pending_market_y_doc_flags(monkeypatch):
    db = _FakeDB()
    db.alertas["OECE-1216608"] = {"id": "A1", "score": 0, "codigo": "OECE-1216608"}
    monkeypatch.setattr(persistence.analysis_outputs, "_pg", lambda: db)
    st = _state(
        pending_market_flags=[{"regla": "sobreprecio_lote_elevado", "severidad": "media",
                               "evidencia": "Lote completo: +20% sobre el estimado.", "norma": "Art. 12"}],
        pending_doc_flags=[{"descripcion": "Marca única exigida en EETT", "severidad": "alta", "norma_citada": "Art. 16"}],
        news_research="texto libre que no es JSON ni por asomo",
        final_dictamen="## Dictamen\nok",
    )
    res = persistence.persist_analysis_outputs("OECE-1216608", _Ctx(st))
    assert res["persisted"] is True
    assert res["doc_flags_diferidas_inserted"] == 2
    assert sorted(b["agente_origen"] for b in db.banderas) == ["document_legal_analyst_agent", "market_price_agent"]
    assert db.alertas["OECE-1216608"]["score"] == 25 + 12
    assert "pending_market_flags" not in st and "pending_doc_flags" not in st
    # output no parseable → sin_dato + warn, nunca texto crudo
    assert any("news_research" in w for w in res["warns"])
    assert any(d.get("agente") == "news_research" for d in st["descartes"])


# ─── Contexto del dictamen ───────────────────────────────────────────────────

def test_dictamen_context_incluye_banderas_y_pagina_con_marca(monkeypatch):
    monkeypatch.setattr(state_loaders, "_pg", lambda: (_ for _ in ()).throw(RuntimeError("sin bd")))
    st = _state(
        banderas=[{"regla": "unico_postor_alto", "severidad": "alta", "evidencia": "x", "agente_origen": "compliance_agent"}],
        entity_personnel=json.dumps({"funcionarios_designados": [{"nombre": "A"}]}),
        estado_real={"estado_ocds": "adjudicada"},
        recortes=[{"donde": "parser", "limite": 12, "omitido": 3}],
        descartes=[{"donde": "persist", "regla": "x"}],
        normative_compliance={"evaluaciones": [{"hallazgo": {"titulo": f"h{i}"}} for i in range(80)]},
        legal_analysis=json.dumps({"vectores": ["a" * 7000]}),
        news_research="no es json",
    )
    ctx = state_loaders.get_dictamen_context(_Ctx(st))
    assert ctx["banderas"][0]["regla"] == "unico_postor_alto"
    assert ctx["entity_personnel"]["funcionarios_designados"][0]["nombre"] == "A"
    assert ctx["estado_real"]["estado_ocds"] == "adjudicada"
    assert ctx["recortes"][0]["omitido"] == 3 and ctx["descartes"][0]["regla"] == "x"
    ev = ctx["normative_compliance"]["evaluaciones"]
    assert ev["_truncado"] is True and ev["_omitidos"] == 20 and ev["_total"] == 80 and len(ev["items"]) == 60
    assert "_truncado: 1000 chars omitidos" in ctx["legal_analysis"]["vectores"][0]
    assert ctx["news_research"] == {"estado": "sin_dato", "_parse_failed": True,
                                    "_motivo": "output del agente no parseable como JSON"}
    assert ctx["ocds"]["tender"]["numberOfTenderers"] == 3 and ctx["ocds"]["tender"]["n_documents"] == 1
    # reintento compacto: NO se elimina legal_analysis
    st["_dictamen_compact"] = True
    ctx2 = state_loaders.get_dictamen_context(_Ctx(st))
    assert ctx2["legal_analysis"] is not None
    assert ctx2["normative_compliance"]["evaluaciones"]["_omitidos"] == 65


# ─── Inyección de state sin cortar JSON ──────────────────────────────────────

def test_serializar_acotado_siempre_json_valido():
    data = {"personas": [{"nombre": f"P{i}", "aportes": [{"monto": j} for j in range(50)]} for i in range(200)],
            "resumen": "x" * 20000}
    blob, recorte = instructions.serializar_acotado(data, max_chars=8000)
    assert len(blob) <= 8000
    parsed = json.loads(blob)                       # nunca cortado a mitad de string
    assert recorte is not None and recorte["pasos"] >= 1
    assert parsed["personas"]["_truncado"] is True and parsed["personas"]["_total"] == 200
    blob2, recorte2 = instructions.serializar_acotado({"a": 1}, max_chars=8000)
    assert recorte2 is None and json.loads(blob2) == {"a": 1}


def test_make_state_aware_instruction_inyecta_json_valido_y_registra_recorte():
    class _C:
        state = {"person_network_context": {"personas": [{"n": i, "t": "z" * 500} for i in range(400)]},
                 "recortes": []}
    provider = instructions.make_state_aware_instruction("PROMPT", [("person_network_context", "RED")])
    out = provider(_C())
    blob = out.split("═══\n")[-1].strip()
    parsed = json.loads(blob)
    assert parsed["personas"]["_truncado"] is True
    assert "RECORTADO" in out
    assert _C.state["recortes"] and _C.state["recortes"][0]["donde"] == "inyeccion:person_network_context"


# ─── _safe_parse_json marca truncado ─────────────────────────────────────────

def test_safe_parse_json_marca_truncado():
    cortado = '{"items": [{"a": 1}, {"a": 2}, {"a": 3, "desc": "texto que se cor'
    out = _safe_parse_json(cortado)
    assert out.get("_truncado") is True and len(out["items"]) == 3
    entero = _safe_parse_json('{"a": 1}')
    assert "_truncado" not in entero
    forzado = _safe_parse_json('{"a": 1}', truncated=True)
    assert forzado["_truncado"] is True and forzado["_truncado_motivo"] == "max_output_tokens"
