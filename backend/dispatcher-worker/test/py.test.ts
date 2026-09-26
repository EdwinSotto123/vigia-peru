// Semántica de Python de src/py.ts contra salidas reales de Python 3 y de requests.iter_lines
// (test/vectores_py.json, generado por scripts/vectores_py.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Lineas, cargarJson, cortar, isoSegundos, repr, splitlines, str, strip, verdad } from "../src/py.ts";

const V = JSON.parse(readFileSync(new URL("./vectores_py.json", import.meta.url), "utf-8"));

test("splitlines como str.splitlines()", () => {
  for (const { entrada, salida } of V.splitlines) assert.deepEqual(splitlines(entrada), salida, JSON.stringify(entrada));
});

test("Lineas + TextDecoder como requests.iter_lines(decode_unicode=True), trozo a trozo", () => {
  for (const { bytes, trozo, salida } of V.iter_lines) {
    const datos = Uint8Array.from(bytes as number[]);
    const dec = new TextDecoder("utf-8");
    const lineas = new Lineas();
    const out: string[] = [];
    for (let i = 0; i < datos.length; i += trozo) out.push(...lineas.agregar(dec.decode(datos.subarray(i, i + trozo), { stream: true })));
    out.push(...lineas.agregar(dec.decode()), ...lineas.fin());
    assert.deepEqual(out, salida, `trozo ${trozo}`);
  }
});

test("str() y repr() de valores JSON", () => {
  for (const { valor, str: s, repr: r } of V.reprs) {
    assert.equal(str(valor), s, JSON.stringify(valor));
    assert.equal(repr(valor), r, JSON.stringify(valor));
  }
});

test("strip() con los espacios de Python", () => {
  for (const { entrada, salida } of V.strip) assert.equal(strip(entrada), salida, JSON.stringify(entrada));
});

test("s[:n] por punto de código", () => {
  for (const { entrada, n, salida } of V.cortar) assert.equal(cortar(entrada, n), salida, `${entrada}[:${n}]`);
});

test("verdad de Python", () => {
  for (const v of [null, undefined, false, 0, "", [], {}]) assert.equal(verdad(v), false, JSON.stringify(v));
  for (const v of [true, 1, -1, "x", [0], { a: null }, Number.NaN]) assert.equal(verdad(v), true, String(v));
});

test("isoformat(timespec='seconds') en UTC", () => {
  assert.equal(isoSegundos(Date.UTC(2026, 8, 26, 15, 4, 5, 987)), "2026-09-26T15:04:05+00:00");
});

test("json.loads acepta NaN e Infinity fuera de cadenas", () => {
  assert.deepEqual(cargarJson('{"a": NaN, "b": [Infinity, -Infinity], "c": "NaN"}'), { a: "nan", b: ["inf", "-inf"], c: "NaN" });
  assert.throws(() => cargarJson("no json"));
  assert.throws(() => cargarJson(""));
});
