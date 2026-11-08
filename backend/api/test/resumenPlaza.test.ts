import test from "node:test";
import assert from "node:assert/strict";
import { Resumen, huellaPlaza, textoPlaza } from "../src/lib/resumenPlaza.js";

const p = {
  aviso: 1, titulo: "CONTADOR", entidad: "UGEL", ubicacion: "LIMA - LIMA", numero: "CAS 1", vacantes: 1, remuneracion: 3000, fecha_fin: "2026-11-19",
  experiencia: "2 AÑOS", formacion: "TITULO EN CONTABILIDAD", especializacion: null, conocimiento: null, competencias: "ORDEN",
};

test("la huella cambia si SERVIR cambia lo que se lee, no si no", () => {
  assert.equal(huellaPlaza(p), huellaPlaza({ ...p }));
  assert.notEqual(huellaPlaza(p), huellaPlaza({ ...p, experiencia: "3 AÑOS" }));
});

test("lo que lee el modelo: sólo los campos con dato, sin enlaces", () => {
  const t = textoPlaza(p);
  assert.match(t, /Formación: TITULO EN CONTABILIDAD/);
  assert.doesNotMatch(t, /Cursos o especialización/);
  assert.doesNotMatch(t, /http/);
});

test("el resumen se valida: lo raro se descarta sin romper", () => {
  const r = Resumen.parse({ en_una_frase: "Contador en una UGEL de Lima por S/ 3,000.", a_quien_buscan: "Un contador titulado con 2 años.",
    requisitos: [{ que: "Título en contabilidad", tipo: "rarisimo" }], competencias: "no es lista", ojo: [] });
  assert.equal(r.requisitos[0].tipo, "otro");
  assert.deepEqual(r.competencias, []);
});
