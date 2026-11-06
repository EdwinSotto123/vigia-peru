import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEPARTAMENTOS, ErrorConsulta, FUENTES, LIMITE_DEFECTO, OTROS, aFilas, armarConsulta, regionDe, rucEmpresa, type Listas,
} from "../src/routes/datos.js";
import { ProveedoresEntidadQuery, SQL_PROVEEDORES_ENTIDAD, armarProveedoresEntidad } from "../src/routes/entidades.js";

// Las cifras del MCP de Gobserva (routes/datos.ts y GET /entidades/:ruc/proveedores, migración 254): todo de listas
// cerradas, los valores siempre como parámetros y ninguna persona natural.

const LISTAS: Listas = { sectores: ["EDUCACION", "GOBIERNOS LOCALES", "SALUD"], tiposSenal: ["fraccionamiento", "unico_postor"] };
const MIGRACION = readFileSync(new URL("../../db/migrations/254_mcp_datos.sql", import.meta.url), "utf8");

const armar = (p: Record<string, string>) => armarConsulta(p, LISTAS);
/** El mensaje del 400 de un pedido (falla la prueba si el pedido pasa). */
function rechazo(p: Record<string, string>): ErrorConsulta {
  try {
    armar(p);
  } catch (e) {
    assert.ok(e instanceof ErrorConsulta, `se esperaba ErrorConsulta, llegó ${String(e)}`);
    assert.ok(e.detail.length < 400, "el MCP sólo muestra mensajes de menos de 400 caracteres");
    return e;
  }
  assert.fail(`el pedido ${JSON.stringify(p)} debió rechazarse`);
}

test("fuente, medida, dimensión y filtro que no existen: 400 con las opciones que sí valen", () => {
  assert.match(rechazo({}).detail, /Falta fuente.*adjudicaciones, ordenes, presupuesto, senales, menores/);
  assert.match(rechazo({ fuente: "usuarios", medida: "x" }).detail, /fuente «usuarios» no existe.*adjudicaciones/);
  assert.match(rechazo({ fuente: "adjudicaciones" }).detail, /Falta medida.*monto_adjudicado, procesos, proveedores, pct_unico_postor, pct_directas/);
  assert.match(rechazo({ fuente: "ordenes", medida: "pim" }).detail, /medida «pim» no existe en ordenes.*monto_ordenes, ordenes, proveedores/);
  assert.match(rechazo({ fuente: "adjudicaciones", medida: "procesos", por: "persona" }).detail, /Dimensión «persona» no existe.*anio, mes, region/);
  assert.match(rechazo({ fuente: "adjudicaciones", medida: "procesos", por: "anio,region,nivel" }).detail, /Hasta 2 dimensiones/);
  assert.match(rechazo({ fuente: "adjudicaciones", medida: "procesos", por: "anio,anio" }).detail, /dos veces/);
  const e = rechazo({ fuente: "presupuesto", medida: "pim", proveedor: "20100362598" });
  assert.match(e.detail, /Filtro «proveedor» no existe en presupuesto.*anio_desde, anio_hasta, region, nivel, sector, entidad/);
  assert.deepEqual(e.opciones, Object.keys(FUENTES.presupuesto.filtros));
  // Las claves heredadas de Object no son fuentes, medidas ni dimensiones.
  rechazo({ fuente: "constructor", medida: "x" });
  rechazo({ fuente: "adjudicaciones", medida: "toString" });
  rechazo({ fuente: "adjudicaciones", medida: "procesos", por: "__proto__" });
});

test("orden y límite: listas cerradas", () => {
  assert.equal(armar({ fuente: "menores", medida: "compras" }).limite, LIMITE_DEFECTO);
  assert.match(armar({ fuente: "menores", medida: "compras", limite: "100", orden: "asc" }).sql, /ORDER BY g\.valor ASC NULLS LAST\s+LIMIT 100/);
  for (const limite of ["0", "101", "-1", "abc", "10; DROP TABLE x", "1e2"]) rechazo({ fuente: "menores", medida: "compras", limite });
  rechazo({ fuente: "menores", medida: "compras", orden: "random()" });
});

