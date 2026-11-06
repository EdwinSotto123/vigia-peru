from tools.persistence.shared import puntaje_de


def _b(regla, sev, agente="compliance_agent", puntua=True):
    return {"regla": regla, "severidad": sev, "agente_origen": agente, "puntua": puntua}


def test_la_misma_oferta_no_cuenta_dos_veces():
    # 1228227 sin la falsa señal del giro: único postor (35) + oferta = referencial (35, cuenta la mitad) + concentración (18).
    b = [_b("unico_postor_alto", "alta"), _b("oferta_igual_valor_referencial", "alta"), _b("concentracion_entidad", "media")]
    assert puntaje_de(b) == 70
    # Una sola de las dos: suma entera.
    assert puntaje_de([_b("oferta_igual_valor_referencial", "alta"), _b("concentracion_entidad", "media")]) == 53


def test_tope_y_hechos_neutros():
    b = [_b("unico_postor_alto", "alta"), _b("tipo_proceso_vs_monto", "alta"), _b("ruc_ganador_muy_nuevo", "alta"),
         _b("ciiu_vs_objeto", "media"), _b("sancion_historica_oece", "baja", puntua=False)]
    assert puntaje_de(b) == 100
