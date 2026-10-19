/**
 * MEF: la entrada de un ZIP64 sale entera y sin la basura del final, y el agregado por unidad ejecutora y
 * por departamento da lo mismo que `agregar_zip` de Python (vectores de scripts/vectores_py.py).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CRON_DATOS, fuentesDelCron } from "../src/calendario.ts";
import { aniosPedidos } from "../src/fuentes/mef_presupuesto.ts";
import { agregar, agregarZip, csvAgregado, entradaZip, flujoGasto, montosGasto } from "../src/mef_agregado.ts";

interface VectorMef {
  zip_b64: string;
  texto: string;
  resumen: { filas: number; anio: number; ejecutoras: number; desglose: number };
  ejecutoras: Record<string, [...string[], number[], number]>;
  desglose: Record<string, [number, number, number]>;
}
const V = (JSON.parse(readFileSync(new URL("./vectores_py.json", import.meta.url), "utf-8")) as { mef: VectorMef }).mef;

/** El ZIP en trozos de tamaño `tam` (la cabecera local puede quedar partida). */
function flujo(bytes: Uint8Array, tam: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + tam));
      i += tam;
    },
  });
}

const zip = Uint8Array.from(Buffer.from(V.zip_b64, "base64"));

test("entradaZip: el ZIP64 de Python se infla entero, cortando antes del directorio central", async () => {
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(18, true), 0xffffffff, "el vector debería ser ZIP64 (tamaño en el extra)");
  for (const tam of [7, 64, 1000, zip.length]) {
    const texto = await new Response(entradaZip(flujo(zip, tam)).pipeThrough(new DecompressionStream("deflate-raw"))).text();
    assert.equal(texto, V.texto, `trozos de ${tam}`);
  }
});

test("agregarZip (fflate) da lo mismo que agregar sobre texto, en cualquier tamaño de trozo", async () => {
  const ref = await agregar(entradaZip(flujo(zip, 333)).pipeThrough(new DecompressionStream("deflate-raw")).pipeThrough(new TextDecoderStream()));
  for (const tam of [5, 97, 4096, zip.length]) {
    const a = await agregarZip(flujo(zip, tam));
    assert.equal(a.filas, ref.filas);
    assert.deepEqual([...a.ejecutoras.entries()].map(([k, e]) => [k, e.atributos, [...e.montos], e.filas]),
      [...ref.ejecutoras.entries()].map(([k, e]) => [k, e.atributos, [...e.montos], e.filas]), `trozos de ${tam}`);
    assert.deepEqual([...a.desglose.entries()].map(([k, d]) => [k, [...d]]), [...ref.desglose.entries()].map(([k, d]) => [k, [...d]]));
  }
});

test("agregar: mismas unidades ejecutoras, montos y desglose que agregar_zip de Python", async () => {
  const a = await agregarZip(flujo(zip, 333));
  assert.equal(a.filas, V.resumen.filas);
  assert.equal(a.anio, V.resumen.anio);
  assert.equal(a.ejecutoras.size, V.resumen.ejecutoras);
  assert.equal(a.desglose.size, V.resumen.desglose);
  for (const [sec, esperado] of Object.entries(V.ejecutoras)) {
    const e = a.ejecutoras.get(sec);
    assert.ok(e, sec);
    const atributos = esperado.slice(0, -2) as string[];
    const montos = esperado[esperado.length - 2] as number[];
    assert.deepEqual(e.atributos, atributos, sec);
    assert.deepEqual(Array.from(e.montos, (v) => Math.round(v * 100) / 100), montos, sec);
    assert.equal(e.filas, esperado[esperado.length - 1], sec);
  }
  for (const [clave, [pia, pim, dev]] of Object.entries(V.desglose)) {
    const d = a.desglose.get(clave);
    assert.ok(d, clave);
    assert.deepEqual(Array.from(d, (v) => Math.round(v * 100) / 100), [pia, pim, dev], clave);
  }
  const { ejecutoras, desglose } = csvAgregado(a, "2026-10-14T05:00:00.000Z");
  assert.equal(ejecutoras.trim().split("\n").length, V.resumen.ejecutoras);
  assert.equal(desglose.trim().split("\n").length, V.resumen.desglose);
  assert.match(ejecutoras, /"MUNICIPALIDAD DISTRITAL DE ""COMILLAS"", PRUEBA"/);
});

