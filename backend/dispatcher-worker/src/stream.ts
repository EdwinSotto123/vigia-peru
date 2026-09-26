/**
 * Llamada al orquestador y lectura de su NDJSON: el bloque `try` de `procesar()` en main.py.
 *
 * Un análisis dura 5–60 min y un paso de Workflows no puede pasar de 30 min, así que el stream se
 * lee en TRAMOS (un paso cada uno, DISPATCHER_TRAMO_S): cada tramo devuelve un `Checkpoint` con el
 * estado reducido, y el stream sigue abierto en memoria (`manijas`) para el tramo siguiente, que
 * corre en la misma invocación del Workflow. Si el motor reinició la instancia (la manija no está
 * o el paso se reintentó), el tramo NO vuelve a llamar al orquestador: devuelve `excepcion`, que es
 * lo que main.py hace cuando el stream se corta (espera de gracia a que la alerta aparezca en DB).
 */

import { ABORT, FAIL, OK, PENDIENTE, actualizar, latir, recordEnDb, reprTipo, tituloDe } from "./sql.ts";
import type { Consultor, Ocds, Resultado } from "./sql.ts";
import type { Clasificacion } from "./sql.ts";
import { VISIBLES, entradaBitacora, reducirEvento } from "./eventos.ts";
import type { Estado, Evento } from "./eventos.ts";
import { Lineas, cargarJson, cortar, isoSegundos, o, verdad } from "./py.ts";
import { cabeceras } from "./google.ts";
import type { Buscar, FuenteToken } from "./google.ts";
import { registrar } from "./registro.ts";

export type Etapa = "stream" | "fin" | "excepcion" | "cerrar";

/** Lo que un tramo deja persistido en el Workflow (tiene que ser serializable y chico). */
export interface Checkpoint {
  etapa: Etapa;
  resultado: Resultado;
  err: string | null;
  state: Estado;
  /** Manija del stream vivo (solo en etapa "stream"). */
  manija: string | null;
  /** `str(e)` de la excepción que cortó el stream (etapa "excepcion"). */
  excepcion: string | null;
  /** Motivo para `dejar_pendiente` (etapa "cerrar" con resultado PENDIENTE: 409 tipo_no_aceptado). */
  motivo: string | null;
  /** Eventos visibles procesados hasta acá. */
  eventos: number;
}

export interface PlanAnalisis {
  url: string;
  perfil: string;
  tipo: string | null;
  clas: Clasificacion | null;
  docs: Record<string, string> | null;
}

export interface ConfigStream {
  streamTimeoutS: number;
  maxEventos: number;
  prefetchOcds: boolean;
  oeceBase: string;
  tramoS: number;
}

export interface Contexto {
  db: Consultor;
  ocid: string;
  worker: string;
  cfg: ConfigStream;
  env: FuenteToken;
  buscar?: Buscar;
  /** Clave de la manija: instancia + contrato (determinista, sobrevive a la repetición de run()). */
  clave: string;
  /** Invocación dueña del stream (la instancia de WorkflowEntrypoint de este run()). */
  dueno: object;
}

const LATIDO_MS = 30_000;
const TIEMPO = Symbol("tiempo");

// UA de navegador: el WAF del OECE rechaza clientes "robot" (mismas cabeceras que main.py).
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-PE,es;q=0.9",
};

const RAZONES: Record<number, string> = {
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
  408: "Request Timeout", 409: "Conflict", 413: "Payload Too Large", 422: "Unprocessable Entity",
  429: "Too Many Requests", 500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout",
};

// ─── Manijas: el stream abierto entre tramos ─────────────────────────────────
interface Manija {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  ctl: AbortController;
  decoder: TextDecoder;
  lineas: Lineas;
  /** Lectura en curso que quedó pendiente al cerrar el tramo anterior (no se pierde ningún byte). */
  lectura: Promise<ReadableStreamReadResult<Uint8Array>> | null;
  ultimoDato: number;
  host: string;
  dueno: object;
  abandonada: boolean;
}

const manijas = new Map<string, Manija>();

/** Abandona el stream `m` (por defecto, el registrado en `id`) y lo saca del registro si sigue ahí. */
function soltar(id: string, m: Manija | undefined = manijas.get(id)): void {
  if (!m) return;
  if (manijas.get(id) === m) manijas.delete(id);
  m.abandonada = true;
  try {
    m.ctl.abort();
    void m.reader.cancel().catch(() => undefined);
  } catch {
    // de otra invocación: el runtime ya la cerró
  }
}

