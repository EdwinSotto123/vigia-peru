/**
 * El detalle de cada IPRESS desde la consulta pública por código de RENIPRESS (SUSALUD) → salud_ipress_detalle
 * (migración 432). Diario (calendario.ts), unas 1 200 IPRESS por corrida; a mano con /correr y `paso` = cuántas.
 *
 * Cómo se consulta (la misma página pública «Búsqueda de IPRESS por Código» de gob.pe/susalud, sin cuenta ni captcha,
 * verificado el 2026-11-20): un GET a una página de la aplicación da la cookie de sesión y, con ella, un POST a
 * `ipress.htm?action=cargarIpress` con `idipress` devuelve el JSON que pinta la página (~0,3 s). Se pide de a uno, con una
 * pausa entre pedidos, y por el relay de Lima si el sitio no contesta desde Cloudflare.
 *
 * Qué se guarda (lista blanca, `filaDetalle`): propietario sólo si es RUC 20, categoría y su resolución, servicios (UPSS y
 * UPS), especialidades, cartera de servicios, documentos declarados (licencia municipal, compatibilidad de uso…), camas,
 * ambientes, la situación y su historia, y del responsable de la atención SÓLO su colegio, su número de colegiatura y su
 * RNE. Nunca: nombres, documentos de identidad, correos ni teléfonos de personas (el director médico y el representante
 * legal vienen con nombre y DNI en ese JSON; no salen de esta función).
 *
 * Orden: primero lo que la gente abrió (salud_detalle_pedido), luego lo nunca leído (con sanciones, privadas con
 * internamiento, categorías altas, activas), luego lo más viejo (> 30 días). Un error espera 2^intentos horas.
 * Cada criterio va con IS TRUE: sin categoría o sin sector daba NULL, y en un orden DESC PostgreSQL pone los NULL primero
 * (hasta el 2026-11-21 se leyeron antes las 8 583 sin categoría, muchas inactivas, que las activas).
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb, type Db } from "../db.ts";
import { dormir, pedirLima, UA } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, LECTURA } from "./comun.ts";
import { fecha, limpio, normalizar } from "./susalud.ts";

const FUENTE = "susalud_detalle";
export const BASE_RENIPRESS = "http://app20.susalud.gob.pe:8080/registro-renipress-webapp";
export const URL_CONSULTA = (codigo: string) => `${BASE_RENIPRESS}/ipress.htm?action=mostrarVer&idipress=${codigo}`;
const POR_PASO = 40;
/**
 * SUSALUD limita la frecuencia: con 3 hilos y 250 ms respondió 429 al tercer pedido (2026-11-20). Un hilo, ~1 pedido por
 * segundo, y ante un 429 se espera y se reintenta la misma IPRESS (sin marcarla como error).
 */
const PAUSA_MS = 1200;
const ESPERA_429_MS = [30_000, 60_000, 120_000];

type Json = Record<string, unknown>;
const texto = (v: unknown): string | null => limpio(typeof v === "string" ? v.replace(/<[^>]+>/g, " ") : v);

/** «8549/16605» → «8549/16605»; «030350» → «30350»; «0» o vacío → null. */
export function sinCeros(v: unknown): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const partes = t.split(/[/,;\s]+/).map((p) => p.replace(/^0+/, "")).filter((p) => /^\d+$/.test(p));
  return partes.length ? partes.join("/") : null;
}

export interface FilaDetalle {
  codigo: string; ruc: string | null; razon_social: string | null; propietario_natural: boolean | null; categoria: string | null;
  categoria_documento: string | null; categoria_fecha: string | null; categoria_doc_id: string | null; resolucion_creacion: string | null;
  fecha_registro: string | null; ambientes: number | null; camas: number | null; telefono_emergencia: string | null;
  upss: Json[]; ups: Json[]; upss_suspendidas: Json[]; especialidades: Json[]; cartera: Json[]; documentos: Json[]; consultores: Json[];
  responsable_colegio: string | null; responsable_colegiatura: string | null; responsable_rne: string | null;
  situacion_estado: string | null; situacion_condicion: string | null; historial: Json[];
}

