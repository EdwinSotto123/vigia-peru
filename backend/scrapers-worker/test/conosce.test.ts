/**
 * CONOSCE: el XLSX leído por rangos sale como el CSV que daría SheetJS (textos compartidos, inlineStr,
 * entidades, celdas vacías, ZIP con cualquier orden de entradas), la cabecera se normaliza igual en CSV y XLSX,
 * y el SELECT elige cada columna por sus nombres posibles.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { CRON_DATOS, fuentesDelCron } from "../src/calendario.ts";
import { NormalizadorCsv, cuentaCsv, leerCsv, normalizarCsv } from "../src/csv.ts";
import type { Copia, Db } from "../src/db.ts";
import { CONJUNTOS, aniosConosce, describirArreglos, normalizarCabecera, revisarCuenta, selectDestino, separarCabecera } from "../src/fuentes/conosce.ts";
import { MAPA_ORDENES, desdeRefresco, mesesOrdenes, particion, urlOrdenes } from "../src/fuentes/conosce_ordenes.ts";
import { copiarEnTramos } from "../src/fuentes/pnda_dji.ts";
import { leerXlsx } from "../src/xlsx.ts";
import { CortadorFilas, TextosCompartidos, contarUsos, cuentaXlsx, directorioZip, xlsxComoCsv } from "../src/xlsx_flujo.ts";
import type { OpcionesTextos } from "../src/xlsx_flujo.ts";

const hojaXml = (filas: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filas}</sheetData><rowBreaks count="0"/></worksheet>`;

/** `compartidos`: el contenido de cada <si> (null: `<si/>`, vacío). */
function libro(hoja: string, compartidos: (string | null)[] | null): Uint8Array {
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${compartidos ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : ""}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${compartidos ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : ""}</Relationships>`),
    // La hoja antes que los textos compartidos, como en los archivos de CONOSCE.
    "xl/worksheets/sheet1.xml": strToU8(hoja),
  };
  if (compartidos) {
    archivos["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${compartidos.length}">${compartidos.map((s) => (s === null ? "<si/>" : `<si>${s}</si>`)).join("")}</sst>`);
  }
  return zipSync(archivos, { level: 6 });
}

/** LeerRango sobre los bytes, de a `tam` bytes por trozo (como el cuerpo de R2, pero con cortes en cualquier lado). */
const leerEnTrozos = (bytes: Uint8Array, tam = Infinity) => async (o: number, l: number) => {
  const datos = bytes.subarray(o, o + l);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= datos.length) return c.close();
      c.enqueue(datos.slice(i, i + Math.min(tam, datos.length)));
      i += Math.min(tam, datos.length);
    },
  });
};

async function comoCsv(bytes: Uint8Array, trozo?: number, op?: OpcionesTextos & { leer?: number; cuenta?: ReturnType<typeof cuentaXlsx> }): Promise<string> {
  return new Response(xlsxComoCsv(leerEnTrozos(bytes, op?.leer), bytes.length, trozo, op?.cuenta, op)).text();
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

test("TextosCompartidos: repetidos tal cual y únicos comprimidos, pedidos en cualquier orden con una caché chica", () => {
  const textos = Array.from({ length: 3000 }, (_, i) =>
    i % 97 === 0 ? "" : i % 89 === 0 ? "€😀 ñ".repeat((i % 7) + 1) : i % 41 === 0 ? "x".repeat(20_000 + i) : `TEXTO ${i} ÁÉÍ`);
  // 0: nunca (va con los únicos), 1: una vez, 2: dos o más.
  const usos = Uint8Array.from(textos, (_, i) => i % 3);
  const t = new TextosCompartidos(usos, { porBloque: 16, cache: 50_000 });
  textos.forEach((s) => t.agregar(s));
  assert.equal(t.texto(textos.length - 1), textos.at(-1));   // antes de terminar(): los pendientes
  t.terminar();
  assert.equal(t.cantidad, textos.length);
  let semilla = 7;
  const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let k = 0; k < 20_000; k++) {
    const i = Math.floor(azar() * textos.length);
    assert.equal(t.texto(i), textos[i], `texto ${i}`);
  }
  textos.forEach((s, i) => assert.equal(t.texto(i), s, `texto ${i}`));
  assert.ok(t.vecesInflado > 100, `con la caché chica se vuelve a inflar (${t.vecesInflado})`);
  for (const i of [-1, textos.length, 1.5, Number.NaN]) assert.equal(t.texto(i), null);
  // Sin usos (libros chicos) van todos tal cual: nada que inflar.
  const chico = new TextosCompartidos(null);
  ["a", "", "ñ"].forEach((s) => chico.agregar(s));
  chico.terminar();
  assert.deepEqual([0, 1, 2].map((i) => chico.texto(i)), ["a", "", "ñ"]);
  assert.equal(chico.vecesInflado, 0);
});

