"""Las redes de obras y de consultoría (tools/obras.py, tools/consultoria.py, market/presupuesto_obra.py): el cruce con
INFOBRAS e Invierte.pe en un proceso de 2026, con un consorcio como ganador y con una persona natural. Sin red ni base
(cursor falso que contesta cada consulta por la tabla que nombra y guarda con qué parámetros se la pidieron)."""
from __future__ import annotations

import json
from types import SimpleNamespace

from tools import consultoria as C
from tools import obras as O
from tools.market import presupuesto_obra as PO

OCID_2026 = "ocds-dgv273-seacev3-2026-10404-12"
CONSORCIO_SEACE = "1808784"                      # el código del consorcio en el SEACE: no es un RUC
INTEGRANTES = ["20111111111", "20222222222"]
SUPERVISOR = "20333333333"
SIN_VINCULO = {"mismo_ruc": False, "personas_comunes": [], "consorcios_comunes": [], "mismo_domicilio": False}
HISTORIAL = (["obras", "paralizadas", "con_adicionales_altos", "pagadas_sin_avance", "con_controversias", "monto"],
             [(7, 2, 1, 0, 1, 9_000_000.0)])
HISTORIAL_SUP = (["obras", "paralizadas", "con_adicionales_altos", "pagadas_sin_avance", "monto_supervision"],
                 [(4, 1, 0, 0, 800_000.0)])


class _Cur:
    def __init__(self, rutas):
        self.rutas, self.llamadas, self.description, self._f = rutas, [], [], []

    def execute(self, sql, params=None):
        self.llamadas.append((sql, params))
        self.description, self._f = [], []
        for clave, cols, filas in self.rutas:
            if clave in sql:
                self.description = [(c,) for c in cols]
                self._f = filas(params) if callable(filas) else filas
                return

    def fetchall(self):
        return self._f

    def params_de(self, clave):
        return [p for sql, p in self.llamadas if clave in sql]


class _Conn:
    def __init__(self, rutas):
        self.cur = _Cur(rutas)

    def cursor(self):
        return self.cur

    def close(self):
        pass


def _obra(**cambios):
    o = {"codigo": 81514, "cui": "2655159", "nombre": "Riego Tsimpa", "estado": "En Ejecución", "entidad_nombre": "GR JUNIN",
         "ejecutor_ruc": "C0000012345", "ejecutor_nombre": "CONSORCIO TSIMPA", "contrato_monto": 4_000_000.0,
         "supervisor_ruc": SUPERVISOR, "supervisor_nombre": "SUPERVISORES DEL CENTRO S.A.C.", "supervision_monto": 200_000.0,
         "fisico_prog": 50.0, "fisico_real": 48.0, "financiero_pct": 50.0, "paralizada": False, "causal_paralizacion": None,
         "dias_paralizada": None, "dias_ampliacion": 0, "controversias": 0, "adicionales_n": 0, "adicionales_monto": 0.0,
         "informes_control": 0, "ruc_contrato": CONSORCIO_SEACE}
    o.update(cambios)
    return (list(o), [tuple(o.values())])


def _rutas(obra=None, extra=()):
    """Las consultas de obra_bd / supervision_bd, de la más específica a la más general."""
    cols, filas = obra if obra else ([], [])
    return [*extra,
            ("obra_contrato oc JOIN obra_infobras", cols, filas),
            ("SELECT DISTINCT ruc_miembro FROM conosce_consorcios", ["ruc_miembro"],
             lambda p: [(m,) for m in INTEGRANTES] if CONSORCIO_SEACE in p[0] else []),
            ("FROM obra_infobras WHERE ejecutor_ruc", *HISTORIAL),
            ("FROM obra_infobras WHERE supervisor_ruc", *HISTORIAL_SUP)]


