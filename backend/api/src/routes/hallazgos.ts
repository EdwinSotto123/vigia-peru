/**
 * Hallazgos por entidad comparados con sus pares (migración 256; la lógica pura en lib/hallazgos.ts). Para el MCP de
 * Gobserva y el chat del panel: «¿qué es lo más raro de la Municipalidad de Ate?» se contesta comparando, no adivinando.
 *
 *   GET /entidades/:ruc/hallazgos
 *       → { entidad: {ruc, nombre}, grupo: {clave, nombre}, banda: {tercio, nombre} | null, pares, pares_por,
 *           periodo: {desde, hasta}, hallazgos: [Metrica], metricas: [Metrica], nota, fuentes, calculado }
 *       Metrica = { clave, titulo, valor, unidad, mediana_pares, p90_pares, p10_pares, percentil, veces_mediana,
 *                   direccion, hallazgo, tipo, pares_con_dato, numerador, denominador, base, explicacion,
 *                   profundizar: {herramienta, argumentos} }
 *   GET /hallazgos/ranking?metrica=&grupo=&region=&banda=&orden=&limite=
 *       → las entidades de un grupo (y región o tercio) con la cifra más alta (o más baja), con su percentil y la mediana
 *         del grupo. metrica y grupo de listas cerradas: 400 con las opciones si no.
 *
 * Todo sale de una sola lectura de entidad_metricas (~3,2 mil filas) y de los conceptos ya calculados, guardada 30 min:
 * los percentiles se calculan aquí. Las entidades son públicas; las personas naturales sólo se cuentan (nunca un nombre
 * ni un RUC 10). Igual todo sale por publicar().
 */