// ─── Líneas del stream ───────────────────────────────────────────────────────
/** Evento visible de una línea, o null (vacía, no JSON, no objeto o de otro `kind`). */
export function interpretar(linea: string): Evento | null {
  if (!linea) return null;
  let ev: unknown;
  try {
    ev = cargarJson(linea);
  } catch {
    return null;
  }
  if (ev === null || typeof ev !== "object" || Array.isArray(ev)) return null;
  const kind = (ev as Evento).kind;
  return typeof kind === "string" && VISIBLES.has(kind) ? (ev as Evento) : null;
}

/** Reduce una línea sobre `state` (lo muta, como `state.update`) y devuelve lo que se persiste. */
export function aplicarLinea(state: Estado, linea: string, ts: string): { cambios: Estado; entrada: Record<string, unknown> } | null {
  const ev = interpretar(linea);
  if (!ev) return null;
  const cambios = reducirEvento(state, ev, ts);
  Object.assign(state, cambios);
  return { cambios, entrada: entradaBitacora(ev, cambios, ts) };
}

interface Progreso {
  state: Estado;
  resultado: Resultado;
  eventos: number;
}

async function procesarLinea(ctx: Contexto, p: Progreso, linea: string): Promise<void> {
  const r = aplicarLinea(p.state, linea, isoSegundos());
  if (!r) return;
  await actualizar(ctx.db, ctx.ocid, r.cambios, r.entrada, ctx.cfg.maxEventos);
  p.eventos++;
  if (verdad(r.cambios.terminado)) p.resultado = verdad(r.cambios.abortado) ? ABORT : OK;
}

// ─── Cuerpo y OCDS ───────────────────────────────────────────────────────────
/** El JSON que main.py manda al orquestador, con el OCDS tal como lo guarda Postgres. */
export function cuerpo(ocid: string, ocds: string | null, docs: Record<string, string> | null, clas: Clasificacion | null): string {
  const partes = [
    `"input":${JSON.stringify(ocid)}`,
    `"ocds":${ocds ?? "null"}`,
    `"docs_b64":{}`,
    `"doc_urls":${JSON.stringify(o(docs, {}))}`,
  ];
  if (clas !== null) {
    const { tipo, etapa, agentes, validaciones_pendientes } = clas;
    partes.push(`"clasificacion":${JSON.stringify({ tipo, etapa, agentes, validaciones_pendientes })}`);
  }
  return `{${partes.join(",")}}`;
}

/**
 * compiledRelease del OECE si esta salida puede verlo. Desde Cloudflare en EE.UU. el WAF del OECE
 * responde 403 (medido): casi siempre gana `record_en_db`, como en el job de Cloud Run.
 */
export async function prefetchOcds(cfg: ConfigStream, ocid: string, buscar: Buscar = fetch): Promise<Ocds | null> {
  if (!cfg.prefetchOcds) return null;
  const full = ocid.startsWith("ocds-") ? ocid : `ocds-dgv273-seacev3-${ocid}`;
  try {
    const r = await buscar(`${cfg.oeceBase}/record/${full}`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(55_000) });
    if (r.status !== 200) {
      await r.body?.cancel().catch(() => undefined);
      registrar("INFO", `prefetch OCDS ${ocid} → HTTP ${r.status} (lo resolverá el orquestador)`, { ocid });
      return null;
    }
    const j = o(cargarJson(await r.text()), {}) as Record<string, unknown>;
    const recs = o(j.records, []) as Record<string, unknown>[];
    const cr = recs.length ? recs[0].compiledRelease : null;
    if (cr === null || typeof cr !== "object" || Array.isArray(cr) || !verdad((cr as Evento).ocid)) return null;
    const texto = JSON.stringify(cr);
    return { texto, titulo: tituloDe(cr as Evento) };
  } catch (e) {
    registrar("INFO", `prefetch OCDS ${ocid} falló: ${cortar(String((e as Error).message ?? e), 120)}`, { ocid });
    return null;
  }
}

// ─── Tramos ──────────────────────────────────────────────────────────────────
function checkpoint(p: Progreso, etapa: Etapa, extra: Partial<Checkpoint> = {}): Checkpoint {
  return { etapa, resultado: p.resultado, err: null, state: p.state, manija: null, excepcion: null, motivo: null, eventos: p.eventos, ...extra };
}

