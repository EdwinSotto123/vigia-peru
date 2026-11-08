import test from "node:test";
import assert from "node:assert/strict";
import { PERFIL_VACIO } from "./onboarding.ts";
import {
  RUBROS, alternarPalabra, candidatas, listaNatural, nombreDesdeTexto, perfilDesdeRubro, perfilDesdeTexto, siguientePendiente, textoRespuesta, type Pregunta,
} from "./entrevista.ts";

const region = (u: string) => ({ "15": "Lima", "07": "Callao", "08": "Cusco", "04": "Arequipa", "13": "La Libertad" })[u] ?? u;

test("siguientePendiente: la próxima sin responder; al cambiar una del medio vuelve a la que faltaba", () => {
  assert.equal(siguientePendiente(new Set()), "rubro");
  assert.equal(siguientePendiente(new Set<Pregunta>(["rubro", "palabras"]), "palabras"), "tipos");
  // Se cambió «palabras» con todo respondido hasta «monto»: sigue en «avisos», no vuelve a «tipos».
  assert.equal(siguientePendiente(new Set<Pregunta>(["rubro", "palabras", "tipos", "lugar", "monto"]), "palabras"), "avisos");
  assert.equal(siguientePendiente(new Set<Pregunta>(["rubro", "palabras", "tipos", "lugar", "monto", "avisos"]), "lugar"), null);
});

test("nombreDesdeTexto: sin el arranque, hasta el primer punto y con mayúscula", () => {
  assert.equal(nombreDesdeTexto("Vendemos útiles de oficina y tóner. También papel."), "Útiles de oficina y tóner");
  assert.equal(nombreDesdeTexto("somos una empresa de limpieza y fumigación"), "Limpieza y fumigación");
  assert.equal(nombreDesdeTexto("Nos dedicamos a la venta de uniformes, calzado y"), "Uniformes, calzado");
  assert.equal(nombreDesdeTexto("  "), "");
  assert.ok(nombreDesdeTexto("x".repeat(30) + " " + "y".repeat(40)).length <= 60);
});

test("perfilDesdeRubro y perfilDesdeTexto: nombre, frase, las primeras palabras y los tipos", () => {
  const r = perfilDesdeRubro({ ...PERFIL_VACIO, regiones: ["15"] }, RUBROS[0]);
  assert.equal(r.nombre, "Útiles de oficina");
  assert.deepEqual(r.palabras, ["útiles", "papel bond", "tóner", "cartuchos"]);
  assert.deepEqual(r.tipos, ["bienes"]);
  assert.deepEqual(r.regiones, ["15"]);
  const t = perfilDesdeTexto({ ...PERFIL_VACIO, tipos: ["obras"] }, "Vendemos uniformes y calzado de seguridad para obreros");
  assert.equal(t.nombre, "Uniformes y calzado de seguridad para obreros");
  assert.deepEqual(t.palabras, ["uniformes", "calzado", "seguridad", "obreros"]);
  assert.deepEqual(t.tipos, ["obras"]);
});

test("candidatas: las elegidas primero y después las sugeridas, sin repetir", () => {
  const p = { ...perfilDesdeRubro(PERFIL_VACIO, RUBROS[2]), palabras: ["software", "redes"] };
  assert.deepEqual(candidatas(p, RUBROS[2]), ["software", "redes", "computadoras", "licencias", "impresoras"]);
});

test("alternarPalabra: prende, apaga y respeta el tope de 10", () => {
  assert.deepEqual(alternarPalabra(["a"], "b"), ["a", "b"]);
  assert.deepEqual(alternarPalabra(["a", "b"], "a"), ["b"]);
  const diez = Array.from({ length: 10 }, (_, i) => `p${i}`);
  assert.equal(alternarPalabra(diez, "otra").length, 10);
});

test("listaNatural: con «y» y el «más» cuando son muchas", () => {
  assert.equal(listaNatural(["a"]), "a");
  assert.equal(listaNatural(["a", "b"]), "a y b");
  assert.equal(listaNatural(["a", "b", "c"]), "a, b y c");
  assert.equal(listaNatural(["a", "b", "c", "d", "e", "f"]), "a, b, c y 3 más");
});

test("textoRespuesta: cada respuesta como se diría", () => {
  const p = { ...perfilDesdeRubro(PERFIL_VACIO, RUBROS[1]), regiones: ["15", "07"], max: 100_000 };
  assert.equal(textoRespuesta("rubro", p, region, RUBROS[1]), "Limpieza");
  assert.equal(textoRespuesta("rubro", { ...p, descripcion: "Vendemos tóner" }, region, null), "Vendemos tóner");
  assert.equal(textoRespuesta("tipos", p, region, null), "Servicios y bienes");
  assert.equal(textoRespuesta("tipos", { ...p, tipos: [] }, region, null), "Todos: bienes, servicios, obras y consultoría");
  assert.equal(textoRespuesta("lugar", p, region, null), "Lima y Callao");
  assert.equal(textoRespuesta("lugar", { ...p, regiones: ["08", "04", "13"] }, region, null), "Cusco, Arequipa y La Libertad");
  assert.equal(textoRespuesta("lugar", { ...p, regiones: [] }, region, null), "Todo el Perú");
  assert.equal(textoRespuesta("monto", p, region, null), "Hasta S/ 100 mil");
  assert.equal(textoRespuesta("avisos", p, region, null), "Sí, cada semana");
  assert.equal(textoRespuesta("avisos", { ...p, alerta: false }, region, null), "No, yo entro a mirar");
});
