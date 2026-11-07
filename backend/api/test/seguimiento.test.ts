import test from "node:test";
import assert from "node:assert/strict";
import { ordenarPlazos } from "../src/lib/seguimiento.js";
import { PUNTAJE_CALZA, resumenParaTi } from "../src/lib/afinidad.js";

// El seguimiento de Gobserva Licitaciones (2026-11-07): los plazos de lo guardado y el resumen de «Para ti» para Inicio.

const AHORA = new Date("2026-11-07T15:00:00Z");

test("ordenarPlazos: en orden, sin vacíos ni rotos, y el próximo que no pasó", () => {
  const r = ordenarPlazos(
    [
      { clave: "buena_pro", fecha: "2026-11-20T00:00:00-05:00" },
      { clave: "convocatoria", fecha: "2026-11-05T00:00:00-05:00" },
      { clave: "consultas", fecha: "2026-11-10T23:59:00-05:00" },
      { clave: "cierre", fecha: null },
      { clave: "cierre", fecha: "no es fecha" },
    ],
    AHORA,
  );
  assert.deepEqual(r.plazos.map((p) => p.clave), ["convocatoria", "consultas", "buena_pro"]);
  assert.equal(r.plazos[1].etiqueta, "Fin de consultas y observaciones");
  assert.equal(r.proximo?.clave, "consultas");
});

test("ordenarPlazos: el fin de consultas en el mismo minuto que el cierre de un menor queda sólo como cierre", () => {
  const r = ordenarPlazos(
    [
      { clave: "convocatoria", fecha: "2026-11-06T12:04:00-05:00" },
      { clave: "consultas", fecha: "2026-11-09T13:00:00-05:00" },
      { clave: "cierre", fecha: "2026-11-09T13:00:00-05:00" },
    ],
    AHORA,
  );
  assert.deepEqual(r.plazos.map((p) => p.clave), ["convocatoria", "cierre"]);
  assert.equal(r.proximo?.clave, "cierre");
  // Si las consultas cierran antes que la cotización, quedan los dos.
  const d = ordenarPlazos([{ clave: "consultas", fecha: "2026-11-08T10:00:00-05:00" }, { clave: "cierre", fecha: "2026-11-09T13:00:00-05:00" }], AHORA);
  assert.deepEqual(d.plazos.map((p) => p.clave), ["consultas", "cierre"]);
});

test("ordenarPlazos: sin plazos por venir, el próximo es null", () => {
  assert.equal(ordenarPlazos([{ clave: "cierre", fecha: "2026-11-01T10:00:00-05:00" }], AHORA).proximo, null);
});

test("resumenParaTi: sólo lo que calza, por fuente, lo que cierra en 7 días y el valor de las licitaciones", () => {
  const r = resumenParaTi(
    [
      { fuente: "proceso", puntaje: 90, valor: 100_000, cierra: null, consultasHasta: "2026-11-10" },
      { fuente: "proceso", puntaje: 50, valor: null, cierra: null, consultasHasta: "2026-12-30" },
      { fuente: "menor", puntaje: PUNTAJE_CALZA, valor: null, cierra: "2026-11-08T17:00:00-05:00", consultasHasta: null },
      { fuente: "menor", puntaje: 40, valor: null, cierra: "2026-11-08T17:00:00-05:00", consultasHasta: null },
      { fuente: "proceso", puntaje: 30, valor: 5_000_000, cierra: null, consultasHasta: "2026-11-09" },
    ],
    AHORA,
  );
  assert.deepEqual(r, { calzan: 3, procesos: 2, menores: 1, cierranSemana: 2, valorEnJuego: 100_000 });
});

test("resumenParaTi: vacío, todo en cero", () => {
  assert.deepEqual(resumenParaTi([], AHORA), { calzan: 0, procesos: 0, menores: 0, cierranSemana: 0, valorEnJuego: 0 });
});
