"""Correcciones de las reglas por la prueba de oro de las 4 redes (2026-11-04): postores del acta leída, IGV exonerado,
honorario fijo, ampliación/penalidad sólo en ejecución, contrato antes de la convocatoria, giro por palabra completa,
cuota mensual y lecturas para el analista legal. Sin base de datos."""
from __future__ import annotations

from tools.compliance_rules._base import (honorario_fijo, n_participantes_parser, postores_acta, ratio_vs_referencial,
                                          _postores_parser)
from tools.compliance_rules._rules_lote1 import (check_ampliacion_denegada_penalidad_rule,
                                                 check_fecha_buena_pro_incoherente_rule,
                                                 check_oferta_igual_valor_referencial_rule,
                                                 check_oferta_mas_barata_no_gana_rule, check_unica_oferta_valida_rule)
from tools.compliance_rules._rules_provider import _categoria_ciiu, _categoria_objeto, _categorias_compatibles
from tools.lecturas import lecturas_para_legal


class _Ctx:
    def __init__(self, state):
        self.state = state


def _acta(*postores, vr=None):
    return {"lecturas_documentos": {"acta": {"salida": {"es_buena_pro": True, "valor_referencial": vr,
                                                         "postores": list(postores)}}}}


def _p(nombre, ganador=False, admitida=True, calificada=True, monto=None, motivo=None, ruc=None):
    return {"nombre": nombre, "ruc": ruc, "ganador": ganador, "admitida": admitida, "calificada": calificada,
            "monto_ofertado": monto, "motivo_fuera": motivo, "motivo_tipo": "tecnico" if motivo else None,
            "integrantes_ruc": [], "es_consorcio": False, "puntaje": None}


def _ocds(vr, metodo="Concurso Público Abreviado", n=None, contratos=None, fecha="2026-06-24T00:00:00-05:00"):
    t = {"value": {"amount": vr}, "procurementMethodDetails": metodo, "datePublished": fecha,
         "tenderPeriod": {"startDate": fecha}}
    if n is not None:
        t["numberOfTenderers"] = n
    return {"tender": t, "awards": [{"value": {"amount": vr}, "date": "2026-07-01"}], "contracts": contratos or []}


def test_postores_del_acta_mandan_sobre_el_parser():
    st = _acta(_p("A", ganador=True, monto=100), _p("B", monto=90, motivo="oferta económica rechazada"))
    st["parser_raw_consolidated"] = {"postores": [{"razon_social": "X", "monto": 30000, "es_ganador": True}]}
    pp = _postores_parser(st)
    assert [p["razon_social"] for p in pp] == ["A", "B"]
    # Calificada pero con motivo de rechazo: queda fuera (1228202, 1230915).
    assert pp[1]["estado"] == "descalificado"
    assert n_participantes_parser({**st, "ocds": _ocds(100, n=8)}) == (8, 2)


def test_sin_acta_vuelve_al_parser():
    st = {"parser_raw_consolidated": {"postores": [{"razon_social": "X", "monto": 10, "es_ganador": True}]}}
    assert postores_acta(st) is None
    assert _postores_parser(st)[0]["razon_social"] == "X"


def test_igv_exonerado_compara_en_la_misma_base():
    r, sin = ratio_vs_referencial(67796.61, 80000)
    assert sin and abs(r - 1) < 0.001
    r, sin = ratio_vs_referencial(70000, 80000)
    assert not sin and abs(r - 0.875) < 1e-9


def test_oferta_igual_al_referencial_sin_igv_dispara():
    st = {**_acta(_p("CONSORCIO", ganador=True, monto=67796.61)), "ocds": _ocds(80000)}
    res = check_oferta_igual_valor_referencial_rule("1", _Ctx(st))
    assert res["triggered"] and "sin IGV" in res["evidencia"]