test("años del MEF: el actual, el anterior hasta marzo, o el rango pedido; corre los lunes", () => {
  assert.deepEqual(aniosPedidos({}, "2026-10-14"), [2026]);
  assert.deepEqual(aniosPedidos({}, "2027-02-01"), [2026, 2027]);
  assert.deepEqual(aniosPedidos({ desde: "2025", hasta: "2026" }, "2026-10-14"), [2025, 2026]);
  assert.deepEqual(aniosPedidos({ desde: "2025" }, "2026-10-14"), [2025]);
  assert.ok(fuentesDelCron(CRON_DATOS, Date.parse("2026-10-19T13:00:00Z")).includes("mef_presupuesto"));   // lunes
  assert.ok(!fuentesDelCron(CRON_DATOS, Date.parse("2026-10-14T13:00:00Z")).includes("mef_presupuesto"));  // martes
});

test("agregar: en qué gasta cada unidad ejecutora (partida, función y proyecto; sin claves para filas en cero)", async () => {
  const cab = V.texto.split("\n")[0];
  const cols = cab.split('","').map((c) => c.replaceAll('"', ""));
  const fila = (v: Record<string, string>) => cols.map((c) => `"${(v[c] ?? "X").replaceAll('"', '""')}"`).join(",");
  const base = { ANO_EJE: "2026", SEC_EJEC: "470", EJECUTORA_NOMBRE: "EJERCITO PERUANO", GENERICA: "3", GENERICA_NOMBRE: "BIENES Y SERVICIOS",
    SUBGENERICA: "1", SUBGENERICA_DET: "1", SUBGENERICA_DET_NOMBRE: "ALIMENTOS Y BEBIDAS", FUNCION: "18", FUNCION_NOMBRE: "DEFENSA Y SEGURIDAD NACIONAL",
    TIPO_ACT_PROY: "3", PRODUCTO_PROYECTO: "3999999", PRODUCTO_PROYECTO_NOMBRE: "SIN PRODUCTO", MONTO_PIA: "0", MONTO_PIM: "0",
    MONTO_CERTIFICADO: "0", MONTO_COMPROMETIDO_ANUAL: "0", MONTO_COMPROMETIDO: "0", MONTO_DEVENGADO: "0", MONTO_GIRADO: "0" };
  const texto = [cab,
    fila({ ...base, MES_EJE: "0", MONTO_PIA: "100", MONTO_PIM: "120" }),
    fila({ ...base, MES_EJE: "3", MONTO_DEVENGADO: "30" }),
    // Un proyecto de inversión, con comillas en el nombre.
    fila({ ...base, MES_EJE: "0", GENERICA: "6", GENERICA_NOMBRE: "ADQUISICION DE ACTIVOS NO FINANCIEROS", SUBGENERICA: "2",
      SUBGENERICA_DET: "2", SUBGENERICA_DET_NOMBRE: "CONSTRUCCION DE EDIFICIOS Y ESTRUCTURAS", TIPO_ACT_PROY: "2",
      PRODUCTO_PROYECTO: "2512345", PRODUCTO_PROYECTO_NOMBRE: 'MEJORAMIENTO DEL CUARTEL "SAN MARTIN"', MONTO_PIM: "500" }),
    // Toda en cero: no crea clave (la función 03 no debería aparecer).
    fila({ ...base, MES_EJE: "5", FUNCION: "03", FUNCION_NOMBRE: "PLANEAMIENTO" }),
  ].join("\n") + "\n";
  const a = await agregar(new Blob([texto]).stream().pipeThrough(new TextDecoderStream()));
  const g = (k: string) => montosGasto(a, k);
  assert.deepEqual(g("470\tpartida\t3.1.1"), [100, 120, 30]);
  assert.deepEqual(g("470\tpartida\t6.2.2"), [0, 500, 0]);
  assert.deepEqual(g("470\tfuncion\t18"), [100, 620, 30]);
  assert.deepEqual(g("470\tproyecto\t2512345"), [0, 500, 0]);
  assert.equal(a.gasto.has("470\tproyecto\t3999999"), false, "las actividades no son proyectos");
  assert.equal(a.gasto.has("470\tfuncion\t03"), false, "una fila en cero no crea clave");
  assert.deepEqual(a.nombres.get("partida\t3.1.1"), ["ALIMENTOS Y BEBIDAS", "BIENES Y SERVICIOS"]);
  assert.deepEqual(a.nombres.get("proyecto\t2512345"), ['MEJORAMIENTO DEL CUARTEL "SAN MARTIN"', ""]);
  const gasto = await new Response(flujoGasto(a, 3)).text();
  assert.equal(gasto.trim().split("\n").length, 4, "una línea por clave, en lotes de 3");
  assert.match(gasto, /"2026","470","proyecto","2512345","MEJORAMIENTO DEL CUARTEL ""SAN MARTIN""",,"0.00","500.00","0.00"/, "sin grupo: NULL");
});
