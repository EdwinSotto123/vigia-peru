import test from "node:test";
import assert from "node:assert/strict";
import { FILTROS_MENORES, aApiMenores, aParamsMenores, activosMenores, leerMenores } from "./filtrosMenores.ts";

test("leerMenores: listas, cuándo y orden; lo raro a su defecto; la página hasta 100", () => {
  const f = leerMenores(new URLSearchParams("q= tóner &tipo=bienes,naves&region=15,X&cuando=hoy&orden=reciente&pag=300&tam=50"));
  assert.deepEqual(f, { q: "tóner", tipo: ["bienes"], region: ["15"], cuando: "hoy", orden: "reciente", pag: 100, tam: 50 });
  assert.deepEqual(leerMenores({}), FILTROS_MENORES);
});

test("aParamsMenores sin defectos; aApiMenores con page y size", () => {
  assert.equal(aParamsMenores(FILTROS_MENORES).toString(), "");
  const f = { ...FILTROS_MENORES, tipo: ["bienes" as const, "servicios" as const], pag: 3 };
  assert.equal(aParamsMenores(f).toString(), "tipo=bienes%2Cservicios&pag=3");
  assert.equal(aApiMenores(f).toString(), "tipo=bienes%2Cservicios&page=3&size=20&orden=cierra");
  assert.equal(activosMenores(f), 2);
});