test("un RUC de persona natural (10, 15, 17) o un DNI no se consulta, ni como proveedor ni como entidad", () => {
  for (const fuente of ["adjudicaciones", "ordenes", "senales", "menores"]) {
    const medida = Object.keys(FUENTES[fuente].medidas)[0];
    for (const ruc of ["10123456789", "15123456789", "17123456789", "12345678"]) {
      assert.match(rechazo({ fuente, medida, proveedor: ruc }).detail, /persona natural: no se consulta/, `${fuente} ${ruc}`);
    }
    assert.match(rechazo({ fuente, medida, proveedor: "2010036259" }).detail, /RUC de 11 dígitos/);
  }
  assert.match(rechazo({ fuente: "adjudicaciones", medida: "procesos", entidad: "10123456789" }).detail, /persona natural/);
  assert.equal(rucEmpresa(" 20100362598 ", "proveedor"), "20100362598");
});

test("lo que escribe quien pregunta va como parámetro: nunca dentro de la SQL", () => {
  const plan = armar({
    fuente: "adjudicaciones", medida: "monto_adjudicado", por: "proveedor,region", region: "Junín", anio_desde: "2023", anio_hasta: "2025",
    entidad: "20131257750", proveedor: "20100362598", objeto: "consultoria de obra", tipo_proceso: "adjudicacion simplificada",
    unico_postor: "si", directa: "no", monto_min: "250000.5", nivel: "Gobiernos locales",
  });
  for (const v of ["JUNIN", "Junín", "2023", "2025", "20131257750", "20100362598", "Consultoría de Obra", "Adjudicación Simplificada", "250000.5", "local"]) {
    assert.ok(!plan.sql.includes(`'${v}'`) && !plan.sql.includes(v), `«${v}» quedó en la SQL`);
  }
  assert.deepEqual(plan.vals, ["JUNIN", 2023, 2025, "20131257750", "20100362598", "Consultoría de Obra", "Adjudicación Simplificada", 250000.5, "local"]);
  assert.deepEqual(plan.filtros, {
    region: "Junín", anio_desde: 2023, anio_hasta: 2025, entidad: "20131257750", proveedor: "20100362598", objeto: "Consultoría de Obra",
    tipo_proceso: "Adjudicación Simplificada", unico_postor: "si", directa: "no", monto_min: 250000.5, nivel: "local",
  });
  // Cada valor tiene su marcador y no sobra ninguno.
  const marcadores = new Set(plan.sql.match(/\$\d+/g));
  assert.equal(marcadores.size, plan.vals.length);
});

test("un valor con SQL no pasa por ningún filtro", () => {
  const malo = "x' OR 1=1 --";
  const pedidos: Record<string, string>[] = [
    { fuente: "adjudicaciones", medida: "procesos", region: malo },
    { fuente: "adjudicaciones", medida: "procesos", objeto: malo },
    { fuente: "adjudicaciones", medida: "procesos", tipo_proceso: malo },
    { fuente: "adjudicaciones", medida: "procesos", nivel: malo },
    { fuente: "adjudicaciones", medida: "procesos", unico_postor: malo },
    { fuente: "adjudicaciones", medida: "procesos", monto_min: "1; SELECT 1" },
    { fuente: "adjudicaciones", medida: "procesos", anio_desde: "2024 OR 1=1" },
    { fuente: "presupuesto", medida: "pim", sector: malo },
    { fuente: "senales", medida: "casos", tipo: malo },
    { fuente: "senales", medida: "casos", severidad: malo },
    { fuente: "menores", medida: "monto", objeto: malo },
    { fuente: "ordenes", medida: "ordenes", entidad: malo },
    { fuente: "adjudicaciones", medida: "procesos", "anio_desde) OR (1": "2024" },
  ];
  for (const p of pedidos) rechazo(p);
});

test("anio_desde mayor que anio_hasta: 400", () => {
  assert.match(rechazo({ fuente: "presupuesto", medida: "pim", anio_desde: "2026", anio_hasta: "2020" }).detail, /mayor/);
});

