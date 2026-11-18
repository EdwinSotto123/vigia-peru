/**
 * Vigía Perú · scrapers en Cloudflare Workers: los pipelines de backend/scrapers (antes Cloud Run Jobs
 * con Cloud Scheduler en GCP). Ver README.md.
 *
 *   crons (wrangler.jsonc)          → las fuentes que tocan ese día (src/calendario.ts), si SCRAPERS_ACTIVO=1
 *   GET  /salud                     → {ok, activo}
 *   POST /correr {fuente, seco?, forzar?, desde?, hasta?}  → una corrida ahora (Bearer SCRAPERS_TOKEN)
 *   GET  /instancias/:id            → estado de una corrida (Bearer SCRAPERS_TOKEN)
 *   GET  /diagnostico[?partes=db,relay,oece,pnda,mef,r2,paso,cgr]   (Bearer SCRAPERS_TOKEN)
 */

import { autorizado } from "./auth.ts";
import { SEGUNDA_VUELTA, esSegundaVuelta, fuentesDelCron } from "./calendario.ts";
import { activo } from "./config.ts";
import type { Env, ParamsCorrida } from "./config.ts";
import { conDb } from "./db.ts";
import { diagnosticar } from "./diagnostico.ts";
import { registrar } from "./registro.ts";
import { FUENTES } from "./workflow.ts";

export { CorrerFuente } from "./workflow.ts";

