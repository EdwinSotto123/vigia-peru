import test from "node:test";
import assert from "node:assert/strict";
import {
  buscarBases,
  documentosDePagina,
  enlaces,
  esDocumento,
  mencionaProceso,
  normalizar,
  numeroProceso,
  paginaDelAnio,
  procesarBases,
  tituloDocumento,
} from "../src/lib/basesPlaza.js";

test("el número del proceso sale del final de `numero`", () => {
  assert.equal(numeroProceso("D.LEG 1057 - DETERMINADO (NECESIDAD TRANSITORIA)-108"), 108);
  assert.equal(numeroProceso("276-26"), 26);
  assert.equal(numeroProceso("D.LEG 1057 - DETERMINADO (NECESIDAD TRANSITORIA)-003"), 3);
  assert.equal(numeroProceso("SIN NUMERO"), null);
  assert.equal(numeroProceso(null), null);
});

test("nombra al proceso sólo si el número va pegado a CAS, N°, proceso o convocatoria", () => {
  const n = (s: string) => normalizar(s);
  assert.ok(mencionaProceso(n("cas-n-108-2026-ugel01-convocatoria"), 108));
  assert.ok(mencionaProceso(n("CAS N° 005-2026"), 5));
  assert.ok(mencionaProceso(n("PROCESO CAS N° 93 -2026-UNAS"), 93));
  assert.ok(mencionaProceso(n("Convocatoria 007"), 7));
  assert.ok(!mencionaProceso(n("CAS N° 1080-2026"), 108));
  assert.ok(!mencionaProceso(n("BASES_CAS_11062026.pdf"), 5));
  assert.ok(!mencionaProceso(n("Hay 5 vacantes"), 5));
});

test("los enlaces: absolutos, sin anclas ni javascript, y sin las vistas previas de gob.pe", () => {
  const html = `<a href="/institucion/x/informes-publicaciones/1-cas-n-1-2026">CAS N° 1</a><a href="#arriba">Arriba</a>
    <a href="javascript:void(0)">x</a><a href='docs/Bases%20CAS.pdf'><span>Bases</span> &amp; anexos</a>`;
  const e = enlaces(html, "https://www.gob.pe/institucion/x/colecciones/9-cas");
  assert.deepEqual(e.map((x) => x.url), ["https://www.gob.pe/institucion/x/informes-publicaciones/1-cas-n-1-2026", "https://www.gob.pe/institucion/x/colecciones/docs/Bases%20CAS.pdf"]);
  assert.equal(e[1].texto, "Bases & anexos");
  assert.ok(esDocumento("https://cdn.www.gob.pe/uploads/document/file/1/2-bases.pdf?v=3"));
  assert.ok(!esDocumento("https://cdn.www.gob.pe/uploads/document/file/1/preview_2-bases.jpg?v=3"));
});

test("en la página del proceso, las bases antes que los resultados (y sin los de otra convocatoria)", () => {
  const docs = documentosDePagina(
    [
      { url: "https://x.gob.pe/f/1/8654587-evaluacion-curricular-requisitos-minimos-cas-n-007-2026.pdf", texto: "Descargar" },
      { url: "https://x.gob.pe/f/1/8654587-bases-de-la-convocatoria.pdf", texto: "Descargar" },
      { url: "https://x.gob.pe/f/1/8654587-lista-de-aptos-cas-n-007-2026.pdf", texto: "" },
      { url: "https://x.gob.pe/f/1/8654587-anexos-cas-n-007-2026.docx", texto: "" },
    ],
    7,
    2026,
    true,
  );
  assert.equal(docs[0].url.endsWith("bases-de-la-convocatoria.pdf"), true);
  assert.ok(!docs.some((d) => /aptos|evaluacion-curricular/.test(d.url)));
});

test("el nombre de un documento: el texto del enlace, o el archivo sin el código de gob.pe", () => {
  assert.equal(tituloDocumento({ url: "https://cdn.www.gob.pe/uploads/document/file/1/8792431-terminos-de-referencia.pdf?v=1", texto: "Descargar" }), "Terminos de referencia");
  assert.equal(tituloDocumento({ url: "https://x.pe/BASES_CAS_2026.pdf", texto: "" }), "Bases cas 2026");
  assert.equal(tituloDocumento({ url: "https://x.pe/a.pdf", texto: "Perfiles de puesto" }), "Perfiles de puesto");
});

test("listas por año: el enlace «Año 2026» del mismo sitio", () => {
  const lista = [
    { url: "https://red.gob.pe/convocatoria/cas2025", texto: "Año 2025" },
    { url: "https://red.gob.pe/convocatoria/cas2026", texto: "Año 2026" },
    { url: "https://otro.gob.pe/2026", texto: "2026" },
  ];
  assert.equal(paginaDelAnio(lista, "https://red.gob.pe/convocatoria/cas_ano", 2026)?.url, "https://red.gob.pe/convocatoria/cas2026");
  assert.equal(paginaDelAnio(lista, "https://red.gob.pe/convocatoria/cas_ano", 2024), null);
});