# ── El proceso de 2026 se busca por su código completo ──────────────────────────────────────────────────────────────
def test_ocid_de_2026_se_busca_por_su_codigo_completo_y_no_por_su_ultimo_tramo():
    conn = _Conn(_rutas())
    O.obra_bd(OCID_2026, "20100000001", conn=conn)
    assert conn.cur.params_de("obra_contrato oc JOIN obra_infobras") == [("2026-10404-12",)]
    assert conn.cur.params_de("cruces_proveedor") == [("2026-10404-12",)]
    assert conn.cur.params_de("FROM contrato_cui k") == [("2026-10404-12",)]
    conn = _Conn(_rutas())
    C.supervision_bd(OCID_2026, "20100000001", conn=conn)
    assert conn.cur.params_de("obra_contrato oc JOIN obra_infobras") == [("2026-10404-12",)]
    # El esquema anterior sigue igual.
    conn = _Conn(_rutas())
    O.obra_bd("ocds-dgv273-seacev3-1212353", None, conn=conn)
    assert conn.cur.params_de("obra_contrato oc JOIN obra_infobras") == [("1212353",)]


# ── Un consorcio: el vínculo y el historial por sus integrantes ─────────────────────────────────────────────────────
def test_obra_de_un_consorcio_cruza_al_supervisor_con_sus_integrantes():
    # INFOBRAS publica al consorcio con «C000…» (no abre en nadie); el ganador del proceso es su código del SEACE.
    def personas(p):
        sup, eje = p
        return [("PEREZ QUISPE JUAN", "SOCIO", "REPRESENTANTE_LEGAL")] if SUPERVISOR in sup and INTEGRANTES[1] in eje else []

    conn = _Conn(_rutas(_obra(), extra=[("rnp_conformacion_juridica", ["nombre", "rol_a", "rol_b"], personas)]))
    ob = O.obra_bd(OCID_2026, CONSORCIO_SEACE, conn=conn)
    assert [s["regla"] for s in ob["senales"]] == ["supervisor_vinculado_ejecutor"]
    assert "PEREZ ••• JUAN" in ob["senales"][0]["evidencia"] and "QUISPE" not in ob["senales"][0]["evidencia"]
    assert ob["obras"][0]["vinculo_supervisor"]["personas_comunes"][0]["nombre"] == "PEREZ ••• JUAN"


def test_supervision_cruza_al_consorcio_que_ejecuta_por_su_proceso_de_obras():
    # El supervisor ganador es una de las empresas del consorcio que ejecuta la obra: sólo se ve si el ejecutor se abre
    # por el proceso de obras de esa misma obra (obra_contrato, rol ejecución), no por el «C000…» de INFOBRAS.
    obra = _obra(supervisor_ruc=INTEGRANTES[1], ruc_contrato=INTEGRANTES[1])
    conn = _Conn(_rutas(obra, extra=[("FROM obra_contrato WHERE codigo", ["ruc"], lambda p: [(CONSORCIO_SEACE,)] if p == (81514, "ejecucion") else [])]))
    sup = C.supervision_bd(OCID_2026, INTEGRANTES[1], conn=conn)
    assert sup["obras"][0]["vinculo"]["mismo_ruc"] is True
    assert "supervisor_vinculado_ejecutor" in [s["regla"] for s in sup["senales"]]


def test_historial_de_un_consorcio_es_el_de_sus_integrantes():
    conn = _Conn(_rutas())
    ob = O.obra_bd(OCID_2026, CONSORCIO_SEACE, conn=conn)
    assert conn.cur.params_de("FROM obra_infobras WHERE ejecutor_ruc") == [(INTEGRANTES,)]
    h = ob["historial_contratista"]
    assert h["obras"] == 7 and h["integrantes"] == 2 and "2 integrantes del consorcio" in h["fuente"]
    conn = _Conn(_rutas())
    sup = C.supervision_bd(OCID_2026, CONSORCIO_SEACE, conn=conn)
    assert conn.cur.params_de("FROM obra_infobras WHERE supervisor_ruc") == [(INTEGRANTES,)]
    assert sup["historial_supervisor"]["obras"] == 4 and sup["historial_supervisor"]["integrantes"] == 2


