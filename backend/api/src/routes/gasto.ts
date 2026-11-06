/**
 * Gasto por concepto: cuánto gastó una entidad (o le vendió una empresa, o gastaron las entidades de una región) en algo
 * dicho con palabras: «parlantes, sonido, audio», «bocaditos, refrigerio, catering». Para el MCP (gasto_por_concepto) y el
 * chat del panel: un RAG no suma montos; esto sí.
 *
 *   GET /gasto/concepto?entidad=<RUC>|proveedor=<RUC 20>|region=<departamento>
 *        &terminos=sonido,parlante,audio[&excluir=mantenimiento][&desde=2022][&hasta=2026][&fuentes=ordenes,procesos,menores]
 *
 * Un término es una palabra o frase (3 a 40 letras o cifras): búsqueda de texto en español (to_tsvector 'spanish', sin
 * tildes), con plural y prefijo («parlante» encuentra «PARLANTES»; «equipo de sonido», la frase). Los términos se suman con
 * O, los excluidos restan. En órdenes la acelera el índice GIN de la migración 255 (sin él, una entidad grande con la
 * caché fría tardaba 37 s). Fuentes: las órdenes de compra y
 * servicio (CONOSCE), los procesos adjudicados (ítem y objeto, CONOSCE) y las compras menores (SEACE). Solo soles; un monto
 * marcado como dudoso se cuenta pero no se suma. Lo que no es una empresa (RUC 20) va sumado en un grupo: nunca el nombre
 * ni el RUC de una persona natural.
 */
import { Hono } from "hono";
import { consultaConPlazo, pool } from "../lib/db.js";
import { publicar } from "../lib/privacidad.js";
import { cachePublico } from "../lib/http.js";

export const gastoRouter = new Hono();

const MAX_TERMINOS = 15;
const PLAZO_MS = 20_000;
/** El mismo texto que indexa la migración 255: minúsculas sin tildes, en español. Tiene que coincidir al carácter. */
const TSV = (col: string) => `to_tsvector('spanish'::regconfig, translate(lower(coalesce(${col}, '')), 'áéíóúüñ', 'aeiouun'))`;

/** Palabras vacías: van sin prefijo para que to_tsquery las quite y respete la distancia de la frase. */
const VACIAS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "para", "por", "con", "en", "a", "al", "un", "una", "sin"]);

/** «EQUIPO DE SONIDO» → «equipo:* <-> de <-> sonido:*»; varios términos con «|». */
const consulta = (t: string) =>
  t.toLowerCase().split(" ").map((w) => (VACIAS.has(w) ? w : `${w}:*`)).join(" <-> ");
const consultaDe = (ts: string[]) => ts.map((t) => `(${consulta(t)})`).join(" | ");

class ErrorPedido extends Error {}

/** «Parlante», «equipo de sonido» → «PARLANTE», «EQUIPO\s+DE\s+SONIDO» (sin tildes; solo letras, cifras y espacios). */
function terminos(texto: string | undefined, que: string, max: number): string[] {
  const lista = (texto ?? "").split(/[,|;\n]/).map((t) => t.trim()).filter(Boolean);
  if (lista.length > max) throw new ErrorPedido(`${que}: hasta ${max} términos (mandaste ${lista.length}).`);
  return lista.map((t) => {
    const n = t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!/^[A-Z0-9 ]{3,40}$/.test(n)) throw new ErrorPedido(`${que}: «${t.slice(0, 40)}» no vale (3 a 40 letras o cifras, sin signos).`);
    return n;
  });
}

interface Fuente {
  clave: "ordenes" | "procesos" | "menores";
  /** Filtro de años que usa un índice de la tabla (en órdenes, (entidad_ruc|ruc_contratista, fecha_emision)). */
  rango: (d: string, h: string) => string;
  desde: string;
  texto: string;
  anio: string;
  fecha: string;
  monto: string;
  ruc: string;
  nombre: string;
  ref: string;
  entidad: string;
  dudoso: string;
  soles: string;
  porEntidad: string;
  porProveedor: string;
}

