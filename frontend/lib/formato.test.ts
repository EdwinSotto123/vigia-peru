import test from "node:test";
import assert from "node:assert/strict";
import {
  coincide,
  decimal,
  fecha,
  fechaConAnio,
  fechaCorta,
  hoyLima,
  listaY,
  numero,
  oracion,
  paraBuscar,
  plural,
  porcentaje,
  relativo,
  soles,
  solesCompacto,
} from "./formato.ts";

const NBSP = "\u00a0";
const FINO = "\u202f";

test("numero: enteros con coma de miles y valores faltantes", () => {
  assert.equal(numero(18393), "18,393");
  assert.equal(numero(18393.6), "18,394");
  assert.equal(numero(0), "0");
  assert.equal(numero(null), "Sin dato");
  assert.equal(numero(undefined), "Sin dato");
  assert.equal(numero(Number.NaN), "Sin dato");
  assert.equal(numero(Number.POSITIVE_INFINITY), "Sin dato");
});

test("plural: singular solo para 1 y formato de miles en el numero", () => {
  assert.equal(plural(1, "contrato", "contratos"), "1 contrato");
  assert.equal(plural(0, "contrato", "contratos"), "0 contratos");
  assert.equal(plural(2, "contrato", "contratos"), "2 contratos");
  assert.equal(plural(2000, "contrato", "contratos"), "2,000 contratos");
});

test("fecha: formato completo en hora de Lima, fecha sola sin correrse de dia y nulos", () => {
  assert.equal(fecha("2026-09-24"), "24 de setiembre de 2026");
  // 02:00 UTC del 25 de setiembre aun es 24 de setiembre (21:00) en Lima.
  assert.equal(fecha("2026-09-25T02:00:00Z"), "24 de setiembre de 2026");
  assert.equal(fecha(null), "Sin fecha");
  assert.equal(fecha(undefined), "Sin fecha");
  assert.equal(fecha(""), "Sin fecha");
  assert.equal(fecha("no-es-fecha"), "Sin fecha");
});

test("fechaCorta: omite el anio en curso y lo muestra en otros anios", () => {
  const anioActual = Number(hoyLima().slice(0, 4));
  const anioAnterior = anioActual - 2;

  assert.equal(fechaCorta(`${anioActual}-09-24`), "24 set.");
  assert.equal(fechaCorta(`${anioAnterior}-09-24`), `24 set. ${anioAnterior}`);
  assert.equal(fechaCorta(null), "Sin fecha");
  assert.equal(fechaCorta(""), "Sin fecha");
});

test("fechaConAnio: siempre incluye el anio, incluso para el anio en curso", () => {
  const anioActual = Number(hoyLima().slice(0, 4));

  assert.equal(fechaConAnio(`${anioActual}-09-24`), `24 set. ${anioActual}`);
  assert.equal(fechaConAnio("2024-09-24"), "24 set. 2024");
  assert.equal(fechaConAnio(null), "Sin fecha");
  assert.equal(fechaConAnio("invalida"), "Sin fecha");
});

test("soles y solesCompacto: precision segun rango, espacios duros y nulos", () => {
  assert.equal(soles(45000), `S/${NBSP}45,000`);
  assert.equal(soles(12.345), `S/${NBSP}12.35`);
  assert.equal(soles(0.0205), `S/${NBSP}0.0205`);
  assert.equal(soles(null), "Sin dato");

  assert.equal(solesCompacto(1_500_000_000_000), `S/${NBSP}1.5${NBSP}billones`);
  assert.equal(solesCompacto(1_000_000_000_000), `S/${NBSP}1.0${NBSP}billón`);
  assert.equal(solesCompacto(1_500_000_000), `S/${NBSP}1.5${NBSP}mil${NBSP}M`);
  assert.equal(solesCompacto(5_100_000), `S/${NBSP}5.1${NBSP}M`);
  assert.equal(solesCompacto(840_000), `S/${NBSP}840${NBSP}mil`);
  assert.equal(solesCompacto(320), `S/${NBSP}320`);
  assert.equal(solesCompacto(undefined), "Sin dato");
});

test("decimal, porcentaje y listaY: formato es-PE y enumeracion", () => {
  assert.equal(decimal(4.56, 1), "4.6");
  assert.equal(decimal(null), "Sin dato");
  assert.equal(porcentaje(12.4), `12${FINO}%`);
  assert.equal(porcentaje(12.45, { decimales: 1 }), `12.5${FINO}%`);
  assert.equal(porcentaje(undefined), "Sin dato");
  assert.equal(listaY([]), "");
  assert.equal(listaY(["Lima"]), "Lima");
  assert.equal(listaY(["Lima", "Cusco"]), "Lima y Cusco");
  assert.equal(listaY(["Lima", "Cusco", "Piura"]), "Lima, Cusco y Piura");
});

test("oracion, relativo, hoyLima, paraBuscar y coincide", () => {
  assert.equal(oracion("ADQUISICION DE VIVERES PARA LA TROPA"), "Adquisición de víveres para la tropa");
  assert.equal(oracion("contratación de la obra"), "Contratación de la obra");

  const ahora = Date.parse("2026-09-25T15:00:00Z");
  assert.equal(relativo(ahora - 30_000, ahora), "hace un momento");
  assert.equal(relativo(ahora - 5 * 60_000, ahora), `hace 5${NBSP}min`);
  assert.equal(relativo(ahora - 3 * 3600_000, ahora), `hace 3${NBSP}h`);
  assert.equal(relativo(ahora - 30 * 3600_000, ahora), "ayer");
  assert.equal(relativo(ahora - 3 * 86_400_000, ahora), `hace 3${NBSP}días`);
  assert.equal(relativo(null, ahora), "Sin fecha");

  assert.equal(hoyLima(new Date("2026-09-25T02:00:00Z")), "2026-09-24");

  const limpio = paraBuscar("  José Ñúñez  —  Médico ");
  assert.equal(limpio, "jose nunez — medico");
  assert.equal(coincide(limpio, "medico jose"), true);
  assert.equal(coincide(limpio, "enfermero"), false);
  assert.equal(coincide(limpio, ""), true);
});
