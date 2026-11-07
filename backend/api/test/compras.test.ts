import test from "node:test";
import assert from "node:assert/strict";
import { ComprasQuery, claseDeOrden, compararFecha, condicionHistoria, fuenteFija } from "../src/routes/compras.js";
import { sqlConteosEntidad } from "../src/routes/entidades.js";
import { palabrasBusqueda } from "../src/routes/personas.js";

// La lista de compras sin repetidas de una entidad o una empresa (GET /compras, migración 240, 2026-11-03).

test("compras: una entidad o un proveedor, nunca los dos ni ninguno", () => {
  assert.equal(ComprasQuery.safeParse({ entidad: "20393066386" }).success, true);
  assert.equal(ComprasQuery.safeParse({ proveedor: "20606951711" }).success, true);
  assert.equal(ComprasQuery.safeParse({}).success, false);
  assert.equal(ComprasQuery.safeParse({ entidad: "20393066386", proveedor: "20606951711" }).success, false);
});

test("compras: lo que va como literal en el SQL (RUC, contraparte) son 11 dígitos", () => {
  assert.equal(ComprasQuery.safeParse({ entidad: "2039306638' OR '1'='1" }).success, false);
  assert.equal(ComprasQuery.safeParse({ entidad: "20393066386", con: "1' OR 1=1" }).success, false);
  assert.equal(ComprasQuery.safeParse({ entidad: "20393066386", como: "todo" }).success, false);
  assert.equal(ComprasQuery.safeParse({ entidad: "20393066386", bandera: "cualquiera" }).success, false);
});

test("compras: una bandera o un filtro de contratos deja una sola fuente", () => {
  const q = (x: Record<string, unknown>) => ComprasQuery.parse({ entidad: "20393066386", ...x });
  assert.equal(fuenteFija(q({})), null);
  assert.equal(fuenteFija(q({ bandera: "sobreprecio" })), "catalogo");
  assert.equal(fuenteFija(q({ bandera: "al_borde_del_tope" })), "orden");
  assert.equal(fuenteFija(q({ bandera: "sunat" })), "menor");
  assert.equal(fuenteFija(q({ bandera: "antecedentes" })), "proceso");
  assert.equal(fuenteFija(q({ cruces: "con" })), "proceso");
});

test("compras: la mezcla de las fuentes va por fecha y lo que no la tiene, al final", () => {
  const fechas = ["2025-03-01", null, "2026-01-10", "2025-12-31"];
  assert.deepEqual([...fechas].sort((a, b) => compararFecha(a, b, "DESC")), ["2026-01-10", "2025-12-31", "2025-03-01", null]);
  assert.deepEqual([...fechas].sort((a, b) => compararFecha(a, b, "ASC")), ["2025-03-01", "2025-12-31", "2026-01-10", null]);
});

test("compras: la clase de una orden sola, como clase_orden() de la migración 240", () => {
  assert.equal(claseDeOrden("Deviene de Procesos de Selección"), "pago");
  assert.equal(claseDeOrden("Deviene de Exoneraciones / Contratación Directa"), "pago");
  assert.equal(claseDeOrden("Derivado de contratación por catálogo electrónico"), "catalogo");
  assert.equal(claseDeOrden("Contrataciones hasta 8 UIT (LEY 30225)(No incluye las derivadas de contrataciones por catálogo electrónico.)"), "directa");
  assert.equal(claseDeOrden(null), "directa");
});

test("conteos de la ficha: las compras sin repetidas salen de compra_resumen (migración 240)", () => {
  assert.doesNotMatch(sqlConteosEntidad("20393066386", true, true, true, false), /compra_resumen/);
  assert.match(sqlConteosEntidad("20393066386", true, true, true, true), /FROM compra_resumen cr WHERE cr\.entidad_ruc = '20393066386'/);
});

test("compras: con texto, la descripción y el número de orden se buscan en toda la historia (índice de la 255)", () => {
  const cond = (q: string | undefined) => {
    const vals: unknown[] = [];
    const sql = condicionHistoria(palabrasBusqueda(q), (v) => { vals.push(v); return `$${vals.length}`; });
    return { sql, vals };
  };
  // Las palabras van todas, por prefijo, sobre la misma expresión que el índice (minúsculas y sin tildes).
  const a = cond("Aniversario del distrito");
  assert.equal(a.sql, "to_tsvector('spanish'::regconfig, translate(lower(coalesce(o.descripcion, '')), 'áéíóúüñ', 'aeiouun')) @@ to_tsquery('spanish', $1)");
  assert.deepEqual(a.vals, ["aniversario:* & distrito:*"]);
  // Un número solo es un número de orden (los enlaces del chat: ?cq=6076).
  assert.deepEqual(cond("6076"), { sql: "o.nro_orden = ANY($1::text[])", vals: [["6076"]] });
  // Con letras, los números van en la descripción.
  assert.deepEqual(cond("coffee 2025").vals, ["coffee:* & 2025:*"]);
  // Sólo palabras vacías, o nada: no hay qué buscar en la historia (queda la ventana de siempre).
  assert.equal(cond("por los").sql, null);
  assert.equal(cond(undefined).sql, null);
});