test("TextosCompartidos: el tope corta antes de llenar la memoria", () => {
  const t = new TextosCompartidos(new Uint8Array(0), { porBloque: 4, maximo: 2000 });
  assert.throws(() => {
    for (let i = 0; i < 1000; i++) t.agregar(`texto ${i} ${(i * 7919).toString(36)}`);
  }, /textos compartidos: más de/);
});

test("contarUsos: cada t=\"s\" con <v> (no las vacías), aunque la hoja llegue en trozos de 1 byte", async () => {
  const hoja = hojaXml(
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c t="s" r="B1" s="3"><v>5</v></c><c r="C1" t="s"/><c r="D1"><v>7</v></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="inlineStr"><is><t>t="s"</t></is></c><c r="C2" t="s"><v>5</v></c></row>`);
  const bytes = libro(hoja, ["a", "b", "c", "d", "e", "f", "g", "h"]);
  for (const tam of [1, 7, Infinity]) {
    const leer = leerEnTrozos(bytes, tam);
    const dir = await directorioZip(leer, bytes.length);
    const usos = await contarUsos(leer, dir.get("xl/worksheets/sheet1.xml")!);
    assert.deepEqual([...usos.subarray(0, 8)], [1, 0, 0, 0, 0, 2, 0, 0], `trozos de ${tam}`);
  }
});

test("XLSX con los textos compartidos comprimidos: el mismo CSV que SheetJS y que sin comprimir; <si/> no corre los índices", async () => {
  const valores = Array.from({ length: 400 }, (_, i) => (i % 5 === 0 ? `DESCRIPCIÓN ÚNICA ${i} "con comillas", y coma` : `ENTIDAD ${i % 7}`));
  const base = 4;   // índice del primer valor
  let filas = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`;
  for (let i = 0; i < 600; i++) {
    const r = i + 2;
    // La celda B: valores repetidos y únicos, en el orden de la hoja (como CONOSCE) y a veces hacia atrás.
    const k = i < 400 ? i : (i * 37) % 400;
    filas += `<row r="${r}"><c r="A${r}"><v>${i}</v></c><c t="s" r="B${r}"><v>${base + k}</v></c></row>`;
  }
  filas += `<row r="602"><c r="A602"><v>-1</v></c><c r="B602" t="s"><v>2</v></c></row><row r="603"><c r="A603" t="s"><v>3</v></c></row>`;
  const conVacio = (vacio: string | null) => libro(hojaXml(filas), ["<t>NRO</t>", "<t>TEXTO</t>", vacio,
    "<r><t>RICO </t></r><r><t>&amp; B</t></r>", ...valores.map((v) => `<t>${v}</t>`)]);
  // SheetJS salta el <si/> (y corre los índices que siguen): se lo compara con el mismo libro con <si><t></t></si>.
  const libroT = conVacio("<t></t>");
  const sinComprimir = await comoCsv(libroT);
  const ref = leerXlsx(libroT).filter((f) => f.length);
  assert.deepEqual(leerCsv(sinComprimir), ref.map((f) => [...f, ...Array(2 - f.length).fill(null)].map(comoTexto)));
  assert.deepEqual(leerCsv(sinComprimir).slice(-2), [["-1", ""], ["RICO & B", ""]]);
  assert.equal(leerCsv(sinComprimir)[1][1], valores[0]);
  const libroSi = conVacio(null);
  assert.equal(await comoCsv(libroSi), sinComprimir);
  for (const leer of [1, 13, Infinity]) {
    const cuenta = cuentaXlsx();
    const csv = await comoCsv(libroSi, 1 << 20, { comprimirDesde: 0, porBloque: 3, cache: 60, leer, cuenta });
    assert.equal(csv, sinComprimir, `trozos de ${leer}`);
    assert.equal(cuenta.filas, 602);
    assert.equal(cuenta.textos, 4 + valores.length);
    assert.ok(cuenta.inflados > 0);
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

/** El CSV pasado por NormalizadorCsv en trozos de `tam` bytes. */
function normalizar(crudo: string, tam: number) {
  const bytes = new TextEncoder().encode(crudo);
  const n = new NormalizadorCsv();
  const partes: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += tam) {
    const s = n.agregar(bytes.slice(i, i + tam));
    if (s) partes.push(s);
  }
  const s = n.fin();
  if (s) partes.push(s);
  return { texto: new TextDecoder().decode(Buffer.concat(partes)), cuenta: n.cuenta };
}

// Registros como los de CONOSCE desde el 2026-10-22: todo entre comillas y la comilla escapada con barra.
const CSV_BARRA = '\ufeff"CODIGO","DESCRIPCION_ITEM","RUC PROVEEDOR"\r\n' +
  '"1","OBRA: \\"MEJORAMIENTO\r\nDEL CAMINO\\" CON CUI N° 2599011,","20602232990"\n' +
  '"2","EN EL DEPARTAMENTO DE PASCO\\"","20100211034"\n' +
  '"3","DOBLADA ""ASI"" Y SUELTA "DE" MAS",""\n' +
  '4,sin comillas,"con, coma"\n' +
  '\n' +
  '"5","","20999999992"';

test("NormalizadorCsv: \\\" de CONOSCE y \"\" estándar, saltos dentro de comillas, CRLF y BOM, en trozos de cualquier tamaño", () => {
  const esperado = [
    ["CODIGO", "DESCRIPCION_ITEM", "RUC PROVEEDOR"],
    ["1", 'OBRA: "MEJORAMIENTO\r\nDEL CAMINO" CON CUI N° 2599011,', "20602232990"],
    ["2", 'EN EL DEPARTAMENTO DE PASCO"', "20100211034"],
    ["3", 'DOBLADA "ASI" Y SUELTA "DE" MAS', ""],
    ["4", "sin comillas", "con, coma"],
    ["5", "", "20999999992"],
  ];
  const ref = normalizar(CSV_BARRA, CSV_BARRA.length + 1).texto;
  for (const tam of [1, 2, 3, 5, 7, 64]) {
    const { texto, cuenta } = normalizar(CSV_BARRA, tam);
    assert.equal(texto, ref, `trozos de ${tam}`);
    assert.deepEqual(cuenta, { registros: 5, realineados: 0, rellenados: 0, recortados: 0, descartados: 0, vacios: 1, ejemplos: [] });
  }
  assert.deepEqual(leerCsv(ref), esperado);
  // Lo que venía entre comillas sigue entre comillas (COPY: '' y no NULL); lo que no, igual.
  assert.ok(ref.includes('"5","","20999999992"\n') && ref.includes('4,sin comillas,"con, coma"\n') && !ref.includes("\ufeff"));
  assert.ok(!ref.includes('\\"'));
});

test("NormalizadorCsv: un registro de otro ancho se relee sin \\\", se completa, se recorta o se descarta, y se cuenta", () => {
  const crudo = "a,b,c\n" +
    "1,2\n" +                // le falta un campo: se completa
    "1,2,3,,\n" +            // campos vacíos de más: se sacan
    "1,2,3,4\n" +            // un dato de más: no se carga
    '"C:\\",2,3\n' +         // CSV estándar con una barra al final de un campo: con \" se traga lo que sigue
    "5,6,7\n";
  for (const tam of [1, 4, 1000]) {
    const { texto, cuenta } = normalizar(crudo, tam);
    assert.deepEqual(leerCsv(texto), [["a", "b", "c"], ["1", "2", ""], ["1", "2", "3"], ["C:\\", "2", "3"], ["5", "6", "7"]], `trozos de ${tam}`);
    assert.deepEqual({ ...cuenta, ejemplos: cuenta.ejemplos.length },
      { registros: 4, realineados: 2, rellenados: 1, recortados: 1, descartados: 1, vacios: 0, ejemplos: 3 });
  }
  // Comillas sin cerrar: se corta antes de juntar el resto del archivo en memoria.
  assert.throws(() => normalizar('a,b\n"1,' + "z".repeat(5 << 20), 1 << 20), /comillas sin cerrar/);
});

test("revisarCuenta: unos pocos registros arreglados avisan; muchos cortan la carga", () => {
  const c = { ...cuentaCsv(), registros: 10_000, rellenados: 3, descartados: 2, ejemplos: ['"1","2"'] };
  const a = revisarCuenta("CONOSCE_ADJUDICACIONES2025_0.csv", c);
  assert.deepEqual(a, { archivo: "CONOSCE_ADJUDICACIONES2025_0.csv", rellenados: 3, descartados: 2, ejemplos: ['"1","2"'] });
  assert.equal(describirArreglos(a!), 'CONOSCE_ADJUDICACIONES2025_0.csv: 3 completados con vacíos, 2 descartados (campos de más) (ej.: "1","2")');
  assert.equal(revisarCuenta("X.csv", { ...cuentaCsv(), registros: 9 }), null);
  assert.throws(() => revisarCuenta("X.csv", { ...c, rellenados: 60 }), /X\.csv: 62 de 10002 registros con otro número de campos que la cabecera/);
});

test("el CSV normalizado va a COPY entero: separarCabecera y copiarEnTramos cuentan los mismos registros", async () => {
  const filas = [CSV_BARRA.split("\r\n")[0].replace("\ufeff", "")];
  for (let i = 0; i < 2000; i++) filas.push(`"${i}","ÍTEM \\"${i}\\" con, coma y\nsalto\\"","2060223299${i % 10}"`);
  const bytes = new TextEncoder().encode("\ufeff" + filas.join("\r\n") + "\r\n");
  const cuenta = cuentaCsv();
  let i = 0;
  const crudo = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, (i += 997)));
    },
  });
  const origen = normalizarCsv(crudo, cuenta);
  const { cabecera, flujo } = await separarCabecera(origen);
  assert.deepEqual(normalizarCabecera(cabecera), ["codigo", "descripcion_item", "ruc_proveedor"]);
  const datos: Uint8Array[] = [];
  const sentencias: string[] = [];
  const db = {
    async abrirCopia(sql: string): Promise<Copia> {
      sentencias.push(sql);
      return {
        async escribir(d: Uint8Array) {
          datos.push(d);
        },
        async cerrar() {
          return 0;
        },
      };
    },
  } as unknown as Db;
  await copiarEnTramos(db, "_st", ['"codigo"', '"descripcion_item"', '"ruc_proveedor"'], flujo, -1);
  const recibido = leerCsv(new TextDecoder().decode(Buffer.concat(datos)));
  assert.equal(recibido.length, 2001);
  assert.equal(cuenta.registros, 2000);
  assert.ok(recibido.slice(1).every((f, i) => f.length === 3 && f[1] === `ÍTEM "${i}" con, coma y\nsalto"`));
  assert.ok(sentencias.length > 1 && /HEADER true/.test(sentencias[0]));
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

