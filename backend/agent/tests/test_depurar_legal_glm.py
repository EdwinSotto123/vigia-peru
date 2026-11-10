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


def test_quedan_las_de_marca_y_unico_proveedor_y_la_descalificacion_pasa_a_contexto():
    banderas = [
        {"vector": "requisito_a_la_medida", "descripcion": "Las bases exigen la marca 3M sin equivalente: dejó fuera 6 de 10 ofertas."},
        {"vector": "otro", "descripcion": "Se descalificó la oferta más baja por un requisito que las bases no exigían."},
        {"vector": "requisito_a_la_medida", "descripcion": "Requisito que sólo un proveedor del país cumple (único proveedor autorizado)."},
    ]
    st = _estado(banderas, calificados=5)
    quitadas = depurar_banderas_legales(st)
    la = st["legal_analysis"]
    # Con 5 calificados la descalificación no dejó a un solo proveedor: se publica sin puntaje (la cubre la regla
    # oferta_mas_barata_no_gana); la marca y el único proveedor siguen siendo banderas.
    assert [q["motivo"].startswith("contexto:") for q in quitadas] == [True]
    assert len(la["red_flags_documentales"]) == 2
    assert la["hallazgos_contexto"][0]["descripcion"].startswith("Se descalificó")


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


def test_con_dos_calificados_lo_que_no_converge_pasa_a_contexto():
    """Prueba de oro 2026-11-10 (1226611, 1228943, 1242917): con dos o más ofertas calificadas, un empate mal resuelto
    o la justificación del procedimiento no son requisito dirigido. Se publican sin puntaje, no se borran."""
    st = _estado([
        {"vector": "procedimiento", "descripcion": "Empate exacto de ofertas resuelto con un criterio no previsto en la comparación de precios."},
        {"vector": "procedimiento", "descripcion": "El acta justifica la Comparación de Precios en que la ficha de homologación se encuentra en revisión."},
    ], calificados=2)
    quitadas = depurar_banderas_legales(st)
    la = st["legal_analysis"]
    assert la["red_flags_documentales"] == [] and len(la["hallazgos_contexto"]) == 2
    assert all(q["motivo"].startswith("contexto: competencia efectiva") for q in quitadas)
    assert "descartes_depuracion" not in la


def test_modelo_exacto_o_marca_con_codigo_sigue_aunque_haya_competencia():
    """1228062 (dron con los valores de un solo modelo, 3 calificados) y 1226255 (tela por marca y código de artículo,
    2 calificados) SÍ son requisito dirigido: varios distribuidores venden la misma marca."""
    st = _estado([
        {"vector": "specs_convergentes", "descripcion": "Las EETT transcriben con valores exactos la ficha de un modelo concreto (hélice de 10,8 pulgadas, batería de 6741 mAh): converge en un fabricante."},
        {"vector": "marca_unica", "descripcion": "La tela se fija por nombre comercial y código de artículo 240420-250 sin «o equivalente»."},
    ], calificados=3)
    assert depurar_banderas_legales(st) == []
    assert len(st["legal_analysis"]["red_flags_documentales"]) == 2


def test_tramite_sin_requisito_pasa_a_contexto_aunque_haya_un_solo_calificado():
    """1225299: el mismo postor de la convocatoria desierta vuelve a ser el único; no toca un requisito (lo cubren las
    reglas de único postor)."""
    st = _estado([
        {"vector": "otro", "descripcion": "El mismo postor fue único oferente de la primera convocatoria, declarada desierta; vuelve y es adjudicado por S/ 2,623,428."},
        {"vector": "plazo_imposible", "descripcion": "El contrato fija 4 días calendario para la primera entrega de 120 unidades importadas."},
    ], calificados=1)
    quitadas = depurar_banderas_legales(st)
    la = st["legal_analysis"]
    assert len(quitadas) == 1 and la["hallazgos_contexto"][0]["motivo_contexto"].startswith("repite el único postor")
    assert [r["vector"] for r in la["red_flags_documentales"]] == ["plazo_imposible"]


def test_negociacion_del_precio_sin_requisito_pasa_a_contexto():
    st = _estado([{"vector": "otro", "descripcion": "La oferta del primer lugar excedía el presupuesto reservado y se negoció su reducción; el acta no registra los pasos."}],
                 calificados=1)
    quitadas = depurar_banderas_legales(st)
    assert quitadas and quitadas[0]["motivo"] == "contexto: irregularidad del trámite que no toca un requisito ni una especificación"
