"""Prensa pre-cargada (Google News) y precios de catálogo de tiendas: las piezas que no salen a la red."""
from tools import prensa
from tools.market import catalogos


def test_nombre_nucleo_y_consultas():
    assert prensa.nombre_nucleo("FIERRO DOMINIC S.A.C.") == "FIERRO DOMINIC"
    qs = prensa.consultas("FIERRO DOMINIC S.A.C.", "GOBIERNO REGIONAL DE CUSCO SEDE CENTRAL", ["JUAN PEREZ"])
    assert qs[0] == ('"FIERRO DOMINIC"', "proveedor", "FIERRO DOMINIC")
    assert qs[1][0].startswith('"Gobierno Regional de Cusco" Perú') and qs[1][1] == "entidad"
    assert qs[2] == ('"JUAN PEREZ"', "persona", "JUAN PEREZ")
    # Nombre de una sola palabra: solo la razón social completa (si no, cualquier nota del rubro).
    assert prensa.consultas("GASOLINERAS S.A.C.", "")[0][0] == '"GASOLINERAS S.A.C."'


def test_entidad_como_la_nombra_la_prensa():
    assert prensa.nombre_entidad_prensa("MUNICIPALIDAD DISTRITAL DE SAN MARTIN DE PORRES") == "Municipalidad de San Martin de Porres"
    assert prensa.nombre_entidad_prensa("GOBIERNO REGIONAL DE CUSCO SEDE CENTRAL") == "Gobierno Regional de Cusco"
    assert prensa.nombre_entidad_prensa("Ministerio Público") == "Ministerio Público"


def test_menciona_exige_el_nombre():
    nota = {"titulo": "Las gasolineras más baratas de Lima", "extracto": ""}
    assert not prensa._menciona(nota, "GASOLINERAS S.A.C.")
    assert prensa._menciona({"titulo": "Contraloría observa a Gasolineras SAC", "extracto": ""}, "GASOLINERAS S.A.C.")
    assert prensa._menciona({"titulo": "Allanan a Fierro Dominic", "extracto": ""}, "FIERRO DOMINIC S.A.C.")


def test_texto_de_la_nota():
    html = "<html><nav><p>Menú de navegación con muchos enlaces y más texto de relleno aquí</p></nav>" \
           "<p>La Contraloría halló irregularidades en la compra de combustible por S/ 2 millones en 2026.</p>" \
           "<p>corto</p><script>var x='<p>no</p>';</script></html>"
    assert prensa._texto(html) == "La Contraloría halló irregularidades en la compra de combustible por S/ 2 millones en 2026."


def test_termino_de_busqueda_de_catalogo():
    assert catalogos.termino_busqueda("CASCO DE SEGURIDAD tipo jockey con arnés, según especificaciones técnicas") == "casco seguridad jockey arnes"


def test_precios_de_catalogo_con_juez(monkeypatch):
    cands = [{"producto": "Casco de seguridad blanco", "marca": "X", "precio": 14.9, "tienda": "promart.pe", "url": "https://p/1"},
             {"producto": "Pack 2 cascos de seguridad", "marca": "Y", "precio": 30.0, "tienda": "oechsle.pe", "url": "https://o/2"},
             {"producto": "Linterna", "marca": "Z", "precio": 9.0, "tienda": "metro.pe", "url": "https://m/3"}]
    monkeypatch.setattr(catalogos, "candidatos", lambda termino: cands)
    monkeypatch.setattr(catalogos, "_juzgar", lambda items, c: {"1": [(cands[0], 1.0), (cands[1], 2.0)]})
    precios, info = catalogos.precios_de_catalogo([{"numero": "1", "descripcion_corta": "Casco de seguridad", "unidad": "Unidad"}])
    assert [p["precio"] for p in precios] == [14.9, 15.0]          # el pack de 2 se lleva a precio por unidad
    assert precios[0]["fuentes"][0]["uri"] == "https://p/1" and precios[0]["origen"] == "catalogo_tienda"
    assert info["candidatos"] == 3 and info["precios_elegidos"] == 2


def test_combustible_oficial_via_worker(monkeypatch):
    llamadas = []

    def worker(ruta, params):
        llamadas.append((ruta, params))
        return {"ambito": "departamento", "departamento": "LIMA",
                "estadistica": {"n": 203, "p25": 20.15, "mediana": 22.42, "p75": 25.03, "desde": "2026-06-19", "hasta": "2026-10-13"},
                "observaciones": [{"precio_min": 24, "precio_max": 25}], "fuente": {"url": "https://osinergmin/x.csv"}}

    monkeypatch.setattr(catalogos, "_worker", worker)
    items = [{"numero": "1", "descripcion_corta": "DIESEL B5 S-50"}, {"numero": "2", "descripcion_corta": "Casco"}]
    assert [catalogos.es_combustible(i) for i in items] == [True, False]
    precios, info = catalogos.precios_combustible(items, "LIMA")
    assert [p["precio"] for p in precios] == [20.15, 22.42, 25.03]                # p25, mediana, p75: no las 10 últimas
    assert all(p["unidad"] == "galón" and p["origen"] == "osinergmin" for p in precios)
    assert llamadas == [("/combustible", {"producto": "DIESEL B5 S-50", "departamento": "LIMA", "dias": 120})]
    assert info["items"] == 1 and info["estadisticas"]["1"]["n"] == 203


