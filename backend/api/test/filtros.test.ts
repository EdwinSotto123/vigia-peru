import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Lista as ListaEmpresas, TRAMOS_EMPRESA, filtros as filtrosEmpresas } from "../src/routes/empresas.js";
import { ListQuery, filtrosEntidades } from "../src/routes/entidades.js";
import { Lista as ListaPersonas, TRAMOS_PERSONA, filtros as filtrosPersonas } from "../src/routes/personas.js";
import { ListaPlanilla, ListaPlazas, TIPOS_PLAZA, conPariente, filtrosPlanilla, filtrosPlazas } from "../src/routes/planilla.js";

// Los filtros de las listas (2026-10-26): cada parámetro nuevo se valida como la URL lo trae y arma su condición; lo que
// no es una opción se rechaza (400), no se ignora en silencio.

test("empresas: los tramos (antigüedad, clientes, éxito, última venta) y el dato dudoso arman su condición", () => {
  const q = ListaEmpresas.parse({ antiguedad: "hasta1", clientes: "1", exito: "alto", ultima: "este", dudoso: "si", visitas: "clientes", antecedentes: "media" });
  const { conds, vals } = filtrosEmpresas(q);
  assert.ok(conds.includes(TRAMOS_EMPRESA.antiguedad.hasta1));
  assert.ok(conds.includes(TRAMOS_EMPRESA.clientes["1"]));
  assert.ok(conds.includes(TRAMOS_EMPRESA.exito.alto));
  assert.ok(conds.includes(TRAMOS_EMPRESA.ultima.este));
  assert.ok(conds.some((c) => c.includes("adj_dudosos > 0 OR e.ord_dudosas > 0")));
  assert.ok(conds.includes("e.visitas_clientes > 0"));
  assert.ok(conds.includes("e.n_alta = 0 AND e.n_media > 0"));
  // Texto fijo: ningún tramo pasa un valor del pedido a la consulta.
  assert.deepEqual(vals, []);
});

test("empresas: un tramo que no existe se rechaza; sin filtros no hay condiciones", () => {
  assert.equal(ListaEmpresas.safeParse({ antiguedad: "10a20" }).success, false);
  assert.equal(ListaEmpresas.safeParse({ exito: "medio" }).success, false);
  assert.equal(ListaEmpresas.safeParse({ visitas: "no" }).success, false);
  assert.deepEqual(filtrosEmpresas(ListaEmpresas.parse({})).conds, []);
});

test("empresas: el éxito al postular se cuenta en enteros (8 de cada 10, menos de 1 de cada 10), con 5 postulaciones o más", () => {
  assert.match(TRAMOS_EMPRESA.exito.alto, /postulaciones >= 5 AND 5 \* e\.ganadas >= 4 \* e\.postulaciones/);
  assert.match(TRAMOS_EMPRESA.exito.bajo, /postulaciones >= 5 AND 10 \* e\.ganadas < e\.postulaciones/);
});

test("entidades: tipo, provincia, partido, Contraloría, planilla, plazas y orden se validan y arman su condición", () => {
  const q = ListQuery.parse({ clase: "distrital", provincia: "1501", partido: "ALIANZA PARA EL PROGRESO", control: "penal", planilla: "alta", plazas: "senales", captura: "1", orden: "nombre" });
  const { conds, vals } = filtrosEntidades(q, "es", "es.nombre_norm");
  assert.equal(q.orden, "nombre");
  assert.ok(conds.some((c) => c.includes("IN ('municipal_distrital')")));
  assert.ok(conds.some((c) => c.startsWith("left(es.ubigeo, 4) = $")));
  assert.ok(conds.some((c) => c.includes("poder_entidad pp") && c.includes("pp.partido = $")));
  assert.ok(conds.some((c) => c.includes("'penal' = ANY (i.responsabilidades)")));
  assert.ok(conds.some((c) => c.includes("pp.sev = 3")));
  assert.ok(conds.some((c) => c.includes("s.n_senales > 0")));
  assert.ok(conds.some((c) => c.includes("p.n_captura > 0")));
  assert.deepEqual(vals, ["1501", "ALIANZA PARA EL PROGRESO"]);
});

test("entidades: los valores viejos de `clase` siguen valiendo; lo desconocido, no", () => {
  for (const c of ["ministerio", "regional", "municipal", "organismo", "provincial", "empresa", "sin"]) assert.ok(ListQuery.safeParse({ clase: c }).success, c);
  assert.equal(ListQuery.safeParse({ clase: "club" }).success, false);
  assert.equal(ListQuery.safeParse({ provincia: "15" }).success, false);
  assert.equal(ListQuery.safeParse({ orden: "puntaje" }).success, false);
  // Por contratos desde el 2026-10-27 (con dictamen hay ~180 de 3,162); `orden=dictamen` sigue valiendo.
  assert.equal(ListQuery.parse({}).orden, "contratos");
});