const lista = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);
const num = (v: unknown): number | null => {
  const t = String(v ?? "").trim();
  return /^\d+$/.test(t) && Number(t) < 100_000 ? Number(t) : null;
};

/** El JSON de cargarIpress → la fila (sólo lo de la lista blanca). null si la IPRESS no existe. */
export function filaDetalle(codigo: string, d: Json): FilaDetalle | null {
  const datos = (d.datos ?? null) as Json | null;
  if (!datos) return null;
  const x = (lista(datos.p_crCURSOR_DATOS)[0] ?? {}) as Json;
  const rucCrudo = String(x.PROPIETARIO_RUC ?? "").trim();
  const ruc20 = /^20\d{9}$/.test(rucCrudo);
  const servicio = (u: Json) => ({ codigo: texto(u.CO_CODUPSS ?? u.CODIGO), nombre: texto(u.DE_NOMBRE ?? u.NOMBRE), estado: texto(u.ESTADO) });
  const codNombre = (u: Json) => ({ codigo: texto(String(u.CODIGO ?? "")), nombre: texto(u.NOMBRE) });
  const tipoCat = texto(x.ADICIONAL_CATEGORIA_TIPO);
  const numCat = texto(x.ADICIONAL_CATEGORIA_NUMERO);
  return {
    codigo,
    ruc: ruc20 ? rucCrudo : null,
    razon_social: ruc20 ? texto(x.PROPIETARIO_RAZON_SOCIAL) : null,
    propietario_natural: rucCrudo ? /^10\d{9}$/.test(rucCrudo) : null,
    categoria: texto(x.ADICIONAL_CATEGORIA)?.toUpperCase() ?? null,
    categoria_documento: numCat ? [tipoCat, numCat].filter(Boolean).join(" ") : null,
    categoria_fecha: fecha(x.ADICIONAL_DOC_FECHA),
    categoria_doc_id: texto(x.ADICIONAL_DOCUMENTO_DIGITAL),
    resolucion_creacion: texto(x.ESTABLECIMIENTO_RESOLUCION),
    fecha_registro: fecha(x.ESTABLECIMIENTO_REGISTRO),
    ambientes: num(x.ADICIONAL_NUM_AMBESTAB),
    camas: num(x.CAMAS ?? x.ADICIONAL_NUM_CAMAS),
    // El teléfono de emergencias es del establecimiento (lo publica para el público), no de una persona.
    telefono_emergencia: texto(x.ESTABLECIMIENTO_TEL_EMER),
    upss: lista(datos.p_crCURSOR_UPSS).map(servicio).filter((u) => u.nombre),
    ups: lista(datos.p_crCURSOR_UPS).map(servicio).filter((u) => u.nombre),
    upss_suspendidas: lista(datos.p_crCURSOR_UPSS_SUSPENDIDO).map(servicio).filter((u) => u.nombre),
    especialidades: lista(datos.p_crCURSOR_ESPECIALIDES).map(codNombre).filter((u) => u.nombre && !/^NO APLICA$/i.test(u.nombre)),
    cartera: lista(datos.P_CURSORCARTERA).map(codNombre).filter((u) => u.nombre),
    documentos: lista(datos.p_crCURSOR_DOCUMENTO).map((u) => ({
      tipo: texto(u.DOCUMENTO), numero: texto(u.NUMERO), fecha: fecha(u.FECHA), adjunto: /^S/i.test(String(u.ADJUNTADO ?? "")),
      id: texto(String(u.DESCARGAR ?? "")),
    })).filter((u) => u.tipo),
    consultores: lista(datos.P_CURSORCONSULTOR).map((u) => ({ codigo: texto(String(u.CO_UNICOIPRESS ?? u.CODIGO ?? "")), nombre: texto(u.NOMBRE) })).filter((u) => u.nombre),
    responsable_colegio: texto(x.MEDICO_COLEGIO),
    responsable_colegiatura: sinCeros(x.MEDICO_NUM_COLEGIATURA),
    responsable_rne: sinCeros(x.MEDICO_RNE),
    situacion_estado: texto(x.SITUACION_ESTADO),
    situacion_condicion: texto(x.SITUACION_CONDICION),
    // La historia de estados: sólo sus campos de estado, condición, motivo y fechas.
    historial: lista(datos.p_crCURSOR_HISTORICO).map((h) =>
      Object.fromEntries(Object.entries(h).filter(([k]) => /ESTADO|CONDICION|MOTIVO|FE_|FECHA/i.test(k)).map(([k, v]) => [k.toLowerCase(), texto(v)]))),
  };
}

