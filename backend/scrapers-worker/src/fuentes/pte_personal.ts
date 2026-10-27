/**
 * Portal de Transparencia Estándar (transparencia.gob.pe), rubro "Personal" → `planilla_pte` (migración 92): el
 * personal que cada entidad publica cada mes, de todos sus regímenes (CAS, 276, 728, altos funcionarios, Ley Servir…),
 * con nombre, cargo, oficina y lo que cobra. Sin DNI. Los pensionistas (régimen 8) no se cargan.
 *
 * Cómo se baja (sin captcha ni login, responde desde Cloudflare: GET /diagnostico?partes=pte):
 *   1. El id de la entidad en el PTE: su buscador (`buscador/pte_autocomplete.ashx?term=<nombre sin tildes>` → [{id,
 *      nombre}]). Se busca por el nombre de cada entidad que contrata personas (persona_entidad) y se guarda en
 *      `pte_entidad`; lo que no se encuentra se vuelve a buscar a los 60 días.
 *   2. Un mes: POST personal/pte_transparencia_personal.aspx (año, mes, régimen 0 = todos) abre la sesión y luego
 *      GET pte_transparencia_personal_genera.aspx?…&ch_tipo_descarga=2 da el CSV de esa sesión (sin la cookie de la
 *      sesión responde vacío). El CSV trae el RUC de la entidad: si no es el esperado, se carga con el que trae.
 *   3. Cada entidad y mes se borra y se vuelve a cargar en una transacción; si el CSV no cambió (sha256) no se toca.
 *
 * Además del nombre, el directorio del PTE (migración 99): sus listados por poder del Estado traen 2 344 entidades,
 * muchas unidades ejecutoras (UGEL, redes de salud, hospitales) que CONOSCE nombra distinto. Se recorren también: el
 * CSV dice su RUC.
 *
 * Por defecto los dos meses anteriores al actual (las entidades publican con atraso): se bajan siempre (una entidad
 * corrige o completa lo publicado). Con `desde`/`hasta` (AAAA-MM), ese rango, y lo que ya está en la base no se vuelve
 * a bajar (`forzar` sí). Al final: refrescar_planilla() y refrescar_personas_senales() (las órdenes ven la planilla);
 * con `relleno`, nada.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { filasDict, leerCsv } from "../csv.ts";
import { conDb } from "../db.ts";
import { UA, dormir } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, fechaLima } from "./comun.ts";
import { mesesEntre } from "./pnda_visitas.ts";

const FUENTE = "pte_personal";
const BASE = "https://www.transparencia.gob.pe";
const FUENTE_URL = `${BASE}/`;
/** Entidades por paso: cada una son 2 pedidos de ~1 s (el MINSA, con 30 mil personas, ~10 s). */
const POR_PASO = 15;
const BUSQUEDAS_POR_PASO = 60;
const PASO = { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "15 minutes" } as const;
/** Los regímenes que se cargan (8 = pensionistas: no trabajan en la entidad). */
const REGIMENES = new Set([1, 2, 3, 4, 5, 6, 7, 9]);

/** Sin tildes, en mayúsculas y con un espacio entre palabras: así compara el buscador del PTE. */
export const normal = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * El id del PTE para una entidad, entre lo que devuelve su buscador: el de nombre igual; si no hay, el único resultado
 * cuyo nombre contiene al buscado (o al revés) y se le parece en largo. Nada más: un id equivocado cargaría la
 * planilla de otra entidad (igual el CSV trae su RUC y se carga con ese).
 */
export function elegirId(nombre: string, resultados: { id: number; nombre: string }[]): { id: number; nombre: string } | null {
  const n = normal(nombre);
  const igual = resultados.find((r) => normal(r.nombre) === n);
  if (igual) return igual;
  const parecidos = resultados.filter((r) => {
    const m = normal(r.nombre);
    return (m.includes(n) || n.includes(m)) && Math.min(m.length, n.length) / Math.max(m.length, n.length) >= 0.8;
  });
  return parecidos.length === 1 ? parecidos[0] : null;
}

