/**
 * Registro de Visitas en Línea (PCM/SEGDI) vía PNDA → `visitas_entidades`: port de
 * backend/scrapers/pnda_visitas/pipeline.py y del parseo de backend/scripts/load_visitas_entidades.py
 * (slugs verificados y el hallazgo del GORE Loreto en sus docstrings). Un XLSX por mes; la carga
 * reemplaza el periodo de esta fuente y `datasets_cargas` evita recargar un mes con el mismo sha256.
 * Las exportaciones manuales del portal de la PCM (`--xlsx`) siguen en Python.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { DatasetInexistente, obtenerDataset, recursosDeDatos, urlDataset } from "../pnda.ts";
import { fechaDmy, fechaYmd, partir, reprFlotante, sinMarcasNfd, strip } from "../py.ts";
import { registrar } from "../registro.ts";
import { leerXlsx } from "../xlsx.ts";
import type { ValorXlsx } from "../xlsx.ts";
import { CARGA, DESCARGA, fechaLima } from "./comun.ts";

const FUENTE = "pnda_visitas";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
// La PNDA alterna "setiembre"/"septiembre" según quien publicó.
const ALIAS_MES: Record<string, string[]> = { setiembre: ["setiembre", "septiembre"] };
const BASES = ["reporte-de-registro-de-visitas-en-linea", "reporte-de-registro-de-visitas"];

/** Slugs posibles para un mes, del más reciente al más antiguo en convención. */
export function slugsCandidatos(anio: number, mes: number): string[] {
  const nombres = ALIAS_MES[MESES[mes - 1]] ?? [MESES[mes - 1]];
  const out: string[] = [];
  for (const base of BASES) for (const m of nombres) out.push(`${base}-${m}-${anio}`);
  for (const base of BASES) for (const m of nombres) out.push(`${base}-${m}`);   // 2025: sin año en el slug
  return out;
}

export function mesesEntre(desde: [number, number], hasta: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let [a, m] = desde; a < hasta[0] || (a === hasta[0] && m <= hasta[1]); m === 12 ? ((a += 1), (m = 1)) : (m += 1)) out.push([a, m]);
  return out;
}

/** Por defecto los últimos 4 meses y el actual; con `desde`/`hasta` (AAAA-MM), ese rango. */
export function mesesPedidos(p: Pick<ParamsCorrida, "desde" | "hasta">, hoy: string): [number, number][] {
  const [ah, mh] = hoy.split("-").map(Number);
  let hasta: [number, number] = [ah, mh];
  if (p.hasta) hasta = p.hasta.split("-").slice(0, 2).map(Number) as [number, number];
  if (p.desde) return mesesEntre(p.desde.split("-").slice(0, 2).map(Number) as [number, number], hasta);
  let m = mh - 4;
  let a = ah;
  while (m < 1) {
    m += 12;
    a -= 1;
  }
  return mesesEntre([a, m], [ah, mh]).filter(([y, mm]) => y < hasta[0] || (y === hasta[0] && mm <= hasta[1]));
}

