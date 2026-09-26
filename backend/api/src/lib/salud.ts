/**
 * Salud de las dependencias externas para GET /admin/operacion y GET /admin/salud: relay residencial
 * (VPS Lima) y los 4 servicios de agentes. Ninguna respuesta espera a un sondeo.
 *
 *   · Se devuelve lo último que se supo (con `consultadoAt`) y, si ya venció (60 s), se vuelve a
 *     sondear en segundo plano (`comprobando: true`). Un solo sondeo en vuelo por dependencia.
 *   · Instancia recién arrancada (sin nada guardado): el pedido que lanza el sondeo espera como mucho
 *     ESPERA_FRIO_MS; si no contestó, sale `ok: null` + `comprobando: true` y el sondeo sigue hasta
 *     llenar la caché. Los pedidos que llegan mientras tanto no esperan.
 *
 * Antes cada GET esperaba el fetch: con el relay caído, 3 s (/operacion) o 4 s (/salud) hasta el abort.
 * En Cloud Run con CPU sólo durante el request, el sondeo de fondo avanza con el siguiente pedido; el
 * panel sondea /operacion cada 60 s, así que el estado se pone al día solo.
 *
 * Instancia pausada: sin CPU, el timer del plazo dispara tarde (al volver la CPU) y ANTES de procesar
 * la respuesta que ya había llegado; antes eso se anotaba como "sin respuesta" (ok: false) sin serlo.
 * Si el timer dispara más de ATRASO_MS tarde se dan GRACIA_MS más para procesar lo que llegó; si aun
 * así se aborta, el sondeo es INCONCLUSO: queda el último veredicto (con su `consultadoAt`) y, si no
 * había ninguno, `ok: null` con `nota: "sin verificar (instancia pausada)"`. El próximo pedido vuelve
 * a sondear.
 */

import { pool } from "./db.js";
import { cabecerasInvocacion } from "./cloudrun-auth.js";
import { Memo } from "./cache.js";
import { EN_WORKERS, enSegundoPlano } from "./plataforma.js";

const TTL_MS = 60_000;
const ESPERA_FRIO_MS = 400;
const ATRASO_MS = 1_000;   // un timer que dispara más tarde que esto = la instancia estuvo sin CPU
const GRACIA_MS = 1_500;   // margen para procesar una respuesta que llegó mientras tanto
const NOTA_PAUSADA = "sin verificar (instancia pausada)";

// ─── Plazo de un sondeo ──────────────────────────────────────────────────────
/**
 * AbortSignal que vence a los `ms`. `pausado()`: la instancia estuvo pausada durante el sondeo — el
 * timer disparó tarde, o ya pasó más de `ms + ATRASO_MS` (según qué procese primero el event loop al
 * volver la CPU, la respuesta puede llegar antes que el timer atrasado). Un abort así no prueba nada y
 * el tiempo medido no es latencia.
 */
function plazo(ms: number) {
  const ctl = new AbortController();
  const t0 = Date.now();
  let tarde = false;
  let t = setTimeout(vencer, ms);
  function vencer() {
    if (!tarde && Date.now() - t0 > ms + ATRASO_MS) {
      tarde = true;
      t = setTimeout(() => ctl.abort(), GRACIA_MS);
      return;
    }
    ctl.abort();
  }
  return { signal: ctl.signal, pausado: () => tarde || Date.now() - t0 > ms + ATRASO_MS, cerrar: () => clearTimeout(t) };
}

// ─── Sondeo genérico con caché ───────────────────────────────────────────────
// `sondear` devuelve null si fue inconcluso (plazo vencido con la instancia pausada).
interface Slot<T> { valor: T | null; at: number; enVuelo: Promise<T | null> | null; nota: string | null }
const slots = new Map<string, Slot<unknown>>();

export interface Sondeado<T> { valor: T | null; consultadoAt: string | null; comprobando: boolean; fresco: boolean; nota: string | null }

function lanzar<T>(slot: Slot<T>, sondear: () => Promise<T | null>): Promise<T | null> {
  if (slot.enVuelo) return slot.enVuelo;
  const p = sondear()
    .then((v) => {
      // Inconcluso: no pisa el último veredicto ni su hora (así el próximo pedido vuelve a sondear).
      if (v === null) { slot.nota = NOTA_PAUSADA; return slot.valor; }
      slot.valor = v; slot.at = Date.now(); slot.nota = null;
      return v;
    })
    .finally(() => { slot.enVuelo = null; });
  p.catch(() => { /* los sondeos no rechazan; por si acaso, que no quede una promesa sin manejar */ });
  slot.enVuelo = p;
  // Workers: el sondeo sigue después de responder (ctx.waitUntil del pedido que lo lanzó).
  enSegundoPlano(p);
  return p;
}

