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

test("un texto largo del modelo se recorta en vez de tumbar el resumen (503 en PROD)", () => {
  const largo = "Buscan un profesional titulado en educación con experiencia en gestión pedagógica ".repeat(10);
  const r = Resumen.parse({ en_una_frase: "Especialista en una UGEL de Lima por S/ 5,500.", a_quien_buscan: largo,
    requisitos: [{ que: "x", tipo: "curso" }, { que: "Título en educación", tipo: "formacion" }], competencias: ["Orden", "Liderazgo"], ojo: ["Prueba la experiencia con fechas."] });
  assert.ok(r.a_quien_buscan.length <= 600);
  assert.ok(r.a_quien_buscan.endsWith("…"));
  assert.deepEqual(r.requisitos, [{ que: "Título en educación", tipo: "formacion" }]);
  assert.deepEqual(r.competencias, ["Orden", "Liderazgo"]);
});