def test_honorario_fijo_no_es_oferta_igual_ni_postor_unico():
    st = {**_acta(_p("A", ganador=True, monto=45000), _p("B"), _p("C")),
          "ocds": _ocds(45000, metodo="Régimen Especial", n=1)}
    assert honorario_fijo(st)
    assert not check_oferta_igual_valor_referencial_rule("1", _Ctx(st))["triggered"]
    # En una licitación común la misma forma sí cuenta (el monto lo ofertó el postor).
    st["ocds"] = _ocds(45000, metodo="Licitación Pública Abreviada", n=1)
    assert not honorario_fijo(st)


def test_unica_oferta_valida_con_rechazo_economico():
    st = {**_acta(_p("A", ganador=True, monto=58149), _p("B", monto=46810, motivo="dos versiones del Anexo 6")),
          "ocds": _ocds(58152.24)}
    res = check_unica_oferta_valida_rule("1", _Ctx(st))
    assert res["triggered"] and res["severidad"] == "alta"


def test_mas_barata_no_compara_items_distintos():
    st = {**_acta(_p("A", ganador=True, monto=1086480), _p("B", ganador=True, monto=511500)), "ocds": _ocds(2109480)}
    res = check_oferta_mas_barata_no_gana_rule("1", _Ctx(st))
    assert not res["triggered"] and res["estado"] == "no_aplica"


def test_penalidad_de_las_bases_no_es_incidencia():
    st = {"parser_raw_consolidated": {"resumenes": [
        {"documento": "Bases Administrativas", "resumen": "Se aplicará penalidad por mora y resolución del contrato."},
        {"documento": "Archivos del contrato", "resumen": "Cláusula de penalidad por mora en la ejecución."}]}}
    assert not check_ampliacion_denegada_penalidad_rule("1", _Ctx(st))["triggered"]
    st = {"parser_raw_consolidated": {"resumenes": [
        {"documento": "Resolución Gerencial 12-2026", "resumen": "Se aplicó penalidad por mora de S/ 4 000 al contratista."}]}}
    assert check_ampliacion_denegada_penalidad_rule("1", _Ctx(st))["triggered"]


def test_contrato_firmado_antes_de_la_convocatoria():
    st = {"ocds": _ocds(45000, contratos=[{"dateSigned": "2026-06-19T00:00:00-05:00",
                                           "period": {"startDate": "2026-06-22T00:00:00-05:00"}}])}
    res = check_fecha_buena_pro_incoherente_rule("1", _Ctx(st))
    assert res["triggered"] and "19/06/2026" in res["evidencia"]


def test_giro_por_palabra_completa():
    assert _categoria_objeto("elaboracion de expediente tecnico") is None      # «racion» no está en «elaboración»
    assert _categoria_objeto("productos maderables") is None                     # «madera» no es «maderables»
    assert _categoria_objeto("raciones de alimentos") == "alimentos"
    assert _categoria_ciiu("activ.de arquitectura e ingenieria") == "servicios"
    assert _categorias_compatibles("construccion", "servicios")


def test_lecturas_para_legal_compacta():
    lect = {"bases": {"salida": {"es_bases": True, "factores_evaluacion": [{"factor": "I. Gestión de calidad", "puntaje": 85}],
                                 "personal_clave": [], "marcas": []}, "banderas": []},
            "consultas": {"salida": {"es_pliego": True, "n_consultas": 71, "observaciones": [
                {"tema": "requisito_calificacion", "respuesta": "no_acogida", "resumen": "Admitir ingeniero electricista"},
                {"tema": "otro", "respuesta": "acogida", "resumen": "Precisar plazo"}], "denuncias": []},
                          "banderas": ["observaciones_a_requisitos_rechazadas"], "banderas_confirmadas": []}}
    out = lecturas_para_legal(lect)
    assert out["bases"]["factores_evaluacion"][0]["puntaje"] == 85
    assert out["consultas"]["no_acogidas"] == [{"tema": "requisito_calificacion", "resumen": "Admitir ingeniero electricista"}]
    assert out["consultas"]["n_acogidas"] == 1
    assert out["consultas"]["banderas_del_lector"] == []   # sólo las confirmadas por la segunda lectura
