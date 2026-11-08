import test from "node:test";
import assert from "node:assert/strict";
import { bytesDeBase64, interpretarCv } from "../src/lib/cv.js";

// Leer el CV (2026-11-08): sólo las claves del perfil, validadas, y nada que parezca un dato personal.

test("interpretarCv: el JSON del modelo (aunque venga entre ```), con sus valores validados", () => {
  const r = interpretarCv('```json\n{"carreras":["Arquitectura","Ingeniería civil"],"estudios":"posgrado","anosExperiencia":"7","anosSectorPublico":3,"puestos":["Residente de Obra"],"region":"lima","nombre":"X"}\n```');
  assert.deepEqual(r, { carreras: ["Arquitectura", "Ingeniería civil"], estudios: "posgrado", anosExperiencia: 7, anosSectorPublico: 3, puestos: ["residente de obra"], region: "lima" });
  assert.equal("nombre" in (r as object), false);
});

test("interpretarCv: lo raro se descarta; lo que parece un DNI o un correo no pasa", () => {
  const r = interpretarCv('{"carreras":["Derecho","DNI 12345678"],"estudios":"rey","anosExperiencia":-3,"puestos":["abogado","a@b.pe"],"region":"LIMA!"}');
  assert.deepEqual(r, { carreras: ["Derecho"], estudios: null, anosExperiencia: null, anosSectorPublico: null, puestos: ["abogado"], region: null });
  assert.equal(interpretarCv('{"error":"no_es_cv"}'), "no_es_cv");
  assert.throws(() => interpretarCv("no sé"));
});

test("bytesDeBase64", () => {
  assert.equal(bytesDeBase64(btoa("hola mundo")), 10);
});
