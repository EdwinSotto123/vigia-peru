import test from "node:test";
import assert from "node:assert/strict";
import { armarGasto, armarHoras, diaMenos, type FilaGasto } from "../src/routes/transparencia.js";

test("diaMenos: resta días de calendario, también al cruzar de mes", () => {
  assert.equal(diaMenos("2026-11-17", 0), "2026-11-17");
  assert.equal(diaMenos("2026-11-17", 29), "2026-10-19");
  assert.equal(diaMenos("2026-03-01", 1), "2026-02-28");
});

test("armarGasto: 30 días completos, por componente y proveedor, con el costo por unidad y la factura", () => {
  const f = (dia: string, componente: FilaGasto["componente"], usd: number, n: number, proveedor: FilaGasto["proveedor"] = "workers_ai"): FilaGasto =>
    ({ dia, componente, proveedor, usd, n });
  const filas = [
    f("2026-11-17", "analisis", 30, 100),
    f("2026-11-16", "analisis", 70, 200),
    f("2026-11-16", "fichas", 4.6, 1000),
    f("2026-11-17", "transcripcion", 2, 2700),
    f("2026-11-05", "lectores", 50, 10000, "anthropic"),
    f("2026-09-01", "analisis", 999, 1), // fuera de los 30 días
  ];
  const g = armarGasto(filas, "2026-11-17", [{ dia: "2026-11-16", usd: 120 }, { dia: "2026-11-17", usd: 40 }], "2026-11-17 10:00");
  assert.equal(g.dias.length, 30);
  assert.equal(g.dias[0].dia, "2026-10-19");
  assert.equal(g.dias[29].dia, "2026-11-17");
  assert.equal(g.dias[29].total, 32);
  assert.deepEqual(g.dias[28].partes, { analisis: 70, fichas: 4.6 });
  assert.equal(g.totales.usd30, 156.6);
  assert.equal(g.totales.usd7, 106.6);
  assert.equal(g.totales.hoy, 32);
  assert.equal(g.totales.anthropic30, 50);
  assert.equal(g.totales.workersAi30, 106.6);
  assert.equal(g.medios.porAnalisis, 0.3333);
  assert.equal(g.medios.porFicha, 0.0046);
  assert.equal(g.medios.porPagina, 0.0007);
  // Los componentes sin gasto ni volumen no salen; el orden es el del catálogo.
  assert.deepEqual(g.componentes.map((k) => k.clave), ["analisis", "fichas", "transcripcion", "lectores"]);
  assert.equal(g.factura?.usd30, 160);
  assert.equal(g.factura?.dias.length, 30);
  assert.ok(Math.abs((g.factura?.cubren ?? 0) - 106.6 / 160) < 1e-9);
});

test("armarGasto: sin factura cargada, factura es null", () => {
  const g = armarGasto([], "2026-11-17", null, null);
  assert.equal(g.factura, null);
  assert.equal(g.totales.usd30, 0);
  assert.equal(g.componentes.length, 0);
});

test("armarHoras: las 24 horas que terminan en la actual, con las vacías en cero", () => {
  const h = armarHoras([{ hora: "2026-11-17 14", analisis: 3, documentos: 500 }, { hora: "2026-11-16 15", analisis: 1, documentos: 2 }], "2026-11-17 14");
  assert.equal(h.length, 24);
  assert.equal(h[0].hora, "2026-11-16 15");
  assert.equal(h[23].hora, "2026-11-17 14");
  assert.deepEqual(h[23], { hora: "2026-11-17 14", analisis: 3, documentos: 500 });
  assert.equal(h[0].documentos, 2);
  assert.equal(h[10].analisis, 0);
});