test("regiones: sin tildes ni mayúsculas, con prefijos, por ubigeo; lo demás, 400 con la lista", () => {
  assert.equal(regionDe("cusco")?.nombre, "Cusco");
  assert.equal(regionDe("Cuzco")?.mayus, "CUSCO");
  assert.equal(regionDe("junin")?.nombre, "Junín");
  assert.equal(regionDe("  JUNÍN ")?.nombre, "Junín");
  assert.equal(regionDe("región San Martín")?.mayus, "SAN MARTIN");
  assert.equal(regionDe("Prov. Constitucional del Callao")?.mayus, "CALLAO");
  assert.equal(regionDe("08")?.nombre, "Cusco");
  assert.equal(regionDe("Lima Metropolitana")?.mayus, "LIMA");
  assert.equal(regionDe("Narnia"), null);
  assert.equal(DEPARTAMENTOS.length, 25);
  assert.match(rechazo({ fuente: "ordenes", medida: "ordenes", region: "Narnia" }).detail, /no es un departamento.*Áncash.*Ucayali/);
});

test("listas de la base: sectores y tipos de señal se comparan sin tildes y sin guiones", () => {
  assert.deepEqual(armar({ fuente: "presupuesto", medida: "pim", sector: "Educación" }).vals, ["EDUCACION"]);
  assert.deepEqual(armar({ fuente: "senales", medida: "casos", tipo: "único postor" }).vals, ["unico_postor"]);
  assert.match(rechazo({ fuente: "presupuesto", medida: "pim", sector: "Minería" }).detail, /EDUCACION, GOBIERNOS LOCALES, SALUD/);
  // Una lista larga (los ~33 sectores del MEF) se corta en el mensaje y va entera en `opciones`.
  const largos = Array.from({ length: 40 }, (_, i) => `SECTOR NUMERO ${i + 1} DEL PRESUPUESTO`);
  const e = (() => {
    try { armarConsulta({ fuente: "presupuesto", medida: "pim", sector: "Minería" }, { ...LISTAS, sectores: largos }); } catch (x) { return x as ErrorConsulta; }
    assert.fail("debió rechazarse");
  })();
  assert.ok(e.detail.length < 400, `${e.detail.length} caracteres`);
  assert.match(e.detail, /40 en total/);
  assert.equal(e.opciones?.length, 40);
});

