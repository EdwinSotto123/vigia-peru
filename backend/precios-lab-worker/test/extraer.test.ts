import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmarEnTexto, leerJsonLd, parsearDdg, leerMicrodatos, leerOpenGraph, leerPagina, numeroPrecio, robotsPermite, textoVisible } from "../src/extraer.ts";

test("numeroPrecio lee los formatos de las tiendas", () => {
  assert.equal(numeroPrecio("S/ 1,299.90"), 1299.9);
  assert.equal(numeroPrecio("1.299,90"), 1299.9);
  assert.equal(numeroPrecio("12,50"), 12.5);
  assert.equal(numeroPrecio("1,299"), 1299);
  assert.equal(numeroPrecio("S/ 25"), 25);
  assert.equal(numeroPrecio(19.9), 19.9);
  assert.equal(numeroPrecio("gratis"), null);
  assert.equal(numeroPrecio(0), null);
});

test("JSON-LD: Product con Offer, dentro de @graph", () => {
  const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},
    {"@type":"Product","name":"Papel bond A4 75 g","brand":{"@type":"Brand","name":"Atlas"},
     "offers":{"@type":"Offer","price":"21.90","priceCurrency":"PEN","availability":"https://schema.org/InStock"}}]}</script></html>`;
  const l = leerJsonLd(html)!;
  assert.equal(l.precio, 21.9);
  assert.equal(l.moneda, "PEN");
  assert.equal(l.marca, "Atlas");
  assert.equal(l.disponibilidad, "InStock");
  assert.equal(l.metodo, "json_ld");
});

test("JSON-LD: AggregateOffer usa lowPrice; JSON roto se salta", () => {
  const html = `<script type="application/ld+json">{roto</script>
    <script type='application/ld+json'>[{"@type":"Product","name":"Taladro","offers":{"@type":"AggregateOffer","lowPrice":199,"priceCurrency":"pen"}}]</script>`;
  const l = leerJsonLd(html)!;
  assert.equal(l.precio, 199);
  assert.equal(l.moneda, "PEN");
});

test("microdatos y Open Graph", () => {
  assert.equal(leerMicrodatos(`<span itemprop="price" content="45.50">S/ 45.50</span><meta itemprop="priceCurrency" content="PEN">`)!.precio, 45.5);
  const og = leerOpenGraph(`<meta property="og:title" content="Silla"><meta property="product:price:amount" content="89.00"><meta property="product:price:currency" content="PEN">`)!;
  assert.equal(og.precio, 89);
  assert.equal(og.titulo, "Silla");
  assert.equal(leerPagina("<html><body>sin precio</body></html>"), null);
});

test("confirmarEnTexto encuentra el precio en el texto visible", () => {
  const visible = textoVisible(`<div>Precio: S/ 1,299.90</div><script>var p = 9999;</script>`);
  assert.ok(confirmarEnTexto(1299.9, visible));
  assert.ok(!confirmarEnTexto(9999, visible));
  assert.ok(confirmarEnTexto(25, "Ahora S/ 25 antes S/ 30"));
  assert.ok(confirmarEnTexto(1299.9, "S/ 1.299,90"));
  assert.ok(!confirmarEnTexto(12.5, "S/ 112.50"));
});

test("robots.txt: reglas de User-agent *", () => {
  const r = `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /checkout\nDisallow: /buscar\nAllow: /buscar/ayuda\n`;
  assert.ok(robotsPermite(r, "/producto/123"));
  assert.ok(!robotsPermite(r, "/checkout/pagar"));
  assert.ok(!robotsPermite(r, "/buscar?q=x"));
  assert.ok(robotsPermite(r, "/buscar/ayuda"));
  assert.ok(robotsPermite("", "/x"));
  assert.ok(!robotsPermite("User-agent: *\nDisallow: /", "/x"));
});

test("DuckDuckGo HTML: resultados sin anuncios y con la URL real", () => {
  const html = `<div class="result results_links result--ad"><a class="result__a" href="https://anuncio">Anuncio</a></div>
    <div class="result results_links results_links_deep web-result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.tienda.pe%2Fpapel&amp;rut=x">Papel <b>bond</b> A4</a></h2>
    <a class="result__snippet" href="x">S/ 21.90 el paquete</a></div>`;
  const r = parsearDdg(html);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, "https://www.tienda.pe/papel");
  assert.equal(r[0].titulo, "Papel bond A4");
  assert.equal(r[0].extracto, "S/ 21.90 el paquete");
});

test("robots.txt con comodines, $ y grupos de otros agentes (caso MercadoLibre)", () => {
  const r = `User-agent: ClaudeBot\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: Bingbot\nCrawl-delay: 5\nDisallow: /HOME/\n\nUser-agent: *\nDisallow: /*www.siteinfo.cf\nDisallow: /*itemid\nDisallow: /recommendations*\nDisallow: /*.pdf$\nAllow: /p/\nSitemap: https://x/sitemap.xml\n`;
  assert.ok(robotsPermite(r, "/papel-bond-a4/p/MPE38627756"));
  assert.ok(robotsPermite(r, "/papel-bond-a4-75-gr"));
  assert.ok(!robotsPermite(r, "/algo/www.siteinfo.cf"));
  assert.ok(!robotsPermite(r, "/x?itemid=12"));
  assert.ok(!robotsPermite(r, "/recommendations/abc"));
  assert.ok(!robotsPermite(r, "/ficha.pdf"));
  assert.ok(robotsPermite(r, "/ficha.pdf?v=1"));
  assert.ok(!robotsPermite(r, "/p/x", "ClaudeBot"));
});
