import test from "node:test";
import assert from "node:assert/strict";
import { FILTROS_POR_DEFECTO, aParams, cambiar, filtrosActivos, leerFiltros, normalizar } from "./filtros.ts";

test("leerFiltros: sin nada, los valores por defecto", () => {
  assert.deepEqual(leerFiltros(new URLSearchParams()), FILTROS_POR_DEFECTO);
});

test("leerFiltros: lee listas, montos y opciones; descarta lo que no entiende", () => {
  const f = leerFiltros(
    new URLSearchParams("q=  tóner  &tipo=bienes,servicios,naves,bienes&region=15,LIMA,04&min=5000&max=abc&pub=7&cons=3d&senal=1&orden=valor_desc&pag=3&tam=50"),
  );
  assert.equal(f.q, "tóner");
  assert.deepEqual(f.tipo, ["bienes", "servicios"]);
  assert.deepEqual(f.region, ["15", "04"]);
  assert.equal(f.min, 5000);
  assert.equal(f.max, null);
  assert.equal(f.pub, 7);
  assert.equal(f.cons, "3d");
  assert.equal(f.senal, true);
  assert.equal(f.orden, "valor_desc");
  assert.equal(f.pag, 3);
  assert.equal(f.tam, 50);
});

test("leerFiltros: valores inválidos vuelven al defecto y un rango al revés se ordena", () => {
  const f = leerFiltros({ orden: "aleatorio", pag: "-2", tam: "33", pub: "90", cons: "x", min: "900", max: "100" });
  assert.equal(f.orden, "recientes");
  assert.equal(f.pag, 1);
  assert.equal(f.tam, 20);
  assert.equal(f.pub, 30);
  assert.equal(f.cons, null);
  assert.equal(f.min, 100);
  assert.equal(f.max, 900);
});

test("aParams: sin los valores por defecto, y de ida y vuelta queda igual", () => {
  assert.equal(aParams(FILTROS_POR_DEFECTO).toString(), "");
  const f = leerFiltros(new URLSearchParams("q=papel&tipo=bienes&orden=vence&pag=2"));
  assert.deepEqual(leerFiltros(aParams(f)), f);
});

test("cambiar: un filtro vuelve a la página 1; la página se respeta", () => {
  const f = { ...FILTROS_POR_DEFECTO, pag: 4 };
  assert.equal(cambiar(f, { q: "x" }).pag, 1);
  assert.equal(cambiar(f, { pag: 5 }).pag, 5);
});

test("filtrosActivos: cuenta los de búsqueda, no el orden ni la página", () => {
  assert.equal(filtrosActivos({ ...FILTROS_POR_DEFECTO, orden: "valor_asc", pag: 3 }), 0);
  assert.equal(filtrosActivos({ ...FILTROS_POR_DEFECTO, q: "x", tipo: ["bienes", "obras"], senal: true }), 4);
});

test("normalizar: sin tildes ni mayúsculas", () => {
  assert.equal(normalizar("  Adquisición  de TÓNER "), "adquisicion de toner");
});
