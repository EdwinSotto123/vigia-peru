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