/**
 * Qué buscar, en orden: el nombre entero (sin "SEDE CENTRAL"); si tiene un guion, lo que va después (la unidad
 * ejecutora de un gobierno regional: "… - HOSPITAL REGIONAL DOCENTE DE TRUJILLO"); y, en una municipalidad, lo que va
 * antes (CONOSCE le agrega la capital: "MUNICIPALIDAD PROVINCIAL DE PADRE ABAD - AGUAYTIA").
 */
export function terminosDe(nombre: string): string[] {
  const limpio = nombre.replace(/\s*SEDE CENTRAL\s*$/i, "");
  const t = [normal(limpio)];
  const partes = limpio.split(/\s*-\s*/).filter(Boolean);
  if (partes.length > 1) {
    t.push(normal(partes[partes.length - 1]));
    if (/^MUNICIPALIDAD/i.test(partes[0])) t.push(normal(partes[0]));
  }
  return [...new Set(t)].filter((x) => x.length >= 4);
}

async function buscar(term: string): Promise<{ id: number; nombre: string }[]> {
  const r = await fetch(`${BASE}/buscador/pte_autocomplete.ashx?term=${encodeURIComponent(term)}`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`PTE buscador: HTTP ${r.status}`);
  const d = (await r.json().catch(() => [])) as unknown;
  return Array.isArray(d) ? d.filter((x) => x && typeof x.id === "number" && typeof x.nombre === "string") : [];
}

/** Los listados del directorio del PTE, por poder del Estado (los que enlaza su portada). */
export const PODERES = [1, 2, 3, 4, 5, 7];

/** Un listado del directorio → [{id, nombre}] (el nombre, sin la sigla entre paréntesis del final). */
export function parsearDirectorio(html: string): { id: number; nombre: string }[] {
  const out = new Map<number, string>();
  for (const m of html.matchAll(/id_entidad=(\d+)[^>]*>([^<]{3,200})</g)) {
    const nombre = m[2].replace(/&[a-z]+;|&#\d+;/gi, (x) => ({ "&amp;": "&", "&aacute;": "á", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó",
      "&uacute;": "ú", "&ntilde;": "ñ", "&Aacute;": "Á", "&Eacute;": "É", "&Iacute;": "Í", "&Oacute;": "Ó", "&Uacute;": "Ú", "&Ntilde;": "Ñ" } as Record<string, string>)[x] ?? " ")
      .replace(/\s*\([^()]*\)\s*$/, "").replace(/\s+/g, " ").trim();
    if (nombre) out.set(Number(m[1]), nombre);
  }
  return [...out].map(([id, nombre]) => ({ id, nombre }));
}

