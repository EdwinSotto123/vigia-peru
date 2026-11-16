/**
 * La norma que regía en una fecha (RAG normativo, migraciones 284 a 290), para el investigador y para el MCP.
 *
 *   GET /normas/buscar?q=&fecha=&materia=
 *     q        la pregunta o el tema («fraccionamiento», «impedimentos de parientes», «penalidad por mora»);
 *     fecha    la de la convocatoria (AAAA-MM-DD; hoy si falta): decide la ley (Ley 32069 desde el 22-04-2025, antes la
 *              30225) y la versión de cada artículo (el Reglamento cambió el 14-01-2026);
 *     materia  contrataciones (por defecto, con control y presupuesto) | empleo_publico | especial | inversion.
 *
 * Devuelve lo mismo que recibe el analista legal: hasta 5 artículos que regían ese día, 3 criterios del OECE de esa ley
 * (opiniones y acuerdos de Sala Plena) y 2 de la otra ley, marcados: valen sólo por analogía.
 */
import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { embeber, type IaWorkers } from "../lib/rag.js";

export const normasRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Record<string, unknown>>({ nombre: "normas", ttlMs: 3_600_000, staleMs: 86_400_000, max: 300 });

const Buscar = z.object({
  q: z.string().trim().min(3).max(300),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  materia: z.enum(["contrataciones", "empleo_publico", "especial", "inversion"]).default("contrataciones"),
});

export interface Fila {
  slug: string; documento: string; numero: string | null; tipo: string; regimen: string; aplica: "norma" | "criterio" | "criterio_anterior";
  fechaEmision: string | null; articulo: string | null; epigrafe: string | null; texto: string; urlOficial: string | null; version?: string;
}

const CUPO = { norma: 5, criterio: 3, criterio_anterior: 2 } as const;
const VINCULANTES = new Set(["acuerdo_sala_plena", "precedente"]);

/** Igual que `elegir` del agente (backend/agent/tools/normas_rag.py): cupos por clase, sin repetir artículo, un lugar
 *  para la directiva entre las normas y otro para el acuerdo de Sala Plena entre los criterios. */
export function elegirNormas(filas: Fila[]): Fila[] {
  const por: Record<Fila["aplica"], Fila[]> = { norma: [], criterio: [], criterio_anterior: [] };
  const vistos = new Set<string>();
  let bases = 0;
  for (const f of filas) {
    if (por[f.aplica].length >= CUPO[f.aplica]) continue;
    // Una opinión o un acuerdo, una sola vez (su mejor fragmento); un artículo, una sola vez.
    const clave = f.aplica === "norma" ? `${f.slug}|${f.articulo ?? f.texto.slice(0, 80)}` : f.slug;
    if (vistos.has(clave)) continue;
    if (f.tipo === "bases_estandar" && ++bases > 2) continue;
    vistos.add(clave);
    por[f.aplica].push(f);
  }
  if (por.norma.length && !por.norma.some((x) => x.tipo === "directiva")) {
    const mejor = filas.find((x) => x.aplica === "norma" && x.tipo === "directiva");
    if (mejor) {
      if (por.norma.length >= CUPO.norma) por.norma.pop();
      por.norma.push(mejor);
    }
  }
  for (const clase of ["criterio", "criterio_anterior"] as const) {
    if (por[clase].length && !por[clase].some((x) => VINCULANTES.has(x.tipo))) {
      const mejor = filas.find((x) => x.aplica === clase && VINCULANTES.has(x.tipo));
      if (mejor) {
        if (por[clase].length >= CUPO[clase]) por[clase].pop();
        por[clase].unshift(mejor);
      }
    }
  }
  return [...por.norma, ...por.criterio, ...por.criterio_anterior];
}

normasRouter.get("/buscar", async (c) => {
  const leido = Buscar.safeParse(Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null)));
  if (!leido.success) return c.json({ error: "invalid_query", issues: leido.error.issues }, 400);
  const cuerpo = await buscarNormas(leido.data, (c.env as { AI?: IaWorkers } | undefined)?.AI);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

/** Lo que devuelve la búsqueda: la ley de esa fecha y las normas y criterios elegidos (lo mismo que recibe el analista legal). */
export interface NormasDeLaFecha {
  pregunta: string;
  fecha: string;
  regimen: "32069" | "30225";
  ley: string;
  busqueda: "hibrida" | "solo_palabras";
  data: (Fila & { version?: string })[];
}