/** Espera `p` como mucho `ms`; `true` si terminó a tiempo. */
function aTiempo(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    p.then(() => { clearTimeout(t); resolve(true); }, () => { clearTimeout(t); resolve(false); });
  });
}

async function sondeo<T>(clave: string, sondear: () => Promise<T | null>): Promise<Sondeado<T>> {
  let slot = slots.get(clave) as Slot<T> | undefined;
  if (!slot) { slot = { valor: null, at: 0, enVuelo: null, nota: null }; slots.set(clave, slot as Slot<unknown>); }
  const hay = slot.at > 0;
  if (hay && Date.now() - slot.at < TTL_MS) {
    return { valor: slot.valor, consultadoAt: new Date(slot.at).toISOString(), comprobando: false, fresco: false, nota: slot.nota };
  }
  const yaEnVuelo = slot.enVuelo !== null;
  const p = lanzar(slot, sondear);
  if (hay) return { valor: slot.valor, consultadoAt: new Date(slot.at).toISOString(), comprobando: true, fresco: false, nota: slot.nota };
  // Frío: nada guardado todavía. Sólo espera el pedido que lanzó el sondeo; los que llegan mientras
  // sigue en vuelo (p. ej. el relay caído tarda 4 s en dar timeout) responden al instante.
  if (!yaEnVuelo && await aTiempo(p, ESPERA_FRIO_MS) && slot.at > 0) {
    return { valor: slot.valor, consultadoAt: new Date(slot.at).toISOString(), comprobando: false, fresco: true, nota: slot.nota };
  }
  return { valor: null, consultadoAt: null, comprobando: true, fresco: false, nota: slot.nota };
}

// ─── Relay residencial (VPS Lima) ────────────────────────────────────────────
// Sin él, el orquestador en GCP no obtiene el OCDS. `ok: null` = sin configurar o todavía comprobando.
export interface SaludRelay {
  url: string | null;
  ok: boolean | null;
  consultadoAt: string | null;
  comprobando: boolean;
  ms: number | null;
  error: string | null;
  nota: string | null;                // "sin verificar (instancia pausada)" si el último sondeo fue inconcluso
}
interface ResultadoRelay { ok: boolean; ms: number | null; error: string | null }

// Cloudflare no deja que un Worker pida una IP directa: responde él mismo 403 ("error code: 1003")
// y, como abajo cualquier status < 500 cuenta como vivo, el relay caído aparecía "En orden".
const IP_LITERAL = /^https?:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/i;

