/** EMMSA (Gran Mercado Mayorista de Lima): códigos del formulario, tabla del reporte y búsqueda por palabras. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { codigosDelFormulario, coincide, cuerpoConsulta, fechaReporte, parsearReporte } from "../src/mayorista.ts";

test("códigos de producto y variedad del formulario", () => {
  const html = `<input id="01" value="p" type="checkbox" class="largerCheckbox" > ACELGA
    <input id="0101" class="01" value="v" type="checkbox"> ACELGA
    <input id="29" value="p" type="checkbox"> LIMON <input id="2901" class="29" value="v"> <input id="2902" class="29" value="v">`;
  assert.deepEqual(codigosDelFormulario(html), { productos: ["01", "29"], variedades: ["0101", "2901", "2902"] });
  assert.equal(fechaReporte("2026-10-16"), "16/10/2026");
  assert.equal(cuerpoConsulta({ productos: ["01"], variedades: ["0101"] }, "2026-10-16"),
    "vid_tipo=1&vprod=01&vvari=0101&vfecha=16%2F10%2F2026");
});

test("tabla del reporte: filas con precio, cabeceras fuera", () => {
  const html = `<table><tr><th>Producto</th><th>Variedad</th><th colspan=3>Precios x Kg en S/</th></tr>
    <tr><th>Precio Min.</th><th>Precio Max.</th><th>Precio Prom.</th></tr>
    <tr><td>LIMON</td><td>LIMON CITRICO CAJON</td><td>3.00</td><td>3.50</td><td>3.22</td></tr>
    <tr><td>NARANJA</td><td>NARANJA&nbsp;VALENCIA (SELVA)</td><td>1.00</td><td>1.50</td><td>1.25</td></tr>
    <tr><td colspan=5></td></tr></table>`;
  assert.deepEqual(parsearReporte(html), [
    { producto: "LIMON", variedad: "LIMON CITRICO CAJON", precio_min: 3, precio_max: 3.5, precio_prom: 3.22 },
    { producto: "NARANJA", variedad: "NARANJA VALENCIA (SELVA)", precio_min: 1, precio_max: 1.5, precio_prom: 1.25 },
  ]);
});

test("búsqueda: todas las palabras, sin tildes, prefijos", () => {
  const f = { producto: "NARANJA", variedad: "NARANJA VALENCIA (SELVA)" };
  assert.equal(coincide("naranja valencia", f), true);
  assert.equal(coincide("Naranja x kg", f), true);
  assert.equal(coincide("naranja huando", f), false);
  assert.equal(coincide("limón", { producto: "LIMON", variedad: "LIMON CITRICO BOLSA" }), true);
  assert.equal(coincide("", f), false);
  assert.equal(coincide("ajo", { producto: "AJONJOLI", variedad: "AJONJOLI" }), false);      // palabra corta: entera
  assert.equal(coincide("ajo", { producto: "AJO", variedad: "AJO CRIOLLO O NAPURI" }), true);
});
