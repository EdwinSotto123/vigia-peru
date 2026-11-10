"""Prueba de oro de las redes con modelos abiertos (2026-11-10): «el requisito dejó fuera a los demás y quedó uno» sin
nada que converja pasa a contexto (servicios 1229450, 1230693, 1232139); siguen las faltas del comité (1231453,
consultoría 1228202) y el grado académico ajeno al objeto (obras 1228272). El verificador lee «S/ 63 500»."""
from tools import verify
from tools.cotejos_legales import _competencia_efectiva, depurar_banderas_legales


def _estado(banderas, postores=None):
    postores = postores if postores is not None else [{"calificada": True, "ganador": True}, {"calificada": False}]
    return {"legal_analysis": {"red_flags_documentales": banderas}, "lecturas_legal": {"acta": {"postores": postores}}}


def _motivos(st):
    return [q["motivo"] for q in depurar_banderas_legales(st)]


def test_requisito_que_dejo_un_solo_calificado_sin_convergencia_pasa_a_contexto():
    st = _estado([
        {"vector": "otro", "descripcion": "Requisito de calificación de experiencia 'a la medida' (servicio similar restringido a agua y "
                                          "alcantarillado) excluyó al único competidor y solo quedó el ganador con 100 puntos."},
        {"vector": "otro", "descripcion": "Observaciones no acogidas pedían flexibilizar requisitos de calificación y un postor fue descalificado "
                                          "por no acreditar la experiencia del personal clave, dejando un solo competidor calificado."},
    ])
    motivos = _motivos(st)
    assert len(motivos) == 2 and all("dejó fuera a los demás" in m for m in motivos)
    assert st["legal_analysis"]["red_flags_documentales"] == []


def test_falta_del_comite_sigue():
    st = _estado([{"vector": "otro", "descripcion": "El comité calificó y adjudicó al consorcio pese a que el propio acta reconoce que su personal "
                                                    "clave acreditó 40 horas cuando las bases exigían 60, incumpliendo un requisito indispensable."}])
    assert _motivos(st) == []


def test_descalificacion_por_centimos_sigue():
    st = _estado([{"vector": "otro", "descripcion": "La oferta económica más baja fue descalificada por diferencias de céntimos entre el desglose "
                                                    "90%/10% y el anexo 6, con puntaje 100 y calificada."}])
    assert _motivos(st) == []


def test_grado_academico_ajeno_al_objeto_sigue():
    st = _estado([{"vector": "personal_clave_sobreexigido",
                   "descripcion": "Requisito de magíster en geotecnia y transportes para el residente de una obra de servicios higiénicos; "
                                  "el único postor descalificado quedó fuera por no presentarlo."}])
    assert _motivos(st) == []


def test_marca_que_dejo_un_solo_calificado_sigue():
    st = _estado([{"vector": "requisito_a_la_medida",
                   "descripcion": "Las bases exigen la marca CALAMINON sin equivalente y la otra oferta fue descalificada."}])
    assert _motivos(st) == []


def test_prohibir_la_subcontratacion_pasa_a_contexto():
    st = _estado([{"vector": "subcontratacion_prohibida", "descripcion": "Las bases prohíben totalmente la subcontratación."}])
    assert [m for m in _motivos(st) if "subcontratación" in m]


def test_calificada_y_luego_descalificada_no_cuenta_como_competencia():
    postores = [{"calificada": True, "ganador": True},
                {"calificada": True, "ganador": False, "motivo_tipo": "precio",
                 "motivo_fuera": "Oferta económica descalificada por no cumplir el 90 % / 10 %"},
                {"calificada": True, "ganador": False, "motivo_fuera": "Bonificación MYPE no otorgada; no fue descalificado"},
                # 1223907: actas de admisión y de calificación que no cuadran; para la prueba de oro es válida.
                {"calificada": True, "ganador": False, "motivo_tipo": "tecnico",
                 "motivo_fuera": "No admitida en la admisión; el acta de calificación la declara admitida y calificada"}]
    assert _competencia_efectiva({"lecturas_legal": {"acta": {"postores": postores}}}) == 3


def test_monto_con_miles_separados_por_espacio():
    ids = verify.extraer_identificadores("adjudicó (95 puntos, S/ 63 500) y S/ 1 234 567,50; S/. 1,234.56; 500 soles")
    assert ids["montos"]["63 500"] == [63500.0]
    assert ids["montos"]["1 234 567,50"] == [1234567.5]
    assert ids["montos"]["1,234.56"] == [1234.56]