const FUENTES: Fuente[] = [
  {
    clave: "ordenes", desde: "conosce_ordenes o",
    // Por fecha y no por año: el índice es (entidad_ruc, fecha_emision); con anio leía todas las órdenes de la entidad
    // (13 s con la caché fría en Ate).
    rango: (d, h) => `o.fecha_emision >= make_date(${d}::int, 1, 1) AND o.fecha_emision < make_date(${h}::int + 1, 1, 1)`, texto: "o.descripcion", anio: "o.anio", fecha: "o.fecha_emision", monto: "o.monto",
    ruc: "o.ruc_contratista", nombre: "o.contratista", ref: "o.orden", entidad: "o.entidad", dudoso: "o.monto_dudoso IS NOT NULL",
    soles: "COALESCE(o.moneda, 'Nuevos Soles') IN ('Nuevos Soles', 'Soles', 'PEN')", porEntidad: "o.entidad_ruc", porProveedor: "o.ruc_contratista",
  },
  {
    clave: "procesos", desde: "conosce_adjudicaciones a", rango: (d, h) => `a.anio BETWEEN ${d} AND ${h}`,
    texto: "coalesce(a.descripcion_item, '') || ' ' || coalesce(a.descripcion_proceso, '')", anio: "a.anio",
    fecha: "coalesce(a.fecha_buenapro, a.fecha_convocatoria)", monto: "a.monto_adjudicado", ruc: "a.ruc_proveedor", nombre: "a.proveedor",
    ref: "a.codigo_convocatoria", entidad: "a.entidad", dudoso: "false",
    soles: "COALESCE(a.moneda, 'Soles') IN ('Soles', 'Nuevos Soles', 'PEN')", porEntidad: "a.entidad_ruc", porProveedor: "a.ruc_proveedor",
  },
  {
    clave: "menores", desde: "seace_menores m", rango: (d, h) => `m.anio BETWEEN ${d} AND ${h}`, texto: "coalesce(m.descripcion, '') || ' ' || coalesce(m.objeto, '')", anio: "m.anio",
    fecha: "m.fecha_suscripcion", monto: "m.monto", ruc: "m.proveedor_ruc", nombre: "m.proveedor", ref: "m.id_contrato::text",
    entidad: "m.entidad", dudoso: "false", soles: "COALESCE(m.moneda, 'PEN') = 'PEN'", porEntidad: "m.entidad_ruc", porProveedor: "m.proveedor_ruc",
  },
];

type Alcance = { tipo: "entidad" | "proveedor" | "region"; valor: string };

async function sumar(f: Fuente, alcance: Alcance, desde: number, hasta: number, incl: string[], excl: string[]) {
  const vals: unknown[] = [];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const donde = [f.rango(p(desde), p(hasta)), f.soles, `${TSV(f.texto)} @@ to_tsquery('spanish', ${p(consultaDe(incl))})`];
  if (excl.length) donde.push(`NOT (${TSV(f.texto)} @@ to_tsquery('spanish', ${p(consultaDe(excl))}))`);
  if (alcance.tipo === "entidad") donde.push(`${f.porEntidad} = ${p(alcance.valor)}`);
  else if (alcance.tipo === "proveedor") donde.push(`${f.porProveedor} = ${p(alcance.valor)}`);
  else donde.push(`${f.porEntidad} IN (SELECT ruc FROM entidades WHERE translate(upper(region), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') = ${p(alcance.valor)})`);
  const terms = p(incl);
  const consultas = p(incl.map(consulta));
  const empresa = "x.ruc ~ '^20[0-9]{9}$'";
  const sql = `
    WITH x AS MATERIALIZED (
      SELECT ${f.anio} AS anio, ${f.fecha} AS fecha, ${f.texto} AS descripcion, ${f.monto}::float AS monto, ${f.ruc} AS ruc,
             ${f.nombre} AS nombre, ${f.ref} AS ref, ${f.entidad} AS entidad, (${f.dudoso}) AS dudoso, ${TSV(f.texto)} AS tsv
        FROM ${f.desde} WHERE ${donde.join(" AND ")}
      LIMIT 200000)
    SELECT
      (SELECT json_build_object('registros', count(*), 'monto', coalesce(sum(monto) FILTER (WHERE NOT dudoso), 0),
              'dudosos', count(*) FILTER (WHERE dudoso)) FROM x) AS total,
      (SELECT json_agg(y ORDER BY y.anio) FROM (SELECT anio, count(*) AS registros, coalesce(sum(monto) FILTER (WHERE NOT dudoso), 0) AS monto
         FROM x GROUP BY anio) y) AS por_anio,
      (SELECT json_agg(y ORDER BY y.monto DESC NULLS LAST) FROM (
         SELECT z.ruc, max(z.nombre) AS nombre, count(*) AS registros, coalesce(sum(z.monto) FILTER (WHERE NOT z.dudoso), 0) AS monto
           FROM (SELECT CASE WHEN ${empresa} THEN x.ruc END AS ruc, CASE WHEN ${empresa} THEN x.nombre END AS nombre, x.monto, x.dudoso
                   FROM x) z
          GROUP BY z.ruc ORDER BY 4 DESC NULLS LAST LIMIT 16) y) AS por_proveedor,
      (SELECT json_agg(y) FROM (
         SELECT x.fecha, left(x.descripcion, 180) AS descripcion, x.monto, x.ref, x.entidad, x.dudoso,
                CASE WHEN ${empresa} THEN x.ruc END AS ruc, CASE WHEN ${empresa} THEN x.nombre END AS proveedor,
                NOT (${empresa}) AS persona_natural_u_otro
           FROM x ORDER BY x.monto DESC NULLS LAST LIMIT 25) y) AS mayores,
      (SELECT json_agg(y ORDER BY y.monto DESC NULLS LAST) FROM (
         SELECT t.termino, count(*) AS registros, coalesce(sum(x.monto) FILTER (WHERE NOT x.dudoso), 0) AS monto
           FROM x, unnest(${terms}::text[], ${consultas}::text[]) AS t(termino, q)
          WHERE x.tsv @@ to_tsquery('spanish', t.q) GROUP BY t.termino) y) AS por_termino`;
  const r = await consultaConPlazo(sql, vals, PLAZO_MS, { memoriaMb: 64 });
  return r.rows[0] as Record<string, any>;
}

