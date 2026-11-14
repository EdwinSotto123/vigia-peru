"""Plan 2026-11-04: el expediente del proveedor, las lecturas y los precios desde la base de Vigía, y la privacidad de
los nombres de personas naturales en lo que escribe el agente. Sin red ni base (conexiones falsas)."""
from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

from tools import expediente as E
from tools import lecturas as L
from tools import precios_internos as P
from tools.privacidad import tapar_en_texto, tapar_nombre


# ── Privacidad ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_tapar_nombre_como_la_api():
    assert tapar_nombre("ROJAS QUISPE ELENA") == "ROJAS ••• ELENA"
    assert tapar_nombre("JUAN PEREZ") == "JUAN PEREZ"  # con 2 palabras no se sabe cuál es el apellido
    assert tapar_nombre("TRUJILLO MORENO ELVIRA (SUCESION LUISA MORENO CASTILLO)") == \
        "TRUJILLO ••• ELVIRA (SUCESION LUISA ••• CASTILLO)"


def test_tapar_en_texto_sin_tildes_y_en_los_tres_ordenes():
    n = ["TRUJILLO MORENO RUBEN MARCOS"]
    assert tapar_en_texto("Firmó TRUJILLO MORENO RUBEN MARCOS.", n) == "Firmó TRUJILLO ••• RUBEN MARCOS."
    assert tapar_en_texto("Rubén Marcos Trujillo Moreno, gerente.", n) == "Rubén Marcos Trujillo •••, gerente."
    assert tapar_en_texto("Representante: Rubén Trujillo Moreno.", n) == "Representante: Rubén Trujillo •••."
    assert tapar_en_texto("Morenos y Trujillos", n) == "Morenos y Trujillos"


# ── Expediente ──────────────────────────────────────────────────────────────────────────────────────────────────────
EXP = {
    "ruc": "20109161609", "persona_natural": False,
    "sunat": {"razon_social": "ROKER PERU SA", "estado": "ACTIVO", "condicion": "HABIDO",
              "fecha_inicio_actividades": "1993-01-15", "edad_dias_al_contratar": 12000, "actividad": "FAB. DE PROD. FARMACEUTICOS."},
    "rnp": [{"rol": "REPRESENTANTE_LEGAL", "nombre": "TRUJILLO ••• RUBEN MARCOS", "desde": "2016-06-19"}],
    "sanciones": [], "penalidades": {"n": 3, "monto": 17444.78, "entidades": 2, "desde": "2019-11-25", "hasta": "2026-08-14"},
    "historial": {"procesos": 192, "monto": 74291069.11, "entidades": 59, "en_consorcio": 0, "primera": "2018-06-05",
                  "ultima": "2026-08-24", "con_esta_entidad": {"procesos": 30, "monto": 26730000.0},
                  "principales_entidades": [{"entidad": "SEGURO SOCIAL DE SALUD", "procesos": 30, "monto": 1.0}]},
    "banderas": [{"tipo": "unico_postor", "severidad": "alta", "n": 4}, {"tipo": "unico_postor", "severidad": "media", "n": 4}],
}


def test_ficha_md_trae_las_cifras_de_la_base():
    md = E.ficha_md(EXP)
    assert "ACTIVO, HABIDO" in md and "32 años al contratar" in md
    assert "192 buenas pro por S/ 74.29 millones en 59 entidad(es)" in md
    assert "con esta entidad, 30 por S/ 26.73 millones" in md
    assert "unico postor (4 alta, 4 media)" in md
    assert "TRUJILLO ••• RUBEN MARCOS" in md
    assert "ninguna registrada" in md


def test_insertar_ficha_al_comienzo_de_la_seccion_y_una_sola_vez():
    md = "## Resumen\nx\n\n## Antecedentes del proveedor\nTexto del modelo.\n\n## Personas clave y red empresarial\ny"
    una = E.insertar_ficha(md, EXP)
    assert una.index("Lo que dicen los registros") < una.index("Texto del modelo.") < una.index("Personas clave")
    assert E.insertar_ficha(una, EXP) == una
    sin_seccion = E.insertar_ficha("## Resumen\nx\n", EXP)
    assert sin_seccion.rstrip().endswith("(4 alta, 4 media).")