test("medidas por llave: se agrupa por la llave y después se cuenta (sin count(DISTINCT))", () => {
  const plan = armar({ fuente: "ordenes", medida: "proveedores", por: "anio" });
  assert.match(plan.sql, /m\.ruc AS k/);
  assert.match(plan.sql, /m\.ruc ~ '\^20\[0-9\]\{9\}\$'/);
  assert.doesNotMatch(plan.sql, /count\(DISTINCT/i);
  const pct = armar({ fuente: "adjudicaciones", medida: "pct_unico_postor" });
  assert.match(pct.sql, /bool_or\(m\.unico_postor\) AS x/);
  assert.doesNotMatch(pct.sql, /GROUP BY d/); // sin dimensiones: una sola fila
});

test("señales: el JOIN a la convocatoria sólo si una dimensión o un filtro lo pide; nunca las columnas de la persona", () => {
  assert.doesNotMatch(armar({ fuente: "senales", medida: "casos", por: "tipo" }).sql, /mcp_cruce_lugar/);
  assert.match(armar({ fuente: "senales", medida: "casos", por: "region" }).sql, /LEFT JOIN mcp_cruce_lugar c/);
  assert.match(armar({ fuente: "senales", medida: "casos", entidad: "20131257750" }).sql, /LEFT JOIN mcp_cruce_lugar c/);
  assert.deepEqual(armar({ fuente: "senales", medida: "casos", anio_desde: "2024", anio_hasta: "2024" }).vals, [2024, 2025]);
  const todo = JSON.stringify(FUENTES, (_k, v) => (typeof v === "function" ? v.toString() : v));
  assert.doesNotMatch(todo, /persona_doc|persona_nombre|persona_rol/);
});

test("filas: el grupo de los que no son empresas no lleva RUC ni nombre; la región y el nivel se muestran con su nombre", () => {
  const plan = armar({ fuente: "adjudicaciones", medida: "monto_adjudicado", por: "proveedor,region" });
  const filas = aFilas(plan, [
    { d0: null, n0: "QUISPE MAMANI JUAN", d1: "JUNIN", valor_n: 10 },
    { d0: "20100362598", n0: "SERVICIOS INTEGRADOS DE LIMPIEZA SA", d1: "SAN MARTIN", valor_n: 5 },
  ]);
  assert.deepEqual(filas[0], { proveedor: null, proveedor_nombre: OTROS, region: "Junín", valor: 10 });
  assert.deepEqual(filas[1], { proveedor: "20100362598", proveedor_nombre: "SERVICIOS INTEGRADOS DE LIMPIEZA SA", region: "San Martín", valor: 5 });
  const nivel = aFilas(armar({ fuente: "presupuesto", medida: "pim", por: "nivel" }), [{ d0: "local", valor_n: 1 }]);
  assert.deepEqual(nivel[0], { nivel: "Gobiernos locales", valor: 1 });
  const tipo = aFilas(armar({ fuente: "senales", medida: "casos", por: "tipo" }), [{ d0: "fraccionamiento", valor_n: 3 }]);
  assert.equal(typeof tipo[0].tipo_nombre, "string");
});

test("migración 254: sin RUC de personas, sin permiso para vigia_mcp y con la llave que pide REFRESH CONCURRENTLY", () => {
  assert.doesNotMatch(MIGRACION, /GRANT[^;]*TO[^;]*vigia_mcp/);
  assert.match(MIGRACION, /CASE WHEN a\.ruc_proveedor ~ '\^20\[0-9\]\{9\}\$' THEN a\.ruc_proveedor/);
  assert.match(MIGRACION, /CREATE UNIQUE INDEX mcp_adjudicacion_llave ON mcp_adjudicacion \(codigo_convocatoria, proveedor_clave\)/);
  assert.match(MIGRACION, /CREATE UNIQUE INDEX mcp_orden_otros_llave/);
  assert.match(MIGRACION, /CREATE UNIQUE INDEX mcp_cruce_lugar_llave/);
  assert.match(MIGRACION, /mcp_refrescar\(p_horas NUMERIC DEFAULT 0\) RETURNS jsonb\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(MIGRACION, /GRANT EXECUTE ON FUNCTION mcp_refrescar\(NUMERIC\) TO vigia_api_admin;/);
});

test("proveedores de una entidad: límite hasta 50 y la SQL sólo con marcadores", () => {
  assert.equal(ProveedoresEntidadQuery.parse({}).limite, 20);
  assert.equal(ProveedoresEntidadQuery.safeParse({ limite: "51" }).success, false);
  assert.equal(ProveedoresEntidadQuery.safeParse({ anio_desde: "2014" }).success, false);
  assert.deepEqual([...new Set(SQL_PROVEEDORES_ENTIDAD.match(/\$\d+/g))].sort(), ["$1", "$2", "$3", "$4"]);
});

test("proveedores de una entidad: sólo empresas en la lista, las demás sumadas sin RUC, partes del total y top 5", () => {
  const r = armarProveedoresEntidad("20131257750", 2024, 2025, {
    entidad: "SEGURO SOCIAL DE SALUD",
    proveedores: [
      { ruc: "20100362598", nombre: "EMPRESA A", monto_adjudicado: 600, procesos: 3, unico_postor: 1, directas: 1, procesos_en_consorcio: 0, monto_en_consorcio: 0, monto_ordenes: 200, ordenes: 4 },
      { ruc: "10123456789", nombre: "PERSONA", monto_adjudicado: 50, procesos: 1, unico_postor: 0, directas: 0, procesos_en_consorcio: 0, monto_en_consorcio: 0, monto_ordenes: 0, ordenes: 0 },
    ],
    empresas: 1,
    adjudicado: { monto: 900, procesos: 5, dudosos: 1, otra_moneda: 0 },
    ordenes_empresas: { monto: 300, ordenes: 6 },
    ordenes_otros: { monto: 800, ordenes: 40 },
    adjudicado_otros: { monto: 300, procesos: 2 },
    n_otros: 7,
    top5_adjudicado: 600,
    top5_ordenes: 200,
  });
  assert.deepEqual(r.proveedores.map((p) => p.ruc), ["20100362598"]);
  assert.deepEqual(r.total, { monto_adjudicado: 900, procesos: 5, monto_ordenes: 1100, ordenes: 46 });
  assert.equal(r.proveedores[0].pct_del_total, 40); // (600 + 200) / (900 + 1100)
  assert.equal(r.top5_pct, 40);
  assert.deepEqual(r.personas_naturales, { nombre: OTROS, n: 7, monto_adjudicado: 300, procesos: 2, monto_ordenes: 800, ordenes: 40 });
  assert.ok(!("ruc" in r.personas_naturales));
  assert.match(r.nota, /1 proceso\(s\) con un monto que parece mal cargado/);
});
