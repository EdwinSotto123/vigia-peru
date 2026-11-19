import test from "node:test";
import assert from "node:assert/strict";
import { activas, armarFacetas, conBordes, facetasVisitas, leerPedido, sqlFacetas, totalVisitas } from "../src/lib/visitasLista.js";

test("leerPedido: sólo listas, filtros y órdenes conocidos; lo demás se ignora", () => {
  assert.equal(leerPedido("otra", {}), null);
  assert.equal(leerPedido(undefined, {}), null);
  const p = leerPedido("empresas", { page: "3", size: "999", q: "  medic   s.a.  ", orden: "DROP", antes: "no", via: "x'; --", tipo: "orden" })!;
  assert.equal(p.page, 3);
  assert.equal(p.size, 50);
  assert.equal(p.offset, 100);
  assert.equal(p.q, "medic s.a.");
  assert.equal(p.orden, "nueva");
  assert.deepEqual(p.f, { antes: "no", tipo: "orden" });
  // Una letra no busca; la página nunca baja de 1.
  const q = leerPedido("areas", { q: "a", page: "-4" })!;
  assert.equal(q.q, null);
  assert.equal(q.page, 1);
  assert.equal(q.size, 15);
});

test("leerPedido de visitas: el año con cuatro cifras y la organización en mayúsculas", () => {
  const p = leerPedido("visitas", { anio: "2024", org: "  consorcio   salud sac ", tipo: "pariente", hora: "noche" })!;
  assert.deepEqual(p.f, { tipo: "pariente", anio: "2024", org: "CONSORCIO SALUD SAC" });
  assert.deepEqual(leerPedido("visitas", { anio: "24'" })!.f, {});
});

test("sqlFacetas: cada opción cuenta con los DEMÁS filtros puestos", () => {
  const conds = { a: { si: "x > 0", no: "x = 0" }, b: { uno: "y = 1" } };
  const act = activas(conds, { a: "si", b: "uno", c: "zzz" });
  assert.deepEqual(act, { a: "x > 0", b: "y = 1" });
  const sql = sqlFacetas(conds, act);
  assert.match(sql, /count\(\*\) FILTER \(WHERE \(x > 0\) AND \(y = 1\)\)::int AS "total"/);
  // La opción «no» de `a` lleva el filtro de `b` pero no el suyo.
  assert.match(sql, /FILTER \(WHERE \(y = 1\) AND \(x = 0\)\)::int AS "a:no"/);
  assert.match(sql, /FILTER \(WHERE \(x > 0\) AND \(y = 1\)\)::int AS "b:uno"/);
  assert.deepEqual(armarFacetas({ total: "7", "a:si": 7, "a:no": 3, "b:uno": 7 }), { total: 7, facetas: { a: { si: 7, no: 3 }, b: { uno: 7 } } });
});

const cifras = {
  r: { total: 100, privadas: 40, publicas: 25, personas: 35, decisores: 18, fuera: 4, parientes: 6 },
  anios: [{ anio: 2025, visitas: 70, privadas: 30 }, { anio: 2024, visitas: 30, privadas: 10 }],
};

test("totalVisitas: de lo precalculado cuando se sabe; si no, null", () => {
  assert.equal(totalVisitas({ f: {}, q: null }, cifras), 100);
  assert.equal(totalVisitas({ f: { anio: "2024" }, q: null }, cifras), 30);
  assert.equal(totalVisitas({ f: { anio: "2023" }, q: null }, cifras), 0);
  assert.equal(totalVisitas({ f: { anio: "2025", tipo: "privada" }, q: null }, cifras), 30);
  assert.equal(totalVisitas({ f: { tipo: "pariente" }, q: null }, cifras), 6);
  assert.equal(totalVisitas({ f: { decisor: "no" }, q: null }, cifras), 82);
  assert.equal(totalVisitas({ f: { hora: "dentro" }, q: null }, cifras), 96);
  // Por organización lo cuenta la consulta de la página, no lo precalculado.
  assert.equal(totalVisitas({ f: {}, q: "salud" }, cifras), null);
  assert.equal(totalVisitas({ f: { org: "SALOG S.A." }, q: null }, cifras), null);
  assert.equal(totalVisitas({ f: { decisor: "si", hora: "fuera" }, q: null }, cifras), null);
});

test("conBordes: cada organización también con un espacio en sus bordes, sin repetir", () => {
  assert.deepEqual(conBordes(["SALOG S.A.", "SALOG S.A."]), ["SALOG S.A.", "SALOG S.A. ", " SALOG S.A.", " SALOG S.A. "]);
});

test("facetasVisitas: los números sólo si ningún otro filtro está puesto", () => {
  const libre = facetasVisitas({ f: {}, q: null }, cifras);
  assert.deepEqual(libre.tipo, { privada: 40, publica: 25, persona_natural: 35, pariente: 6 });
  assert.deepEqual(libre.anio, { 2025: 70, 2024: 30 });
  const conAnio = facetasVisitas({ f: { anio: "2025" }, q: null }, cifras);
  assert.equal(conAnio.tipo, null);
  assert.deepEqual(conAnio.anio, { 2025: 70, 2024: 30 });
  assert.deepEqual(facetasVisitas({ f: { tipo: "privada" }, q: null }, cifras).anio, { 2025: 30, 2024: 10 });
  assert.equal(facetasVisitas({ f: {}, q: "salud" }, cifras).decisor, null);
});
