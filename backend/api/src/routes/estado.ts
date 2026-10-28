import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";

/**
 * GET /estado/datos — qué tan al día está cada fuente (fase 5 del plan del 2026-10-27): hasta qué fecha llegan sus datos,
 * cuándo fue su última carga buena y si está al día, atrasada, con error o se carga a mano. Lo muestra /fuentes arriba,
 * para que quien lee una cifra sepa hasta cuándo llega. Público: sin parámetros ni mensajes de error internos (el panel
 * admin tiene el detalle en /admin/fuentes).
 */
export const estadoRouter = new Hono();

const CACHE = cachePublico(600, { maxAge: 120, swr: 3600 });
const memo = new Memo<Record<string, unknown>>({ nombre: "estado:datos", ttlMs: 600_000, staleMs: 3_600_000, max: 2 });

interface Fuente {
  clave: string;
  nombre: string;
  que: string;
  /** Cada cuántos días se espera una carga buena (con margen); null = a mano. */
  cada: number | null;
  cadencia: string;
  /** Las corridas del Worker que la cargan (corridas_fuente.fuente). */
  corridas: string[];
  /** Hasta qué fecha llegan sus datos (AAAA-MM-DD). */
  hasta: string;
}

const FUENTES: Fuente[] = [
  { clave: "oece_ocds", nombre: "Contratos del SEACE", que: "Convocatorias y su ganador (OECE, Contrataciones Abiertas).", cada: 3, cadencia: "Diaria", corridas: ["oece_ocds"],
    hasta: `SELECT to_char(max(fecha_convocatoria), 'YYYY-MM-DD') AS v FROM convocatorias WHERE fecha_convocatoria <= current_date` },
  { clave: "conosce", nombre: "Adjudicaciones y postores", que: "Buenas pro, postores y contratos (OECE, CONOSCE).", cada: 10, cadencia: "Semanal", corridas: ["conosce"],
    // Por el índice del año: sin él, recorrer las 325 mil adjudicaciones pasaba el tope de la API y salía vacío.
    hasta: `SELECT to_char(max(fecha_buenapro), 'YYYY-MM-DD') AS v FROM conosce_adjudicaciones WHERE anio >= extract(year FROM current_date)::int - 1 AND fecha_buenapro <= current_date` },
  { clave: "conosce_ordenes", nombre: "Órdenes de compra y de servicio", que: "Cada orden de cada entidad (OECE, CONOSCE).", cada: 10, cadencia: "Semanal", corridas: ["conosce_ordenes"],
    hasta: `SELECT to_char(max(fecha_emision), 'YYYY-MM-DD') AS v FROM conosce_ordenes WHERE fecha_emision <= current_date` },
  { clave: "seace_menores", nombre: "Contratos menores", que: "Contratos de hasta 8 UIT (SEACE).", cada: 10, cadencia: "Semanal", corridas: ["seace_menores"],
    hasta: `SELECT to_char(max(fecha_suscripcion), 'YYYY-MM-DD') AS v FROM seace_menores WHERE fecha_suscripcion <= current_date` },
  { clave: "mef", nombre: "Presupuesto y gasto", que: "Presupuesto (PIM) y gasto (devengado) de cada unidad ejecutora (MEF).", cada: 10, cadencia: "Semanal", corridas: ["mef_presupuesto", "mef_opds_etes"],
    hasta: `SELECT to_char(max(corte), 'YYYY-MM-DD') AS v FROM mef_ejecutora_anual` },
  { clave: "onpe", nombre: "Aportes y candidatos", que: "Aportes a organizaciones políticas y sus candidatos (ONPE, Claridad).", cada: 10, cadencia: "Semanal", corridas: ["onpe_claridad"],
    hasta: `SELECT to_char(max(fecha_aporte), 'YYYY-MM-DD') AS v FROM onpe_aportantes WHERE fecha_aporte <= current_date` },
  { clave: "onpe_gastos", nombre: "Gastos de campaña", que: "A quién le pagaron las campañas (ONPE).", cada: 10, cadencia: "Semanal", corridas: ["onpe_gastos"],
    hasta: `SELECT to_char(max(descargado_at), 'YYYY-MM-DD') AS v FROM onpe_gastos_proveedores` },
  { clave: "sancionados", nombre: "Sanciones del Tribunal", que: "Proveedores inhabilitados y multados (OECE).", cada: 10, cadencia: "Semanal", corridas: ["pnda_sancionados"],
    hasta: `SELECT to_char(max(fecha_resolucion), 'YYYY-MM-DD') AS v FROM osce_sancionados WHERE fecha_resolucion <= current_date` },
  { clave: "jne", nombre: "Autoridades electas", que: "Quién gobierna cada región, provincia y distrito (JNE).", cada: 40, cadencia: "Mensual", corridas: ["jne_infogob"],
    hasta: `SELECT to_char(max(cargado_at), 'YYYY-MM-DD') AS v FROM jne_autoridades` },
  { clave: "dji", nombre: "Declaraciones juradas de intereses", que: "El registro de declarantes (Contraloría) y las DJI leídas con sus familiares.", cada: 40, cadencia: "Mensual", corridas: ["pnda_dji"],
    hasta: `SELECT to_char(max(actualizado), 'YYYY-MM-DD') AS v FROM dji_descargas WHERE estado = 'ok'` },
  { clave: "planilla", nombre: "Planillas del Estado", que: "El personal que cada entidad publica (Portal de Transparencia).", cada: 40, cadencia: "Mensual", corridas: ["pte_personal"],
    hasta: `SELECT to_char((max(mes) + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD') AS v FROM planilla_entidad_mes` },
  { clave: "visitas", nombre: "Registro de visitas", que: "Visitas a entidades (reportes publicados) y al Congreso (su registro, semanal).", cada: 10, cadencia: "Semanal (Congreso)", corridas: ["congreso_visitas", "pnda_visitas"],
    hasta: `SELECT to_char(max(fecha_visita), 'YYYY-MM-DD') AS v FROM visitas_entidades WHERE fecha_visita <= current_date` },
  { clave: "contraloria", nombre: "Informes de control", que: "Informes con responsabilidad de la Contraloría (se cargan desde el Perú: el buscador no responde afuera).", cada: null, cadencia: "Mensual, a mano", corridas: [],
    hasta: `SELECT to_char(max(fecha_emision), 'YYYY-MM-DD') AS v FROM informes_control WHERE fecha_emision <= current_date` },
  { clave: "plazas", nombre: "Plazas CAS", que: "Convocatorias CAS (SERVIR Talento Perú).", cada: null, cadencia: "A mano", corridas: [],
    hasta: `SELECT to_char(max(ultima_vez), 'YYYY-MM-DD') AS v FROM servir_convocatoria` },
  { clave: "obras", nombre: "Obras e inversiones", que: "Obras (INFOBRAS) y proyectos de inversión (Invierte.pe).", cada: null, cadencia: "A mano", corridas: [],
    hasta: `SELECT to_char(max(cargado_at), 'YYYY-MM-DD') AS v FROM inversion_mef` },
];

