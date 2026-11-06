/** El chat del panel (routes/admin_chat.ts) con el modelo y el MCP simulados: pasos, resultado, respuesta y fin en NDJSON. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { adminChatRouter } from "../src/routes/admin_chat.js";

function entorno() {
  const pedidosLlm: any[] = [];
  let vuelta = 0;
  const LLM = {
    async fetch(req: Request) {
      const cuerpo = await req.json();
      pedidosLlm.push(cuerpo);
      vuelta++;
      const contenido = vuelta === 1
        ? [{ type: "text", text: "Busco la entidad." }, { type: "tool_use", id: "t1", name: "buscar", input: { texto: "Wanchaq" } }]
        : [{ type: "text", text: "## Respuesta\nLa municipalidad de Wanchaq…" }];
      return Response.json({ content: contenido, stop_reason: vuelta === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 1000, output_tokens: 200 } });
    },
  };
  const MCP = {
    async fetch(req: Request) {
      assert.equal(req.headers.get("x-vigia-interno"), "secreto");
      const { method, params } = await req.json();
      if (method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [
          { name: "buscar", title: "Buscar en Vigía", description: "Busca", inputSchema: { $schema: "x", type: "object", properties: { texto: { type: "string" } } } },
          { name: "seguir", title: "Seguir", description: "Sigue", inputSchema: { type: "object", properties: {} } },
        ] } });
      }
      assert.equal(params.name, "buscar");
      return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: '{"entidades":[{"ruc":"20159308881"}]}' }] } });
    },
  };
  return { env: { LLM, MCP, LLM_TOKEN: "t", MCP_INTERNO_TOKEN: "secreto", MCP_INTERNO_URL: "https://mcp.prueba/mcp" }, pedidosLlm };
}

test("el chat encadena una herramienta y responde en NDJSON", async () => {
  const app = new Hono().route("/", adminChatRouter);
  const { env, pedidosLlm } = entorno();
  const r = await app.request("/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mensajes: [{ rol: "usuario", texto: "Dime todo sobre el alcalde de Wanchaq" }] }),
  }, env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /application\/x-ndjson/);
  const eventos = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(eventos.map((e) => e.tipo), ["inicio", "texto", "paso", "resultado", "respuesta", "fin"]);
  assert.equal(eventos[2].titulo, "Buscar en Vigía");
  assert.equal(eventos[3].ok, true);
  assert.equal(eventos[5].herramientas, 1);
  // Las herramientas de la cuenta personal no se le ofrecen al modelo, y el $schema no viaja.
  const nombres = pedidosLlm[0].tools.map((t: any) => t.name);
  assert.deepEqual(nombres, ["buscar"]);
  assert.equal(pedidosLlm[0].tools[0].input_schema.$schema, undefined);
  assert.equal(pedidosLlm[0].model, "claude-haiku-5-5");
  // La segunda vuelta lleva el resultado de la herramienta.
  assert.equal(pedidosLlm[1].messages.at(-1).content[0].type, "tool_result");
});

test("el chat rechaza un cuerpo sin mensajes o que termina en el asistente", async () => {
  const app = new Hono().route("/", adminChatRouter);
  const { env } = entorno();
  const vacio = await app.request("/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, env);
  assert.equal(vacio.status, 400);
  const alReves = await app.request("/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mensajes: [{ rol: "usuario", texto: "hola" }, { rol: "asistente", texto: "hola" }] }),
  }, env);
  assert.equal(alReves.status, 400);
});
