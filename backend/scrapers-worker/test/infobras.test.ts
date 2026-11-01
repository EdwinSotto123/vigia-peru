/**
 * INFOBRAS: las columnas son las de cargar_obras.py (80 se guardan y nunca los nombres del residente ni del supervisor),
 * la hoja (con el prefijo x: del SDK de OpenXML, como la publica la Contraloría) sale como el CSV que va a COPY sin las
 * columnas que no se guardan, el SQL lee cada columna con su lector de las migraciones 223 y 225, el upsert y las
 * retiradas son los de Python, y el paso de carga (con una base falsa) manda las sentencias en orden: en seco termina con
 * ROLLBACK, con el sha256 ya cargado no abre transacción y con un archivo incompleto no marca retiradas. La página y el
 * archivo van por el relay de Lima, y el crudo se borra de R2 aunque la carga falle.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { WorkflowStep } from "cloudflare:workers";
import { strToU8, zipSync } from "fflate";
import type { Entrada } from "../src/almacen.ts";
import type { Env } from "../src/config.ts";
import { leerCsv } from "../src/csv.ts";
import type { Copia, Db } from "../src/db.ts";
import {
  COLUMNAS, DESTINOS, GUARDADAS, SQL_CRUDA, SQL_CUENTA, SQL_DESTINO, SQL_FECHA, SQL_NORMALIZAR, SQL_RETIRAR, SQL_UPSERT,
  URL_DATASETS, bajarObras, cargarObras, correrInfobras, cuentaObras, enlaceObras, fechaDmy, hayCambios, nombrePublicado,
  obrasComoCsv,
} from "../src/fuentes/infobras.ts";
import type { Bajado, ResumenCarga } from "../src/fuentes/infobras.ts";
import { URL_LIMA } from "../src/http.ts";
import { leerXlsx } from "../src/xlsx.ts";
import { cuentaXlsx, filasXlsx, xlsxComoCsv } from "../src/xlsx_flujo.ts";

/** La cabecera del XLSX de INFOBRAS del 2026-10-31, tal cual (con los dobles espacios y los espacios del final). */
const CABECERA = ["codigo Entidad", "Entidad Pública", "Código INFOBRAS", "Nombre de obra", "Modalidad de ejecución de la obra",
  "¿Corresponde a un saldo de Obra?", "Código INFOBRAS de obra inicial", "Naturaleza de la obra", "Tipo de obra - Clasificador Nivel 1",
  "Tipo de obra - Clasificador Nivel 2", "Tipo de obra - Clasificador Nivel 3", "Estado de ejecución", "Marca Reconstrucción con Cambios (Si/No)",
  "Marca Reactivación Economicas (Si/No)", "Otra Marca", "N° de Veedurías Ciudadanas", "N° Informes de control", "N° Comentarios ciudadanos",
  "¿Es una obra de carácter reservado?", "Nivel de gobierno", "Sector de la Entidad", "Codigo unico de inversión", "Código SNIP",
  "Nombre de la inversión", "Estado del proyecto", "Tipo Formato", "Monto Viable/Aprobado", "Costo Actualizado de la inversión",
  "N° obras pertenecientes a la inversión", "Departamento", "Provincia", "Distrito", "Dirección o información de referencia",
  "Tipo de ubicación (exacta/referencial)", "Fecha de aprobación del expediente ", "Costo de obra según Expediente técnico", "Moneda",
  "Tasa de cambio", "Costo de obra en soles según ET en soles", "Documento de aprobación de expediente", "RUC (Ejecución)",
  "Nombre o razón social de la empresa o consorcio", "Monto del contrato  en soles", "RUC (Supervisión)",
  "Nombre o razón social de la empresa o consorcio:", "Monto del contrato  en soles", "Nombres Apellidos (Supervisión)",
  "Fecha inicio supervision", "Fecha fin supervision", "Nombres Apellidos (Residente)", "Fecha inicio de labores", "Fecha fin  de labores",
  "Fecha de inicio de obra", "Fecha finalización programada de obra", "Plazo de ejecución (en dias)", "Tipo de entrega",
  "Porcentaje de terreno entregado", "Fecha de entrega del terreno", "Año de avance", "Mes de avance", "Fecha de registro de avance",
  "Avance Físico Programado Acumulado (%)", "Avance Físico Real Acumulado (%)", "Monto de valorización Programado Acumulado",
  "Monto de valorización Ejecutado Acumulado", "Porcentaje de ejecución financiera", "Monto de ejecución financiera de la obra",
  "Existe Paralización", "Causal de paralización", "Fecha de paralización", "Número de dias paralizado", "Comentarios",
  "N° de modificaciones", "N° días de modificaciones de plazo", "Nuevo Plazo de ejecución (en dias)",
  "Fecha finalización reprogramada de obra", "N° de controversias", "N° de adicionales de obra", "Monto de adicionales de obra en soles",
  "N° de adicionales de supervisión", "Monto de adicionales de supervisión en soles", "N° de deductivos de obra",
  "Monto de deductivos de obra en soles", "N° de deductivos de supervisión ", "Monto de deductivos de supervisión en soles",
  "Fecha de finalización real", "Motivo en caso no se llegue al 100%", "¿Tiene recepción total?", "Fecha de recepción",
  "¿Tiene liquidación de obra?", "Fecha de aprobación de liquidación de obra", "Costo de la obra en soles",
  "¿Corresponde la transferencia  a otra entidad?", "Fecha de transferencia", "Tipo de entidad que recepciona la obra",
  "Año de primer devengado", "Monto Total devengado del proyecto"];

