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
  const r = await procesarBases({ LLM: llm, LLM_TOKEN: "t" }, { ...plaza, datosServir: "Puesto: x" }, { puedeLeer: true, puedeHaiku: true, pedir: pedirFalso, bajar: async () => PDF });
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
  const r = await procesarBases({ LLM: llm, LLM_TOKEN: "t" }, { ...plaza, datosServir: "Puesto: x" }, { puedeLeer: true, puedeHaiku: true, pedir: pedirFalso, bajar: async () => PDF });
  assert.equal(r.estado, "encontradas");
  assert.equal(r.documentos[0].leido, true);
  assert.equal(r.lectura?.como_postular?.detalle, "Por MINEDU en línea, hasta las 23:59");
  assert.ok(r.leida_at);
});

// ─── Poder Judicial (por el relay de Lima) ──────────────────────────────────────────────────────────
import { SinRelay, buscarPoderJudicial, cortesDePlaza, pedidor, procesosPoderJudicial } from "../src/lib/basesPlaza.js";

const COMBO = (opciones: string) =>
  `<select name="ctl00$ContentPlaceHolder1$ddl_Periodo"><option value="2026">2026</option></select>
   <select name="ctl00$ContentPlaceHolder1$ddl_OrgDepV" id="x"><option value="0">--Seleccione--</option>${opciones}</select>`;
const PJ_VC = "https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=C";
const PJ_PC = "https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasP.aspx?TCon=C";
const PJ_VE = "https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=E";
const PJ_PE = "https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasP.aspx?TCon=E";
const listasPj: Record<string, string> = {
  [PJ_VC]: COMBO(`<option value="15390">PROCESO SELECCION PERSONAL CAS 022-2026-UE AREQUIPA (NECESIDADES TRANSITORIAS) (AREQUIPA)</option>
    <option value="15504">PROCESO SELECCI&#211;N PERSONAL CAS TRANSITORIO N&#176; 022-2026-HUANCAVELICA (HUANCAVELICA)</option>
    <option value="15391">PROCESO DE SELECCI&#211;N CAS TRANSITORIO N&#176; 033-2026-UE-LIMASUR (LIMA SUR)</option>
    <option value="15489">PROCESO DE SELECCI&#211;N DE PERSONAL N&#176; 033-2026-UE-LIMA ESTE D. LEG. N&#176; 1057 (LIMA ESTE)</option>`),
  [PJ_PC]: COMBO(`<option value="14000">PROCESO SELECCION PERSONAL CAS 022-2025-UE AREQUIPA (AREQUIPA)</option>`),
  [PJ_VE]: COMBO(`<option value="15401">PROCESO DE SELECCION DE PERSONAL SUPLENCIA N&#176; 003-2026-UE-PUNO (PUNO)</option>
    <option value="15400">PROCESO DE SELECCION DE PERSONAL SERVICIO ESPECIFICO N&#176; 003-2026-UE-PUNO (PUNO)</option>`),
  [PJ_PE]: COMBO(""),
};
const pedirPj = async (u: string) => (u in listasPj ? { status: 200, html: listasPj[u], final: u } : null);
const plazaPj = (numero: string, entidad: string, ubicacion: string) => ({
  aviso: 9, titulo: "ASISTENTE JUDICIAL", entidad, ubicacion, numero, fecha_inicio: "2026-10-27",
  detalle_url: "https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=E",
});

test("Poder Judicial: los procesos salen del combo ddl_OrgDepV (no de los otros)", () => {
  const ps = procesosPoderJudicial(listasPj[PJ_VE]);
  assert.deepEqual(ps.map((p) => p.id), ["15401", "15400"]);
  assert.match(ps[0].texto, /SUPLENCIA N° 003-2026-UE-PUNO \(PUNO\)/);
});

test("Poder Judicial: la corte sale del nombre de la entidad o del distrito («LIMA - ATE» → lima este)", () => {
  assert.deepEqual(cortesDePlaza({ entidad: "CORTE SUPERIOR DE JUSTICIA DE PIURA", ubicacion: "PIURA - SULLANA" }).map((c) => c.clave), ["piura", "sullana", "piura"]);
  assert.deepEqual(cortesDePlaza({ entidad: "PODER JUDICIAL", ubicacion: "LIMA - ATE" }).map((c) => c.clave), ["lima este", "lima"]);
});

