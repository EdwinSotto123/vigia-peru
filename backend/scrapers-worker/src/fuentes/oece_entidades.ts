/**
 * Entidades contratantes de la OECE → `entidad_siaf` (migración 150): el port de backend/scripts/cargar_entidades_oece.py,
 * que se corría a mano desde la PC (2026-10-31: pasa al Worker; la fuente no bloquea por región, Atlassian sólo rechaza
 * el User-Agent de Python, y el del Worker es de navegador).
 *
 * El MEF publica el presupuesto por unidad ejecutora (sec_ejec) y sin RUC; la OECE publica, para cada entidad que
 * contrata, su RUC y su CODIGO_SIAF (el sec_ejec escrito con ceros: "0117" = 117). Con eso refrescar_mef_presupuesto()
 * (migración 151) cruza cada ficha con SU unidad ejecutora sin adivinar por el nombre.
 *
 *   RUC|NOMBRE_DE_ENTIDAD|DEPARTAMENTO|PROVINCIA|DISTRITO|CODIGO_SIAF|CODCONSUCODE|ESTADO|ULTIMAACTUALIZACION
 *
 * Igual que el script, en una transacción: CODIGO_SIAF vacío o 930xxx → fuera_siaf; un código que no es una unidad
 * ejecutora del MEF pero sí el número de un pliego cuyo nombre se parece al de la entidad → es_pliego (sec_ejec pasa a la
 * sede del pliego); upsert por RUC que sólo reescribe lo que cambió (lo que deja de venir se queda);
 * corregir_ubigeo_municipal(); registro en datasets_cargas. Después, en otro paso y sólo si algo cambió,
 * refrescar_mef_presupuesto(). Idempotente: con el mismo archivo (mismo sha256) no hace nada. Mensual (calendario.ts).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { decodificarCp1252 } from "../csv.ts";
import { conDb } from "../db.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA } from "./comun.ts";

const FUENTE = "oece_entidades";
const CLAVE = "entidades_contratantes";
export const URL_OECE = "https://osce-gob-pe.atlassian.net/wiki/download/attachments/106889265/entidades_contratantes.csv";
const COLUMNAS = ["RUC", "NOMBRE_DE_ENTIDAD", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "CODIGO_SIAF", "CODCONSUCODE", "ESTADO",
  "ULTIMAACTUALIZACION"];
const CAMPOS = ["ruc", "sec_ejec", "es_pliego", "fuera_siaf", "codigo_siaf", "nombre", "departamento", "provincia", "distrito",
  "codconsucode", "estado", "actualizado"] as const;
const ACTUALIZABLES = CAMPOS.filter((c) => c !== "ruc");
const CASTS: Partial<Record<(typeof CAMPOS)[number], string>> = { sec_ejec: "::int", es_pliego: "::boolean", fuera_siaf: "::boolean", actualizado: "::date" };

export type FilaEntidad = Record<(typeof CAMPOS)[number], string | number | boolean | null>;

const texto = (v: string | undefined) => {
  const t = (v ?? "").replaceAll('\\"', '"').split(/\s+/).filter(Boolean).join(" ");
  return t || null;
};

/** ULTIMAACTUALIZACION viene como dd/mm/aa (como `strptime("%d/%m/%y")`: 00-68 → 2000-2068, 69-99 → 1969-1999). */
export function fechaOece(v: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const [d, mes, aa] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const anio = aa <= 68 ? 2000 + aa : 1900 + aa;
  const f = new Date(Date.UTC(anio, mes - 1, d));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

/** El CSV (UTF-8 con BOM o, si no lo es, Windows-1252 como lo publica la OECE) → filas de entidad_siaf y lo descartado. */
export function leerEntidades(datos: Uint8Array): { filas: FilaEntidad[]; cuenta: Record<string, number> } {
  let contenido: string;
  try {
    contenido = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(datos).replace(/^﻿/, "");
  } catch {
    contenido = decodificarCp1252(datos);
  }
  const lineas = contenido.replace(/\r\n?/g, "\n").split("\n");
  const cabecera = (lineas.shift() ?? "").split("|").map((c) => c.trim().toUpperCase());
  if (COLUMNAS.some((c, i) => cabecera[i] !== c)) throw new Error(`cabecera inesperada: ${cabecera.join("|").slice(0, 200)}`);
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  const porRuc = new Map<string, FilaEntidad>();
  for (const linea of lineas) {
    const partes = linea.split("|");
    if (!partes.some((p) => p.trim())) continue;
    sumar("leidas");
    if (partes.length !== COLUMNAS.length) { sumar("descartadas: columnas"); continue; }
    const f = Object.fromEntries(COLUMNAS.map((c, i) => [c, partes[i]]));
    const ruc = f.RUC.trim();
    if (!/^\d{11}$/.test(ruc)) { sumar("descartadas: RUC"); continue; }
    const cod = (f.CODIGO_SIAF ?? "").trim();
    if (cod && !/^\d+$/.test(cod)) { sumar("descartadas: código"); continue; }
    const n = cod ? Number(cod) : null;
    const fuera = n === null || (n >= 930000 && n <= 930999);   // vacío o 930xxx: no está en el SIAF
    if (porRuc.has(ruc)) sumar("RUC repetidos (queda el último)");
    porRuc.set(ruc, {
      ruc, sec_ejec: fuera ? null : n, es_pliego: false, fuera_siaf: fuera, codigo_siaf: cod || null,
      nombre: texto(f.NOMBRE_DE_ENTIDAD) ?? ruc, departamento: texto(f.DEPARTAMENTO), provincia: texto(f.PROVINCIA),
      distrito: texto(f.DISTRITO), codconsucode: texto(f.CODCONSUCODE), estado: texto(f.ESTADO), actualizado: fechaOece(f.ULTIMAACTUALIZACION),
    });
    sumar(n === null ? "vacío" : fuera ? "930xxx" : "con código");
  }
  return { filas: [...porRuc.values()], cuenta };
}

// Un código que no es una UE del MEF pero sí el número de UN pliego que se llama como la entidad (parecido ≥ 0,6 y 0,1 por
// encima del siguiente pliego con ese número: el 006 es INDECI y es el MINJUS) → es de pliego, y sec_ejec pasa a la sede
// del pliego (su UE de menor código en el último año). Igual que SQL_PLIEGOS de cargar_entidades_oece.py.
const SQL_PLIEGOS = String.raw`
  WITH ult AS (SELECT * FROM mef_ejecutora_anual WHERE anio = (SELECT max(anio) FROM mef_ejecutora_anual)),
  pl AS (SELECT DISTINCT ON (nivel_gobierno, sector, pliego) nivel_gobierno, sector, pliego,
                regexp_replace(regexp_replace(mef_norm(pliego_nombre), '^M ', 'MINISTERIO '), '^U N ', 'UNIVERSIDAD NACIONAL ') AS pn,
                sec_ejec::int AS sede
           FROM ult WHERE pliego ~ '^\s*\d+\s*$'
          ORDER BY nivel_gobierno, sector, pliego, ejecutora, sec_ejec::int),
  cand AS (
    SELECT o.ruc, p.sede, similarity(mef_norm(o.nombre), p.pn) AS s
      FROM _oece o JOIN pl p ON btrim(p.pliego)::int = o.sec_ejec
     WHERE o.sec_ejec IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mef_ejecutora_anual m WHERE m.sec_ejec = o.sec_ejec::text)),
  r AS (SELECT c.*, row_number() OVER w AS puesto, lead(c.s) OVER w AS s2 FROM cand c
         WINDOW w AS (PARTITION BY c.ruc ORDER BY c.s DESC))
  UPDATE _oece o SET es_pliego = true, sec_ejec = r.sede
    FROM r WHERE r.ruc = o.ruc AND r.puesto = 1 AND r.s >= 0.6 AND r.s - coalesce(r.s2, 0) >= 0.1
  RETURNING o.ruc, o.codigo_siaf, r.sede`;

const SQL_UPSERT = `
  INSERT INTO entidad_siaf AS t (${CAMPOS.join(", ")}, cargado)
  SELECT ${CAMPOS.join(", ")}, now() FROM _oece
  ON CONFLICT (ruc) DO UPDATE SET ${ACTUALIZABLES.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, cargado = now()
  WHERE (${ACTUALIZABLES.map((c) => `t.${c}`).join(", ")}) IS DISTINCT FROM (${ACTUALIZABLES.map((c) => `EXCLUDED.${c}`).join(", ")})
  RETURNING (xmax = 0) AS nueva`;

export async function correrOeceEntidades(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  // Siempre se baja (son ~300 KB y Atlassian no da una fecha confiable): sin `modificado`, Almacen.bajar daría por al día
  // la copia vieja para siempre. Lo que evita recargar lo mismo es el sha256 en datasets_cargas.
  const entrada = await step.do("descargar", DESCARGA, () =>
    new Almacen(env, FUENTE).bajar(URL_OECE, { archivo: "entidades_contratantes.csv", forzar: true }));
  const r = await step.do("cargar", CARGA, async () => {
    const { filas, cuenta } = leerEntidades(await new Almacen(env, FUENTE).leer(entrada));
    registrar("INFO", `   ${nombreArchivo(entrada)}: ${filas.length} RUC ${JSON.stringify(cuenta)}`, { fuente: FUENTE, instancia: id });
    if (filas.length < 1000) throw new Error(`sólo ${filas.length} entidades: no parece el registro completo de la OECE`);
    if (p.seco) return { seco: true, ruc: filas.length, ...cuenta };
    return conDb(env.HYPERDRIVE, async (db) => {
      if (!p.forzar && (await yaCargado(db, FUENTE, CLAVE, entrada.sha256))) return { ya_cargado: true };
      return db.transaccion(async () => {
        await db.ejecutar("SET LOCAL lock_timeout = '10s'");
        await db.ejecutar("CREATE TEMP TABLE _oece (LIKE entidad_siaf INCLUDING DEFAULTS) ON COMMIT DROP");
        for (let k = 0; k < filas.length; k += 1000) {
          const vals: unknown[] = [];
          const tuplas = filas.slice(k, k + 1000).map((f) => {
            const b = vals.length;
            vals.push(...CAMPOS.map((c) => f[c]));
            return `(${CAMPOS.map((c, j) => `$${b + j + 1}${CASTS[c] ?? ""}`).join(", ")})`;
          });
          await db.ejecutar(`INSERT INTO _oece (${CAMPOS.join(", ")}) VALUES ${tuplas.join(", ")}`, vals);
        }
        const pliegos = await db.filas(SQL_PLIEGOS);
        const escritas = await db.filas<{ nueva: boolean }>(SQL_UPSERT);
        const [{ n: ausentes }] = await db.filas<{ n: number }>(
          "SELECT count(*)::int AS n FROM entidad_siaf s WHERE NOT EXISTS (SELECT 1 FROM _oece o WHERE o.ruc = s.ruc)");
        const ubigeos = await db.filas("SELECT * FROM corregir_ubigeo_municipal()");
        await db.ejecutar("ANALYZE entidad_siaf");
        await registrarCarga(db, {
          fuente: FUENTE, clave: CLAVE, tabla: "entidad_siaf", archivo: nombreArchivo(entrada), gcs_uri: uri(entrada),
          sha256: entrada.sha256, bytes: entrada.bytes, filas: filas.length, fuente_url: URL_OECE, descargado_at: entrada.downloaded_at,
        });
        const nuevas = escritas.filter((e) => e.nueva).length;
        return { ruc: filas.length, nuevas, cambiadas: escritas.length - nuevas, iguales: filas.length - escritas.length,
          ausentes, de_pliego: pliegos.length, ubigeos_corregidos: ubigeos.length, ...cuenta };
      });
    });
  });
  const cambio = !!r && typeof r === "object" && "nuevas" in r && (r.nuevas + r.cambiadas + r.ubigeos_corregidos > 0);
  if (cambio) {
    // Devuelve (departamentos, entidades con presupuesto): como números, que es lo que un paso puede guardar.
    const mef = await step.do("refrescar_mef_presupuesto", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
      Object.values((await db.filas<Record<string, number>>("SELECT * FROM refrescar_mef_presupuesto()"))[0] ?? {}).map(Number)));
    return { ...r, refrescar_mef_presupuesto: mef };
  }
  return r;
}
