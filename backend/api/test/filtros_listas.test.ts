import test from "node:test";
import assert from "node:assert/strict";
import { ListaOrdenesQuery, sqlListaOrdenes } from "../src/routes/ordenes.js";
import { ListaMenoresQuery, condicionesMenores, sqlFacetasMenores } from "../src/routes/menores.js";
import { ListQuery, ocidsDeGanadora } from "../src/routes/contratos_sql.js";

// Los filtros de las listas de Contratos, Órdenes y Menores (2026-10-26): qué acepta cada parámetro y dónde cae en la SQL.

const ordenes = (q: Record<string, string>) => ListaOrdenesQuery.parse({ size: "25", ...q });

test("órdenes: el estado se acepta en cualquier caja y sólo uno de los tres", () => {
  assert.equal(ordenes({ estado: "Devengada" }).estado, "devengada");
  assert.equal(ordenes({ estado: "emitida" }).estado, "emitida");
  assert.equal(ListaOrdenesQuery.safeParse({ estado: "Anulada" }).success, false);
  assert.equal(ListaOrdenesQuery.safeParse({ estado: "x' OR 1=1 --" }).success, false);
});

test("órdenes: cómo se contrató, monto, persona y antecedente salen de listas cerradas", () => {
  for (const [k, v] of [["como", "catalogo"], ["monto", "mas_500k"], ["persona", "natural"], ["antecedente", "fraccionamiento"]]) {
    assert.equal(ListaOrdenesQuery.safeParse({ [k]: v }).success, true, `${k}=${v}`);
    assert.equal(ListaOrdenesQuery.safeParse({ [k]: "otra_cosa" }).success, false, `${k}=otra_cosa`);
  }
});

test("órdenes: sin texto, los filtros van dentro de la ventana y la ventana es la página más un margen", () => {
  const { sql, vals, acotada, acotable, ventana } = sqlListaOrdenes(ordenes({ estado: "devengada", como: "catalogo", persona: "empresa" }));
  const [enVentana, despues] = sql.split("), d AS (");
  assert.match(enVentana, /o\.estado = 'Devengada'/);
  assert.match(enVentana, /o\.tipo_contratacion ~\* '\^derivad\[oa\] de contrataci\.n por cat\.logo'/);
  assert.match(enVentana, /o\.ruc_contratista LIKE '20%'/);
  assert.match(enVentana, /LIMIT 47\b/); // ceil(26 × 1.02) + 20
  assert.doesNotMatch(despues.split("FROM d o")[1], /WHERE/);
  assert.equal(acotada, false);
  assert.equal(acotable, true);
  assert.equal(ventana, null);
  assert.deepEqual(vals, []); // los valores de listas cerradas van como literales: ningún parámetro
});

