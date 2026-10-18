/**
 * vigia-precios — precios de referencia propios para el análisis de mercado (bienes).
 *
 *   GET  /salud                                   sin auth: estado de la base y de cada tienda
 *   GET  /tiendas/buscar?q=<término>&n=4          productos con precio de los catálogos de tiendas (caché 7 días)
 *   GET  /combustible?producto=&departamento=&dias=120
 *                                                 precios oficiales de Osinergmin (distribuidores minoristas)
 *   GET  /historial?q=<término>&dias=180          precios vistos antes (canasta semanal + búsquedas)
 *   GET  /mayorista?q=<producto>&dias=30          Gran Mercado Mayorista de Lima (EMMSA): precio por kg por variedad
 *   POST /admin/actualizar?que=combustible|canasta|mayorista[&desde=&hasta=]   corre ya lo que hace el cron
 *
 * Auth: `Authorization: Bearer <PRECIOS_TOKEN>`. Crons: combustible a diario, canasta los lunes.
 * Las tiendas no ofrecen su API a terceros (tiendas.ts): caché, una consulta a la vez por tienda en el cron,
 * User-Agent propio y pausa automática de la tienda que falla.
 */
import { CANASTA } from "./canasta.ts";
import { URL_DATOS, URL_FORMULARIO, URL_PUBLICA, codigosDelFormulario, coincide, cuerpoConsulta, parsearReporte } from "./mayorista.ts";
import { URL_DMIN, decodificar, estadistica, parsearDmin, percentil, productoDeConsulta } from "./combustible.ts";
import {
  type EstadoTienda, type Producto, type Tienda, TIENDAS, USER_AGENT, bloqueada, estadoTrasExito, estadoTrasFallo,
  normalizarTermino, normalizarVtex, urlBusqueda,
} from "./tiendas.ts";