import { Hono, type Context } from "hono";
import { esErrorPg, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import {
  BANDAS, ErrorHallazgos, GRUPOS, definiciones, evaluar, paresDe, ranking, seleccionarHallazgos, terminosDe, validarRanking,
  type Categoria, type FilaMetricas,
} from "../lib/hallazgos.js";
import { regionDe } from "./datos.js";

export const hallazgosRouter = new Hono();

const CACHE = cachePublico(1800, { maxAge: 300, swr: 3600 });

interface Tabla {
  filas: FilaMetricas[];
  porRuc: Map<string, FilaMetricas>;
  categorias: Categoria[];
  calculado: string | null;
  anioCompleto: number;
}

const memoTabla = new Memo<Tabla>({ nombre: "hallazgos:tabla", ttlMs: 1_800_000, staleMs: 6 * 3_600_000, max: 1 });
const memoEntidad = new Memo<Record<string, unknown> | null>({ nombre: "hallazgos:entidad", ttlMs: 1_800_000, staleMs: 3_600_000, max: 500 });

const NUM = (v: unknown) => (v == null ? null : Number(v));

/** entidad_metricas entera, con los conceptos de gasto ya calculados (los que aún no se calculan no se comparan). */
const cargarTabla = () =>
  memoTabla.obtener("tabla", async () => {
    const [m, cats, gasto, est] = await Promise.all([
      pool.query<Record<string, unknown>>(`SELECT * FROM entidad_metricas`),
      // Con *: es_senal (257) llega si la base ya la tiene; sin ella, todos son señal (como en la 256).
      pool.query<{ clave: string; nombre: string; consulta: string; excluir: string | null; es_senal?: boolean | null }>(
        `SELECT * FROM categoria_gasto WHERE refrescado_at IS NOT NULL ORDER BY orden, clave`),
      pool.query<{ entidad_ruc: string; categoria: string; monto: number; ordenes: number }>(
        `SELECT entidad_ruc, categoria, monto::float8 AS monto, ordenes FROM entidad_gasto_categoria`),
      pool.query<{ t: string | null }>(`SELECT to_char(refrescado_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t FROM hallazgos_estado WHERE id`),
    ]);
    const categorias: Categoria[] = cats.rows.map((c) => ({
      clave: c.clave, nombre: c.nombre, terminos: terminosDe(c.consulta), excluir: terminosDe(c.excluir), senal: c.es_senal !== false,
    }));
    const validas = new Set(categorias.map((c) => c.clave));
    const filas: FilaMetricas[] = m.rows.map((r) => ({
      ruc: String(r.ruc), nombre: (r.nombre as string | null) ?? null, grupo: String(r.grupo), banda: NUM(r.banda),
      departamento: (r.departamento as string | null) ?? null, anio_completo: Number(r.anio_completo), pim_ref: NUM(r.pim_ref),
      adj_procesos: Number(r.adj_procesos), adj_monto: Number(r.adj_monto), adj_directas: Number(r.adj_directas),
      adj_con_postores: Number(r.adj_con_postores), adj_unico: Number(r.adj_unico), adj_top5_monto: Number(r.adj_top5_monto),
      adj_proveedores: Number(r.adj_proveedores), ord_ordenes: Number(r.ord_ordenes), ord_monto: Number(r.ord_monto),
      ord_monto_personas: Number(r.ord_monto_personas), ord_ordenes_completos: Number(r.ord_ordenes_completos),
      ord_monto_completos: Number(r.ord_monto_completos), ord_monto_diciembre: Number(r.ord_monto_diciembre),
      borde_ordenes: Number(r.borde_ordenes), mef_pim: NUM(r.mef_pim), mef_devengado: NUM(r.mef_devengado),
      mef_pim_actual: NUM(r.mef_pim_actual), mef_devengado_actual: NUM(r.mef_devengado_actual),
      ctl_informes: Number(r.ctl_informes), ctl_penal: Number(r.ctl_penal), obras_activas: Number(r.obras_activas),
      obras_paralizadas: Number(r.obras_paralizadas), categorias: {},
    }));
    const porRuc = new Map(filas.map((f) => [f.ruc, f]));
    for (const g of gasto.rows) {
      const f = porRuc.get(g.entidad_ruc);
      if (f && validas.has(g.categoria)) f.categorias[g.categoria] = { monto: Number(g.monto), ordenes: Number(g.ordenes) };
    }
    const anioCompleto = filas[0]?.anio_completo ?? new Date().getUTCFullYear() - 1;
    return { filas, porRuc, categorias, calculado: est.rows[0]?.t ?? null, anioCompleto };
  });

const NOTA =
  "Comparaciones estadísticas con entidades parecidas (mismo tipo y, si alcanza, mismo tercio de presupuesto), no " +
  "acusaciones: una cifra alta puede tener una explicación (una obra grande, una emergencia, una función propia de la " +
  "entidad). Un hallazgo es una cifra en el 10 % más alto de sus pares (en la ejecución del presupuesto, en el 10 % más " +
  "bajo), con al menos 15 pares con el dato y un mínimo propio (por ejemplo 10 procesos, o S/ 50 mil y 1 % en un " +
  "concepto de gasto). Los conceptos de gasto se buscan por palabras en la descripción de cada orden: revisa con " +
  "«profundizar» las compras que suman. Los conceptos que son gasto normal de operación (tipo «contexto», como " +
  "telefonía o mantenimiento de vehículos) se comparan, pero nunca se marcan como hallazgo. Las personas naturales " +
  "sólo se cuentan, nunca se nombran.";

const FUENTES = [
  { nombre: "OECE, CONOSCE: adjudicaciones, postores y órdenes de compra y servicio", enlace: "https://conosce.oece.gob.pe/buscador/" },
  { nombre: "MEF, presupuesto y ejecución del gasto (SIAF)", enlace: "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto" },
  { nombre: "Contraloría, informes de servicios de control", enlace: "https://www.gob.pe/contraloria" },
  { nombre: "Contraloría, INFOBRAS", enlace: "https://infobras.contraloria.gob.pe/" },
];

const hoyLima = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });

function errorLento(c: Context, e: unknown) {
  if (esErrorPg(e, "57014")) return c.json({ error: "consulta_lenta", detail: "Las cifras tardaron demasiado: intenta en un momento." }, 504);
  // Una base sin la migración 256.
  if (esErrorPg(e, "42P01")) return c.json({ error: "no_disponible", detail: "Los hallazgos todavía no están calculados en esta base." }, 503);
  throw e;
}

