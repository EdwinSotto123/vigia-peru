import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ErrorHallazgos, GRUPOS, METRICAS_FIJAS, MIN_PARES, cuantil, definiciones, evaluar, metricaCategoria, paresDe, percentilDe,
  ranking, seleccionarHallazgos, terminosDe, validarRanking, type Categoria, type FilaMetricas,
} from "../src/lib/hallazgos.js";
import { REGLAS_TIPO_ENTIDAD } from "../src/routes/entidades.js";

// Los hallazgos por entidad (lib/hallazgos.ts, migración 256): listas cerradas, pisos, pares y percentiles.

const MIGRACION = readFileSync(new URL("../../db/migrations/256_entidad_hallazgos.sql", import.meta.url), "utf8");

const EVENTOS: Categoria = { clave: "eventos", nombre: "Eventos, fiestas y espectáculos", terminos: ["evento", "fiesta", "juego luces"], excluir: ["compensable"] };
const DEFS = definiciones([EVENTOS]);

/** Una entidad con todo en cero salvo lo que se pase. */
function fila(ruc: string, x: Partial<FilaMetricas> = {}): FilaMetricas {
  return {
    ruc, nombre: `ENTIDAD ${ruc}`, grupo: "municipalidad_distrital", banda: 2, departamento: "LIMA", anio_completo: 2025, pim_ref: 10e6,
    adj_procesos: 0, adj_monto: 0, adj_directas: 0, adj_con_postores: 0, adj_unico: 0, adj_top5_monto: 0, adj_proveedores: 0,
    ord_ordenes: 0, ord_monto: 0, ord_monto_personas: 0, ord_ordenes_completos: 0, ord_monto_completos: 0, ord_monto_diciembre: 0,
    borde_ordenes: 0, mef_pim: null, mef_devengado: null, mef_pim_actual: null, mef_devengado_actual: null,
    ctl_informes: 0, ctl_penal: 0, obras_activas: 0, obras_paralizadas: 0, categorias: {},
    ...x,
  };
}

/** 40 pares con único postor entre 10 % y 49 % (sobre 40 procesos) y ejecución entre 70 % y 89 %. */
const PARES = Array.from({ length: 40 }, (_, i) => fila(`2000000${String(i).padStart(4, "0")}`, {
  adj_procesos: 50, adj_con_postores: 40, adj_unico: 4 + Math.floor(i / 2), adj_monto: 5e6, adj_top5_monto: 2e6, adj_proveedores: 20,
  ord_ordenes: 400, ord_monto: 2e6, ord_monto_personas: 4e5,
  mef_pim: 10e6, mef_devengado: 7e6 + i * 50_000,
  categorias: { eventos: { monto: 10_000 + i * 1_000, ordenes: 5 } },
}));
const porClave = (ms: ReturnType<typeof evaluar>, clave: string) => ms.find((m) => m.clave === clave)!;

test("entidad_clase de la 256 lleva las mismas reglas, en el mismo orden, que REGLAS_TIPO_ENTIDAD", () => {
  let desde = 0;
  for (const [tipo, patron] of REGLAS_TIPO_ENTIDAD) {
    const linea = `WHEN n ~ '${patron}' THEN ${tipo ? `'${tipo}'` : "NULL"}`;
    const i = MIGRACION.indexOf(linea, desde);
    assert.ok(i >= 0, `falta (o está fuera de orden) la regla de ${tipo}: ${patron.slice(0, 60)}…`);
    desde = i + linea.length;
  }
  // Las categorías sin frases: con <-> el índice GIN tiene que volver a calcular to_tsvector fila por fila.
  const inserts = MIGRACION.slice(MIGRACION.indexOf("INSERT INTO categoria_gasto"), MIGRACION.indexOf("ON CONFLICT (clave)"));
  assert.ok(!inserts.includes("<->"), "las consultas de categoria_gasto no llevan <->");
  // La expresión del índice de la 255, al carácter.
  assert.ok(MIGRACION.includes("to_tsvector('spanish'::regconfig, translate(lower(coalesce(descripcion, '')), 'áéíóúüñ', 'aeiouun'))"));
  // Los grupos de la base son los de la API.
  for (const g of Object.keys(GRUPOS)) assert.ok(MIGRACION.includes(`'${g}'`), `grupo ${g} en entidad_grupo`);
});

