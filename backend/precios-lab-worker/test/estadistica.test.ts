import { test } from "node:test";
import assert from "node:assert/strict";
import { percentil, resumir, validar } from "../src/estadistica.ts";
import type { Oferta } from "../src/tipos.ts";

const oferta = (n: number, precio: number | null, extra: Partial<Oferta> = {}): Oferta => ({
  n, fuente: "tienda", tienda: "t", titulo: `o${n}`, marca: null, url: `https://t/${n}`, precio, moneda: "PEN", disponibilidad: null,
  extraccion: "api_tienda", confirmado: null, vendedor: null, coincidencia: "exacta", unidades: 1, ...extra,
});

test("percentil interpola", () => {
  assert.equal(percentil([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentil([], 0.5), null);
});

test("validar: unidades, moneda, confirmación y extremos", () => {
  const v = validar([
    oferta(1, 10),
    oferta(2, 120, { unidades: 12 }),
    oferta(3, 11),
    oferta(4, 9, { moneda: "USD" }),
    oferta(5, 12, { coincidencia: "distinta" }),
    oferta(6, 12, { unidades: 0 }),
    oferta(7, 100),
    oferta(8, 10.5, { confirmado: false }),
  ]);
  const por = Object.fromEntries(v.map((o) => [o.n, o]));
  assert.equal(por[2].precioUnitario, 10);
  assert.ok(por[2].valida);
  assert.equal(por[4].motivo, "en USD");
  assert.equal(por[5].motivo, "otro producto");
  assert.ok(!por[6].valida);
  assert.equal(por[7].motivo, "muy lejos de las demás");
  assert.equal(por[8].motivo, "el precio no aparece en la página");
});

test("resumir: veredicto frente a la referencia", () => {
  const v = validar([oferta(1, 10), oferta(2, 11), oferta(3, 12), oferta(4, 13)]);
  const r = resumir(v, 20);
  assert.equal(r.validas, 4);
  assert.equal(r.mediana, 11.5);
  assert.equal(r.veredicto, "Muy por encima del mercado");
  assert.equal(resumir(v, 11.5).veredicto, "En línea con el mercado");
  assert.equal(resumir(validar([oferta(1, 10)]), 20).veredicto, "Pocas ofertas, no concluyente");
  assert.equal(resumir([], null).veredicto, "No se encontraron ofertas del mismo producto");
});