test("órdenes: meses por defecto (el año entero) y pedidos, URL del archivo y columnas fijas año y mes", () => {
  const anio = (a: number) => Array.from({ length: 12 }, (_, i) => [a, i + 1]);
  assert.deepEqual(mesesOrdenes({}, "2026-10-14"), anio(2026));
  assert.deepEqual(mesesOrdenes({}, "2026-02-03"), [...anio(2025), ...anio(2026)]);
  assert.deepEqual(mesesOrdenes({ desde: "2025-11", hasta: "2026-01" }, "2026-10-14"), [[2025, 11], [2025, 12], [2026, 1]]);
  assert.equal(mesesOrdenes({ desde: "2025" }, "2026-10-14").length, 12);
  // Hasta diciembre del año en curso (NOVIEMBRE2026 trae lo emitido en noviembre de años anteriores), no más.
  assert.deepEqual(mesesOrdenes({ desde: "2026-09", hasta: "2027" }, "2026-10-14"), [[2026, 9], [2026, 10], [2026, 11], [2026, 12]]);
  assert.deepEqual(mesesOrdenes({ desde: "2017-11", hasta: "2018-01" }, "2026-10-14"), [[2018, 1]]);
  assert.match(urlOrdenes(2026, 9), /\/ordenes\/2026\/CONOSCE_ORDENESCOMPRASEPTIEMBRE2026_0\.xlsx$/);
  const { cols, select } = selectDestino(MAPA_ORDENES.slice(0, 2), new Set(["entidad", "ruc_entidad"]), { anio: 2026, mes: 9 });
  assert.equal(cols, "anio, mes, entidad, entidad_ruc");
  assert.equal(select, `2026, 9, NULLIF(btrim("entidad"), ''), NULLIF(btrim("ruc_entidad"), '')`);
  // El mes de registro de cada fila en vez del mes del archivo (partición por emisión).
  assert.equal(selectDestino(MAPA_ORDENES.slice(0, 1), new Set(["entidad"]), { anio: 2026, mes: "extract(month FROM x)::int" }).select,
    `2026, extract(month FROM x)::int, NULLIF(btrim("entidad"), '')`);
  assert.ok(fuentesDelCron(CRON_DATOS, Date.parse("2026-10-17T13:00:00Z")).includes("conosce_ordenes"));
});

