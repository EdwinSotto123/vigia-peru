import test from "node:test";
import assert from "node:assert/strict";
import { mismaPersona, nombreTapado, normalizarNombre, organizacionPublicable, palabrasDeBusqueda, palabrasRequeridas, paresDePalabras } from "../src/lib/funcionarios.js";

// Una persona sintética con cargo público: apellidos y nombres aparte, como en la declaración jurada.
const F = { paterno: "QUISPEMAYTA", materno: "HUAMANCHUMO", nombres: "ROBERTINO ELIAS" };

test("el nombre se publica con el apellido materno tapado, y sólo así", () => {
  const n = nombreTapado(F.paterno, F.nombres);
  assert.equal(n, "QUISPEMAYTA ••• ROBERTINO ELIAS");
  assert.equal(n.includes(F.materno), false);
});

test("las palabras de una búsqueda: sin tildes, la Ñ como N, de 3 letras o más; con un número, ninguna", () => {
  assert.deepEqual(palabrasDeBusqueda("  Robertino  quispemayta "), ["ROBERTINO", "QUISPEMAYTA"]);
  assert.deepEqual(palabrasDeBusqueda("Peña Núñez"), ["PENA", "NUNEZ"]);
  assert.deepEqual(palabrasDeBusqueda("De la O"), []);
  assert.deepEqual(palabrasDeBusqueda("Quispemayta 41234567"), []);
  assert.equal(normalizarNombre("Muñoz-Nájar,  José"), "MUNOZ NAJAR JOSE");
});

test("con el nombre completo se buscan sus pares de palabras: bastan dos que coincidan con lo visible", () => {
  assert.deepEqual(paresDePalabras(["A", "B"]), [["A", "B"]]);
  assert.deepEqual(paresDePalabras(["A", "B", "C"]), [["A", "B"], ["A", "C"], ["B", "C"]]);
  assert.equal(paresDePalabras(["A", "B", "C", "D", "E"]).length, 10);
});

test("lo que otra fila tiene que traer: los dos apellidos y el primer nombre; sin materno, el paterno y todos los nombres", () => {
  assert.deepEqual(palabrasRequeridas(F), ["QUISPEMAYTA", "HUAMANCHUMO", "ROBERTINO"]);
  assert.deepEqual(palabrasRequeridas({ paterno: "QUISPEMAYTA", materno: null, nombres: "ROBERTINO ELIAS" }), ["QUISPEMAYTA", "ROBERTINO", "ELIAS"]);
  assert.deepEqual(palabrasRequeridas({ paterno: "DE LA CRUZ", materno: "HUAMANCHUMO", nombres: "ROSA" }), ["DE", "LA", "CRUZ", "HUAMANCHUMO", "ROSA"]);
});

test("es la misma persona en otro registro: en cualquier orden, con o sin el segundo nombre", () => {
  const esEl = mismaPersona(F);
  assert.equal(esEl("QUISPEMAYTA HUAMANCHUMO ROBERTINO ELIAS"), true);
  assert.equal(esEl("Robertino Elías Quispemayta Huamanchumo"), true);   // las visitas se anotan «nombres apellidos»
  assert.equal(esEl("QUISPEMAYTA HUAMANCHUMO, ROBERTINO"), true);         // sin el segundo nombre
});

test("no es la misma persona: un homónimo con otro nombre, otro materno o sin un apellido", () => {
  const esEl = mismaPersona(F);
  assert.equal(esEl("QUISPEMAYTA HUAMANCHUMO ROBERTINO CARLOS"), false);  // otro segundo nombre
  assert.equal(esEl("QUISPEMAYTA CCORAHUA ROBERTINO ELIAS"), false);      // otro apellido materno
  assert.equal(esEl("QUISPEMAYTA ROBERTINO ELIAS"), false);               // sin el materno no se puede saber
  assert.equal(esEl("HUAMANCHUMO QUISPEMAYTA ELIAS"), false);             // falta el primer nombre
  assert.equal(esEl(""), false);
  assert.equal(esEl(null), false);
});

test("lo que representaba en una visita se publica sólo si no dice su nombre", () => {
  const ok = organizacionPublicable(F);
  assert.equal(ok("MUNICIPALIDAD DISTRITAL DE EJEMPLO"), true);
  assert.equal(ok("CONSTRUCTORA HUAMANCHUMO S.A.C."), true);              // una empresa con un apellido no es su nombre
  assert.equal(ok("QUISPEMAYTA HUAMANCHUMO ROBERTINO ELIAS"), false);     // su propio nombre
  assert.equal(ok("ROBERTINO QUISPEMAYTA"), false);                       // su nombre, incompleto
  assert.equal(ok("ESTUDIO QUISPEMAYTA HUAMANCHUMO"), false);             // sus dos apellidos juntos lo dirían entero
  assert.equal(ok(""), false);
  assert.equal(ok(null), false);
});