def test_sanciones_a_la_fecha_de_la_buena_pro():
    bp = dt.date(2026, 5, 1)
    assert E._sancion_oece({"tipo": "definitivo", "fecha_desde": "2020-01-01", "estado": "VIGENTE"}, bp)["vigente"] is True
    # Empezó después de la buena pro: no regía al contratar, aunque hoy esté vigente.
    assert E._sancion_oece({"tipo": "temporal", "fecha_desde": "2026-06-01", "fecha_hasta": "2027-01-01",
                            "estado": "VIGENTE"}, bp)["vigente"] is False
    # Temporal con fecha de fin: deciden las fechas, no el estado de hoy.
    t = E._sancion_oece({"tipo": "temporal", "fecha_desde": "2025-01-01", "fecha_hasta": "2026-12-01",
                         "estado": "NO VIGENTE"}, bp)
    assert "estado" not in t and t["fechaFin"] == "2026-12-01"


def test_query_expediente_deja_los_perfiles_con_las_claves_de_siempre(monkeypatch):
    exp = {**EXP, "_nombres_crudos": ["TRUJILLO MORENO RUBEN MARCOS"], "sanciones": [], "banderas": []}
    monkeypatch.setattr(E, "expediente_proveedor_bd", lambda *a, **k: dict(exp))
    ctx = SimpleNamespace(state={"ocds": {"awards": [{"date": "2026-05-01"}]}})
    r = E.query_expediente_proveedor("20109161609", ctx, entidad_ruc="20131257750", ocid="ocds-x-1")
    st = ctx.state
    assert r["sunat_en_base"] and r["procesos"] == 192
    assert st["sunat_decolecta"]["_source"] == "padron_sunat_vigia" and st["sunat_decolecta"]["estado"] == "ACTIVO"
    assert st["oece_perfiles"]["20109161609"]["n_penalidades"] == 3
    assert "_nombres_crudos" not in st["expediente_proveedor"]
    assert st["_nombres_tapar"] == ["TRUJILLO MORENO RUBEN MARCOS"]
    pen = [s for s in st["oece_perfiles"]["20109161609"]["senales"] if s["regla"] == "penalidades_oece_historicas"]
    assert pen and pen[0]["severidad"] == "media" and "3 penalidad(es)" in pen[0]["evidencia"]


# ── Lecturas ────────────────────────────────────────────────────────────────────────────────────────────────────────
class _Cur:
    def __init__(self, filas):
        self.filas = filas

    def execute(self, *_a):
        pass

    def fetchall(self):
        return self.filas


class _Conn:
    def __init__(self, filas):
        self.filas = filas

    def cursor(self):
        return _Cur(self.filas)


def test_lecturas_confirman_con_dos_y_tapan_a_las_personas():
    acta = {"postores": [{"nombre": "YAÑEZ BARBARAN ADOLFO", "ruc": "10314833193", "ganador": False, "motivo_fuera": "x"},
                         {"nombre": "CHASKA E.I.R.L.", "ruc": "20600000001", "ganador": True}]}
    filas = [("buena_pro", "v2", acta, ["solo_queda_el_ganador", "descalificados_por_formalidad"], dt.datetime(2026, 11, 4)),
             ("buena_pro", "v2-2", acta, ["solo_queda_el_ganador"], dt.datetime(2026, 11, 4)),
             ("bases", "v1", {"marcas": []}, [], dt.datetime(2026, 11, 4))]
    lect, nombres = L.lecturas_bd("ocds-dgv273-seacev3-1232240", conn=_Conn(filas))
    assert lect["acta"]["banderas_confirmadas"] == ["solo_queda_el_ganador"] and lect["acta"]["lecturas"] == 2
    assert lect["bases"]["banderas_confirmadas"] is None
    assert lect["acta"]["salida"]["postores"][0]["nombre"] == "YAÑEZ ••• ADOLFO"
    assert nombres == {"YAÑEZ BARBARAN ADOLFO"}


# ── Precios ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_veredicto_de_precio_contra_los_percentiles():
    assert P._veredicto(13990, 4025, 7363, 8450) == "muy_por_encima"
    assert P._veredicto(9000, 4025, 7363, 8450) == "por_encima"
    assert P._veredicto(7000, 4025, 7363, 8450) == "en_rango"
    assert P._veredicto(3000, 4025, 7363, 8450) == "por_debajo"
    assert P._veredicto(None, 1, 2, 3) == "sin_dato"


def test_fila_de_empresa_vacia_no_cuenta_como_perfil_sunat(monkeypatch):
    exp = {**EXP, "sunat": {"razon_social": "X SAC", "estado": None, "fecha_inicio_actividades": None, "rnp_vigente": True},
           "sanciones": [], "banderas": []}
    monkeypatch.setattr(E, "expediente_proveedor_bd", lambda *a, **k: dict(exp))
    ctx = SimpleNamespace(state={})
    r = E.query_expediente_proveedor("20109161609", ctx)
    assert r["sunat_en_base"] is False and "sunat_decolecta" not in ctx.state


