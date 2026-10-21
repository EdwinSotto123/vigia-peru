/**
 * ONPE Claridad, gastos de campaña → `onpe_gastos_proveedores` (migración 50): a quién le compró cada
 * organización política en cada proceso electoral (RUC o DNI del proveedor y monto). Sirve para el cruce
 * "proveedor de campaña" y "partido gobernante" (el que le vendió a la campaña gana contratos de la entidad que
 * ese partido gobierna).
 *
 * Endpoint: GET consultaGastoCandidato/consultaProveedor?proceso=<"ERM 2026">&page=<n>&size=100&token=x. Mismo
 * backend que onpe_claridad.ts y mismo bloqueo (Cloudflare por huella): se llama desde la página de Browser
 * Rendering. El `token` es obligatorio pero no se valida. Paginación 0-based (al revés que el padrón de
 * candidatos) y la página se recorta a 100 filas aunque se pidan más.
 *
 * Una tanda de 200 páginas por paso (4 pedidos a la vez desde la página); las respuestas van a R2 y la carga
 * reemplaza el proceso entero en una transacción, si cambió (sha256 de las filas). Semanal (miércoles, con
 * onpe_claridad): los procesos del año en curso. Con `desde`/`hasta` (AAAA), los de esos años (hay desde 2018).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { BUCKET } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { registrar } from "../registro.ts";
import { CARGA, fechaLima, refrescarCasosCruce } from "./comun.ts";
import { PORTAL_URL, conPortal, slug } from "./onpe_claridad.ts";

const FUENTE = "onpe_gastos";
const POR_PAGINA = 100;
const PAGINAS_POR_PASO = 200;
const PASO = { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "30 minutes" } as const;

/** Procesos con gastos de campaña en Claridad (2026-10-14) y su año. */
export const PROCESOS: [proceso: string, anio: number][] = [
  ["ERM 2018", 2018], ["EMC 2019", 2019], ["ECE 2020", 2020], ["EG 2021", 2021], ["ERM 2022", 2022],
  ["EMC 2023", 2023], ["EMC 2024", 2024], ["EG 2026", 2026], ["ERM 2026", 2026],
];

export function procesosPedidos(p: Pick<ParamsCorrida, "desde" | "hasta">, hoy: string): [string, number][] {
  const actual = Number(hoy.slice(0, 4));
  const d = Number((p.desde ?? p.hasta ?? String(actual)).slice(0, 4));
  const h = Number((p.hasta ?? p.desde ?? String(actual)).slice(0, 4));
  return PROCESOS.filter(([, a]) => a >= d && a <= h);
}

export const rutaPagina = (proceso: string, pagina: number) =>
  `consultaGastoCandidato/consultaProveedor?${new URLSearchParams({ proceso, page: String(pagina), size: String(POR_PAGINA), token: "x" })}`;

export interface GastoProveedor {
  proceso: string;
  anio: number;
  id_op: string | null;
  organizacion: string | null;
  documento: string | null;
  tipo_documento: "RUC" | "DNI" | "OTRO";
  proveedor: string | null;
  monto: number | null;
  total_op: number | null;
}

