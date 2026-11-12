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

test("validar: la farmacia que da el precio de una tableta aunque diga «x 100»", () => {
  const v = validar([
    oferta(1, 10, { unidades: 100 }),
    oferta(2, 10, { unidades: 100 }),
    oferta(6, 1, { unidades: 10 }),
    oferta(3, 0.1, { unidades: 100 }),
    oferta(4, 0.15, { unidades: 10 }),
    oferta(5, 1, { unidades: 100 }),
  ]);
  const por = Object.fromEntries(v.map((o) => [o.n, o]));
  assert.equal(por[3].precioUnitario, 0.1);
  assert.ok(por[3].valida);
  assert.equal(por[3].motivo, "la tienda da el precio por unidad");
  assert.ok(por[4].valida);
  assert.equal(por[6].precioUnitario, 0.1);
  assert.equal(por[6].motivo, null);
  assert.equal(por[5].motivo, "muy lejos de las demás");
});

test("validar: el segundo caso real (2026-11-12): blísteres de 10 a S/ 1 y Panadol, sin Inkafarma", () => {
  const v = validar([
    oferta(1, 12.1, { unidades: 16 }), oferta(2, 12.1, { unidades: 16 }), // Panadol
    oferta(3, 1, { unidades: 100 }), oferta(4, 0.1, { unidades: 100 }), // Novafarma
    oferta(5, 1, { unidades: 10 }), oferta(6, 1, { unidades: 10 }), oferta(7, 1.5, { unidades: 10 }), // Farmacia Universal
    oferta(8, 0.15, { unidades: 10 }), // Botifarma
  ]);
  const r = resumir(v, 0.12);
  assert.equal(r.mediana, 0.1);
  assert.equal(r.veredicto, "Por encima del mercado");
});

test("validar: el caso real del paracetamol (2026-11-12): genérico por caja y por tableta, Panadol de marca", () => {
  const v = validar([
    oferta(1, 10, { unidades: 100 }), oferta(2, 10, { unidades: 100 }), // Inkafarma, caja de 100
    oferta(3, 0.1, { unidades: 100 }), oferta(4, 1, { unidades: 100 }), // Novafarma, por tableta
    oferta(5, 0.15, { unidades: 10 }), // Botifarma, blister
    oferta(6, 12.1, { unidades: 16 }), oferta(7, 12.1, { unidades: 16 }), oferta(8, 12.1, { unidades: 16 }), // Panadol
  ]);
  const r = resumir(v, 0.12);
  assert.equal(r.validas, 4);
  assert.equal(r.mediana, 0.1);
  assert.equal(r.veredicto, "Por encima del mercado");
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
