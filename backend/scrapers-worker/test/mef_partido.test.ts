/**
 * MEF: un registro partido en dos líneas (un salto de línea dentro de un nombre) se lee como UNO. El archivo de 2011 trae
 * 123 así; leídos como dos filas, la segunda mitad ponía un código de función en la columna del nivel de gobierno y la
 * carga del año entero caía con «value too long for type character(1)».
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agregar } from "../src/mef_agregado.ts";

const V = (JSON.parse(readFileSync(new URL("./vectores_py.json", import.meta.url), "utf-8")) as { mef: { texto: string } }).mef;
const SALTO = String.fromCharCode(10);
const comoFlujo = (t: string) => new Blob([t]).stream().pipeThrough(new TextDecoderStream());

/** Parte la fila `n` justo antes de un separador de campos, como viene en el archivo del MEF («…MUNICI⏎","08",…»). */
function partir(texto: string, n: number): string {
  const lineas = texto.split(SALTO);
  const l = lineas[n]!;
  let p = l.indexOf('","', Math.floor(l.length / 3));
  // Que la primera mitad no termine en comilla (un campo vacío): ahí el salto no se distinguiría de un fin de registro.
  while (p > 0 && l.charCodeAt(p - 1) === 34) p = l.indexOf('","', p + 3);
  assert.ok(p > 0, "la fila de prueba no tiene dónde partirse");
  lineas[n] = l.slice(0, p) + SALTO + l.slice(p);
  return lineas.join(SALTO);
}

test("mef: un registro partido en dos líneas cuenta como uno y suma lo mismo", async () => {
  const entero = await agregar(comoFlujo(V.texto));
  for (const n of [1, 2, 5]) {
    const partido = await agregar(comoFlujo(partir(V.texto, n)));
    assert.equal(partido.filas, entero.filas, `fila ${n}: cuenta de filas`);
    assert.equal(partido.ejecutoras.size, entero.ejecutoras.size, `fila ${n}: unidades ejecutoras`);
    for (const [sec, e] of entero.ejecutoras) {
      assert.deepEqual([...partido.ejecutoras.get(sec)!.montos], [...e.montos], `fila ${n}: montos de ${sec}`);
    }
  }
});

test("mef: un archivo que termina con un registro sin cerrar no se queda colgado ni lo pierde en silencio", async () => {
  const lineas = V.texto.trimEnd().split(SALTO);
  const ultima = lineas[lineas.length - 1]!;
  const cortado = [...lineas.slice(0, -1), ultima.slice(0, Math.floor(ultima.length / 2))].join(SALTO);
  const a = await agregar(comoFlujo(cortado));
  // La fila a medias se pasa como está (cuenta como fila); las anteriores, intactas.
  assert.equal(a.filas, lineas.length - 1);
});
