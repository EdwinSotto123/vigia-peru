import test from "node:test";
import assert from "node:assert/strict";
import {
  acotar, armarHilos, dia, diasEntre, fechaEleccion, marcasEleccion, mesLargo, olasDeGestion, patronesDeSeries, secuenciasDeCruces, sumarMeses,
  type CruceSecuencia, type EventoHistoria, type PuntoSerie, type SerieHistoria,
} from "../src/lib/historia.js";

test("fechas: meses, días y elecciones", () => {
  assert.equal(sumarMeses("2023-01", -12), "2022-01");
  assert.equal(sumarMeses("2022-12", 1), "2023-01");
  assert.equal(sumarMeses("2022-11", 5), "2023-04");
  assert.equal(diasEntre("2025-01-28", "2025-02-14"), 17);
  assert.equal(dia(new Date("2024-03-05T00:00:00Z")), "2024-03-05");
  assert.equal(dia("2024-03-05T10:00:00"), "2024-03-05");
  assert.equal(dia("sin fecha"), null);
  assert.equal(mesLargo("2023-09"), "setiembre de 2023");
  // Como las escriben la ONPE y el JNE, con o sin espacio.
  assert.equal(fechaEleccion("ERM 2022"), "2022-10-02");
  assert.equal(fechaEleccion("EG2021"), "2021-04-11");
  assert.equal(fechaEleccion("ERM 2026"), "2026-10-04");
  assert.equal(fechaEleccion("EMC 2023"), null);
  assert.deepEqual(marcasEleccion("2022-01-01", "2023-12-31").map((m) => m.fecha), ["2022-10-02"]);
  assert.deepEqual(marcasEleccion("2016-01-01", "2026-12-31", "general").map((m) => m.fecha), ["2016-04-10", "2020-01-26", "2021-04-11", "2026-04-12"]);
});

/** Una serie mensual de `desde` a `hasta` con `n` por mes (y otros valores en los meses de `aparte`). */
function serie(desde: string, hasta: string, n: number, aparte: Record<string, number> = {}): PuntoSerie[] {
  const out: PuntoSerie[] = [];
  for (let m = desde; m <= hasta; m = sumarMeses(m, 1)) out.push({ periodo: m, n: aparte[m] ?? n });
  return out;
}

