import test from "node:test";
import assert from "node:assert/strict";
import { diaLima, mesLima, renuevaMcp, topesMcp } from "../src/lib/creditosMcp.js";
import { LIMITES_GRATIS, limitesDe } from "../src/lib/gobservaPlanes.js";

// Créditos del MCP (2026-11-08): cuántos trae cada plan y los topes internos que salen de ellos.

test("topesMcp: en un día la quinta parte del mes; filas del día, el doble de los créditos (al menos 2 000)", () => {
  assert.deepEqual(topesMcp(1500), { creditos: 1500, topeDia: 300, topeFilasDia: 3000 });
  assert.deepEqual(topesMcp(300), { creditos: 300, topeDia: 60, topeFilasDia: 2000 });
  assert.deepEqual(topesMcp(0), { creditos: 0, topeDia: 0, topeFilasDia: 0 });
});

test("el mes y el día son los de Lima; se renuevan el 1 del mes siguiente", () => {
  const ms = Date.parse("2026-12-01T03:00:00Z"); // 30 de noviembre, 22:00 en Lima
  assert.equal(mesLima(ms), "2026-11");
  assert.equal(diaLima(ms), "2026-11-30");
  assert.equal(renuevaMcp("2026-11"), "2026-12-01");
  assert.equal(renuevaMcp("2026-12"), "2027-01-01");
});

test("los créditos de cada plan (sin la base: el catálogo por defecto)", async () => {
  assert.equal(LIMITES_GRATIS.mcp, 0);
  const plan = async (p: "empleo" | "licitaciones", id: string) => (await limitesDe(p, id).catch(() => null))?.mcp;
  const empleo = await plan("empleo", "alertas");
  if (empleo === undefined) return; // sin base no se puede leer la configuración del panel
  assert.equal(empleo, 300);
  assert.equal(await plan("licitaciones", "inicia"), 1500);
  assert.equal(await plan("licitaciones", "pro"), 15000);
});