def test_consorcio_sin_integrantes_conocidos_no_dice_cero_obras():
    conn = _Conn(_rutas())
    ob = O.obra_bd(OCID_2026, "1999999", conn=conn)   # un consorcio que CONOSCE todavía no publica
    assert conn.cur.params_de("FROM obra_infobras WHERE ejecutor_ruc") == []
    assert ob["historial_contratista"]["estado"] == "sin_dato" and "obras" not in ob["historial_contratista"]
    assert "historial_contratista" not in O.obra_bd(OCID_2026, None, conn=_Conn(_rutas()))
    # Una empresa con RUC: como siempre, por su RUC.
    conn = _Conn(_rutas())
    assert O.obra_bd(OCID_2026, "20100000001", conn=conn)["historial_contratista"]["fuente"].endswith("todas las obras que ejecutó")
    assert conn.cur.params_de("FROM obra_infobras WHERE ejecutor_ruc") == [(["20100000001"],)]


# ── Invierte.pe por el CUI del proceso, sin esperar a INFOBRAS ──────────────────────────────────────────────────────
def test_la_inversion_llega_por_el_cui_del_proceso_aunque_no_haya_obra_en_infobras():
    cols = ["cui", "nombre", "estado", "situacion", "monto_viable", "costo_actualizado", "monto_laudo", "devengado_acumulado",
            "avance_fisico", "expediente_tecnico", "fecha_viabilidad", "origen_cui"]
    filas = [("2655159", "Mejoramiento del riego Tsimpa", "ACTIVO", "VIABLE", 2_000_000.0, 5_000_000.0, None, 0.0, 0.0, True, None, "ocds"),
             ("2233862", "Dato imposible", "ACTIVO", "VIABLE", 100.0, 900_000_000.0, None, 0.0, 0.0, True, None, "texto")]
    ob = O.obra_bd(OCID_2026, "20100000001", conn=_Conn(_rutas(extra=[("FROM contrato_cui k", cols, filas)])))
    assert ob["enlazada"] is False and ob["obras"] == []
    inv = ob["inversiones"]
    assert inv[0]["sobrecosto_pct"] == 150.0 and inv[0]["fuente_url"].endswith("codigo=2655159&tipo=2")
    assert inv[1]["sobrecosto_pct"] is None   # 9 millones de veces el viable: no se calcula


# ── Privacidad: una persona natural no deja su RUC (lleva el DNI) ───────────────────────────────────────────────────
def test_ejecutor_persona_natural_sale_con_un_apellido_tapado_y_sin_ruc(monkeypatch):
    obra = _obra(ejecutor_ruc="10444256279", ejecutor_nombre="ROJAS QUISPE ELENA", ruc_contrato="10444256279")
    monkeypatch.setattr(O, "_pg", lambda: _Conn(_rutas(obra)))
    ctx = SimpleNamespace(state={})
    r = O.query_obra_ejecucion(OCID_2026, ctx, ruc=None)
    bloque = ctx.state["obra_ejecucion"]
    o = bloque["obras"][0]
    assert o["ejecutor_nombre"] == "ROJAS ••• ELENA" and o["ejecutor_ruc"] is None and o["ejecutor_persona_natural"] is True
    assert "10444256279" not in json.dumps(bloque, ensure_ascii=False, default=str) and "44425627" not in json.dumps(bloque, default=str)
    # El orquestador sí lo recibe: lo necesita para pedir el expediente cuando el OCDS no trae ganador.
    assert r["ruc_contrato"] == "10444256279"
    monkeypatch.setattr(C, "_pg", lambda: _Conn(_rutas(_obra(supervisor_ruc="10444256279", supervisor_nombre="ROJAS QUISPE ELENA",
                                                             ruc_contrato="10444256279"))))
    ctx = SimpleNamespace(state={})
    r = C.query_supervision_obra(OCID_2026, ctx, ruc=None)
    assert "10444256279" not in json.dumps(ctx.state["supervision_obra"], ensure_ascii=False, default=str)
    assert ctx.state["supervision_obra"]["obras"][0]["supervisor_nombre"] == "ROJAS ••• ELENA" and r["ruc_contrato"] == "10444256279"


