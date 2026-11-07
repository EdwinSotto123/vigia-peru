import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PALABRAS, PERFIL_VACIO, aAlerta, aQueryBandeja, agregarPalabras, sugerirPalabras, validarPaso } from "./onboarding.ts";

test("sugerirPalabras: las palabras con contenido, sin vacías ni repetidas ni las que ya están", () => {
  const s = sugerirPalabras("Vendemos útiles de oficina, papel bond, tóner y cartuchos para impresoras. Tóner original.", ["papel"]);
  assert.deepEqual(s, ["útiles", "oficina", "bond", "tóner", "cartuchos", "impresoras", "original"]);
});

test("agregarPalabras: separa por comas, limpia, no repite (sin tildes) y respeta el tope", () => {
  assert.deepEqual(agregarPalabras(["tóner"], " Toner , papel   bond,x, "), ["tóner", "papel bond"]);
  const muchas = agregarPalabras([], Array.from({ length: 15 }, (_, i) => `palabra${i}`).join(","));
  assert.equal(muchas.length, MAX_PALABRAS);
});

test("validarPaso: el primer paso pide nombre, frase y una palabra; el rango se valida", () => {
  assert.match(validarPaso("empresa", PERFIL_VACIO) ?? "", /nombre/);
  assert.match(validarPaso("empresa", { ...PERFIL_VACIO, nombre: "Útiles" }) ?? "", /frase/);
  assert.match(validarPaso("empresa", { ...PERFIL_VACIO, nombre: "Útiles", descripcion: "Útiles de oficina y tóner" }) ?? "", /palabra/);
  assert.equal(validarPaso("empresa", { ...PERFIL_VACIO, nombre: "Útiles", descripcion: "Útiles de oficina y tóner", palabras: ["tóner"] }), null);
  assert.match(validarPaso("contratos", { ...PERFIL_VACIO, min: 9, max: 1 }) ?? "", /mayor/);
  assert.equal(validarPaso("lugar", PERFIL_VACIO), null);
});

test("aQueryBandeja y aAlerta: el perfil como búsqueda y como alerta", () => {
  const p = { ...PERFIL_VACIO, nombre: "Útiles", palabras: ["tóner", "papel"], regiones: ["15"], tipos: ["bienes" as const, "servicios" as const], max: 100000 };
  assert.equal(aQueryBandeja(p), "tipo=bienes%2Cservicios&region=15&max=100000&orden=vence");
  assert.deepEqual(aAlerta(p), { nombre: "Útiles (mi perfil)", filtros: { q: "tóner", dias: 15, region: "15", max: 100000 } });
});
