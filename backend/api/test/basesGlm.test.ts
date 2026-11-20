import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_TEXTO, argumentosHerramienta, buscarBytes, contenidoMarkdown, jpegsDePdf, juntarLecturas, leerBases, letras, limpiarLectura, textoDePdfs,
} from "../src/lib/basesPlaza.js";

const LECTURA = {
  corresponde: true,
  funciones: ["Atender expedientes · y quejas"],
  requisitos_extra: [],
  cronograma: [{ etapa: "Presentación del expediente", fecha: "19 de noviembre de 2026", postulas: true }, { etapa: "Entrevista", fecha: "26 de noviembre", postulas: false }],
  evaluacion: [{ etapa: "Curricular", como: "De 30 a 50 puntos" }],
  documentos: ["Anexo 02-A"],
  como_postular: { medio: "en_linea", detalle: "En https://enlinea.minedu.gob.pe/" },
  condiciones: [],
  ojo: ["Un solo PDF de máximo 40 MB"],
};
const PLAZA = { aviso: 1, titulo: "Especialista", entidad: "UGEL 01", numero: "CAS-108", detalle_url: null, fecha_inicio: "2026-11-05", datosServir: "Puesto: Especialista" };
const PDF = { titulo: "Bases", bytes: new Uint8Array([37, 80, 68, 70]) };

/** Un vigia-llm de mentira: anota a qué ruta fue cada pedido y responde como GLM (chat/completions) o como Haiku (messages). */
function llm(opciones: { glmFalla?: boolean; glmVacia?: boolean } = {}) {
  const rutas: string[] = [];
  const cuerpos: Record<string, unknown>[] = [];
  return {
    rutas,
    cuerpos,
    LLM_TOKEN: "t",
    LLM: {
      async fetch(req: Request | string) {
        const r = req as Request;
        const ruta = new URL(r.url).pathname;
        rutas.push(ruta);
        cuerpos.push((await r.json()) as Record<string, unknown>);
        if (ruta === "/v1/chat/completions") {
          if (opciones.glmFalla) return new Response("{}", { status: 502 });
          const vacia = { ...LECTURA, funciones: [], cronograma: [], evaluacion: [], documentos: [], como_postular: { medio: "otro", detalle: "El PDF es un documento escaneado sin texto legible" } };
          return Response.json({
            choices: [{ message: { content: null, tool_calls: [{ type: "function", function: { name: "bases", arguments: JSON.stringify(opciones.glmVacia ? vacia : LECTURA) } }] } }],
            usage: { prompt_tokens: 13381, completion_tokens: 1814 },
          });
        }
        return Response.json({ content: [{ type: "tool_use", name: "bases", input: LECTURA }], usage: { input_tokens: 9000, output_tokens: 900 } });
      },
    },
  };
}
const ai = (texto: string) => ({ toMarkdown: async (docs: { name: string }[]) => docs.map((d) => ({ name: d.name, format: "markdown", data: texto })) });

test("los argumentos de la herramienta: como objeto, como texto JSON o un JSON suelto en el contenido", () => {
  assert.deepEqual(argumentosHerramienta({ choices: [{ message: { tool_calls: [{ function: { name: "bases", arguments: { corresponde: true } } }] } }] }), { corresponde: true });
  assert.deepEqual(argumentosHerramienta({ choices: [{ message: { tool_calls: [{ function: { name: "bases", arguments: '{"corresponde":false}' } }] } }] }), { corresponde: false });
  assert.deepEqual(argumentosHerramienta({ choices: [{ message: { content: 'Aquí va: {"corresponde": true} listo' } }] }), { corresponde: true });
  assert.equal(argumentosHerramienta({ choices: [{ message: { content: "no sé" } }] }), null);
  assert.equal(argumentosHerramienta(null), null);
});

test("la lectura se valida y sale sin «·»; postulas sólo donde es true", () => {
  const l = limpiarLectura(LECTURA);
  assert.equal(l.funciones[0], "Atender expedientes, y quejas");
  assert.deepEqual(l.cronograma.map((x) => x.postulas ?? false), [true, false]);
});

