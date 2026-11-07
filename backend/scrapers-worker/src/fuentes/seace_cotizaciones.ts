/**
 * Contrataciones menores ABIERTAS (≤8 UIT) del SEACE nuevo (prod6) → `seace_cotizacion` (migración 262): lo que un
 * proveedor todavía puede cotizar. Corre cada hora (cron :40, con `documentos`; calendario.ts), por el relay de Zúrich
 * (el WAF de prod6 deja pasar ese colo y no el del Worker; vigia-seace-compras-menores en la memoria del proyecto).
 *
 *   1. El listado de las «Vigente» (todas sus páginas): alta de las nuevas y fecha de visto de todas.
 *   2. Las que eran vigentes y ya no aparecen quedan «Cerrada» (sólo si el listado vino entero: con un corte del WAF a
 *      la mitad no se cierra nada).
 *   3. El detalle de las nuevas (ítems con CUBSO, cantidad, unidad y distrito; área usuaria, tipo de invitación, fin de
 *      las consultas), con tope por corrida. prod6 manda el DNI y el nombre de quien aprueba cada etapa: no se guardan.
 *   4. refrescar_cotizaciones(): la entidad por su nombre y las regiones de los ítems.
 *
 * Las fechas de prod6 son hora de Lima sin zona («06/11/2026 23:50:00»): se guardan con su zona (-05:00).
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { obtener } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA } from "./comun.ts";
import { fechaHora } from "./seace_menores.ts";

const FUENTE = "seace_cotizaciones";
const PROD6 = "https://prod6.seace.gob.pe/v1/s8uit-services";
const POR_PAGINA = 300;
/** 12 000 abiertas a la vez: muy por encima de las ~2 700 de noviembre de 2026. */
const MAX_PAGINAS = 40;
const LOTE_DETALLE = 50;
/** Detalles por corrida: las nuevas de una hora son decenas o cientos; la primera corrida se pone al día en varias. */
const MAX_DETALLE = 600;
const CONCURRENCIA = 3;
const PASO = { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "15 minutes" } as const;

type Json = Record<string, unknown>;
const txt = (v: unknown) => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null);

/** «06/11/2026 23:50:00» (hora de Lima) → «2026-11-06T23:50:00-05:00». */
export function conZona(s: unknown): string | null {
  const f = fechaHora(s);
  return f ? `${f.replace(" ", "T")}-05:00` : null;
}

export interface Cotizacion {
  id_prod6: number;
  codigo: string;
  objeto: string | null;
  descripcion: string | null;
  entidad: string | null;
  estado: string;
  fec_publica: string | null;
  fec_ini_cotizacion: string | null;
  fec_fin_cotizacion: string | null;
}

/** Una fila del buscador de prod6 → registro (null si no trae id ni código). */
export function deListado(x: Json): Cotizacion | null {
  const id = Number(x.idContrato);
  const codigo = txt(x.desContratacion);
  if (!Number.isInteger(id) || id <= 0 || !codigo) return null;
  return {
    id_prod6: id,
    codigo,
    objeto: txt(x.nomObjetoContrato),
    descripcion: txt(x.desObjetoContrato)?.slice(0, 2000) ?? null,
    entidad: txt(x.nomEntidad),
    estado: txt(x.nomEstadoContrato) ?? "Vigente",
    fec_publica: conZona(x.fecPublica),
    fec_ini_cotizacion: conZona(x.fecIniCotizacion),
    fec_fin_cotizacion: conZona(x.fecFinCotizacion),
  };
}

export interface DetalleCotizacion {
  id_entidad: number | null;
  area_usuaria: string | null;
  tipo_invitacion: string | null;
  consultas_hasta: string | null;
  fec_ini_cotizacion: string | null;
  fec_fin_cotizacion: string | null;
  items: { cubso: string | null; nombre: string | null; descripcion: string | null; cantidad: number | null; unidad: string | null; distrito: string | null }[];
  cubso8: string[];
  distritos: string[];
}