// ─── GET /entidades/:ruc/hallazgos ───────────────────────────────────────────────────────────────────────────────────

/** El handler; lo monta routes/entidades.ts en /entidades/:ruc/hallazgos. */
export async function hallazgosDeEntidad(c: Context) {
  const ruc = c.req.param("ruc") ?? "";
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc", detail: "El RUC de 11 dígitos de una entidad pública." }, 400);
  if (/^1[0-7]/.test(ruc)) return c.json({ error: "invalid_ruc", detail: "Es el RUC de una persona natural: no se consulta." }, 400);
  let cuerpo: Record<string, unknown> | null;
  try {
    cuerpo = await memoEntidad.obtener(ruc, async () => {
      const t = await cargarTabla();
      const e = t.porRuc.get(ruc);
      if (!e) return null;
      const { pares, porBanda } = paresDe(e, t.filas);
      const metricas = evaluar(e, pares, definiciones(t.categorias));
      return publicar({
        entidad: { ruc: e.ruc, nombre: e.nombre },
        grupo: { clave: e.grupo, nombre: GRUPOS[e.grupo] ?? e.grupo },
        banda: e.banda != null ? { tercio: e.banda, nombre: BANDAS[e.banda], pim: e.pim_ref, anio: t.anioCompleto } : null,
        pares: pares.length,
        pares_por: porBanda ? "grupo y tercio de presupuesto" : "grupo",
        periodo: { desde: "2023-01-01", hasta: hoyLima() },
        hallazgos: seleccionarHallazgos(metricas),
        metricas,
        nota: NOTA,
        fuentes: FUENTES,
        calculado: t.calculado,
      });
    });
  } catch (e) {
    return errorLento(c, e);
  }
  if (!cuerpo) return c.json({ error: "not_found", detail: "No hay cifras para ese RUC (no es una entidad registrada)." }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
}

// ─── GET /hallazgos/ranking ──────────────────────────────────────────────────────────────────────────────────────────

hallazgosRouter.get("/ranking", async (c) => {
  const q = parametros(c);
  let t: Tabla;
  try {
    t = await cargarTabla();
  } catch (e) {
    return errorLento(c, e);
  }
  const defs = definiciones(t.categorias);
  try {
    const textoRegion = (q.region ?? "").trim();
    const region = textoRegion ? regionDe(textoRegion) : null;
    const pedido = validarRanking(q, defs, region, !!textoRegion && !region);
    const r = ranking(t.filas, pedido);
    c.header("Cache-Control", CACHE);
    return c.json(publicar({
      metrica: { clave: pedido.metrica.clave, titulo: pedido.metrica.titulo, unidad: pedido.metrica.unidad, direccion: pedido.metrica.direccion,
                 tipo: pedido.metrica.senal ? "senal" : "contexto", base: pedido.metrica.base },
      grupo: { clave: pedido.grupo, nombre: GRUPOS[pedido.grupo] },
      region: region?.nombre ?? null,
      banda: pedido.banda != null ? { tercio: pedido.banda, nombre: BANDAS[pedido.banda] } : null,
      orden: pedido.orden,
      periodo: { desde: "2023-01-01", hasta: hoyLima() },
      // El percentil y la mediana son contra todo el grupo (y el tercio, si se pidió); la región sólo filtra la lista.
      con_dato: r.con_dato,
      mediana: r.mediana,
      total: r.total,
      filas: r.filas,
      nota: `${pedido.metrica.piso ? "Sólo entran las entidades que cumplen el mínimo de la cifra (para que un porcentaje sobre muy pocos casos no encabece la lista). " : ""}${NOTA}`,
      fuentes: FUENTES,
      calculado: t.calculado,
    }));
  } catch (e) {
    if (e instanceof ErrorHallazgos) return c.json({ error: "pedido_invalido", detail: e.detail, ...(e.opciones ? { opciones: e.opciones } : {}) }, 400);
    throw e;
  }
});