test("el texto de los PDF por Workers AI; sin binding o con error, vacío", async () => {
  assert.deepEqual(await textoDePdfs({ AI: ai("Texto  \n\n\n\nmás") }, [PDF]), [{ titulo: "Bases", texto: "Texto\n\nmás" }]);
  assert.deepEqual(await textoDePdfs({}, [PDF]), [{ titulo: "Bases", texto: "" }]);
  const roto = { toMarkdown: async () => [{ name: "x", format: "error", error: "malo" }] };
  assert.deepEqual(await textoDePdfs({ AI: roto }, [PDF]), [{ titulo: "Bases", texto: "" }]);
});

test("con texto, lee GLM 5.3 flash (chat/completions, herramienta forzada, razonamiento bajo)", async () => {
  const env = { ...llm(), AI: ai("x".repeat(MIN_TEXTO + 10)) };
  const r = await leerBases(env, PLAZA, [PDF], true);
  assert.equal(r.modelo, "deepseek-v4.1-flash");
  assert.deepEqual(env.rutas, ["/v1/chat/completions"]);
  const cuerpo = env.cuerpos[0] as { model: string; tool_choice: unknown; reasoning_effort: string; messages: { content: string }[] };
  assert.equal(cuerpo.model, "@cf/deepseek-ai/deepseek-v4.1-flash-1017");
  assert.deepEqual(cuerpo.tool_choice, { type: "function", function: { name: "bases" } });
  assert.equal(cuerpo.reasoning_effort, "low");
  assert.match(cuerpo.messages[1].content, /<documento titulo="Bases">/);
  assert.deepEqual([r.entrada, r.salida], [13381, 1814]);
});

test("escaneadas (sin texto): Haiku si puede; si no, «escaneadas» (se leen otro día)", async () => {
  const env = { ...llm(), AI: ai("") };
  const r = await leerBases(env, PLAZA, [PDF], true);
  assert.equal(r.modelo, "claude-haiku-5-5");
  assert.deepEqual(env.rutas, ["/nativo/v1/messages"]);
  await assert.rejects(leerBases({ ...llm(), AI: ai("") }, PLAZA, [PDF], false), /escaneadas/);
});

test("si GLM falla con texto: Haiku si puede, si no el error", async () => {
  const env = { ...llm({ glmFalla: true }), AI: ai("x".repeat(MIN_TEXTO + 10)) };
  const r = await leerBases(env, PLAZA, [PDF], true);
  assert.equal(r.modelo, "claude-haiku-5-5");
  assert.deepEqual(env.rutas, ["/v1/chat/completions", "/nativo/v1/messages"]);
  await assert.rejects(leerBases({ ...llm({ glmFalla: true }), AI: ai("x".repeat(MIN_TEXTO + 10)) }, PLAZA, [PDF], false), /modelo_502/);
});

test("el contenido de toMarkdown: sin metadatos ni «Page N» (un escaneo trae metadatos y nada más)", () => {
  const escaneo = [
    "# documento-1.pdf", "## Metadata", "- PDFFormatVersion=1.7", "- Producer=Canon iR-ADV C5535 PDF", "- CreationDate=D:20261105",
    "- Title=Bases del proceso CAS de la municipalidad", "## Contents", "### Page 1", "", "### Page 2", "",
  ].join("\n");
  assert.equal(contenidoMarkdown(escaneo), "");
  assert.equal(letras(contenidoMarkdown(escaneo)), 0);
  const conTexto = ["# documento-1.pdf", "## Metadata", "- Producer=Word", "## Contents", "### Page 1", "BASES DEL PROCESO CAS N° 108-2026", "### Page 2", "Cronograma"].join("\n");
  assert.equal(contenidoMarkdown(conTexto), ["BASES DEL PROCESO CAS N° 108-2026", "", "Cronograma"].join("\n"));
  assert.equal(contenidoMarkdown("Sólo texto, sin bloques"), "Sólo texto, sin bloques");
  assert.equal(letras("N° 108-2026, ñandú"), 6);
});

