import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAPA_NOMBRE, publicar, refRuc10 } from "../src/lib/privacidad.js";
import { cuiDeTexto } from "../src/lib/proceso.js";
import {
  COLS_OBRA, UMBRAL_OBRA, aObra, banderasInversion, banderasObra, condicionesInversiones, condicionesObras, facetasDe, palabras, quienObra,
  sqlFacetasObras, sqlListaObras, sqlResumenEntidad, type HechosObra,
} from "../src/lib/obras.js";
import { ListaObrasQuery } from "../src/routes/obras.js";

process.env.PRIVACIDAD_CLAVE = "clave-de-prueba-de-32-caracteres-o-mas";

// Obras públicas (INFOBRAS) e inversiones (Invierte.pe), migración 160.

const MIGRACION = readFileSync(new URL("../../db/migrations/160_obras_inversiones.sql", import.meta.url), "utf8");
const AL = "2026-10-26";
const tipos = (o: HechosObra, al = AL) => banderasObra(o, al).map((b) => `${b.tipo}:${b.severidad}`);

test("los umbrales de lib/obras.ts son los de obra_banderas() e inversion_banderas() en la migración", () => {
  const U = UMBRAL_OBRA;
  for (const trozo of [
    `v.dias_hoy >= ${U.paralizadaLargaDias}`,
    `v.atraso >= ${U.atrasoGravePuntos}`, `v.atraso >= ${U.atrasoPuntos}`,
    `v.adelanto >= ${U.adelantoGravePuntos}`, `v.adelanto >= ${U.adelantoPuntos}`, `o.fisico_real < ${U.adelantoFisicoMaximo}`,
    `> ${(U.adicionalesTopePct / 100).toFixed(2)} * v.base`, `> ${(U.adicionalesAltosPct / 100).toFixed(2)} * v.base`,
    `o.dias_ampliacion >= ${U.plazoAmpliadoPct / 100} * o.plazo_dias`, `o.dias_ampliacion >= o.plazo_dias`,
    `i.costo_actualizado >= ${U.sobrecostoExtremoVeces} * i.monto_viable`, `i.costo_actualizado >= ${U.sobrecostoVeces} * i.monto_viable`,
    `i.costo_actualizado - i.monto_viable >= ${U.sobrecostoMinimoSoles}`,
  ]) assert.ok(MIGRACION.includes(trozo), `la migración no tiene «${trozo}»`);
  assert.equal(U.plazoDuplicadoPct, 100);
});

test("el CUI de un texto: la misma regla en TS (cuiDeTexto) y en la base (cuis_de_texto)", () => {
  assert.equal(cuiDeTexto("EJECUCION DE LA OBRA MEJORAMIENTO DEL CAMINO VECINAL, CON CUI Nº 2655159"), "2655159");
  assert.equal(cuiDeTexto("C.U.I. 2233862 - MEJORAMIENTO"), "2233862");
  assert.equal(cuiDeTexto("Código Único de Inversión N° 2233862"), "2233862");
  assert.equal(cuiDeTexto("C¿DIGO ¿NICO DE INVERSI¿N 2511436"), "2511436");
  assert.equal(cuiDeTexto("CUI2345678"), null);           // sin separación no es el prefijo
  assert.equal(cuiDeTexto("CUI N° 12345678"), null);      // 8 dígitos no es un CUI
  assert.equal(cuiDeTexto("PROCESO 2345678 SIN PREFIJO"), null);
  // El mismo patrón, escrito para Postgres (\m \M en vez de \b).
  assert.ok(MIGRACION.includes(String.raw`'(?:\mC\.?\s?U\.?\s?I\M\.?|C.DIGO\s+.NICO\s+DE\s+INVERSI.N)[^0-9]{0,14}([0-9]{7})(?![0-9])'`));
});