test("entidades: el nepotismo mira la lista ya calculada; sin ella, la condición va entidad por entidad", () => {
  const q = ListQuery.parse({ nepotismo: "1" });
  const conLista = filtrosEntidades(q, "es", "es.nombre_norm", [], ["20131373237"]);
  assert.ok(conLista.conds[0].includes("es.ruc::text = ANY ($1::text[])"));
  assert.deepEqual(conLista.vals, [["20131373237"]]);
  const sinLista = filtrosEntidades(q, "es", "es.nombre_norm");
  assert.ok(sinLista.conds[0].startsWith("EXISTS (SELECT 1 FROM dji_vinculos v WHERE v.entidad_ruc = es.ruc"));
  assert.deepEqual(sinLista.vals, []);
});

test("personas: el gobierno ('clave:año' de un período real) y los tramos de monto y meses arman su condición", () => {
  const q = ListaPersonas.parse({ gobierno: "alianza-para-el-progreso:2022", monto: "mas300", meses: "12a23" });
  const conds: string[] = [];
  const vals: unknown[] = [];
  filtrosPersonas(q, conds, vals);
  assert.ok(conds.includes("pe.gobiernos @> $1::text[]"));
  assert.deepEqual(vals[0], ["alianza-para-el-progreso:2022"]);
  assert.ok(conds.includes(TRAMOS_PERSONA.monto.mas300));
  assert.ok(conds.includes(TRAMOS_PERSONA.meses["12a23"]));
});

test("personas: un gobierno de un año sin elección o mal escrito se rechaza", () => {
  assert.equal(ListaPersonas.safeParse({ gobierno: "alianza-para-el-progreso:2020" }).success, false);
  assert.equal(ListaPersonas.safeParse({ gobierno: "Alianza Para El Progreso:2022" }).success, false);
  assert.equal(ListaPersonas.safeParse({ monto: "mucho" }).success, false);
  assert.equal(ListaPersonas.safeParse({ meses: "12" }).success, false);
});

test("planilla: el sueldo deja fuera lo dudoso; oficina y cargo sólo dentro de una entidad; el pariente locador por pares", () => {
  const forma = z.object(ListaPlanilla);
  const pares = { entidades: ["20131373237"], declarantes: ["PEREZ QUISPE JUAN"] };
  const enEntidad = forma.parse({ entidad: "20131373237", sueldo: "mas20", oficina: "GERENCIA DE ADMINISTRACION", cargo: "ASESOR", pariente: "si" });
  const conds = ["TRUE", "p.entidad_ruc = $1"];
  const vals: unknown[] = ["20131373237"];
  filtrosPlanilla(enEntidad, conds, vals, pares);
  assert.ok(conds.includes("p.dudoso IS NULL AND p.base >= 20000"));
  assert.ok(conds.some((c) => c.includes("upper(btrim(p.dependencia))") && c.endsWith("= $2")));
  assert.ok(conds.some((c) => c.includes("upper(btrim(p.cargo))") && c.endsWith("= $3")));
  assert.ok(conds.some((c) => c.includes("unnest($4::text[], $5::text[])")));
  assert.deepEqual(vals, ["20131373237", "GERENCIA DE ADMINISTRACION", "ASESOR", pares.entidades, pares.declarantes]);

  // En el país, la oficina y el cargo no filtran (serían decenas de miles): no llegan a la consulta.
  const enPais = forma.parse({ oficina: "GERENCIA DE ADMINISTRACION", cargo: "ASESOR" });
  const c2 = ["TRUE"];
  filtrosPlanilla(enPais, c2, [], null);
  assert.deepEqual(c2, ["TRUE"]);
  assert.equal(forma.safeParse({ sueldo: "mas30" }).success, false);
});

test("planilla: sin los pares calculados, el pariente locador se mira fila por fila", () => {
  const sql = conPariente("p", null, () => "$9");
  assert.ok(sql.startsWith("EXISTS (SELECT 1 FROM dji_vinculos v WHERE v.entidad_ruc = p.entidad_ruc AND v.declarante_norm = p.nombre_norm"));
  assert.ok(!sql.includes("$9"));
});

test("plazas: sin «sueldo alto» (no se calcula); abiertas hoy y los tramos arman su condición", () => {
  assert.ok(!(TIPOS_PLAZA as readonly string[]).includes("sueldo_alto"));
  const forma = z.object(ListaPlazas);
  assert.equal(forma.safeParse({ senal: "sueldo_alto" }).success, false);
  const q = forma.parse({ abierta: "si", sueldo: "6000a10000", experiencia: "menos1", vacantes: "varias" });
  const conds: string[] = [];
  filtrosPlazas(q, conds, []);
  assert.ok(conds.some((c) => c.startsWith("s.fecha_fin >= (now() AT TIME ZONE 'America/Lima')::date")));
  assert.ok(conds.includes("s.remuneracion >= 6000 AND s.remuneracion < 10000"));
  assert.ok(conds.includes("s.exp_general < 1"));
  assert.ok(conds.includes("s.vacantes > 1"));
  assert.equal(forma.safeParse({ experiencia: "5" }).success, false);
});
