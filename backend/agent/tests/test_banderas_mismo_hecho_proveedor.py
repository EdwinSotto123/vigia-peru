"""Banderas de proveedor: el mismo hecho una vez, la prensa del proveedor y de qué ganador trata cada bandera.

Caso real 2026-2543-197 (EsSalud, 13 medicamentos, 8 ganadores; 2026-11-24). La alerta nombró a HAMUQ FARMA E.I.R.L.
(RUC 20613527134, inicio de actividades 2024-12-06, 615 días a la buena pro) y el dictamen llegó a 100 con 5 banderas:

  · alta  ruc_ganador_muy_nuevo            — la fecha de inicio y el monto.
  · alta  antecedente_proveedor_web        — «Empresa recién fundada con alto volumen contractual»: la misma fecha.
  · media capacidad_operativa_cuestionable — la misma fecha + el monto (+ un directorio que la muestra como laboratorio).
  · media cobertura_prensa_adversa ×2      — notas de EsSalud (Contraloría 2025, desvío de Osmolite) que no la nombran.

Y `procedimiento_no_competitivo` sumaba 18 puntos a TODA contratación directa por construcción (1213369: 100/100).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools import compliance_rules as cr  # noqa: E402
from tools.persistence import alert_flags  # noqa: E402
from tools.persistence.analysis_outputs import _banderas_investigacion  # noqa: E402
from tools.persistence.shared import (_insert_bandera, con_ganador_principal, mismo_hecho_que,  # noqa: E402
                                      puntaje_de, sin_mismo_hecho)
from pipeline_reglas import _linea  # noqa: E402
from tests.test_reglas_lote1 import _Ctx, _FakeConn  # noqa: E402

HAMUQ = "20613527134"
ACFARMA = "20347268683"
MEDIFARMA = "20100018625"
URL_SUNAT = f"https://sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={HAMUQ}"
URL_VADEMECUM = "https://www.vademecum.es/peru/medicamento/1624179/azitromicina-hamuq-farma-200-mg-5-ml-polvo-para-susp-oral"
URL_RCR = ("https://www.rcrperu.com/contraloria-deficiencias-en-disponibilidad-y-abastecimiento-de-medicamentos-"
           "en-hospitales-del-seguro-social-de-salud-en-14-regiones/")
URL_EXITOSA = "https://www.facebook.com/Exitosanoticias/videos/1534292694690601/"

EV_RUC_NUEVO = (f"HAMUQ FARMA E.I.R.L. (RUC {HAMUQ}) inició actividades el 2024-12-06: tenía 615 días (20.5 meses) a la "
                "buena pro de un contrato de S/ 1,474,235.95. Patrón de empresa nueva con un contrato grande; requiere "
                "verificar su capacidad real.")
EV_CAPACIDAD = ("perfil SUNAT: fecha_inicio_actividades = 2024-12-06, estado ACTIVO, condicion HABIDO, edad_dias 615; "
                "monto adjudicado S/ 1,474,235.95 (>= 8 UIT); web_research.hallazgos_por_fuente[vademecum.es (directorio "
                "farmacéutico)].mensaje = 'HAMUQ FARMA E.I.R.L. figura como laboratorio/fabricante de medicamentos "
                "registrados en Perú'")
TITULO_WEB = "Empresa recién fundada con alto volumen contractual"
EV_WEB = (f"{TITULO_WEB}: Según el padrón SUNAT (base de Vigía), HAMUQ FARMA E.I.R.L. inició actividades el 2024-12-06 "
          "y la base de Vigía registra 40 procesos con el Estado por S/ 74,084,486.33 entre 2025-05-22 y 2026-09-21.")


def _b(regla, sev, evidencia, agente="compliance_agent", **kw):
    return {"regla": regla, "severidad": sev, "evidencia": evidencia, "agente_origen": agente, **kw}


def _cinco_banderas(prensa_puntua=True):
    """Las 5 filas como quedaron en `banderas` (prod, 2026-2543-197)."""
    return [_b("ruc_ganador_muy_nuevo", "alta", EV_RUC_NUEVO, ganador_ruc=HAMUQ),
            _b("capacidad_operativa_cuestionable", "media", EV_CAPACIDAD),
            _b("antecedente_proveedor_web", "alta", EV_WEB, "web_research_agent"),
            _b("cobertura_prensa_adversa", "media", "Contraloría: deficiencias en abastecimiento de medicamentos en "
               "hospitales de EsSalud en 14 regiones", "news_research_agent", puntua=prensa_puntua),
            _b("cobertura_prensa_adversa", "media", "EsSalud entrega documentación a la Fiscalía por presunto desvío "
               "de medicamento (Osmolite)", "news_research_agent", puntua=prensa_puntua)]


# ═════════════════════════════════════════════════════════════════════
# 1 · El RUC nuevo del ganador cuenta una vez
# ═════════════════════════════════════════════════════════════════════
def test_web_y_capacidad_que_repiten_la_edad_no_se_publican():
    st: dict = {}
    banderas = _cinco_banderas()
    out = sin_mismo_hecho(banderas, st, "test")
    assert [b["regla"] for b in out] == ["ruc_ganador_muy_nuevo", "cobertura_prensa_adversa", "cobertura_prensa_adversa"]
    assert {d["regla"]: d["motivo"] for d in st["descartes"]} == {
        "capacidad_operativa_cuestionable": "mismo_hecho_que_ruc_ganador_muy_nuevo",
        "antecedente_proveedor_web": "mismo_hecho_que_ruc_ganador_muy_nuevo"}


def test_el_puntaje_usa_la_lista_sin_el_mismo_hecho():
    # Las 5 filas viejas: 35 + 18 + 25 + 12 + 12 = 102 → 100. Sin repetir la edad: 35 + 12 + 12.
    assert puntaje_de(_cinco_banderas()) == 59
    # Y con la prensa de la entidad como contexto (sin puntaje), queda la regla determinista.
    assert puntaje_de(_cinco_banderas(prensa_puntua=False)) == 35


def test_con_otro_hecho_la_bandera_se_queda():
    ruc = _b("ruc_ganador_muy_nuevo", "alta", EV_RUC_NUEVO, ganador_ruc=HAMUQ)
    # Capacidad con base propia (planilla, domicilio): no es solo la edad.
    cap = _b("capacidad_operativa_cuestionable", "media", EV_CAPACIDAD + "; SUNAT: 0 trabajadores en planilla")
    assert mismo_hecho_que(cap, [ruc, cap]) is None
    # Web que además dice una sanción, o cuyo título es otro hecho.
    web_sancion = _b("antecedente_proveedor_web", "alta", EV_WEB + " Fue sancionada por el Tribunal en 2025.",
                     "web_research_agent")
    web_otro = _b("antecedente_proveedor_web", "alta", "Denuncia por medicamentos adulterados: la DIGEMID intervino su "
                  "almacén (2026).", "web_research_agent", titulo="Denuncia por medicamentos adulterados")
    assert mismo_hecho_que(web_sancion, [ruc, web_sancion]) is None
    assert mismo_hecho_que(web_otro, [ruc, web_otro]) is None
    # La edad de OTRO ganador no es el mismo hecho.
    web_otro_ganador = _b("antecedente_proveedor_web", "alta", EV_WEB, "web_research_agent", ganador_ruc=ACFARMA)
    assert mismo_hecho_que(web_otro_ganador, [ruc, web_otro_ganador]) is None
    # Sin la regla de RUC nuevo, la web y la capacidad sí son la señal.
    assert sin_mismo_hecho(_cinco_banderas()[1:3], {}, "test") == _cinco_banderas()[1:3]


def test_ruc_ultra_nuevo_es_la_mas_especifica_y_solo_la_del_adjudicatario():
    ultra = _b("ruc_ultra_nuevo", "alta", f"X (RUC {HAMUQ}), adjudicatario, tenía 40 días", ganador_ruc=HAMUQ)
    muy = _b("ruc_ganador_muy_nuevo", "alta", EV_RUC_NUEVO, ganador_ruc=HAMUQ)
    assert [b["regla"] for b in sin_mismo_hecho([muy, ultra], {}, "test")] == ["ruc_ultra_nuevo"]
    # La de un postor que perdió no tapa la del ganador ni ancla la web.
    ultra_postor = _b("ruc_ultra_nuevo", "media", "El postor no ganador Y (RUC 20609999999) tenía 30 días",
                      postor_ruc="20609999999")
    web = _b("antecedente_proveedor_web", "alta", EV_WEB, "web_research_agent")
    assert sin_mismo_hecho([muy, ultra_postor], {}, "test") == [muy, ultra_postor]
    assert mismo_hecho_que(web, [ultra_postor, web]) is None


def test_la_web_contra_las_banderas_que_la_alerta_ya_tiene():
    """En persist_analysis_outputs la regla de RUC nuevo ya está en la base (leída con `_leer_banderas`)."""
    en_base = [{"regla": "ruc_ganador_muy_nuevo", "severidad": "alta", "evidencia": EV_RUC_NUEVO,
                "agente_origen": "compliance_agent", "verificacion": {"ok": True, "ganador_ruc": HAMUQ}}]
    web = _b("antecedente_proveedor_web", "alta", EV_WEB, "web_research_agent", titulo=TITULO_WEB, ganador_ruc=HAMUQ)
    st: dict = {}
    assert sin_mismo_hecho([web], st, "persist_analysis_outputs(investigacion)", contexto=en_base) == []
    assert st["descartes"][0]["motivo"] == "mismo_hecho_que_ruc_ganador_muy_nuevo"


class _Cur:
    """Cursor falso de persist_alert_from_flags: devuelve la convocatoria y el id de la alerta."""

    def __init__(self):
        self.sql = []

    def execute(self, sql, params=()):
        self.sql.append(" ".join(sql.split()).lower())

    def fetchone(self):
        s = self.sql[-1]
        if "from convocatorias" in s:
            return ("20131257750", "LIMA", dt.date(2026, 8, 13), "PRODUCTOS FARMACEUTICOS", 50957933.71, HAMUQ)
        if "insert into alertas" in s:
            return ("00000000-0000-0000-0000-000000000001",)
        return None


def test_persist_alert_from_flags_no_inserta_la_capacidad_repetida(monkeypatch):
    insertadas = []
    cur = _Cur()
    monkeypatch.setattr(alert_flags, "_pg", lambda: type("C", (), {"cursor": lambda s: cur, "commit": lambda s: None,
                                                                    "close": lambda s: None})())
    monkeypatch.setattr(alert_flags, "_verificar_o_descartar", lambda b, st, donde, ag: True)
    monkeypatch.setattr(alert_flags, "_insert_bandera", lambda cur_, aid, regla, *a, **kw: insertadas.append((regla, kw)))
    monkeypatch.setattr(alert_flags, "_recalcular_score", lambda cur_, aid, st: (0, []))
    st = {"expediente_proveedor": {"ruc": HAMUQ},
          "pending_flags": [{"regla": "ruc_ganador_muy_nuevo", "severidad": "alta", "evidencia": EV_RUC_NUEVO,
                             "ganador_ruc": HAMUQ, "triggered": True},
                            {"regla": "capacidad_operativa_cuestionable", "severidad": "media", "evidencia": EV_CAPACIDAD,
                             "triggered": True, "_source": "orchestrator_paso_7.7"}]}
    res = alert_flags.persist_alert_from_flags("2026-2543-197", _Ctx(st))
    assert [r for r, _ in insertadas] == ["ruc_ganador_muy_nuevo"]
    assert insertadas[0][1]["ganador_ruc"] == HAMUQ
    assert res["banderas_persistidas"] == 1 and res["banderas_descartadas"] == 1
    assert [b["regla"] for b in st["pending_flags"]] == ["ruc_ganador_muy_nuevo"]


# ═════════════════════════════════════════════════════════════════════
# 2 · La prensa adversa tiene que nombrar al proveedor
# ═════════════════════════════════════════════════════════════════════
def _nota(titulo, descripcion, cita, url):
    return {"estado": "hallado", "severidad": "media", "titulo": titulo, "descripcion": descripcion, "url": url,
            "evidencia": [{"url": url, "cita": cita}]}


def _estado_prensa(notas):
    return {
        "grounding_urls": [n["url"] for n in notas],
        "news_research": {"banderas_prensa": notas},
        "expediente_proveedor": {"ruc": HAMUQ, "sunat": {"razon_social": "HAMUQ FARMA E.I.R.L."}},
        "person_network_context": {
            "ganador": {"ruc": HAMUQ, "razon_social": "HAMUQ FARMA E.I.R.L."},
            "rnp_proveedor": {"ruc": HAMUQ, "socios": [{"nombre": "gamarra garcia oscar paul"},
                                                       {"nombre": "VILLARREAL VINCES LUIS"}]}},
        "ocds": {"awards": [{"suppliers": [{"id": f"PE-RUC-{MEDIFARMA}", "name": "MEDIFARMA S A"}]},
                            {"suppliers": [{"id": f"PE-RUC-{HAMUQ}", "name": "HAMUQ FARMA E.I.R.L."}]}]},
    }


NOTAS_ENTIDAD = [
    _nota("Contraloría: deficiencias en abastecimiento de medicamentos en hospitales de EsSalud en 14 regiones",
          # La descripción real del agente nombra al proveedor para decir que la nota NO lo nombra.
          "Informe de control de la Contraloría (enero 2025) sobre gestión de medicamentos en 27 establecimientos de "
          "EsSalud. Contexto institucional relevante; no menciona a HAMUQ FARMA ni este proceso.",
          "23 de las 27 farmacias de los establecimientos de salud supervisados presentaron desabastecimiento", URL_RCR),
    _nota("EsSalud entrega documentación a la Fiscalía por presunto desvío de medicamento (Osmolite)",
          "Hecho distinto al contrato analizado; refleja riesgo de corrupción interno vigente en la entidad.",
          "entregará la documentación necesaria a la Fiscalía para contribuir con el esclarecimiento", URL_EXITOSA),
]


def test_prensa_de_la_entidad_queda_como_contexto_sin_puntaje():
    out = _banderas_investigacion(_estado_prensa(NOTAS_ENTIDAD))
    assert [b["regla"] for b in out] == ["cobertura_prensa_adversa"] * 2
    assert all(b["puntua"] is False and b["ganador_ruc"] is None for b in out)
    assert all(b["evidencia"].startswith("Contexto, no del proveedor") for b in out)


def test_prensa_que_nombra_al_proveedor_es_bandera():
    url = "https://diario.pe/hamuq"
    casos = [
        (_nota("Investigan a Hamuq Farma por medicamentos observados", "La DIGEMID observó lotes.", "Hamuq Farma E.I.R.L. "
               "entregó lotes observados", url), HAMUQ),
        (_nota("Proveedor de EsSalud investigado", "La empresa fue denunciada.", f"la empresa con RUC {HAMUQ} fue "
               "denunciada", url), HAMUQ),
        (_nota("Denuncian a gerente de droguería", "Oscar Gamarra, gerente, fue denunciado por la Fiscalía.",
               "Oscar Paul Gamarra García fue citado", url), HAMUQ),
        (_nota("Medifarma multada por la DIGEMID", "La DIGEMID multó a Medifarma.", "Medifarma S.A. fue multada", url),
         MEDIFARMA),
    ]
    for nota, ruc in casos:
        out = _banderas_investigacion(_estado_prensa([nota]))
        assert len(out) == 1 and out[0]["puntua"] is True and out[0]["ganador_ruc"] == ruc, nota["titulo"]
    # Un apellido solo no alcanza.
    nota = _nota("Gamarra inaugura obra", "El alcalde Gamarra inauguró un puente.", "Gamarra inauguró", url)
    assert _banderas_investigacion(_estado_prensa([nota]))[0]["puntua"] is False


def test_la_web_lleva_titulo_y_ganador():
    st = _estado_prensa([])
    st["web_research"] = {"empresa": {"ruc": HAMUQ, "razon_social": "HAMUQ FARMA E.I.R.L."}, "banderas_sugeridas": [
        {"estado": "hallado", "severidad": "alta", "titulo": TITULO_WEB, "descripcion": EV_WEB.split(": ", 1)[1],
         "evidencia": [{"url": URL_VADEMECUM, "cita": "Laboratorio: HAMUQ FARMA E.I.R.L."}]}]}
    st["grounding_urls"] = [URL_VADEMECUM]
    out = _banderas_investigacion(st)
    assert out[0]["regla"] == "antecedente_proveedor_web" and out[0]["titulo"] == TITULO_WEB
    assert out[0]["ganador_ruc"] == HAMUQ and out[0]["puntua"] is True
    # Y frente a la regla de RUC nuevo, es el mismo hecho.
    assert mismo_hecho_que(out[0], [out[0], _b("ruc_ganador_muy_nuevo", "alta", EV_RUC_NUEVO, ganador_ruc=HAMUQ)])


# ═════════════════════════════════════════════════════════════════════
# 3 · De qué ganador trata cada bandera de proveedor
# ═════════════════════════════════════════════════════════════════════
def test_ruc_ganador_muy_nuevo_dice_de_que_ganador_trata(monkeypatch):
    """Con 2 ganadores, la bandera es del más nuevo (HAMUQ), no del de mayor monto (AC FARMA)."""
    monkeypatch.setattr(cr._rules_provider, "_pg", lambda: _FakeConn({}))
    fbp = dt.date(2026, 8, 13)
    st = {"_ganadores_eval": {"ocid": "2026-2543-197", "lista": [
              {"ruc": ACFARMA, "nombre": "LABORATORIOS AC FARMA S.A.", "consorcio": None, "monto": 8342000.0,
               "fecha_buena_pro": fbp},
              {"ruc": HAMUQ, "nombre": "HAMUQ FARMA E.I.R.L.", "consorcio": None, "monto": 1474235.95,
               "fecha_buena_pro": fbp}]},
          "sunat_profiles": {ACFARMA: {"fecha_inicio_actividades": "1996-05-02"},
                             HAMUQ: {"fecha_inicio_actividades": "2024-12-06"}}}
    r = cr.check_edad_ruc_ganador_rule("2026-2543-197", _Ctx(st))
    assert r["triggered"] is True and r["ganador_ruc"] == HAMUQ and f"RUC {HAMUQ}" in r["evidencia"]


def test_banderas_de_juicio_y_del_expediente_llevan_al_ganador_investigado():
    st = {"expediente_proveedor": {"ruc": HAMUQ}}
    banderas = [{"regla": "capacidad_operativa_cuestionable", "_source": "orchestrator_paso_7.7"},
                {"regla": "sancion_historica_oece", "_source": "orchestrator_paso_7.7"},
                {"regla": "concentracion_entidad", "ganador_ruc": ACFARMA},
                {"regla": "ruc_ultra_nuevo", "postor_ruc": "20609999999"},
                {"regla": "plazo_convocatoria_minimo"}]
    con_ganador_principal(banderas, st)
    assert [b.get("ganador_ruc") for b in banderas] == [HAMUQ, HAMUQ, ACFARMA, None, None]


def test_el_ruc_del_ganador_se_guarda_con_la_bandera():
    class _C:
        def execute(self, sql, params):
            self.params = params
    c = _C()
    _insert_bandera(c, "id", "ruc_ganador_muy_nuevo", "alta", EV_RUC_NUEVO, "n", "u", "compliance_agent",
                    {"ok": True}, ganador_ruc=HAMUQ)
    assert json.loads(c.params[7]) == {"ok": True, "ganador_ruc": HAMUQ}
    # Persona natural: no se escribe su RUC (lleva el DNI).
    _insert_bandera(c, "id", "ciiu_vs_objeto", "media", "x", "n", "u", "compliance_agent", None, ganador_ruc="10456789012")
    assert json.loads(c.params[7]) == {"ganador_persona_natural": True}


# ═════════════════════════════════════════════════════════════════════
# 4 · procedimiento_no_competitivo: contexto en una directa
# ═════════════════════════════════════════════════════════════════════
def test_contratacion_directa_es_hecho_de_contexto(monkeypatch):
    monkeypatch.setattr(cr._rules_bidder, "_pg",
                        lambda: _FakeConn({"select coalesce(tipo_proceso, modalidad)": ("Contratación Directa",)}))
    st: dict = {"ocds": {"tender": {}}}
    r = cr.check_non_competitive_process_rule("1213369", _Ctx(st))
    assert r["triggered"] is True and r["puntua"] is False and r["severidad"] == "baja"
    assert "hecho de contexto" in r["evidencia"]
    assert st["pending_flags"][0]["puntua"] is False
    assert "hecho de contexto, no suma al puntaje" in _linea("procedimiento_no_competitivo", r)
    # No suma; las señales de la directa sí.
    flag = {**r, "agente_origen": "compliance_agent"}
    assert puntaje_de([flag]) == 0
    assert puntaje_de([flag, {"regla": "directa_sin_fundamento", "severidad": "alta",
                              "agente_origen": "compliance_agent"}]) == 35


def test_proceso_competitivo_no_dispara(monkeypatch):
    monkeypatch.setattr(cr._rules_bidder, "_pg",
                        lambda: _FakeConn({"select coalesce(tipo_proceso, modalidad)": ("Licitación Pública",)}))
    r = cr.check_non_competitive_process_rule("1", _Ctx({"ocds": {"tender": {}}}))
    assert r["triggered"] is False and "puntua" not in r