test("Poder Judicial: CAS va a las listas C, empareja número, año y corte; «lima» no calza con «lima sur»", async () => {
  const h = await buscarPoderJudicial(plazaPj("D.LEG 1057 - DETERMINADO (NECESIDAD TRANSITORIA)-022", "PODER JUDICIAL", "AREQUIPA - AREQUIPA"), pedirPj);
  assert.equal(h?.documentos[0].url, "https://aplicativo.pj.gob.pe/repositoriopsep/15390_AnuncioConvocatoria.pdf");
  assert.deepEqual(h?.documentos.map((d) => d.url.split("_").pop()), ["AnuncioConvocatoria.pdf", "Cronograma.pdf", "BasesConcurso.pdf"]);
  const sur = await buscarPoderJudicial(plazaPj("D.LEG 1057 - DETERMINADO (NECESIDAD TRANSITORIA)-033", "PODER JUDICIAL", "LIMA - VILLA MARIA DEL TRIUNFO"), pedirPj);
  assert.match(sur?.documentos[0].url ?? "", /15391_/);
  assert.equal(await buscarPoderJudicial(plazaPj("D.LEG 1057 - DETERMINADO (NECESIDAD TRANSITORIA)-033", "PODER JUDICIAL", "LIMA - LIMA"), pedirPj), null);
});

test("Poder Judicial: dos procesos empatados (Puno 003): el más nuevo y el otro de alternativa", async () => {
  const h = await buscarPoderJudicial(plazaPj("728-003", "PODER JUDICIAL", "PUNO - PUNO"), pedirPj);
  assert.match(h?.documentos[0].url ?? "", /15401_/);
  assert.match(h?.alternativa?.documentos[0].url ?? "", /15400_/);
});

test("sin relay, lo del Poder Judicial es un error (se reintenta), no «no encontradas»", async () => {
  const { pedir } = pedidor(9);
  await assert.rejects(() => pedir(PJ_VC), SinRelay);
  const relayCaido = async () => new Response("bad gateway", { status: 502 });
  await assert.rejects(() => pedidor(9, fetch, relayCaido).pedir(PJ_VC), SinRelay);
  const relayBien = async () => new Response(listasPj[PJ_VC], { status: 200, headers: { "x-relay-status": "200", "content-type": "text/html" } });
  const r = await pedidor(9, fetch, relayBien).pedir(PJ_VC);
  assert.equal(procesosPoderJudicial(r?.html ?? "").length, 4);
});

test("si el modelo dice que el primero no es de la plaza, se lee la alternativa", async () => {
  let llamadas = 0;
  const llm = {
    fetch: async () => {
      llamadas++;
      const input = llamadas === 1
        ? { corresponde: false, funciones: [], requisitos_extra: [], cronograma: [], evaluacion: [], documentos: [], condiciones: [], ojo: [] }
        : { corresponde: true, funciones: ["Notificar resoluciones."], requisitos_extra: [], cronograma: [], evaluacion: [], documentos: [], condiciones: [], ojo: [] };
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "bases", input }], usage: { input_tokens: 100, output_tokens: 10 } }));
    },
  };
  const r = await procesarBases(
    { LLM: llm, LLM_TOKEN: "t" },
    { ...plazaPj("728-003", "PODER JUDICIAL", "PUNO - PUNO"), datosServir: "Puesto: x" },
    { puedeLeer: true, puedeHaiku: true, pedir: pedirPj, bajar: async () => PDF },
  );
  assert.equal(llamadas, 2);
  assert.equal(r.estado, "encontradas");
  assert.match(r.documentos[0].url, /15400_/);
  assert.deepEqual(r.tokens, { entrada: 200, salida: 20 });
});