gastoRouter.get("/concepto", async (c) => {
  try {
    const q = (k: string) => c.req.query(k)?.trim() || undefined;
    const incl = terminos(q("terminos"), "terminos", MAX_TERMINOS);
    if (!incl.length) throw new ErrorPedido("Falta terminos: palabras del concepto separadas por coma, por ejemplo terminos=sonido,parlante,audio.");
    const excl = terminos(q("excluir"), "excluir", 10);
    const anioActual = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }).slice(0, 4));
    const hasta = Number(q("hasta") ?? anioActual);
    const desde = Number(q("desde") ?? hasta - 4);
    if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 2015 || hasta > anioActual + 1 || desde > hasta) {
      throw new ErrorPedido("desde y hasta: años de 4 cifras desde 2015, con desde ≤ hasta.");
    }
    const elegidos = [q("entidad") && "entidad", q("proveedor") && "proveedor", q("region") && "region"].filter(Boolean);
    if (elegidos.length !== 1) throw new ErrorPedido("Indica uno: entidad (RUC), proveedor (RUC 20) o region (departamento).");
    let alcance: Alcance;
    if (q("entidad")) {
      if (!/^\d{11}$/.test(q("entidad")!) || q("entidad")!.startsWith("10")) throw new ErrorPedido("entidad: el RUC de 11 dígitos de una entidad.");
      alcance = { tipo: "entidad", valor: q("entidad")! };
    } else if (q("proveedor")) {
      if (!/^20\d{9}$/.test(q("proveedor")!)) throw new ErrorPedido("proveedor: el RUC de una empresa (empieza con 20). Una persona natural no se consulta.");
      alcance = { tipo: "proveedor", valor: q("proveedor")! };
    } else {
      if (hasta - desde > 2) throw new ErrorPedido("Con region, hasta 3 años por consulta (es mucho volumen): acota desde y hasta.");
      alcance = { tipo: "region", valor: q("region")!.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase() };
    }
    const pedidas = (q("fuentes") ?? "ordenes,procesos,menores").split(",").map((x) => x.trim());
    const fuentes = FUENTES.filter((f) => pedidas.includes(f.clave));
    if (!fuentes.length) throw new ErrorPedido("fuentes: ordenes, procesos o menores (separadas por coma).");

    const nombreAlcance = alcance.tipo === "region" ? null : await pool.query<{ n: string }>(
      alcance.tipo === "entidad" ? "SELECT nombre AS n FROM entidades WHERE ruc = $1" : "SELECT nombre AS n FROM empresa_resumen WHERE ruc = $1",
      [alcance.valor]).then((r) => r.rows[0]?.n ?? null).catch(() => null);

    const resultados = await Promise.all(fuentes.map((f) => sumar(f, alcance, desde, hasta, incl, excl).then((r) => [f.clave, r] as const)));
    const total = { registros: 0, monto: 0, dudosos: 0 };
    for (const [, r] of resultados) {
      total.registros += Number(r.total?.registros ?? 0);
      total.monto += Number(r.total?.monto ?? 0);
      total.dudosos += Number(r.total?.dudosos ?? 0);
    }
    c.header("Cache-Control", cachePublico(1800, { maxAge: 300 }));
    return c.json(publicar({
      alcance: { ...alcance, nombre: nombreAlcance },
      desde, hasta,
      terminos: incl, excluidos: excl,
      total: { ...total, monto: Math.round(total.monto * 100) / 100 },
      por_fuente: Object.fromEntries(resultados.map(([k, r]) => [k, r])),
      nota: "Busca los términos como comienzo de palabra en la descripción de cada orden, ítem o compra (sin tildes). Las " +
        "descripciones las escribe cada entidad: revisa «mayores» y «por_termino» para descartar coincidencias que no son del " +
        "concepto, y usa excluir para quitarlas. Solo soles; los montos dudosos se cuentan pero no se suman.",
      fuente_oficial: { nombre: "OECE: CONOSCE (órdenes y adjudicaciones) y SEACE (compras menores)", enlace: "https://conosce.oece.gob.pe/buscador/" },
    }));
  } catch (e) {
    if (e instanceof ErrorPedido) return c.json({ error: "pedido_invalido", detail: e.message }, 400);
    if (/statement timeout|canceling statement/i.test(String((e as Error).message))) {
      return c.json({ error: "consulta_lenta", detail: "La búsqueda tardó demasiado: acota a una entidad, menos años o términos más precisos." }, 504);
    }
    throw e;
  }
});