/** La cookie de sesión de una respuesta (ASP.NET_SessionId y las del balanceador). */
function cookies(r: Response): string {
  const todas = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [r.headers.get("set-cookie") ?? ""];
  return todas.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

/** El CSV de un mes de una entidad, o null si no publicó nada ese mes. */
export async function bajarMes(idPte: number, anio: number, mes: number): Promise<string | null> {
  const mm = String(mes).padStart(2, "0");
  const post = await fetch(`${BASE}/personal/pte_transparencia_personal.aspx`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ch_tipo_busqueda: "1", id_entidad: String(idPte), id_tema: "31", in_anno_consulta: String(anio), ch_mes_consulta: mm,
      vc_nombre_funcionario: "", vc_dni_funcionario: "", ch_tipo_regimen: "0",
    }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const sesion = cookies(post);
  const html = await post.text();
  if (!post.ok) throw new Error(`PTE personal: HTTP ${post.status}`);
  if (!html.includes("LISTADO DE PERSONAL")) return null;
  const q = new URLSearchParams({
    id_entidad: String(idPte), in_anno_consulta: String(anio), ch_mes_consulta: mm, ch_tipo_regimen: "0",
    vc_dni_funcionario: "", vc_nombre_funcionario: "", ch_tipo_descarga: "2",
  });
  const csv = await fetch(`${BASE}/personal/pte_transparencia_personal_genera.aspx?${q}`, {
    headers: { "User-Agent": UA, Cookie: sesion, Referer: `${BASE}/personal/pte_transparencia_personal.aspx` },
    signal: AbortSignal.timeout(300_000),
  });
  if (!csv.ok) throw new Error(`PTE CSV: HTTP ${csv.status}`);
  const t = (await csv.text()).replace(/^﻿/, "");
  return t.trim() ? t : null;
}

export interface FilaPlanilla {
  id_pte_personal: number;
  entidad_ruc: string;
  anio: number;
  mes: number;
  regimen: number | null;
  paterno: string | null;
  materno: string | null;
  nombres: string | null;
  cargo: string | null;
  dependencia: string | null;
  remuneraciones: number | null;
  honorarios: number | null;
  incentivo: number | null;
  gratificacion: number | null;
  otros: number | null;
  total: number | null;
  observaciones: string | null;
}

// Sin caracteres de control: algunos CSV traen un NUL y Postgres rechaza "\u0000" dentro de un JSON.
const txt = (v: string | null | undefined) => (v == null ? null : v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || null);
const num = (v: string | null | undefined) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return v != null && v.trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** El CSV del PTE → filas, sin pensionistas. */
export function parsearPlanilla(csv: string): FilaPlanilla[] {
  const out: FilaPlanilla[] = [];
  for (const f of filasDict(leerCsv(csv))) {
    const id = Number(f.PK_ID_PERSONAL);
    const ruc = txt(f.VC_PERSONAL_RUC_ENTIDAD);
    const anio = Number(f.IN_PERSONAL_ANNO);
    const mes = Number(f.IN_PERSONAL_MES);
    const regimen = f.VC_PERSONAL_REGIMEN_LABORAL ? Number(f.VC_PERSONAL_REGIMEN_LABORAL) : null;
    if (!Number.isFinite(id) || !ruc || !/^\d{11}$/.test(ruc) || !anio || !mes) continue;
    if (regimen != null && !REGIMENES.has(regimen)) continue;
    out.push({
      id_pte_personal: id, entidad_ruc: ruc, anio, mes, regimen: Number.isFinite(regimen) ? regimen : null,
      paterno: txt(f.VC_PERSONAL_PATERNO), materno: txt(f.VC_PERSONAL_MATERNO), nombres: txt(f.VC_PERSONAL_NOMBRES),
      cargo: txt(f.VC_PERSONAL_CARGO), dependencia: txt(f.VC_PERSONAL_DEPENDENCIA),
      remuneraciones: num(f.MO_PERSONAL_REMUNERACIONES), honorarios: num(f.MO_PERSONAL_HONORARIOS), incentivo: num(f.MO_PERSONAL_INCENTIVO),
      gratificacion: num(f.MO_PERSONAL_GRATIFICACION), otros: num(f.MO_PERSONAL_OTROS_BENEFICIOS), total: num(f.MO_PERSONAL_TOTAL),
      observaciones: txt(f.VC_PERSONAL_OBSERVACIONES),
    });
  }
  return out;
}

const COLS = ["id_pte_personal", "entidad_ruc", "anio", "mes", "regimen", "paterno", "materno", "nombres", "cargo", "dependencia",
  "remuneraciones", "honorarios", "incentivo", "gratificacion", "otros", "total", "observaciones"] as const;
const SQL_INSERT = `
  INSERT INTO planilla_pte (${COLS.join(", ")})
  SELECT ${COLS.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS x (
    id_pte_personal BIGINT, entidad_ruc TEXT, anio SMALLINT, mes SMALLINT, regimen SMALLINT, paterno TEXT, materno TEXT, nombres TEXT,
    cargo TEXT, dependencia TEXT, remuneraciones NUMERIC, honorarios NUMERIC, incentivo NUMERIC, gratificacion NUMERIC, otros NUMERIC,
    total NUMERIC, observaciones TEXT)
  ON CONFLICT (id_pte_personal) DO UPDATE SET ${COLS.filter((c) => c !== "id_pte_personal").map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, cargado_en = now()`;

async function sha256(t: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Los dos meses anteriores al de hoy; con `desde`/`hasta` (AAAA-MM), ese rango (desde 2013, cuando empieza el PTE). */
export function mesesPte(p: Pick<ParamsCorrida, "desde" | "hasta">, hoy: string): [number, number][] {
  const [a, m] = hoy.split("-").map(Number);
  if (!p.desde && !p.hasta) {
    const antes = (k: number): [number, number] => { const t = a * 12 + (m - 1) - k; return [Math.floor(t / 12), (t % 12) + 1]; };
    return [antes(2), antes(1)];
  }
  const leer = (t: string, fin: boolean): [number, number] => { const [x, y] = t.split("-").map(Number); return [x, y || (fin ? 12 : 1)]; };
  return mesesEntre(leer(p.desde ?? p.hasta!, false), leer(p.hasta ?? p.desde!, true));
}

export async function correrPte(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const resumen: Record<string, unknown> = {};

  // 1. Los ids del PTE de las entidades que contratan personas (las nuevas y las no encontradas hace 60 días).
  let buscadas = 0;
  let encontradas = 0;
  for (let vuelta = 0; vuelta < 80; vuelta++) {
    const r = await step.do(`buscar entidades ${vuelta + 1}`, PASO, () => conDb(env.HYPERDRIVE, async (db) => {
      const pendientes = await db.filas<{ ruc: string; nombre: string }>(
        `SELECT e.ruc, e.nombre FROM (SELECT DISTINCT entidad_ruc AS ruc, max(entidad) AS nombre FROM persona_entidad GROUP BY 1) e
          LEFT JOIN pte_entidad t ON t.ruc = e.ruc
          WHERE e.nombre IS NOT NULL AND (t.ruc IS NULL OR (t.id_pte IS NULL AND t.buscado_at < now() - interval '60 days'))
          ORDER BY e.ruc LIMIT ${BUSQUEDAS_POR_PASO}`);
      let ok = 0;
      for (const e of pendientes) {
        let elegido: { id: number; nombre: string } | null = null;
        for (const term of terminosDe(e.nombre)) {
          elegido = elegirId(e.nombre, await buscar(term)) ?? elegirId(term, await buscar(term));
          if (elegido) break;
          await dormir(200);
        }
        if (elegido) ok++;
        if (!p.seco) {
          await db.ejecutar(
            `INSERT INTO pte_entidad (ruc, id_pte, nombre_pte, buscado_at) VALUES ($1, $2, $3, now())
             ON CONFLICT (ruc) DO UPDATE SET id_pte = EXCLUDED.id_pte, nombre_pte = EXCLUDED.nombre_pte, buscado_at = now()`,
            [e.ruc, elegido?.id ?? null, elegido?.nombre ?? null]);
        }
      }
      return { buscadas: pendientes.length, encontradas: ok };
    }));
    buscadas += r.buscadas;
    encontradas += r.encontradas;
    if (r.buscadas < BUSQUEDAS_POR_PASO || p.seco) break;
  }
  resumen.entidades = { buscadas, encontradas };

  // 1b. El directorio del PTE (migración 99): las entidades que no se hallan por nombre.
  resumen.directorio = await step.do("directorio", PASO, async () => {
    const todas = new Map<number, { nombre: string; poder: number }>();
    for (const poder of PODERES) {
      const r = await fetch(`${BASE}/buscador/pte_transparencia_listado_entidades_poder.aspx?Tipo_Pod=${poder}`, {
        headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) continue;
      for (const e of parsearDirectorio(await r.text())) todas.set(e.id, { nombre: e.nombre, poder });
    }
    if (p.seco || !todas.size) return { entidades: todas.size };
    const filas = [...todas].map(([id_pte, e]) => ({ id_pte, nombre: e.nombre, poder: e.poder }));
    await conDb(env.HYPERDRIVE, (db) => db.ejecutar(
      `INSERT INTO pte_directorio (id_pte, nombre, poder, visto_at)
       SELECT id_pte, nombre, poder, now() FROM jsonb_to_recordset($1::jsonb) AS x (id_pte INT, nombre TEXT, poder SMALLINT)
       ON CONFLICT (id_pte) DO UPDATE SET nombre = EXCLUDED.nombre, poder = EXCLUDED.poder, visto_at = now()`, [JSON.stringify(filas)]));
    return { entidades: todas.size };
  });

  // 2. Cada mes, de a POR_PASO entidades: las halladas por nombre y las del directorio, cada id una vez (dos RUC pueden
  //    dar con la misma entidad del PTE; el CSV trae el RUC de la que publica).
  const entidades = await step.do("entidades con id", CARGA, () => conDb(env.HYPERDRIVE, (db) =>
    db.filas<{ ruc: string | null; id_pte: number }>(
      `SELECT DISTINCT ON (id_pte) ruc, id_pte FROM (
         SELECT id_pte, ruc FROM pte_entidad WHERE id_pte IS NOT NULL
         UNION ALL SELECT id_pte, ruc FROM pte_directorio) x
        ORDER BY id_pte, ruc NULLS LAST`)));
  // En un relleno (desde/hasta) no se vuelve a bajar un mes que ya está en la base.
  const relleno = !!(p.desde || p.hasta) && !p.forzar;
  let cargadas = 0;
  for (const [anio, mes] of mesesPte(p, fechaLima())) {
    const clave = `${anio}-${String(mes).padStart(2, "0")}`;
    const r = { conDatos: 0, filas: 0, sinCambios: 0, rucDistinto: 0, errores: 0 };
    for (let i = 0; i < entidades.length; i += POR_PASO) {
      const lote = entidades.slice(i, i + POR_PASO);
      const x = await step.do(`planilla ${clave} ${i / POR_PASO + 1}`, PASO, async () => {
        const out = { conDatos: 0, filas: 0, sinCambios: 0, rucDistinto: 0, errores: 0 };
        const yaEstan = relleno && !p.seco
          ? new Set((await conDb(env.HYPERDRIVE, (db) => db.filas<{ entidad_ruc: string }>(
              `SELECT DISTINCT entidad_ruc FROM planilla_pte WHERE anio = $1 AND mes = $2 AND entidad_ruc = ANY($3::text[])`,
              [anio, mes, lote.map((e) => e.ruc).filter(Boolean)]))).map((x) => x.entidad_ruc))
          : new Set<string>();
        for (const e of lote) {
          if (e.ruc && yaEstan.has(e.ruc)) { out.sinCambios++; continue; }
          let csv: string | null = null;
          try {
            csv = await bajarMes(e.id_pte, anio, mes);
          } catch (err) {
            out.errores++;
            registrar("WARNING", `   PTE ${e.ruc} (${e.id_pte}) ${clave}: ${String((err as Error)?.message ?? err).slice(0, 160)}`, { fuente: FUENTE, instancia: id });
            continue;
          }
          if (!csv) continue;
          const filas = parsearPlanilla(csv);
          if (!filas.length) continue;
          out.conDatos++;
          const ruc = filas[0].entidad_ruc;
          if (e.ruc && ruc !== e.ruc) out.rucDistinto++;
          if (!p.seco && ruc !== e.ruc) {
            await conDb(env.HYPERDRIVE, (db) => db.ejecutar(`UPDATE pte_directorio SET ruc = $2 WHERE id_pte = $1 AND ruc IS DISTINCT FROM $2`, [e.id_pte, ruc]))
              .catch(() => undefined);
          }
          if (p.seco) { out.filas += filas.length; continue; }
          const hash = await sha256(csv);
          const claveCarga = `${ruc}-${clave}`;
          try {
            await conDb(env.HYPERDRIVE, async (db) => {
              if (!p.forzar && (await yaCargado(db, FUENTE, claveCarga, hash))) { out.sinCambios++; return; }
              await db.transaccion(async () => {
                await db.ejecutar(`DELETE FROM planilla_pte WHERE entidad_ruc = $1 AND anio = $2 AND mes = $3`, [ruc, anio, mes]);
                for (let k = 0; k < filas.length; k += 2000) await db.ejecutar(SQL_INSERT, [JSON.stringify(filas.slice(k, k + 2000))]);
                await registrarCarga(db, { fuente: FUENTE, clave: claveCarga, sha256: hash, tabla: "planilla_pte", bytes: csv!.length,
                                           filas: filas.length, fuente_url: FUENTE_URL, descargado_at: new Date().toISOString() });
              });
              out.filas += filas.length;
            });
          } catch (err) {
            // Una entidad con un CSV que la base no acepta no corta la carga de las demás.
            out.errores++;
            registrar("WARNING", `   PTE ${ruc} ${clave}: no se cargó (${String((err as Error)?.message ?? err).slice(0, 160)})`, { fuente: FUENTE, instancia: id });
          }
        }
        return out;
      });
      for (const k of Object.keys(r) as (keyof typeof r)[]) r[k] += x[k];
    }
    registrar("INFO", `   ${clave}: ${r.conDatos} entidades con planilla, ${r.filas} filas (${r.sinCambios} sin cambios)`, { fuente: FUENTE, instancia: id });
    resumen[clave] = r;
    cargadas += r.filas;
  }
  // Con `relleno` (la historia, en tramos que corren a la vez) no se rehace nada: refrescar_planilla() y
  // refrescar_personas_senales(NULL) se corren una vez al terminar, desde la PC (las señales de toda la historia pasan
  // los ~10 min de Hyperdrive).
  if (p.seco || !cargadas || p.relleno) return resumen;

  // 3. Las señales de la planilla y las de las órdenes (que ven la planilla).
  const uno = (nombre: string, sql: string) =>
    step.do(nombre, CARGA, () => conDb(env.HYPERDRIVE, async (db) => Number((await db.filas<{ n: number }>(sql))[0]?.n ?? 0)));
  resumen.planilla = await uno("refrescar_planilla", "SELECT refrescar_planilla() AS n");
  // Las órdenes de los años de la planilla cargada (tambien_planilla, paso_a_planilla) y el resumen.
  const [primerAnio] = mesesPte(p, fechaLima())[0];
  resumen.personas = await uno("refrescar_personas_senales", `SELECT refrescar_personas_senales(make_date(${Number(primerAnio)}, 1, 1)) AS n`);
  // Lo que refrescar_planilla() y refrescar_personas_senales() acaban de borrar: el nepotismo (137) y las señales de
  // aportes y del partido del Presidente (177), que parchan persona_entidad, planilla_persona y su resumen.
  for (const f of ["refrescar_nepotismo_senal", "refrescar_senales_politicas", "refrescar_senales_extra", "refrescar_entidad_senal_politica"]) {
    resumen[f] = await step.do(f, CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS existe", [`${f}()`]);
      return existe ? Number((await db.filas<{ n: number }>(`SELECT ${f}() AS n`))[0]?.n ?? 0) : null;
    }));
  }
  resumen.personas_resumen = await uno("refrescar_personas_resumen", "SELECT refrescar_personas_resumen() AS n");
  return resumen;
}