/** El sitio pidió bajar el ritmo (HTTP 429). */
export class Demasiados extends Error {
  constructor() {
    super("HTTP 429");
  }
}

/** Una sesión con la aplicación de RENIPRESS: directa o por el relay de Lima (con sus cookies). */
export class SesionRenipress {
  private cookie = "";
  private porLima = false;
  private readonly env: Env | null;
  constructor(env: Env | null) {
    this.env = env;
  }

  private async get(url: string): Promise<{ status: number; cookies: Record<string, string> }> {
    if (!this.porLima) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
        await r.body?.cancel();
        const cookies: Record<string, string> = {};
        const sc = (r.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [r.headers.get("set-cookie") ?? ""];
        for (const c of sc) { const m = /^([^=;\s]+)=([^;]*)/.exec(c); if (m) cookies[m[1]] = m[2]; }
        if (r.status < 500) return { status: r.status, cookies };
      } catch (e) {
        if (!this.env?.RELAY_LIMA) throw e;
      }
      if (!this.env?.RELAY_LIMA) throw new Error("RENIPRESS no responde y no hay relay de Lima");
      this.porLima = true;
      registrar("INFO", "   RENIPRESS: directo no responde; por el relay de Lima", { fuente: FUENTE });
    }
    const r = await pedirLima(this.env!, { url, cabeceras: { "User-Agent": UA }, timeoutMs: 60_000 });
    await r.respuesta.body?.cancel();
    return { status: r.origen ?? r.respuesta.status, cookies: r.cookies };
  }

  async abrir(): Promise<void> {
    const r = await this.get(`${BASE_RENIPRESS}/login.htm?action=mostrarLogin`);
    const c = Object.entries(r.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    if (!c) throw new Error(`RENIPRESS no dio cookie de sesión (status ${r.status})`);
    this.cookie = c;
  }

  /** El JSON de una IPRESS; `{ mensaje }` si no existe; lanza si la sesión venció o el sitio falla. */
  async ipress(codigo: string): Promise<Json> {
    if (!this.cookie) await this.abrir();
    const url = `${BASE_RENIPRESS}/ipress.htm?action=cargarIpress`;
    const cabeceras = {
      "User-Agent": UA, Cookie: this.cookie, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: URL_CONSULTA(codigo),
    };
    const cuerpo = `idipress=${encodeURIComponent(codigo)}`;
    let status: number;
    let txt: string;
    if (!this.porLima) {
      const r = await fetch(url, { method: "POST", headers: cabeceras, body: cuerpo, signal: AbortSignal.timeout(30_000) });
      status = r.status;
      txt = await r.text();
    } else {
      const r = await pedirLima(this.env!, { url, metodo: "POST", cabeceras, cuerpo, timeoutMs: 60_000 });
      status = r.origen ?? r.respuesta.status;
      txt = await r.respuesta.text();
    }
    if (status === 401 || /sesion expirada/i.test(txt.slice(0, 200))) {
      this.cookie = "";
      throw new Error("sesión vencida");
    }
    if (status === 429) throw new Demasiados();
    if (status !== 200) throw new Error(`HTTP ${status}`);
    return JSON.parse(txt) as Json;
  }
}

