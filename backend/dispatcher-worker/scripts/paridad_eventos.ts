/**
 * Paridad del reductor: los MISMOS bytes NDJSON pasan por backend/dispatcher (Python: requests
 * iter_lines + events.reduce_event + main._evento, scripts/paridad_eventos.py) y por este Worker
 * (TextDecoder + Lineas + aplicarLinea de src/stream.ts), con las mismas marcas de tiempo, y se exige
 * el mismo JSON de `fases`, `fase_actual`, `fase_index`, `error`, `eventos` y resultado, al final y en
 * cada escritura intermedia (lo que `actualizar` persiste por evento).
 *
 *   PYTHON=<python con requests y psycopg2> node scripts/paridad_eventos.ts [corrida.ndjson ...]
 *
 * Sin argumentos corre solo los casos sintéticos (bordes de events.py y main.py). Sale con código 1
 * ante la primera diferencia.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Lineas } from "../src/py.ts";
import { aplicarLinea } from "../src/stream.ts";
import type { Estado } from "../src/eventos.ts";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const PYTHON = process.env.PYTHON ?? "python";
const MAX_EVENTOS = 400;
const BASE = Date.UTC(2026, 8, 26);
const marca = (i: number) => `${new Date(BASE + i * 1000).toISOString().slice(0, 19)}+00:00`;

const LS = String.fromCharCode(0x2028);
const NEL = String.fromCharCode(0x85);

// ─── Casos sintéticos ────────────────────────────────────────────────────────
type Ev = Record<string, unknown>;
const ph = (name: unknown, msg: unknown = "x"): Ev => ({ kind: "phase", name, msg });
const bienes: Ev[] = [
  ph("perfil", "bienes"), ph("started", "despachando"), ph("deterministic", "pipeline determinista"),
  ph("ocds", "obteniendo OCDS"), ph("clasificacion", "matriz bienes/adjudicada"),
  ph("dag", "ramas en paralelo: compliance ∥ documentos ∥ proveedor"),
  ph("compliance", "reglas duras"), ph("document_parser", "documentos"), ph("proveedor", "proveedor"),
  ph("research_parallel", "investigación paralela: web_research ∥ news_research ∥ entity_personnel"),
  { kind: "warn", name: "document_parser", msg: "ítems canónicos tras sanitización" },
  ph("legal", "análisis legal"), ph("market", "precios"),
  { kind: "error", agent: "entity_personnel_agent", detail: "run: Tool 'google:google_search' not found." },
  { kind: "warn", name: "entity_personnel", msg: "entity_personnel vacío — reintento" },
  { kind: "warn", agent: "entity_personnel_agent", msg: "vacío tras reintento — default tipado" },
  { kind: "error", agent: "pipeline", name: "documentos", detail: "rama documentos: RuntimeError: x" },
  ph("dag_join", "ramas terminadas"), ph("person_network", "omitido: no aplica a bienes/desierta"),
  ph("compliance_extended", "omitido"), ph("compliance_rules", "reglas del perfil otros en código"),
  ph("persist_checkpoint"), ph("report_writer"), ph("safety_net"), ph("persist"), ph("self_eval"),
  { kind: "final", final_response: "ok" },
];

const raros: Ev[] = [
  ph("  market_agent  ", { dict: [1, "a", null] }), ph(7, 3.5), ph(null, true), ph("", ""),
  ph("web_research", "a, b ∥ news_research,entity_personnel ∥ proveedor"), ph("research_parallel", "sin lista"),
  ph("ocds", "omitido"), ph("ocds", "omitido:   "), ph("market", `😀${"ñ".repeat(300)}`),
  { kind: "warn", name: "no_existe", msg: "reintento" }, { kind: "warn", name: "market", msg: "TRAS REINTENTO" },
  { kind: "warn", name: "market", msg: "REINTENTO de nuevo" }, { kind: "warn" },
  { kind: "error" }, { kind: "error", msg: ["lista"], name: "no_rastreada", agent: "market_agent" },
  { kind: "error", detail: "", msg: 0, name: "compliance", agent: "pipeline" },
  { kind: "error", name: "proveedor", agent: "pipeline", detail: "x".repeat(700) },
  { kind: "PHASE", name: "market" }, { kind: "tool_call", name: "market" },
  ph("dag"), ph("market", `con separador${LS}de línea`), ph("news", `NEL${NEL}medio`),
  { kind: "final", state: { _aborted: 0 }, runner_error: {} },
  { kind: "final", state: [], runner_error: { msg: null } },
  { kind: "final", runner_error: "texto plano 😀".repeat(20) },
  { kind: "final", state: { _aborted: ["ocds", 1] } },
];

function ndjson(evs: Ev[], extra: string[] = [], fin = "\n"): string {
  return [...evs.map((e) => JSON.stringify(e)), ...extra].join(fin) + fin;
}

function sinteticos(dir: string): { nombre: string; archivo: string }[] {
  const casos: [string, string][] = [
    ["bienes", ndjson(bienes)],
    ["bienes-crlf", ndjson(bienes, [], "\r\n")],
    ["bienes-abortado", ndjson([...bienes.slice(0, 6), { kind: "final", state: { _aborted: "ocds_unavailable" } }])],
    ["bienes-runner-error", ndjson([...bienes.slice(0, 9), { kind: "final", runner_error: { kind: "x", msg: "429 RESOURCE_EXHAUSTED" } }])],
    ["bienes-sin-final", ndjson(bienes.slice(0, -1)).trimEnd()],
    ["raros", ndjson(raros, ["", "   ", "no json", "[1, 2]", '"texto"', "5", '{"kind": "phase", "name": "market", "msg": NaN}',
                              '{"kind": "final", "state": {"_aborted": NaN}}'])],
    ["tope-de-eventos", ndjson(Array.from({ length: 450 }, (_, i) => ph(i % 2 ? "market" : "web_research", `vuelta ${i}`)))],
  ];
  return casos.map(([nombre, texto]) => {
    const archivo = join(dir, `${nombre}.ndjson`);
    writeFileSync(archivo, texto, "utf-8");
    return { nombre, archivo };
  });
}

// ─── Lado Worker ─────────────────────────────────────────────────────────────
function correrWorker(datos: Uint8Array, trozo: number): unknown {
  const decoder = new TextDecoder("utf-8");
  const lineas = new Lineas();
  const state: Estado = {};
  let eventos: Record<string, unknown>[] = [];
  const escrituras: Record<string, unknown>[] = [];
  let resultado = "fail";
  let n = 0;
  const procesar = (linea: string) => {
    const r = aplicarLinea(state, linea, marca(n));
    if (!r) return;
    n++;
    escrituras.push(Object.fromEntries((["fase_actual", "fase_index", "error", "fases"] as const)
      .filter((k) => Object.hasOwn(r.cambios, k)).map((k) => [k, r.cambios[k]])));
    if (eventos.length >= MAX_EVENTOS) eventos = eventos.slice(1);
    eventos.push(r.entrada);
    if (r.cambios.terminado) resultado = r.cambios.abortado ? "abort" : "ok";
  };
  for (let i = 0; i < datos.length; i += trozo) {
    for (const l of lineas.agregar(decoder.decode(datos.subarray(i, i + trozo), { stream: true }))) procesar(l);
  }
  for (const l of [...lineas.agregar(decoder.decode()), ...lineas.fin()]) procesar(l);
  return JSON.parse(JSON.stringify({ state, eventos, escrituras, resultado, visibles: n }));
}

// ─── Comparación ─────────────────────────────────────────────────────────────
/** JSON con claves ordenadas: jsonb no conserva el orden de las claves. */
function canonico(v: unknown): string {
  return JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

function primeraDiferencia(a: unknown, b: unknown, ruta = "$"): string | null {
  if (canonico(a) === canonico(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = primeraDiferencia((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${ruta}.${k}`);
      if (d) return d;
    }
  }
  return `${ruta}: python=${canonico(a)?.slice(0, 300)} worker=${canonico(b)?.slice(0, 300)}`;
}

function main(): number {
  const dir = join(tmpdir(), "vigia-paridad");
  mkdirSync(dir, { recursive: true });
  // 512 = ITER_CHUNK_SIZE de requests (el que usa main.py); otros tamaños mueven los cortes de trozo.
  // En las corridas grabadas no se usan trozos chicos: iter_lines es cuadrático con el `final` de ~1 MB.
  const grabadas = process.argv.slice(2).map((a) => ({ nombre: basename(a), archivo: resolve(a), trozos: [512, 4096, 65536] }));
  const casos = [...grabadas, ...sinteticos(dir).map((c) => ({ ...c, trozos: [1, 7, 512, 4096] }))];
  const manifiesto = casos.flatMap(({ trozos, ...c }) => trozos.map((trozo) => ({
    ...c, nombre: `${c.nombre}@${trozo}`, trozo, max_eventos: MAX_EVENTOS,
  })));
  const archivoManifiesto = join(dir, "manifiesto.json");
  writeFileSync(archivoManifiesto, JSON.stringify(manifiesto), "utf-8");
  const python = JSON.parse(execFileSync(PYTHON, [join(AQUI, "paridad_eventos.py"), archivoManifiesto], {
    encoding: "utf-8", maxBuffer: 1 << 30,
  })) as Record<string, Record<string, unknown>>;

  let fallas = 0;
  for (const c of manifiesto) {
    const w = correrWorker(new Uint8Array(readFileSync(c.archivo)), c.trozo) as Record<string, unknown>;
    const p = python[c.nombre];
    const d = primeraDiferencia(p, w);
    const st = w.state as Estado;
    const resumen = `visibles=${w.visibles} eventos=${(w.eventos as unknown[]).length} fase_actual=${st.fase_actual} ` +
      `fase_index=${st.fase_index} fases=${Object.keys(st.fases ?? {}).length} resultado=${w.resultado}`;
    if (d) {
      fallas++;
      console.log(`✗ ${c.nombre}: ${d}`);
    } else {
      console.log(`✓ ${c.nombre}  ${resumen}`);
    }
  }
  console.log(`\n${manifiesto.length - fallas}/${manifiesto.length} casos idénticos`);
  return fallas ? 1 : 0;
}

process.exitCode = main();
