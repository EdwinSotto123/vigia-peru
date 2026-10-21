/**
 * CONOSCE: el XLSX leído por rangos sale como el CSV que daría SheetJS (textos compartidos, inlineStr,
 * entidades, celdas vacías, ZIP con cualquier orden de entradas), la cabecera se normaliza igual en CSV y XLSX,
 * y el SELECT elige cada columna por sus nombres posibles.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { CRON_DATOS, fuentesDelCron } from "../src/calendario.ts";
import { leerCsv } from "../src/csv.ts";
import { CONJUNTOS, aniosConosce, normalizarCabecera, selectDestino, separarCabecera } from "../src/fuentes/conosce.ts";
import { MAPA_ORDENES, desdeRefresco, mesesOrdenes, urlOrdenes } from "../src/fuentes/conosce_ordenes.ts";
import { leerXlsx } from "../src/xlsx.ts";
import { CortadorFilas, xlsxComoCsv } from "../src/xlsx_flujo.ts";

const hojaXml = (filas: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filas}</sheetData><rowBreaks count="0"/></worksheet>`;

function libro(hoja: string, compartidos: string[] | null): Uint8Array {
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${compartidos ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : ""}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${compartidos ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : ""}</Relationships>`),
    // La hoja antes que los textos compartidos, como en los archivos de CONOSCE.
    "xl/worksheets/sheet1.xml": strToU8(hoja),
  };
  if (compartidos) {
    archivos["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${compartidos.length}">${compartidos.map((s) => `<si>${s}</si>`).join("")}</sst>`);
  }
  return zipSync(archivos, { level: 6 });
}

async function comoCsv(bytes: Uint8Array, trozo?: number): Promise<string> {
  const leer = async (o: number, l: number) => new Blob([bytes.subarray(o, o + l)]).stream();
  return new Response(xlsxComoCsv(leer, bytes.length, trozo)).text();
}

const comoTexto = (v: unknown) => (v == null ? "" : String(v));

test("XLSX con textos compartidos: mismo contenido que SheetJS, filas del ancho de la cabecera", async () => {
  const compartidos = ["<t>CODIGO_CONVOCATORIA</t>", "<t>POSTOR</t>", "<t>RUC</t>", "<r><t>CONSORCIO </t></r><r><t>A &amp; B, \"Sur\"</t></r>",
    "<t xml:space=\"preserve\">EMPRESA Ñ_x000D_</t><rPh sb=\"0\" eb=\"1\"><t>ﾌﾘｶﾞﾅ</t></rPh>"];
  const hoja = hojaXml(
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
    `<row r="2"><c r="A2"><v>1222831</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="str"><v>20999999992</v></c></row>` +
    `<row r="3"/>` +
    `<row r="4"><c r="A4"><v>7</v></c><c r="C4" t="s"><v>4</v></c></row>`);
  const bytes = libro(hoja, compartidos);
  for (const trozo of [1, 50, 1 << 20]) {
    const filas = leerCsv(await comoCsv(bytes, trozo));
    assert.deepEqual(filas[0], ["CODIGO_CONVOCATORIA", "POSTOR", "RUC"]);
    assert.deepEqual(filas[1], ["1222831", 'CONSORCIO A & B, "Sur"', "20999999992"]);
    assert.deepEqual(filas[2], ["7", "", "EMPRESA Ñ\r"]);
    assert.equal(filas.length, 3);
    // Mismo contenido que SheetJS (las filas vacías no salen en el CSV).
    const ref = leerXlsx(bytes).filter((f) => f.length);
    assert.deepEqual(filas.map((f) => f.map((x) => x)), ref.map((f) => [...f, ...Array(3 - f.length).fill(null)].map(comoTexto)));
  }
});

test("XLSX con inlineStr (CONOSCE 2018-2024) y cabecera con una columna vacía al final", async () => {
  const hoja = hojaXml(
    `<row r="1"><c r="A1" t="inlineStr"><is><t>codigo_convocatoria</t></is></c><c r="B1" t="inlineStr"><is><t>postor</t></is></c></row>` +
    `<row r="2"><c r="A2"><v>99</v></c><c r="B2" t="inlineStr"><is><t>&lt;SIN NOMBRE&gt;</t></is></c><c r="C2"><v>5</v></c></row>`);
  const filas = leerCsv(await comoCsv(libro(hoja, null)));
  assert.deepEqual(filas, [["codigo_convocatoria", "postor"], ["99", "<SIN NOMBRE>"]]);
});

test("CortadorFilas: <row> partido entre trozos y <rowBreaks> no es una fila", () => {
  const xml = hojaXml(`<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row>`);
  for (let corte = 1; corte < xml.length; corte += 7) {
    const filas: string[] = [];
    const c = new CortadorFilas((f) => filas.push(f));
    c.agregar(xml.slice(0, corte));
    c.agregar(xml.slice(corte));
    assert.deepEqual(filas, ['<c r="A1"><v>1</v></c>', '<c r="A2"><v>2</v></c>'], `corte ${corte}`);
  }
});

test("cabecera: BOM, espacios y tildes → snake_case; duplicadas numeradas", () => {
  assert.deepEqual(normalizarCabecera(["﻿CODIGOENTIDAD", "RUC PROVEEDOR", "Fecha Buena Pro", "RUC PROVEEDOR", "Año"]),
    ["codigoentidad", "ruc_proveedor", "fecha_buena_pro", "ruc_proveedor_2", "ano"]);
});

test("separarCabecera devuelve la cabecera y vuelve a emitir todo el archivo", async () => {
  const csv = "﻿A,\"B, C\"\r\n1,2\r\n3,4\r\n";
  const bytes = new TextEncoder().encode(csv);
  const origen = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
      c.close();
    },
  });
  const { cabecera, flujo } = await separarCabecera(origen);
  assert.deepEqual(normalizarCabecera(cabecera), ["a", "b_c"]);
  // En bytes: Response.text() se come el BOM.
  assert.deepEqual(new Uint8Array(await new Response(flujo).arrayBuffer()), bytes);
});

test("selectDestino elige el primer nombre presente y castea; lo que falta va NULL", () => {
  const { cols, select } = selectDestino(CONJUNTOS.postores.mapa, new Set(["codigo_convocatoria", "fechaconvocatoria", "ruc_codigo_postor", "postor"]), 2026);
  assert.equal(cols, "anio, codigo_convocatoria, fecha_convocatoria, n_item, ruc_postor, postor, fecha_propuesta");
  assert.equal(select, `2026, NULLIF(btrim("codigo_convocatoria"), ''), conosce_fecha("fechaconvocatoria"), NULL, NULLIF(btrim("ruc_codigo_postor"), ''), NULLIF(btrim("postor"), ''), NULL`);
});

test("años de CONOSCE y el sábado en el calendario", () => {
  assert.deepEqual(aniosConosce({}, "2026-10-14"), [2025, 2026]);
  assert.deepEqual(aniosConosce({ desde: "2015", hasta: "2019" }, "2026-10-14"), [2018, 2019]);
  assert.deepEqual(aniosConosce({ desde: "2025", hasta: "2030" }, "2026-10-14"), [2025, 2026]);
  assert.ok(fuentesDelCron(CRON_DATOS, Date.parse("2026-10-17T13:00:00Z")).includes("conosce"));   // sábado
  assert.ok(!fuentesDelCron(CRON_DATOS, Date.parse("2026-10-16T13:00:00Z")).includes("conosce"));  // viernes
});

test("órdenes: meses por defecto y pedidos, URL del archivo y columnas fijas año y mes", () => {
  assert.deepEqual(mesesOrdenes({}, "2026-10-14"), [[2026, 8], [2026, 9], [2026, 10]]);
  assert.deepEqual(mesesOrdenes({}, "2026-02-03"), [[2025, 12], [2026, 1], [2026, 2]]);
  assert.deepEqual(mesesOrdenes({ desde: "2025-11", hasta: "2026-01" }, "2026-10-14"), [[2025, 11], [2025, 12], [2026, 1]]);
  assert.equal(mesesOrdenes({ desde: "2025" }, "2026-10-14").length, 12);
  assert.deepEqual(mesesOrdenes({ desde: "2026-09", hasta: "2027" }, "2026-10-14"), [[2026, 9], [2026, 10]]);
  assert.deepEqual(mesesOrdenes({ desde: "2017-11", hasta: "2018-01" }, "2026-10-14"), [[2018, 1]]);
  assert.match(urlOrdenes(2026, 9), /\/ordenes\/2026\/CONOSCE_ORDENESCOMPRASEPTIEMBRE2026_0\.xlsx$/);
  const { cols, select } = selectDestino(MAPA_ORDENES.slice(0, 2), new Set(["entidad", "ruc_entidad"]), { anio: 2026, mes: 9 });

test("conosce_ordenes: lo que sale de las órdenes se rehace desde 6 meses antes del primer mes cargado", () => {
  assert.equal(desdeRefresco([2026, 8]), "2026-02-01");
  assert.equal(desdeRefresco([2026, 3]), "2025-09-01");
  assert.equal(desdeRefresco([2026, 6]), "2025-12-01");
  assert.equal(desdeRefresco([2026, 7]), "2026-01-01");
});
  assert.equal(cols, "anio, mes, entidad, entidad_ruc");
  assert.equal(select, `2026, 9, NULLIF(btrim("entidad"), ''), NULLIF(btrim("ruc_entidad"), '')`);
  assert.ok(fuentesDelCron(CRON_DATOS, Date.parse("2026-10-17T13:00:00Z")).includes("conosce_ordenes"));
});
