// Prueba de paridad: llama las mismas tools en el MCP de Python (backend/mcp) y en el Worker, con el
// cliente oficial del SDK, y compara el resultado JSON-RPC crudo de cada llamada.
//
//   MCP_PY_URL=http://127.0.0.1:8811/mcp MCP_WORKER_URL=http://127.0.0.1:8812/mcp node scripts/paridad.mjs
//
// No imprime contenido de las respuestas (hay RUC de personas naturales), sólo coincidencias y, si
// algo difiere, la ruta del primer campo distinto.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isDeepStrictEqual } from "node:util";

const URL_PY = process.env.MCP_PY_URL ?? "http://127.0.0.1:8811/mcp";
const URL_WORKER = process.env.MCP_WORKER_URL ?? "http://127.0.0.1:8812/mcp";

async function conectar(url) {
  const transporte = new StreamableHTTPClientTransport(new URL(url));
  const cliente = new Client({ name: "paridad-vigia", version: "1.0.0" });
  await cliente.connect(transporte);
  // Guarda la última respuesta tal como llegó por el cable, antes de que el cliente la valide.
  let ultima = null;
  const original = transporte.onmessage;
  transporte.onmessage = (msg, extra) => {
    if ("result" in msg || "error" in msg) ultima = msg;
    original?.call(transporte, msg, extra);
  };
  return { cliente, crudo: () => ultima };
}

function primeraDiferencia(a, b, ruta = "$") {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of claves) {
      const d = primeraDiferencia(a[k], b[k], `${ruta}.${k}`);
      if (d) return d;
    }
  }
  const corto = (v) => (v === undefined ? "(ausente)" : JSON.stringify(v).slice(0, 160));
  return `${ruta}\n      python: ${corto(a)}\n      worker: ${corto(b)}`;
}

// inspect.cleandoc: Python 3.13 (local) ya limpia la sangría del docstring; 3.12 (Cloud Run) no.
const cleandoc = (s) => {
  const [primera, ...resto] = s.split("\n");
  const sangrias = resto.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const m = sangrias.length ? Math.min(...sangrias) : 0;
  return [primera.trim(), ...resto.map((l) => l.slice(m))].join("\n").trim();
};

let fallas = 0;
const informar = (etiqueta, diff, nota = "") => {
  if (diff) fallas++;
  console.log(`${diff ? "DIFIERE" : "igual  "}  ${etiqueta}${nota ? `  (${nota})` : ""}${diff ? `\n    ${diff}` : ""}`);
};

const py = await conectar(URL_PY);
const wk = await conectar(URL_WORKER);

// ─── initialize ───────────────────────────────────────────────────────────────
console.log("== initialize");
informar("capabilities", primeraDiferencia(py.cliente.getServerCapabilities(), wk.cliente.getServerCapabilities()));
const [infoPy, infoWk] = [py.cliente.getServerVersion(), wk.cliente.getServerVersion()];
informar("serverInfo.name", primeraDiferencia(infoPy.name, infoWk.name));
console.log(`         serverInfo.version  python=${infoPy.version} worker=${infoWk.version} (esperado: Python publica la versión del paquete mcp)`);

// ─── listados ─────────────────────────────────────────────────────────────────
console.log("== listados");
const [toolsPy, toolsWk] = [await py.cliente.listTools(), await wk.cliente.listTools()];
informar("tools: nombres y orden", primeraDiferencia(toolsPy.tools.map((t) => t.name), toolsWk.tools.map((t) => t.name)));
for (const tp of toolsPy.tools) {
  const tw = toolsWk.tools.find((t) => t.name === tp.name) ?? {};
  informar(`${tp.name}.inputSchema`, primeraDiferencia(tp.inputSchema, tw.inputSchema));
  informar(`${tp.name}.outputSchema`, primeraDiferencia(tp.outputSchema, tw.outputSchema));
  const exacta = tp.description === tw.description;
  informar(`${tp.name}.description`, exacta ? null : primeraDiferencia(cleandoc(tp.description), cleandoc(tw.description ?? "")),
    exacta ? "exacta" : "igual salvo la sangría del docstring");
}
for (const [etiqueta, llamar] of [
  ["resources/list", (c) => c.listResources()],
  ["resources/templates/list", (c) => c.listResourceTemplates()],
  ["prompts/list", (c) => c.listPrompts()],
  ["ping", (c) => c.ping()],
]) {
  await llamar(py.cliente);
  await llamar(wk.cliente);
  informar(etiqueta, primeraDiferencia(py.crudo().result, wk.crudo().result));
}

