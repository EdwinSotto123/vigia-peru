"""Revisión lote 1 (docs/design/revision_contratos/*.md) — Workstream R2.

Cada test reproduce un caso REAL de los informes en el que una salida de agente se perdió
por formato (T4), el dictamen publicó identificadores inventados o DNI (T9), el contexto del
writer entregaba prosa degradada como hecho, o el juez de precio detectó un error y nadie
actuó. Fixtures sintéticas mínimas; sin BD ni Gemini.
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

from agents._shared import schemas as S  # noqa: E402
from tools import verify  # noqa: E402
from tools import state_loaders  # noqa: E402
from tools import self_eval  # noqa: E402
import deterministic as D  # noqa: E402

SHA = "b" * 64
EV_DOC = {"documento": SHA, "pagina": 31, "cita": "Capacidad legal: autorización MINEM, licencia de cantera, CIRA, DIA"}


# ═══════════════════════════════════════════════════════════════════════════
# T4 · schemas tolerantes
# ═══════════════════════════════════════════════════════════════════════════

def test_legal_severidad_en_mayusculas_no_pierde_la_bandera():
    """1225030/1225062/1225090/1225379/1225392/1225450: el legal escribía `severidad: "ALTA"`
    (como lo dictaba su prompt) y el validador descartaba las 2-3 banderas → 0 banderas
    legales, `estado: no_verificable`, "Sin red_flags del legal_analyst"."""
    lo = S.LegalOutput.model_validate({
        "estado": "hallado",
        "red_flags_documentales": [
            {"estado": "hallado", "vector": "certificacion_atipica", "severidad": "ALTA",
             "descripcion": "5 títulos habilitantes de cantera como capacidad legal para comprar piedra",
             "norma_citada": "Art. 2 Ley 32069 — libertad de concurrencia", "evidencia": [EV_DOC]},
            {"estado": "hallado", "vector": "experiencia_desproporcionada", "severidad": "MEDIA",
             "descripcion": "60 % del puntaje en certificados ISO 14001/37001",
             "norma_citada": "Art. 2 Ley 32069", "evidencia": [EV_DOC]},
            {"estado": "hallado", "vector": "specs_convergentes", "severidad": "Media-Alta",
             "descripcion": "specs de la geomalla = hoja técnica TriAx TX160",
             "norma_citada": "Art. 2 Ley 32069", "evidencia": [EV_DOC]},
        ],
    })
    assert lo.estado == "hallado"
    assert [(r.vector, r.severidad) for r in lo.red_flags_documentales] == [
        ("certificacion_atipica", "alta"), ("experiencia_desproporcionada", "media"), ("specs_convergentes", "alta")]
    # Nada se perdió: no hay descartes relevantes, solo normalizaciones anotadas.
    assert lo.descartes_relevantes() == []
    assert any("Media-Alta" in d for d in lo.descartes_schema)


def test_person_network_evidencia_string_y_tipo_vinculo_fuera_de_enum():
    """1225416: `banderas_red[0]` (socios Flórez García en dos postores rivales, evidencia como
    string) y `lazos_entre_postores[0]` (`tipo_vinculo` fuera del enum) descartados → la única
    señal real del expediente llegó solo como frase suelta. 1225379: `banderas_red[0]` con
    evidencia string (OEC bajo investigación fiscal)."""
    pn = S.PersonNetworkOutput.model_validate({
        "estado": "exito",
        "lazos_entre_postores": [{
            "estado": "hallado",
            "postor_a": {"ruc": "20609491550", "razon_social": "INVERSIONES PUQUIN S.A.C."},
            "postor_b": "GRIFO LATINO S.A.C. (RUC 20527055840)",
            "tipo_vinculo": "vinculo_familiar_por_apellidos", "severidad": "ALTA", "confianza": "media",
            "descripcion": "socios Flórez García Yola Cirila y Flórez García Percy Zacarías",
            "evidencia": "person_network_context.socios_postores_rivales: FLOREZ GARCIA YOLA CIRILA / FLOREZ GARCIA PERCY ZACARIAS",
        }],
        "banderas_red": [{
            "estado": "hallado", "titulo": "Socios con los mismos apellidos en dos postores rivales",
            "descripcion": "Inversiones Puquin y Grifo Latino tienen socios Flórez García", "severidad": "alta",
            "confianza": "alta", "evidencia": "socios_postores_rivales (RNP)",
        }],
    })
    assert pn.estado == "hallado"
    lazo = pn.lazos_entre_postores[0]
    assert lazo.tipo_vinculo == "apellidos_familiares" and lazo.severidad == "alta" and lazo.estado == "hallado"
    assert lazo.postor_b.ruc == "20527055840" and lazo.postor_b.razon_social == "GRIFO LATINO S.A.C."
    assert lazo.evidencia[0].cita.startswith("person_network_context")
    assert pn.banderas_red[0].evidencia[0].cita == "socios_postores_rivales (RNP)"
    assert pn.descartes_relevantes() == []


def test_tipo_vinculo_desconocido_degrada_a_no_verificable_sin_perder_el_item():
    """Enum realmente desconocido: el lazo se conserva (descripción, postores) pero pasa a
    `no_verificable` con `tipo_vinculo: sin_vinculo`, y queda anotado como descarte relevante."""
    pn = S.PersonNetworkOutput.model_validate({
        "estado": "sin_dato",
        "lazos_entre_postores": [{
            "estado": "hallado", "postor_a": {"razon_social": "A"}, "postor_b": {"razon_social": "B"},
            "tipo_vinculo": "sincronia_de_ofertas", "descripcion": "ofertas con 0.14 % de dispersión",
            "evidencia": [{"cita": "acta p.2"}],
        }],
    })
    lazo = pn.lazos_entre_postores[0]
    assert lazo.estado == "no_verificable" and lazo.tipo_vinculo == "sin_vinculo"
    assert lazo.descripcion == "ofertas con 0.14 % de dispersión"
    motivos = {d["motivo"] for d in pn.descartes_relevantes()}
    assert {"enum_fallback", "estado_degradado"} <= motivos


def test_cruce_firmante_y_familiar_fuera_de_enum():
    """1225030/1225090/1225266: `cruce_firmantes_ganador` con `estado='no_hallado'`,
    `tipo_relacion='ninguna'` y `pareja_o_familia` con `actividad_publica` fuera del Literal
    → 4 cruces y 2 lazos tirados enteros."""
    pn = S.PersonNetworkOutput.model_validate({
        "estado": "sin_dato",
        "cruce_firmantes_ganador": [
            {"estado": "no_hallado", "firmante": "Mario Junior Valer Ccorahua", "tipo_relacion": "ninguna",
             "descripcion": "sin relación documentada"},
            {"estado": "hallado", "firmante": "Percy Bolívar Espinoza", "persona_proveedor": "Diana Carolina Baca Quispe",
             "tipo_relacion": "Coincidencia de apellido", "confianza_match": "Alta", "severidad": "ALTA",
             "evidencia": [{"url": "https://x/y", "cita": "Carrasco Baca"}]},
        ],
        "pareja_o_familia": [
            {"estado": "hallado", "nombre": "Gilberto Baca Núñez", "parentesco": "hermano",
             "actividad_publica": "empresario", "evidencia": "RNP: representante legal de G-B-K"},
        ],
    })
    a, b = pn.cruce_firmantes_ganador
    assert (a.estado, a.tipo_relacion) == ("sin_dato", "sin_relacion")
    # apellido compartido: se acepta pero SIEMPRE baja (regla del schema), aunque el modelo dijera alta
    assert (b.tipo_relacion, b.confianza_match, b.severidad) == ("apellido_compartido", "baja", "baja")
    fam = pn.pareja_o_familia[0]
    assert (fam.parentesco, fam.actividad_publica) == ("hermano_a", "empresario_contratista")
    assert pn.descartes_relevantes() == []


def test_cita_larga_y_alias_de_titulo_en_banderas_de_investigacion():
    """1225256: `banderas_sugeridas` (web) y `banderas_prensa` (news) descartadas por cita > 240
    y por faltar `titulo`/`descripcion`/`estado` → el hallazgo de la Res. 326-2026 (contrato
    previo resuelto por incumplimiento) no pudo convertirse en bandera."""
    cita_larga = ("RESOLUCIÓN DE OFICINA GENERAL DE ADMINISTRACIÓN N° 326-2026-MPCH-GM-OGA: resolver totalmente la "
                  "Orden de Compra N° 0001032-2026 suscrita con ESTACIÓN DE SERVICIOS LIN PETRO S.A.C. por "
                  "incumplimiento injustificado de sus obligaciones contractuales, conforme al artículo 164 del "
                  "Reglamento de la Ley de Contrataciones Públicas aprobado por D.S. 009-2025-EF, y disponer las acciones.")
    assert len(cita_larga) > S.CITA_MAX
    w = S.WebResearchOutput.model_validate({
        "estado": "hallado",
        "banderas_sugeridas": [{
            "regla": "contrato_previo_resuelto", "detalle": "Res. OGA 326-2026 resuelve una O/C con el mismo proveedor",
            "severidad": "baja",
            "evidencia": [{"url": "https://www.gob.pe/institucion/munichumbivilcas/normas-legales/8562078-326-2026-mpch-gm-oga",
                           "cita": cita_larga}],
        }],
    })
    b = w.banderas_sugeridas[0]
    assert b.estado == "hallado" and b.titulo == "contrato_previo_resuelto"
    assert b.descripcion.startswith("Res. OGA 326-2026") and len(b.evidencia[0].cita) == S.CITA_MAX
    assert w.estado == "hallado" and w.evidencia          # la raíz hereda la evidencia

    n = S.NewsOutput.model_validate({
        "estado": "hallado",
        "banderas_prensa": [{"nombre": "Contrato resuelto por incumplimiento", "resumen": "según gob.pe",
                             "severidad": "Media", "url": "https://www.gob.pe/x",
                             "evidencia": [{"url": "https://www.gob.pe/x", "cita": cita_larga}]}],
    })
    assert n.banderas_prensa[0].titulo == "Contrato resuelto por incumplimiento" and n.banderas_prensa[0].severidad == "media"


def test_web_research_categoria_fuera_de_enum_monto_texto_y_ciiu_largo():
    """1225392/1225416/1225450: `hallazgos_por_fuente` con categoría libre, `monto` "S/ 120,000.00"
    en texto y CIIU > 40 chars → bloques enteros descartados y `estado: no_verificable`."""
    w = S.WebResearchOutput.model_validate({
        "estado": "hallado",
        "empresa": {"ruc": "10426100725", "razon_social": "CARPIO COBOS ABEL",
                    "ciiu": "7710 - ALQUILER Y ARRENDAMIENTO DE VEHICULOS AUTOMOTORES SIN CONDUCTOR"},
        "hallazgos_por_fuente": [
            {"fuente": "SUNAT", "categoria": "registro tributario", "estado": "OK", "mensaje": "activo y habido"},
            {"fuente": "OSCE - Tribunal de Contrataciones", "categoria": "sanciones_osce", "estado": "sin menciones"},
            {"fuente": "El Comercio / prensa", "categoria": "investigacion_periodistica", "estado": "no_hallado"},
            {"fuente": "JNE Infogob", "categoria": "registro", "estado": "ok", "url": "https://infogob.jne.gob.pe/x"},
        ],
        "otros_contratos_con_estado": [
            {"estado": "hallado", "entidad": "GORE CUSCO", "monto": "S/ 360,000.00", "fecha": "2024-11",
             "evidencia": [{"url": "https://prod2.seace.gob.pe/x", "cita": "Servicio 1151 Ocobamba"}]},
        ],
    })
    assert w.estado == "hallado"
    assert w.empresa is not None and len(w.empresa.ciiu) == 40
    assert [(h.categoria, h.estado) for h in w.hallazgos_por_fuente] == [
        ("empresas", "ok"), ("sanciones", "sin_menciones"), ("prensa", "sin_menciones"), ("politica", "ok")]
    assert w.otros_contratos_con_estado[0].monto == 360000.0
    assert w.historial_resumido.n_contratos_estado_hallados == 1


def test_entity_personnel_cita_larga_no_descarta_funcionario():
    """1225392: 2 funcionarios descartados por cita > 240."""
    ep = S.EntityPersonnelOutput.model_validate({
        "estado": "hallado",
        "funcionarios_designados": [{
            "estado": "hallado", "nombre_completo": "José Manuel Sara Quispe",
            "cargo": "Jefe de la Unidad Funcional de Abastecimiento", "tipo_cargo": "designado",
            "fuente_url": "https://www.gob.pe/institucion/regioncusco/x",
            "evidencia": [{"url": "https://www.gob.pe/institucion/regioncusco/x", "cita": "RESOLUCIÓN " * 40}],
        }],
    })
    assert ep.n_funcionarios == 1 and ep.funcionarios_designados[0].tipo_cargo == "confianza_designado"


def test_estado_ausente_se_infiere_y_evidencia_dict_suelto():
    b = S.BanderaRed.model_validate({"titulo": "t", "descripcion": "d", "evidencia": {"url": "https://a/b", "texto": "cita"}})
    assert b.estado == "hallado" and b.evidencia[0].cita == "cita" and b.fuentes == ["https://a/b"]
    c = S.BanderaRed.model_validate({"titulo": "t", "descripcion": "d"})
    assert c.estado == "no_verificable"


def test_market_precio_texto_y_moneda_libre():
    f = S.MarketFinding.model_validate({
        "estado": "hallado", "item_numero": "1.1", "item_descripcion": "arroz superior", "cantidad": "25,450",
        "precios_observados": [{"producto": "Arroz Faraón bolsa 5 kg", "precio": "S/ 19.90", "unidad": "bolsa 5 kg",
                                "moneda_origen": "soles", "url": "https://g/1"}],
    })
    assert f.cantidad == 25450.0 and f.precios_observados[0].precio == 19.9
    assert f.precios_observados[0].moneda_origen == "PEN"


# ═══════════════════════════════════════════════════════════════════════════
# T4 · el driver vuelca los descartes del schema a state['descartes'] y avisa
# ═══════════════════════════════════════════════════════════════════════════

def test_validar_schema_propaga_descartes_y_avisa_listas_vaciadas():
    """1225090 #2 / 1225392 #7: `descartes_schema` quedaba dentro del objeto y `state.descartes`
    vacío; el dictamen decía "sin descartes" habiendo perdido 3 banderas legales."""
    st = {"descartes": [], "legal_analysis": json.dumps({
        "estado": "hallado",
        "red_flags_documentales": [
            {"estado": "hallado", "vector": "marca_unica", "severidad": "alta", "descripcion": "ok",
             "norma_citada": "Art. 2", "evidencia": [EV_DOC]},
            {"estado": "hallado", "vector": "plazo_imposible", "severidad": "alta", "descripcion": "sin evidencia",
             "norma_citada": "Art. 2"},
        ],
    })}
    ev = D._validar_schema(st, "legal_analysis", "LegalOutput")
    assert ev and ev["kind"] == "warn" and "red_flags_documentales 2→1" in ev["msg"]
    assert len(st["legal_analysis"]["red_flags_documentales"]) == 1
    assert st["descartes"] and st["descartes"][0]["donde"].startswith("legal_analysis.schema.red_flags_documentales[1]")
    assert st["descartes"][0]["motivo"] == "item_invalido"

    # Sin pérdidas (solo normalización de mayúsculas) → ningún warn ni descarte.
    st2 = {"descartes": [], "legal_analysis": json.dumps({
        "estado": "hallado",
        "red_flags_documentales": [{"estado": "hallado", "vector": "marca_unica", "severidad": "ALTA",
                                    "descripcion": "ok", "norma_citada": "Art. 2", "evidencia": [EV_DOC]}]})}
    assert D._validar_schema(st2, "legal_analysis", "LegalOutput") is None
    assert st2["descartes"] == [] and st2["legal_analysis"]["red_flags_documentales"][0]["severidad"] == "alta"


# ═══════════════════════════════════════════════════════════════════════════
# T9 · verificación y sanitización del dictamen
# ═══════════════════════════════════════════════════════════════════════════

RUC_ENTIDAD = "20177217043"
RUC_INVENTADO = "20177743016"      # 1225062: "Hechos clave" con RUC de la entidad inventado
RUC_PROV = "20600616235"
DNI_PART = "41156031"              # 1225062: DNI del gerente (particular) publicado
DNI_FUNC = "48258523"


def _state_dictamen(**extra):
    st = {
        "ocid": "1225062", "alerta_codigo": "OECE-1225062",
        "ocds": {
            "ocid": "ocds-dgv273-seacev3-1225062",
            "buyer": {"id": "PE-CONSUCODE-749", "name": "MUNICIPALIDAD PROVINCIAL DEL CUSCO"},
            "parties": [
                {"id": "PE-CONSUCODE-749", "name": "MUNICIPALIDAD PROVINCIAL DEL CUSCO", "roles": ["buyer"],
                 "additionalIdentifiers": [{"scheme": "PE-RUC", "id": RUC_ENTIDAD}]},
                {"id": f"PE-RUC-{RUC_PROV}", "name": "PROMAINGSA S.A.C.", "roles": ["tenderer", "supplier"]},
            ],
            "tender": {"title": "COMPRE-27-2026", "value": {"amount": 99633.33, "currency": "PEN"}, "numberOfTenderers": 5,
                       "tenderers": [{"id": f"PE-RUC-{RUC_PROV}", "name": "PROMAINGSA S.A.C."}], "items": [], "documents": []},
            "awards": [{"id": "1", "suppliers": [{"id": f"PE-RUC-{RUC_PROV}", "name": "PROMAINGSA S.A.C."}],
                        "value": {"amount": 97950.0, "currency": "PEN"}, "date": "2026-06-22"}],
            "contracts": [{"id": "1", "value": {"amount": 97950.0, "currency": "PEN"}}],
        },
        "person_network_context": {"rnp_proveedor": {"socios": [{"nombre": "ARIAS OBLITAS JUAN FERNANDO", "dni": DNI_PART}]},
                                   "firmantes": [{"nombre_completo": "SANDRO HERSON SALCEDO CASTILLO", "dni": DNI_FUNC}]},
        "banderas": [{"regla": "objeto_no_corresponde_documento", "severidad": "alta", "evidencia": "x"}],
        "grounding_urls": ["https://www.munisantiago.gob.pe/normas/rgm-079-2024"],
    }
    st.update(extra)
    return st


@pytest.fixture(autouse=True)
def _sin_bd_ni_red(monkeypatch):
    monkeypatch.setattr(verify, "_en_bd", lambda kind, valor: False)
    monkeypatch.setattr(verify, "_texto_documento", lambda sha: None)
    monkeypatch.setattr(verify, "_HEAD_ACTIVO", True)
    verify._bd_cache.clear()
    verify._texto_cache.clear()
    verify._head_cache.clear()


def test_dictamen_ruc_inventado_y_dni_se_sustituyen_y_enmascaran():
    md = (f"## Hechos clave\n- Entidad: Municipalidad Provincial del Cusco (RUC {RUC_INVENTADO})\n"
          f"- Proveedor: PROMAINGSA S.A.C. (RUC {RUC_PROV}), gerente Juan Fernando Arias Oblitas (DNI {DNI_PART})\n"
          f"- Oficial de compra: Sandro Herson Salcedo Castillo, DNI N° {DNI_FUNC}\n"
          f"- Bandera `objeto_no_corresponde_documento`.")
    ver = verify.verificar_dictamen(md, _state_dictamen())
    assert ver["rucs_no_respaldados"] == [RUC_INVENTADO] and ver["dnis_no_respaldados"] == []
    assert sorted(ver["dnis_en_dictamen"]) == sorted([DNI_PART, DNI_FUNC])
    md2, cambios = verify.sanitizar_dictamen(md, ver)
    assert cambios["modificado"] and cambios["rucs_sustituidos"] == [RUC_INVENTADO]
    assert cambios["dnis_enmascarados"] == 2
    assert RUC_INVENTADO not in md2 and "[RUC no verificado]" in md2
    assert DNI_PART not in md2 and DNI_FUNC not in md2
    assert "DNI 41****31" in md2 and "DNI N° 48****23" in md2
    assert RUC_PROV in md2                      # el RUC respaldado se conserva


def test_dictamen_url_gob_inventada_se_quita_y_la_real_se_conserva(monkeypatch):
    """1225256: `…/normas-legales/5923940-326-2026-mpch-gm-oga` redirige a una resolución de
    otra institución (UNAJ 2014); la real es `…/8562078-326-2026-mpch-gm-oga`."""
    falsa = "https://www.gob.pe/institucion/munichumbivilcas/normas-legales/5923940-326-2026-mpch-gm-oga"
    real = "https://www.gob.pe/institucion/munichumbivilcas/normas-legales/8562078-326-2026-mpch-gm-oga"
    respuestas = {
        falsa: (200, "https://www.gob.pe/institucion/unaj/normas-legales/5923940-resolucion-2014"),
        real: (200, real),
        "https://www.gob.pe/institucion/munichumbivilcas/normas-legales/99-otra": (404, None),
    }
    llamadas = []

    def _head_falso(url, timeout=None):
        llamadas.append(url)
        return respuestas.get(url, (None, None))
    monkeypatch.setattr(verify, "_head", _head_falso)

    md = (f"Antecedente: [Res. OGA 326-2026]({falsa}) y también {real} ; ficha "
          f"https://contratacionesabiertas.oece.gob.pe/proceso/1225062 y https://www.munisantiago.gob.pe/normas/rgm-079-2024 "
          f"y https://www.gob.pe/institucion/munichumbivilcas/normas-legales/99-otra .")
    ver = verify.verificar_dictamen(md, _state_dictamen())
    assert falsa in ver["urls_no_respaldadas"]
    assert "https://www.gob.pe/institucion/munichumbivilcas/normas-legales/99-otra" in ver["urls_no_respaldadas"]
    assert real not in ver["urls_no_respaldadas"] and real in ver["urls_gob_verificadas"]
    motivos = {u["url"]: u["motivo"] for u in ver["urls_gob_no_verificadas"]}
    assert motivos[falsa] == "redirige_a_otra_institucion"
    assert "https://contratacionesabiertas.oece.gob.pe/proceso/1225062" not in llamadas   # host canónico: sin HEAD
    md2, cambios = verify.sanitizar_dictamen(md, ver)
    assert falsa not in md2 and "Res. OGA 326-2026 [URL no verificable]" in md2
    assert real in md2 and "contratacionesabiertas.oece.gob.pe/proceso/1225062" in md2
    assert sorted(cambios["urls_eliminadas"]) == sorted([falsa, "https://www.gob.pe/institucion/munichumbivilcas/normas-legales/99-otra"])


def test_verificar_url_gob_exige_numero_de_norma_en_la_url_efectiva(monkeypatch):
    monkeypatch.setattr(verify, "_head", lambda url, timeout=None: (
        200, "https://www.gob.pe/institucion/munisantiago/normas-legales/7777-001-2025-gm"))
    ok, motivo = verify.verificar_url_gob("https://www.gob.pe/institucion/munisantiago/normas-legales/1234-227-2025-gm")
    assert ok is False and motivo == "redirige_a_otra_norma"
    assert verify.verificar_url_gob("https://seace.gob.pe")[0] is True          # dominio pelado: institucional
    assert verify.verificar_url_gob("https://apps.osce.gob.pe/perfilprov-ui/ficha/20600616235")[0] is True
    monkeypatch.setattr(verify, "_head", lambda url, timeout=None: (None, None))
    assert verify.verificar_url_gob("https://www.munisantiago.gob.pe/x/y") == (False, "sin_respuesta")


def test_bandera_sigue_aceptando_urls_oficiales_sin_head():
    """`verificar_bandera` no cambia: sus URLs las construye el código."""
    res = verify.verificar_bandera({"evidencia": "Ver https://contratacionesabiertas.oece.gob.pe/proceso/1225062"}, _state_dictamen())
    assert res["ok"] is True and any(m.endswith("oficial_o_determinista") for m in res["motivos"])


# ═══════════════════════════════════════════════════════════════════════════
# Contexto del dictamen
# ═══════════════════════════════════════════════════════════════════════════

class _Ctx:
    def __init__(self, state):
        self.state = state


def test_compact_ocds_trae_ruc_de_entidad_y_proveedor():
    """1225062 #7: `_compact_ocds` omitía el RUC de la entidad (solo `buyer.id`) y el prompt
    pedía "RUC de la entidad" → el modelo lo inventó."""
    c = state_loaders._compact_ocds(_state_dictamen()["ocds"])
    assert c["buyer"]["ruc"] == RUC_ENTIDAD
    assert c["awards"][0]["suppliers"][0]["ruc"] == RUC_PROV
    assert c["contracts"][0]["value"]["amount"] == 97950.0
    # sin parties: cae al patrón PE-RUC-… del buyer.id, y si no hay, null (nunca inventado)
    c2 = state_loaders._compact_ocds({"buyer": {"id": "PE-RUC-20154432516"}, "tender": {}})
    assert c2["buyer"]["ruc"] == "20154432516"
    assert state_loaders._compact_ocds({"buyer": {"id": "PE-CONSUCODE-749"}, "tender": {}})["buyer"]["ruc"] is None


def test_dictamen_context_marca_narrativa_degradada_e_incluye_oece_y_rnp(monkeypatch):
    """1225030: `oece_perfil` con 0 sanciones verificadas y el dictamen decía `sin_dato`;
    `person_network` degradado a no_verificable pero su `sintesis` (familia Baca) llegó íntegra
    y se publicó. 1225266: la oficial de compra socia de una S.R.L. en RNP (match 1.0) y el
    dictamen negaba coincidencias societarias."""
    monkeypatch.setattr(state_loaders, "_pg", lambda: (_ for _ in ()).throw(RuntimeError("sin bd")))
    st = _state_dictamen(
        person_network={"estado": "no_verificable", "evidencia": [], "banderas_red": [],
                        "sintesis": "El núcleo familiar Baca intervino en la aprobación de adendas.",
                        "persona_principal": {"estado": "sin_dato", "sintesis_personal": "socio Baca Quispe"}},
        legal_analysis={"estado": "no_verificable", "red_flags_documentales": [],
                        "direccionamiento_detectado": {"hay_indicios": True, "justificacion": "specs calcadas"},
                        "resumen_ejecutivo": "Se detectan indicios de direccionamiento."},
        web_research={"estado": "hallado", "sintesis": "ok"},
        oece_perfiles={RUC_PROV: {"ruc": RUC_PROV, "razon_social": "PROMAINGSA S.A.C.", "es_apto_contratar": True,
                                  "n_sanciones": 0, "n_inhabilitaciones_judiciales": 0, "n_inhabilitaciones_administrativas": 0,
                                  "n_penalidades": 3, "sanciones": [], "fuente_url": f"https://apps.oece.gob.pe/perfilprov-ui/ficha/{RUC_PROV}"}},
    )
    st["person_network_context"]["rnp_firmantes_resultados"] = [
        {"firmante": "Liz Frine Alvarez Gutierrez", "match_por": "nombre_exacto", "n_empresas": 1,
         "empresas": [{"ruc_empresa": "20607558184", "nombre_visto": "ALVAREZ GUTIERREZ LIZ FRINE", "roles": ["SOCIO"],
                       "fecha_inicio_vigencia": "2021-03-01", "match_score": 1.0}]},
        {"firmante": "G. Cecilia Alvarado Arenas", "match_por": "nombre_fuzzy", "n_empresas": 2,
         "empresas": [{"ruc_empresa": "20111111111", "nombre_visto": "ALVARADO ARENAS CECILIA", "match_score": 0.61}]},
    ]
    ctx = state_loaders.get_dictamen_context(_Ctx(st))
    assert ctx["salidas_no_verificables"] == ["legal_analysis", "person_network"]
    assert ctx["person_network"]["sintesis"].startswith("[NO VERIFICABLE] ")
    assert ctx["person_network"]["persona_principal"]["sintesis_personal"].startswith("[NO VERIFICABLE] ")
    assert "_aviso" in ctx["person_network"]
    assert ctx["legal_analysis"]["resumen_ejecutivo"].startswith("[NO VERIFICABLE] ")
    assert ctx["legal_analysis"]["direccionamiento_detectado"]["justificacion"].startswith("[NO VERIFICABLE] ")
    assert "_aviso" in ctx["legal_analysis"]["direccionamiento_detectado"]
    assert ctx["web_research"]["sintesis"] == "ok"                     # las sanas no se tocan
    assert ctx["oece_perfil"][RUC_PROV]["n_sanciones"] == 0 and ctx["oece_perfil"][RUC_PROV]["n_penalidades"] == 3
    assert "0 es un hecho verificado" in ctx["oece_perfil"]["_nota"]
    rnp = ctx["rnp_firmantes_resultados"]
    assert len(rnp) == 1 and rnp[0]["firmante"] == "Liz Frine Alvarez Gutierrez"
    assert rnp[0]["empresas"][0]["ruc_empresa"] == "20607558184"
    assert ctx["ocds"]["buyer"]["ruc"] == RUC_ENTIDAD
    # el state NO se muta (la prosa marcada vive solo en el contexto del writer)
    assert st["person_network"]["sintesis"].startswith("El núcleo")


# ═══════════════════════════════════════════════════════════════════════════
# Self-eval: el juez de precio tiene consecuencia
# ═══════════════════════════════════════════════════════════════════════════

class _CursorMercado:
    def __init__(self, db):
        self.db = db
        self._rows = []

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).lower()
        p = tuple(params or ())
        self._rows = []
        if s.startswith("select id from alertas"):
            self._rows = [("A1",)] if p[0] == "OECE-1225058" else []
        elif s.startswith("select id, regla, evidencia from banderas"):
            self._rows = [(b["id"], b["regla"], b["evidencia"]) for b in self.db["banderas"]
                          if b["agente_origen"] == "market_price_agent"]
        elif s.startswith("delete from banderas where id"):
            self.db["banderas"] = [b for b in self.db["banderas"] if b["id"] != p[0]]
        elif s.startswith("select regla, severidad, evidencia, norma, fuente_url, agente_origen"):
            self._rows = [(b["regla"], b["severidad"], b["evidencia"], b["norma"], b["fuente_url"], b["agente_origen"], None)
                          for b in self.db["banderas"]]
        elif s.startswith("update alertas set score"):
            self.db["score"] = p[0]
        elif s.startswith("update alertas set analisis_full"):
            self.db["analisis_full_market"] = json.loads(p[0])
        elif s.startswith("alter table"):
            pass
        else:
            raise AssertionError(f"SQL inesperado: {sql[:100]}")

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class _ConnMercado:
    def __init__(self, db):
        self.db = db
        self.commits = 0

    def cursor(self):
        return _CursorMercado(self.db)

    def commit(self):
        self.commits += 1

    def close(self):
        pass


def test_juez_precio_dudoso_retira_bandera_de_mercado_y_recalcula_score(monkeypatch):
    """1225058: mercado comparó S/ 3.12/kg contra bolsas de 5 kg (S/ 19.90) → "barato −84 %";
    1225450: +7 162 % (100 gal de gasohol vs lote de 5 100 gal) publicado como bandera ALTA
    con score 43. El juez `precio` ya decía "implausible, error de unidad" y no cambiaba nada."""
    db = {"score": 43, "banderas": [
        {"id": 1, "regla": "sobreprecio_lote_muy_elevado", "severidad": "alta", "agente_origen": "market_price_agent",
         "evidencia": "Lote completo: precio ofertado total S/. 139,950.00 vs estimado de mercado S/. 1,927.00 (+7162.0% …)",
         "norma": "Art. 12", "fuente_url": "u"},
        {"id": 2, "regla": "sobreprecio_muy_elevado", "severidad": "alta", "agente_origen": "market_price_agent",
         "evidencia": "Ítem 'GASOHOL REGULAR': precio ofertado +7162.0% por encima de la mediana de mercado.",
         "norma": "Art. 12", "fuente_url": "u"},
        {"id": 3, "regla": "sobreprecio_elevado", "severidad": "media", "agente_origen": "market_price_agent",
         "evidencia": "Ítem 'DIESEL B5 S-50': precio ofertado +17.0% por encima de la mediana de mercado.",
         "norma": "Art. 12", "fuente_url": "u"},
        {"id": 4, "regla": "inconsistencia_doc_vs_ocds", "severidad": "media", "agente_origen": "compliance_agent",
         "evidencia": "x", "norma": "Art. 2", "fuente_url": "u"},
    ]}
    conn = _ConnMercado(db)
    import tools._core as core
    import tools.persistence as pers
    monkeypatch.setattr(core, "_pg", lambda: conn)
    monkeypatch.setattr(pers, "_pg", lambda: conn)
    monkeypatch.setattr(self_eval, "_DEGRADAR_MERCADO", True)
    st = {"alerta_codigo": "OECE-1225058", "descartes": [],
          "market_analysis": {"veredicto_global": "muy_elevado", "sobreprecio_pct": 7162.0,
                              "findings": [{"item_descripcion": "GASOHOL REGULAR", "veredicto": "muy_elevado", "diff_pct": 7162.0},
                                           {"item_descripcion": "DIESEL B5 S-50", "veredicto": "elevado", "diff_pct": 17.0}]}}
    per_precio = [{"item": "GASOHOL REGULAR", "plausible": False, "reason": "compara precio por galón con el lote completo"},
                  {"item": "DIESEL B5 S-50", "plausible": True, "reason": "Δ coherente"}]
    res = self_eval.degradar_mercado_implausible(per_precio, st)
    assert res["error"] is None and res["items"] == ["GASOHOL REGULAR"]
    assert sorted(b["regla"] for b in res["banderas_eliminadas"]) == ["sobreprecio_lote_muy_elevado", "sobreprecio_muy_elevado"]
    assert sorted(b["regla"] for b in db["banderas"]) == ["inconsistencia_doc_vs_ocds", "sobreprecio_elevado"]
    assert res["score"] == db["score"] and db["score"] < 43
    f_gas, f_die = st["market_analysis"]["findings"]
    assert f_gas["veredicto"] == "no_verificable" and f_gas["veredicto_original"] == "muy_elevado"
    assert "juez de plausibilidad" in f_gas["motivo_no_verificable"]
    assert f_die["veredicto"] == "elevado"
    assert st["market_analysis"]["veredicto_global"] == "no_verificable" and st["market_analysis"]["sobreprecio_pct"] is None
    assert db["analisis_full_market"]["findings"][0]["veredicto"] == "no_verificable"
    assert any(d["motivo"] == "juez_precio_implausible" and d["regla"] == "sobreprecio_lote_muy_elevado" for d in st["descartes"])
    assert conn.commits == 1


def test_juez_precio_sin_dudosos_no_toca_nada():
    st = {"alerta_codigo": "OECE-1", "market_analysis": {"findings": [{"item_descripcion": "x", "veredicto": "elevado"}]}}
    res = self_eval.degradar_mercado_implausible([{"item": "x", "plausible": True, "reason": ""}], st)
    assert res["items"] == [] and st["market_analysis"]["findings"][0]["veredicto"] == "elevado"


# ═══════════════════════════════════════════════════════════════════════════
# Prompts: vocabulario en minúsculas y reglas del dictamen
# ═══════════════════════════════════════════════════════════════════════════

def test_prompts_enumeran_enums_en_minuscula_y_prohiben_dni():
    import re
    from agents.document_legal_analyst import prompt as legal
    from agents.person_network import prompt as red
    from agents.web_research import prompt as web
    from agents.news_research import prompt as news
    from agents.report_writer import prompt as writer

    txt = legal.build_instruction("bienes") + legal.build_instruction("servicios") + legal.build_instruction("obras") + legal.build_instruction("otros")
    assert not re.search(r"\b(ALTA|MEDIA|BAJA)\b", txt), "el prompt legal no debe dictar severidades en mayúsculas"
    for v in ("marca_unica", "specs_convergentes", "`alta` | `media` | `baja`", "Ley 32069", "Comparación de Precios"):
        assert v in txt
    for v in ("apellidos_familiares", "co_postulan_otros_procesos", "parentesco_documentado", "codireccion_empresa",
              "empresario_contratista", "posible_familiar", "[{url, cita}]"):
        assert v in red.INSTRUCTION
    for v in ("empresas", "sanciones", "politica", "justicia", "contratos", "sin_menciones", "NÚMERO en soles"):
        assert v in web.INSTRUCTION
    for v in ("menciones_sin_riesgo", "prensa_general", "alta | media | baja | info", "`titulo`, `descripcion`"):
        assert v in news.INSTRUCTION
    w = writer.build_instruction(None)
    for v in ("PROHIBIDO publicar el DNI de CUALQUIER persona", "ocds.buyer.ruc", "Ley 32069",
              "Lo que no se pudo verificar", "salidas_no_verificables", "PROHIBIDO volcar JSON"):
        assert v in w