const json = (datos: unknown, status = 200) =>
  new Response(JSON.stringify(datos, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

/** `oece_ocds-20261014-1105-3f9a`: legible en el panel de Workflows y en los logs. */
function idCorrida(fuente: string): string {
  const t = new Date(Date.now() - 5 * 3600 * 1000).toISOString();   // hora de Lima
  return `${fuente}-${t.slice(0, 10).replaceAll("-", "")}-${t.slice(11, 16).replace(":", "")}-${crypto.randomUUID().slice(0, 4)}`;
}

/**
 * Las corridas que siguen «corriendo» a las 12 h: el Workflow murió sin anotar el final (documentos el 21 y el 27 de
 * octubre, mef_opds_etes el 27). La más larga de verdad (conosce_ordenes, todo un año) tarda ~6 h. Se cierran como error
 * para que el panel no las muestre en curso para siempre. Corre con cada cron (el de documentos es cada hora).
 */
async function cerrarColgadas(env: Env): Promise<void> {
  try {
    const n = await conDb(env.HYPERDRIVE, (db) => db.ejecutar(
      `UPDATE corridas_fuente SET estado = 'error', fin = now(),
              error = 'sin cierre: el Workflow terminó sin anotar el final (se cerró sola a las 12 h)'
        WHERE estado = 'corriendo' AND inicio < now() - interval '12 hours'`));
    if (n) registrar("WARNING", `bitácora: ${n} corridas colgadas cerradas como error`);
  } catch (e) {
    registrar("WARNING", `bitácora: no pude cerrar las colgadas: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }
}

/** Las fuentes diarias cuya última corrida de hoy (hora de Lima) terminó en error: se lanzan otra vez (una vez al día). */
async function segundaVuelta(env: Env): Promise<void> {
  try {
    const fallidas = await conDb(env.HYPERDRIVE, (db) => db.filas<{ fuente: string }>(
      `SELECT fuente FROM (
         SELECT fuente, (array_agg(estado ORDER BY inicio DESC))[1] AS ultima
           FROM corridas_fuente
          WHERE fuente = ANY($1) AND inicio >= (date_trunc('day', now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima')
          GROUP BY fuente) x
        WHERE ultima = 'error'`, [[...SEGUNDA_VUELTA]]));
    for (const { fuente } of fallidas) {
      await lanzar(env, { fuente, origen: "segunda vuelta" }).catch((e) =>
        registrar("ERROR", `segunda vuelta: no pude lanzar ${fuente}: ${String((e as Error)?.message ?? e)}`, { fuente }));
    }
    if (fallidas.length) registrar("WARNING", `segunda vuelta: ${fallidas.map((x) => x.fuente).join(", ")}`);
  } catch (e) {
    registrar("WARNING", `segunda vuelta: no pude revisar la bitácora: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }
}

export async function lanzar(env: Env, p: ParamsCorrida): Promise<string> {
  const inst = await env.CORRER.create({ id: idCorrida(p.fuente), params: p });
  registrar("INFO", `→ corrida ${inst.id}`, { fuente: p.fuente, instancia: inst.id, origen: p.origen });
  return inst.id;
}

async function correr(req: Request, env: Env): Promise<Response> {
  const c = (await req.json().catch(() => null)) as Partial<ParamsCorrida> | null;
  if (!c || typeof c.fuente !== "string" || !Object.hasOwn(FUENTES, c.fuente)) {
    return json({ error: "fuente inválida", fuentes: Object.keys(FUENTES) }, 400);
  }
  const fecha = /^\d{4}(-\d{2}){0,2}$/;   // AAAA (mef), AAAA-MM (visitas) o AAAA-MM-DD (oece)
  for (const k of ["desde", "hasta"] as const) {
    if (c[k] !== undefined && !(typeof c[k] === "string" && fecha.test(c[k]))) return json({ error: `${k} inválida` }, 400);
  }
  if (c.paso !== undefined && !(Number.isInteger(c.paso) && c.paso >= 1 && c.paso <= 9)) return json({ error: "paso inválido" }, 400);
  if (c.entidad !== undefined && !(typeof c.entidad === "string" && /^\d{11}$/.test(c.entidad))) return json({ error: "entidad inválida (RUC de 11 dígitos)" }, 400);
  const id = await lanzar(env, {
    fuente: c.fuente, seco: c.seco === true, forzar: c.forzar === true, desde: c.desde, hasta: c.hasta, paso: c.paso,
    archivo: typeof c.archivo === "string" ? c.archivo : undefined, relleno: c.relleno === true, entidad: c.entidad, origen: "manual",
  });
  return json({ instancia: id });
}

async function atender(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  if (ruta === "/salud" && req.method === "GET") return json({ ok: true, activo: activo(env) });
  const conocida = ruta === "/diagnostico" || ruta === "/correr" || ruta.startsWith("/instancias/");
  if (!conocida) return json({ error: "no encontrado" }, 404);
  if (!(await autorizado(req, env.SCRAPERS_TOKEN))) return json({ error: "no autorizado" }, 401);

  if (ruta === "/diagnostico") {
    const partes = new Set((url.searchParams.get("partes") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    if (partes.has("paso")) {
      const inst = await env.CORRER.create({ params: { fuente: "diagnostico", origen: "manual" } satisfies ParamsCorrida });
      return json({ instancia: inst.id });
    }
    return json(await diagnosticar(env, partes));
  }
  if (ruta === "/correr") {
    if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
    return correr(req, env);
  }
  if (req.method !== "GET") return json({ error: "método no permitido" }, 405);
  const id = decodeURIComponent(ruta.slice("/instancias/".length));
  try {
    const instancia = await env.CORRER.get(id);
    return json({ id, ...(await instancia.status()) });
  } catch (e) {
    return json({ id, error: String((e as Error)?.message ?? e) }, 404);
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return await atender(req, env);
    } catch (e) {
      registrar("ERROR", `pedido falló: ${String((e as Error)?.stack ?? e)}`);
      return json({ error: "interno", detalle: String((e as Error)?.message ?? e) }, 500);
    }
  },

  async scheduled(controlador, env): Promise<void> {
    await cerrarColgadas(env);
    if (esSegundaVuelta(controlador.cron, controlador.scheduledTime) && activo(env)) await segundaVuelta(env);
    const fuentes = fuentesDelCron(controlador.cron, controlador.scheduledTime);
    if (!fuentes.length) return;
    if (!activo(env)) {
      registrar("INFO", `cron ${controlador.cron}: SCRAPERS_ACTIVO≠1, no corre ${fuentes.join(", ")}`);
      return;
    }
    // Una corrida por fuente: si una falla, las demás siguen (como run_all.py).
    for (const fuente of fuentes) {
      await lanzar(env, { fuente, origen: `cron ${controlador.cron}` }).catch((e) =>
        registrar("ERROR", `cron ${controlador.cron}: no pude lanzar ${fuente}: ${String((e as Error)?.message ?? e)}`, { fuente }));
    }
  },
} satisfies ExportedHandler<Env>;
