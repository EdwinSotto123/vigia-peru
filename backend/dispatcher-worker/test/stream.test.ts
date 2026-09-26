// Llamada al orquestador y lectura del NDJSON en tramos (src/stream.ts) contra un orquestador falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir, cuerpo, interrumpido, manijasVivas, seguir } from "../src/stream.ts";
import type { Checkpoint, Contexto, PlanAnalisis } from "../src/stream.ts";
import { ABORT, FAIL, OK, PENDIENTE } from "../src/sql.ts";
import type { Consultor } from "../src/sql.ts";

const PLAN: PlanAnalisis = { url: "https://bienes.run.app", perfil: "bienes", tipo: "obras", clas: null, docs: { "u": "gs://b/u" } };
const OCDS = '{"ocid": "ocds-dgv273-seacev3-1", "parties": [{"id": 1}], "tender": {"title": "Compra de ñandúes", "value": 1.0}}';

const EVENTOS = [
  { kind: "session", session_id: "s" },
  { kind: "phase", name: "perfil", msg: "bienes" },
  { kind: "phase", name: "ocds", msg: "obteniendo OCDS" },
  { kind: "tool_call", name: "x" },
  { kind: "phase", name: "compliance", msg: "reglas" },
  { kind: "warn", name: "market", msg: "sin ítems" },
  { kind: "phase", name: "report_writer", msg: "dictamen" },
  { kind: "final", final_response: "ok", state: { grande: "x".repeat(5000) } },
];
const NDJSON = EVENTOS.map((e) => JSON.stringify(e)).join("\n") + "\n";
const VISIBLES = EVENTOS.filter((e) => ["phase", "warn", "error", "final"].includes(e.kind)).length;

function dbFalsa(): Consultor & { sql: [string, unknown[]][] } {
  const sql: [string, unknown[]][] = [];
  return {
    sql,
    async query(s, params) {
      sql.push([s, params]);
      if (s.startsWith("SELECT ocds_payload")) return [[OCDS]];
      return [];
    },
  };
}

/** Orquestador que manda `texto` en trozos de `trozo` bytes con `pausa` ms entre trozos. */
function orquestador(texto: string, opciones: { trozo?: number; pausa?: number; status?: number; tipo?: string; cortarEn?: number } = {}) {
  const pedidos: { url: string; init?: RequestInit }[] = [];
  const buscar = (async (url: string, init?: RequestInit) => {
    pedidos.push({ url, init });
    const datos = new TextEncoder().encode(texto);
    const trozo = opciones.trozo ?? 64;
    let i = 0;
    const cuerpoStream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (opciones.pausa) await new Promise((r) => setTimeout(r, opciones.pausa));
        if (opciones.cortarEn !== undefined && i >= opciones.cortarEn) return c.error(new Error("conexión reiniciada"));
        if (i >= datos.length) return c.close();
        c.enqueue(datos.subarray(i, i + trozo));
        i += trozo;
      },
    });
    return new Response(cuerpoStream, { status: opciones.status ?? 200, headers: { "content-type": opciones.tipo ?? "application/x-ndjson; charset=utf-8" } });
  }) as typeof fetch;
  return { buscar, pedidos };
}

function contexto(buscar: typeof fetch, db: Consultor, extra: Partial<Contexto["cfg"]> = {}, dueno: object = {}): Contexto {
  return {
    db, ocid: "1225030", worker: "cloudflare-prueba", clave: `inst/${Math.random()}`, dueno, buscar,
    cfg: { streamTimeoutS: 60, maxEventos: 400, prefetchOcds: false, oeceBase: "https://oece", tramoS: 60, ...extra },
    env: { AGENT_ID_TOKEN: "t" },
  };
}

const actualizaciones = (db: { sql: [string, unknown[]][] }) => db.sql.filter(([s]) => s.startsWith("UPDATE procesamientos SET latido_at = now(),"));