test("paralización: hoy hace 180 días o más es grave; menos, media; una pasada, leve", () => {
  const p = { estado: "Paralizada", paralizada: true, causal_paralizacion: "Sin asignación presupuestal" };
  assert.deepEqual(tipos({ ...p, dias_paralizada: 179 }), ["obra_paralizada:media"]);
  assert.deepEqual(tipos({ ...p, dias_paralizada: 180 }), ["obra_paralizada_larga:alta"]);
  // Los días se cuentan hasta el día del archivo si INFOBRAS trae menos (la entidad no actualizó el número).
  assert.deepEqual(tipos({ ...p, dias_paralizada: 30, fecha_paralizacion: "2026-01-01" }), ["obra_paralizada_larga:alta"]);
  const b = banderasObra({ ...p, dias_paralizada: 30, fecha_paralizacion: "2026-01-01" }, AL)[0];
  assert.equal(b.dias, 298);
  assert.equal(b.causal, "Sin asignación presupuestal");
  assert.deepEqual(tipos({ estado: "Finalizado", paralizada: true, dias_paralizada: 4047 }), ["obra_paralizacion:baja"]);
  assert.deepEqual(tipos({ estado: "Paralizada", paralizada: true, dias_paralizada: 400, dudoso: ["fecha_imposible"] }), []);
});

test("atraso físico: 20 puntos o más (media), 40 o más (alta), sólo en una obra en ejecución o paralizada", () => {
  const e = { estado: "En Ejecución" };
  assert.deepEqual(tipos({ ...e, fisico_prog: 50, fisico_real: 30.1 }), []);
  assert.deepEqual(tipos({ ...e, fisico_prog: 50, fisico_real: 30 }), ["obra_atraso:media"]);
  assert.deepEqual(tipos({ ...e, fisico_prog: 90, fisico_real: 50 }), ["obra_atraso_grave:alta"]);
  assert.deepEqual(tipos({ estado: "Finalizado", fisico_prog: 100, fisico_real: 60 }), []);
  assert.deepEqual(tipos({ ...e, fisico_prog: 1705, fisico_real: 10 }), []);   // un avance imposible no dispara nada
});

test("pago por encima de lo construido: 30 puntos (media), 50 (alta), con el físico bajo 95 % y un dato creíble", () => {
  assert.deepEqual(tipos({ estado: "Finalizado", fisico_real: 60, financiero_pct: 89.9 }), []);
  assert.deepEqual(tipos({ estado: "Finalizado", fisico_real: 60, financiero_pct: 90 }), ["obra_pago_adelantado:media"]);
  assert.deepEqual(tipos({ estado: "En Ejecución", fisico_real: 40, financiero_pct: 90 }), ["obra_pagado_sin_avance:alta"]);
  assert.deepEqual(tipos({ estado: "Finalizado", fisico_real: 95, financiero_pct: 140 }), []);   // terminada: los adicionales suben el %
  assert.deepEqual(tipos({ estado: "Finalizado", fisico_real: 64.5, financiero_pct: 17363.04 }), []);
});

test("adicionales: netos de deductivos sobre el contrato; más del 15 % (alta), más del 10 % (media), el resto (baja)", () => {
  const c = { contrato_monto: 1_000_000, modalidad: "Contrata" };
  assert.deepEqual(tipos({ ...c, adicionales_monto: 150_000 }), ["obra_adicionales_altos:media"]);   // 15 % justo: dentro del tope
  assert.deepEqual(tipos({ ...c, adicionales_monto: 150_001 }), ["obra_adicionales_sobre_tope:alta"]);
  assert.deepEqual(tipos({ ...c, adicionales_monto: 200_000, deductivos_monto: 60_000 }), ["obra_adicionales_altos:media"]);
  assert.deepEqual(tipos({ ...c, adicionales_monto: 50_000 }), ["obra_adicionales:baja"]);
  // El tope del 15 % es de la Ley de Contrataciones: en otra modalidad (o sin modalidad), más del 10 % es «altos».
  assert.deepEqual(tipos({ ...c, modalidad: "Obras por impuestos", adicionales_monto: 400_000 }), ["obra_adicionales_altos:media"]);
  assert.deepEqual(tipos({ ...c, modalidad: null, adicionales_monto: 400_000 }), ["obra_adicionales_altos:media"]);
  assert.ok(MIGRACION.includes(`> 0.15 * v.base AND o.modalidad = 'Contrata'`));
  // Sin contrato (administración directa), sobre el expediente técnico; sin ninguno de los dos, sin porcentaje.
  const directa = banderasObra({ modalidad: "Administración directa", contrato_monto: 0, costo_et: 500_000, adicionales_monto: 100_000 }, AL)[0];
  assert.equal(`${directa.tipo}:${directa.severidad}`, "obra_adicionales_altos:media");
  assert.equal(directa.base_de, "expediente");
  assert.equal(directa.neto, 20);
  const sin = banderasObra({ adicionales_monto: 10_000 }, AL)[0];
  assert.equal(sin.tipo, "obra_adicionales");
  assert.equal(sin.porcentaje, null);
  assert.deepEqual(tipos({ ...c, adicionales_monto: 9_000_000, dudoso: ["adicionales_imposibles"] }), []);
});

