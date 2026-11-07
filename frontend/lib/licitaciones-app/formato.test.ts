import test from "node:test";
import assert from "node:assert/strict";
import { diaLima, diasHasta, haceDias, pct, vencimiento } from "./formato.ts";

// Sábado 7 nov 2026, 10:00 en Lima (15:00 UTC).
const AHORA = Date.parse("2026-11-07T15:00:00Z");

test("diaLima: a las 21:00 de Lima sigue siendo el mismo día (en UTC ya cambió)", () => {
  assert.equal(diaLima("2026-11-08T02:00:00Z"), "2026-11-07");
});

test("diasHasta: días de calendario de Lima", () => {
  assert.equal(diasHasta("2026-11-07T23:00:00-05:00", AHORA), 0);
  assert.equal(diasHasta("2026-11-08T00:30:00-05:00", AHORA), 1);
  assert.equal(diasHasta("2026-11-05", AHORA), -2);
});

test("vencimiento: sin dato, vencido, hoy, pronto y abierto", () => {
  assert.equal(vencimiento(null, AHORA).estado, "sin_dato");
  assert.equal(vencimiento("2026-11-07T08:00:00-05:00", AHORA).estado, "vencido");
  const hoy = vencimiento("2026-11-07T23:59:00-05:00", AHORA);
  assert.deepEqual([hoy.estado, hoy.texto], ["hoy", "Vence hoy"]);
  assert.equal(vencimiento("2026-11-08T23:59:00-05:00", AHORA).texto, "Vence mañana");
  const pronto = vencimiento("2026-11-10T23:59:00-05:00", AHORA);
  assert.deepEqual([pronto.estado, pronto.dias, pronto.texto], ["pronto", 3, "En 3 días"]);
  assert.equal(vencimiento("2026-11-20T23:59:00-05:00", AHORA).estado, "abierto");
});

test("haceDias y pct", () => {
  assert.equal(haceDias("2026-11-07T08:00:00-05:00", AHORA), "hoy");
  assert.equal(haceDias("2026-11-06T08:00:00-05:00", AHORA), "ayer");
  assert.equal(haceDias("2026-11-02T08:00:00-05:00", AHORA), "hace 5 días");
  assert.equal(pct(0.666), "67 %");
});