const uno = (sql: string) => pool.query<{ v: string | null }>(sql).then((r) => r.rows[0]?.v ?? null).catch(() => null);

estadoRouter.get("/datos", async (c) => {
  const cuerpo = await memo.obtener("datos", async () => {
    const corridas = await pool
      .query<{ fuente: string; ok: string | null; estado: string; inicio: string }>(
        `SELECT DISTINCT ON (fuente) fuente, estado, to_char(inicio, 'YYYY-MM-DD') AS inicio,
                (SELECT to_char(max(x.fin), 'YYYY-MM-DD') AS v FROM corridas_fuente x WHERE x.fuente = c.fuente AND x.estado = 'ok') AS ok
           FROM corridas_fuente c ORDER BY fuente, inicio DESC`)
      .then((r) => new Map(r.rows.map((x) => [x.fuente, x])))
      .catch(() => new Map());
    const hoy = Date.now();
    const fuentes = await Promise.all(
      FUENTES.map(async (f) => {
        const hasta = await uno(f.hasta);
        const ultimas = f.corridas.map((k) => corridas.get(k)).filter(Boolean) as { ok: string | null; estado: string; inicio: string }[];
        const ultimaOk = ultimas.map((u) => u.ok).filter(Boolean).sort().pop() ?? null;
        const ultima = ultimas.sort((a, b) => b.inicio.localeCompare(a.inicio))[0] ?? null;
        let estado: "al_dia" | "atrasada" | "error" | "manual" | "fuente_vieja" = "manual";
        if (f.cada != null) {
          const dias = ultimaOk ? (hoy - Date.parse(`${ultimaOk}T12:00:00Z`)) / 86_400_000 : Infinity;
          estado = ultima?.estado === "error" && (!ultimaOk || ultimaOk < ultima.inicio) ? "error" : dias <= f.cada ? "al_dia" : "atrasada";
          // Se carga bien, pero lo que trae es de hace más de tres meses: la fuente dejó de publicar (no es «al día»).
          if (estado === "al_dia" && hasta && (hoy - Date.parse(`${hasta}T12:00:00Z`)) / 86_400_000 > 90) estado = "fuente_vieja";
        }
        return { clave: f.clave, nombre: f.nombre, que: f.que, cadencia: f.cadencia, hasta, ultimaCarga: ultimaOk, estado };
      }),
    );
    return { fuentes, generado: new Date().toISOString() };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
