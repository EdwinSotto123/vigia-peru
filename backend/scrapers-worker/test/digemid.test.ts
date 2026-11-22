import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync } from "fflate";
import * as XLSX from "xlsx";
import { filaAlerta, leerPrecios, mesesAProbar, registroNorm, registrosEn, textoHtml } from "../src/fuentes/digemid.ts";

test("digemid: registro sanitario normalizado", () => {
  assert.equal(registroNorm("EE-01234"), "EE01234");
  assert.equal(registroNorm(" dm27013e "), "DM27013E");
  assert.equal(registroNorm("N25885"), "N25885");
  assert.equal(registroNorm("SIN REGISTRO"), null);
  assert.equal(registroNorm("123456"), null);
});

test("digemid: los registros que nombra un PDF, sin años sueltos", () => {
  const t = "GUANTES 20250502QX DM27013E Tianchang … R.S. EE-01234 y EN 05678; ALERTA N° 142-2026, SE 2026";
  assert.deepEqual(registrosEn(t).sort(), ["DM27013E", "EE01234", "EN05678"]);
});

test("digemid: una entrada de la API → la fila de la alerta", () => {
  const f = filaAlerta({
    id: 11272, date: "2026-11-19T17:10:42", modified: "2026-11-19T17:11:00", link: "https://www.digemid.minsa.gob.pe/webDigemid/alertas-modificaciones/2026/alerta-digemid-n142-2026/",
    categories: [34, 32, 35], title: { rendered: "ALERTA DIGEMID N&#xBA;142-2026" },
    content: { rendered: "<p><strong>RETIRO DEL MERCADO DE UN LOTE DE DISPOSITIVO M&Eacute;DICO</strong></p><p>Productos: Guantes QX Alkhofar</p><p><a href=\"/Archivos/Alertas/2026/ALERTA_142-26.pdf\">Descargar</a></p>" },
    excerpt: { rendered: "<p>Guantes QX Alkhofar</p>" },
  });
  assert.equal(f.numero, "142-2026");
  assert.equal(f.tipo, "calidad");
  assert.equal(f.fecha, "2026-11-19");
  assert.equal(f.productos, "Guantes QX Alkhofar");
  assert.match(f.motivo ?? "", /^RETIRO DEL MERCADO/);
  assert.equal(f.pdf_url, "https://www.digemid.minsa.gob.pe/Archivos/Alertas/2026/ALERTA_142-26.pdf");
  assert.equal(textoHtml("a&amp;b &#8211; c"), "a&b – c");
  // La forma de 2022: «Productos IFA» y «Productos Marca», y el PDF incrustado.
  const vieja = filaAlerta({
    id: 899, date: "2022-07-20T00:00:00", link: "https://x/", categories: [34, 32, 35], title: { rendered: "ALERTA DIGEMID N° 43-2022" },
    content: { rendered: "<h3><span>RETIRO DEL MERCADO VOLUNTARIO DE LOTES</span></h3>\n<p><b>Productos IFA:</b></p>\n<p><b>Productos Marca:</b><br />LERGIUM PLUS 5mg + 120mg cápsula</p>\n<p><embed src=\"/Archivos/Alertas/2022/ALERTA_43-22.pdf\" type=\"application/pdf\"></embed></p>" },
  });
  assert.equal(vieja.motivo, "RETIRO DEL MERCADO VOLUNTARIO DE LOTES");
  assert.equal(vieja.productos, "LERGIUM PLUS 5mg + 120mg cápsula");
  assert.equal(vieja.pdf_url, "https://www.digemid.minsa.gob.pe/Archivos/Alertas/2022/ALERTA_43-22.pdf");
});

test("digemid: el Excel del Indicador de precios → filas y periodo", () => {
  const cab = ["N°", "Código de Producto", "Nombre Comercial", "Concentración", "Forma Farmacéutica", "Presentación", "Fracciones", "Clasificación",
    "Registro Sanitario", "Titular de Registro Sanitario", "Fabricante", "País", "Grupo producto", "IFA", "Cantidad IFAS",
    "Cantidad de establecimientos reportantes por producto", "media", "mediana", "moda"];
  const hoja = XLSX.utils.aoa_to_sheet([
    ["MEDIDAS DE TENDENCIA CENTRAL DE PRECIOS"], ["INFORMACIÓN PUBLICADA EN LA PAGINA WEB DE LA DIGEMID - PERIODO SETIEMBRE 2026"], [], cab,
    [1, 165, "ACTEMRA", "80 MG / 4 ML", "CONCENTRADO", "CAJA VIAL X 4 ML", 1, "MARCA", "BE00552", "ROCHE FARMA (PERU) S.A.   ", "CHUGAI", "JAPON", "BIOLOGICO", "TOCILIZUMAB", 1, 9, 364.5, 639.6, 639.6],
    [2, 166, "PARACETAMOL", "500 mg", "TABLETA", "CAJA X 100", 100, "GENERICO    ", "en-03602", "X SAC", "Y", "PERU", "ESPECIALIDAD", "PARACETAMOL", 1, 2561, 0.1, 0.1, 0.1],
    [3, 166, "DUPLICADO", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja, "MTC");
  const xlsx = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  const zip = zipSync({ "CENTRAL 202609/MTC 202609.xlsx": xlsx, "CENTRAL 202609/Ficha.pdf": new Uint8Array([1]) });
  const { filas, periodo, archivo } = leerPrecios(zip);
  assert.equal(periodo, "2026-09-01");
  assert.equal(archivo, "MTC 202609.xlsx");
  assert.equal(filas.length, 2);
  assert.equal(filas[0].titular, "ROCHE FARMA (PERU) S.A.");
  assert.equal(filas[0].precio_mediana, 639.6);
  assert.equal(filas[1].registro, "EN03602");
  assert.equal(filas[1].clasificacion, "GENERICO");
  assert.equal(filas[1].ifa_norm, "PARACETAMOL");
});

test("digemid: meses a probar para el ZIP", () => {
  assert.deepEqual(mesesAProbar(Date.parse("2026-11-21T15:00:00Z")), ["202610", "202609", "202608", "202607"]);
  assert.deepEqual(mesesAProbar(Date.parse("2026-01-01T03:00:00Z"), 2), ["202511", "202510"]);
});