test("ola de gestión: los seis meses desde que asumió contra los mismos del año anterior", () => {
  // 20 órdenes a personas por mes; con la gestión nueva (enero de 2023), 90 por mes de enero a junio.
  const ola = Object.fromEntries(["2023-01", "2023-02", "2023-03", "2023-04", "2023-05", "2023-06"].map((m) => [m, 90]));
  const s = olasDeGestion({ unidad: "órdenes a personas", huecos: "cero", puntos: serie("2021-01", "2024-12", 20, ola) }, [{ fecha: "2023-01-01", quien: "la gestión de Somos Perú" }], {
    tipo: "ola_personas", minimo: 30, que: "las órdenes a personas", fuente: "CONOSCE (OECE)",
  });
  assert.equal(s.length, 1);
  assert.equal(s[0].severidad, "alta"); // 540 contra 120: más del cuádruple
  assert.match(s[0].titulo, /^Las órdenes a personas se multiplicaron por 4 con la gestión de Somos Perú$/);
  assert.match(s[0].explica, /540 órdenes a personas/);
  assert.match(s[0].explica, /120/);
  assert.equal(s[0].pasos.length, 3);

  // Desde cero no es una ola (antes no se reportaba): hace falta una base de 5.
  const cero = Object.fromEntries(["2022-01", "2022-02", "2022-03", "2022-04", "2022-05", "2022-06"].map((m) => [m, 0]));
  assert.equal(olasDeGestion({ unidad: "x", huecos: "cero", puntos: serie("2021-01", "2024-12", 20, { ...ola, ...cero }) }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 30, que: "x", fuente: "f" }).length, 0);
  // Si todas sus órdenes crecieron igual, no es una ola de personas.
  const todo = serie("2021-01", "2024-12", 100, Object.fromEntries(Object.keys(ola).map((m) => [m, 450])));
  assert.equal(olasDeGestion({ unidad: "x", huecos: "cero", puntos: serie("2021-01", "2024-12", 20, ola) }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 30, que: "x", fuente: "f", otros: todo }).length, 0);
  // Y si las demás no crecieron, sí, con su comparación en la explicación.
  const quietas = olasDeGestion({ unidad: "órdenes a personas", huecos: "cero", puntos: serie("2021-01", "2024-12", 20, ola) }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 30, que: "las órdenes a personas", fuente: "f", otros: serie("2021-01", "2024-12", 100) });
  assert.equal(quietas.length, 1);
  assert.match(quietas[0].explica, /Sus demás órdenes, en los mismos meses: de 600 a 600/);
  // Sin cambio, o con un cambio chico, no hay ola.
  assert.equal(olasDeGestion({ unidad: "x", huecos: "cero", puntos: serie("2021-01", "2024-12", 20) }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 30, que: "x", fuente: "f" }).length, 0);
  const poco = Object.fromEntries(["2023-01", "2023-02"].map((m) => [m, 30]));
  assert.equal(olasDeGestion({ unidad: "x", huecos: "cero", puntos: serie("2021-01", "2024-12", 2, poco) }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 100, que: "x", fuente: "f" }).length, 0);
  // La serie no cubre el año anterior: no se compara.
  assert.equal(olasDeGestion({ unidad: "x", huecos: "cero", puntos: serie("2022-06", "2024-12", 20, ola) }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 30, que: "x", fuente: "f" }).length, 0);
  // La planilla: si falta un mes publicado en los doce, no se compara (un mes sin publicar no es un cero).
  const conHueco = serie("2021-01", "2024-12", 20, ola).filter((p) => p.periodo !== "2022-03");
  assert.equal(olasDeGestion({ unidad: "x", huecos: "sin_dato", puntos: conHueco }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 30, que: "x", fuente: "f" }).length, 0);
  assert.equal(olasDeGestion({ unidad: "x", huecos: "cero", puntos: conHueco }, [{ fecha: "2023-01-01", quien: "g" }], { tipo: "t", minimo: 30, que: "x", fuente: "f" }).length, 1);
  // Si asumió pasado el 15, cuenta desde el mes siguiente (Boluarte, 7 de diciembre: desde diciembre).
  const dic = Object.fromEntries(["2022-12", "2023-01", "2023-02", "2023-03", "2023-04", "2023-05"].map((m) => [m, 80]));
  const b = olasDeGestion({ unidad: "x", huecos: "cero", puntos: serie("2020-01", "2024-12", 10, dic) }, [{ fecha: "2022-12-07", quien: "Dina Boluarte" }], { tipo: "t", minimo: 30, que: "las órdenes", fuente: "f" });
  assert.equal(b.length, 1);
  assert.match(b[0].explica, /diciembre de 2022 a mayo de 2023/);
});

const ev = (id: string, carril: EventoHistoria["carril"], extra: Partial<EventoHistoria> = {}): EventoHistoria => ({
  id, carril, tipo: "x", fecha: "2024-01-01", titulo: id, fuente: "f", ...extra,
});

test("acotar: por carril, primero los de una secuencia, los graves y los de más monto", () => {
  const xs = [
    ev("a", "control", { severidad: "baja", monto: 5 }),
    ev("b", "control", { severidad: "alta" }),
    ev("c", "control", { severidad: "baja", monto: 50 }),
    ev("d", "control", { severidad: "baja", fecha: "2020-01-01" }),
    ev("e", "obras"),
  ];
  const { eventos, omitidos } = acotar(xs, { control: 2 }, new Set(["d"]));
  // «d» va por la secuencia aunque sea el menos importante; con ella, el tope se estira para no dejar fuera a «b».
  assert.deepEqual(eventos.map((e) => e.id).sort(), ["b", "d", "e"]);
  assert.deepEqual(omitidos, { control: 2 });
  // Sin tope para un carril: van todos.
  assert.equal(acotar(xs, {}).eventos.length, 5);
});

const cruce = (x: Partial<CruceSecuencia>): CruceSecuencia => ({
  tipo: "visita_previa", severidad: "alta", fecha: "2025-01-28", monto: null, ocid: "1156321", detalle: {}, buena_pro: "2025-02-14", entidad: "GOBIERNO REGIONAL DE LORETO", codigo: "LP-1-2025", ...x,
});