test("plazo, controversias e informes de control, y el orden: lo más grave primero", () => {
  assert.deepEqual(tipos({ plazo_dias: 100, dias_ampliacion: 49 }), []);
  assert.deepEqual(tipos({ plazo_dias: 100, dias_ampliacion: 50 }), ["obra_plazo_ampliado:baja"]);
  assert.deepEqual(tipos({ plazo_dias: 100, dias_ampliacion: 100 }), ["obra_plazo_duplicado:media"]);
  assert.deepEqual(tipos({ controversias: 1, informes_control: 2, estado: "Paralizada", paralizada: true, dias_paralizada: 400 }),
    ["obra_paralizada_larga:alta", "obra_controversia:media", "obra_informe_control:baja"]);
});

test("inversión: costo actualizado 1.5 veces lo viable (media) o 2 (alta), con S/ 100 mil de diferencia; el laudo", () => {
  const t = (i: Parameters<typeof banderasInversion>[0]) => banderasInversion(i).map((b) => `${b.tipo}:${b.severidad}`);
  assert.deepEqual(t({ monto_viable: 1_000_000, costo_actualizado: 1_499_999 }), []);
  assert.deepEqual(t({ monto_viable: 1_000_000, costo_actualizado: 1_500_000 }), ["inversion_sobrecosto:media"]);
  assert.deepEqual(t({ monto_viable: 1_000_000, costo_actualizado: 2_000_000 }), ["inversion_sobrecosto_extremo:alta"]);
  assert.deepEqual(t({ monto_viable: 50_000, costo_actualizado: 140_000 }), []);   // triplicar S/ 50 mil no pasa los S/ 100 mil
  assert.deepEqual(t({ monto_viable: 1_000_000, costo_actualizado: 900_000, monto_laudo: 35_000 }), ["inversion_laudo:media"]);
  assert.equal(banderasInversion({ monto_viable: 1_000_000, costo_actualizado: 2_500_000 })[0].veces, 2.5);
});

test("quién ejecuta o supervisa: sólo sale un RUC bien escrito; lo que no se reconoce como empresa, sin nombre", () => {
  assert.deepEqual(quienObra("20509687669", "CONSTRUCTORA LA ESMERALDA EIRL"), { ruc: "20509687669", nombre: "CONSTRUCTORA LA ESMERALDA EIRL", tipo: "empresa" });
  assert.deepEqual(quienObra("10000000014", "FICTICIO PRUEBA JUAN"), { ruc: "10000000014", nombre: "FICTICIO PRUEBA JUAN", tipo: "persona" });
  assert.deepEqual(quienObra("C0002088241", "CONSORCIO MIGA SAC"), { ruc: null, nombre: "CONSORCIO MIGA SAC", tipo: "consorcio" });
  assert.deepEqual(quienObra("1000000001", "JUAN PEREZ QUISPE"), { ruc: null, nombre: null, tipo: "persona" });   // un RUC 10 al que le falta un dígito
  assert.deepEqual(quienObra("NO APLICA", "INGENIEROS CONTRATISTAS GENERALES S.A.C."), { ruc: null, nombre: "INGENIEROS CONTRATISTAS GENERALES S.A.C.", tipo: "empresa" });
  assert.equal(quienObra(null, null), null);
});

