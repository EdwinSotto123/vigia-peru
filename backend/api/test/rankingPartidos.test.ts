/**
 * GET /partidos/ranking: validación de parámetros y SQL (lib/rankingPartidos.ts), sin base de datos.
 * Lo que importa: los valores nunca entran en el texto SQL, el orden sale de una lista cerrada, el pedido sin
 * `limit` sigue devolviendo todo (compatibilidad) y la clave de caché distingue cada parámetro.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { RankingQuery, claveRanking, consultaGobiernos, consultaRanking } from "../src/lib/rankingPartidos.js";

const parse = (o: Record<string, string>) => RankingQuery.parse(o);

test("sin parámetros: período vigente, sin filtros y sin paginar (compatibilidad)", () => {
  const p = parse({});
  assert.equal(p.anio, 2022);
  assert.equal(p.limit, undefined);
  assert.equal(p.region, undefined);
  const { sql, vals } = consultaRanking(p);
  assert.deepEqual(vals, [2022]);
  assert.doesNotMatch(sql, /LIMIT/);
  assert.match(sql, /ORDER BY contratos DESC, procesos DESC, clave/);
  // Los procesos (migración 65) y la base de Vigía entran por su resumen por período y región (migración 78).
  assert.match(sql, /FROM partido_resumen_historia/);
  assert.match(sql, /FROM partido_resumen_vigia/);
});

test("cadenas vacías de la URL cuentan como sin filtro", () => {
  const p = parse({ region: "", q: "  ", limit: "", orden: "" });
  assert.equal(p.region, undefined);
  assert.equal(p.q, undefined);
  assert.equal(p.limit, undefined);
  assert.equal(p.orden, undefined);
});

test("region, q, conCola, orden y paginación: parámetros numerados y orden de lista cerrada", () => {
  const p = parse({ anio: "2018", region: "15", q: "Alianza", conCola: "1", orden: "cola", limit: "25", offset: "50" });
  const { sql, vals } = consultaRanking(p);
  assert.deepEqual(vals, [2018, "15", "%alianza%", 25, 50]);
  // La región filtra las dos partes del resumen con el mismo $2.
  assert.equal(sql.match(/AND region = \$2/g)?.length, 2);
  assert.match(sql, /immutable_unaccent\(lower\(nombre\)\) LIKE immutable_unaccent\(\$3\)/);
  assert.match(sql, /"enCola" > 0/);
  assert.match(sql, /ORDER BY "enCola" DESC, contratos DESC, clave LIMIT \$4 OFFSET \$5/);
  // El texto del pedido nunca se pega en la SQL.
  assert.doesNotMatch(sql, /alianza/i);
});

test("la búsqueda escapa los comodines de LIKE", () => {
  const { vals } = consultaRanking(parse({ q: "100%_x" }));
  assert.equal(vals[1], "%100\\%\\_x%");
});

test("contar: mismos filtros, sin orden ni paginación", () => {
  const { sql, vals } = consultaRanking(parse({ region: "21", q: "perú", limit: "25", offset: "25" }), true);
  assert.match(sql, /SELECT count\(\*\)::int AS total FROM base/);
  assert.doesNotMatch(sql, /LIMIT|ORDER BY (contratos|"enCola"|leidos|immutable_unaccent)/);
  assert.deepEqual(vals, [2022, "21", "%perú%"]);
});

test("valores inválidos se rechazan", () => {
  for (const o of [{ anio: "2020" }, { region: "1" }, { region: "150101" }, { orden: "DROP TABLE" }, { limit: "0" }, { limit: "101" }, { offset: "-1" }]) {
    assert.equal(RankingQuery.safeParse(o).success, false, JSON.stringify(o));
  }
});

test("gobiernos: con región, solo los de ese departamento", () => {
  const sin = consultaGobiernos(["a", "b"], 2022);
  assert.deepEqual(sin.vals, [2022, ["a", "b"]]);
  assert.doesNotMatch(sin.sql, /left\(ubigeo/);
  const con = consultaGobiernos(["a"], 2022, "15");
  assert.deepEqual(con.vals, [2022, ["a"], "15"]);
  assert.match(con.sql, /left\(ubigeo, 2\) = \$3/);
});

test("la clave de caché distingue cada parámetro y no depende de mayúsculas del texto", () => {
  const base = claveRanking(parse({}));
  for (const o of [{ region: "15" }, { q: "a" }, { conCola: "1" }, { orden: "nombre" }, { limit: "25" }, { limit: "25", offset: "25" }, { anio: "2018" }]) {
    assert.notEqual(claveRanking(parse(o)), base, JSON.stringify(o));
  }
  assert.equal(claveRanking(parse({ q: "ALIANZA" })), claveRanking(parse({ q: "alianza" })));
});