function carrera<T>(p: Promise<T>, ms: number): Promise<T | typeof TIEMPO> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const reloj = new Promise<typeof TIEMPO>((r) => { t = setTimeout(() => r(TIEMPO), Math.max(0, ms)); });
  return Promise.race([p, reloj]).finally(() => clearTimeout(t));
}

const mensaje = (e: unknown) => cortar(String((e as Error)?.message ?? e), 500);
const leidoFuera = (m: Manija, s: number) => `${m.host}: Read timed out. (read timeout=${s})`;

/** Lee el stream hasta el fin, una excepción o el final del tramo (`hasta`, ms epoch). */
async function leer(ctx: Contexto, id: string, m: Manija, p: Progreso, hasta: number): Promise<Checkpoint> {
  const latido = setInterval(() => {
    latir(ctx.db, [ctx.ocid], ctx.worker).catch((e) => registrar("WARNING", `latido falló: ${mensaje(e)}`, { ocid: ctx.ocid }));
  }, LATIDO_MS);
  try {
    for (;;) {
      if (m.abandonada) throw new Error("stream abandonado: otro intento del paso tomó el contrato");
      const ahora = Date.now();
      if (ahora >= hasta) return checkpoint(p, "stream", { manija: id });
      const limiteIdle = m.ultimoDato + ctx.cfg.streamTimeoutS * 1000;
      if (ahora >= limiteIdle) throw new Error(leidoFuera(m, ctx.cfg.streamTimeoutS));
      m.lectura ??= m.reader.read();
      const r = await carrera(m.lectura, Math.min(hasta, limiteIdle) - ahora);
      if (r === TIEMPO) continue;
      m.lectura = null;
      if (m.abandonada) throw new Error("stream abandonado: otro intento del paso tomó el contrato");
      if (r.done) {
        const resto = m.decoder.decode();
        for (const linea of [...m.lineas.agregar(resto), ...m.lineas.fin()]) await procesarLinea(ctx, p, linea);
        if (manijas.get(id) === m) manijas.delete(id);
        return checkpoint(p, "fin");
      }
      m.ultimoDato = Date.now();
      for (const linea of m.lineas.agregar(m.decoder.decode(r.value, { stream: true }))) await procesarLinea(ctx, p, linea);
    }
  } catch (e) {
    soltar(id, m);
    return checkpoint(p, "excepcion", { excepcion: mensaje(e) });
  } finally {
    clearInterval(latido);
  }
}