test("las descargas de OECE van por POST con su id como formulario", async () => {
  const { pedidoDescarga, bajarPdf } = await import("../src/lib/basesPlaza.js");
  const u = "https://caspublico.oece.gob.pe/Convocatoria/ConsultarArchivo?id=1AbCdEfGhIjKlMn#post";
  assert.equal(esDocumento(u), true);
  assert.deepEqual(pedidoDescarga(u), { url: "https://caspublico.oece.gob.pe/Convocatoria/ConsultarArchivo", metodo: "POST", cuerpo: "id=1AbCdEfGhIjKlMn" });
  assert.deepEqual(pedidoDescarga("https://x.gob.pe/a.pdf"), { url: "https://x.gob.pe/a.pdf", metodo: "GET" });
  const pdf = new Uint8Array(800).fill(32);
  pdf.set([0x25, 0x50, 0x44, 0x46]);
  // La OECE tiene el TLS roto: va por el relay de Lima, con el método y el formulario.
  let visto: { url?: string; metodo?: string; cuerpo?: string; tipo?: string } = {};
  const relay = async (url: string, _ms: number, extra?: { metodo?: string; cuerpo?: string; cabeceras?: Record<string, string> }) => {
    visto = { url, metodo: extra?.metodo, cuerpo: extra?.cuerpo, tipo: extra?.cabeceras?.["Content-Type"] };
    return new Response(pdf, { status: 200, headers: { "x-relay-status": "200" } });
  };
  const b = await bajarPdf(u, fetch, relay);
  assert.equal(b?.byteLength, 800);
  assert.equal(visto.url, "https://caspublico.oece.gob.pe/Convocatoria/ConsultarArchivo");
  assert.equal(visto.metodo, "POST");
  assert.equal(visto.cuerpo, "id=1AbCdEfGhIjKlMn");
  assert.match(visto.tipo ?? "", /x-www-form-urlencoded/);
  // Uno que no es del Perú va directo, también por POST.
  let directo: { metodo?: string; cuerpo?: unknown } = {};
  const falso = (async (_url: string, init?: RequestInit) => {
    directo = { metodo: init?.method, cuerpo: init?.body };
    return new Response(pdf, { status: 200 });
  }) as typeof fetch;
  assert.equal((await bajarPdf("https://x.com/Convocatoria/ConsultarArchivo?id=1AbCdEfGhIjKlMn#post", falso))?.byteLength, 800);
  assert.deepEqual(directo, { metodo: "POST", cuerpo: "id=1AbCdEfGhIjKlMn" });
});

test("el PDF que viene dentro de la página del visor (PGE) se saca de su base64", async () => {
  const { pdfIncrustado, bajarPdf } = await import("../src/lib/basesPlaza.js");
  const pdf = new Uint8Array(900).fill(65);
  pdf.set([0x25, 0x50, 0x44, 0x46]);
  const html = `<html><iframe src="data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}"></iframe></html>`;
  assert.equal(pdfIncrustado(new TextEncoder().encode(html))?.byteLength, 900);
  assert.equal(pdfIncrustado(new TextEncoder().encode("<html>nada</html>")), null);
  const falso = (async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
  assert.equal((await bajarPdf("https://convocas.pge.gob.pe/serviceView/viewPdfModalPublic?idFile=12", falso))?.byteLength, 900);
});

test("un PDF más grande que el tope se corta mientras baja, sin content-length", async () => {
  const { cuerpoConTope, bajarPdf } = await import("../src/lib/basesPlaza.js");
  const trozo = new Uint8Array(1000).fill(65);
  trozo.set([0x25, 0x50, 0x44, 0x46]);
  const flujo = (n: number) => new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < n; i++) c.enqueue(trozo.slice());
      c.close();
    },
  });
  assert.equal((await cuerpoConTope(new Response(flujo(3)), 5000))?.byteLength, 3000);
  assert.equal(await cuerpoConTope(new Response(flujo(10)), 5000), null);
  const falso = (async () => new Response(flujo(10), { status: 200 })) as typeof fetch;
  assert.equal(await bajarPdf("https://x.com/a.pdf", falso, undefined, 5000), null);
  assert.equal((await bajarPdf("https://x.com/a.pdf", falso, undefined, 20_000))?.byteLength, 10_000);
});