test("órdenes: con texto, los filtros van después de una ventana de 1 500 y la respuesta dice cuántas revisó", () => {
  const { sql, acotada, ventana } = sqlListaOrdenes(ordenes({ q: "cemento", estado: "emitida" }));
  const [enVentana, despues] = sql.split("), d AS (");
  assert.doesNotMatch(enVentana, /o\.estado = 'Emitida'/);
  assert.match(despues, /WHERE o\.estado = 'Emitida' AND mef_norm\(/);
  assert.match(enVentana, /LIMIT 1500\b/);
  assert.equal(acotada, true);
  assert.equal(ventana, 1500);
});

test("órdenes: la versión acotada (cuando la completa no termina a tiempo) mueve los filtros después de la ventana", () => {
  const q = ordenes({ entidad: "20131257750", estado: "devengada" });
  assert.equal(sqlListaOrdenes(q).acotable, true);
  const a = sqlListaOrdenes(q, true);
  assert.equal(a.acotada, true);
  assert.equal(a.acotable, false);
  assert.match(a.sql.split("), d AS (")[0], /o\.entidad_ruc = '20131257750'/);
  assert.match(a.sql.split("), d AS (")[1], /WHERE o\.estado = 'Devengada'/);
  // Sin filtros que mover, no hay versión acotada (la consulta va con el plazo de siempre).
  assert.equal(sqlListaOrdenes(ordenes({ entidad: "20131257750" })).acotable, false);
});

test("órdenes: el parentesco parte de persona_senal; las órdenes partidas, de una subconsulta por fila", () => {
  const nep = sqlListaOrdenes(ordenes({ antecedente: "nepotismo" })).sql;
  assert.match(nep, /FROM persona_senal ps JOIN conosce_ordenes o ON o\.entidad_ruc = ps\.entidad_ruc AND o\.ruc_contratista = ps\.ruc WHERE ps\.tipo = 'nepotismo'/);
  const fr = sqlListaOrdenes(ordenes({ antecedente: "fraccionamiento" })).sql.split("), d AS (")[0];
  assert.match(fr, /\(SELECT true FROM ordenes_fraccionadas f WHERE .* LIMIT 1\) IS NOT NULL/s);
});

test("órdenes: la región compara el Callao de CONOSCE con el de las entidades, y va como parámetro", () => {
  const { sql, vals } = sqlListaOrdenes(ordenes({ region: "Callao" }));
  assert.match(sql, /mef_norm\(replace\(COALESCE\(o\.departamento, ''\), 'PROV\.CONSTITUC\.DEL ', ''\)\) = mef_norm\(\$1\)/);
  assert.deepEqual(vals, ["Callao"]);
});

const menores = (q: Record<string, string>) => ListaMenoresQuery.parse({ size: "25", ...q });

test("menores: antecedentes, persona, monto y objeto salen de listas cerradas", () => {
  assert.equal(menores({ antecedente: "no_habido", persona: "empresa", monto: "cerca_tope", objeto: "consultoria" }).antecedente, "no_habido");
  for (const [k, v] of [["antecedente", "x"], ["persona", "juridica"], ["monto", "1"], ["objeto", "BIEN"]]) {
    assert.equal(ListaMenoresQuery.safeParse({ [k]: v }).success, false, `${k}=${v}`);
  }
});

test("menores: la región es la de la entidad y el requerimiento, el que se puede abrir", () => {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesMenores(menores({ region: "Áncash", conReq: "si", proveedor: "20614730464" }), vals);
  assert.ok(ancla.includes("m.proveedor_ruc = '20614730464'"));
  assert.ok(filtros.some((f) => f.faceta === "region" && f.sql === "x.entidad_region = upper(immutable_unaccent($1))"));
  assert.ok(filtros.some((f) => f.faceta === "conReq" && f.sql === "x.req_r2"));
  assert.deepEqual(vals, ["Áncash"]);
});

test("menores: cada conteo lleva los demás filtros, no el suyo", () => {
  const { sql } = sqlFacetasMenores(menores({ antecedente: "baja", persona: "natural" }), [2026, 2025]);
  // f0 = antecedente, f1 = persona. El conteo de «baja» no lleva su propio filtro; el de «empresa», no el de persona.
  assert.match(sql, /count\(\*\) FILTER \(WHERE y\.f1 AND y\.o\d+\)::int AS "antecedente:baja"/);
  assert.match(sql, /count\(\*\) FILTER \(WHERE y\.f0 AND y\.o\d+\)::int AS "persona:empresa"/);
  assert.match(sql, /count\(\*\) FILTER \(WHERE y\.f0 AND y\.f1 AND y\.o\d+\)::int AS "anio:2026"/);
});

test("contratos: el dato de la empresa ganadora es uno de la lista y va como literal", () => {
  assert.equal(ListQuery.safeParse({ ganadora: "no_habida" }).success, true);
  assert.equal(ListQuery.safeParse({ ganadora: "sancion_vigente" }).success, false); // ése es un antecedente del contrato
  assert.equal(ListQuery.safeParse({ ganadora: "x'] OR TRUE --" }).success, false);
  assert.equal(ListQuery.safeParse({ dudoso: "si" }).success, true);
  assert.equal(ListQuery.safeParse({ dudoso: "no" }).success, false);
  assert.match(ocidsDeGanadora("dada_de_baja"), /er\.tipos @> ARRAY\['dada_de_baja'\]::text\[\]/);
  assert.match(ocidsDeGanadora("dada_de_baja"), /OFFSET 0/);
});
