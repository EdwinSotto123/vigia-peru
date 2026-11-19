import assert from "node:assert/strict";
import { test } from "node:test";
import { aplanar, celdaCsv, filasACsv } from "../src/lib/csv.ts";

test("celdaCsv: comillas, comas y fórmulas neutralizadas", () => {
  assert.equal(celdaCsv("EsSalud"), "EsSalud");
  assert.equal(celdaCsv('Dijo "hola", y se fue'), '"Dijo ""hola"", y se fue"');
  assert.equal(celdaCsv("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(celdaCsv("+51 999"), "'+51 999");
  assert.equal(celdaCsv("-12.5"), "-12.5");          // un número negativo sigue siendo número
  assert.equal(celdaCsv(null), "");
  assert.equal(celdaCsv(true), "sí");
});

test("filasACsv: objetos aplanados, columnas en orden, con BOM", () => {
  const csv = filasACsv([
    { org: "RIMAC", visitas: 7, empresa: { ruc: "20100041953", nombre: "Rímac Seguros" }, tipos: ["privada", "decide"] },
    { org: "SALOG", visitas: 3, empresa: null, extra: "x" },
  ], ["extra"]);
  assert.ok(csv.startsWith("﻿"));
  const [cab, a, b] = csv.slice(1).trim().split("\r\n");
  assert.equal(cab, "org,visitas,empresa_ruc,empresa_nombre,tipos,empresa");
  assert.equal(a, "RIMAC,7,20100041953,Rímac Seguros,\"privada; decide\",");
  assert.equal(b, "SALOG,3,,,,");
  assert.deepEqual(aplanar({ a: { b: { c: 1 } } }), { a_b_c: 1 });
});
