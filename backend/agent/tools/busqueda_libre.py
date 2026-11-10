"""
Búsqueda web gratis y sin claves (BUSQUEDA_PROVEEDOR=libre, el de defecto desde 2026-11-10): sin Claude ni APIs pagas.

  · Resultados web: DuckDuckGo HTML (POST html.duckduckgo.com/html/, kl=pe-es). Los mejores resultados generales (fichas
    de RUC, portales de compras, notas de gob.pe, tiendas), pero sin fecha y con tope: un pedido cada DDG_ESPACIO_S (8 s)
    como mínimo para todo el proceso; si responde 202 («bots use DuckDuckGo too») se pausa DDG_PAUSA_S (10 min).
  · Noticias con fecha: Bing News RSS (bing.com/news/search?format=rss, cc=PE). Responde también desde servidores
    (Cloudflare y AWS); la URL real va en el parámetro `url=` del enlace.

Medido el 2026-11-10 desde el Perú y desde Cloudflare (scratchpad busqueda/): Google News RSS es el mejor para prensa pero
Cloudflare lo bloquea (tools/prensa.py lo usa primero y cae a Bing); Mojeek, Brave, Startpage y la API de Mercado Libre
piden captcha o token; SearXNG en un servidor terminaría usando sólo Bing.
"""
from __future__ import annotations

import asyncio
import email.utils
import html as H
import os
import re
import time
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, unquote, urlparse

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "es-PE,es;q=0.9",
}
DDG = "https://html.duckduckgo.com/html/"
BING_NOTICIAS = "https://www.bing.com/news/search"
ESPACIO_DDG_S = float(os.getenv("DDG_ESPACIO_S", "8"))
PAUSA_DDG_S = float(os.getenv("DDG_PAUSA_S", "600"))

_estado = {"ultimo": 0.0, "bloqueado_hasta": 0.0}
_candados: dict[int, asyncio.Lock] = {}


def _candado() -> asyncio.Lock:
    """Un candado por bucle de eventos (ADK corre en uno; las pruebas, en otros)."""
    bucle = asyncio.get_running_loop()
    return _candados.setdefault(id(bucle), asyncio.Lock())


def _txt(s: str | None) -> str:
    return " ".join(H.unescape(re.sub(r"<[^>]+>", " ", s or "")).split())


def parsear_ddg(texto: str) -> list[dict]:
    """La página de resultados de DuckDuckGo HTML → [{titulo, url, extracto, fecha}] (sin anuncios)."""
    out = []
    for blk in re.split(r'<div class="result results_links', texto)[1:]:
        if "result--ad" in blk[:200]:
            continue
        a = re.search(r'class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', blk, re.S)
        if not a:
            continue
        url = H.unescape(a.group(1))
        if "duckduckgo.com/l/?" in url:
            url = unquote(parse_qs(urlparse(url if url.startswith("http") else "https:" + url).query).get("uddg", [url])[0])
        if "duckduckgo.com/y.js" in url or not url.startswith("http"):
            continue
        sn = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', blk, re.S)
        out.append({"titulo": _txt(a.group(2)), "url": url, "extracto": _txt(sn.group(1) if sn else "")[:400], "fecha": None})
    return out


def parsear_rss_bing(contenido: bytes) -> list[dict]:
    """El RSS de Bing News → [{titulo, url, extracto, fecha (AAAA-MM-DD), medio}], con la URL real del medio."""
    out = []
    for it in ET.fromstring(contenido).findall(".//item"):
        enlace = it.findtext("link") or ""
        real = parse_qs(urlparse(enlace).query).get("url", [enlace])[0] if "bing.com" in enlace else enlace
        medio = next(((ch.text or "").strip() for ch in it if ch.tag.endswith("Source") or ch.tag == "source"), "")
        fecha = None
        try:
            fecha = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "").strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            pass
        if real.startswith("http"):
            out.append({"titulo": _txt(it.findtext("title")), "url": real, "extracto": _txt(it.findtext("description"))[:400],
                        "fecha": fecha, "medio": medio})
    return out


async def ddg(cli, consulta: str, n: int = 8) -> list[dict] | None:
    """Resultados web de DuckDuckGo, respetando el espacio entre pedidos. None si está en pausa o bloqueó."""
    async with _candado():
        ahora = time.monotonic()
        if ahora < _estado["bloqueado_hasta"]:
            return None
        espera = _estado["ultimo"] + ESPACIO_DDG_S - ahora
        if espera > 0:
            await asyncio.sleep(espera)
        try:
            r = await cli.post(DDG, data={"q": consulta, "kl": "pe-es"}, headers=UA)
        finally:
            _estado["ultimo"] = time.monotonic()
        if r.status_code == 202 or r.status_code == 403 or "bots use DuckDuckGo" in r.text[:3000]:
            _estado["bloqueado_hasta"] = time.monotonic() + PAUSA_DDG_S
            return None
        if r.status_code >= 400:
            return None
        return parsear_ddg(r.text)[:n]


async def bing_noticias(cli, consulta: str, n: int = 8) -> list[dict]:
    r = await cli.get(BING_NOTICIAS, params={"q": consulta, "format": "rss", "cc": "PE", "setlang": "es", "mkt": "es-PE"}, headers=UA)
    if r.status_code >= 400 or not r.content:
        return []
    try:
        return parsear_rss_bing(r.content)[:n]
    except ET.ParseError:
        return []


async def buscar(consulta: str, n: int | None = None) -> dict:
    """Web (DuckDuckGo) y noticias (Bing News) juntas, sin repetir URL: {resultados, fuentes_usadas, avisos}."""
    import httpx

    n = n or int(os.getenv("BUSQUEDA_N_RESULTADOS", "8"))
    avisos, usadas = [], []
    async with httpx.AsyncClient(timeout=float(os.getenv("BUSQUEDA_TIMEOUT_S", "30")), follow_redirects=True) as cli:
        web, noticias = await asyncio.gather(ddg(cli, consulta, n), bing_noticias(cli, consulta, max(3, n // 2)), return_exceptions=True)
    if isinstance(web, Exception) or web is None:
        avisos.append("DuckDuckGo no respondió o está en pausa: sólo noticias")
        web = []
    else:
        usadas.append("duckduckgo")
    if isinstance(noticias, Exception):
        avisos.append(f"Bing News falló: {type(noticias).__name__}")
        noticias = []
    elif noticias:
        usadas.append("bing_news")
    vistos, resultados = set(), []
    for x in [*web, *noticias]:
        if x["url"] not in vistos:
            vistos.add(x["url"])
            resultados.append(x)
    return {"resultados": resultados[: n + max(3, n // 2)], "fuentes_usadas": usadas, "avisos": avisos}