const PREAMBULO = [["Dataset - Obras Públicas"], ["Fuente: Sistema de información de obras públicas - INFOBRAS"],
  ["Fecha de consulta: 31/10/2026"]];

const posicion = (cabecera: string) => CABECERA.indexOf(cabecera);
/** Lo que nunca se guarda, con valores de prueba (ninguna persona real): no puede salir en el CSV ni llegar a la base. */
const PRIVADAS: Record<number, string> = {
  [posicion("Nombres Apellidos (Supervisión)")]: "PERSONA DE PRUEBA SUPERVISORA",
  [posicion("Nombres Apellidos (Residente)")]: "PERSONA DE PRUEBA RESIDENTE",
  [posicion("Fecha inicio de labores")]: "01/01/2001",
  [posicion("Fecha fin  de labores")]: "02/02/2002",
  [posicion("Comentarios")]: "COMENTARIO LIBRE DE PRUEBA",
  [posicion("Dirección o información de referencia")]: "AV. DE PRUEBA 123",
  [posicion("Documento de aprobación de expediente")]: "RESOLUCION DE PRUEBA 9",
};
const NUNCA = /PERSONA DE PRUEBA|COMENTARIO LIBRE|AV\. DE PRUEBA|RESOLUCION DE PRUEBA|01\/01\/2001|02\/02\/2002/;

/** Una fila de la hoja: los valores de las columnas que se guardan, por su destino; las privadas, con sus valores de prueba. */
function fila(valores: Record<string, string>): string[] {
  return COLUMNAS.map(([, destino], i) => (destino ? (valores[destino] ?? "") : (PRIVADAS[i] ?? "")));
}

const OBRA_1 = { codigo: "4", nombre: 'MEJORAMIENTO DEL "PARQUE", ETAPA 1', entidad_nombre: "MUNICIPALIDAD DISTRITAL DE PRUEBA",
  es_saldo: "No", cui: "2316270", monto_viable: "S/4 195 186 00", fecha_inicio: "15/03/2020", ejecutor_ruc: "20123456789",
  contrato_monto: "1205287 56", recepcion: "Si", adicionales_monto: "0" };
const OBRA_2 = { codigo: "7", nombre: "AGUA POTABLE", ejecutor_ruc: "C0002088241", paralizada: "Si", transferida: "No" };

test("columnas: las 97 de cargar_obras.py, con la cabecera del archivo; 80 se guardan y nunca las privadas", () => {
  assert.deepEqual(COLUMNAS.map(([c]) => c), CABECERA);
  assert.equal(GUARDADAS.length, 80);
  assert.equal(new Set(DESTINOS).size, 80);
  for (const i of Object.keys(PRIVADAS).map(Number)) assert.equal(COLUMNAS[i][1], null, CABECERA[i]);
  assert.ok(!DESTINOS.some((d) => /nombres_apellidos|residente|labores|comentarios$|direccion|documento/.test(d)));
  // Las dos «Monto del contrato  en soles»: la primera es la de ejecución y la segunda, la de supervisión.
  assert.deepEqual(COLUMNAS.filter(([c]) => c === "Monto del contrato  en soles").map(([, d]) => d), ["contrato_monto", "supervision_monto"]);
});

test("enlace: el del dataset de obras (no el de APP) en la página de DataSets, sin &amp;, y su nombre publicado", () => {
  const a = (archivo: string) => `<a class="download-file btn-download-dataset"
       href="/InfobrasWeb/Archivo/DownloadFile?filename=${archivo}%2031-10-2026&amp;name=${archivo}%2031-10-2026&amp;contentType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet&amp;extension=.xlsx"
       data-filename="${archivo} 31-10-2026">`;
  const html = `<div>${a("DataSet-Asociaciones-Publico-Privadas")}</div><div>${a("DataSet-Obras-Publicas")}</div>`;
  const url = enlaceObras(html);
  assert.equal(url, "https://infobras.contraloria.gob.pe/InfobrasWeb/Archivo/DownloadFile?filename=DataSet-Obras-Publicas%2031-10-2026" +
    "&name=DataSet-Obras-Publicas%2031-10-2026&contentType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet&extension=.xlsx");
  assert.equal(nombrePublicado(url!), "DataSet-Obras-Publicas 31-10-2026.xlsx");
  assert.equal(enlaceObras(`<div>${a("DataSet-Asociaciones-Publico-Privadas")}</div>`), null);
});

test("fechaDmy: fecha() de Python (dd/mm/aaaa, lo que sigue tras un espacio, días que existen, de 1980 a 2100)", () => {
  const casos: [string, string | null][] = [
    ["31/10/2026", "2026-10-31"], ["1/2/2020", "2020-02-01"], [" 01/02/2020 10:00:00 ", "2020-02-01"], ["29/02/2024", "2024-02-29"],
    ["29/02/2023", null], ["31/04/2020", null], ["00/01/2020", null], ["01/13/2020", null], ["01/01/1979", null], ["31/12/2100", "2100-12-31"],
    ["01/01/2101", null], ["01/02/2020x", null], ["2020-02-01", null], ["", null], ["01/02/2020 a\nb", null],
  ];
  for (const [v, esperada] of casos) assert.equal(fechaDmy(v), esperada, JSON.stringify(v));
});

