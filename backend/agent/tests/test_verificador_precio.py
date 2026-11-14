"""El verificador de sobreprecios (tools/market/verificador.py): guardas en código y la revisión del modelo."""
from tools.market import verificador as V


def _obs(precio, dominio="tienda-a.pe", origen="catalogo_tienda", producto="Producto"):
    return {"producto": producto, "precio": precio, "unidad": "UNIDAD", "dominio": dominio, "origen": origen}


def _hallazgo(pactado, precios, veredicto="elevado", **extra):
    return {"item_numero": "1", "item_descripcion": "ITEM", "unidad": "UNIDAD", "cantidad": 10, "veredicto": veredicto,
            "precio_unitario_ofertado": pactado, "precio_mediana_mercado": sorted(p["precio"] for p in precios)[len(precios) // 2],
            "diff_pct": 80.0, "diff_fuente": "retail", "precios_observados": precios, **extra}


def test_pocas_observaciones_o_una_sola_tienda_no_sostienen_un_sobreprecio():
    assert "al menos" in V.guardas(_hallazgo(100, [_obs(50), _obs(52, "tienda-b.pe")]))
    assert "una sola tienda" in V.guardas(_hallazgo(100, [_obs(50), _obs(52), _obs(55)]))


def test_precios_muy_dispersos_o_pactado_dentro_del_rango_no_son_sobreprecio():
    dispersos = [_obs(29.9), _obs(60, "b.pe"), _obs(259, "c.pe")]
    assert "productos distintos" in V.guardas(_hallazgo(300, dispersos))
    en_rango = [_obs(49.9), _obs(55.96, "b.pe"), _obs(119.9, "c.pe")]
    assert "dentro del rango" in V.guardas(_hallazgo(92, en_rango))
    assert V.guardas(_hallazgo(200, en_rango)) is None


def _grifo(precio, etiqueta, n=184):
    return _obs(precio, "osinergmin.gob.pe", "osinergmin", f"DIESEL B5 S-50 · Osinergmin, {etiqueta} de {n} declaraciones (LIMA, ámbito departamento)")


def test_combustible_contra_los_grifos_vale_con_declaraciones_y_sobre_el_percentil_75():
    grifos = [_grifo(17.74, "percentil 25"), _grifo(19.85, "mediana"), _grifo(22.38, "percentil 75")]
    assert V.guardas(_hallazgo(26.99, grifos, item_descripcion="DIESEL B5 S-50")) is None
    assert "percentil 75" in V.guardas(_hallazgo(24.0, grifos, item_descripcion="DIESEL B5 S-50"))
    pocos = [_grifo(17.74, "percentil 25", 3), _grifo(19.85, "mediana", 3), _grifo(22.38, "percentil 75", 3)]
    assert "declaraciones" in V.guardas(_hallazgo(26.99, pocos, item_descripcion="DIESEL B5 S-50"))
    assert "naval" in V.guardas(_hallazgo(28.0, grifos, item_descripcion="COMBUSTIBLE DIÉSEL F-76 PARA UNIDADES NAVALES"))


def test_un_precio_pactado_mal_tomado_o_una_diferencia_enorme_no_son_sobreprecio():
    tiendas = [_obs(50), _obs(52, "b.pe"), _obs(55, "c.pe")]
    assert "valor referencial" in V.guardas(_hallazgo(6.21, tiendas, precio_unitario_referencial=0.30))
    assert "total del contrato" in V.guardas(_hallazgo(900, tiendas, cantidad=100), {"total_ofertado": 5000})
    assert "casi siempre" in V.guardas(_hallazgo(2000, tiendas, diff_pct=3700.0))
    assert "lote" in V.guardas(_hallazgo(21734, tiendas, cantidad=12, item_descripcion="VÍVERES PARA EL COMEDOR"))


def test_el_mismo_precio_repetido_es_una_sola_observacion():
    repetidos = [_obs(50), _obs(50), _obs(50), _obs(52, "b.pe")]
    assert "al menos" in V.guardas(_hallazgo(120, repetidos))


def test_otras_compras_del_estado_valen_si_describen_el_mismo_bien():
    def ref(precio, ocid, solape=0.8):
        return {"descripcion": "TUBO ENDOTRAQUEAL N 7", "precio_unitario": precio, "ocid": ocid, "solape_raices": solape, "unidad": "Unidad"}
    base = {"item_numero": "1", "item_descripcion": "TUBO ENDOTRAQUEAL", "unidad": "Unidad", "cantidad": 100, "veredicto": "muy_elevado",
            "precio_unitario_ofertado": 8.69, "diff_pct": 99.0, "diff_fuente": "ancla_regional"}
    buenas = [ref(3.9, "a"), ref(4.35, "b"), ref(4.69, "c")]
    assert V.guardas({**base, "referencias_internas": buenas}) is None
    assert "mismo bien" in V.guardas({**base, "referencias_internas": [ref(3.9, "a"), ref(4.35, "b", 0.2), ref(4.69, "c", 0.1)]})
    assert "un solo proceso" in V.guardas({**base, "referencias_internas": [ref(3.9, "a"), ref(4.35, "a"), ref(4.69, "a")]})
    assert "bienes distintos" in V.guardas({**base, "referencias_internas": [ref(1.0, "a"), ref(4.35, "b"), ref(6.0, "c")]})
    assert "dentro de lo que pagaron" in V.guardas({**base, "precio_unitario_ofertado": 4.5, "referencias_internas": buenas})


def test_el_modelo_decide_y_lo_no_comparable_pasa_a_no_verificable(monkeypatch):
    tiendas = [_obs(50), _obs(52, "b.pe"), _obs(55, "c.pe")]
    f1 = _hallazgo(120, tiendas, item_numero="1", item_descripcion="CASCO CERTIFICADO")
    f2 = _hallazgo(120, tiendas, item_numero="2", item_descripcion="DIESEL")
    f3 = _hallazgo(120, tiendas, veredicto="alineado", item_numero="3")
    state = {"market_analysis": {"findings": [f1, f2, f3], "veredicto_global": "elevado", "sobreprecio_pct": 40.0},
             "market_input": {"items": [{"numero": "1", "requerimiento_tecnico_detallado": "casco con certificación ANSI Z89.1"}]}}
    visto = {}

    def _falso(items):
        visto["items"] = items
        return [{"label": "no_comparable", "reason": "casco certificado contra casco básico"},
                {"label": "comparable", "reason": "mismo bien y unidad"}]

    monkeypatch.setattr(V, "_preguntar", _falso)
    r = V.verificar_sobreprecios(state)
    assert r["revisados"] == 2 and r["confirmados"] == 1 and len(r["degradados"]) == 1
    assert "ANSI" in visto["items"][0]["especificaciones"]
    fs = state["market_analysis"]["findings"]
    assert fs[0]["veredicto"] == "no_verificable" and fs[0]["veredicto_original"] == "elevado"
    assert fs[1]["veredicto"] == "elevado" and fs[1]["verificacion_precio"]["comparable"] is True
    assert fs[2]["veredicto"] == "alineado"
    ma = state["market_analysis"]
    assert ma["veredicto_global"] == "no_verificable" and ma["sobreprecio_pct"] is None   # el lote incluía el degradado
    assert any(d.get("donde") == "market.verificador_precio" for d in state.get("descartes") or [])


def test_sin_respuesta_del_modelo_solo_queda_lo_moderado_con_unidad_comprobada(monkeypatch):
    def con_unidad(precio, dominio):
        return {**_obs(precio, dominio), "normalizacion": {"regla": "misma_unidad"}}
    comprobados = [con_unidad(50, "a.pe"), con_unidad(52, "b.pe"), con_unidad(55, "c.pe")]
    asumidos = [_obs(50), _obs(52, "b.pe"), _obs(55, "c.pe")]
    moderado = _hallazgo(75, comprobados, diff_pct=44.0)
    grande = _hallazgo(120, comprobados, item_numero="2", diff_pct=130.0)
    sin_unidad = _hallazgo(75, asumidos, item_numero="3", diff_pct=44.0)
    state = {"market_analysis": {"findings": [moderado, grande, sin_unidad]}}
    monkeypatch.setattr(V, "_preguntar", lambda items: [{"label": None, "reason": "no evaluado"}] * len(items))
    r = V.verificar_sobreprecios(state)
    fs = state["market_analysis"]["findings"]
    assert [x["veredicto"] for x in fs] == ["elevado", "no_verificable", "no_verificable"] and r["sin_juez"] == 3


def test_sin_unidad_comprobada_lo_mas_que_se_afirma_es_elevado(monkeypatch):
    asumidos = [_obs(50), _obs(52, "b.pe"), _obs(55, "c.pe")]
    f = _hallazgo(120, asumidos, veredicto="muy_elevado", diff_pct=130.0)
    state = {"market_analysis": {"findings": [f]}}
    monkeypatch.setattr(V, "_preguntar", lambda items: [{"label": "comparable", "reason": "mismo bien"}])
    V.verificar_sobreprecios(state)
    assert state["market_analysis"]["findings"][0]["veredicto"] == "elevado"


def test_sin_sobreprecios_no_hace_nada():
    state = {"market_analysis": {"findings": [{"veredicto": "alineado"}], "veredicto_global": "alineado"}}
    assert V.verificar_sobreprecios(state)["revisados"] == 0 and "verificacion_precio" not in state["market_analysis"]