test("secuencias de una empresa desde sus cruces, sin nombres de personas", () => {
  const s = secuenciasDeCruces(
    [
      cruce({ detalle: { cargo_funcionario: "Gerente", funcionario: "PEREZ QUISPE JUAN", buena_pro: "2025-02-14" } }),
      // El mismo contrato por otra persona de la empresa: una sola secuencia.
      cruce({ detalle: { cargo_funcionario: "Gerente" } }),
      cruce({ tipo: "recien_fundada_medio_ano", fecha: "2020-02-07", buena_pro: "2020-02-07", ocid: "99", detalle: { fundada: "2019-09-26", meses: 4 } }),
      cruce({ tipo: "empresa_espejo", severidad: "media", ocid: "77", buena_pro: "2023-07-19", detalle: { desde: "2022-09-09", sancionada: "OQ PHARMA S.A.C.", resolucion: "4348-2024-TCE-S1" } }),
      cruce({ tipo: "vendio_gobernante", severidad: "baja", ocid: "55", buena_pro: "2022-05-01", detalle: { proceso: "EG 2021", organizacion: "RENOVACION POPULAR" } }),
      // Un tipo que no es una secuencia, o sin contrato: no entra.
      cruce({ tipo: "unico_postor" }),
      cruce({ ocid: null }),
    ],
    (o) => `/app/contratos/${o}`,
  );
  assert.deepEqual(s.map((x) => x.tipo), ["visita_buena_pro", "fundada_gano", "espejo", "campana_gano"]);
  const v = s[0];
  assert.equal(v.titulo, "Visitó Gobierno Regional de Loreto y ganó 17 días después");
  assert.equal(v.href, "/app/contratos/1156321");
  assert.ok(!JSON.stringify(s).includes("PEREZ"), "el nombre de quien recibió la visita nunca sale");
  assert.match(v.pasos[0].texto, /lo recibió: Gerente/);
  assert.equal(s[1].titulo, "Ganó a los 4 meses de fundada");
  assert.deepEqual(s[1].pasos.map((p) => p.fecha), ["2019-09-26", "2020-02-07"]);
  assert.match(s[2].titulo, /Oq Pharma S\.a\.c\./i);
  assert.equal(s[3].pasos[0].fecha, "2021-04-11");
});

test("patrones: un pico con su contexto, el cierre del año y antes de una elección", () => {
  // Órdenes a personas: 20 por mes; en marzo de 2023, 120 (seis veces lo normal), tres meses después de que asumió una
  // gestión. Ese mes las visitas también se triplican.
  const personas: SerieHistoria = {
    carril: "personas", titulo: "Órdenes a personas naturales", medida: "n", unidad: "órdenes a personas", huecos: "cero",
    puntos: serie("2021-01", "2024-12", 20, { "2023-03": 120 }), fuente: "CONOSCE (OECE)",
  };
  const visitas: SerieHistoria = {
    carril: "visitas", titulo: "Visitas registradas", medida: "n", unidad: "visitas", huecos: "cero",
    puntos: serie("2021-01", "2024-12", 40, { "2023-03": 130 }), fuente: "Registro de Visitas",
  };
  const marcas = [{ fecha: "2023-01-01", tipo: "gobierno" as const, texto: "Asumió la gestión de Somos Perú" }];
  const ps = patronesDeSeries([personas, visitas], marcas);
  const pico = ps.find((p) => p.id === "pico:personas:2023-03");
  assert.ok(pico, "el pico de órdenes a personas");
  assert.equal(pico!.severidad, "alta"); // seis veces y con otro renglón arriba y una gestión nueva
  assert.match(pico!.titulo, /seis veces lo normal en marzo de 2023/);
  assert.match(pico!.explica, /también subieron visitas registradas/);
  assert.match(pico!.explica, /2 meses después de que asumió la gestión de Somos Perú/);
  // Sin la mediana de seis meses previos no hay pico (el primer semestre de la serie).
  assert.equal(ps.filter((p) => p.mes < "2021-07").length, 0);
  // Desde casi cero no es un pico: es la fuente que empezó a publicar (visitas de 0 a 400 al entrar a la plataforma).
  const desdeCero: SerieHistoria = { ...visitas, puntos: serie("2021-01", "2022-12", 0, { "2022-06": 400, "2022-07": 380, "2022-08": 390 }) };
  assert.equal(patronesDeSeries([desdeCero], []).length, 0);
  // Un pico en diciembre cuenta un grado menos y lo dice.
  const dicPico = patronesDeSeries([{ ...personas, puntos: serie("2021-01", "2024-12", 20, { "2023-12": 120 }) }], marcas)[0];
  assert.equal(dicPico.severidad, "baja");
  assert.match(dicPico.explica, /Es diciembre/);

  // Diciembre se lleva el 40 % de cada año: patrón de cierre del año.
  const dic: Record<string, number> = {};
  for (const a of ["2022", "2023"]) dic[`${a}-12`] = 73; // 11 meses de 10 + 73 = 183; 73/183 = 40 %
  const ordenes: SerieHistoria = {
    carril: "ordenes", titulo: "Órdenes de compra y de servicio", medida: "n", unidad: "órdenes", huecos: "cero",
    puntos: serie("2022-01", "2023-12", 10, dic), fuente: "CONOSCE (OECE)",
  };
  const fin = patronesDeSeries([ordenes], []).find((p) => p.tipo === "fin_de_anio");
  assert.ok(fin);
  assert.match(fin!.titulo, /el 40 %/);

  // Antes de las ERM 2022 (2 de octubre): de abril a setiembre, el triple que un año antes.
  const previos = Object.fromEntries(["2022-04", "2022-05", "2022-06", "2022-07", "2022-08", "2022-09"].map((m) => [m, 60]));
  const loc: SerieHistoria = { ...personas, puntos: serie("2020-01", "2023-06", 20, previos) };
  const ele = patronesDeSeries([loc], [{ fecha: "2022-10-02", tipo: "eleccion", texto: "Elecciones regionales y municipales 2022" }]);
  const antes = ele.find((p) => p.tipo === "antes_eleccion");
  assert.ok(antes);
  assert.equal(antes!.severidad, "alta");
  assert.match(antes!.titulo, /antes de las elecciones regionales y municipales 2022/);
});