def test_departamento_y_candidatos_via_worker(monkeypatch):
    assert catalogos.departamento_de({"parties": [{"roles": ["supplier"]}, {"roles": ["buyer"], "address": {"region": "CUSCO"}}]}) == "CUSCO"
    monkeypatch.setattr(catalogos, "_worker", lambda ruta, params: {"productos": [
        {"producto": "Casco", "marca": "X", "precio": 14.9, "tienda": "promart.pe", "url": "https://p/1"},
        {"producto": "Sin precio", "precio": 0, "tienda": "metro.pe", "url": "https://m/2"}]})
    c = catalogos.candidatos("casco")
    assert len(c) == 1 and c[0]["tienda"] == "promart.pe" and c[0]["precio"] == 14.9


def test_juez_recibe_certificaciones(monkeypatch):
    vistos = {}

    class _Resp:
        text = '{"items": []}'

    class _Cli:
        class models:
            @staticmethod
            def generate_content(model, contents, config):
                vistos["prompt"] = contents
                return _Resp()

    import tools._core as core
    monkeypatch.setattr(core, "_gemini_client", lambda: _Cli())
    catalogos._juzgar([{"numero": "1", "descripcion_corta": "Casco", "certificaciones_exigidas": ["ANSI/ISEA Z89.1-2014"]}],
                      {"1": [{"producto": "Casco básico", "precio": 7.0}]})
    assert "ANSI/ISEA Z89.1-2014" in vistos["prompt"] and "ante la duda, no elijas" in vistos["prompt"]


def test_herramienta_de_precios(monkeypatch):
    from tools.market import precio_tool
    monkeypatch.setattr(catalogos, "_worker", lambda ruta, params: {"termino": "papaya x kg", "productos": [
        {"producto": "Papaya x kg", "precio": 5.69, "tienda": "metro.pe", "unidad_medida": "kg", "url": "https://m/1"},
        {"producto": "Papaya en trozos 300 g", "precio": 7.7, "tienda": "plazavea.com.pe", "unidad_medida": "un", "url": "https://p/2"}]})
    ctx = type("C", (), {"state": {}})()
    r = precio_tool.consultar_precios_referencia("papaya x kg", tool_context=ctx)
    assert [p["por_peso"] for p in r["productos"]] == [True, False]
    assert ctx.state["grounding_urls"] == ["https://m/1", "https://p/2"]      # quedan como respaldadas
    monkeypatch.setattr(catalogos, "_worker", lambda ruta, params: None)
    assert "no configurado" in precio_tool.consultar_precios_referencia("x")["error"]


def test_precios_mayorista(monkeypatch):
    llamadas = []

    def worker(ruta, params):
        llamadas.append(params["q"])
        if params["q"] == "naranja valencia":
            return {"variedades": []}
        return {"variedades": [
            {"variedad": "NARANJA HUANDO", "n_dias": 30, "p25": 1.0, "mediana": 1.1, "p75": 1.2},
            {"variedad": "NARANJA VALENCIA (SELVA)", "n_dias": 25, "p25": 1.1, "mediana": 1.15, "p75": 1.25}],
            "fuente": {"url": "https://emmsa/x"}}

    monkeypatch.setattr(catalogos, "_worker", worker)
    precios, info = catalogos.precios_mayorista([{"numero": "1.05", "descripcion_corta": "NARANJA VALENCIA CATEGORÍA EXTRA"}])
    assert llamadas == ["naranja valencia", "naranja"]                       # reintenta con la palabra principal
    assert info["variedades"]["1.05"]["variedad"] == "NARANJA VALENCIA (SELVA)"  # la que mejor coincide, no la de más días
    assert [p["precio"] for p in precios] == [1.1, 1.15, 1.25] and all(p["origen"] == "emmsa" and p["unidad"] == "kg" for p in precios)


def test_fecha_de_la_convocatoria_para_precios_pasados(monkeypatch):
    assert catalogos.fecha_convocatoria({"tender": {"tenderPeriod": {"startDate": "2024-08-17T09:00:00-05:00"}}}) == "2024-08-17"
    assert catalogos.fecha_convocatoria({"date": "2023-01-05T00:00:00Z", "tender": {}}) == "2023-01-05"
    assert catalogos.fecha_convocatoria({}) is None
    vistos = []
    monkeypatch.setattr(catalogos, "_worker", lambda ruta, params: vistos.append(params) or {"variedades": []})
    catalogos.precios_mayorista([{"numero": "1", "descripcion_corta": "LIMON"}], hasta="2024-08-17")
    assert vistos[0]["hasta"] == "2024-08-17"
