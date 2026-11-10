"""Catálogos VTEX consultados directo (sin el Worker): el precio del vendedor con stock, no el de `sellers[0]`, y la
búsqueda con espacios como %20. Fixture: respuestas reales recortadas (Plaza Vea y Shopstar, 2026-11-10)."""
import json
from pathlib import Path

from tools.market import catalogos

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "vtex_vendedores.json").read_text(encoding="utf-8"))
PLAZA_VEA = "https://www.plazavea.com.pe"


def test_vendedor_del_marketplace_y_no_sellers_0():
    ps = catalogos.productos_vtex(FIXTURE, PLAZA_VEA)
    # 1.º Plaza Vea (Intelligent Search): Plaza Vea con 0 primero, GRUPO TECH con el precio. 2.º Shopstar: el 1.er SKU
    # agotado en todos sus vendedores, el 2.º con Sell Y Trade. 3.º vendedor del marketplace primero. 4.º solo Plaza
    # Vea en 0 y sin stock: fuera.
    assert [(p["precio"], p["vendedor"]) for p in ps] == [(265, "GRUPO TECH"), (429, "Sell Y Trade SAC"), (30.0, "FENIX IMPORT PERU")]
    assert ps[0]["url"] == PLAZA_VEA + "/toner-hp-85a-ce285a-l-j-p1102-negro-1600pg-102157291/p"     # `link` relativo
    assert ps[2]["url"].startswith("https://www.plazavea.com.pe/papel-hoja-bond")                       # ya absoluto
    assert ps[0]["tienda"] == "plazavea.com.pe" and ps[0]["unidad_medida"] == "un"
    # Intelligent Search entrega {"products": [...]}: la misma lectura.
    assert catalogos.productos_vtex({"products": FIXTURE}, PLAZA_VEA) == ps


def test_menor_precio_entre_vendedores_con_stock_y_rango_de_precios():
    oferta = lambda precio, stock: {"commertialOffer": {"Price": precio, "ListPrice": precio, "AvailableQuantity": stock}}
    p = {"productName": "Casco", "link": "/casco/p", "items": [{"sellers": [
        {"sellerName": "A", **oferta(50, 5)}, {"sellerName": "B", **oferta(40, 0)}, {"sellerName": "C", **oferta(45, 2)}]}]}
    assert [(x["precio"], x["vendedor"]) for x in catalogos.productos_vtex([p], PLAZA_VEA)] == [(45, "C")]
    sin_ofertas = {"productName": "X", "link": "/x/p", "items": [{"itemId": "1"}], "priceRange": {"sellingPrice": {"lowPrice": 12.5}}}
    assert [x["precio"] for x in catalogos.productos_vtex([sin_ofertas], PLAZA_VEA)] == [12.5]
    assert catalogos.productos_vtex([{**sin_ofertas, "advertisement": {"adId": "1"}}], PLAZA_VEA) == []   # patrocinado
    assert catalogos.productos_vtex({"error": "x"}, PLAZA_VEA) == [] and catalogos.productos_vtex(None, PLAZA_VEA) == []


def test_busqueda_directa_con_espacios_como_20(monkeypatch):
    import httpx
    vistos = {}

    class _R:
        status_code = 200

        @staticmethod
        def json():
            return FIXTURE

    def _get(url, headers, timeout):
        vistos.update(url=url, headers=headers)
        return _R()

    monkeypatch.setattr(httpx, "get", _get)
    ps = catalogos._de_tienda(PLAZA_VEA, "papel bond a4 80 g")
    assert "ft=papel%20bond%20a4%2080%20g&" in vistos["url"] and "+" not in vistos["url"]
    assert vistos["headers"]["User-Agent"].startswith("Mozilla/5.0 (Windows") and "@" not in str(vistos["headers"])
    assert len(ps) == 3


def test_candidatos_del_worker_con_vendedor_sin_patrocinados(monkeypatch):
    monkeypatch.setattr(catalogos, "_worker", lambda ruta, params: {"productos": [
        {"producto": "Toner HP 85A", "precio": 399, "tienda": "falabella.com.pe", "vendedor": "Sell Trade", "patrocinado": False, "url": "https://f/1"},
        {"producto": "Toner patrocinado", "precio": 300, "tienda": "ripley.com.pe", "patrocinado": True, "url": "https://r/2"},
        {"producto": "Toner de antes", "precio": 410, "tienda": "promart.pe", "url": "https://p/3"}]})   # caché sin los campos nuevos
    c = catalogos.candidatos("toner hp 85a")
    assert [(x["tienda"], x["vendedor"]) for x in c] == [("falabella.com.pe", "Sell Trade"), ("promart.pe", None)]


def test_tiendas_directas_incluyen_las_vtex_nuevas():
    assert {"https://www.shopstar.pe", "https://www.estilos.com.pe", "https://www.carsa.pe"} <= set(catalogos.TIENDAS)
