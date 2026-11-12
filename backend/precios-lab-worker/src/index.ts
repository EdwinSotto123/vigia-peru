/**
 * vigia-precios-lab — laboratorio de exploración de precios (2026-11-12). El usuario: «ármame un laboratorio de
 * explorador de precios, usando GLM 5.3 flash para el agente de precios».
 *
 * Sin dirección pública (workers_dev: false): solo la API de Vigía lo llama, por service binding, desde el panel.
 *
 *   POST /research          {consulta, especificacion?, unidad?, cantidad?, precioReferencia?, referencias?, ocid?, item?,
 *                            web?, autor?} → 202 {id}. La misma entrada el mismo día devuelve la investigación ya hecha
 *                            (idempotencia), salvo que haya fallado.
 *                            `espera` (segundos, fuera de la entrada) atrasa el arranque: contrato entero escalonado.
 *                            `repetir: true` hace otra aunque haya una igual del día.
 *   GET  /jobs?limite=30     las últimas investigaciones (`ocid=` todas las de un contrato, con ítem y resultado)
 *   GET  /jobs/:id           estado, pasos (con su avance) y gasto
 *   GET  /results/:id        ficha, resumen y ofertas con su juicio y su evidencia
 *   GET  /evidencia/:id/:archivo   lo guardado en R2 (lo leído de cada página)
 *   GET  /salud
 *
 * El trabajo pesado corre en un Workflow (flujo.ts); cada dominio se lee como mucho una vez por segundo (turnos.ts).
 */
import { DIRECTORIO } from "./directorio.ts";
import { Investigacion, type Env } from "./flujo.ts";
import type { Entrada } from "./tipos.ts";

export { Investigacion };
export { Turnos } from "./turnos.ts";
export { Lector } from "./lector.ts";

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const corto = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined);
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** La entrada limpia; null si falta la consulta. */
export function limpiarEntrada(b: Record<string, unknown> | null): Entrada | null {
  if (!b) return null;
  const consulta = corto(b.consulta, 300);
  if (!consulta || consulta.length < 3) return null;
  const refs = Array.isArray(b.referencias) ? b.referencias : [];
  return {
    consulta,
    especificacion: typeof b.especificacion === "string" ? b.especificacion.slice(0, 20_000) : undefined,
    unidad: corto(b.unidad, 60),
    cantidad: numero(b.cantidad),
    precioReferencia: numero(b.precioReferencia),
    referencias: refs.slice(0, 10).flatMap((r) => {
      const o = r as Record<string, unknown>;
      const mediana = numero(o.mediana);
      return mediana
        ? [{ fuente: corto(o.fuente, 40) ?? "estado", detalle: corto(o.detalle, 200) ?? "", unidad: corto(o.unidad, 60) ?? null, n: Math.trunc(Number(o.n) || 0),
            p25: numero(o.p25) ?? null, mediana, p75: numero(o.p75) ?? null }]
        : [];
    }),
    ocid: corto(b.ocid, 80),
    item: numero(b.item),
    web: b.web === false ? false : undefined,
    urls: Array.isArray(b.urls)
      ? [...new Set(b.urls.filter((u): u is string => typeof u === "string" && /^https?:\/\/[^\s]{4,500}$/.test(u.trim())).map((u) => u.trim()))].slice(0, 10)
      : undefined,
    autor: corto(b.autor, 120),
  };
}