async function* desde(filas: (string | null)[][]): AsyncGenerator<(string | null)[]> {
  for (const f of filas) yield f;
}

test("CSV para COPY: sin las filas de título, con la fecha de consulta y sólo las columnas que se guardan", async () => {
  const corta = fila(OBRA_2).slice(0, 50);   // una fila que termina antes: lo que falta va vacío
  const ancha = [...fila({ codigo: "9", nombre: "X" }), "", "DE MÁS"];
  for (const trozo of [1, 300, 1 << 20]) {
    const cuenta = cuentaObras();
    const texto = await new Response(obrasComoCsv(desde([...PREAMBULO, CABECERA, fila(OBRA_1), [], corta, ancha]), cuenta, trozo)).text();
    assert.doesNotMatch(texto, NUNCA);
    const [cab, ...filas] = leerCsv(texto);
    assert.deepEqual(cab, DESTINOS);
    assert.equal(filas.length, 4);
    const como = (f: string[]) => Object.fromEntries(DESTINOS.map((d, k) => [d, f[k]]).filter(([, v]) => v !== ""));
    assert.deepEqual(como(filas[0]), OBRA_1);
    assert.deepEqual(filas[1], DESTINOS.map(() => ""));   // la fila vacía también va (Python la cuenta y la descarta)
    assert.deepEqual(como(filas[2]), Object.fromEntries(Object.entries(OBRA_2).filter(([d]) => GUARDADAS.find((g) => g.destino === d)!.i < 50)));
    assert.deepEqual(como(filas[3]), { codigo: "9", nombre: "X" });
    assert.deepEqual(cuenta, { filas: 4, consulta: "2026-10-31", anchas: 1 });
  }
});

test("CSV para COPY: una cabecera distinta o ninguna cortan la lectura", async () => {
  const otra = [...CABECERA];
  otra[46] = "Nombres y Apellidos (Supervisión)";
  await assert.rejects(new Response(obrasComoCsv(desde([...PREAMBULO, otra, fila(OBRA_1)]))).text(),
    /INFOBRAS cambió sus columnas: \[\[46,"Nombres Apellidos \(Supervisión\)","Nombres y Apellidos \(Supervisión\)"\]\]/);
  await assert.rejects(new Response(obrasComoCsv(desde([...PREAMBULO, CABECERA.slice(0, 96)]))).text(), /INFOBRAS cambió sus columnas/);
  await assert.rejects(new Response(obrasComoCsv(desde(PREAMBULO))).text(), /no trae la cabecera/);
  // Sin la fila de cabecera, la primera de datos haría de cabecera: el error no muestra lo que trae (nombres de personas).
  await assert.rejects(new Response(obrasComoCsv(desde([...PREAMBULO, fila(OBRA_1)]))).text(), (e: Error) =>
    /la fila que hace de cabecera trae 0 de los 97 nombres de siempre \(de 97 celdas\)/.test(e.message) && !NUNCA.test(e.message) &&
    !e.message.includes("PARQUE"));
});

// ─── El XLSX como lo publica INFOBRAS ──────────────────────────────────────────────────────────────────────────────────

const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** La hoja como la escribe el SDK de OpenXML de INFOBRAS: prefijo x:, t="str", sin r= y las vacías con <x:v></x:v>. */
const hojaInfobras = (filas: string[][]) =>
  `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>` +
  filas.map((f) => `<x:row>${f.map((c) => `<x:c t="str"><x:v>${xml(c)}</x:v></x:c>`).join("")}</x:row>`).join("") +
  "</x:sheetData></x:worksheet>";

/** Un XLSX con las partes del de INFOBRAS (y, si se pasan, textos compartidos con prefijo). */
function libro(hoja: string, compartidos?: string): Uint8Array {
  const rel = (tipo: string, destino: string, id: string) =>
    `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${tipo}" Target="${destino}" Id="${id}" />`;
  const archivos: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Sheet1" sheetId="1" r:id="R1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>`),
    "xl/worksheets/sheet1.xml": strToU8(hoja),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("officeDocument", "/xl/workbook.xml", "R0")}</Relationships>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("worksheet", "/xl/worksheets/sheet1.xml", "R1")}${compartidos ? rel("sharedStrings", "/xl/sharedStrings.xml", "R2") : ""}</Relationships>`),
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />${compartidos ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" />' : ""}</Types>`),
  };
  if (compartidos) archivos["xl/sharedStrings.xml"] = strToU8(compartidos);
  return zipSync(archivos, { level: 6 });
}

/** Los bytes en trozos de `tam`, como el cuerpo de un objeto de R2 (los cortes caen en cualquier lado). */
function enTrozos(bytes: Uint8Array, tam: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, (i += tam)));
    },
  });
}

const leerEnTrozos = (bytes: Uint8Array, tam: number) => async (o: number, l: number) => enTrozos(bytes.subarray(o, o + l), tam);

const XLSX_INFOBRAS = libro(hojaInfobras([...PREAMBULO, CABECERA, fila(OBRA_1), fila({ ...OBRA_2, entidad_nombre: "A & B <S.A.>" })]));