# ── Señales de la supervisión: lo que el texto afirma tiene que ser cierto ──────────────────────────────────────────
def _reglas(**cambios):
    o = {"codigo": 1, "nombre": "x", "contrato_monto": 1_000_000, "supervision_monto": 50_000, "fisico_prog": 50, "fisico_real": 48,
         "financiero_pct": 50, "paralizada": False, "adicionales_monto": 0, **cambios}
    return {s["regla"]: s for s in C.senales_obra(o, SIN_VINCULO)}


def test_obra_terminada_con_mas_del_100_pagado_no_es_pago_sin_avance():
    assert "supervision_pagado_sin_avance" not in _reglas(fisico_prog=100, fisico_real=100, financiero_pct=125)
    assert "supervision_pagado_sin_avance" in _reglas(fisico_prog=45, fisico_real=40, financiero_pct=75)   # sigue disparando


def test_dato_imposible_de_infobras_no_dispara_senales():
    assert _reglas(fisico_real=0, fisico_prog=0, financiero_pct=1700) == {}
    assert _reglas(fisico_real=1700, fisico_prog=20, financiero_pct=50) == {}
    assert _reglas(adicionales_monto=300_000_000, adicionales_n=1) == {}
    assert "supervision_adicionales_altos" in _reglas(adicionales_monto=200_000, adicionales_n=2)


def test_paralizacion_pasada_no_dice_que_la_obra_figura_paralizada():
    pasada = _reglas(paralizada=True, dias_paralizada=30, estado="Finalizado")["supervision_obra_paralizada"]
    assert "registra una paralización" in pasada["evidencia"] and "hoy figura «Finalizado»" in pasada["evidencia"]
    assert "figura paralizada" not in pasada["evidencia"] and pasada["severidad"] == "media"
    hoy = _reglas(paralizada=True, dias_paralizada=120, estado="Paralizada")["supervision_obra_paralizada"]
    assert "figura paralizada en INFOBRAS (120 días)" in hoy["evidencia"]


# ── «INFOBRAS no disponible» deja de estar pendiente cuando el avance sí se cruzó ───────────────────────────────────
def test_avance_cruzado_quita_la_validacion_pendiente(monkeypatch):
    monkeypatch.setattr(O, "_pg", lambda: _Conn(_rutas(_obra())))
    mercado = {"validaciones_pendientes": ["infobras_avance"],
               "observaciones_clave": ["Obras similares en BD SEACE: 0 en 24 meses.",
                                       "Avance físico/financiero (INFOBRAS): pendiente hasta cruzar el contrato con su obra."]}
    ctx = SimpleNamespace(state={"validaciones_pendientes": ["infobras_avance", "proveedor_sin_ruc"], "market_analysis": mercado})
    O.query_obra_ejecucion(OCID_2026, ctx, ruc=CONSORCIO_SEACE)
    assert ctx.state["validaciones_pendientes"] == ["proveedor_sin_ruc"]
    assert ctx.state["market_analysis"]["validaciones_pendientes"] == []
    assert not any("pendiente" in x for x in ctx.state["market_analysis"]["observaciones_clave"])
    # Sin obra enlazada sigue pendiente.
    monkeypatch.setattr(O, "_pg", lambda: _Conn(_rutas()))
    ctx = SimpleNamespace(state={"validaciones_pendientes": ["infobras_avance"]})
    O.query_obra_ejecucion(OCID_2026, ctx, ruc=CONSORCIO_SEACE)
    assert ctx.state["validaciones_pendientes"] == ["infobras_avance"]