async function huella(e: Entrada): Promise<string> {
  const { autor: _a, ...resto } = e;
  const dia = new Date().toISOString().slice(0, 10);
  const datos = new TextEncoder().encode(`${dia}|${JSON.stringify(resto)}`);
  const h = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function crear(env: Env, req: Request): Promise<Response> {
  const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const e = limpiarEntrada(cuerpo);
  if (!e) return json({ error: "falta la consulta (3 a 300 caracteres)" }, 400);
  // Fuera de la entrada (y de la huella): solo escalona el arranque.
  const espera = Math.min(900, Math.max(0, Math.trunc(Number(cuerpo?.espera) || 0)));
  const clave = await huella(e);
  const previa = await env.DB.prepare("SELECT id, estado FROM investigacion WHERE clave = ?").bind(clave).first<{ id: string; estado: string }>();
  // `repetir` (contrato entero con «volver a investigar»): la misma entrada, otra investigación (la vieja queda en la lista).
  if (previa && previa.estado !== "error" && cuerpo?.repetir !== true) return json({ id: previa.id, reutilizada: true });
  if (previa) await env.DB.prepare("UPDATE investigacion SET clave = NULL WHERE id = ?").bind(previa.id).run();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO investigacion (id, clave, estado, entrada, consulta, creado) VALUES (?, ?, 'en_cola', ?, ?, ?)")
    .bind(id, clave, JSON.stringify(e), e.consulta, new Date().toISOString()).run();
  await env.INVESTIGACION.create({ id, params: espera ? { id, espera } : { id } });
  return json({ id }, 202);
}

const COSTO = "costo_modelo + costo_web + costo_contenedor";

/** Las últimas investigaciones, o todas las de un contrato (`ocid`), con su resultado en corto. */
async function lista(env: Env, limite: number, ocid: string | null) {
  const r = await env.DB.prepare(
    `SELECT id, estado, paso, consulta, creado, terminado, ${COSTO} AS costo, json_extract(resumen, '$.veredicto') AS veredicto,
            json_extract(resumen, '$.mediana') AS mediana, json_extract(resumen, '$.validas') AS validas,
            json_extract(resumen, '$.p25') AS p25, json_extract(resumen, '$.p75') AS p75, json_extract(resumen, '$.razon') AS razon,
            json_extract(resumen, '$.referencia') AS referencia, json_extract(resumen, '$.caja') AS caja, json_extract(resumen, '$.sinComparar') AS sinComparar, json_extract(ficha, '$.unidad_base') AS unidad,
            json_extract(entrada, '$.ocid') AS ocid, json_extract(entrada, '$.item') AS item, json_extract(entrada, '$.autor') AS autor
       FROM investigacion ${ocid ? "WHERE json_extract(entrada, '$.ocid') = ?" : ""} ORDER BY creado DESC LIMIT ?`,
  ).bind(...(ocid ? [ocid, limite] : [limite])).all();
  const total = await env.DB.prepare(`SELECT count(*) AS n, COALESCE(sum(${COSTO}), 0) AS costo FROM investigacion`).first<{ n: number; costo: number }>();
  return json({ investigaciones: r.results, total });
}

async function detalle(env: Env, id: string) {
  const inv = await env.DB.prepare(
    `SELECT id, estado, paso, consulta, entrada, ficha, resumen, error, creado, terminado, tokens_entrada, tokens_salida, costo_modelo, busquedas_web,
            costo_web, segundos_navegador, segundos_contenedor, costo_contenedor FROM investigacion WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!inv) return json({ error: "no encontrada" }, 404);
  const pasos = await env.DB.prepare("SELECT nombre, estado, detalle, inicio, fin FROM paso WHERE investigacion = ? ORDER BY inicio").bind(id).all();
  let flujo: string | null = null;
  try {
    flujo = (await (await env.INVESTIGACION.get(id)).status()).status;
  } catch {
    flujo = null;
  }
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v ?? null);
  return json({
    ...inv,
    entrada: parse(inv.entrada),
    ficha: parse(inv.ficha),
    resumen: parse(inv.resumen),
    pasos: pasos.results.map((p) => ({ ...p, detalle: typeof p.detalle === "string" && /^[[{]/.test(p.detalle) ? JSON.parse(p.detalle) : p.detalle })),
    flujo,
  });
}

async function resultados(env: Env, id: string) {
  const r = await env.DB.prepare(
    `SELECT n, fuente, tienda, titulo, marca, url, precio, moneda, disponibilidad, extraccion, confirmado, vendedor, similitud, coincidencia,
            unidades, razon, precio_unitario AS precioUnitario, valida, motivo, evidencia
       FROM oferta WHERE investigacion = ? ORDER BY valida DESC, precio_unitario ASC NULLS LAST, similitud DESC`,
  ).bind(id).all();
  return json({ ofertas: r.results.map((o) => ({ ...o, valida: !!o.valida, confirmado: o.confirmado == null ? null : !!o.confirmado })) });
}

async function evidencia(env: Env, id: string, archivo: string) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^(tiendas|buscador-\d{1,2}|web-\d{1,2})\.json$/.test(archivo)) return json({ error: "no encontrada" }, 404);
  const o = await env.EVIDENCIAS.get(`lab/${id}/${archivo}`);
  if (!o) return json({ error: "no encontrada" }, 404);
  return new Response(o.body, { headers: { "content-type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const partes = url.pathname.split("/").filter(Boolean);
    try {
      if (url.pathname === "/salud") return json({ ok: true, directorio: DIRECTORIO.length, navegador: !!env.BROWSER, contenedor: !!env.LECTOR });
      if (url.pathname === "/research" && req.method === "POST") return await crear(env, req);
      if (partes[0] === "jobs" && req.method === "GET") {
        if (partes.length === 1) {
          const ocid = url.searchParams.get("ocid");
          return await lista(env, Math.min(200, Math.max(1, Number(url.searchParams.get("limite")) || 30)), ocid && /^[A-Za-z0-9-]{3,80}$/.test(ocid) ? ocid : null);
        }
        if (partes.length === 2) return await detalle(env, partes[1]);
      }
      if (partes[0] === "results" && partes.length === 2 && req.method === "GET") return await resultados(env, partes[1]);
      if (partes[0] === "evidencia" && partes.length === 3 && req.method === "GET") return await evidencia(env, partes[1], partes[2]);
      return json({ error: "no encontrado" }, 404);
    } catch (e) {
      console.error("vigia-precios-lab", e);
      return json({ error: String((e as Error).message ?? e).slice(0, 200) }, 500);
    }
  },
};