test("cuerpo: mismo JSON que main.py, con el OCDS tal como lo guarda Postgres", () => {
  const clas = { tipo: "bienes", etapa: "adjudicada", procesable: true, motivo_no_procesable: null, agentes: ["market"], validaciones_pendientes: [] };
  const b = cuerpo("1225030", OCDS, null, clas);
  assert.ok(b.includes(`"ocds":${OCDS}`), "el OCDS va sin re-serializar (1.0 sigue siendo 1.0)");
  assert.deepEqual(Object.keys(JSON.parse(b)), ["input", "ocds", "docs_b64", "doc_urls", "clasificacion"]);
  assert.deepEqual(JSON.parse(b).clasificacion, { tipo: "bienes", etapa: "adjudicada", agentes: ["market"], validaciones_pendientes: [] });
  assert.deepEqual(JSON.parse(b).doc_urls, {});
  assert.ok(!("clasificacion" in JSON.parse(cuerpo("1", null, { a: "gs://a" }, null))));
});

test("stream completo en un tramo: un UPDATE por evento visible y resultado OK", async () => {
  const db = dbFalsa();
  const { buscar, pedidos } = orquestador(NDJSON, { trozo: 7 });
  const cp = await abrir(contexto(buscar, db), PLAN);
  assert.equal(cp.etapa, "fin");
  assert.equal(cp.resultado, OK);
  assert.equal(cp.eventos, VISIBLES);
  assert.equal(cp.state.fase_actual, "final");
  assert.equal(actualizaciones(db).length, VISIBLES);
  assert.equal(pedidos[0].url, "https://bienes.run.app?stream=1");
  assert.ok(String(pedidos[0].init!.body).includes(OCDS));
  assert.equal((pedidos[0].init!.headers as Record<string, string>).Authorization, "Bearer t");
  assert.equal(manijasVivas(), 0);
});

test("stream en varios tramos: mismo estado final que en uno solo", async () => {
  const unico = await abrir(contexto(orquestador(NDJSON, { trozo: 40 }).buscar, dbFalsa()), PLAN);
  const db = dbFalsa();
  const dueno = {};
  const ctx = contexto(orquestador(NDJSON, { trozo: 40, pausa: 15 }).buscar, db, { tramoS: 0.04 }, dueno);
  let cp: Checkpoint = await abrir(ctx, PLAN);
  let tramos = 1;
  while (cp.etapa === "stream") {
    // el checkpoint cruza el límite de un paso: tiene que sobrevivir a structuredClone
    cp = await seguir(ctx, structuredClone(cp));
    tramos++;
  }
  assert.ok(tramos > 2, `tramos: ${tramos}`);
  assert.equal(cp.etapa, "fin");
  assert.equal(cp.resultado, OK);
  assert.equal(cp.eventos, VISIBLES);
  const sinTs = (c: Checkpoint) => JSON.stringify(c.state, (k, v) => (["desde", "hasta"].includes(k) ? "ts" : v));
  assert.equal(sinTs(cp), sinTs(unico));
  assert.equal(actualizaciones(db).length, VISIBLES);
  assert.equal(manijasVivas(), 0);
});

test("otra invocación no puede seguir el stream: excepción sin volver a llamar", async () => {
  const { buscar, pedidos } = orquestador(NDJSON, { trozo: 40, pausa: 15 });
  const ctx = contexto(buscar, dbFalsa(), { tramoS: 0.03 });
  const cp = await abrir(ctx, PLAN);
  assert.equal(cp.etapa, "stream");
  const otra = await seguir({ ...ctx, dueno: {} }, cp);
  assert.equal(otra.etapa, "excepcion");
  assert.ok(otra.excepcion!.includes("stream perdido"));
  assert.equal(pedidos.length, 1);
  assert.equal(manijasVivas(), 0);
});