test("conosce_ordenes: lo que sale de las órdenes se rehace desde 6 meses antes del primer mes cargado", () => {
  assert.equal(desdeRefresco([2026, 8]), "2026-02-01");
  assert.equal(desdeRefresco([2026, 3]), "2025-09-01");
  assert.equal(desdeRefresco([2026, 6]), "2025-12-01");
  assert.equal(desdeRefresco([2026, 7]), "2026-01-01");
});

test("órdenes: la partición de cada archivo se reconoce por sus fechas", () => {
  // AGOSTO2026 de antes (registradas en agosto) y de ahora (emitidas en agosto, registradas en 2026).
  assert.equal(particion({ filas: 366_395, registro: 366_395, emision: 1_200 }), "registro");
  assert.equal(particion({ filas: 247_702, registro: 9_562, emision: 247_702 }), "emision");
  assert.equal(particion({ filas: 1_000, registro: 2, emision: 996 }), "emision");
  // Ambas (todo registrado y emitido en el mes) o un archivo de antes con fechas raras: como siempre.
  assert.equal(particion({ filas: 10, registro: 10, emision: 10 }), "registro");
  assert.equal(particion({ filas: 1_000, registro: 950, emision: 10 }), "registro");
  assert.equal(particion({ filas: 0, registro: 0, emision: 0 }), "registro");
  // Ninguna: no se carga (borraría o duplicaría órdenes).
  assert.equal(particion({ filas: 1_000, registro: 100, emision: 900 }), null);
});