test("cuantiles y percentil de rango medio (los empates cuentan la mitad)", () => {
  assert.equal(cuantil([], 0.5), null);
  assert.equal(cuantil([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(cuantil([0, 10], 0.9), 9);
  assert.equal(percentilDe(5, []), null);
  assert.equal(percentilDe(10, [1, 2, 3, 4]), 100);
  assert.equal(percentilDe(0, [0, 0, 0, 0]), 50);
  // Empatar con el máximo cuando una de cada cinco o más lo comparte no es estar en el 10 % más alto.
  assert.equal(percentilDe(1, [...Array(75).fill(0), ...Array(25).fill(1)]), 87.5);
  assert.equal(percentilDe(1, [...Array(85).fill(0), ...Array(15).fill(1)]), 92.5);
});

test("pares: su grupo y su tercio de presupuesto; si el tercio no alcanza o no tiene presupuesto, todo el grupo", () => {
  const e = fila("20999999990", { banda: 3 });
  const otro = fila("20999999991", { grupo: "gobierno_regional", banda: 3 });
  const conTercio = [...PARES.map((p, i) => ({ ...p, banda: i < 20 ? 3 : 1 })), otro, e];
  const r = paresDe(e, conTercio);
  assert.equal(r.porBanda, true);
  assert.equal(r.pares.length, 20);
  assert.ok(!r.pares.some((p) => p.ruc === e.ruc || p.grupo !== e.grupo));
  const pocos = [...PARES.map((p, i) => ({ ...p, banda: i < MIN_PARES - 1 ? 3 : 1 })), e];
  assert.deepEqual([paresDe(e, pocos).porBanda, paresDe(e, pocos).pares.length], [false, 40]);
  assert.equal(paresDe({ ...e, banda: null }, conTercio).porBanda, false);
});

test("hallazgo: en el 10 % más alto, con piso y con 15 pares con el dato; el contexto nunca", () => {
  const e = fila("20999999990", {
    adj_procesos: 60, adj_con_postores: 50, adj_unico: 40, adj_monto: 9e7, adj_top5_monto: 2e7, adj_proveedores: 30,
    ord_ordenes: 500, ord_monto: 3e6, ord_monto_personas: 3e5,
    mef_pim: 10e6, mef_devengado: 3e6,
    categorias: { eventos: { monto: 400_000, ordenes: 80 } },
  });
  const ms = evaluar(e, PARES, DEFS);
  assert.equal(ms.length, DEFS.length);
  const unico = porClave(ms, "pct_unico_postor");
  assert.equal(unico.valor, 80);
  assert.equal(unico.hallazgo, true);
  assert.equal(unico.percentil, 100);
  assert.equal(unico.pares_con_dato, 40);
  assert.equal(unico.direccion, "alto");
  assert.deepEqual([unico.numerador, unico.denominador], [40, 50]);
  assert.match(unico.explicacion, /^En 80 % de sus procesos con competencia desde 2023 \(40 de 50.*la mediana de sus 40 pares es .*: está por encima del 100 % de ellos\.$/);
  assert.equal(unico.profundizar.herramienta, "consultar_datos");
  // La ejecución baja es hallazgo «bajo».
  const ejec = porClave(ms, "pct_ejecucion");
  assert.deepEqual([ejec.valor, ejec.hallazgo, ejec.direccion], [30, true, "bajo"]);
  assert.ok(ejec.veces_mediana! < 1);
  // El monto adjudicado es el más alto, pero es contexto.
  const monto = porClave(ms, "monto_adjudicado");
  assert.equal(monto.percentil, 100);
  assert.equal(monto.hallazgo, false);
  assert.equal(monto.tipo, "contexto");
  // Concepto de gasto: 400 mil de 3 M (13,3 %) contra pares de 0,5 % a 2,5 %.
  const ev = porClave(ms, "gasto_eventos");
  assert.equal(ev.hallazgo, true);
  assert.equal(ev.valor, 13.3);
  assert.deepEqual(ev.profundizar, {
    herramienta: "gasto_por_concepto",
    argumentos: { entidad_ruc: e.ruc, terminos: ["evento", "fiesta", "juego luces"], excluir: ["compensable"], desde: 2023, fuentes: ["ordenes"] },
  });
  // Lo que no destaca no es hallazgo (las personas naturales: 10 % como sus pares a 20 %).
  assert.equal(porClave(ms, "pct_personas_naturales").hallazgo, false);
  // Ordenados del más extremo al menos; sólo hallazgos.
  const h = seleccionarHallazgos(ms);
  assert.ok(h.length >= 3 && h.every((m) => m.hallazgo));
  assert.ok(h.findIndex((m) => m.clave === "pct_unico_postor") < h.findIndex((m) => m.clave === "gasto_eventos") || h[0].percentil === 100);
});

test("sin piso o con pocos pares no hay hallazgo, aunque la cifra sea la más alta", () => {
  // 3 de 4 procesos con un postor: 75 %, pero son 4 (piso: 10).
  const chica = fila("20999999990", { adj_procesos: 5, adj_con_postores: 4, adj_unico: 3, categorias: { eventos: { monto: 40_000, ordenes: 3 } }, ord_monto: 100_000, ord_ordenes: 20 });
  const ms = evaluar(chica, PARES, DEFS);
  assert.equal(porClave(ms, "pct_unico_postor").percentil, 100);
  assert.equal(porClave(ms, "pct_unico_postor").hallazgo, false);
  // 40 % en eventos, pero sólo S/ 40 mil (piso: S/ 50 mil).
  assert.equal(porClave(ms, "gasto_eventos").hallazgo, false);
  const grande = fila("20999999990", { adj_procesos: 60, adj_con_postores: 50, adj_unico: 40 });
  assert.equal(porClave(evaluar(grande, PARES.slice(0, MIN_PARES - 1), DEFS), "pct_unico_postor").hallazgo, false);
  assert.equal(porClave(evaluar(grande, PARES.slice(0, MIN_PARES), DEFS), "pct_unico_postor").hallazgo, true);
  // Sin el dato: valor null y una frase que lo dice.
  const sin = porClave(evaluar(fila("20999999990"), PARES, DEFS), "pct_unico_postor");
  assert.deepEqual([sin.valor, sin.percentil, sin.hallazgo], [null, null, false]);
  assert.match(sin.explicacion, /sin datos/);
});

test("conceptos de gasto: piso de S/ 50 mil, 1 % del total y 50 órdenes", () => {
  const d = metricaCategoria(EVENTOS);
  assert.equal(d.clave, "gasto_eventos");
  assert.equal(d.piso(fila("1", { ord_ordenes: 60, ord_monto: 10e6, categorias: { eventos: { monto: 60_000, ordenes: 4 } } })), false); // 0,6 %
  assert.equal(d.piso(fila("1", { ord_ordenes: 60, ord_monto: 1e6, categorias: { eventos: { monto: 60_000, ordenes: 4 } } })), true);
  assert.equal(d.piso(fila("1", { ord_ordenes: 40, ord_monto: 1e6, categorias: { eventos: { monto: 60_000, ordenes: 4 } } })), false);
  assert.equal(d.piso(fila("1", { ord_ordenes: 60, ord_monto: 1e6, categorias: { eventos: { monto: 49_000, ordenes: 4 } } })), false);
  assert.equal(d.partes(fila("1", { ord_monto: 0 })).valor, null);
  assert.equal(d.partes(fila("1", { ord_monto: 1e6 })).valor, 0);
});

test("terminosDe: la consulta de to_tsquery como términos para gasto_por_concepto", () => {
  assert.deepEqual(terminosDe("evento | (juego & luces) | (cena & (navidad | gala))"), ["evento", "juego luces", "cena navidad", "cena gala"]);
  assert.deepEqual(terminosDe("regalo | (tarjeta & consumo & !combustible)"), ["regalo", "tarjeta consumo"]);
  assert.deepEqual(terminosDe(null), []);
  assert.deepEqual(terminosDe("a | a"), ["a"]);
});

test("ranking: listas cerradas y 400 con las opciones", () => {
  const rechazo = (q: Record<string, string>, region: { mayus: string } | null = null, invalida = false) => {
    try {
      validarRanking(q, DEFS, region, invalida);
    } catch (e) {
      assert.ok(e instanceof ErrorHallazgos);
      assert.ok(e.detail.length < 1200);
      return e;
    }
    assert.fail(`debió rechazarse: ${JSON.stringify(q)}`);
  };
  assert.match(rechazo({}).detail, /Falta metrica.*pct_unico_postor.*gasto_eventos/);
  assert.deepEqual(rechazo({}).opciones, DEFS.map((d) => d.clave));
  assert.match(rechazo({ metrica: "sueldos", grupo: "nacional" }).detail, /«sueldos» no existe/);
  for (const m of ["constructor", "__proto__", "toString"]) rechazo({ metrica: m, grupo: "nacional" });
  assert.match(rechazo({ metrica: "pct_directas" }).detail, /Falta grupo.*municipalidad_distrital/);
  for (const g of ["alcaldias", "constructor", "__proto__"]) assert.match(rechazo({ metrica: "pct_directas", grupo: g }).detail, /no existe/);
  assert.match(rechazo({ metrica: "pct_directas", grupo: "nacional", region: "Atlantida" }, null, true).detail, /no es un departamento/);
  for (const banda of ["0", "4", "a"]) rechazo({ metrica: "pct_directas", grupo: "nacional", banda });
  rechazo({ metrica: "pct_directas", grupo: "nacional", orden: "random()" });
  for (const limite of ["0", "101", "-1", "1e2", "5; DROP"]) rechazo({ metrica: "pct_directas", grupo: "nacional", limite });
  const ok = validarRanking({ metrica: "pct_ejecucion", grupo: "gobierno_regional", banda: "2" }, DEFS, { mayus: "CUSCO" });
  assert.deepEqual([ok.orden, ok.banda, ok.region, ok.limite], ["asc", 2, "CUSCO", 20]);
  assert.equal(validarRanking({ metrica: "gasto_eventos", grupo: "municipalidad_distrital" }, DEFS, null).orden, "desc");
});

test("ranking: piso, región que sólo filtra la lista y percentil contra todo el grupo", () => {
  const conPiso = PARES.map((p, i) => ({ ...p, departamento: i % 2 ? "CUSCO" : "LIMA", ord_monto: 1e6, categorias: { eventos: { monto: 50_000 + i * 10_000, ordenes: 5 } } }));
  const chica = fila("20999999990", { departamento: "CUSCO", ord_monto: 100_000, ord_ordenes: 10, categorias: { eventos: { monto: 49_000, ordenes: 2 } } }); // 49 %, sin piso
  const todas = [...conPiso, chica, fila("20888888888", { grupo: "nacional", ord_monto: 1e6, categorias: { eventos: { monto: 9e5, ordenes: 9 } } })];
  const d = DEFS.find((x) => x.clave === "gasto_eventos")!;
  const r = ranking(todas, { metrica: d, grupo: "municipalidad_distrital", region: "CUSCO", banda: null, orden: "desc", limite: 5 });
  assert.equal(r.filas.length, 5);
  assert.ok(!r.filas.some((f) => f.ruc === chica.ruc), "sin piso no entra");
  assert.ok(!r.filas.some((f) => f.ruc === "20888888888"), "otro grupo no entra");
  assert.ok(r.filas.every((f) => f.departamento === "CUSCO"));
  assert.equal(r.con_dato, 41); // el percentil y la mediana son contra todo el grupo (con la chica)
  assert.ok(r.filas[0].valor >= r.filas[1].valor);
  assert.ok(r.filas[0].percentil! > 95);
  const asc = ranking(todas, { metrica: d, grupo: "municipalidad_distrital", region: null, banda: null, orden: "asc", limite: 3 });
  assert.ok(asc.filas[0].valor <= asc.filas[2].valor);
  // Una cifra de contexto no tiene piso: entran todas las que tienen el dato.
  const pim = METRICAS_FIJAS.find((x) => x.clave === "pim")!;
  assert.equal(ranking(todas.map((f) => ({ ...f, mef_pim: 1e6 })), { metrica: pim, grupo: "municipalidad_distrital", region: null, banda: null, orden: "desc", limite: 100 }).total, 41);
});
