import test from "node:test";
import assert from "node:assert/strict";
import { sqlConteosEntidad } from "../src/routes/entidades.js";

// Los conteos de las pestañas de la ficha de una entidad (GET /entidades/:ruc/conteos, 2026-10-27).

test("conteos de la ficha: el RUC va como literal y las órdenes se cuentan sólo con su resumen (migración 148)", () => {
  const sin = sqlConteosEntidad("20613796909", false);
  assert.match(sin, /m\.entidad_ruc = '20613796909' AND m\.monto > 0/);
  assert.match(sin, /x\.alcance = 'ent:20613796909'/);
  // Si tiene órdenes: la más reciente por el índice (entidad, fecha), nunca un recorrido de las 29 M.
  assert.match(sin, /o\.entidad_ruc = '20613796909'[\s\S]*ORDER BY o\.fecha_emision DESC LIMIT 1/);
  assert.doesNotMatch(sin, /entidad_orden_anual/);
  assert.match(sqlConteosEntidad("20613796909", true), /FROM entidad_orden_anual a WHERE a\.entidad_ruc = '20613796909'/);
});

test("conteos de la ficha: lo que no es un RUC no llega a la consulta", () => {
  assert.throws(() => sqlConteosEntidad("2061379690' OR '1'='1", false));
  assert.throws(() => sqlConteosEntidad("123", true));
});