test("si GLM no encuentra nada que mostrar (escaneo con algo de texto): Haiku si puede, si no «escaneadas»", async () => {
  const env = { ...llm({ glmVacia: true }), AI: ai("x".repeat(MIN_TEXTO + 10)) };
  const r = await leerBases(env, PLAZA, [PDF], true);
  assert.equal(r.modelo, "claude-haiku-5-5");
  assert.deepEqual(env.rutas, ["/v1/chat/completions", "/nativo/v1/messages"]);
  await assert.rejects(leerBases({ ...llm({ glmVacia: true }), AI: ai("x".repeat(MIN_TEXTO + 10)) }, PLAZA, [PDF], false), /escaneadas/);
});

/** Un PDF de mentira con páginas escaneadas: cada una un objeto /DCTDecode con un JPEG (FF D8 … FF D9) de `kb` KB. */
function pdfEscaneado(paginas: number, kb = 20): Uint8Array {
  const partes: number[] = [...new TextEncoder().encode("%PDF-1.7\n")];
  for (let i = 0; i < paginas; i++) {
    partes.push(...new TextEncoder().encode(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>\nstream\r\n`));
    const jpeg = new Uint8Array(kb * 1024).fill(i + 1);
    jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[jpeg.length - 2] = 0xff; jpeg[jpeg.length - 1] = 0xd9;
    partes.push(...jpeg, ...new TextEncoder().encode("\r\nendstream\nendobj\n"));
  }
  return new Uint8Array(partes);
}

test("las páginas de un escaneo: los JPEG del PDF, en orden, sin logos chicos y con tope", () => {
  const xs = jpegsDePdf(pdfEscaneado(3));
  assert.equal(xs.length, 3);
  assert.deepEqual([xs[0][0], xs[0][1], xs[0][2], xs[2][2]], [0xff, 0xd8, 1, 3]);
  assert.deepEqual([xs[0][xs[0].length - 2], xs[0][xs[0].length - 1]], [0xff, 0xd9]);
  assert.equal(jpegsDePdf(pdfEscaneado(3, 4)).length, 0, "un logo de 4 KB no es una página");
  assert.equal(jpegsDePdf(pdfEscaneado(30)).length, 24, "hasta 24 páginas");
  assert.equal(jpegsDePdf(new TextEncoder().encode("%PDF-1.7 sin imágenes")).length, 0);
  assert.equal(buscarBytes(new TextEncoder().encode("abcabd"), new TextEncoder().encode("abd")), 3);
});

test("juntar las lecturas de varios pedidos: listas sin repetir, el cronograma con fechas, el medio que no es «otro»", () => {
  const a = limpiarLectura({ ...LECTURA, cronograma: [{ etapa: "Postulación", fecha: "Según cronograma", postulas: true }], documentos: ["Anexo 02-A", "DNI"], como_postular: { medio: "otro", detalle: "Ver bases" } });
  const b = limpiarLectura({ ...LECTURA, corresponde: false, documentos: ["DNI", "CV documentado"], como_postular: { medio: "mesa_de_partes", detalle: "Mesa de partes, sobre cerrado" } });
  const j = juntarLecturas([a, b]);
  assert.equal(j.corresponde, true);
  assert.deepEqual(j.documentos, ["Anexo 02-A", "DNI", "CV documentado"]);
  assert.equal(j.cronograma[0].fecha, "19 de noviembre de 2026");
  assert.equal(j.como_postular?.medio, "mesa_de_partes");
});

test("un escaneo con JPEG lo lee GLM con imágenes, de a 8 páginas por pedido; Haiku no se usa", async () => {
  const env = { ...llm(), AI: ai("") };
  const r = await leerBases(env, PLAZA, [{ titulo: "Bases", bytes: pdfEscaneado(18) }], true);
  assert.equal(r.modelo, "deepseek-v4.1-flash-imagen");
  assert.deepEqual(env.rutas, ["/v1/chat/completions", "/v1/chat/completions", "/v1/chat/completions"]);
  const imagenes = env.cuerpos.map((c) => ((c as { messages: { content: { type: string }[] }[] }).messages[1].content).filter((x) => x.type === "image_url").length);
  assert.deepEqual(imagenes, [8, 8, 2]);
  assert.deepEqual([r.entrada, r.salida], [3 * 13381, 3 * 1814]);
});

test("un «no corresponde» leyendo sólo la resolución con texto: antes de descartar se miran las bases escaneadas (UNHEVAL)", async () => {
  const pedidos: string[] = [];
  const env = {
    LLM_TOKEN: "t",
    AI: { toMarkdown: async (docs: { name: string }[]) => docs.map((d, i) => ({ name: d.name, format: "markdown", data: i === 0 ? "x".repeat(MIN_TEXTO + 10) : "" })) },
    LLM: {
      async fetch(req: Request | string) {
        const cuerpo = (await (req as Request).json()) as { messages: { content: unknown }[] };
        const conImagen = JSON.stringify(cuerpo.messages).includes("image_url");
        pedidos.push(conImagen ? "imagen" : "texto");
        const lectura = conImagen ? LECTURA : { ...LECTURA, corresponde: false };
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: "bases", arguments: JSON.stringify(lectura) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      },
    },
  };
  const docs = [{ titulo: "Resolución que aprueba", bytes: new Uint8Array([37, 80, 68, 70]) }, { titulo: "Bases", bytes: pdfEscaneado(3) }];
  const r = await leerBases(env, PLAZA, docs, false);
  assert.deepEqual(pedidos, ["texto", "imagen"]);
  assert.equal(r.lectura.corresponde, true);
  assert.equal(r.modelo, "deepseek-v4.1-flash-imagen");
  // Si todo tiene texto, el «no» vale de una.
  pedidos.length = 0;
  const soloTexto = { ...env, AI: ai("x".repeat(MIN_TEXTO + 10)) };
  const r2 = await leerBases(soloTexto, PLAZA, [docs[0], docs[0]], false);
  assert.deepEqual(pedidos, ["texto"]);
  assert.equal(r2.lectura.corresponde, false);
});

test("el texto de toMarkdown va a su PDF por nombre aunque vuelva en otro orden", async () => {
  const al_reves = { toMarkdown: async (docs: { name: string }[]) => docs.map((d, i) => ({ name: d.name, format: "markdown", data: i === 0 ? "uno" : "dos" })).reverse() };
  const t = await textoDePdfs({ AI: al_reves } as never, [{ titulo: "A", bytes: new Uint8Array([1]) }, { titulo: "B", bytes: new Uint8Array([2]) }]);
  assert.deepEqual(t.map((x) => x.texto), ["uno", "dos"]);
});

test("las páginas JPEG que el escáner guardó además con Flate se inflan (UNHEVAL)", async () => {
  const { deflateSync } = await import("node:zlib");
  const { paginasJpeg } = await import("../src/lib/basesPlaza.js");
  const jpeg = new Uint8Array(20_000).fill(7);
  jpeg.set([0xff, 0xd8]);
  const enc = new TextEncoder();
  const flate = deflateSync(jpeg);
  const pdf = new Uint8Array([
    ...enc.encode("%PDF-1.7\n1 0 obj\n<< /Subtype /Image /Filter [/FlateDecode /DCTDecode] /Length 1 >>\nstream\n"), ...flate, ...enc.encode("\nendstream\nendobj\n"),
    ...enc.encode("2 0 obj\n<< /Subtype /Image /Filter /DCTDecode >>\nstream\n"), ...jpeg, ...enc.encode("\nendstream\nendobj\n"),
  ]);
  assert.equal(jpegsDePdf(pdf).length, 1);
  const p = await paginasJpeg(pdf);
  assert.equal(p.length, 2);
  assert.deepEqual([p[0].byteLength, p[0][0], p[0][1]], [20_000, 0xff, 0xd8]);
});
