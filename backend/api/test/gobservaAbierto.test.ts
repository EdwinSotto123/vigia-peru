import test from "node:test";
import assert from "node:assert/strict";
import { LIMITES_ABIERTO, LIMITES_GRATIS, PLAN_ABIERTO, cobrosEnPausa, codigoAbierto, esAbierto, limitesDe } from "../src/lib/gobservaPlanes.js";

// Freemium (2026-11-24): con los cobros en pausa, una cuenta con correo verificado tiene el plan abierto de cada producto.

test("cobrosEnPausa: en pausa salvo GOBSERVA_COBROS=activos", () => {
  const antes = process.env.GOBSERVA_COBROS;
  try {
    delete process.env.GOBSERVA_COBROS;
    assert.equal(cobrosEnPausa(), true);
    process.env.GOBSERVA_COBROS = "activos";
    assert.equal(cobrosEnPausa(), false);
    process.env.GOBSERVA_COBROS = " Activos ";
    assert.equal(cobrosEnPausa(), false);
  } finally {
    if (antes === undefined) delete process.env.GOBSERVA_COBROS;
    else process.env.GOBSERVA_COBROS = antes;
  }
});

test("el plan abierto trae alertas diarias, Excel y créditos del MCP; el gratis sin verificar, no", async () => {
  for (const p of ["empleo", "licitaciones", "obras"] as const) {
    const l = await limitesDe(p, PLAN_ABIERTO);
    assert.deepEqual(l, LIMITES_ABIERTO[p]);
    assert.ok(l.frecuencias.includes("diaria") && l.csv && l.mcp > 0 && l.alertas > LIMITES_GRATIS.alertas);
  }
  assert.equal(LIMITES_GRATIS.mcp, 0);
  assert.equal(await limitesDe("empleo", null), LIMITES_GRATIS);
});

test("codigoAbierto: Obras comparte el de Licitaciones (sus créditos no se suman dos veces)", () => {
  assert.equal(codigoAbierto("obras"), codigoAbierto("licitaciones"));
  assert.notEqual(codigoAbierto("empleo"), codigoAbierto("licitaciones"));
  assert.ok(esAbierto(codigoAbierto("empleo")));
  assert.ok(!esAbierto("EQUIPO-EMPLEO") && !esAbierto(null));
});
