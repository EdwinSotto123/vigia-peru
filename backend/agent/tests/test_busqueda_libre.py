"""La búsqueda gratis (tools/busqueda_libre.py): parsers de DuckDuckGo HTML y Bing News RSS, el espacio entre pedidos
y la pausa cuando DuckDuckGo bloquea, y google_search con BUSQUEDA_PROVEEDOR=libre."""
import asyncio

from tools import busqueda, busqueda_libre as bl

DDG_HTML = """
<div class="result results_links results_links_deep result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Anuncio</a></div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.gob.pe%2Finstitucion%2Fcontraloria%2Fnoticias%2F123&amp;rut=x">Contraloría &amp; el <b>hospital</b></a>
  <a class="result__snippet" href="#">Informe de control al <b>Hospital</b> Regional.</a>
</div>"""

BING_RSS = b"""<?xml version="1.0" encoding="utf-8"?><rss xmlns:News="https://www.bing.com/news/search?q=x&amp;format=rss" version="2.0"><channel>
<item><title>Fiscal&#237;a investiga contrato</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2felcomercio.pe%2fnota-1&amp;c=1</link>
<description>La Fiscal&#237;a abri&#243; investigaci&#243;n.</description><pubDate>Mon, 09 Nov 2026 14:00:00 GMT</pubDate><News:Source>El Comercio</News:Source></item>
</channel></rss>"""


def test_parsear_ddg_sin_anuncios_y_con_la_url_real():
    r = bl.parsear_ddg(DDG_HTML)
    assert len(r) == 1
    assert r[0]["url"] == "https://www.gob.pe/institucion/contraloria/noticias/123"
    assert r[0]["titulo"] == "Contraloría & el hospital"
    assert "Hospital Regional" in r[0]["extracto"]


def test_parsear_rss_bing_url_del_medio_fecha_y_medio():
    r = bl.parsear_rss_bing(BING_RSS)
    assert r == [{"titulo": "Fiscalía investiga contrato", "url": "https://elcomercio.pe/nota-1", "extracto": "La Fiscalía abrió investigación.",
                  "fecha": "2026-11-09", "medio": "El Comercio"}]


class _Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text, self.content = status, text, text.encode()


class _Cli:
    def __init__(self, respuestas):
        self.respuestas, self.posts = list(respuestas), 0

    async def post(self, *a, **k):
        self.posts += 1
        return self.respuestas.pop(0)


def test_ddg_espacia_los_pedidos_y_se_pausa_si_bloquea(monkeypatch):
    monkeypatch.setattr(bl, "ESPACIO_DDG_S", 0.2)
    monkeypatch.setattr(bl, "PAUSA_DDG_S", 60)
    bl._estado.update(ultimo=0.0, bloqueado_hasta=0.0)

    async def correr():
        cli = _Cli([_Resp(200, DDG_HTML), _Resp(202, "bots use DuckDuckGo too"), _Resp(200, DDG_HTML)])
        t0 = asyncio.get_running_loop().time()
        a = await bl.ddg(cli, "q1")
        b = await bl.ddg(cli, "q2")
        c = await bl.ddg(cli, "q3")          # en pausa: no pide
        return a, b, c, cli.posts, asyncio.get_running_loop().time() - t0

    a, b, c, posts, dur = asyncio.run(correr())
    assert len(a) == 1 and b is None and c is None
    assert posts == 2
    assert dur >= 0.2
    bl._estado.update(ultimo=0.0, bloqueado_hasta=0.0)


def test_google_search_libre_publica_las_urls(monkeypatch):
    monkeypatch.setenv("BUSQUEDA_PROVEEDOR", "libre")

    async def falso(consulta, n=None):
        return {"resultados": [{"titulo": "Nota", "url": "https://elcomercio.pe/nota-1", "extracto": "x", "fecha": "2026-11-09"}],
                "fuentes_usadas": ["bing_news"], "avisos": ["DuckDuckGo no respondió o está en pausa: sólo noticias"]}

    monkeypatch.setattr(bl, "buscar", falso)

    class Ctx:
        state: dict = {}

    ctx = Ctx()
    r = asyncio.run(busqueda.google_search("contrato", ctx))
    assert r["fuentes"] == [{"titulo": "Nota", "url": "https://elcomercio.pe/nota-1", "fecha": "2026-11-09"}]
    assert "elcomercio.pe/nota-1" in r["resumen"] and r["avisos"]
    assert ctx.state["grounding_urls"] == ["https://elcomercio.pe/nota-1"]


def test_ddg_que_no_contesta_se_pausa_y_los_siguientes_no_esperan(monkeypatch):
    """PROD 2026-11-13: desde AWS DuckDuckGo no contesta y cada búsqueda esperaba ~24 s en fila."""
    monkeypatch.setattr(bl, "ESPACIO_DDG_S", 0.0)
    monkeypatch.setattr(bl, "TIEMPO_DDG_S", 0.05)
    monkeypatch.setattr(bl, "PAUSA_DDG_S", 60)
    bl._estado.update(ultimo=0.0, bloqueado_hasta=0.0)

    class _Colgado:
        posts = 0

        async def post(self, *a, **k):
            self.posts += 1
            await asyncio.sleep(5)

    async def correr():
        cli = _Colgado()
        t0 = asyncio.get_running_loop().time()
        r = [await bl.ddg(cli, f"q{i}") for i in range(4)]
        return r, cli.posts, asyncio.get_running_loop().time() - t0

    r, posts, dt = asyncio.run(correr())
    bl._estado.update(ultimo=0.0, bloqueado_hasta=0.0)
    assert r == [None] * 4 and posts == 1 and dt < 1