/** Las que tocan, en orden de prioridad. */
export async function pendientes(db: Db, n: number): Promise<string[]> {
  const f = await db.filas<{ codigo: string }>(`
    SELECT i.codigo FROM salud_ipress i
      LEFT JOIN salud_ipress_detalle d ON d.codigo = i.codigo
      LEFT JOIN salud_detalle_pedido p ON p.codigo = i.codigo
      LEFT JOIN salud_indicador x ON x.codigo = i.codigo
     WHERE i.en_registro
       AND (d.proximo_at IS NULL OR d.proximo_at <= now())
       AND (d.leido_at IS NULL OR d.leido_at < now() - interval '30 days' OR (p.pedido_at IS NOT NULL AND p.pedido_at > d.leido_at))
     ORDER BY (p.pedido_at IS NOT NULL AND (d.leido_at IS NULL OR p.pedido_at > d.leido_at)) DESC,
              (d.leido_at IS NULL) DESC,
              (coalesce(x.sanciones, 0) > 0) DESC,
              (i.sector = 'privado' AND i.tipo ILIKE '%CON INTERNAMIENTO%') IS TRUE DESC,
              (i.categoria ~ '^(II|III)') IS TRUE DESC,
              i.activo IS TRUE DESC,
              d.leido_at NULLS FIRST, i.codigo
     LIMIT $1`, [n]);
  return f.map((x) => x.codigo);
}

const CAMPOS = ["codigo", "ruc", "razon_social", "propietario_natural", "categoria", "categoria_documento", "categoria_fecha", "categoria_doc_id",
  "resolucion_creacion", "fecha_registro", "ambientes", "camas", "telefono_emergencia", "upss", "ups", "upss_suspendidas", "especialidades",
  "cartera", "documentos", "consultores", "responsable_colegio", "responsable_colegiatura", "responsable_rne", "situacion_estado",
  "situacion_condicion", "historial"] as const;
const JSONB = new Set(["upss", "ups", "upss_suspendidas", "especialidades", "cartera", "documentos", "consultores", "historial"]);

/** Guarda una fila leída: upsert, la categoría que cambió queda en salud_ipress_cambio, y se borra su pedido. */
export async function guardarDetalle(db: Db, f: FilaDetalle): Promise<void> {
  const vals = CAMPOS.map((c) => (JSONB.has(c) ? JSON.stringify(f[c]) : f[c]));
  const marcas = CAMPOS.map((c, i) => `$${i + 1}${JSONB.has(c) ? "::jsonb" : c.endsWith("_fecha") || c === "fecha_registro" ? "::date" : c === "ambientes" || c === "camas" ? "::int" : c === "propietario_natural" ? "::boolean" : ""}`);
  await db.ejecutar(`
    WITH previo AS (SELECT categoria, situacion_estado FROM salud_ipress_detalle WHERE codigo = $1),
    cambio AS (
      INSERT INTO salud_ipress_cambio (codigo, campo, antes, despues, fuente)
      SELECT $1, v.campo, v.antes, v.despues, 'renipress_detalle' FROM previo p
       CROSS JOIN LATERAL (VALUES ('categoria_detalle', p.categoria, $5::text), ('situacion', p.situacion_estado, $24::text)) v(campo, antes, despues)
       WHERE v.antes IS DISTINCT FROM v.despues AND v.antes IS NOT NULL
    )
    INSERT INTO salud_ipress_detalle (${CAMPOS.join(", ")}, huella, leido_at, intentos, error, proximo_at)
    VALUES (${marcas.join(", ")}, md5(($14::jsonb)::text || ($15::jsonb)::text || ($18::jsonb)::text || ($19::jsonb)::text), now(), 0, NULL, NULL)
    ON CONFLICT (codigo) DO UPDATE SET ${CAMPOS.filter((c) => c !== "codigo").map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
      huella = EXCLUDED.huella, leido_at = now(), intentos = 0, error = NULL, proximo_at = NULL`, vals);
  await db.ejecutar("DELETE FROM salud_detalle_pedido WHERE codigo = $1", [f.codigo]);
}

