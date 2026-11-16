from tools.personas.visitas_clasificar import clasificar_visita, resumir_visitas

BUYER = "MUNICIPALIDAD DISTRITAL DE LAS AMAZONAS"
GAN = "CONSTRUCTORA Y CONSULTORA PUSAY S.A.C."


def _v(**kw):
    base = {"dni": "12345678", "match_score": 1.0, "entidad_visitada": "CONGRESO DE LA REPUBLICA",
            "entidad_visitante": "MUNICIPALIDAD PROVINCIAL DE ALTO AMAZONAS", "motivo": "Reunión de trabajo",
            "fecha": "2026-03-02", "funcionario": "X"}
    base.update(kw)
    return base


def test_visita_al_congreso_de_un_funcionario_municipal_es_institucional_no_vinculo():
    c = clasificar_visita(_v(), entidad_contratante=BUYER, ganador_razon=GAN)
    assert c["categoria"] == "institucional"


def test_visita_a_la_entidad_contratante_es_relevante():
    c = clasificar_visita(_v(entidad_visitada="MUNICIPALIDAD DISTRITAL DE LAS AMAZONAS"),
                          entidad_contratante=BUYER, ganador_razon=GAN)
    assert c["categoria"] == "relevante"


def test_motivo_que_menciona_al_ganador_es_relevante():
    c = clasificar_visita(_v(motivo="Presentar propuesta Constructora Pusay para la obra"),
                          entidad_contratante=BUYER, ganador_razon=GAN)
    assert c["categoria"] == "relevante"


def test_coincidencia_aproximada_por_nombre_se_descarta():
    c = clasificar_visita(_v(dni=None, match_score=0.62, entidad_visitada=BUYER),
                          entidad_contratante=BUYER, ganador_razon=GAN)
    assert c["categoria"] == "descartada"


def test_resumen_solo_detalla_relevantes():
    r = resumir_visitas({"A": [_v(), _v(entidad_visitada=BUYER)], "B": [_v(dni=None, match_score=0.5)]},
                        entidad_contratante=BUYER, ganador_razon=GAN)
    assert r["n_relevantes"] == 1 and r["n_institucionales"] == 1 and r["n_descartadas"] == 1


def test_la_visita_de_alguien_de_la_propia_entidad_no_es_relevante():
    # Un miembro del comité que «visita» su propia entidad: es su lugar de trabajo (dictamen 1231028, 2026-11-16).
    propia = _v(entidad_visitada=BUYER)
    assert clasificar_visita(propia, entidad_contratante=BUYER, ganador_razon=GAN, es_de_la_entidad=True)["categoria"] == "institucional"
    # O el registro dice que venía en representación de la misma entidad.
    c = clasificar_visita(_v(entidad_visitada=BUYER, entidad_visitante="MUNICIPALIDAD DISTRITAL DE LAS AMAZONAS (MDLA)"),
                          entidad_contratante=BUYER, ganador_razon=GAN)
    assert c["categoria"] == "institucional" and "propia entidad" in c["razon"]


def test_una_visita_de_hace_mas_de_dos_anios_no_es_relevante():
    vieja = _v(entidad_visitada=BUYER, fecha="2022-05-16")
    assert clasificar_visita(vieja, entidad_contratante=BUYER, ganador_razon=GAN, fecha_referencia="2026-11-10")["categoria"] == "institucional"
    assert clasificar_visita(_v(entidad_visitada=BUYER, fecha="2026-05-22"), entidad_contratante=BUYER, ganador_razon=GAN,
                             fecha_referencia="2026-11-10")["categoria"] == "relevante"
    # Sin fecha legible, se queda como estaba.
    assert clasificar_visita(_v(entidad_visitada=BUYER, fecha=None), entidad_contratante=BUYER, ganador_razon=GAN,
                             fecha_referencia="2026-11-10")["categoria"] == "relevante"


def test_resumen_separa_a_la_gente_de_la_entidad_de_la_del_proveedor():
    visitas = {"ALAIN EDUARDO QUISPEMAYTA HUAMANCHUMO": [_v(entidad_visitada=BUYER)],      # miembro del comité
               "ROBERTINO CCAHUANA TICONA": [_v(entidad_visitada=BUYER)]}                  # gente del proveedor
    r = resumir_visitas(visitas, entidad_contratante=BUYER, ganador_razon=GAN, fecha_referencia="2026-11-10",
                        personas_de_la_entidad=["QUISPEMAYTA HUAMANCHUMO ALAIN EDUARDO"])  # el acta lo escribe en otro orden
    assert r["n_relevantes"] == 1 and r["n_institucionales"] == 1
    assert r["relevantes"][0]["persona"] == "ROBERTINO CCAHUANA TICONA"