test("XLSX de INFOBRAS (x:row, x:c t=\"str\", sin r=): filasXlsx da las filas tal cual y el CSV no lleva las privadas", async () => {
  for (const tam of [7, 1000, 1 << 20]) {
    const filas: (string | null)[][] = [];
    for await (const f of filasXlsx(leerEnTrozos(XLSX_INFOBRAS, tam), XLSX_INFOBRAS.length)) filas.push(f);
    assert.equal(filas.length, 6);
    assert.deepEqual(filas.slice(0, 3), PREAMBULO);
    assert.deepEqual(filas[3], CABECERA);
    // Las vacías vienen como "" (<x:v></x:v>), como en Python.
    assert.deepEqual(filas[4], fila(OBRA_1));
    assert.equal(filas[5][1], "A & B <S.A.>");
    const cuenta = cuentaObras();
    const texto = await new Response(obrasComoCsv(filasXlsx(leerEnTrozos(XLSX_INFOBRAS, tam), XLSX_INFOBRAS.length), cuenta)).text();
    assert.doesNotMatch(texto, NUNCA);
    assert.equal(leerCsv(texto).length, 3);
    assert.deepEqual(cuenta, { filas: 2, consulta: "2026-10-31", anchas: 0 });
  }
});

test("xlsx_flujo con prefijo: textos compartidos (x:si, guía fonética), inlineStr y r=, como SheetJS y como sin prefijo", async () => {
  const conPrefijo = (p: string) => {
    const hoja = `<?xml version="1.0"?><${p}worksheet xmlns${p ? `:${p.slice(0, -1)}` : ""}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${p}sheetData>` +
      `<${p}row r="1"><${p}c r="A1" t="s"><${p}v>0</${p}v></${p}c><${p}c r="B1" t="s"><${p}v>1</${p}v></${p}c><${p}c r="C1" t="inlineStr"><${p}is><${p}t>RUC</${p}t></${p}is></${p}c></${p}row>` +
      `<${p}row r="2"><${p}c r="A2"><${p}v>12</${p}v></${p}c><${p}c r="C2" t="s"><${p}v>2</${p}v></${p}c></${p}row>` +
      `<${p}row r="3"/>` +
      `<${p}row r="4"><${p}c r="B4" t="s"><${p}v>3</${p}v></${p}c><${p}c r="C4" t="s"/></${p}row>` +
      `</${p}sheetData><${p}rowBreaks count="0"/></${p}worksheet>`;
    const sst = `<?xml version="1.0"?><${p}sst xmlns${p ? `:${p.slice(0, -1)}` : ""}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4">` +
      `<${p}si><${p}t>CODIGO</${p}t></${p}si><${p}si><${p}t>NOMBRE</${p}t></${p}si>` +
      `<${p}si><${p}r><${p}t>CONSORCIO </${p}t></${p}r><${p}r><${p}t>A &amp; B</${p}t></${p}r></${p}si>` +
      `<${p}si><${p}t>EMPRESA</${p}t><${p}rPh sb="0" eb="1"><${p}t>ﾌﾘｶﾞﾅ</${p}t></${p}rPh></${p}si></${p}sst>`;
    return libro(hoja, sst);
  };
  const esperado = [["CODIGO", "NOMBRE", "RUC"], ["12", "", "CONSORCIO A & B"], ["", "EMPRESA", ""]];
  for (const p of ["", "x:", "ss:"]) {
    const bytes = conPrefijo(p);
    for (const comprimirDesde of [undefined, 0]) {   // 0: cuenta los usos (contarUsos) y comprime los que se usan una vez
      const cuenta = cuentaXlsx();
      const texto = await new Response(xlsxComoCsv(leerEnTrozos(bytes, 5), bytes.length, 64, cuenta, { comprimirDesde, porBloque: 2 })).text();
      assert.deepEqual(leerCsv(texto), esperado, `prefijo «${p}»`);
      assert.equal(cuenta.filas, 2);
    }
    // SheetJS (src/xlsx.ts) lee lo mismo.
    assert.deepEqual(leerXlsx(bytes).filter((f) => f.length).map((f) => [...f, ...Array(3 - f.length).fill(null)].map((v) => (v == null ? "" : String(v)))), esperado, `SheetJS «${p}»`);
  }
});