/**
 * La búsqueda de GET /normas/buscar, para quien la necesite dentro de la API (el redactor del informe para control,
 * routes/informeControl.ts): las normas que regían en `fecha` sobre `q`, con su memoria de una hora. Sin `ia`, sólo por
 * palabras. `vectorDado`: el embedding de `q` ya calculado (quien busca varias preguntas las embebe juntas, en un pedido).
 */
export async function buscarNormas(p: z.input<typeof Buscar>, ia?: IaWorkers, vectorDado?: string | null): Promise<NormasDeLaFecha> {
  const materia = p.materia ?? "contrataciones";
  const fecha = p.fecha ?? new Date().toISOString().slice(0, 10);
  const materias = materia === "contrataciones" ? null : [materia];
  const clave = `${p.q.toLowerCase()}|${fecha}|${materia}`;
  return (await memo.obtener(clave, async () => {
    let vector: string | null = vectorDado ?? null;
    if (!vector && ia) {
      try {
        vector = `[${(await embeber(ia, [p.q], 15_000))[0].join(",")}]`;
      } catch {
        vector = null;       // sin vector se busca sólo por palabras, y se dice
      }
    }
    const r = await pool.query<Fila>(
      `SELECT slug, documento, numero, tipo, regimen, aplica, to_char(fecha_emision, 'YYYY-MM-DD') AS "fechaEmision", articulo, epigrafe,
              left(texto, 1600) AS texto, url_oficial AS "urlOficial"
         FROM buscar_norma($1, $2::halfvec, $3::date, 40, NULL, $4::text[])`, [p.q, vector, fecha, materias]);
    const elegidas = elegirNormas(r.rows);
    // El artículo como regía en esa fecha, si después se modificó (norma.version_de).
    const pares = elegidas.filter((x) => x.aplica === "norma" && x.articulo);
    if (pares.length) {
      const v = await pool.query(
        `SELECT n.version_de AS base, f.articulo, n.documento, to_char(n.vigencia_hasta, 'DD-MM-YYYY') AS hasta,
                left(string_agg(f.texto, E'\\n' ORDER BY f.orden), 1600) AS texto
           FROM norma n JOIN norma_fragmento f ON f.slug = n.slug
          WHERE n.version_de = ANY($1) AND f.articulo = ANY($2)
            AND COALESCE(n.vigencia_desde, DATE '1900-01-01') <= $3::date AND (n.vigencia_hasta IS NULL OR n.vigencia_hasta >= $3::date)
          GROUP BY 1, 2, 3, 4`, [pares.map((x) => x.slug), pares.map((x) => x.articulo), fecha]);
      for (const x of pares) {
        const otra = v.rows.find((y) => y.base === x.slug && y.articulo === x.articulo);
        if (otra) Object.assign(x, { texto: otra.texto, documento: otra.documento, version: otra.hasta ? `texto que regía hasta el ${otra.hasta}` : "versión de esa fecha" });
      }
    }
    // Un artículo que llegó directamente desde la versión anterior también dice que es el texto de esa fecha.
    const propias = await pool.query(
      `SELECT slug, to_char(vigencia_hasta, 'DD-MM-YYYY') AS hasta FROM norma WHERE slug = ANY($1) AND version_de IS NOT NULL`, [elegidas.map((x) => x.slug)]);
    for (const x of elegidas) {
      const v = propias.rows.find((y) => y.slug === x.slug);
      if (v && !x.version) x.version = v.hasta ? `texto que regía hasta el ${v.hasta}` : "versión de esa fecha";
    }
    // El mismo artículo pudo llegar por el texto vigente (ya cambiado por el de la fecha) y por su versión anterior.
    const dichos = new Set<string>();
    const sinRepetir = elegidas.filter((x) => {
      const k = `${x.documento}|${x.articulo ?? x.texto.slice(0, 80)}`;
      if (dichos.has(k)) return false;
      dichos.add(k);
      return true;
    });
    const regimen = fecha >= "2025-04-22" ? "32069" : "30225";
    return {
      pregunta: p.q, fecha, regimen, ley: regimen === "32069" ? "Ley N° 32069" : "Ley N° 30225 (TUO)", busqueda: vector ? "hibrida" : "solo_palabras",
      data: sinRepetir.map((x) => ({ ...x, texto: x.texto.replace(/\s+/g, " ").trim() })),
    };
  })) as unknown as NormasDeLaFecha;
}