test("hilos: la empresa que visitó y ganó, con banderas, obra paralizada y sanción", () => {
  const rutas = { contrato: (o: string) => `/app/contratos/${o}`, empresa: (r: string, v?: string) => `/empresa/${r}${v ? `?vista=${v}` : ""}` };
  const hilos = armarHilos({
    visitas: [
      {
        ruc: "20100000001", nombre: "CONSTRUCTORA ABC S.A.C.", primera: "2023-02-01", ultima: "2023-03-10", visitas: 5, visitantes: 2, decisores: 3,
        antes: 0, despues: "2023-03-23", dias: 13, despues_tipo: "contrato", despues_numero: "LP-1-2023", despues_detalle: "Obra de agua",
        despues_monto: 2_000_000, despues_ocid: "123", monto: 2_000_000,
      },
      // Sólo visitas, sin nada más: no es un hilo (una sola clase de hechos).
      { ruc: "20100000002", nombre: "OTRA S.A.", primera: "2023-01-01", ultima: "2023-01-01", visitas: 1, visitantes: 1, decisores: 0, antes: 3, despues: null, dias: null, despues_tipo: null, despues_numero: null, despues_detalle: null, despues_monto: null, despues_ocid: null, monto: 0 },
      // Un RUC 10 (persona natural) nunca es un hilo.
      { ruc: "10456789012", nombre: "JUAN PEREZ", primera: "2023-01-01", ultima: "2023-01-01", visitas: 1, visitantes: 1, decisores: 0, antes: 0, despues: "2023-01-02", dias: 1, despues_tipo: "orden", despues_numero: "1", despues_detalle: null, despues_monto: 100, despues_ocid: null, monto: 100 },
    ],
    banderas: [{ ocid: "123", ruc: "20100000001", proveedor: "CONSTRUCTORA ABC S.A.C.", fecha: "2023-03-23", monto: 2_000_000, severidad: "alta", n_alta: 1, objeto: "Obra de agua" }],
    obras: [{ codigo: 9, nombre: "Agua potable", inicio: "2023-05-01", monto: 2_000_000, paralizada: true, fecha_par: "2024-02-01", ejecutor_ruc: "20100000001", ejecutor: "CONSTRUCTORA ABC S.A.C." }],
    sanciones: [{ ruc: "20100000001", tipo: "temporal", desde: "2023-01-15", hasta: "2023-06-30" }],
  }, rutas);
  assert.equal(hilos.length, 1);
  const h = hilos[0];
  assert.equal(h.ruc, "20100000001");
  assert.equal(h.severidad, "alta");
  assert.equal(h.nombre, "CONSTRUCTORA ABC S.A.C.");
  assert.deepEqual(h.hechos.map((x) => x.tipo), ["sancion", "visitas", "despues", "contrato", "obra", "paralizada"]);
  assert.match(h.resumen, /visitó la entidad y le dieron un contrato \(LP-1-2023\) a los 13 días/);
  assert.match(h.resumen, /ganó mientras estaba sancionada/);
  assert.equal(h.hechos.find((x) => x.tipo === "despues")!.severidad, "alta"); // nunca le había vendido, a quien decide, 13 días
});