// ─── SQL ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("SQL: la temporal sólo con las 80 columnas, cada una con su lector, y la cuenta de las que no se leen", () => {
  assert.equal(SQL_CRUDA, `CREATE TEMP TABLE _infobras_crudo (_fila bigint GENERATED ALWAYS AS IDENTITY, ${DESTINOS.map((d) => `${d} text`).join(", ")}) ON COMMIT DROP`);
  assert.doesNotMatch(SQL_CRUDA + SQL_NORMALIZAR, /nombres|residente|labores|comentarios |direccion|documento/i);
  for (const e of ["norm_entero(s.codigo) AS codigo", "norm_texto(s.nombre) AS nombre", "norm_si(s.es_saldo) AS es_saldo",
    "COALESCE(norm_entero(s.veedurias), 0) AS veedurias", "norm_cui(s.cui) AS cui", "norm_snip(s.snip) AS snip",
    "norm_monto(s.monto_viable) AS monto_viable", "norm_fecha(s.fecha_aprob_et) AS fecha_aprob_et", "norm_ruc(s.ejecutor_ruc) AS ejecutor_ruc",
    "norm_ruc(s.supervisor_ruc) AS supervisor_ruc", "norm_texto(s.supervisor_nombre) AS supervisor_nombre",
    "COALESCE(norm_monto(s.adicionales_monto), 0) AS adicionales_monto", "norm_si(s.paralizada) AS paralizada",
    "norm_si_nulo(s.recepcion) AS recepcion", "norm_si_nulo(s.transferida) AS transferida", "norm_monto(s.devengado_total) AS devengado_total"]) {
    assert.ok(SQL_NORMALIZAR.includes(e), e);
  }
  // Una expresión por columna, con la barrera OFFSET 0 (cada celda se normaliza una vez), la huella y la fecha de consulta.
  for (const d of DESTINOS) assert.equal(SQL_NORMALIZAR.split(` AS ${d},\n`).length + SQL_NORMALIZAR.split(` AS ${d}\n`).length - 2, 1, d);
  assert.ok(SQL_NORMALIZAR.startsWith(`INSERT INTO _obra_infobras (${DESTINOS.join(", ")}, huella, dataset_fecha)\n`));
  assert.ok(SQL_NORMALIZAR.includes(`md5(ROW(${DESTINOS.map((d) => `x.${d}`).join(", ")})::text), $1::date`));
  assert.match(SQL_NORMALIZAR, /\n {10}FROM _infobras_crudo s\n {8}OFFSET 0\) x\n WHERE x\.codigo IS NOT NULL AND x\.nombre IS NOT NULL\n ORDER BY x\.codigo, x\.fila$/);
  assert.equal(SQL_DESTINO, "CREATE TEMP TABLE _obra_infobras (LIKE obra_infobras INCLUDING DEFAULTS, PRIMARY KEY (codigo)) ON COMMIT DROP");
  // Ilegibles: sólo en las columnas monto, fecha y entero (como Python), no en las *0 ni en las de texto.
  assert.ok(SQL_CUENTA.includes("count(*) FILTER (WHERE norm_monto(s.costo_et) IS NULL AND norm_texto(s.costo_et) IS NOT NULL)::int AS costo_et"));
  assert.ok(SQL_CUENTA.includes("count(*) FILTER (WHERE norm_fecha(s.fecha_inicio) IS NULL AND norm_texto(s.fecha_inicio) IS NOT NULL)::int AS fecha_inicio"));
  assert.ok(!/AS (veedurias|adicionales_monto|nombre|ejecutor_ruc|recepcion)\b/.test(SQL_CUENTA));
  assert.ok(SQL_CUENTA.includes("count(*) FILTER (WHERE norm_entero(s.codigo) IS NULL OR norm_texto(s.nombre) IS NULL)::int AS sin_codigo_o_nombre"));
});

test("SQL: upsert, retiradas y la fecha del archivo, como cargar_obras.py", () => {
  for (const d of DESTINOS.slice(1)) {
    if (d !== "codigo") assert.ok(SQL_UPSERT.includes(` ${d} = EXCLUDED.${d},`), d);
  }
  assert.ok(!SQL_UPSERT.includes("codigo = EXCLUDED.codigo"));
  assert.ok(SQL_UPSERT.includes(" huella = EXCLUDED.huella, dataset_fecha = EXCLUDED.dataset_fecha,\n    retirada = false, cambiado_at = now()"));
  assert.match(SQL_UPSERT, /SELECT DISTINCT ON \(codigo\) entidad_codigo, .*, huella, dataset_fecha, false, now\(\), now\(\) FROM _obra_infobras ORDER BY codigo\n/);
  assert.match(SQL_UPSERT, /\n  WHERE t\.huella IS DISTINCT FROM EXCLUDED\.huella OR t\.retirada\n  RETURNING \(xmax = 0\) AS nueva\)/);
  assert.match(SQL_RETIRAR, /SET retirada = true, cambiado_at = now\(\)\n WHERE NOT t\.retirada AND NOT EXISTS \(SELECT 1 FROM _obra_infobras x WHERE x\.codigo = t\.codigo\)/);
  assert.match(SQL_FECHA, /VALUES \('infobras_fecha', \(\$1::date\)::timestamp AT TIME ZONE 'America\/Lima', 'fecha de consulta del último archivo de INFOBRAS'\)\nON CONFLICT \(clave\) DO UPDATE SET valor = EXCLUDED\.valor$/);
});

test("refrescar_obras: con obras nuevas, cambiadas o retiradas, o con otra fecha del archivo", () => {
  const base = { nuevas: 0, cambiadas: 0, retiradas: 0, fecha: "2026-10-31", fecha_anterior: "2026-10-31" };
  assert.ok(!hayCambios(base));
  assert.ok(hayCambios({ ...base, cambiadas: 1 }));
  assert.ok(hayCambios({ ...base, retiradas: 1 }));
  assert.ok(hayCambios({ ...base, fecha_anterior: "2026-10-24" }));
  assert.ok(hayCambios({ ...base, fecha_anterior: null }));
});

// ─── El paso de carga con una base falsa ───────────────────────────────────────────────────────────────────────────

const SHA = "f".repeat(64);

function bajado(bytes: Uint8Array): Bajado {
  const entrada: Entrada = { url: "https://infobras.contraloria.gob.pe/InfobrasWeb/Archivo/DownloadFile?filename=DataSet-Obras-Publicas%2031-10-2026",
    file: "infobras/obras/obras.xlsx", sha256: SHA, bytes: bytes.length, downloaded_at: "2026-10-31T13:00:00+00:00", modified: null };
  return { entrada, archivo: "DataSet-Obras-Publicas 31-10-2026.xlsx" };
}