# ── Consultoría: la supervisión contra la obra ───────────────────────────────────────────────────────────────────────
def test_senales_de_supervision():
    from tools.consultoria import senales_obra
    o = {"codigo": 81514, "nombre": "Riego Tsimpa", "contrato_monto": 4_000_000, "supervision_monto": 700_000,
         "fisico_prog": 90, "fisico_real": 40, "financiero_pct": 75, "paralizada": True, "dias_paralizada": 120,
         "causal_paralizacion": "falta de expediente", "adicionales_n": 3, "adicionales_monto": 1_000_000}
    v = {"mismo_ruc": False, "personas_comunes": [{"nombre": "PEREZ ••• JUAN", "rol_en_supervisor": "SOCIO_ACCIONISTA_TITULAR",
                                                   "rol_en_ejecutor": "REPRESENTANTE_LEGAL"}],
         "consorcios_comunes": ["20600000001"], "mismo_domicilio": False}
    reglas = {x["regla"]: x for x in senales_obra(o, v)}
    assert set(reglas) == {"supervisor_vinculado_ejecutor", "supervision_obra_paralizada", "supervision_pagado_sin_avance",
                           "supervision_avance_rezagado", "supervision_adicionales_altos", "supervision_costo_atipico"}
    assert reglas["supervisor_vinculado_ejecutor"]["severidad"] == "alta"
    assert "PEREZ ••• JUAN" in reglas["supervisor_vinculado_ejecutor"]["evidencia"]
    assert "ObraId=81514" in reglas["supervision_obra_paralizada"]["fuente_url"]
    # Una obra sana no dispara nada.
    sana = {"codigo": 1, "nombre": "x", "contrato_monto": 1_000_000, "supervision_monto": 50_000, "fisico_prog": 50,
            "fisico_real": 48, "financiero_pct": 50, "paralizada": False, "adicionales_monto": 0}
    assert senales_obra(sana, {"mismo_ruc": False, "personas_comunes": [], "consorcios_comunes": [], "mismo_domicilio": False}) == []


def test_apellido_compuesto_cuenta_como_uno():
    assert tapar_nombre("DE LA CRUZ UNSIHUAY HECTOR ANGEL") == "DE LA CRUZ ••• HECTOR ANGEL"
    assert tapar_nombre("QUISPE DEL CASTILLO ANA") == "QUISPE ••• ANA"
    n = ["DE LA CRUZ UNSIHUAY HECTOR ANGEL"]
    assert tapar_en_texto("Héctor De La Cruz Unsihuay firmó.", n) == "Héctor De La Cruz ••• firmó."


def test_consorcio_junta_a_sus_integrantes(monkeypatch):
    miembros = [{"ruc": "20568595948", "consorcio": "CONSORCIO MATIBAMBA", "nombre": "CONSTRUCTORA AH & D S.A.C."},
                {"ruc": "10123456789", "consorcio": "CONSORCIO MATIBAMBA", "nombre": "PEREZ QUISPE JUAN"}]
    monkeypatch.setattr(E, "integrantes_consorcio", lambda codigo, conn=None: miembros)
    sanc = {"tipo": "temporal", "fecha_desde": "2025-01-01", "fecha_hasta": "2027-01-01", "estado": "VIGENTE"}
    monkeypatch.setattr(E, "expediente_proveedor_bd", lambda ruc, *a, **k: {
        **EXP, "ruc": ruc, "sanciones": [sanc] if ruc.startswith("10") else [], "banderas": [],
        "_nombres_crudos": ["PEREZ QUISPE JUAN"] if ruc.startswith("10") else []})
    ctx = SimpleNamespace(state={"ocds": {"awards": [{"date": "2026-05-01"}]}})
    r = E.query_expediente_proveedor("1816604", ctx)
    exp = ctx.state["expediente_proveedor"]
    assert r["consorcio"] and r["integrantes"] == 2 and exp["nombre"] == "CONSORCIO MATIBAMBA"
    assert exp["integrantes"][1]["nombre"] == "PEREZ ••• JUAN"
    assert any("Integrante PEREZ ••• JUAN" in s["evidencia"] for s in r["senales"])
    assert "PEREZ QUISPE JUAN" in ctx.state["_nombres_tapar"]
    md = E.ficha_md(exp)
    assert "del CONSORCIO MATIBAMBA, con 2 integrante(s)" in md and "**PEREZ ••• JUAN**" in md and "10123456789" not in md