# ── Mercado de obras: los adicionales de una adenda cuentan aunque no se haya leído el expediente técnico ───────────
def _estado_mercado(obra):
    return {"ocds": {"ocid": OCID_2026, "tender": {"description": "EJECUCION DE LA OBRA RIEGO TSIMPA"},
                     "awards": [{"value": {"amount": 1_000_000}}]},
            "parser_raw_consolidated": {"obra": obra}}


def test_adicionales_sin_expediente_tecnico(monkeypatch):
    monkeypatch.setattr(PO, "_comparables_convocatorias", lambda *a, **k: [])
    st = _estado_mercado({"adicionales": [{"n": 1, "monto": 120_000}, {"n": 2, "monto": 80_000}], "ampliaciones_plazo": [{"n": 1, "dias": 30}]})
    r = PO._mercado_presupuesto_obra(st)
    p = r["presupuesto"]
    assert p["adicionales"] == {"n": 2, "monto_acumulado": 200_000.0, "pct_acumulado": 20.0, "n_ampliaciones_plazo": 1}
    assert p["estado"] == "hallado" and r["estado"] == "hallado" and "presupuesto_total" not in p
    assert any("no trae expediente técnico" in x for x in r["observaciones_clave"])
    # Sin bloque: lo dice con su motivo, y no inventa adicionales.
    r = PO._mercado_presupuesto_obra(_estado_mercado({}))
    assert r["presupuesto"] == {"estado": "sin_dato", "motivo": "sin_bloque_obra_del_parser"} and r["estado"] == "sin_dato"
    # Con expediente técnico, como siempre: contra el presupuesto.
    st = _estado_mercado({"expediente_tecnico": {"presupuesto_total": 2_000_000, "partidas": [{"descripcion": "a", "parcial": 2_000_000}]},
                          "adicionales": [{"monto": 200_000}]})
    p = PO._mercado_presupuesto_obra(st)["presupuesto"]
    assert p["adicionales"]["pct_acumulado"] == 10.0 and p["diff_suma_vs_total_pct"] == 0.0


def test_mercado_de_obras_no_deja_pendiente_infobras_si_el_avance_ya_esta(monkeypatch):
    monkeypatch.setattr(PO, "_comparables_convocatorias", lambda *a, **k: [])
    st = _estado_mercado({})
    assert PO._mercado_presupuesto_obra(st)["validaciones_pendientes"] == ["infobras_avance"]
    assert st["validaciones_pendientes"] == ["infobras_avance"]
    st = {**_estado_mercado({}), "obra_ejecucion": {"enlazada": True, "obras": [{"fisico_real": 40.0}]}}
    r = PO._mercado_presupuesto_obra(st)
    assert r["validaciones_pendientes"] == [] and st["validaciones_pendientes"] == []
    assert not any("INFOBRAS" in x for x in r["observaciones_clave"])


# ── Vectores legales de obras: los campos que nombra existen y la experiencia se mide contra el valor estimado ─────
def test_vector_legal_de_obras_nombra_campos_del_bloque_y_el_valor_estimado():
    from agents.document_legal_analyst.prompt import VECTORES
    from tools.cotejos_legales import cotejos_legales
    from tools.documentos.schema import _schema_bloque
    v = VECTORES["obras"]
    campos = set(_schema_bloque("obra").properties)
    for nombre in ("residente_requisitos", "supervisor_requisitos", "garantia_fiel_cumplimiento", "adelantos", "adicionales",
                   "ampliaciones_plazo", "valorizaciones", "expediente_tecnico"):
        assert nombre in campos and nombre in v
    assert "cotejos_legales.valor_estimado_total" in v and "valor_estimado_total" in cotejos_legales({})
    assert "NUNCA la midas contra el monto adjudicado" in v