async function sondearRelay(relayUrl: string): Promise<ResultadoRelay | null> {
  if (EN_WORKERS && IP_LITERAL.test(relayUrl)) {
    return { ok: false, ms: null, error: "no se puede comprobar desde Cloudflare: el relay está en una IP sin nombre DNS" };
  }
  const pl = plazo(4000);
  const t0 = Date.now();
  const base = relayUrl.replace(/\/$/, "");
  try {
    const r = await fetch(base + "/health", { signal: pl.signal }).catch(() => fetch(base, { signal: pl.signal }));
    // Sólo importa el status: el cuerpo se descarta para liberar el socket.
    r.body?.cancel().catch(() => {});
    // Con la instancia pausada de por medio, el tiempo medido no es la latencia del relay.
    return { ok: r.ok || r.status < 500, ms: pl.pausado() ? null : Date.now() - t0, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    const abort = (e as Error).name === "AbortError";
    if (abort && pl.pausado()) return null;
    return { ok: false, ms: Date.now() - t0, error: abort ? "sin respuesta en 4 s" : (e as Error).message.slice(0, 120) };
  } finally {
    pl.cerrar();
  }
}

export async function saludRelay(): Promise<SaludRelay> {
  const url = process.env.LOCAL_DOWNLOADER_URL ?? null;
  if (!url) return { url: null, ok: null, consultadoAt: null, comprobando: false, ms: null, error: null, nota: null };
  const s = await sondeo(`relay:${url}`, () => sondearRelay(url));
  return { url, ok: s.valor?.ok ?? null, consultadoAt: s.consultadoAt, comprobando: s.comprobando, ms: s.valor?.ms ?? null, error: s.valor?.error ?? null, nota: s.nota };
}

// ─── Servicios de agentes (uno por perfil) ───────────────────────────────────
const HOST = process.env.AGENT_HOST_SUFFIX ?? "oq3gq6a4ka-uc.a.run.app";
const SERVICIOS: { perfil: "bienes" | "servicios" | "obras" | "otros"; nombre: string; url: string }[] = [
  { perfil: "bienes", nombre: "agent-orchestrator-adk", url: process.env.AGENT_URL_BIENES ?? `https://agent-orchestrator-adk-${HOST}` },
  { perfil: "servicios", nombre: "agente-servicios", url: process.env.AGENT_URL_SERVICIOS ?? `https://agente-servicios-${HOST}` },
  { perfil: "obras", nombre: "agente-obras", url: process.env.AGENT_URL_OBRAS ?? `https://agente-obras-${HOST}` },
  { perfil: "otros", nombre: "agente-otros", url: process.env.AGENT_URL_OTROS ?? `https://agente-otros-${HOST}` },
];

export interface SaludServicio {
  perfil: string; nombre: string; url: string;
  ok: boolean | null;                 // null = sin respuesta todavía (arranque en frío o comprobando)
  status: number | null; ms: number | null;
  detalle: { perfil?: string; tipos_aceptados?: string[]; model?: string; agentes?: string[] } | null;
  error: string | null;
  consultadoAt: string | null;
  comprobando: boolean;
  nota: string | null;                // "sin verificar (instancia pausada)" si el último sondeo fue inconcluso
}
type Resultado = Pick<SaludServicio, "ok" | "status" | "ms" | "detalle" | "error">;

/** GET / del servicio con el ID token de Cloud Run (los servicios de agentes son IAM-only). null = inconcluso. */
async function pedirSalud(url: string, timeoutMs: number): Promise<Resultado | null> {
  const headers = { accept: "application/json", ...(await cabecerasInvocacion(url).catch(() => ({}))) };
  const pl = plazo(timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/", { signal: pl.signal, headers });
    const j = await r.json().catch(() => null) as (Resultado["detalle"] & { ok?: boolean; modelo?: string }) | null;
    return { ok: r.ok && (j?.ok ?? true), status: r.status, ms: pl.pausado() ? null : Date.now() - t0,
      detalle: j ? { perfil: j.perfil, tipos_aceptados: j.tipos_aceptados, model: j.model ?? j.modelo, agentes: j.agentes } : null,
      error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    if ((e as Error).name === "AbortError" && pl.pausado()) return null;
    throw e;
  } finally {
    pl.cerrar();
  }
}

/** 3 s; si no contesta (arranque en frío de Cloud Run, ~8 s), un segundo intento de 20 s. null = inconcluso. */
async function sondearServicio(url: string): Promise<Resultado | null> {
  const t0 = Date.now();
  try {
    return await pedirSalud(url, 3000);
  } catch (e) {
    if ((e as Error).name !== "AbortError") return { ok: false, status: null, ms: Date.now() - t0, detalle: null, error: (e as Error).message.slice(0, 120) };
  }
  const t1 = Date.now();
  try {
    const r = await pedirSalud(url, 20_000);
    if (!r) return null;
    return { ...r, error: r.error ?? "respondió en el 2.º intento (arranque en frío)" };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - t1, detalle: null, error: `sin respuesta en 20 s: ${(e as Error).message.slice(0, 80)}` };
  }
}

export async function saludServicios(): Promise<{ data: SaludServicio[]; consultadoAt: string; cacheado: boolean; comprobando: boolean }> {
  const res = await Promise.all(SERVICIOS.map(async (s) => {
    const r = await sondeo(`servicio:${s.url}`, () => sondearServicio(s.url));
    const v: Resultado = r.valor ?? { ok: null, status: null, ms: null, detalle: null, error: "comprobando: todavía sin respuesta" };
    return { s: { ...s, ...v, consultadoAt: r.consultadoAt, comprobando: r.comprobando, nota: r.nota } as SaludServicio, fresco: r.fresco };
  }));
  const data = res.map((x) => x.s);
  const fechas = data.map((s) => s.consultadoAt).filter((x): x is string => !!x).sort();
  return {
    data,
    consultadoAt: fechas[0] ?? new Date().toISOString(), // el sondeo más viejo de los que se muestran
    cacheado: !res.some((x) => x.fresco),
    comprobando: data.some((s) => s.comprobando),
  };
}

// ─── Ingesta de convocatorias (compartida por /operacion y /salud) ───────────
// Recorre las ~18 k convocatorias (15–28 ms en la base de 1 vCPU); el panel la pide cada minuto.
export interface Ingesta { ultimaIngesta: Date | string | null; ultimas24h: number; total: number; conUbigeo: number }
const ingestaMemo = new Memo<Ingesta>({ nombre: "ingesta", ttlMs: 30_000, staleMs: 60_000 });
export function ingestaConvocatorias(): Promise<Ingesta> {
  return ingestaMemo.obtener("ingesta", async () => (await pool.query<Ingesta>(
    `SELECT max(created_at) AS "ultimaIngesta",
            count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS "ultimas24h",
            count(*)::int AS total, count(ubigeo)::int AS "conUbigeo"
     FROM convocatorias`)).rows[0]);
}