class _CurFilas:
    """Cursor falso que contesta cada consulta del expediente con filas fijas (por la tabla que nombra)."""
    def __init__(self, por_tabla):
        self.por_tabla, self.description, self._f = por_tabla, [], []

    def execute(self, sql, params=None):
        tabla = next((t for t in self.por_tabla if t in sql), None)
        cols, filas = self.por_tabla.get(tabla, ([], []))
        self.description = [(c,) for c in cols]
        self._f = filas

    def fetchall(self):
        return self._f


class _ConnFilas:
    def __init__(self, por_tabla):
        self.cur = _CurFilas(por_tabla)

    def cursor(self):
        return self.cur


def test_fecha_de_alta_posterior_a_la_primera_buena_pro_no_hace_nueva_a_la_empresa():
    por_tabla = {
        "empresa_resumen": (["razon_social", "estado_sunat", "fecha_alta", "actividad", "departamento", "socios",
                             "representantes", "directivos", "inhabilitada", "inhabilitada_hasta"],
                            [("THOR CONTRATISTAS S.A.C", "ACTIVO", dt.date(2025, 7, 1), "CONSTRUCCION", "PUNO", 1, 1, 0, None, None)]),
        "rnp_conformacion_juridica": (["tipo_rol", "nombre", "fecha_inicio_vigencia", "forma_societaria"],
                                      [("REPRESENTANTE_LEGAL", "QUISPE MAMANI JUAN", dt.date(2017, 4, 2), "SAC")]),
        "conosce_adjudicaciones": (["codigo_convocatoria", "entidad", "entidad_ruc", "objeto", "descripcion", "monto",
                                    "fecha_buena_pro", "en_consorcio"],
                                   [("X-1", "GR PUNO", "20000000001", "Obra", "obra", 100.0, dt.date(2018, 10, 31), False)]),
        "penalidades": (["n", "monto", "entidades", "desde", "hasta"], [(0, None, 0, None, None)]),
    }
    exp = E.expediente_proveedor_bd("20493191269", None, None, dt.date(2026, 5, 1), conn=_ConnFilas(por_tabla))
    s = exp["sunat"]
    assert s["fecha_inicio_efectiva"] == "2017-04-02"
    assert s["edad_dias_al_contratar"] > 3000 and "posterior a su RNP" in s["fecha_inicio_dudosa"]
    assert "**Antigüedad:**" in E.ficha_md(exp)


def test_las_senales_de_la_persona_con_esta_entidad_son_una_bandera_sin_nombres():
    """Persona natural: lo que Vigía ya calculó (declaraciones juradas, planilla, visitas) va al contrato."""
    from tools.expediente import ficha_md, senales_de_persona
    exp = {"ruc": "10439608801", "persona_natural": True, "rnp": [], "sanciones": [], "penalidades": {}, "historial": {},
           "persona": {"ordenes": 14, "monto": 52000.0, "entidades": 2, "primera": "2019-05-02", "ultima": "2026-03-10",
                       "con_esta_entidad": {"ordenes": 9, "meses": 9, "monto": 31500.0, "primera": "2025-01-10", "ultima": "2026-03-10"},
                       "senales": [
                           {"tipo": "tambien_planilla", "severidad": "alta", "con_esta_entidad": True, "entidades": 1,
                            "que": "figura en la planilla de la entidad mientras cobra por órdenes de servicio"},
                           {"tipo": "candidato", "severidad": "baja", "con_esta_entidad": True, "entidades": 1, "que": "fue candidato en una elección"},
                           {"tipo": "nepotismo", "severidad": "alta", "con_esta_entidad": False, "entidades": 1,
                            "que": "tiene un pariente declarado entre los funcionarios de la entidad"}]}}
    s = senales_de_persona("10439608801", exp)
    assert len(s) == 1 and s[0]["regla"] == "persona_contratada_senales" and s[0]["severidad"] == "alta"
    assert "planilla" in s[0]["evidencia"] and "pariente" not in s[0]["evidencia"] and "candidato" not in s[0]["evidencia"]
    assert "10439608801" not in s[0]["evidencia"] and "43960880" not in s[0]["evidencia"]
    md = ficha_md(exp)
    assert "persona natural" in md and "14 por" in md and "Señales con esta entidad" in md and "no disponible" not in md
    assert senales_de_persona("10439608801", {"persona": {"senales": exp["persona"]["senales"][1:]}}) == []

