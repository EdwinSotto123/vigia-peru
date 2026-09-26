/**
 * Orquestador falso para la prueba de punta a punta (scripts/e2e_staging.py): responde `POST
 * /?stream=1` reproduciendo una corrida NDJSON grabada del orquestador real, línea por línea con una
 * pausa, y guarda cada pedido recibido (cabeceras y cuerpo) para comparar lo que mandan el job de
 * Python y el Worker.
 *
 *   node scripts/agente_falso.ts <puerto> <corrida.ndjson>
 *
 *   POST /_escenario {nombre, pausa_ms}   completo | cortado | abortado | error | 409 | 503
 *   GET  /_pedidos  ·  DELETE /_pedidos
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const [puerto, archivo] = [Number(process.argv[2] ?? 8840), process.argv[3]];
if (!archivo) throw new Error("uso: node scripts/agente_falso.ts <puerto> <corrida.ndjson>");
// El orquestador real separa con \n; las grabaciones hechas en Windows quedaron con \r\n.
const LINEAS = readFileSync(archivo, "utf-8").split(/\r?\n/).filter(Boolean);
const esFinal = (l: string) => l.startsWith('{"kind": "final"') || l.startsWith('{"kind":"final"');

let escenario = { nombre: "completo", pausa_ms: 150 };
const pedidos: Record<string, unknown>[] = [];

function lineasDe(nombre: string): string[] {
  const sinFinal = LINEAS.filter((l) => !esFinal(l));
  if (nombre === "completo") return LINEAS;
  if (nombre === "cortado") return sinFinal;
  if (nombre === "abortado") {
    return [...sinFinal.slice(0, 6), JSON.stringify({ kind: "final", final_response: "OCDS no disponible — análisis abortado.",
                                                      state: { _aborted: "ocds_unavailable" } })];
  }
  if (nombre === "error") {
    return [...sinFinal.slice(0, 12), JSON.stringify({ kind: "error", agent: "pipeline", name: "documentos",
                                                       detail: "rama documentos: RuntimeError: prueba" })];
  }
  throw new Error(`escenario desconocido: ${nombre}`);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  const cuerpo = Buffer.concat(partes).toString("utf-8");
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/_escenario") {
    escenario = { ...escenario, ...JSON.parse(cuerpo) };
    res.end(JSON.stringify(escenario));
    return;
  }
  if (url.pathname === "/_pedidos") {
    if (req.method === "DELETE") pedidos.length = 0;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(pedidos));
    return;
  }
  pedidos.push({
    metodo: req.method, ruta: url.pathname, query: url.search, escenario: escenario.nombre,
    authorization: req.headers.authorization ?? null, content_type: req.headers["content-type"] ?? null, cuerpo,
  });
  if (escenario.nombre === "409") {
    res.writeHead(409, { "content-type": "application/x-ndjson; charset=utf-8" });
    res.end(`${JSON.stringify({ kind: "error", agent: "pipeline", error_kind: "tipo_no_aceptado", detail: "perfil obras no acepta tipo 'bienes'" })}\n`);
    return;
  }
  if (escenario.nombre === "503") {
    res.writeHead(503, { "content-type": "text/html" });
    res.end("<html>no available instance</html>");
    return;
  }
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" });
  for (const l of lineasDe(escenario.nombre)) {
    res.write(`${l}\n`);
    await dormir(escenario.pausa_ms);
  }
  res.end();
}).listen(puerto, "127.0.0.1", () => console.log(`orquestador falso en http://127.0.0.1:${puerto} (${LINEAS.length} líneas)`));
