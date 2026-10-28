/**
 * Piezas sin red: corte del CSV en tramos para COPY, decodificación como Python, calendario de los crons,
 * cp1252 y lo que se lee de las páginas de la PNDA.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CRON_DATOS, CRON_DIARIO, fuentesDelCron } from "../src/calendario.ts";
import { CortadorCsv, decodificarCp1252 } from "../src/csv.ts";
import { comoPython } from "../src/fuentes/pnda_dji.ts";
import { desescaparHtml, desescaparUrl, recursosDeDatos } from "../src/pnda.ts";
import { colapsar, cortar, flotante, partir, strip, titulo } from "../src/py.ts";

const V = JSON.parse(readFileSync(new URL("./vectores_py.json", import.meta.url), "utf-8")) as { cp1252: string };

test("CortadorCsv corta solo en fin de registro, con comillas y saltos dentro de comillas", () => {
  const filas = Array.from({ length: 400 }, (_, i) =>
    i % 7 === 0 ? `${i},"texto con ""comillas"" y\nsalto",ñandú` : i % 5 === 0 ? `${i},"a,b",c\r` : `${i},simple,${"x".repeat(i % 13)}`);
  const csv = new TextEncoder().encode(filas.join("\n") + (Math.random() < 0.5 ? "\n" : ""));
  for (const tam of [1, 3, 17, 64, 1000, csv.length]) {
    const c = new CortadorCsv();
    const tramos: Uint8Array[] = [];
    for (let i = 0; i < csv.length; i += tam) {
      const t = c.agregar(csv.slice(i, i + tam));
      if (t) tramos.push(t);
    }
    const fin = c.fin();
    if (fin) tramos.push(fin);
    const unido = Buffer.concat(tramos);
    assert.ok(Buffer.from(csv).equals(unido), `tamaño ${tam}: los tramos no reconstruyen el archivo`);
    for (const t of tramos.slice(0, -1)) {
      assert.equal(t[t.length - 1], 0x0a, `tamaño ${tam}: un tramo no termina en salto de línea`);
      assert.equal(t.filter((b) => b === 0x22).length % 2, 0, `tamaño ${tam}: un tramo deja comillas abiertas`);
    }
  }
});

test("comoPython: UTF-8 con reemplazo y saltos de línea universales", () => {
  const entrada = Uint8Array.from([...Buffer.from("a,b\r\nc,\"d\re\"\r"), 0xff, ...Buffer.from(",ñ\n")]);
  assert.equal(new TextDecoder().decode(comoPython(entrada)), "a,b\nc,\"d\ne\"\n�,ñ\n");
});

test("cp1252 con errors='replace' igual que Python en los 256 bytes", () => {
  assert.equal(decodificarCp1252(Uint8Array.from({ length: 256 }, (_, i) => i)), V.cp1252);
});

test("calendario: mismas agendas que Cloud Scheduler (hora de Lima)", () => {
  const en = (iso: string) => Date.parse(iso);
  assert.deepEqual(fuentesDelCron(CRON_DIARIO, en("2026-10-14T11:00:00Z")), ["oece_ocds"]);
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-10-14T13:00:00Z")), ["onpe_claridad", "onpe_gastos"]);  // miércoles 14
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-10-13T13:00:00Z")), ["mef_opds_etes"]);       // martes 13 (migración 152)
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-10-19T13:00:00Z")), ["mef_presupuesto"]);     // lunes 19
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-10-18T13:00:00Z")), ["pnda_sancionados", "conosce_ordenes"]);    // domingo
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-10-17T13:00:00Z")), ["conosce"]);             // sábado: sin las órdenes
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-11-01T13:00:00Z")), ["pnda_sancionados", "conosce_ordenes", "pnda_visitas", "pnda_oece"]);  // domingo 1
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-10-15T13:00:00Z")), ["pnda_visitas"]);
  assert.deepEqual(fuentesDelCron(CRON_DATOS, en("2026-11-05T13:00:00Z")), ["pnda_dji", "jne_infogob"]);
  assert.deepEqual(fuentesDelCron("*/5 * * * *", en("2026-11-05T13:00:00Z")), []);
});

test("páginas de la PNDA: enlaces, entidades y recursos de datos", () => {
  assert.equal(desescaparUrl("Relaci%C3%B3n%20de%20proveedores%20%2B%20otros.csv"), "Relación de proveedores + otros.csv");
  assert.equal(desescaparUrl("mal%ZZ%e2%82"), "mal%ZZ�");
  assert.equal(desescaparHtml("PROVEEDORES &amp; SANCIONADOS &#8211; &aacute;&#xF1;"), "PROVEEDORES & SANCIONADOS – áñ");
  const ds = {
    slug: "x", titulo: "X", modificado: null,
    recursos: ["datos.csv", "Formato_DiccionarioDatos.xlsx", "Metadatos.docx", "Reporte.XLSX", "estilo.css", "datos.pdf", "sin_ext"].map((archivo) => ({
      url: `https://www.datosabiertos.gob.pe/sites/default/files/${archivo}`, archivo,
      ext: archivo.includes(".") ? `.${archivo.split(".").pop()!.toLowerCase()}` : "",
    })),
  };
  assert.deepEqual(recursosDeDatos(ds).map((r) => r.archivo), ["datos.csv", "Reporte.XLSX"]);
});

test("semántica de Python: strip, split, title, float, cortes por punto de código", () => {
  assert.equal(strip("\x1c\x85 hola 　"), "hola");
  assert.equal(strip("﻿hola"), "﻿hola");
  assert.deepEqual(partir("  a \t b\x1fc  "), ["a", "b", "c"]);
  assert.equal(colapsar(" San   Juan\nde  Lurigancho "), "San Juan de Lurigancho");
  assert.equal(titulo("SAN JUAN DE LURIGANCHO"), "San Juan De Lurigancho");
  assert.equal(titulo("O'HIGGINS 2DO-PISO"), "O'Higgins 2Do-Piso");
  assert.equal(flotante(" 1_000 "), 1000);
  assert.equal(flotante("1e3"), 1000);
  assert.ok(Number.isNaN(flotante("nan")));
  assert.equal(flotante("abc"), null);
  assert.equal(flotante(true), 1);
  assert.equal(cortar("🚧🚧🚧", 2), "🚧🚧");
});