// ── parse_row (load_visitas_entidades.py) ───────────────────────────────────
/** `str(v)` de Python para un valor de openpyxl. */
function texto(v: ValorXlsx): string {
  if (v === null) return "None";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : reprFlotante(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  if ("fechaHora" in v) return v.fechaHora;
  if ("hora" in v) return v.hora;
  return v.duracion;
}

/** `clean`: None → ""; si no, str(v) con los NBSP como espacio y sin espacios en los bordes. */
export function limpiar(v: ValorXlsx | undefined): string {
  if (v === null || v === undefined) return "";
  return strip(texto(v).replaceAll(" ", " "));
}

const normalizarNombre = (s: string) => strip(sinMarcasNfd(s).toUpperCase());

/** `parse_date`: un datetime → su fecha; si no, DD/MM/AAAA o AAAA-MM-DD. */
export function parsearFecha(v: ValorXlsx | undefined): string | null {
  if (v && typeof v === "object" && "fechaHora" in v) return v.fechaHora.slice(0, 10);
  const s = limpiar(v);
  return s ? (fechaDmy(s) ?? fechaYmd(s)) : null;
}

/** `parse_time`: un time → él mismo; si no, HH:MM o HH:MM:SS (como strptime: 1 o 2 dígitos). */
export function parsearHora(v: ValorXlsx | undefined): string | null {
  if (v && typeof v === "object" && "hora" in v) return v.hora;
  const s = limpiar(v);
  if (!s) return null;
  const m = /^(2[0-3]|[01]\d|\d):([0-5]\d|\d)(?::([0-5]\d|\d))?$/.exec(s);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}:${(m[3] ?? "0").padStart(2, "0")}`;
}

function segundos(h: string): number {
  const [hh, mm, ss] = h.split(":");
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function duracionMinutos(ti: string | null, to: string | null): number | null {
  if (ti === null || to === null) return null;
  let d = segundos(to) - segundos(ti);
  if (d < 0) d += 86_400;
  return Math.floor(d / 60);
}

function parsearDocumento(s: string): [string | null, string | null] {
  if (!s) return [null, null];
  const partes = partir(s);
  if (partes.length >= 2) {
    // split(None, 1): el resto conserva sus espacios internos.
    const primero = partes[0];
    const resto = strip(s.slice(s.indexOf(primero) + primero.length));
    let tipo = primero.toUpperCase();
    if (tipo.startsWith("PASAP")) tipo = "PASAPORTE";
    return [tipo, resto];
  }
  return ["DESCONOCIDO", s];
}

function parsearEntidadVisitante(s: string): [string | null, string | null] {
  if (!s) return [null, null];
  const bajo = s.toLowerCase();
  const tras = () => (s.includes(" - ") ? s.slice(s.indexOf(" - ") + 3) : null);
  if (bajo.startsWith("entidad pública") || bajo.startsWith("entidad publica")) return ["publica", tras()];
  if (bajo.startsWith("entidad privada")) return ["privada", tras()];
  if (bajo.startsWith("persona natural")) return ["persona_natural", null];
  return ["desconocido", s];
}

/** `rsplit(" - ", 2)`: APELLIDOS NOMBRES - AREA - CARGO (el área puede traer su propio guion). */
function parsearFuncionario(s: string): [string | null, string | null, string | null] {
  if (!s) return [null, null, null];
  const partes: string[] = [];
  let resto = s;
  for (let i = 0; i < 2; i++) {
    const k = resto.lastIndexOf(" - ");
    if (k < 0) break;
    partes.unshift(resto.slice(k + 3));
    resto = resto.slice(0, k);
  }
  partes.unshift(resto);
  if (partes.length === 3) return [strip(partes[0]), strip(partes[1]), strip(partes[2])];
  if (partes.length === 2) return [strip(partes[0]), null, strip(partes[1])];
  return [s, null, null];
}

export const COLS = ["fecha_registro", "fecha_visita", "entidad_visitada", "entidad_visitada_norm", "visitante", "visitante_norm",
  "tipo_documento", "numero_documento", "tipo_entidad_visitante", "entidad_visitante", "funcionario_visitado", "funcionario_nombre",
  "funcionario_area", "funcionario_cargo", "hora_ingreso", "hora_salida", "duracion_min", "motivo", "lugar_especifico", "observacion"] as const;
export type Visita = Record<(typeof COLS)[number], string | number | null>;

export function parsearFila(fila: ValorXlsx[]): Visita | null {
  const r = fila.length < 12 ? [...fila, ...new Array(12 - fila.length).fill(null)] : fila;
  const visitante = limpiar(r[3]);
  const entidadVisitada = limpiar(r[2]);
  if (!visitante || !entidadVisitada) return null;
  const [tipoDoc, numDoc] = parsearDocumento(limpiar(r[4]));
  const [tipoEnt, entVis] = parsearEntidadVisitante(limpiar(r[5]));
  const [fNombre, fArea, fCargo] = parsearFuncionario(limpiar(r[6]));
  const ti = parsearHora(r[7]);
  const to = parsearHora(r[8]);
  return {
    fecha_registro: parsearFecha(r[0]),
    fecha_visita: parsearFecha(r[1]),
    entidad_visitada: entidadVisitada,
    entidad_visitada_norm: normalizarNombre(entidadVisitada),
    visitante,
    visitante_norm: normalizarNombre(visitante),
    tipo_documento: tipoDoc,
    numero_documento: numDoc,
    tipo_entidad_visitante: tipoEnt,
    entidad_visitante: entVis,
    funcionario_visitado: limpiar(r[6]) || null,
    funcionario_nombre: fNombre ? normalizarNombre(fNombre) : null,
    funcionario_area: fArea,
    funcionario_cargo: fCargo,
    hora_ingreso: ti,
    hora_salida: to,
    duracion_min: duracionMinutos(ti, to),
    motivo: limpiar(r[9]) || null,
    lugar_especifico: limpiar(r[10]) || null,
    observacion: limpiar(r[11]) || null,
  };
}

/** `parse_xlsx`: salta lo de arriba hasta la cabecera ("Fecha de Registro"); devuelve filas y descartadas. */
export function parsearXlsx(archivo: Uint8Array): { filas: Visita[]; descartadas: number } {
  const filas: Visita[] = [];
  let descartadas = 0;
  let cabecera = false;
  for (const fila of leerXlsx(archivo)) {
    if (!cabecera) {
      if (fila.length && limpiar(fila[0]).toLowerCase().startsWith("fecha de registro")) cabecera = true;
      continue;
    }
    const r = parsearFila(fila);
    if (r === null) descartadas++;
    else filas.push(r);
  }
  return { filas, descartadas };
}

interface Archivo {
  entrada: Entrada;
  periodo: string;
  fuente_url: string;
}

export async function correrVisitas(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const archivos: Archivo[] = [];
  const meses = mesesPedidos(p, fechaLima());
  for (const [a, m] of meses) {
    const periodo = `${a}-${String(m).padStart(2, "0")}`;
    const hallados = await step.do(`buscar ${periodo}`, DESCARGA, async (): Promise<Archivo[]> => {
      for (const slug of slugsCandidatos(a, m)) {
        let ds;
        try {
          ds = await obtenerDataset(env, slug);
        } catch (e) {
          if (e instanceof DatasetInexistente) continue;
          throw e;
        }
        // El slug sin año (2025) debe traer un archivo del año pedido.
        const res = recursosDeDatos(ds, [".xlsx", ".xls", ".csv"]).filter((r) => r.archivo.includes(String(a)) || ds.titulo.includes(String(a)));
        if (!res.length) continue;
        const almacen = new Almacen(env, FUENTE);
        const out: Archivo[] = [];
        for (const r of res) {
          const entrada = await almacen.bajar(r.url, { archivo: r.archivo, modificado: ds.modificado, forzar: p.forzar, subdir: periodo });
          out.push({ entrada, periodo, fuente_url: urlDataset(slug) });
        }
        return out;
      }
      registrar("INFO", `   ${periodo}: no publicado en la PNDA todavía`, { fuente: FUENTE, instancia: id });
      return [];
    });
    archivos.push(...hallados);
  }

  const resumen: Record<string, unknown> = {};
  for (const [i, f] of archivos.entries()) {
    resumen[`${f.periodo} ${nombreArchivo(f.entrada)}`] = await step.do(`cargar ${f.periodo} ${i + 1}`, CARGA, async () => {
      if (!p.seco && !p.forzar) {
        const ya = await conDb(env.HYPERDRIVE, (db) => yaCargado(db, FUENTE, f.periodo, f.entrada.sha256));
        if (ya) {
          registrar("INFO", `   ${f.periodo}: ya cargado con el mismo sha256, se salta`, { fuente: FUENTE, instancia: id });
          return { ya_cargado: true };
        }
      }
      if (!nombreArchivo(f.entrada).toLowerCase().endsWith(".xlsx")) throw new Error(`${nombreArchivo(f.entrada)}: openpyxl solo lee .xlsx`);
      const datos = await new Almacen(env, FUENTE).leer(f.entrada);
      const { filas, descartadas } = parsearXlsx(datos);
      const fechas = filas.map((r) => r.fecha_visita).filter(Boolean).sort() as string[];
      const stats = { filas: filas.length, descartadas, visitas: fechas.length ? `${fechas[0]} → ${fechas[fechas.length - 1]}` : "-" };
      registrar("INFO", `   ${f.periodo} → ${filas.length} filas (${descartadas} descartadas) · visitas ${stats.visitas}`, { fuente: FUENTE, instancia: id });
      if (p.seco) return { ...stats, seco: true };
      const borradas = await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
        // Reemplazo por periodo, solo de esta fuente (las exportaciones manuales del portal PCM conviven con otra `fuente`).
        const n = await db.ejecutar("DELETE FROM visitas_entidades WHERE periodo = $1 AND fuente = $2", [f.periodo, FUENTE]);
        const cols = [...COLS, "fuente", "periodo", "sha256", "descargado_at"];
        const casts: Record<string, string> = {
          fecha_registro: "::date", fecha_visita: "::date", hora_ingreso: "::time", hora_salida: "::time", duracion_min: "::int", descargado_at: "::timestamptz",
        };
        for (let k = 0; k < filas.length; k += 2000) {
          const vals: unknown[] = [];
          const tuplas = filas.slice(k, k + 2000).map((r) => {
            const b = vals.length;
            vals.push(...COLS.map((c) => r[c]), FUENTE, f.periodo, f.entrada.sha256 || null, f.entrada.downloaded_at);
            return `(${cols.map((c, j) => `$${b + j + 1}${casts[c] ?? ""}`).join(", ")})`;
          });
          await db.ejecutar(`INSERT INTO visitas_entidades (${cols.join(", ")}) VALUES ${tuplas.join(", ")}`, vals);
        }
        await registrarCarga(db, {
          fuente: FUENTE, clave: f.periodo, tabla: "visitas_entidades", archivo: nombreArchivo(f.entrada), gcs_uri: uri(f.entrada),
          sha256: f.entrada.sha256 || "sin-sha", bytes: f.entrada.bytes, filas: filas.length, fuente_url: f.fuente_url,
          descargado_at: f.entrada.downloaded_at,
        });
        return n;
      }));
      registrar("INFO", `   → visitas_entidades ${f.periodo}: -${borradas} +${filas.length}`, { fuente: FUENTE, instancia: id });
      return { ...stats, borradas, insertadas: filas.length };
    });
  }
  // Con visitas nuevas: a qué entidad corresponde cada nombre del registro (migración 186; el organigrama cuenta las
  // visitas de cada oficina con ella), si ya existe en la base.
  let entidades: number | null = null;
  if (!p.seco && Object.values(resumen).some((r) => r && typeof r === "object" && "insertadas" in r)) {
    entidades = await step.do("refrescar_visita_entidad_ruc", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure('refrescar_visita_entidad_ruc()') IS NOT NULL AS existe");
      return existe ? Number((await db.filas<{ n: number }>("SELECT refrescar_visita_entidad_ruc() AS n"))[0]?.n ?? 0) : null;
    }));
    // Y las visitas de familiares declarados de sus funcionarios, con los nombres recién reconocidos (migración 188).
    await step.do("refrescar_visita_pariente", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure('refrescar_visita_pariente()') IS NOT NULL AS existe");
      return existe ? Number((await db.filas<{ n: number }>("SELECT refrescar_visita_pariente() AS n"))[0]?.n ?? 0) : null;
    }));
  }
  return { meses: meses.map(([a, m]) => `${a}-${String(m).padStart(2, "0")}`), archivos: resumen, visita_entidad_ruc: entidades };
}