/** El detalle de prod6 (`listar-completo`) → lo que se guarda (sin DNI ni nombre de aprobadores). */
export function deDetalle(d: Json): DetalleCotizacion | null {
  const cab = (d.uitContratoCompletoProjection ?? null) as Json | null;
  if (!cab) return null;
  const etapas = (d.uitContratoEtapaProjectionList ?? []) as Json[];
  const etapa = (re: RegExp) => etapas.find((e) => re.test(String(e.nomEtapaContrato ?? "").toUpperCase())) ?? {};
  const consultas = etapa(/CONSULTA/);
  const cotiza = etapa(/COTIZA/);
  const items = ((d.uitContratoItemProjectionList ?? []) as Json[]).map((it) => {
    const cantidad = Number(it.cantidad);
    return {
      cubso: txt(it.codCubso),
      nombre: txt(it.nomCubso),
      descripcion: txt(it.descripcionItem)?.slice(0, 1000) ?? null,
      cantidad: Number.isFinite(cantidad) ? cantidad : null,
      unidad: txt(it.nomUnidadMedida),
      distrito: txt(it.nomDistritoExt ?? it.nomDistrito),
    };
  });
  const unicos = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const idEntidad = Number(cab.idEntidad);
  return {
    id_entidad: Number.isInteger(idEntidad) ? idEntidad : null,
    area_usuaria: txt(cab.nomAreaUsuaria),
    tipo_invitacion: txt(cab.nomTipoInvitacion),
    consultas_hasta: conZona(consultas.fecFin),
    fec_ini_cotizacion: conZona(cotiza.fecIni),
    fec_fin_cotizacion: conZona(cotiza.fecFin),
    items,
    cubso8: unicos(items.map((i) => (i.cubso && /^\d{8}/.test(i.cubso) ? i.cubso.slice(0, 8) : null))),
    distritos: unicos(items.map((i) => i.distrito)),
  };
}

async function pedirJson(env: Env, url: string): Promise<Json | null> {
  const r = await obtener(env, url, { relay: true });
  if (r.status !== 200) {
    await r.body?.cancel();
    return null;
  }
  return (await r.json()) as Json;
}