const txt = (v: unknown) => (v == null ? null : String(v).trim() || null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** Una respuesta de consultaProveedor → filas y total de páginas. */
export function parsearPagina(texto: string, proceso: string, anio: number): { filas: GastoProveedor[]; paginas: number } {
  const d = (JSON.parse(texto) as { data?: { content?: Record<string, unknown>[]; totalPages?: number } }).data ?? {};
  const filas = (d.content ?? []).map((c): GastoProveedor => {
    const documento = txt(c.docuEmpresa)?.replace(/\s+/g, "") ?? null;
    return {
      proceso, anio,
      id_op: txt(c.idOp),
      organizacion: txt(c.nombreOP),
      documento,
      tipo_documento: documento && /^\d{11}$/.test(documento) ? "RUC" : documento && /^\d{8}$/.test(documento) ? "DNI" : "OTRO",
      proveedor: txt(c.nomEmpresa),
      monto: num(c.montoGasto),
      total_op: num(c.totalGasto),
    };
  });
  return { filas, paginas: d.totalPages ?? 0 };
}

/** Una fila por (organización, proveedor): las páginas se piden en pasos distintos y pueden repetir filas. */
export function unicas(filas: GastoProveedor[]): GastoProveedor[] {
  const m = new Map<string, GastoProveedor>();
  for (const f of filas) m.set(`${f.id_op}|${f.documento}|${f.proveedor}`, f);
  return [...m.values()].sort((a, b) => `${a.id_op}|${a.documento}`.localeCompare(`${b.id_op}|${b.documento}`));
}

const COLS = ["proceso", "anio", "id_op", "organizacion", "documento", "tipo_documento", "proveedor", "monto", "total_op"] as const;
const campo = (v: unknown) => (v == null ? "" : typeof v === "number" ? String(v) : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const aCsv = (filas: GastoProveedor[]) => filas.map((f) => COLS.map((c) => campo(f[c])).join(",")).join("\n") + (filas.length ? "\n" : "");

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function correrGastos(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const hoy = fechaLima();
  const resumen: Record<string, unknown> = {};
  let cargados = 0;
  for (const [proceso, anio] of procesosPedidos(p, hoy)) {
    const paginas = await step.do(`páginas ${proceso}`, PASO, () => conPortal(env, async (portal) => {
      const [t] = await portal.leerVarias([rutaPagina(proceso, 0)], 1);
      return parsearPagina(t, proceso, anio).paginas;
    }));
    const claves: string[] = [];
    for (let a = 0; a < paginas; a += PAGINAS_POR_PASO) {
      const b = Math.min(paginas, a + PAGINAS_POR_PASO);
      const clave = await step.do(`${proceso} ${a + 1}-${b}`, PASO, () => conPortal(env, async (portal) => {
        const respuestas = await portal.leerVarias(Array.from({ length: b - a }, (_, k) => rutaPagina(proceso, a + k)));
        const k = `raw/${FUENTE}/${slug(proceso)}/${hoy}/paginas-${String(a).padStart(5, "0")}.json`;
        await env.CRUDOS.put(k, JSON.stringify({ proceso, desde: a, endpoint: rutaPagina(proceso, a), respuestas }), {
          httpMetadata: { contentType: "application/json" },
        });
        return k;
      }));
      claves.push(clave);
    }
    resumen[proceso] = await step.do(`cargar ${proceso}`, CARGA, async () => {
      const todas: GastoProveedor[] = [];
      for (const k of claves) {
        const obj = await env.CRUDOS.get(k);
        if (!obj) throw new Error(`falta ${k}`);
        const { respuestas } = (await obj.json()) as { respuestas: string[] };
        for (const t of respuestas) todas.push(...parsearPagina(t, proceso, anio).filas);
      }
      const filas = unicas(todas);
      const csv = aCsv(filas);
      const sha = await sha256(csv);
      const stats = { paginas, filas: filas.length, ruc: filas.filter((f) => f.tipo_documento === "RUC").length };
      if (p.seco) return { ...stats, seco: true };
      return conDb(env.HYPERDRIVE, async (db) => {
        if (!p.forzar && (await yaCargado(db, FUENTE, proceso, sha))) return { ...stats, ya_cargado: true };
        await db.transaccion(async () => {
          await db.ejecutar("DELETE FROM onpe_gastos_proveedores WHERE proceso = $1", [proceso]);
          await db.copiar(`COPY onpe_gastos_proveedores (${COLS.join(", ")}) FROM STDIN WITH (FORMAT csv, NULL '')`, new Blob([csv]).stream());
          await registrarCarga(db, {
            fuente: FUENTE, clave: proceso, tabla: "onpe_gastos_proveedores", archivo: `${slug(proceso)}/${hoy}`,
            gcs_uri: `r2://${BUCKET}/raw/${FUENTE}/${slug(proceso)}/${hoy}/`, sha256: sha, bytes: csv.length, filas: filas.length,
            fuente_url: PORTAL_URL.replace("consulta-aportante", "consulta-gasto"), descargado_at: new Date().toISOString(),
          });
        });
        registrar("INFO", `   ${proceso}: ${filas.length} proveedores × organización (${stats.ruc} con RUC)`, { fuente: FUENTE, instancia: id });
        return { ...stats, cargado: true };
      });
    });
    // Con lo que devolvió el paso (al reanudar, el paso no se vuelve a ejecutar).
    if ((resumen[proceso] as { cargado?: boolean }).cargado) cargados++;
  }
  if (p.seco || !cargados) return resumen;
  resumen.cruces = await step.do("refrescar_cruces", CARGA, () =>
    conDb(env.HYPERDRIVE, (db) => db.filas<{ tipo: string; filas: number }>("SELECT * FROM refrescar_cruces()")));
  // Casos cruzados (migración 57) y lo que los alimenta, en pasos separados (comun.ts). Antes llamaba sólo a
  // refrescar_casos_cruce(): el sobreprecio (que refrescar_cruces() borra y rehace refrescar_precio_item()) quedaba en
  // cero cada miércoles hasta la corrida diaria del OECE.
  await refrescarCasosCruce(env, step);
  return resumen;
}
