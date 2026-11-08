import test from "node:test";
import assert from "node:assert/strict";
import { CREDITOS_MODO, MODOS_APP, creditosCobrados, modeloDe, pedidoApp } from "../src/lib/chatApp.js";

// El asistente de cada app (2026-11-08): qué modos tiene, qué cobra y con qué herramientas pregunta.

test("Empleo sólo trae el rápido; Licitaciones, los tres", () => {
  assert.deepEqual(MODOS_APP.empleo, ["rapido"]);
  assert.deepEqual(MODOS_APP.licitaciones, ["rapido", "fino", "profundo"]);
  assert.equal(modeloDe("rapido"), "rapido");
  assert.equal(modeloDe("profundo"), "fino");
});

test("créditos: rápido 5 y fino 25 fijos; profundo lo que cuesta, entre 25 y 100", () => {
  assert.equal(creditosCobrados("rapido", 0.5), 5);
  assert.equal(creditosCobrados("fino", 0.001), 25);
  assert.equal(creditosCobrados("profundo", 0.01), 25);
  assert.equal(creditosCobrados("profundo", 0.08), 50);
  assert.equal(creditosCobrados("profundo", 2), 100);
  assert.equal(CREDITOS_MODO.profundo, 100);
});

test("cada app pregunta con las herramientas de la dirección de su producto", () => {
  const e = pedidoApp("empleo", "rapido");
  assert.equal(e.ruta, "/mcp/empleo");
  assert.match(e.sistema, /Gobserva Empleo/);
  const l = pedidoApp("licitaciones", "profundo");
  assert.equal(l.ruta, "/mcp/licitaciones");
  assert.match(l.sistema, /Modo profundo/);
  assert.doesNotMatch(pedidoApp("licitaciones", "fino").sistema, /Modo profundo/);
  assert.ok(l.vueltas > e.vueltas);
});

test("el título de una conversación: su primera pregunta en una línea, sin pasar de 80 letras", async () => {
  const { tituloDe } = await import("../src/lib/conversaciones.js");
  assert.equal(tituloDe("  ¿Qué plazas   hay\nen Cusco?  "), "¿Qué plazas hay en Cusco?");
  const largo = tituloDe("¿Qué licitaciones de uniformes institucionales para damas y caballeros se convocaron esta semana en Cusco y Puno?");
  assert.ok(largo.length <= 81 && largo.endsWith("…"));
  assert.equal(tituloDe("   "), "Conversación");
});

test("el perfil de quien pregunta, en palabras, para el asistente", async () => {
  const { perfilEmpleoTexto, lineasTexto, pedidoApp } = await import("../src/lib/chatApp.js");
  const t = perfilEmpleoTexto("carreras=Contabilidad&palabras=contador%7Canalista+contable&tengo=titulo&region=la-libertad&sueldo=3000&puesto=Contabilidad");
  assert.match(t ?? "", /Carrera: Contabilidad\. Puestos que le interesan: contador, analista contable\. Estudios: título profesional\..*la libertad.*S\/ 3000/);
  assert.equal(perfilEmpleoTexto("puesto=Mi+perfil"), null);
  const l = lineasTexto([{ nombre: "Uniformes", descripcion: "Confección de uniformes", palabras: ["uniformes"], regiones: ["15"], tipos: ["bienes"] }], { "15": "Lima" });
  assert.match(l ?? "", /Línea «Uniformes»: Confección de uniformes\. Palabras: uniformes\. Regiones: Lima\. Compra de: bienes\./);
  assert.match(pedidoApp("empleo", "rapido", t).sistema, /guardó en su cuenta/);
  assert.doesNotMatch(pedidoApp("empleo", "rapido", null).sistema, /guardó en su cuenta/);
});
