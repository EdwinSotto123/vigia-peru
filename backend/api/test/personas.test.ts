import test from "node:test";
import assert from "node:assert/strict";
import { conEnie, palabrasBusqueda, taparNombrePropio } from "../src/routes/personas.js";
import { publicar } from "../src/lib/privacidad.js";
import { TAPA_NOMBRE } from "../src/lib/privacidad.js";

test("el nombre de la persona en la descripción de su orden sale con el materno tapado, en los dos órdenes", () => {
  const n = "VARGAS ROJAS LUIS FERNANDO";
  assert.equal(taparNombrePropio("SERVICIO DE ASISTENCIA DE VARGAS ROJAS LUIS FERNANDO", n), `SERVICIO DE ASISTENCIA DE VARGAS ${TAPA_NOMBRE} LUIS FERNANDO`);
  assert.equal(taparNombrePropio("PAGO A LUIS FERNANDO VARGAS ROJAS POR SERVICIOS", n), `PAGO A LUIS FERNANDO VARGAS ${TAPA_NOMBRE} POR SERVICIOS`);
  assert.equal(taparNombrePropio("SERVICIO DE LIMPIEZA", n), "SERVICIO DE LIMPIEZA");
  assert.equal(taparNombrePropio(null, n), null);
});

test("la Ñ que CONOSCE escribe «¿» se repone, y el apellido se tapa", () => {
  assert.equal(conEnie("LEON NURE¿A MANUEL"), "LEON NUREÑA MANUEL");
  assert.equal(conEnie("¿QUÉ SERVICIO?"), "¿QUÉ SERVICIO?");
  const r = publicar({ data: [{ ruc: "10439608801", nombre: conEnie("LEON NURE¿A MANUEL ALEXANDER") }] });
  assert.equal(r.data[0].nombre, `LEON ${TAPA_NOMBRE} MANUEL ALEXANDER`);
});

test("el buscador deja las palabras como mef_norm: mayúsculas, sin tildes, de 3 letras o más y sin comodines", () => {
  assert.deepEqual(palabrasBusqueda("Municipalidad de Huarochirí"), ["MUNICIPALIDAD", "HUAROCHIRI"]);
  assert.deepEqual(palabrasBusqueda("  Niño   asesor%_legal "), ["NINO", "ASESOR", "LEGAL"]);
  assert.deepEqual(palabrasBusqueda("a b"), []);
  assert.deepEqual(palabrasBusqueda(undefined), []);
  assert.equal(palabrasBusqueda("uno dos tres cuatro cinco seis siete").length, 5);
});
