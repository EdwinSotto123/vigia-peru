import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, fechaIso, parametros } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { DATASET_SANCIONADOS } from "../lib/fuentes.js";

/**
 * GET /novedades?dias=7 — lo nuevo (fase 6 del plan del 2026-10-27): los contratos con antecedentes graves de los últimos
 * días (la buena pro de esa fecha), las sanciones nuevas del Tribunal de Contrataciones y los informes nuevos de la
 * Contraloría. Cada uno con su enlace a la ficha y a la fuente. De las sanciones, sólo empresas (una persona natural
 * sancionada no se nombra aquí); de los contratos, el nombre del ganador sólo si es una empresa (RUC 20).
 * Las listas llegan con tope (150); `totales` dice cuántos hay de verdad (el Inicio muestra esos números).
 */
export const novedadesRouter = new Hono();

const CACHE = cachePublico(1800, { maxAge: 300, swr: 7200 });
const memo = new Memo<Record<string, unknown>>({ nombre: "novedades", ttlMs: 1_800_000, staleMs: 3_600_000, max: 8 });
const Q = z.object({ dias: z.coerce.number().int().min(1).max(31).default(7) });

novedadesRouter.get("/", async (c) => {
  const p = Q.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const { dias } = p.data;
  const cuerpo = await memo.obtener(String(dias), async () => {
    // Las buenas pro llegan con atraso (CONOSCE, una vez por semana) y sus cruces se calculan después: la ventana termina en
    // el último día con antecedentes graves ya calculados, y se dice.
    const ult = await pool
      .query<{ f: string | null }>(`SELECT to_char(max(fecha_buena_pro), 'YYYY-MM-DD') AS f FROM casos_cruce WHERE fecha_buena_pro <= current_date AND severidad = 'alta'`)
      .then((r) => r.rows[0]?.f ?? null)
      .catch(() => null);
    const [contratos, sanciones, informes, totales] = await Promise.all([
      // `cruces` (migración 57: [{tipo, severidad, n}], los graves primero): la columna «Antecedentes» pinta cada uno con su
      // gravedad; `tipos` sigue para el filtro y el CSV.
      pool.query(
        `SELECT k.ocid, k.ruc, k.proveedor, k.entidad, k.entidad_ruc AS "entidadRuc", k.tipo_contratacion AS tipo, left(k.objeto, 200) AS objeto,
                to_char(k.fecha_buena_pro, 'YYYY-MM-DD') AS fecha, k.monto::float AS monto, k.tipos, k.cruces, k.n_alta AS "nAlta"
           FROM casos_cruce k
          WHERE k.fecha_buena_pro > COALESCE($2::date, current_date) - $1::int AND k.fecha_buena_pro <= COALESCE($2::date, current_date)
            AND k.severidad = 'alta'
          ORDER BY k.n_alta DESC, k.monto DESC NULLS LAST LIMIT 150`, [dias, ult]).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT s.id, s.ruc, s.razon_social AS nombre, s.tipo, s.resolucion, to_char(s.fecha_resolucion, 'YYYY-MM-DD') AS fecha,
                to_char(s.fecha_desde, 'YYYY-MM-DD') AS desde, to_char(s.fecha_hasta, 'YYYY-MM-DD') AS hasta, s.monto_multa_soles::float AS multa
           FROM osce_sancionados s
          WHERE s.fecha_resolucion >= current_date - 30 AND s.fecha_resolucion <= current_date
            AND NOT COALESCE(s.es_persona_natural, false) AND s.ruc ~ '^20\\d{9}$'
          ORDER BY s.fecha_resolucion DESC LIMIT 150`).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT i.codigo, i.numero, i.titulo, i.entidad_nombre AS entidad, i.entidad_ruc AS "entidadRuc", i.responsabilidades,
                to_char(i.fecha_emision, 'YYYY-MM-DD') AS fecha, COALESCE(i.url_pdf, i.url_resumen) AS url
           FROM informes_control i
          WHERE i.fecha_emision >= current_date - 30 AND i.fecha_emision <= current_date
          ORDER BY i.fecha_emision DESC LIMIT 150`).catch(() => ({ rows: [] })),
      // Sin el tope de las listas (con el índice de la fecha de la 191, no recorre la tabla).
      pool.query<{ contratos: number; sanciones: number; informes: number }>(
        `SELECT (SELECT count(*) FROM casos_cruce k
                  WHERE k.fecha_buena_pro > COALESCE($2::date, current_date) - $1::int AND k.fecha_buena_pro <= COALESCE($2::date, current_date)
                    AND k.severidad = 'alta')::int AS contratos,
                (SELECT count(*) FROM osce_sancionados s
                  WHERE s.fecha_resolucion >= current_date - 30 AND s.fecha_resolucion <= current_date
                    AND NOT COALESCE(s.es_persona_natural, false) AND s.ruc ~ '^20\\d{9}$')::int AS sanciones,
                (SELECT count(*) FROM informes_control i
                  WHERE i.fecha_emision >= current_date - 30 AND i.fecha_emision <= current_date)::int AS informes`, [dias, ult])
        .then((r) => r.rows[0] ?? null).catch(() => null),
    ]);
    return {
      dias,
      // La semana de contratos que se muestra: hasta el último día con buenas pro cargadas.
      contratosHasta: ult,
      contratos: contratos.rows.map((r) => ({ ...r, ruc: /^20\d{9}$/.test(r.ruc) ? r.ruc : null, proveedor: /^20\d{9}$/.test(r.ruc) ? r.proveedor : null })),
      sanciones: sanciones.rows,
      informes: informes.rows,
      totales: totales ?? { contratos: contratos.rows.length, sanciones: sanciones.rows.length, informes: informes.rows.length },
      fuentes: { sanciones: DATASET_SANCIONADOS },
    };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /novedades/semana ───────────────────────────────────────────────────
/**
 * GET /novedades/semana?semana=YYYY-MM-DD — «Lo nuevo» por semana (2026-11-01; el dueño: «súper desordenado, ni
 * siquiera se entiende, no hay gráficas»). Lo que cambia frente a GET /novedades (que queda para clientes viejos):
 *
 *   · Una semana del calendario (lunes a domingo) y no «los 7 días hasta el último con datos» (decía «hasta el 16 oct.»
 *     sin decir por qué): la última semana COMPLETA que ya tiene sus antecedentes calculados (`horizonte`: la última
 *     buena pro en casos_cruce). El Estado publica las buenas pro con semanas de atraso; las semanas que faltan llegan
 *     como `completa: false` para dibujarlas «en camino».
 *   · Un contrato es un PROCESO: casos_cruce tiene una fila por ganador (cada integrante de un consorcio), y la lista
 *     repetía el mismo contrato una vez por empresa (35 de 141 procesos graves de la semana del 12 de octubre). Cada
 *     proceso cuenta en la semana de su primera buena pro y es grave si alguno de sus ganadores tiene un antecedente grave;
 *     su monto suma una vez cada consorcio (o empresa), no una vez por integrante.
 *   · `semanas`: las 12 últimas, con cuántas buenas pro hubo (CONOSCE más los procesos que sólo trae el OCDS, por código
 *     del SEACE), cuántas con algún antecedente, cuántas con uno grave y su monto. La gráfica de la página.
 *   · `resumen` de la semana: por antecedente grave, por región y por tipo de contratación.
 *   · Sanciones e informes: el último mes PUBLICADO (hasta su última fecha cargada, que se devuelve), no el último mes
 *     del calendario: el registro de sancionados del OECE no trae resoluciones desde mayo y la página lo dice.
 *
 * Privacidad: de los ganadores, el nombre y el RUC sólo de una empresa (RUC 20); una persona natural va sin nombre ni RUC.
 * Todo pasa por `publicar()` con los nombres a la vista, así un consorcio con el nombre de un integrante persona natural
 * sale tapado igual que en la lista de contratos.
 */
const memoSemana = new Memo<Record<string, unknown>>({ nombre: "novedades-semana", ttlMs: 1_800_000, staleMs: 3_600_000, max: 16 });
/** La última buena pro con antecedentes calculados: decide la semana por defecto (5 min, como la caché del CDN). */
const memoHorizonte = new Memo<string | null>({ nombre: "novedades-horizonte", ttlMs: 300_000, staleMs: 1_800_000, max: 1 });
const QS = z.object({ semana: fechaIso().optional() });
const SEMANAS = 12;
const DIA = 86_400_000;
const fecha = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const mas = (d: Date, dias: number) => new Date(d.getTime() + dias * DIA);
/** El lunes de la semana de `d` (getUTCDay: 0 domingo, 1 lunes). */
const lunesDe = (d: Date) => mas(d, -((d.getUTCDay() + 6) % 7));
const esRuc20 = (v: unknown) => typeof v === "string" && /^20\d{9}$/.test(v);

type Sev = "alta" | "media" | "baja";
const RANGO: Record<Sev, number> = { alta: 0, media: 1, baja: 2 };
const sev = (v: unknown): Sev => (v === "alta" || v === "media" ? v : "baja");

interface FilaCaso {
  ocid: string;
  codigo: string | null;
  ruc: string;
  proveedor: string | null;
  consorcio: string | null;
  objeto: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  tipo: string | null;
  departamento: string | null;
  fecha: string;
  monto: number | null;
  cruces: unknown;
}

interface Ganador {
  ruc: string | null;
  nombre: string | null;
  persona: boolean;
}

/** Las filas de casos_cruce de un proceso (una por ganador) en un solo contrato. */
function unProceso(filas: FilaCaso[]) {
  const f0 = filas[0];
  const cruces = new Map<string, Sev>();
  for (const f of filas) {
    for (const x of Array.isArray(f.cruces) ? f.cruces : []) {
      const tipo = String((x as { tipo?: unknown })?.tipo ?? "");
      if (!tipo) continue;
      const s = sev((x as { severidad?: unknown })?.severidad);
      const antes = cruces.get(tipo);
      if (!antes || RANGO[s] < RANGO[antes]) cruces.set(tipo, s);
    }
  }
  // El monto: una vez por consorcio (todos sus integrantes traen el del consorcio) o por empresa que ganó un ítem.
  const porGrupo = new Map<string, number>();
  for (const f of filas) {
    const g = f.consorcio ?? f.ruc;
    porGrupo.set(g, Math.max(porGrupo.get(g) ?? 0, f.monto ?? 0));
  }
  const monto = [...porGrupo.values()].reduce((a, b) => a + b, 0);
  const lista = [...cruces.entries()]
    .map(([tipo, severidad]) => ({ tipo, severidad }))
    .sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad] || a.tipo.localeCompare(b.tipo));
  const ganadores: Ganador[] = [...new Map(filas.map((f) => [f.ruc, { ruc: f.ruc, nombre: f.proveedor, persona: !esRuc20(f.ruc) }])).values()];
  return {
    ocid: f0.ocid,
    codigo: f0.codigo,
    objeto: f0.objeto,
    entidad: f0.entidad,
    entidadRuc: f0.entidadRuc,
    tipo: f0.tipo,
    departamento: f0.departamento,
    fecha: filas.map((f) => f.fecha).sort()[0],
    monto: monto > 0 ? monto : null,
    consorcio: filas.find((f) => f.consorcio)?.consorcio ?? null,
    // Cada ganador con su nombre (se tapa abajo si es una persona natural).
    ganadores,
    cruces: lista,
    graves: lista.filter((c) => c.severidad === "alta").map((c) => c.tipo),
  };
}

novedadesRouter.get("/semana", async (c) => {
  const p = QS.safeParse(parametros(c));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);

  const horizonte = await memoHorizonte.obtener("h", () =>
    pool
      .query<{ f: string | null }>(`SELECT to_char(max(fecha_buena_pro), 'YYYY-MM-DD') AS f FROM casos_cruce WHERE fecha_buena_pro <= current_date`)
      .then((r) => r.rows[0]?.f ?? null),
  );
  if (!horizonte) return c.json({ error: "sin_datos" }, 503);
  // La última semana completa: la que termina (domingo) a más tardar el día del horizonte.
  const ultima = mas(lunesDe(mas(fecha(horizonte), 1)), -7);
  const primera = mas(ultima, -7 * (SEMANAS - 1));
  // La semana pedida, dentro de las 12 de la gráfica (fuera de ellas, la más cercana).
  let lunes = p.data.semana ? lunesDe(fecha(p.data.semana)) : ultima;
  if (lunes > ultima) lunes = ultima;
  if (lunes < primera) lunes = primera;
  const desde = iso(lunes);
  const hasta = iso(mas(lunes, 6));

  const cuerpo = await memoSemana.obtener(`${horizonte}:${desde}`, async () => {
    const [serie, filas, sanciones, informes] = await Promise.all([
      pool.query<{ desde: string; buenasPro: number; conAntecedente: number; graves: number; monto: number }>(
        `WITH casos AS (
           -- Todas las filas de los procesos con alguna buena pro en la ventana: la fecha de un proceso es la PRIMERA.
           SELECT k.ocid, COALESCE(k.codigo, k.ocid) AS codigo, k.fecha_buena_pro AS f, k.severidad, k.monto,
                  COALESCE(k.consorcio, k.ruc) AS grupo
             FROM casos_cruce k
            WHERE k.ocid IN (SELECT ocid FROM casos_cruce WHERE fecha_buena_pro BETWEEN $1::date AND $2::date)
         ),
         proc AS (SELECT ocid, min(codigo) AS codigo, min(f) AS f, bool_or(severidad = 'alta') AS grave FROM casos GROUP BY ocid),
         monto AS (SELECT ocid, sum(m) AS m FROM (SELECT ocid, grupo, max(monto) AS m FROM casos GROUP BY 1, 2) g GROUP BY ocid),
         -- Las buenas pro de la semana: los procesos de CONOSCE y los que sólo trae el OCDS, por código del SEACE.
         universo AS (
           SELECT codigo, min(f) AS f FROM (
             SELECT codigo_convocatoria AS codigo, fecha_buenapro AS f FROM conosce_adjudicaciones
              WHERE anio >= extract(year FROM $1::date)::int - 1 AND fecha_buenapro BETWEEN $1::date AND $2::date
             UNION ALL
             SELECT codigo, f FROM proc
           ) x WHERE codigo IS NOT NULL GROUP BY codigo
         ),
         -- Cada cuenta en una sola pasada, por el lunes de su semana. Antes era una subconsulta por semana y Postgres
         -- rehacía el universo 12 veces y el monto por cada proceso: 3.6 s en PROD; así, 0.35 s y las mismas cifras.
         u AS (SELECT date_trunc('week', f::timestamp)::date AS s, count(*)::int AS n FROM universo GROUP BY 1),
         p AS (SELECT date_trunc('week', x.f::timestamp)::date AS s, count(*)::int AS n, count(*) FILTER (WHERE x.grave)::int AS g,
                      COALESCE(sum(mo.m) FILTER (WHERE x.grave), 0)::float AS m
                 FROM proc x LEFT JOIN monto mo USING (ocid) GROUP BY 1),
         sem AS (SELECT g::date AS s FROM generate_series($1::date, $2::date - 6, interval '7 days') g)
         SELECT to_char(sem.s, 'YYYY-MM-DD') AS desde, COALESCE(u.n, 0) AS "buenasPro", COALESCE(p.n, 0) AS "conAntecedente",
                COALESCE(p.g, 0) AS graves, COALESCE(p.m, 0)::float AS monto
           FROM sem LEFT JOIN u USING (s) LEFT JOIN p USING (s) ORDER BY sem.s`,
        [iso(primera), iso(mas(ultima, 6))],
      ),
      // Los procesos graves de la semana elegida, con TODAS sus filas (los integrantes sin antecedente grave también).
      pool.query<FilaCaso>(
        `WITH sel AS (
           SELECT ocid FROM casos_cruce
            WHERE ocid IN (SELECT ocid FROM casos_cruce WHERE fecha_buena_pro BETWEEN $1::date AND $2::date)
            GROUP BY ocid
           HAVING min(fecha_buena_pro) BETWEEN $1::date AND $2::date AND bool_or(severidad = 'alta')
         )
         SELECT k.ocid, k.codigo, k.ruc, k.proveedor, k.consorcio, left(k.objeto, 240) AS objeto, k.entidad, k.entidad_ruc AS "entidadRuc",
                k.tipo_contratacion AS tipo, k.departamento, to_char(k.fecha_buena_pro, 'YYYY-MM-DD') AS fecha, k.monto::float AS monto, k.cruces
           FROM casos_cruce k JOIN sel USING (ocid)
          ORDER BY k.ocid, k.ruc
          LIMIT 4000`,
        [desde, hasta],
      ),
      // El último mes PUBLICADO de sanciones (de empresas: una persona natural sancionada no se nombra aquí).
      pool
        .query<Record<string, unknown>>(
          `WITH h AS (SELECT max(fecha_resolucion) AS h FROM osce_sancionados WHERE fecha_resolucion <= current_date)
           SELECT s.id, s.ruc, s.razon_social AS nombre, s.tipo, s.resolucion, to_char(s.fecha_resolucion, 'YYYY-MM-DD') AS fecha,
                  to_char(s.fecha_desde, 'YYYY-MM-DD') AS desde, to_char(s.fecha_hasta, 'YYYY-MM-DD') AS hasta,
                  s.monto_multa_soles::float AS multa, to_char(h.h, 'YYYY-MM-DD') AS ultima
             FROM h LEFT JOIN osce_sancionados s
               ON s.fecha_resolucion > h.h - 30 AND s.fecha_resolucion <= h.h
              AND NOT COALESCE(s.es_persona_natural, false) AND s.ruc ~ '^20\\d{9}$'
            ORDER BY s.fecha_resolucion DESC NULLS LAST LIMIT 500`,
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      // El último mes PUBLICADO de informes de control.
      pool
        .query<Record<string, unknown>>(
          `WITH h AS (SELECT max(fecha_emision) AS h FROM informes_control WHERE fecha_emision <= current_date)
           SELECT i.codigo, i.numero, i.titulo, i.entidad_nombre AS entidad, i.entidad_ruc AS "entidadRuc", i.responsabilidades,
                  to_char(i.fecha_emision, 'YYYY-MM-DD') AS fecha, COALESCE(i.url_pdf, i.url_resumen) AS url, to_char(h.h, 'YYYY-MM-DD') AS ultima
             FROM h LEFT JOIN informes_control i ON i.fecha_emision > h.h - 30 AND i.fecha_emision <= h.h
            ORDER BY i.fecha_emision DESC NULLS LAST LIMIT 500`,
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);

    // Los procesos, de a uno: los de más antecedentes graves y mayor monto primero.
    const porOcid = new Map<string, FilaCaso[]>();
    for (const f of filas.rows) porOcid.set(f.ocid, [...(porOcid.get(f.ocid) ?? []), f]);
    const contratos = [...porOcid.values()].map(unProceso).sort((a, b) => b.graves.length - a.graves.length || (b.monto ?? 0) - (a.monto ?? 0));

    const cuenta = (claves: (string | null)[]) => {
      const m = new Map<string, number>();
      for (const k of claves) m.set(k ?? "sin_dato", (m.get(k ?? "sin_dato") ?? 0) + 1);
      return [...m.entries()].map(([clave, n]) => ({ clave, n })).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
    };
    const porContratacion = new Map<string, { n: number; monto: number }>();
    for (const k of contratos) {
      const t = k.tipo ?? "sin_dato";
      const x = porContratacion.get(t) ?? { n: 0, monto: 0 };
      porContratacion.set(t, { n: x.n + 1, monto: x.monto + (k.monto ?? 0) });
    }
    const semanaSel = serie.rows.find((s) => s.desde === desde);
    const conFecha = (rows: Record<string, unknown>[]) => rows.filter((r) => r.fecha != null).map(({ ultima: _u, ...r }) => r);
    const ultimaDe = (rows: Record<string, unknown>[]) => (rows[0]?.ultima as string | null | undefined) ?? null;

    // Las semanas que todavía no llegan completas, hasta la de hoy: se dibujan «en camino».
    const enCamino: { desde: string; completa: false }[] = [];
    const hoy = lunesDe(fecha(iso(new Date())));
    for (let s = mas(ultima, 7); s <= hoy; s = mas(s, 7)) enCamino.push({ desde: iso(s), completa: false });

    const listo = publicar({
      semana: { desde, hasta },
      ultimaCompleta: iso(ultima),
      horizonte,
      semanas: [...serie.rows.map((s) => ({ ...s, completa: true as const })), ...enCamino],
      resumen: {
        buenasPro: semanaSel?.buenasPro ?? null,
        conAntecedente: semanaSel?.conAntecedente ?? null,
        graves: contratos.length,
        monto: contratos.reduce((a, k) => a + (k.monto ?? 0), 0),
        entidades: new Set(contratos.map((k) => k.entidadRuc ?? k.entidad)).size,
        porTipo: cuenta(contratos.flatMap((k) => k.graves)),
        porRegion: cuenta(contratos.map((k) => k.departamento)),
        porContratacion: [...porContratacion.entries()].map(([clave, v]) => ({ clave, ...v })).sort((a, b) => b.monto - a.monto),
      },
      contratos,
      sanciones: conFecha(sanciones.rows),
      sancionesUltima: ultimaDe(sanciones.rows),
      informes: conFecha(informes.rows),
      informesUltima: ultimaDe(informes.rows),
      fuentes: { sanciones: DATASET_SANCIONADOS },
    });
    // Una persona natural que ganó: sin nombre ni RUC (ya tapados por `publicar`; aquí, ni eso).
    for (const k of listo.contratos) for (const g of k.ganadores) if (g.persona) Object.assign(g, { ruc: null, nombre: null });
    return listo;
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