test("privacidad: el ejecutor persona natural sale con su ref y un apellido tapado; nunca su RUC ni el residente", () => {
  const fila = {
    codigo: 4, nombre: "MEJORAMIENTO DEL PUESTO DE SALUD", estado: "Paralizada", paralizada: true, dias_paralizada: 400,
    ejecutor_ruc: "10000000014", ejecutor_nombre: "FICTICIO PRUEBA JUAN", supervisor_ruc: "20450620158", supervisor_nombre: "SUPERVISORES ANDINOS S.A.C.",
    contrato_monto: 500000, banderas: [], dudoso: [],
  };
  const r = publicar({ data: [aObra(fila, AL)] });
  const json = JSON.stringify(r);
  assert.equal(r.data[0].ejecutor?.ruc, refRuc10("10000000014"));
  assert.equal(r.data[0].ejecutor?.nombre, `FICTICIO ${TAPA_NOMBRE} JUAN`);
  assert.ok(!json.includes("10000000014") && !json.includes("00000001"), "el RUC 10 (o su DNI) no sale");
  assert.equal(r.data[0].supervisor?.ruc, "20450620158");
  assert.equal(r.data[0].banderas[0].tipo, "obra_paralizada_larga");   // sin banderas guardadas, la misma regla
  assert.equal(r.data[0].url, "https://infobras.contraloria.gob.pe/InfobrasWeb/Mapa/Sumario?ObraId=4");
  // Las columnas que lee la API no traen al residente ni al supervisor de obra (no se guardan).
  assert.doesNotMatch(COLS_OBRA, /residente|apellidos/i);
});

test("las listas: el RUC va como literal y validado; la búsqueda, por parámetro; la empresa, por tres índices", () => {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesObras({ entidad: "20131378034", q: "Camino vecinal", bandera: "paralizada", estado: "ejecucion" }, vals);
  assert.match(ancla, /o\.entidad_ruc = '20131378034'/);
  assert.deepEqual(vals, ["%camino%", "%vecinal%"]);
  assert.ok(filtros.some((f) => f.faceta === "bandera" && /'obra_paralizada_larga', 'obra_paralizada'/.test(f.sql)));
  assert.ok(filtros.some((f) => f.faceta === "estado" && /o\.estado = 'En Ejecución'/.test(f.sql)));
  assert.throws(() => condicionesObras({ entidad: "2013137803' OR '1'='1" }, []));
  assert.throws(() => condicionesInversiones({ entidad: "123" }, []));
  const emp = condicionesObras({ empresa: "20450620158", rol: "supervision" }, []);
  assert.match(emp.ancla, /x\.ejecutor_ruc = '20450620158'[\s\S]*UNION[\s\S]*x\.supervisor_ruc = '20450620158'[\s\S]*cui_consorcio/);
  assert.ok(emp.filtros.some((f) => f.faceta === "rol" && /o\.supervisor_ruc = '20450620158'/.test(f.sql)));
  assert.match(sqlListaObras({ entidad: "20131378034" }, "monto", 3, 25).sql, /LIMIT 25 OFFSET 50/);
  assert.match(sqlFacetasObras({ entidad: "20131378034" }).sql, /"bandera:paralizada"/);
  assert.match(sqlResumenEntidad("20131378034"), /o\.entidad_ruc = '20131378034'[\s\S]*i\.entidad_ruc = '20131378034'/);
  assert.throws(() => sqlResumenEntidad("1"));
  assert.deepEqual(palabras("Ña de Huánuco, 2026"), ["huanuco", "2026"]);
});

test("una empresa se pide sólo con RUC 20; una entidad o una empresa, no las dos", () => {
  assert.equal(ListaObrasQuery.safeParse({ empresa: "10000000014" }).success, false);
  assert.equal(ListaObrasQuery.safeParse({ empresa: "20450620158" }).success, true);
  assert.equal(ListaObrasQuery.safeParse({ entidad: "20131378034", empresa: "20450620158" }).success, false);
  assert.equal(ListaObrasQuery.safeParse({}).success, false);
});

test("facetasDe: «faceta:opcion» → { faceta: { opcion } }, y las agrupadas tal cual", () => {
  assert.deepEqual(facetasDe({ total: 7, "estado:finalizada": 3, "bandera:con": 2, anio: { 2019: 4 } }, ["anio"]),
    { total: 7, facetas: { estado: { finalizada: 3 }, bandera: { con: 2 }, anio: { 2019: 4 } } });
  assert.deepEqual(facetasDe(undefined, []), { total: null, facetas: null });
});
