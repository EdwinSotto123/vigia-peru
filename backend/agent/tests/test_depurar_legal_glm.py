"""Las falsas alarmas del analista legal con GLM 5.3 flash en la prueba de oro (2026-11-10): un requisito que dejó a 4
ofertas en carrera y una garantía que el contrato remite a la ley. Las que sí pueden ser direccionamiento quedan."""
from tools.cotejos_legales import depurar_banderas_legales


def _estado(banderas, calificados=0):
    postores = [{"calificada": True}] * calificados + [{"calificada": False}] * 3
    return {"legal_analysis": {"red_flags_documentales": banderas}, "lecturas_legal": {"acta": {"postores": postores}}}


def test_requisito_que_dejo_competencia_y_garantia_que_remite_a_la_ley():
    st = _estado([
        {"vector": "otro", "descripcion": "El requisito de calificación del certificado ANSI/ISEA Z89.1 exigido dentro de la oferta dejó fuera 6 de 10 ofertas."},
        {"vector": "otro", "descripcion": "El contrato no fija la garantía de fiel cumplimiento: la cláusula remite a la LGCP y a su Reglamento solo 'de corresponder'."},
    ])
    fuera = depurar_banderas_legales(st)
    assert len(fuera) == 2
    assert st["legal_analysis"]["red_flags_documentales"] == []


def test_requisito_con_tres_calificados_en_el_acta():
    st = _estado([{"vector": "requisito_a_la_medida", "descripcion": "Se exige experiencia en un certificado específico ISO para el ítem 2."}], calificados=3)
    assert len(depurar_banderas_legales(st)) == 1


def test_quedan_las_de_marca_unico_proveedor_y_descalificacion():
    banderas = [
        {"vector": "requisito_a_la_medida", "descripcion": "Las bases exigen la marca 3M sin equivalente: dejó fuera 6 de 10 ofertas."},
        {"vector": "otro", "descripcion": "Se descalificó la oferta más baja por un requisito que las bases no exigían."},
        {"vector": "requisito_a_la_medida", "descripcion": "Requisito que sólo un proveedor del país cumple (único proveedor autorizado)."},
    ]
    st = _estado(banderas, calificados=5)
    assert depurar_banderas_legales(st) == []
    assert len(st["legal_analysis"]["red_flags_documentales"]) == 3


def test_glm53_comite_ausente_fianza_y_n_de_m_no_admitidas():
    st = _estado([
        {"vector": "otro", "descripcion": "Requisito técnico-documental restrictivo (certificado ANSI vigente) resultó decisivo: 6 de 10 ofertas fueron no admitidas por esos literales."},
        {"vector": "comite", "descripcion": "Licitación Pública Abreviada sin comité de selección identificado en el documento: la buena pro aparece suscrita por un Oficial de Compra."},
        {"vector": "otro", "descripcion": "La carta fianza de fiel cumplimiento vence el 20/08/2026, cuando el contrato exige que la garantía se mantenga vigente hasta la conformidad."},
    ])
    assert len(depurar_banderas_legales(st)) == 3


def test_quedan_la_incongruencia_y_lo_que_hizo_el_comite():
    banderas = [
        {"vector": "otro", "descripcion": "Incongruencia interna: el acta de admisión declaró NO ADMITIDAS a tres postores que el acta de calificación declara calificados."},
        {"vector": "otro", "descripcion": "El propio comité reconoció que evaluó las muestras con criterios no previstos en las bases."},
    ]
    st = _estado(banderas)
    assert depurar_banderas_legales(st) == []
