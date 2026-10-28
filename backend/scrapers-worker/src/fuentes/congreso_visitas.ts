/**
 * Visitas al Congreso de la República → `visitas_entidades` (fuente 'congreso_visitas'): el port semanal de
 * backend/scripts/cargar_visitas_congreso.py (fase 2.1 del plan del 2026-10-27; el relleno desde 2020 lo hizo el script).
 *
 * El Congreso no usa la plataforma de la PCM (que pide un captcha por consulta y no se automatiza): su registro de
 * transparencia responde una consulta JSON pública por rango de fechas. Un día por paso (~1,200 visitas en un día de
 * sesiones), con pausa; cada día se reemplaza entero (repetirlo no duplica nada). Por defecto, los últimos 14 días (el 93 %
 * se registra el mismo día, casi todo en una semana). Al final, lo que depende de las visitas: el RUC de cada entidad
 * visitada (186), las visitas de familiares de funcionarios y los agregados de la pestaña Visitas (188).
 *
 * Privacidad: nombre y documento de quien visita, y nombre de quien recibe, se guardan para los cruces como en las demás
 * visitas; la API nunca los publica (de quien recibe, sólo cargo y oficina).
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { registrar } from "../registro.ts";
import { CARGA, fechaLima } from "./comun.ts";

const FUENTE = "congreso_visitas";
const URL = "https://wb2server.congreso.gob.pe/regvisitastransparencia/filtrar";
const ENTIDAD = "CONGRESO DE LA REPUBLICA";
const AGENTE = "VigiaPeru/1.0 (transparencia ciudadana; carga semanal con pausas)";
const PUBLICA =
  /\b(MINISTERIO|MUNICIPALIDAD|GOBIERNO REGIONAL|PODER JUDICIAL|MINISTERIO PUBLICO|FISCALIA|CONTRALORIA|DEFENSORIA|UNIVERSIDAD NACIONAL|SUPERINTENDENCIA|PRESIDENCIA DEL CONSEJO|JURADO NACIONAL|OFICINA NACIONAL|REGISTRO NACIONAL|POLICIA NACIONAL|EJERCITO|MARINA DE GUERRA|FUERZA AEREA|PROCURADURIA|TRIBUNAL CONSTITUCIONAL|BANCO CENTRAL|ESSALUD|SEGURO SOCIAL|CONGRESO|PARLAMENTO|EMBAJADA|CONSULADO|PROGRAMA NACIONAL|INSTITUTO NACIONAL|ORGANISMO)\b/;

type Crudo = Record<string, unknown>;

const limpio = (v: unknown) => String(v ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const norma = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/** «27/10/26» o «27/10/2026» → «2026-10-27». */
export function fechaCongreso(v: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(limpio(v));
  if (!m) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${anio}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** «7:04» → «07:04»; null si no es una hora. */
export function horaCongreso(v: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(limpio(v));
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function minutos(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const [ha, ma] = a.split(":").map(Number);
  const [hb, mb] = b.split(":").map(Number);
  const d = hb * 60 + mb - (ha * 60 + ma);
  return d >= 0 ? d : null;
}

function tipoDoc(v: unknown): string | null {
  const t = norma(limpio(v));
  if (!t) return null;
  if (t.startsWith("DNI")) return "DNI";
  if (t.includes("EXTRANJ") || t === "CE") return "CE";
  if (t.startsWith("PASAP")) return "PASAPORTE";
  return t;
}

const COLS = [
  "fecha_registro", "fecha_visita", "entidad_visitada", "entidad_visitada_norm", "visitante", "visitante_norm", "tipo_documento",
  "numero_documento", "tipo_entidad_visitante", "entidad_visitante", "funcionario_nombre", "funcionario_area", "funcionario_cargo",
  "hora_ingreso", "hora_salida", "duracion_min", "motivo", "lugar_especifico", "observacion", "fuente", "periodo", "descargado_at",
] as const;
const CASTS: Record<string, string> = { fecha_registro: "::date", fecha_visita: "::date", hora_ingreso: "::time", hora_salida: "::time", duracion_min: "::int", descargado_at: "::timestamptz" };

/** Una visita del Congreso como fila de visitas_entidades (null si no trae quién visitó). */
export function filaCongreso(x: Crudo, dia: string, ahora: string): Record<(typeof COLS)[number], unknown> | null {
  const visitante = limpio(x.entidadVisitanteNombreCompleto);
  if (!visitante) return null;
  const entidad = limpio(x.entidad) || null;
  const ti = horaCongreso(x.horaIngreso);
  const to = horaCongreso(x.fechaVisitaTermino);
  const fv = fechaCongreso(x.fechaVisitaRecepcion) ?? dia;
  return {
    fecha_registro: fechaCongreso(x.fechaRegistro),
    fecha_visita: fv,
    entidad_visitada: ENTIDAD,
    entidad_visitada_norm: ENTIDAD,
    visitante,
    visitante_norm: norma(visitante.replace(/,/g, " ")).replace(/\s+/g, " "),
    tipo_documento: tipoDoc(x.entidadVisitanteTipoDocumento),
    numero_documento: limpio(x.entidadVisitanteDocumento) || null,
    tipo_entidad_visitante: entidad ? (PUBLICA.test(norma(entidad)) ? "publica" : "privada") : "persona_natural",
    entidad_visitante: entidad,
    funcionario_nombre: norma(limpio(x.empleado)) || null,
    funcionario_area: limpio(x.centroCostoNombre) || null,
    funcionario_cargo: limpio(x.cargo) || null,
    hora_ingreso: ti,
    hora_salida: to,
    duracion_min: minutos(ti, to),
    motivo: limpio(x.motivo) || null,
    lugar_especifico: [limpio(x.edificio), limpio(x.ubicacion)].filter(Boolean).join(", ") || null,
    observacion: limpio(x.observacion) || null,
    fuente: FUENTE,
    periodo: fv.slice(0, 7),
    descargado_at: ahora,
  };
}

function dias(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${desde}T12:00:00Z`); t <= Date.parse(`${hasta}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export async function correrCongresoVisitas(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const hoy = fechaLima();
  const hasta = p.hasta && /^\d{4}-\d{2}-\d{2}$/.test(p.hasta) ? p.hasta : hoy;
  const desde = p.desde && /^\d{4}-\d{2}-\d{2}$/.test(p.desde) ? p.desde : new Date(Date.parse(`${hoy}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const resumen: Record<string, number> = {};
  for (const d of dias(desde, hasta)) {
    // Bajar y escribir en el mismo paso: un día pesa hasta ~1 MB y no conviene guardarlo como resultado del paso.
    resumen[d] = await step.do(`dia ${d}`, CARGA, async () => {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": AGENTE },
        body: JSON.stringify({ fechaDesde: d, fechaHasta: d, visitanteCampo: "", visitanteNombres: "", empleadoCampo: "", empleadoNombres: "", vista: "" }),
      });
      if (!r.ok) throw new Error(`Congreso respondió ${r.status} para ${d}`);
      const datos = (await r.json()) as unknown;
      const ahora = new Date().toISOString();
      const filas = (Array.isArray(datos) ? (datos as Crudo[]) : []).map((x) => filaCongreso(x, d, ahora)).filter((x) => !!x) as Record<string, unknown>[];
      if (p.seco) return filas.length;
      await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
        await db.ejecutar("DELETE FROM visitas_entidades WHERE fuente = $1 AND fecha_visita = $2::date", [FUENTE, d]);
        for (let k = 0; k < filas.length; k += 1000) {
          const vals: unknown[] = [];
          const tuplas = filas.slice(k, k + 1000).map((f) => {
            const b = vals.length;
            vals.push(...COLS.map((c) => f[c]));
            return `(${COLS.map((c, j) => `$${b + j + 1}${CASTS[c] ?? ""}`).join(", ")})`;
          });
          await db.ejecutar(`INSERT INTO visitas_entidades (${COLS.join(", ")}) VALUES ${tuplas.join(", ")}`, vals);
        }
      }));
      // Una pausa entre días: es el servidor del Congreso.
      await new Promise((ok) => setTimeout(ok, 1500));
      return filas.length;
    });
  }
  const total = Object.values(resumen).reduce((a, b) => a + b, 0);
  registrar("INFO", `   congreso_visitas ${desde} → ${hasta}: ${total} visitas`, { fuente: FUENTE, instancia: id });
  if (!p.seco) {
    for (const fn of ["refrescar_visita_entidad_ruc", "refrescar_visita_pariente", "refrescar_visitas_entidad"]) {
      await step.do(fn, CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
        const [{ existe }] = await db.filas<{ existe: boolean }>(`SELECT to_regprocedure('${fn}()') IS NOT NULL AS existe`);
        return existe ? Number((await db.filas<{ n: number }>(`SELECT ${fn}() AS n`))[0]?.n ?? 0) : null;
      }));
    }
  }
  return { desde, hasta, visitas: total, dias: resumen };
}
