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