test("reintento de un tramo: abandona el stream y sigue como cortado", async () => {
  const ctx = contexto(orquestador(NDJSON, { trozo: 40, pausa: 15 }).buscar, dbFalsa(), { tramoS: 0.03 });
  const cp = await abrir(ctx, PLAN);
  const r = interrumpido(ctx.clave, cp, 2);
  assert.equal(r.etapa, "excepcion");
  assert.equal(r.resultado, cp.resultado);
  assert.deepEqual(r.state, cp.state);
  assert.equal(manijasVivas(), 0);
  assert.equal(interrumpido("otra/clave", null, 2).resultado, FAIL);
});

test("sin datos por DISPATCHER_STREAM_TIMEOUT: excepción de read timeout", async () => {
  const { buscar } = orquestador(NDJSON, { trozo: 40, pausa: 400 });
  const cp = await abrir(contexto(buscar, dbFalsa(), { streamTimeoutS: 0.1 }), PLAN);
  assert.equal(cp.etapa, "excepcion");
  assert.match(cp.excepcion!, /bienes\.run\.app: Read timed out\. \(read timeout=0\.1\)/);
  assert.equal(manijasVivas(), 0);
});

test("conexión cortada a mitad: excepción con el estado que llegó", async () => {
  const cp = await abrir(contexto(orquestador(NDJSON, { trozo: 50, cortarEn: 150 }).buscar, dbFalsa()), PLAN);
  assert.equal(cp.etapa, "excepcion");
  assert.equal(cp.excepcion, "conexión reiniciada");
  assert.equal(cp.resultado, FAIL);
  assert.equal(cp.state.fase_actual, "ocds");
});

test("409 tipo_no_aceptado → pendiente con el motivo de main.py", async () => {
  const cp = await abrir(contexto(orquestador('{"kind":"error"}\n', { status: 409 }).buscar, dbFalsa()), PLAN);
  assert.equal(cp.etapa, "cerrar");
  assert.equal(cp.resultado, PENDIENTE);
  assert.equal(cp.motivo, "el servicio bienes rechazó el tipo 'obras' (409 tipo_no_aceptado)");
});

test("429/5xx sin NDJSON → sin capacidad (ABORT); 500 con NDJSON → error HTTP como requests", async () => {
  for (const status of [429, 500, 502, 503]) {
    const cp = await abrir(contexto(orquestador("sin instancias", { status, tipo: "text/html" }).buscar, dbFalsa()), PLAN);
    assert.equal(cp.resultado, ABORT, String(status));
    assert.equal(cp.err, `sin capacidad en bienes: HTTP ${status}`);
  }
  const cp = await abrir(contexto(orquestador("{}\n", { status: 500 }).buscar, dbFalsa()), PLAN);
  assert.equal(cp.etapa, "excepcion");
  assert.equal(cp.excepcion, "500 Server Error: Internal Server Error for url: https://bienes.run.app?stream=1");
  const cp404 = await abrir(contexto(orquestador("no", { status: 404, tipo: "text/html" }).buscar, dbFalsa()), PLAN);
  assert.equal(cp404.excepcion, "404 Client Error: Not Found for url: https://bienes.run.app?stream=1");
});

test("stream que termina sin `final`: fin con resultado FAIL", async () => {
  const sinFinal = EVENTOS.slice(0, -1).map((e) => JSON.stringify(e)).join("\n");
  const cp = await abrir(contexto(orquestador(sinFinal).buscar, dbFalsa()), PLAN);
  assert.equal(cp.etapa, "fin");
  assert.equal(cp.resultado, FAIL);
  assert.equal(cp.eventos, VISIBLES - 1);
});

test("final abortado → ABORT con el error del reductor", async () => {
  const txt = [{ kind: "phase", name: "ocds" }, { kind: "final", state: { _aborted: "ocds_unavailable" } }].map((e) => JSON.stringify(e)).join("\n");
  const cp = await abrir(contexto(orquestador(txt).buscar, dbFalsa()), PLAN);
  assert.equal(cp.resultado, ABORT);
  assert.equal(cp.state.error, "análisis abortado por el orquestador: ocds_unavailable");
});