/** Un R2 que guarda en memoria (lo que usan Almacen y la carga) y anota lo que se borra. */
function r2Falso(iniciales: Record<string, Uint8Array> = {}) {
  const objetos = new Map(Object.entries(iniciales));
  const borrados: string[] = [];
  const bucket = {
    async head(k: string) {
      const b = objetos.get(k);
      return b ? { size: b.length } : null;
    },
    async get(k: string, op?: { range?: { offset: number; length: number } }) {
      const b = objetos.get(k);
      if (!b) return null;
      const o = op?.range?.offset ?? 0;
      const parte = b.subarray(o, o + (op?.range?.length ?? b.length - o));
      return { size: b.length, body: enTrozos(parte, 113), json: async () => JSON.parse(new TextDecoder().decode(b)) };
    },
    async put(k: string, v: string | ArrayBuffer | ReadableStream<Uint8Array>) {
      objetos.set(k, typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v instanceof ReadableStream ? await new Response(v).arrayBuffer() : v));
    },
    async delete(k: string) {
      objetos.delete(k);
      borrados.push(k);
    },
  };
  return { bucket, objetos, borrados };
}

interface Op { cargados?: boolean; vivas?: number; copiadas?: number; anterior?: string | null }

/** Anota cada sentencia y responde lo mínimo. COPY cuenta los registros (sin la cabecera si lleva HEADER). */
function baseFalsa(op: Op = {}) {
  const sentencias: { sql: string; params?: unknown[] }[] = [];
  let copiado = "";
  const db = {
    async filas(sql: string, params?: unknown[]) {
      sentencias.push({ sql, params });
      if (sql.includes("FROM datasets_cargas")) return op.cargados ? [{ "?column?": 1 }] : [];
      if (sql.startsWith("SELECT count(*)::int AS filas")) return [{ filas: 2, sin_codigo_o_nombre: 0, fecha_inicio: 3, monto_viable: 0 }];
      if (sql.startsWith("WITH up AS")) return [{ nuevas: 1, cambiadas: 0 }];
      if (sql.includes("AS vivas")) return [{ vivas: op.vivas ?? 2 }];
      if (sql.startsWith("SELECT to_char")) return op.anterior === null ? [] : [{ fecha: op.anterior ?? "2026-10-24" }];
      throw new Error(`consulta inesperada: ${sql}`);
    },
    async ejecutar(sql: string, params?: unknown[]) {
      sentencias.push({ sql, params });
      if (sql.startsWith("INSERT INTO _obra_infobras")) return op.copiadas ?? 2;
      if (sql.startsWith("UPDATE obra_infobras")) return 3;
      return 0;
    },
    async abrirCopia(sql: string): Promise<Copia> {
      sentencias.push({ sql });
      return {
        async escribir(d: Uint8Array) {
          copiado += new TextDecoder().decode(d);
        },
        async cerrar() {
          const n = copiado.split("\n").length - 1;
          return sql.includes("HEADER") ? n - 1 : n;
        },
      };
    },
  } as unknown as Db;
  return { db, sentencias, copiado: () => copiado };
}

/** Una etiqueta corta por sentencia, para comparar el orden. */
function etiqueta(sql: string): string {
  const reglas: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
    [/^SELECT 1 FROM datasets_cargas/, "¿ya cargado?"],
    [/^(BEGIN|COMMIT|ROLLBACK)$/, (m) => m[1]],
    [/^SET LOCAL (\w+)/, (m) => `SET ${m[1]}`],
    [/^CREATE TEMP TABLE (\w+)/, (m) => `temporal ${m[1]}`],
    [/^COPY (\w+)/, (m) => `COPY ${m[1]}`],
    [/^SELECT count\(\*\)::int AS filas/, "cuenta"],
    [/^INSERT INTO _obra_infobras/, "normalizar"],
    [/^WITH up AS/, "upsert"],
    [/AS vivas/, "vivas"],
    [/^UPDATE obra_infobras/, "retirar"],
    [/^SELECT to_char/, "fecha anterior"],
    [/^INSERT INTO obra_refresco/, "fecha"],
    [/^INSERT INTO datasets_cargas/, "registrar"],
  ];
  for (const [re, nombre] of reglas) {
    const m = sql.match(re);
    if (m) return typeof nombre === "string" ? nombre : nombre(m);
  }
  return sql.slice(0, 40);
}

const ORDEN = ["BEGIN", "SET lock_timeout", "SET statement_timeout", "SET work_mem", "temporal _infobras_crudo", "COPY _infobras_crudo",
  "cuenta", "temporal _obra_infobras", "normalizar", "upsert", "vivas"];
const envCon = (bytes: Uint8Array) => ({ CRUDOS: r2Falso({ "raw/infobras/obras/obras.xlsx": bytes }).bucket }) as unknown as Env;