/** Primer tramo: OCDS, cuerpo, POST `?stream=1` y lectura hasta el fin del tramo. */
export async function abrir(ctx: Contexto, plan: PlanAnalisis): Promise<Checkpoint> {
  const p: Progreso = { state: {}, resultado: FAIL, eventos: 0 };
  const { ocid, cfg } = ctx;
  const buscar = ctx.buscar ?? fetch;
  const hasta = Date.now() + cfg.tramoS * 1000;
  try {
    const ocds = (await recordEnDb(ctx.db, ocid)) ?? (await prefetchOcds(cfg, ocid, buscar));
    const body = cuerpo(ocid, ocds?.texto ?? null, plan.docs, plan.clas);
    if (plan.docs && Object.keys(plan.docs).length) registrar("INFO", `${Object.keys(plan.docs).length} documentos desde GCS para ${ocid}`, { ocid });
    if (plan.clas) {
      const c = plan.clas;
      const pend = c.validaciones_pendientes.length ? ` · pendientes ${JSON.stringify(c.validaciones_pendientes)}` : "";
      registrar("INFO", `clasificación ${ocid}: ${c.tipo}/${c.etapa} · ${c.agentes.length} agentes${pend}`, { ocid });
    }
    if (ocds) registrar("INFO", `OCDS precargado para ${ocid} (${ocds.titulo})`, { ocid });
    const url = `${plan.url}?stream=1`;
    const headers = { "Content-Type": "application/json", ...(await cabeceras(ctx.env, plan.url, buscar)) };
    const ctl = new AbortController();
    const host = new URL(plan.url).host;
    // Espera de cabeceras = read timeout de requests, acotada para que el tramo quepa en su paso.
    const plazo = Math.min(cfg.streamTimeoutS, 25 * 60) * 1000;
    const r = await carrera(buscar(url, { method: "POST", headers, body, signal: ctl.signal }), plazo);
    if (r === TIEMPO) {
      ctl.abort();
      throw new Error(`${host}: Read timed out. (read timeout=${cfg.streamTimeoutS})`);
    }
    const tipoContenido = r.headers.get("content-type") ?? "";
    const cerrarCuerpo = () => r.body?.cancel().catch(() => undefined);
    if (r.status === 401 || r.status === 403) {
      // Cloud Run rechazó la invocación (falta roles/run.invoker o el ID token): configuración, no
      // culpa del contrato → vuelve a la cola sin consumir intento y la corrida deja de reclamar.
      await cerrarCuerpo();
      const err = `sin permiso para invocar el servicio ${plan.perfil}: HTTP ${r.status} ` +
        "(¿roles/run.invoker de la cuenta de GCP_SA_KEY o ID token ausente?)";
      registrar("ERROR", `⏸ ${ocid} ${err}`, { ocid });
      return checkpoint(p, "cerrar", { resultado: ABORT, err });
    }
    if (r.status === 409) {
      // El servicio rechazó el tipo (perfil ≠ tipo): mala configuración de URLs → pendiente.
      await cerrarCuerpo();
      registrar("ERROR", `⏸ ${ocid} 409 tipo_no_aceptado en ${plan.perfil} (${plan.url})`, { ocid });
      return checkpoint(p, "cerrar", {
        resultado: PENDIENTE,
        motivo: `el servicio ${plan.perfil} rechazó el tipo ${reprTipo(plan.tipo)} (409 tipo_no_aceptado)`,
      });
    }
    if ([429, 500, 502, 503].includes(r.status) && !tipoContenido.includes("application/x-ndjson")) {
      // Sin instancia disponible o servicio saturado: vuelve a la cola sin consumir intento.
      await cerrarCuerpo();
      const err = `sin capacidad en ${plan.perfil}: HTTP ${r.status}`;
      registrar("WARNING", `⏸ ${ocid} ${err}`, { ocid });
      return checkpoint(p, "cerrar", { resultado: ABORT, err });
    }
    if (r.status >= 400 && r.status < 600) {
      await cerrarCuerpo();
      const razon = r.statusText || RAZONES[r.status] || "";
      throw new Error(`${r.status} ${r.status < 500 ? "Client" : "Server"} Error: ${razon} for url: ${url}`);
    }
    if (!r.body) return checkpoint(p, "fin");
    soltar(ctx.clave);
    const m: Manija = {
      reader: r.body.getReader(), ctl, decoder: new TextDecoder("utf-8"), lineas: new Lineas(),
      lectura: null, ultimoDato: Date.now(), host, dueno: ctx.dueno, abandonada: false,
    };
    manijas.set(ctx.clave, m);
    return await leer(ctx, ctx.clave, m, p, hasta);
  } catch (e) {
    return checkpoint(p, "excepcion", { excepcion: mensaje(e) });
  }
}

/** Tramos siguientes: retoma el mismo stream desde su manija. */
export async function seguir(ctx: Contexto, previo: Checkpoint): Promise<Checkpoint> {
  const p: Progreso = { state: previo.state, resultado: previo.resultado, eventos: previo.eventos };
  const m = manijas.get(ctx.clave);
  if (!m || m.abandonada || m.dueno !== ctx.dueno || previo.manija !== ctx.clave) {
    // Otra invocación de run() (el motor reinició la instancia): su stream no se puede leer desde acá.
    soltar(ctx.clave);
    return checkpoint(p, "excepcion", { excepcion: "stream perdido entre tramos: el motor de Workflows reinició la instancia" });
  }
  return leer(ctx, ctx.clave, m, p, Date.now() + ctx.cfg.tramoS * 1000);
}

/**
 * Reintento de un tramo (el motor lo reintenta si el intento anterior murió o venció su timeout):
 * nunca se vuelve a llamar al orquestador. Se abandona el stream viejo si quedó en memoria y el
 * contrato sigue como un stream cortado.
 */
export function interrumpido(clave: string, previo: Checkpoint | null, intento: number): Checkpoint {
  soltar(clave);
  const p: Progreso = { state: previo?.state ?? {}, resultado: previo?.resultado ?? FAIL, eventos: previo?.eventos ?? 0 };
  return checkpoint(p, "excepcion", { excepcion: `stream interrumpido: reintento ${intento} del tramo (el intento anterior no terminó)` });
}

/** Solo pruebas: manijas vivas. */
export const manijasVivas = () => manijas.size;
