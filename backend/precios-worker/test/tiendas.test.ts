/**
 * Tiendas nuevas (2026-11): VTEX con vendedores del marketplace e Intelligent Search, Falabella, Ripley, Hiraoka
 * (GraphQL) y Tai Loy (HTML). Fixtures: respuestas reales recortadas a pocos productos (test/fixtures).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  N_MAX, TIENDAS, type Tienda, decodificarEntidades, leerCuerpo, leerProductos, normalizarFalabella, normalizarVtex,
  pedidoBusqueda, reservarTurno, slugRipley, textoPlano, urlBusqueda,
} from "../src/tiendas.ts";

const fixture = (nombre: string) => readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url), "utf-8");
const tienda = (id: string): Tienda => TIENDAS.find((t) => t.id === id)!;
const resumen = (ps: { producto: string; precio: number; precio_lista: number | null; vendedor: string | null }[] | null) =>
  (ps ?? []).map((p) => [p.producto, p.precio, p.precio_lista, p.vendedor]);

test("URLs y pedidos: espacios como %20 (el firewall de VTEX rechaza '+'), GraphQL por POST con variables", () => {
  assert.equal(urlBusqueda(tienda("shopstar.pe"), "toner hp 85a", 4),
    "https://www.shopstar.pe/api/io/_v/api/intelligent-search/product_search/?query=toner%20hp%2085a&count=4&locale=es-PE");
  assert.equal(urlBusqueda(tienda("shopstar.pe"), "toner hp 85a", 4, "vtex"),
    "https://www.shopstar.pe/api/catalog_system/pub/products/search?ft=toner%20hp%2085a&_from=0&_to=3");
  assert.equal(urlBusqueda(tienda("falabella.com.pe"), "silla ergonomica", 4), "https://www.falabella.com.pe/falabella-pe/search?Ntt=silla%20ergonomica");
  assert.equal(urlBusqueda(tienda("ripley.com.pe"), "toner hp 85a", 4), "https://simple.ripley.com.pe/search/toner%20hp%2085a");
  assert.equal(urlBusqueda(tienda("tailoy.com.pe"), "papel bond a4", 4), "https://www.tailoy.com.pe/catalogsearch/result/?q=papel%20bond%20a4");
  const h = pedidoBusqueda(tienda("hiraoka.com.pe"), "toner hp 85a", 4);
  assert.equal(h.url, "https://hiraoka.com.pe/graphql");
  assert.equal(h.init.method, "POST");
  assert.deepEqual(JSON.parse(String(h.init.body)).variables, { q: "toner hp 85a", n: 4 });
  const r = pedidoBusqueda(tienda("ripley.com.pe"), "x", 4);
  assert.equal(r.tipo, "html");
  const ua = (r.init.headers as Record<string, string>)["user-agent"];
  assert.match(ua, /^Mozilla\/5\.0 .*Chrome\//);
  assert.doesNotMatch(ua, /@/);                                    // nunca un correo en las cabeceras
});

test("VTEX catálogo (Plaza Vea): el menor precio entre los vendedores con stock, no el primero", () => {
  const ps = leerProductos(tienda("plazavea.com.pe"), fixture("vtex_plazavea.json"), 4);
  // 1.º: vendedor del marketplace con stock + Plaza Vea en 0; 2.º y 3.º: solo Plaza Vea, en 0 y sin stock → fuera.
  assert.deepEqual(resumen(ps), [["Papel Hoja Bond Fotocopia x500 hojas A4 210mm x 297mm 75 g/m² Millenium", 30, 42, "FENIX IMPORT PERU"]]);
  assert.match(ps![0].url, /^https:\/\/www\.plazavea\.com\.pe\/.+\/p$/);
});

test("VTEX Intelligent Search (Shopstar, Carsa): la tienda primera con 0, el vendedor con el precio real", () => {
  const s = leerProductos(tienda("shopstar.pe"), fixture("vtex_is_shopstar.json"), 4)!;
  assert.deepEqual(resumen(s), [
    ["Toner HP 85A Negro LaserJet Original CE285A", 429, 569, "Sell Y Trade SAC"],
    ["Pack dos Toner HP 85A Negro LaserJet Original CE285AD", 599, 999, "Sell Y Trade SAC"],
    ["Tóner Compatible HP 85A CE285A – 1600 Páginas P1102 / M1132 / M1212", 49, 99, "GREEN DATA"],
  ]);
  assert.equal(s[0].url, "https://www.shopstar.pe/toner-hp-85a-negro-laserjet-original-ce285a-1547263/p");   // `link` relativo
  assert.equal(s[0].sku, "1465782");                              // el 1.er SKU está agotado en todos sus vendedores: el 2.º
  const c = leerProductos(tienda("carsa.pe"), fixture("vtex_is_carsa.json"), 4)!;
  assert.equal(c.length, 1);                                       // el 2.º está agotado en todos sus vendedores
  assert.deepEqual([c[0].precio, c[0].vendedor], [2418, "Perú smart"]);
});

test("VTEX Intelligent Search (Estilos): el precio del vendedor manda sobre priceRange; agotado fuera", () => {
  const ps = leerProductos(tienda("estilos.com.pe"), fixture("vtex_is_estilos.json"), 4)!;
  // priceRange.sellingPrice dice 2999 (índice desactualizado); la oferta del vendedor, 2499 (lo que muestra la web).
  assert.deepEqual(ps.map((p) => [p.precio, p.precio_lista]), [[2499, 2999]]);
  // Sin ofertas por vendedor: el rango de precios. Patrocinado (VTEX Ads): fuera.
  const t = tienda("estilos.com.pe");
  const base = { productName: "X", link: "/x/p", items: [{ itemId: "1" }], priceRange: { sellingPrice: { lowPrice: 10 }, listPrice: { lowPrice: 12 } } };
  assert.deepEqual(normalizarVtex([base], t).map((p) => [p.precio, p.precio_lista, p.url]), [[10, 12, "https://www.estilos.com.pe/x/p"]]);
  assert.deepEqual(normalizarVtex([{ ...base, advertisement: { adId: "a" } }], t), []);
  assert.equal(leerProductos(t, "<html>error</html>", 4), null);  // no es JSON: fallo, no "sin resultados"
  assert.deepEqual(leerProductos(t, '{"products":[],"recordsFiltered":0}', 4), []);
});

test("Ripley: __NEXT_DATA__, sin patrocinados ni agotados, vendedor del marketplace, enlace de la página o slug", () => {
  const t = tienda("ripley.com.pe");
  const html = fixture("ripley.html");
  const ps = leerProductos(t, html, N_MAX)!;
  assert.deepEqual(resumen(ps), [
    ["TÓNER HP NEGRO 85A CE285A", 299, 410, "FULL VENTAS PERU"],
    ["TONER HP 85A NEGRO (CE285A)", 500, 500, "MEGA SURCO"],
    ["TONER HP 85A BLACK CE285A 1.6K PÁG. P1102 COMPATIBLE", 59, 169, "ODEMIS S.A.C"],
  ]);
  assert.equal(ps[0].url, "https://simple.ripley.com.pe/toner-hp-negro-85a-ce285a-pmp20000174283");      // de la página, sin la consulta
  assert.equal(ps[2].url, "https://simple.ripley.com.pe/toner-hp-85a-black-ce285a-16k-pag-p1102-compatible-pmp20001080934");   // slug
  assert.equal(slugRipley("TONER HP 85A BLACK CE285A 1.6K PÁG."), "toner-hp-85a-black-ce285a-16k-pag");
  assert.equal(leerProductos(t, html.replace('"inStock": true, "seller": "MARKETPLACE", "sponsoredType": null, "shop": {"shopName": "FULL',
    '"inStock": false, "seller": "MARKETPLACE", "sponsoredType": null, "shop": {"shopName": "FULL'), N_MAX)!.length, 2);
  assert.equal(leerProductos(t, "<html><title>Just a moment...</title></html>", 4), null);
});

test("Hiraoka (Magento GraphQL): precio final, regular como lista, URL por url_key; agotados fuera", () => {
  const t = tienda("hiraoka.com.pe");
  const cuerpo = fixture("hiraoka.json");
  const ps = leerProductos(t, cuerpo, 3)!;
  assert.deepEqual(ps.map((p) => [p.producto, p.precio, p.sku, p.url]), [
    ["Toner HP 154X Negro", 89.9, "131892", "https://hiraoka.com.pe/toner-hp-154x-negro"],
    ["Tóner HP 215A Amarillo Laserjet Original (W2312A) Para HP Color LJ Pro MFP M182nw (all), M183fw (Club), HP Color LJ Pro MFP M182nw (all), M183fw (Club)", 239, "122623", "https://hiraoka.com.pe/toner-hp-laserjet-original-w2312a-amarillo"],
    ["Cartucho Tóner HP Laserjet 150A Negro W1500A", 249, "133013", "https://hiraoka.com.pe/cartucho-toner-hp-laserjet-150a-negro-w1500a"],
  ]);
  const agotado = JSON.parse(cuerpo);
  agotado.data.products.items[0].stock_status = "OUT_OF_STOCK";
  agotado.data.products.items[1].name = "Laptop HP de 15.6&quot;, Intel Core i5";   // así llegan los nombres de laptops
  assert.deepEqual(leerProductos(t, JSON.stringify(agotado), 3)!.slice(0, 1).map((p) => [p.sku, p.producto]),
    [["122623", 'Laptop HP de 15.6", Intel Core i5']]);
  assert.equal(leerProductos(t, '{"errors":[{"message":"x"}]}', 3), null);
});

test("Tai Loy (HTML de Magento): nombre, marca, precio final y anterior; agotados fuera", () => {
  const t = tienda("tailoy.com.pe");
  const html = fixture("tailoy.html");
  const ps = leerProductos(t, html, N_MAX)!;
  assert.deepEqual(ps.map((p) => [p.producto, p.marca, p.precio, p.precio_lista, p.sku]), [
    ["Cartucho De Tóner Negro 78A", "HP", 504.9, null, "1198"],
    ["Tóner Hp 83A Cf283 Laserjet", "HP", 469.9, null, ps[1].sku],
    ["Botella De Tinta Hp Gt53 Negro", "HP", 37.9, 39.9, ps[2].sku],
  ]);
  assert.equal(ps[0].url, "https://www.tailoy.com.pe/hp-cartucho-de-toner-negro-78a-4839.html");
  const agotado = html.replace('<form data-role="tocart-form" data-product-sku="1198"', '<div class="stock unavailable"><span>Agotado</span></div><form');
  assert.equal(leerProductos(t, agotado, N_MAX)!.length, 2);
  const sinResultados = html.slice(0, html.indexOf('<div class="search results">')) + '<div class="message notice">Tu búsqueda no obtuvo resultados.</div></body></html>';
  assert.deepEqual(leerProductos(t, sinResultados, 4), []);
  assert.equal(leerProductos(t, "<html><body class=\"cms-index-index\"></body></html>", 4), null);   // no es la página de resultados
  assert.equal(textoPlano("  Cuaderno A4 &amp; t&#xF3;ner&nbsp;<b>x</b> "), "Cuaderno A4 & tóner x");
  assert.equal(decodificarEntidades("Pipeta <2.5 kg &amp; 15.6&quot;"), 'Pipeta <2.5 kg & 15.6"');
});

test("Falabella (página real, leída desde Cloudflare): sin patrocinados, sin el precio CMR, vendedor", () => {
  const t = tienda("falabella.com.pe");
  assert.deepEqual(leerProductos(t, fixture("falabella.html"), N_MAX)!.map((p) => [p.producto, p.precio, p.precio_lista, p.vendedor, p.url]), [
    ["TONER 85A CF285A NEGRO", 332, 370, "Evisur Eirl", "https://www.falabella.com.pe/falabella-pe/product/146321260/TONER-HP-85A-CF285A-NEGRO"],
    ["TONER 85A NEGRO CE285A ORIGINAL", 500, 700, "Mega Surco", "https://www.falabella.com.pe/falabella-pe/product/147708986/TONER-HP-85A-NEGRO-CE285A-ORIGINAL"],
    // cmrPrice 122.90 (solo con la tarjeta) y eventPrice 129.90: vale el segundo
    ["Silla Ergonómica Oficina Ejecutiva Giratorio - 190054", 129.9, 179.9, "Yayi Importaciones", "https://www.falabella.com.pe/falabella-pe/product/150943535/silla-ergonomica-oficina-ejecutiva-giratorio-190054"],
  ]);
});

test("Falabella / Sodimac: sin patrocinados, sin el precio de la tarjeta CMR si hay otro, vendedor", () => {
  const t = tienda("falabella.com.pe");
  const res = [
    { displayName: "Patrocinado", url: "https://www.falabella.com.pe/falabella-pe/product/1/a", isSponsored: true, prices: [{ type: "eventPrice", price: ["10"] }] },
    { displayName: "Silla", brand: "X", skuId: "2", sellerName: "Tienda Uno", url: "/falabella-pe/product/2/silla?x=1",
      prices: [{ type: "cmrPrice", crossed: false, price: ["199"] }, { type: "eventPrice", crossed: false, price: ["249"] }, { type: "normalPrice", crossed: true, price: ["1,299"] }] },
    { displayName: "Solo CMR", url: "https://www.falabella.com.pe/falabella-pe/product/3/c", prices: [{ type: "cmrPrice", crossed: false, price: ["99"] }] },
  ];
  assert.deepEqual(normalizarFalabella(res, t, 4).map((p) => [p.producto, p.precio, p.precio_lista, p.vendedor, p.url]), [
    ["Silla", 249, 1299, "Tienda Uno", "https://www.falabella.com.pe/falabella-pe/product/2/silla"],
    ["Solo CMR", 99, null, null, "https://www.falabella.com.pe/falabella-pe/product/3/c"],
  ]);
  assert.equal(leerProductos(t, "<html><title>Just a moment...</title></html>", 4), null);   // desafío anti-bots: fallo
  assert.deepEqual(leerProductos(t, '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"results":[]}}}</script>', 4), []);
});

test("cuerpo con tope de tamaño: se corta la lectura", async () => {
  assert.equal(await leerCuerpo(new Response("hola ñandú"), 100), "hola ñandú");
  await assert.rejects(leerCuerpo(new Response("x".repeat(5000)), 1000), /más de 1000 bytes/);
});

test("turnos: ≥ 1 s entre pedidos a la misma tienda; si la espera pasa del tope, ocupada", () => {
  const turnos = new Map<string, number>();
  assert.equal(reservarTurno(turnos, "a", 10_000), 0);
  assert.equal(reservarTurno(turnos, "a", 10_200), 800);
  assert.equal(reservarTurno(turnos, "b", 10_200), 0);             // otra tienda, sin espera
  assert.equal(reservarTurno(turnos, "a", 13_000), 0);
  for (let i = 0; i < 5; i++) reservarTurno(turnos, "c", 20_000);
  assert.equal(reservarTurno(turnos, "c", 20_000), 5000);
  assert.equal(reservarTurno(turnos, "c", 20_000), -1);
});