test("carga: las sentencias en orden, sin las columnas privadas en COPY, el resumen y datasets_cargas", async () => {
  const { db, sentencias, copiado } = baseFalsa();
  const r = await cargarObras(envCon(XLSX_INFOBRAS), db, bajado(XLSX_INFOBRAS), {}, "prueba");
  assert.deepEqual(sentencias.map((s) => etiqueta(s.sql)), ["¿ya cargado?", ...ORDEN, "retirar", "fecha anterior", "fecha", "registrar", "COMMIT"]);
  const copy = sentencias.find((s) => s.sql.startsWith("COPY"))!.sql;
  assert.equal(copy, `COPY _infobras_crudo (${DESTINOS.join(", ")}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')`);
  assert.doesNotMatch(copiado(), NUNCA);
  assert.ok(copiado().startsWith(`${DESTINOS.join(",")}\n`));
  // dataset_fecha y obra_refresco: la fecha de consulta del archivo.
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith("INSERT INTO _obra_infobras"))!.params, ["2026-10-31"]);
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith("INSERT INTO obra_refresco"))!.params, ["2026-10-31"]);
  const p = sentencias.find((s) => s.sql.startsWith("INSERT INTO datasets_cargas"))!.params!;
  assert.deepEqual([p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[9]], ["infobras", "obras", "obra_infobras",
    "DataSet-Obras-Publicas 31-10-2026.xlsx", "r2://vigia-peru-crudos/raw/infobras/obras/obras.xlsx", SHA, XLSX_INFOBRAS.length, 2,
    "2026-10-31T13:00:00+00:00"]);
  assert.deepEqual({ ...(r as ResumenCarga), segundos: 0 }, {
    archivo: "DataSet-Obras-Publicas 31-10-2026.xlsx", consulta: "2026-10-31", fecha: "2026-10-31", fecha_anterior: "2026-10-24",
    filas: 2, sin_codigo_o_nombre: 0, codigos_repetidos: 0, copiadas: 2, nuevas: 1, cambiadas: 0, iguales: 1, retiradas: 3,
    ilegibles: { fecha_inicio: 3 }, sentencias: 1, segundos: 0,
  });
});

test("carga en seco: todo igual y ROLLBACK, sin datasets_cargas; con el sha256 ya cargado, nada; con forzar, carga", async () => {
  const seco = baseFalsa({ cargados: true });
  const r = await cargarObras(envCon(XLSX_INFOBRAS), seco.db, bajado(XLSX_INFOBRAS), { seco: true }, "prueba");
  assert.deepEqual(seco.sentencias.map((s) => etiqueta(s.sql)), [...ORDEN, "retirar", "fecha anterior", "fecha", "ROLLBACK"]);
  assert.equal((r as ResumenCarga).seco, true);

  const ya = baseFalsa({ cargados: true });
  assert.deepEqual(await cargarObras(envCon(XLSX_INFOBRAS), ya.db, bajado(XLSX_INFOBRAS), {}, "prueba"), { ya_cargado: true, sha256: SHA });
  assert.deepEqual(ya.sentencias.map((s) => etiqueta(s.sql)), ["¿ya cargado?"]);

  const forzado = baseFalsa({ cargados: true });
  await cargarObras(envCon(XLSX_INFOBRAS), forzado.db, bajado(XLSX_INFOBRAS), { forzar: true }, "prueba");
  assert.equal(etiqueta(forzado.sentencias.at(-1)!.sql), "COMMIT");
});

test("carga: con menos del 90 % de lo vivo no marca retiradas; con otra cabecera, ROLLBACK; con otro tamaño en R2, nada", async () => {
  const { db, sentencias } = baseFalsa({ vivas: 100, copiadas: 89, anterior: null });
  const r = (await cargarObras(envCon(XLSX_INFOBRAS), db, bajado(XLSX_INFOBRAS), {}, "prueba")) as ResumenCarga;
  assert.ok(!sentencias.some((s) => etiqueta(s.sql) === "retirar"));
  assert.equal(r.retiradas, 0);
  assert.match(r.sin_retirar ?? "", /trae 89 de 100 obras vivas/);
  assert.equal(r.fecha_anterior, null);
  assert.equal(etiqueta(sentencias.at(-1)!.sql), "COMMIT");

  const otra = [...CABECERA];
  otra[0] = "Código Entidad";
  const xlsxOtro = libro(hojaInfobras([...PREAMBULO, otra, fila(OBRA_1)]));
  const roto = baseFalsa();
  await assert.rejects(cargarObras(envCon(xlsxOtro), roto.db, bajado(xlsxOtro), {}, "prueba"), /INFOBRAS cambió sus columnas/);
  assert.equal(etiqueta(roto.sentencias.at(-1)!.sql), "ROLLBACK");

  const otroTam = baseFalsa();
  await assert.rejects(cargarObras(envCon(XLSX_INFOBRAS), otroTam.db, { ...bajado(XLSX_INFOBRAS), entrada: { ...bajado(XLSX_INFOBRAS).entrada, bytes: 5 } }, {}, "prueba"),
    /en R2 hay \d+ bytes y la descarga anotó 5/);
  assert.deepEqual(otroTam.sentencias.map((s) => etiqueta(s.sql)), ["¿ya cargado?"]);
});

// ─── Descarga por el relay de Lima y el crudo borrado ──────────────────────────────────────────────────────────────

