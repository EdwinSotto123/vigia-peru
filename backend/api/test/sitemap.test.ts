import { test } from "node:test";
import assert from "node:assert/strict";
import { POR_ARCHIVO, archivosPara, leerPaginaSitemap } from "../src/lib/sitemap.js";

const TIPOS = ["entidades", "empresas", "contratos", "plazas"] as const;

test("sitemap: la página N salta las N-1 anteriores", () => {
  assert.deepEqual(leerPaginaSitemap("contratos", "1", TIPOS), { tipo: "contratos", pagina: 1, offset: 0 });
  assert.deepEqual(leerPaginaSitemap("empresas", "3", TIPOS), { tipo: "empresas", pagina: 3, offset: 2 * POR_ARCHIVO });
});

test("sitemap: sólo los tipos públicos (nada de personas)", () => {
  assert.equal(leerPaginaSitemap("personas", "1", TIPOS), null);
  assert.equal(leerPaginaSitemap("planilla", "1", TIPOS), null);
  assert.equal(leerPaginaSitemap("__proto__", "1", TIPOS), null);
});

test("sitemap: la página es un entero desde 1 y con tope", () => {
  for (const malo of ["0", "-1", "1.5", "01", "abc", "", "1e3", "10000"]) {
    assert.equal(leerPaginaSitemap("contratos", malo, TIPOS), null, malo);
  }
  assert.notEqual(leerPaginaSitemap("contratos", "1000", TIPOS), null);
});

test("sitemap: archivos por total, al menos uno", () => {
  assert.equal(archivosPara(0), 1);
  assert.equal(archivosPara(3_163), 1);
  assert.equal(archivosPara(POR_ARCHIVO), 1);
  assert.equal(archivosPara(POR_ARCHIVO + 1), 2);
  assert.equal(archivosPara(829_973), 19);
});