// ─── tools/call ───────────────────────────────────────────────────────────────
async function comparar(nombre, args) {
  const r = {};
  for (const [lado, s] of [["py", py], ["wk", wk]]) {
    await s.cliente.callTool({ name: nombre, arguments: args });
    r[lado] = s.crudo();
  }
  const res = r.py.result ?? r.py.error;
  const nota = res?.isError ? "isError" : `${res?.content?.length ?? 0} bloque(s)`;
  informar(`${nombre}(${JSON.stringify(args).slice(0, 70)})`, primeraDiferencia(r.py, r.wk), nota);
  return r.py.result;
}

console.log("== buscar_alertas");
const todas = await comparar("buscar_alertas", { limite: 50 });
for (const args of [
  {}, { region: "Lima" }, { region: "cusco", severidad_min: 50, limite: 5 }, { region: "Áncash" },
  { severidad_min: 101 }, { limite: 0 }, { limite: 500 }, { limite: -3 }, { limite: true },
  { region: "lima", severidad_min: "80", limite: " 3 " }, { limite: "1_0" }, { limite: "5.0" },
  { limite: 5.5, region: 5 }, { limite: "[1]" }, { limite: "null" }, { severidad_min: null },
  { region: ["Lima"] }, { limite: "cinco" }, { severidad_min: 10000000000 }, { otro: "se ignora" },
]) {
  await comparar("buscar_alertas", args);
}

console.log("== riesgo_convocatoria");
const estructurado = todas.structuredContent.result;
const conMasBanderas = [...estructurado].sort((a, b) => b.n_banderas - a.n_banderas).slice(0, 4);
for (const a of conMasBanderas) await comparar("riesgo_convocatoria", { ocid: a.ocid });
for (const args of [
  { ocid: estructurado[0].codigo }, { ocid: `ocds-dgv273-seacev3-${conMasBanderas[0].ocid}` },
  { ocid: "1226381" }, { ocid: "OECE-1226381" }, { ocid: "ALT-0001" }, { ocid: "no-existe" }, { ocid: "" },
  {}, { ocid: 1212841 }, { extra: "z".repeat(80) },
]) {
  await comparar("riesgo_convocatoria", args);
}

console.log("== empresa_sancionada");
for (const args of [
  { ruc: "10463478053" }, { ruc: "10414040581" }, { ruc: "20477905731" }, { ruc: "20603142633" },
  { ruc: "20 477-905 731" }, { ruc: "RUC: 20477905731." }, { ruc: "20100070970" }, { ruc: "" },
  { ruc: 20477905731 }, {},
]) {
  await comparar("empresa_sancionada", args);
}

console.log("== tool inexistente");
await comparar("no_existe", {});

// ─── HTTP fuera del protocolo ─────────────────────────────────────────────────
console.log("== HTTP");
const base = (u) => u.replace(/\/mcp$/, "");
for (const [etiqueta, ruta, init] of [
  ["GET /", "/", {}],
  ["POST /mcp/ (barra final)", "/mcp/", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }],
  ["PUT /mcp", "/mcp", { method: "PUT" }],
]) {
  const [a, b] = await Promise.all(
    [URL_PY, URL_WORKER].map((u) => fetch(base(u) + ruta, { ...init, redirect: "manual" })),
  );
  const cuerpo = async (r) => (r.status === 307 ? new URL(r.headers.get("location")).pathname : await r.text());
  informar(`${etiqueta} → ${a.status}/${b.status}`, primeraDiferencia([a.status, await cuerpo(a)], [b.status, await cuerpo(b)]));
}

await py.cliente.close();
await wk.cliente.close();
console.log(fallas ? `\n${fallas} diferencia(s)` : "\nsin diferencias");
process.exitCode = fallas ? 1 : 0;