export async function anotarError(db: Db, codigo: string, error: string, inexistente = false): Promise<void> {
  await db.ejecutar(`
    INSERT INTO salud_ipress_detalle (codigo, intentos, error, proximo_at, leido_at)
    VALUES ($1, 1, $2, now() + interval '2 hours', CASE WHEN $3 THEN now() END)
    ON CONFLICT (codigo) DO UPDATE SET intentos = salud_ipress_detalle.intentos + 1, error = $2,
      proximo_at = now() + make_interval(hours => least(2 ^ (salud_ipress_detalle.intentos + 1), 720)::int),
      leido_at = CASE WHEN $3 THEN now() ELSE salud_ipress_detalle.leido_at END`, [codigo, error.slice(0, 300), inexistente]);
}

/** Lee y guarda una tanda. Devuelve cuántas se leyeron, no existían o fallaron. */
export async function leerTanda(env: Env | null, db: Db, codigos: string[], pausaMs = PAUSA_MS): Promise<Record<string, number>> {
  const s = new SesionRenipress(env);
  const cuenta: Record<string, number> = { leidas: 0, inexistentes: 0, errores: 0 };
  for (const codigo of codigos) {
    try {
      let d: Json | null = null;
      for (let intento = 0; d === null; intento++) {
        try {
          d = await s.ipress(codigo);
        } catch (e) {
          if (e instanceof Demasiados && intento < ESPERA_429_MS.length) {
            cuenta.esperas = (cuenta.esperas ?? 0) + 1;
            await dormir(ESPERA_429_MS[intento]);
          } else if ((e as Error).message === "sesión vencida" && intento === 0) {
            continue;
          } else {
            throw e;
          }
        }
      }
      const fila = filaDetalle(codigo, d);
      if (!fila) {
        cuenta.inexistentes++;
        await anotarError(db, codigo, String(d.mensaje ?? "sin datos").slice(0, 200), /no existe/i.test(String(d.mensaje ?? "")));
      } else {
        await guardarDetalle(db, fila);
        cuenta.leidas++;
      }
    } catch (e) {
      cuenta.errores++;
      await anotarError(db, codigo, (e as Error).message ?? String(e));
      if (e instanceof Demasiados) {
        // Ni esperando dos minutos: se corta la tanda; lo que falta queda para la próxima corrida.
        await anotarError(db, codigo, "HTTP 429");
        break;
      }
      if (cuenta.errores >= 5 && cuenta.leidas === 0) throw new Error(`RENIPRESS no responde: ${(e as Error).message}`);
    }
    await dormir(pausaMs);
  }
  return cuenta;
}

export async function correrSusaludDetalle(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const total = Math.max(1, Math.min(p.paso ?? 1200, 6000));
  const pasos = Math.ceil(total / POR_PASO);
  const suma: Record<string, number> = { leidas: 0, inexistentes: 0, errores: 0 };
  for (let k = 0; k < pasos; k++) {
    const r = await step.do(`detalle ${k + 1}/${pasos}`, { ...CARGA, timeout: "10 minutes" }, () =>
      conDb(env.HYPERDRIVE, async (db) => {
        const codigos = await pendientes(db, POR_PASO);
        if (!codigos.length) return { vacio: 1 };
        return leerTanda(env, db, codigos);
      }));
    for (const [c, v] of Object.entries(r)) suma[c] = (suma[c] ?? 0) + Number(v);
    if ("vacio" in r) break;
  }
  registrar("INFO", `   detalle: ${JSON.stringify(suma)}`, { fuente: FUENTE, instancia: id });
  if (suma.leidas > 0) {
    suma.refrescado = 1;
    await step.do("salud_refrescar", LECTURA, () =>
      conDb(env.HYPERDRIVE, async (db) => (await db.filas<{ r: unknown }>("SELECT salud_refrescar() AS r"))[0]?.r ?? null));
  }
  return suma;
}

export { normalizar };