const plaza = {
  aviso: 1,
  titulo: "ESPECIALISTA EN SUPERVISION",
  entidad: "UGEL 01",
  numero: "D.LEG 1057 - DETERMINADO (NECESIDAD TRANSITORIA)-108",
  detalle_url: "https://www.gob.pe/institucion/ugel01/colecciones/89543-contratacion-cas-2026",
  fecha_inicio: "2026-11-05",
};
const PAGINAS: Record<string, string> = {
  "https://www.gob.pe/institucion/ugel01/colecciones/89543-contratacion-cas-2026":
    `<a href="/institucion/ugel01/informes-publicaciones/2-cas-n-115-2026-ugel01-especialista-de-convivencia">x</a><a href="?sheet=2">2</a>`,
  "https://www.gob.pe/institucion/ugel01/colecciones/89543-contratacion-cas-2026?sheet=2":
    `<a href="/institucion/ugel01/informes-publicaciones/1-cas-n-108-2026-ugel01-especialista-en-supervision">x</a>
     <a href="/institucion/ugel01/informes-publicaciones/3-resolucion-n-108-2026">Resolución N° 108-2026</a>`,
  "https://www.gob.pe/institucion/ugel01/informes-publicaciones/1-cas-n-108-2026-ugel01-especialista-en-supervision":
    `<a href="https://cdn.www.gob.pe/uploads/document/file/9/1-terminos-de-referencia.pdf?v=2">Descargar</a>
     <a href="https://cdn.www.gob.pe/uploads/document/file/9/preview_1-terminos-de-referencia.jpg?v=2">x</a>`,
};
const pedirFalso = async (u: string) => (u in PAGINAS ? { status: 200, html: PAGINAS[u], final: u } : null);

test("gob.pe: recorre las hojas de la colección, entra al proceso y toma su documento (no la resolución)", async () => {
  const h = await buscarBases(plaza, pedirFalso);
  assert.ok(h);
  assert.equal(h.via, "pagina_proceso");
  assert.match(h.pagina, /1-cas-n-108-2026/);
  assert.deepEqual(h.documentos.map((d) => d.url), ["https://cdn.www.gob.pe/uploads/document/file/9/1-terminos-de-referencia.pdf?v=2"]);
});

const PDF = new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(600)}\n/Type /Page\n/Type /Pages\n`);

test("todo junto: sin cupo del día queda «encontradas» sin lectura, con la copia guardada", async () => {
  const puestos: string[] = [];
  const r = await procesarBases(
    { DOCUMENTOS: { put: async (k: string) => void puestos.push(k) } },
    { ...plaza, datosServir: "Puesto: x" },
    { puedeLeer: false, pedir: pedirFalso, bajar: async () => PDF },
  );
  assert.equal(r.estado, "encontradas");
  assert.equal(r.sin_lectura, "tope");
  assert.equal(r.documentos[0].clave?.length, 24);
  assert.deepEqual(puestos, [`servir/bases/${r.documentos[0].clave}.pdf`]);
});

test("todo junto: si el modelo dice que no son de esta plaza, no se muestran", async () => {
  const llm = {
    fetch: async () =>
      new Response(JSON.stringify({ content: [{ type: "tool_use", name: "bases", input: { corresponde: false, funciones: [], requisitos_extra: [], cronograma: [], evaluacion: [], documentos: [], condiciones: [], ojo: [] } }], usage: { input_tokens: 9, output_tokens: 3 } })),
  };
  const r = await procesarBases({ LLM: llm, LLM_TOKEN: "t" }, { ...plaza, datosServir: "Puesto: x" }, { puedeLeer: true, pedir: pedirFalso, bajar: async () => PDF });
  assert.equal(r.estado, "no_encontradas");
  assert.deepEqual(r.documentos, []);
});

test("todo junto: la lectura válida queda con los documentos leídos", async () => {
  const llm = {
    fetch: async () =>
      new Response(JSON.stringify({
        content: [{ type: "tool_use", name: "bases", input: {
          corresponde: true, funciones: ["Atender expedientes de los colegios."], requisitos_extra: [], cronograma: [{ etapa: "Postulación", fecha: "19 de noviembre" }],
          evaluacion: [{ etapa: "Entrevista", como: "De 30 a 50 puntos" }], documentos: ["Anexo 02-A firmado"], como_postular: { medio: "en_linea", detalle: "Por MINEDU en línea · hasta las 23:59" },
          condiciones: [], ojo: [] } }],
        usage: { input_tokens: 44135, output_tokens: 2381 },
      })),
  };
  const r = await procesarBases({ LLM: llm, LLM_TOKEN: "t" }, { ...plaza, datosServir: "Puesto: x" }, { puedeLeer: true, pedir: pedirFalso, bajar: async () => PDF });
  assert.equal(r.estado, "encontradas");
  assert.equal(r.documentos[0].leido, true);
  assert.equal(r.lectura?.como_postular?.detalle, "Por MINEDU en línea, hasta las 23:59");
  assert.ok(r.leida_at);
});
