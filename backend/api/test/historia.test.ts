import test from "node:test";
import assert from "node:assert/strict";
import {
  acotar, dia, diasEntre, fechaEleccion, marcasEleccion, mesLargo, olasDeGestion, secuenciasDeCruces, sumarMeses,
  type CruceSecuencia, type EventoHistoria, type PuntoSerie,
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