export async function correrSeaceCotizaciones(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  // La hora de inicio va en un paso: al reanudarse el Workflow tiene que ser la misma.
  const inicio = await step.do("inicio", CARGA, async () => new Date().toISOString());

  const listado = await step.do("listado de vigentes", PASO, async () => {
    let total = 0;
    let vistas = 0;
    let nuevas = 0;
    let paginas = 0;
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const d = await pedirJson(env, `${PROD6}/buscadorpublico/contrataciones/buscador?anio=${new Date().getUTCFullYear()}&lista_estado_contrato=2&page=${pagina}&page_size=${POR_PAGINA}`);
      if (!d) throw new Error(`prod6 no respondió la página ${pagina} del listado`);
      total = Number((d.pageable as Json | undefined)?.totalElements ?? total);
      const filas = ((d.data ?? []) as Json[]).map(deListado).filter((x): x is Cotizacion => !!x);
      paginas++;
      if (!filas.length) break;
      if (!p.seco) {
        nuevas += await conDb(env.HYPERDRIVE, async (db) => {
          const [r] = await db.filas<{ nuevas: number }>(
            `WITH x AS (
               SELECT * FROM jsonb_to_recordset($1::jsonb) AS x (id_prod6 integer, codigo text, objeto text, descripcion text,
                      entidad text, estado text, fec_publica timestamptz, fec_ini_cotizacion timestamptz, fec_fin_cotizacion timestamptz)
             ), u AS (
               INSERT INTO seace_cotizacion (id_prod6, codigo, objeto, descripcion, entidad, estado, fec_publica,
                                             fec_ini_cotizacion, fec_fin_cotizacion, visto_at)
               SELECT id_prod6, codigo, objeto, descripcion, entidad, estado, fec_publica, fec_ini_cotizacion, fec_fin_cotizacion, $2::timestamptz
                 FROM x
               ON CONFLICT (id_prod6) DO UPDATE
                 SET estado = EXCLUDED.estado, descripcion = EXCLUDED.descripcion, fec_publica = EXCLUDED.fec_publica,
                     fec_ini_cotizacion = EXCLUDED.fec_ini_cotizacion, fec_fin_cotizacion = EXCLUDED.fec_fin_cotizacion,
                     visto_at = EXCLUDED.visto_at
               RETURNING (xmax = 0) AS nueva
             )
             SELECT count(*) FILTER (WHERE nueva)::int AS nuevas FROM u`,
            [JSON.stringify(filas), inicio]);
          return r?.nuevas ?? 0;
        });
      }
      vistas += filas.length;
      if (vistas >= total) break;
    }
    return { total, vistas, nuevas, paginas };
  });
  registrar("INFO", `   cotizaciones vigentes: ${listado.vistas} de ${listado.total} (${listado.nuevas} nuevas, ${listado.paginas} páginas)`, { fuente: FUENTE, instancia: id });
  if (p.seco) return listado;

  // Con el listado entero, lo que ya no aparece cerró. Con uno incompleto no se toca nada.
  const cerradas = listado.total > 0 && listado.vistas >= listado.total
    ? await step.do("cerradas", CARGA, () => conDb(env.HYPERDRIVE, (db) => db.ejecutar(
        "UPDATE seace_cotizacion SET estado = 'Cerrada' WHERE estado = 'Vigente' AND visto_at < $1::timestamptz", [inicio])))
    : 0;

  const pendientes = await step.do("sin detalle", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
    (await db.filas<{ id_prod6: number }>(
      `SELECT id_prod6 FROM seace_cotizacion WHERE detalle_at IS NULL AND estado = 'Vigente'
        ORDER BY fec_fin_cotizacion ASC NULLS LAST LIMIT ${MAX_DETALLE}`)).map((r) => r.id_prod6)));

  let conDetalle = 0;
  let fallidos = 0;
  for (let i = 0; i < pendientes.length; i += LOTE_DETALLE) {
    const lote = pendientes.slice(i, i + LOTE_DETALLE);
    const r = await step.do(`detalle ${i + 1}-${i + lote.length}`, PASO, async () => {
      const detalles: (DetalleCotizacion & { id_prod6: number })[] = [];
      let malos = 0;
      for (let k = 0; k < lote.length; k += CONCURRENCIA) {
        const res = await Promise.all(lote.slice(k, k + CONCURRENCIA).map(async (idp) => {
          const d = await pedirJson(env, `${PROD6}/buscadorpublico/contrataciones/listar-completo?id_contrato=${idp}`).catch(() => null);
          const det = d ? deDetalle(d) : null;
          return det ? { ...det, id_prod6: idp } : null;
        }));
        for (const x of res) x ? detalles.push(x) : malos++;
      }
      if (detalles.length) {
        await conDb(env.HYPERDRIVE, (db) => db.ejecutar(
          `UPDATE seace_cotizacion c
              SET id_entidad = x.id_entidad, area_usuaria = x.area_usuaria, tipo_invitacion = x.tipo_invitacion,
                  consultas_hasta = x.consultas_hasta,
                  fec_ini_cotizacion = COALESCE(x.fec_ini_cotizacion, c.fec_ini_cotizacion),
                  fec_fin_cotizacion = COALESCE(x.fec_fin_cotizacion, c.fec_fin_cotizacion),
                  items = x.items, cubso8 = x.cubso8, distritos = x.distritos, departamentos = NULL, detalle_at = now()
             FROM jsonb_to_recordset($1::jsonb) AS x (id_prod6 integer, id_entidad integer, area_usuaria text, tipo_invitacion text,
                  consultas_hasta timestamptz, fec_ini_cotizacion timestamptz, fec_fin_cotizacion timestamptz, items jsonb,
                  cubso8 text[], distritos text[])
            WHERE c.id_prod6 = x.id_prod6`,
          [JSON.stringify(detalles)]));
      }
      return { ok: detalles.length, malos };
    });
    conDetalle += r.ok;
    fallidos += r.malos;
  }

  const refrescadas = await step.do("refrescar_cotizaciones", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
    Number((await db.filas<{ n: number }>("SELECT refrescar_cotizaciones() AS n"))[0]?.n ?? 0)));
  registrar("INFO", `   cotizaciones: ${cerradas} cerradas, ${conDetalle} con detalle (${fallidos} sin respuesta), ${refrescadas} refrescadas`, { fuente: FUENTE, instancia: id });
  return { ...listado, cerradas, detalle: conDetalle, detalle_fallido: fallidos, refrescadas };
}
