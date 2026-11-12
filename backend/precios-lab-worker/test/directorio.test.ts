import { test } from "node:test";
import assert from "node:assert/strict";
import { leerRespuesta, pedidoDe, rubrosDe, tiendasPara, type TiendaDirectorio } from "../src/directorio.ts";
import { decodificarEntidades } from "../src/extraer.ts";

const tienda = (plataforma: TiendaDirectorio["plataforma"], parametros?: string): TiendaDirectorio => ({
  id: "x.pe", nombre: "X", base: "https://www.x.pe", plataforma, rubros: ["farmacia"], parametros,
});

test("WooCommerce: precio en céntimos, entidades HTML y enlace", () => {
  const j = [
    { name: "Paracetamol Tabletas 500 MG Portugal &#8211; Caja 100 UN", permalink: "https://www.x.pe/producto/paracetamol-500/", is_in_stock: true,
      prices: { price: "1000", currency_code: "PEN", currency_minor_unit: 2 } },
    { name: "Sin precio", permalink: "https://www.x.pe/p/", prices: { price: "0", currency_code: "PEN", currency_minor_unit: 2 } },
  ];
  const r = leerRespuesta(tienda("woocommerce"), j);
  assert.equal(r.length, 1);
  assert.equal(r[0].precio, 10);
  assert.equal(r[0].moneda, "PEN");
  assert.equal(r[0].titulo, "Paracetamol Tabletas 500 MG Portugal – Caja 100 UN");
  assert.equal(r[0].disponible, true);
});

test("Shopify: precio decimal y URL relativa; en céntimos si la tienda lo dice", () => {
  const j = { resources: { results: { products: [{ title: "Resaltador amarillo", price: "4.50", url: "/products/resaltador?_pos=1", vendor: "Faber", available: true }] } } };
  const r = leerRespuesta(tienda("shopify"), j);
  assert.equal(r[0].precio, 4.5);
  assert.equal(r[0].url, "https://www.x.pe/products/resaltador?_pos=1");
  assert.equal(r[0].marca, "Faber");
  assert.equal(leerRespuesta(tienda("shopify", "precio=centimos"), { resources: { results: { products: [{ title: "A", price: 450, url: "/a" }] } } })[0].precio, 4.5);
});

test("VTEX: el primer vendedor con precio", () => {
  const j = [{ productName: "Arroz Paisana 5 kg", brand: "Paisana", link: "https://www.x.pe/arroz/p",
    items: [{ sellers: [{ commertialOffer: { Price: 0, AvailableQuantity: 0 } }, { commertialOffer: { Price: 20.5, AvailableQuantity: 9 } }] }] }];
  const r = leerRespuesta(tienda("vtex"), j);
  assert.equal(r[0].precio, 20.5);
  assert.equal(r[0].disponible, true);
});

test("Magento: GraphQL con url_key y sufijo", () => {
  const j = { data: { products: { items: [{ name: "Alcohol 70° 1 L", url_key: "alcohol-70-1l", url_suffix: ".html", stock_status: "IN_STOCK",
    price_range: { minimum_price: { final_price: { value: 12.9, currency: "PEN" } } } }] } } };
  const r = leerRespuesta(tienda("magento"), j);
  assert.equal(r[0].url, "https://www.x.pe/alcohol-70-1l.html");
  assert.equal(r[0].precio, 12.9);
  const p = pedidoDe(tienda("magento"), 'alcohol "70"');
  assert.equal(p.metodo, "POST");
  assert.ok(JSON.parse(p.cuerpo!).query.includes('search: "alcohol \\"70\\""'));
});

test("rubros: los del modelo (válidos) más los que delatan las palabras", () => {
  assert.deepEqual(rubrosDe(["oficina", "inventado"], "papel bond A4"), ["oficina"]);
  assert.deepEqual(rubrosDe([], "Amoxicilina 500 mg cápsula"), ["farmacia"]);
  assert.ok(rubrosDe(undefined, "guantes de nitrilo quirúrgicos").includes("medico"));
  assert.deepEqual(rubrosDe(null, "servicio de consultoría"), []);
});

test("tiendasPara: sin rubro no hay tiendas; con rubro, solo las que lo venden", () => {
  assert.equal(tiendasPara([], 10).length, 0);
  const t = tiendasPara(["farmacia"], 10);
  assert.ok(t.length > 0);
  assert.ok(t.every((x) => x.rubros.includes("farmacia")));
});

test("entidades HTML", () => {
  assert.equal(decodificarEntidades("A &amp; B &#8211; C &#x2013; D &ntilde; &desconocida;"), "A & B – C – D ñ &desconocida;");
});