/** crypto.DigestStream y FixedLengthStream son de Workers: aquí, lo mínimo que usa Almacen.bajar. */
function apisDeWorkers(): void {
  const c = crypto as unknown as Record<string, unknown>;
  c.DigestStream ??= class extends WritableStream<Uint8Array> {
    readonly digest: Promise<ArrayBuffer>;
    constructor(_algoritmo: string) {
      const h = createHash("sha256");
      let listo: (b: ArrayBuffer) => void = () => undefined;
      const digest = new Promise<ArrayBuffer>((r) => (listo = r));
      super({
        write(t) {
          h.update(t);
        },
        close() {
          const d = h.digest();
          listo(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
        },
      });
      this.digest = digest;
    }
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.FixedLengthStream ??= class extends TransformStream<Uint8Array, Uint8Array> {
    constructor(_largo: number) {
      super();
    }
  };
}

const ENLACE = "/InfobrasWeb/Archivo/DownloadFile?filename=DataSet-Obras-Publicas%2031-10-2026&amp;name=DataSet-Obras-Publicas%2031-10-2026&amp;contentType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet&amp;extension=.xlsx";

/** El relay de Lima (RELAY_LIMA): la página de DataSets y, para el enlace, `archivo` (null: 404). Anota cada pedido. */
function relayFalso(archivo: Uint8Array | null) {
  const pedidos: { url: string; destino: string; token: string | null }[] = [];
  const fetcher = {
    async fetch(url: string, init: RequestInit) {
      // El /health de la salida peruana (esperarRelayLima): responde siempre.
      if (url.endsWith("/health")) return Response.json({ ok: true, nombre: "prueba" });
      const destino = (JSON.parse(String(init.body)) as { url: string }).url;
      pedidos.push({ url, destino, token: new Headers(init.headers).get("X-Vigia-Token") });
      if (destino === URL_DATASETS) return new Response(`<a href="${ENLACE}">Obras</a>`, { headers: { "x-relay-status": "200" } });
      if (!archivo) return new Response("no está", { status: 404, headers: { "x-relay-status": "404" } });
      return new Response(archivo, { headers: { "content-length": String(archivo.length), "x-relay-status": "200" } });
    },
  };
  return { pedidos, fetcher };
}

test("descarga: la página y el archivo por el relay de Lima, a raw/infobras/obras/obras.xlsx; uno chico no queda en R2", async () => {
  apisDeWorkers();
  const grande = new Uint8Array(10_000_001).fill(7);
  const r2 = r2Falso();
  const relay = relayFalso(grande);
  const env = { CRUDOS: r2.bucket, RELAY_LIMA: relay.fetcher, RELAY_LIMA_TOKEN: " token-de-prueba " } as unknown as Env;
  const b = await bajarObras(env);
  assert.deepEqual(relay.pedidos.map((x) => [x.url, x.destino, x.token]), [
    [`${URL_LIMA}/raw`, URL_DATASETS, "token-de-prueba"],
    [`${URL_LIMA}/raw`, `https://infobras.contraloria.gob.pe${ENLACE.replaceAll("&amp;", "&")}`, "token-de-prueba"],
  ]);
  assert.equal(b.archivo, "DataSet-Obras-Publicas 31-10-2026.xlsx");
  assert.equal(b.entrada.file, "infobras/obras/obras.xlsx");
  assert.equal(b.entrada.bytes, grande.length);
  assert.equal(b.entrada.sha256, createHash("sha256").update(grande).digest("hex"));
  assert.equal(r2.objetos.get("raw/infobras/obras/obras.xlsx")?.length, grande.length);

  const chico = r2Falso();
  const envChico = { CRUDOS: chico.bucket, RELAY_LIMA: relayFalso(new Uint8Array(1000)).fetcher } as unknown as Env;
  await assert.rejects(bajarObras(envChico), /1000 bytes, no parece el archivo de INFOBRAS/);
  assert.ok(!chico.objetos.has("raw/infobras/obras/obras.xlsx"));
  assert.deepEqual(chico.borrados, ["raw/infobras/obras/obras.xlsx"]);
});

test("corrida: si la carga o la descarga fallan, el crudo igual se borra de R2 y el error sigue", async () => {
  apisDeWorkers();
  const pasosDe = () => {
    const pasos: string[] = [];
    const step = { do: async (nombre: string, _op: unknown, fn: () => Promise<unknown>) => (pasos.push(nombre), fn()) } as unknown as WorkflowStep;
    return { pasos, step };
  };
  const r2 = r2Falso();
  const env = { CRUDOS: r2.bucket, RELAY_LIMA: relayFalso(new Uint8Array(10_000_001)).fetcher,
    // Nadie escucha en el puerto 9: la conexión falla enseguida.
    HYPERDRIVE: { connectionString: "postgres://u:p@127.0.0.1:9/vigia" } } as unknown as Env;
  const a = pasosDe();
  await assert.rejects(correrInfobras(env, { fuente: "infobras", origen: "prueba" }, a.step, "prueba"), /ECONNREFUSED|connect/);
  assert.deepEqual(a.pasos, ["relay de Lima: ¿responde? (1)", "descargar", "cargar obra_infobras", "borrar crudo"]);
  assert.ok(!r2.objetos.has("raw/infobras/obras/obras.xlsx"));
  assert.ok(r2.borrados.includes("raw/infobras/obras/obras.xlsx"));

  const sinArchivo = r2Falso();
  const b = pasosDe();
  await assert.rejects(correrInfobras({ ...env, CRUDOS: sinArchivo.bucket, RELAY_LIMA: relayFalso(null).fetcher } as unknown as Env,
    { fuente: "infobras", origen: "prueba" }, b.step, "prueba"), /HTTP 404/);
  assert.deepEqual(b.pasos, ["relay de Lima: ¿responde? (1)", "descargar", "borrar crudo"]);
  assert.deepEqual(sinArchivo.borrados, ["raw/infobras/obras/obras.xlsx"]);
});