interface Env {
  DB: D1Database;
  PRECIOS_TOKEN?: string;
  TTL_CACHE_DIAS?: string;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const hoy = () => new Date().toISOString().slice(0, 10);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function autorizado(req: Request, env: Env): boolean {
  const dado = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const t = env.PRECIOS_TOKEN ?? "";
  if (!t || dado.length !== t.length) return false;
  let d = 0;
  for (let i = 0; i < t.length; i++) d |= t.charCodeAt(i) ^ dado.charCodeAt(i);
  return d === 0;
}

// ─── tiendas ──────────────────────────────────────────────────────────────────
async function estadoDe(env: Env, tienda: string): Promise<EstadoTienda | null> {
  return (await env.DB.prepare("SELECT errores, bloqueada_hasta FROM estado_tienda WHERE tienda = ?").bind(tienda)
    .first<EstadoTienda>()) ?? null;
}

async function guardarEstado(env: Env, tienda: string, e: EstadoTienda, error: string | null) {
  await env.DB.prepare(
    `INSERT INTO estado_tienda (tienda, errores, bloqueada_hasta, ultimo_error, actualizado) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tienda) DO UPDATE SET errores=excluded.errores, bloqueada_hasta=excluded.bloqueada_hasta,
       ultimo_error=COALESCE(excluded.ultimo_error, estado_tienda.ultimo_error), actualizado=excluded.actualizado`,
  ).bind(tienda, e.errores, e.bloqueada_hasta, error, Date.now()).run();
}

async function guardarObservados(env: Env, termino: string, productos: Producto[], origen: string) {
  if (!productos.length) return;
  const f = hoy();
  const st = env.DB.prepare(
    `INSERT OR REPLACE INTO precio_observado (fecha, termino, tienda, sku, producto, marca, precio, precio_lista, url, origen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await env.DB.batch(productos.map((p) => st.bind(f, termino, p.tienda, p.sku, p.producto, p.marca, p.precio, p.precio_lista, p.url, origen)));
}

type Resultado = { productos: Producto[]; fuente: "cache" | "tienda" | "pausada" | "error"; error?: string };

/** Una tienda, un término: caché (salvo `fresco`) → si la tienda no está en pausa, la consulta. */
async function buscarEnTienda(env: Env, t: Tienda, termino: string, n: number, origen: string, fresco = false): Promise<Resultado> {
  const clave = `${t.id}|${termino}`;
  const ttl = Number(env.TTL_CACHE_DIAS ?? "7") * 86_400_000;
  if (!fresco) {
    const c = await env.DB.prepare("SELECT respuesta, creado FROM cache_busqueda WHERE clave = ?").bind(clave)
      .first<{ respuesta: string; creado: number }>();
    if (c && Date.now() - c.creado < ttl) return { productos: (JSON.parse(c.respuesta) as Producto[]).slice(0, n), fuente: "cache" };
  }
  const ahora = Date.now();
  const est = await estadoDe(env, t.id);
  if (bloqueada(est, ahora)) return { productos: [], fuente: "pausada" };
  try {
    const r = await fetch(urlBusqueda(t, termino, n), {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status >= 400) {
      await guardarEstado(env, t.id, estadoTrasFallo(est, ahora, r.status), `HTTP ${r.status}`);
      return { productos: [], fuente: "error", error: `HTTP ${r.status}` };
    }
    const productos = normalizarVtex(await r.json(), t);
    await env.DB.prepare("INSERT OR REPLACE INTO cache_busqueda (clave, respuesta, creado) VALUES (?, ?, ?)")
      .bind(clave, JSON.stringify(productos), Date.now()).run();
    await guardarObservados(env, termino, productos, origen);
    if (est?.errores) await guardarEstado(env, t.id, estadoTrasExito(), null);
    return { productos, fuente: "tienda" };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 160) ?? "error";
    await guardarEstado(env, t.id, estadoTrasFallo(est, ahora), msg);
    return { productos: [], fuente: "error", error: msg };
  }
}

async function buscar(env: Env, q: string, n: number) {
  const termino = normalizarTermino(q);
  if (!termino) return json({ error: "falta q" }, 400);
  const res = await Promise.all(TIENDAS.map((t) => buscarEnTienda(env, t, termino, n, "busqueda")));
  return json({
    termino,
    productos: res.flatMap((r) => r.productos),
    tiendas: Object.fromEntries(TIENDAS.map((t, i) => [t.id, { fuente: res[i].fuente, n: res[i].productos.length, ...(res[i].error ? { error: res[i].error } : {}) }])),
  });
}

async function historial(env: Env, q: string, dias: number) {
  const termino = normalizarTermino(q);
  const filas = await env.DB.prepare(
    `SELECT fecha, tienda, producto, marca, precio, url, origen FROM precio_observado
      WHERE termino = ? AND fecha >= date('now', ?) ORDER BY fecha DESC LIMIT 500`,
  ).bind(termino, `-${dias} days`).all();
  return json({ termino, dias, observaciones: filas.results });
}

// ─── combustibles ─────────────────────────────────────────────────────────────
async function actualizarCombustible(env: Env) {
  const r = await fetch(URL_DMIN, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`Osinergmin HTTP ${r.status}`);
  const filas = parsearDmin(decodificar(new Uint8Array(await r.arrayBuffer())));
  if (filas.length < 50) throw new Error(`reporte de Osinergmin sospechoso: ${filas.length} filas`);   // no borrar lo bueno por un archivo roto
  const ins = env.DB.prepare(
    `INSERT INTO combustible (fecha, departamento, producto, producto_original, ruc, razon_social, precio_min, precio_max, unidad)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const lotes = [env.DB.prepare("DELETE FROM combustible")];
  for (const f of filas) lotes.push(ins.bind(f.fecha, f.departamento, f.producto, f.producto_original, f.ruc, f.razon_social, f.precio_min, f.precio_max, f.unidad));
  for (let i = 0; i < lotes.length; i += 100) await env.DB.batch(lotes.slice(i, i + 100));
  await env.DB.prepare("INSERT OR REPLACE INTO actualizacion (que, cuando, detalle) VALUES ('combustible', ?, ?)")
    .bind(Date.now(), `${filas.length} filas`).run();
  return { filas: filas.length };
}

async function combustible(env: Env, q: string, departamento: string, dias: number) {
  const producto = productoDeConsulta(q);
  if (!producto) return json({ error: "producto no reconocido", q }, 400);
  const consulta = (depto: string | null) =>
    env.DB.prepare(
      `SELECT fecha, departamento, razon_social, precio_min, precio_max, unidad FROM combustible
        WHERE producto = ? AND fecha >= date('now', ?) ${depto ? "AND departamento = ?" : ""} ORDER BY fecha DESC`,
    ).bind(...(depto ? [producto, `-${dias} days`, depto] : [producto, `-${dias} days`])).all<any>();
  const depto = departamento ? departamento.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim() : null;
  let filas = (await consulta(depto)).results;
  let ambito = depto ? "departamento" : "nacional";
  if (depto && filas.length < 3) {      // pocas declaraciones en el departamento: el nacional como referencia
    filas = (await consulta(null)).results;
    ambito = "nacional";
  }
  const act = await env.DB.prepare("SELECT cuando FROM actualizacion WHERE que = 'combustible'").first<{ cuando: number }>();
  return json({
    producto, departamento: depto, ambito, dias, unidad: "galón",
    estadistica: estadistica(filas),
    observaciones: filas.slice(0, 10),
    fuente: { nombre: "Osinergmin · Registro de Precios de Distribuidores Minoristas", url: URL_DMIN,
              actualizado: act ? new Date(act.cuando).toISOString() : null },
  });
}

// ─── mercado mayorista (EMMSA) ────────────────────────────────────────────────
/** Fecha de Lima (UTC-5) desplazada `dias` días. */
function fechaLima(dias = 0): string {
  return new Date(Date.now() - 5 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Carga las fechas pedidas (idempotente por fecha). Una consulta por fecha, con pausa: no apurar a EMMSA. */
async function actualizarMayorista(env: Env, fechas: string[]) {
  const f = await fetch(URL_FORMULARIO, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!f.ok) throw new Error(`EMMSA formulario HTTP ${f.status}`);
  const codigos = codigosDelFormulario(await f.text());
  if (codigos.productos.length < 10) throw new Error(`EMMSA: formulario sin códigos (${codigos.productos.length})`);
  const ins = env.DB.prepare(
    "INSERT OR REPLACE INTO mayorista (fecha, producto, variedad, precio_min, precio_max, precio_prom) VALUES (?, ?, ?, ?, ?, ?)");
  const resumen: Record<string, number> = {};
  for (const fecha of fechas) {
    const r = await fetch(URL_DATOS, {
      method: "POST", body: cuerpoConsulta(codigos, fecha), signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" },
    });
    const filas = r.ok ? parsearReporte(await r.text()) : [];
    resumen[fecha] = filas.length;
    if (filas.length) {   // un día sin mercado (feriado) no borra nada
      await env.DB.batch([env.DB.prepare("DELETE FROM mayorista WHERE fecha = ?").bind(fecha),
        ...filas.map((x) => ins.bind(fecha, x.producto, x.variedad, x.precio_min, x.precio_max, x.precio_prom))]);
    }
    if (fechas.length > 1) await dormir(1000);
  }
  await env.DB.prepare("INSERT OR REPLACE INTO actualizacion (que, cuando, detalle) VALUES ('mayorista', ?, ?)")
    .bind(Date.now(), JSON.stringify(resumen).slice(0, 500)).run();
  return { fechas: resumen };
}

function rangoFechas(desde: string, hasta: string, max = 120): string[] {
  const out: string[] = [];
  for (let d = new Date(`${desde}T12:00:00Z`); d <= new Date(`${hasta}T12:00:00Z`) && out.length < max; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function mayorista(env: Env, q: string, dias: number) {
  if (!q.trim()) return json({ error: "falta q" }, 400);
  const filas = (await env.DB.prepare(
    "SELECT fecha, producto, variedad, precio_min, precio_max, precio_prom FROM mayorista WHERE fecha >= date('now', ?) ORDER BY fecha DESC",
  ).bind(`-${dias} days`).all<any>()).results.filter((f) => coincide(q, f));
  const grupos = new Map<string, any[]>();
  for (const f of filas) {
    const k = `${f.producto}|${f.variedad}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  const variedades = [...grupos.values()].map((g) => {
    const proms = g.map((x) => x.precio_prom).filter((x: number | null) => x);
    return {
      producto: g[0].producto, variedad: g[0].variedad, unidad: "kg", n_dias: g.length,
      promedio: proms.length ? Math.round((proms.reduce((a: number, b: number) => a + b, 0) / proms.length) * 100) / 100 : null,
      p25: percentil(proms, 0.25), mediana: percentil(proms, 0.5), p75: percentil(proms, 0.75),
      min: Math.min(...g.map((x) => x.precio_min ?? Infinity)), max: Math.max(...g.map((x) => x.precio_max ?? 0)),
      ultimo: { fecha: g[0].fecha, precio_prom: g[0].precio_prom },
    };
  }).sort((a, b) => b.n_dias - a.n_dias);
  return json({ q, dias, variedades, fuente: { nombre: "EMMSA · Gran Mercado Mayorista de Lima, precios diarios", url: URL_PUBLICA } });
}

// ─── canasta semanal ──────────────────────────────────────────────────────────
async function actualizarCanasta(env: Env, max = CANASTA.length) {
  let consultas = 0, productos = 0;
  for (const q of CANASTA.slice(0, max)) {
    const termino = normalizarTermino(q);
    for (const t of TIENDAS) {             // una a la vez y con pausa: el cron no apura a ninguna tienda
      const r = await buscarEnTienda(env, t, termino, 6, "canasta", true);
      consultas++;
      productos += r.productos.length;
      await dormir(800);
    }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO actualizacion (que, cuando, detalle) VALUES ('canasta', ?, ?)")
    .bind(Date.now(), `${consultas} consultas, ${productos} precios`).run();
  return { consultas, productos };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/salud") {
      const tiendas = await env.DB.prepare("SELECT tienda, errores, bloqueada_hasta, ultimo_error FROM estado_tienda").all();
      const act = await env.DB.prepare("SELECT que, cuando, detalle FROM actualizacion").all();
      return json({ ok: true, tiendas: tiendas.results, actualizaciones: act.results });
    }
    if (!autorizado(req, env)) return json({ error: "no autorizado" }, 401);
    const p = url.searchParams;
    if (url.pathname === "/tiendas/buscar" && req.method === "GET") return buscar(env, p.get("q") ?? "", Math.min(Number(p.get("n") ?? 4) || 4, 10));
    if (url.pathname === "/combustible" && req.method === "GET")
      return combustible(env, p.get("producto") ?? "", p.get("departamento") ?? "", Math.min(Number(p.get("dias") ?? 120) || 120, 400));
    if (url.pathname === "/mayorista" && req.method === "GET") return mayorista(env, p.get("q") ?? "", Math.min(Number(p.get("dias") ?? 30) || 30, 730));
    if (url.pathname === "/historial" && req.method === "GET") return historial(env, p.get("q") ?? "", Math.min(Number(p.get("dias") ?? 180) || 180, 1000));
    if (url.pathname === "/admin/actualizar" && req.method === "POST") {
      const que = p.get("que");
      if (que === "combustible") return json(await actualizarCombustible(env));
      if (que === "mayorista") {
        const hasta = p.get("hasta") ?? fechaLima();
        return json(await actualizarMayorista(env, rangoFechas(p.get("desde") ?? hasta, hasta)));
      }
      if (que === "canasta") {
        // Se espera hasta terminar (~3 min con la canasta entera): desde una petición, waitUntil corta a los ~30 s
        // de responder. `max` limita los términos para probar. El cron sí corre en segundo plano (hasta 15 min).
        const max = Number(p.get("max") ?? CANASTA.length) || CANASTA.length;
        return json(await actualizarCanasta(env, max));
      }
      return json({ error: "que=combustible|canasta|mayorista" }, 400);
    }
    return json({ error: "no encontrado" }, 404);
  },

  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (ev.cron === CRON_CANASTA) ctx.waitUntil(actualizarCanasta(env));
    else {
      ctx.waitUntil(actualizarCombustible(env));
      ctx.waitUntil(actualizarMayorista(env, [fechaLima(-1), fechaLima()]));   // ayer y hoy: el reporte de hoy puede salir tarde
    }
  },
};

export const CRON_COMBUSTIBLE = "0 12 * * *";   // 07:00 Lima, a diario
export const CRON_CANASTA = "0 13 * * 1";       // 08:00 Lima, los lunes
