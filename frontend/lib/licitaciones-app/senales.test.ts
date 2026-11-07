import test from "node:test";
import assert from "node:assert/strict";
import { calcularSenales, conRiesgo } from "./senales.ts";
import type { Comprador } from "./tipos.ts";

const comprador = (c: Partial<Comprador>): Comprador => ({
  procesos: 20,
  monto: 1_000_000,
  adjSobreRef: 0.9,
  conPostores: 20,
  postoresPromedio: 2,
  unSoloPostor: 2,
  proveedores: [{ ruc: "20100000001", nombre: "ACME S.A.C.", procesos: 3, monto: 100_000 }],
  ...c,
});

const base = { valor: 50_000, publicada: "2026-11-01", consultasHasta: "2026-11-12" };

test("sin nada raro, no hay señales", () => {
  assert.deepEqual(calcularSenales({ ...base, comprador: comprador({}) }), []);
});

test("único postor: nada bajo 60 %, media desde 60 %, alta desde 80 %, con su cifra", () => {
  assert.deepEqual(calcularSenales({ ...base, comprador: comprador({ unSoloPostor: 11 }) }), []);
  const media = calcularSenales({ ...base, comprador: comprador({ unSoloPostor: 13 }) });
  assert.deepEqual(media.map((s) => [s.clave, s.nivel]), [["unico_postor", "media"]]);
  assert.match(media[0].evidencia, /13 de los 20/);
  assert.equal(calcularSenales({ ...base, comprador: comprador({ unSoloPostor: 16 }) })[0].nivel, "alta");
});

test("con poca base (menos de 5 procesos) no se dice nada del comprador", () => {
  assert.deepEqual(calcularSenales({ ...base, comprador: comprador({ procesos: 3, conPostores: 3, unSoloPostor: 3, adjSobreRef: 1 }) }), []);
});

test("concentración y tope referencial (desde 99,5 %; 98 % es lo normal)", () => {
  assert.deepEqual(calcularSenales({ ...base, comprador: comprador({ adjSobreRef: 0.98 }) }), []);
  const s = calcularSenales({
    ...base,
    comprador: comprador({ adjSobreRef: 1, proveedores: [{ ruc: "20100000001", nombre: "ACME S.A.C.", procesos: 9, monto: 800_000 }] }),
  });
  assert.deepEqual(s.map((x) => [x.clave, x.nivel]), [["concentracion", "alta"], ["tope_referencial", "media"]]);
  assert.match(s[0].evidencia, /ACME S\.A\.C\. se llevó el 80/);
});

test("informativas: sin valor y consultas cortas; no cuentan como riesgo", () => {
  const s = calcularSenales({ valor: null, publicada: "2026-11-05", consultasHasta: "2026-11-06", comprador: null });
  assert.deepEqual(s.map((x) => x.clave), ["sin_valor", "consultas_cortas"]);
  assert.equal(conRiesgo(s), false);
});
