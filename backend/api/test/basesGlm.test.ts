import test from "node:test";
import assert from "node:assert/strict";
import { MIN_TEXTO, argumentosHerramienta, contenidoMarkdown, leerBases, letras, limpiarLectura, textoDePdfs } from "../src/lib/basesPlaza.js";

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
  assert.equal(r.modelo, "glm-5.3-flash");
  assert.deepEqual(env.rutas, ["/v1/chat/completions"]);
  const cuerpo = env.cuerpos[0] as { model: string; tool_choice: unknown; reasoning_effort: string; messages: { content: string }[] };
  assert.equal(cuerpo.model, "@cf/zai-org/glm-5.3-flash");
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
