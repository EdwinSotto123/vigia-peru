import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { publicar } from "../lib/privacidad.js";
import { visitasHasta } from "../lib/visitas.js";
import {
  CLARIDAD_ONPE,
  CONOSCE_BUSCADOR,
  CONSULTA_RUC_SUNAT,
  DATASET_PENALIDADES,
  DATASET_SANCIONADOS,
  DATASET_SOCIOS_RNP,
  PLATAFORMA_JNE,
  VISITAS_EN_LINEA,
  obraInfobras,
  procesoOece,
} from "../lib/fuentes.js";
import {
  acotar,
  dia,
  fechaEleccion,
  marcasEleccion,
  olasDeGestion,
  secuenciasDeCruces,
  type CambioGestion,
  type Carril,
  type CarrilHistoria,
  type CruceSecuencia,
  type EventoHistoria,
  type Historia,
  type MarcaHistoria,
  type SecuenciaHistoria,
  type SerieHistoria,
  type Severidad,
} from "../lib/historia.js";

/**
 * La línea de tiempo de una entidad, una empresa y un partido (fase 3 del plan del 2026-10-27; lib/historia.ts):
 *
 *   GET /historia/entidad/:ruc   quién gobernaba (la gestión local del JNE o el Presidente), sus procesos, sus órdenes y
 *                                las que fueron a personas (migración 187), su planilla, sus plazas CAS, las visitas que
 *                                recibió, los informes de la Contraloría, sus obras, los contratos con banderas y su
 *                                presupuesto por año; y la «ola» que siguió a cada cambio de gestión.
 *   GET /historia/empresa/:ruc   su fundación y quiénes entraron (por su papel), los contratos que ganó, sus órdenes y
 *                                contratos menores, sanciones y penalidades, aportes y campañas, visitas, obras y banderas;
 *                                y las secuencias que prueban sus cruces (visitó y ganó, se fundó y ganó…).
 *   GET /historia/partido/:clave los gobiernos que ganó en cada elección, los procesos y las banderas de las entidades que
 *                                gobernó, los aportes que recibió y lo que gastó en cada campaña.
 *
 * Cada fuente va en su consulta: si una falla, la línea sale sin ese carril (y lo dice el registro), no vacía.
 * Privacidad: ningún nombre de persona natural privada; de la visita, el cargo y el área de quien la recibió.
 */
export const historiaRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 300, swr: 86400 });
const memo = new Memo<Historia | null>({ nombre: "historia", ttlMs: 900_000, staleMs: 3_600_000, max: 300 });
const SOLES = `('Soles', 'Nuevos Soles')`;
/** Desde cuándo: las convocatorias del OECE empiezan en 2015. */
const DESDE = "2015-01-01";
const rutaContrato = (ocid: string) => `/app/contratos/${encodeURIComponent(ocid.replace(/^OECE-/i, ""))}`;

/** Una consulta que, si falla, deja su carril vacío (y lo anota) en vez de tumbar la línea entera. */
async function filas<T extends object>(nombre: string, sql: string, args: unknown[]): Promise<T[]> {
  try {
    return (await pool.query<T>(sql, args)).rows;
  } catch (e) {
    console.warn(JSON.stringify({ severity: "WARNING", message: `[historia] ${nombre} falló: ${(e as Error).message}` }));
    return [];
  }
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const hoy = () => new Date().toISOString().slice(0, 10);
const titulo = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/(^|[\s(«"/-])([a-záéíóúñü])/g, (_, p: string, l: string) => p + l.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|El|Y|E|En|Por|Para|A|Al)\b/g, (w) => w.toLowerCase())
    .replace(/^./, (l) => l.toUpperCase())
    .trim();
const sev = (v: unknown): Severidad | null => (v === "alta" || v === "media" || v === "baja" ? v : null);

/** Los carriles que traen algo (una serie con datos o un hecho), en el orden pedido. */
function soloConDatos(orden: CarrilHistoria[], series: SerieHistoria[], eventos: EventoHistoria[]): CarrilHistoria[] {
  const con = new Set<Carril>([...series.filter((s) => s.puntos.some((p) => p.n > 0 || (p.monto ?? 0) > 0)).map((s) => s.carril), ...eventos.map((e) => e.carril)]);
  return orden.filter((c) => con.has(c.clave));
}

/** Los hechos que nombra una secuencia (por fecha y carril) no se recortan. */
function fijosDe(secuencias: SecuenciaHistoria[], eventos: EventoHistoria[]): Set<string> {
  const fechas = new Set(secuencias.flatMap((s) => s.pasos.map((p) => p.fecha)));
  return new Set(eventos.filter((e) => fechas.has(e.fecha)).map((e) => e.id));
}

// ─── Entidad ────────────────────────────────────────────────────────────────────────────────────

const CARRILES_ENTIDAD: CarrilHistoria[] = [
  { clave: "gobierno", titulo: "Quién gobierna", explica: "La gestión de cada periodo según el JNE o, en el Ejecutivo, el Presidente en funciones." },
  { clave: "compras", titulo: "Procesos que convocó", explica: "Sus convocatorias en el SEACE (OECE), por mes." },
  { clave: "ordenes", titulo: "Órdenes de compra y de servicio", explica: "Sus órdenes en CONOSCE (OECE), por mes, desde 2018." },
  { clave: "personas", titulo: "Órdenes a personas", explica: "Las órdenes de servicio a personas naturales (locadores), por mes." },
  { clave: "planilla", titulo: "Planilla", explica: "Cuánta gente publicó cada mes en el Portal de Transparencia y cuántos entraron." },
  { clave: "plazas", titulo: "Plazas CAS", explica: "Las convocatorias CAS que publicó en SERVIR Talento Perú, por mes." },
  { clave: "visitas", titulo: "Visitas que recibió", explica: "Las visitas de su Registro de Visitas en Línea, por mes." },
  { clave: "banderas", titulo: "Contratos con banderas", explica: "Los contratos cuyo ganador tiene antecedentes graves o medios, en la fecha de la buena pro." },
  { clave: "control", titulo: "Control", explica: "Los informes de la Contraloría sobre la entidad." },
  { clave: "obras", titulo: "Obras", explica: "Las obras que inició (INFOBRAS) y las que se paralizaron." },
  { clave: "presupuesto", titulo: "Presupuesto", explica: "Su presupuesto de cada año (PIM) y cuánto gastó (devengado), según el MEF." },
];

const CARGO_NIVEL: Record<string, string> = { regional: "Gobernador regional", provincial: "Alcalde provincial", distrital: "Alcalde distrital" };
/** Las responsabilidades de un informe de control, de la más grave a la menos. */
function sevInforme(resp: unknown): Severidad {
  const r = (Array.isArray(resp) ? resp.join(" ") : String(resp ?? "")).toUpperCase();
  return /PENAL/.test(r) ? "alta" : /CIVIL/.test(r) ? "media" : "baja";
}

async function historiaEntidad(ruc: string): Promise<Historia | null> {
  const [ent] = await filas<{ nombre: string | null }>("entidad", `SELECT e.nombre FROM entidades e WHERE e.ruc::text = $1`, [ruc]);
  if (!ent) return null;
  const [gobLocal, nacional, conv, ord, pla, plz, vis, inf, obr, ban, mef] = await Promise.all([
    filas<{ desde: string; hasta: string; autoridad: string | null; org_nombre: string | null; nivel: string }>(
      "gobierno local",
      `SELECT to_char(g.desde, 'YYYY-MM-DD') AS desde, to_char(g.hasta, 'YYYY-MM-DD') AS hasta, g.autoridad, g.org_nombre, g.nivel
         FROM entidad_gobierno_amplia a JOIN gobierno_periodo g ON g.nivel = a.nivel AND g.ubigeo = a.ubigeo
        WHERE a.ruc = $1 ORDER BY g.desde`, [ruc]),
    filas<{ desde: string; presidente: string; como: string }>(
      "gobierno nacional",
      `SELECT to_char(n.desde, 'YYYY-MM-DD') AS desde, n.presidente, n.como
         FROM gobierno_nacional_inicio n
        WHERE EXISTS (SELECT 1 FROM entidad_gestion g WHERE g.ruc = $1 AND g.nivel = 'nacional')
        ORDER BY n.desde`, [ruc]),
    filas<{ mes: string; n: number; monto: number }>(
      "convocatorias",
      `SELECT to_char(date_trunc('month', fecha_convocatoria), 'YYYY-MM') AS mes, count(*)::int AS n, COALESCE(sum(cuantia_referencial), 0)::float AS monto
         FROM convocatorias WHERE entidad_ruc = $1 AND fecha_convocatoria >= DATE '${DESDE}' AND fecha_convocatoria <= current_date + 31
        GROUP BY 1 ORDER BY 1`, [ruc]),
    filas<{ mes: string; ordenes: number; monto: number; a_personas: number; monto_personas: number }>(
      "órdenes por mes",
      `SELECT to_char(mes, 'YYYY-MM') AS mes, ordenes, monto::float AS monto, a_personas, monto_personas::float AS monto_personas
         FROM entidad_orden_mes WHERE entidad_ruc = $1 ORDER BY mes`, [ruc]),
    filas<{ mes: string; personas: number; altas: number | null; incompleto: boolean | null }>(
      "planilla",
      `SELECT to_char(mes, 'YYYY-MM') AS mes, personas, altas, incompleto FROM planilla_entidad_mes WHERE entidad_ruc = $1 ORDER BY mes`, [ruc]),
    filas<{ mes: string; n: number; vacantes: number }>(
      "plazas",
      `SELECT to_char(date_trunc('month', fecha_inicio), 'YYYY-MM') AS mes, count(*)::int AS n, COALESCE(sum(vacantes), 0)::int AS vacantes
         FROM servir_convocatoria WHERE entidad_ruc = $1 AND fecha_inicio IS NOT NULL GROUP BY 1 ORDER BY 1`, [ruc]),
    filas<{ mes: string; n: number; privadas: number }>(
      "visitas",
      `SELECT to_char(date_trunc('month', v.fecha_visita), 'YYYY-MM') AS mes, count(*)::int AS n,
              count(*) FILTER (WHERE v.tipo_entidad_visitante = 'privada')::int AS privadas
         FROM visitas_entidades v
        WHERE v.entidad_visitada IN (SELECT entidad_visitada FROM visita_entidad_ruc WHERE ruc = $1) AND v.fecha_visita IS NOT NULL
        GROUP BY 1 ORDER BY 1`, [ruc]),
    filas<{ codigo: string; numero: string | null; titulo: string | null; modalidad: string | null; responsabilidades: string[] | null; funcionarios: number | null; fecha: string; url: string | null }>(
      "informes",
      `SELECT codigo, numero, titulo, modalidad, responsabilidades, funcionarios, to_char(fecha_emision, 'YYYY-MM-DD') AS fecha,
              COALESCE(url_pdf, url_resumen) AS url
         FROM informes_control WHERE entidad_ruc = $1 AND fecha_emision IS NOT NULL ORDER BY fecha_emision DESC LIMIT 400`, [ruc]),
    filas<{ codigo: number; nombre: string | null; inicio: string; monto: number | null; estado: string | null; paralizada: boolean | null; fecha_par: string | null; causal: string | null; ejecutor_ruc: string | null; ejecutor: string | null }>(
      "obras",
      `SELECT codigo, nombre, to_char(fecha_inicio, 'YYYY-MM-DD') AS inicio, COALESCE(contrato_monto, monto_viable)::float AS monto, estado,
              paralizada, to_char(fecha_paralizacion, 'YYYY-MM-DD') AS fecha_par, causal_paralizacion AS causal, ejecutor_ruc, ejecutor_nombre AS ejecutor
         FROM obra_infobras WHERE entidad_ruc = $1 AND NOT retirada AND fecha_inicio IS NOT NULL
        ORDER BY contrato_monto DESC NULLS LAST LIMIT 300`, [ruc]),
    filas<{ ocid: string; ruc: string; proveedor: string | null; objeto: string | null; fecha: string; monto: number | null; severidad: string; n_alta: number; tipos: string[] }>(
      "banderas",
      `SELECT ocid, ruc, proveedor, objeto, to_char(fecha_buena_pro, 'YYYY-MM-DD') AS fecha, monto::float AS monto, severidad, n_alta, tipos
         FROM casos_cruce WHERE entidad_ruc = $1 AND severidad IN ('alta', 'media') AND fecha_buena_pro IS NOT NULL
        ORDER BY fecha_buena_pro DESC LIMIT 400`, [ruc]),
    filas<{ anio: number; pim: number; devengado: number }>(
      "presupuesto",
      `SELECT m.anio::int AS anio, sum(m.pim)::float AS pim, sum(m.devengado)::float AS devengado
         FROM entidad_siaf s JOIN mef_ejecutora_anual m ON m.sec_ejec = s.sec_ejec::text
        WHERE btrim(s.ruc::text) = $1 AND NOT COALESCE(s.fuera_siaf, false) AND m.anio >= 2015
        GROUP BY 1 ORDER BY 1`, [ruc]),
  ]);

  const hasta = hoy();
  const base = `/entidad/${ruc}`;
  const series: SerieHistoria[] = [];
  const serie = (s: SerieHistoria) => s.puntos.length && series.push(s);
  serie({ carril: "compras", titulo: "Procesos convocados", medida: "n", unidad: "procesos", huecos: "cero", puntos: conv.map((r) => ({ periodo: r.mes, n: r.n, monto: r.monto })), fuente: "SEACE (OECE)", enlace: CONOSCE_BUSCADOR, href: `${base}?seccion=contratos&vista=contratos` });
  serie({ carril: "ordenes", titulo: "Órdenes de compra y de servicio", medida: "n", unidad: "órdenes", huecos: "cero", puntos: ord.map((r) => ({ periodo: r.mes, n: r.ordenes, monto: r.monto })), fuente: "CONOSCE (OECE)", enlace: CONOSCE_BUSCADOR, href: `${base}?seccion=contratos&vista=ordenes` });
  const personas: SerieHistoria = { carril: "personas", titulo: "Órdenes a personas naturales", medida: "n", unidad: "órdenes a personas", huecos: "cero", puntos: ord.filter((r) => r.a_personas > 0 || ord.length).map((r) => ({ periodo: r.mes, n: r.a_personas, monto: r.monto_personas })), fuente: "CONOSCE (OECE)", enlace: CONOSCE_BUSCADOR, href: `${base}?seccion=personas` };
  if (ord.some((r) => r.a_personas > 0)) series.push(personas);
  const planilla: SerieHistoria = { carril: "planilla", titulo: "Personas en planilla", medida: "n", unidad: "personas", extra: "entraron", huecos: "sin_dato", puntos: pla.map((r) => ({ periodo: r.mes, n: r.personas, extra: r.altas })), fuente: "Portal de Transparencia Estándar", href: `${base}?seccion=planilla` };
  serie(planilla);
  serie({ carril: "plazas", titulo: "Plazas CAS convocadas", medida: "n", unidad: "convocatorias", extra: "vacantes", huecos: "cero", puntos: plz.map((r) => ({ periodo: r.mes, n: r.n, extra: r.vacantes })), fuente: "SERVIR Talento Perú", href: `${base}?seccion=plazas` });
  serie({ carril: "visitas", titulo: "Visitas registradas", medida: "n", unidad: "visitas", extra: "de empresas", huecos: "cero", puntos: vis.map((r) => ({ periodo: r.mes, n: r.n, extra: r.privadas })), fuente: "Registro de Visitas en Línea", enlace: VISITAS_EN_LINEA });
  serie({ carril: "presupuesto", titulo: "Presupuesto (PIM) y gasto (devengado)", medida: "monto", unidad: "soles", extra: "devengado", porAnio: true, huecos: "sin_dato", puntos: mef.map((r) => ({ periodo: String(r.anio), n: 0, monto: r.pim, extra: r.devengado })), fuente: "MEF (Consulta Amigable)", href: `${base}?seccion=presupuesto` });

  const eventos: EventoHistoria[] = [];
  const marcas: MarcaHistoria[] = [];
  const cambios: CambioGestion[] = [];
  for (const g of gobLocal) {
    const partido = g.org_nombre ? titulo(g.org_nombre) : "una organización sin nombre en el registro";
    eventos.push({
      id: `gestion:${g.desde}`, carril: "gobierno", tipo: "gestion", fecha: g.desde, hasta: g.hasta,
      titulo: `Gestión de ${partido}`,
      detalle: g.autoridad ? `${CARGO_NIVEL[g.nivel] ?? "Autoridad"}: ${titulo(g.autoridad)}` : null,
      fuente: "JNE (Infogob)", enlace: PLATAFORMA_JNE,
    });
    if (g.desde > DESDE) {
      marcas.push({ fecha: g.desde, tipo: "gobierno", texto: `Asumió la gestión de ${partido}` });
      cambios.push({ fecha: g.desde, quien: `la gestión de ${partido}` });
    }
  }
  nacional.forEach((p, i) => {
    const sig = nacional[i + 1]?.desde ?? null;
    if (sig && sig < DESDE) return;
    eventos.push({
      id: `presidente:${p.desde}`, carril: "gobierno", tipo: "presidente", fecha: p.desde, hasta: sig,
      titulo: p.presidente, detalle: p.como === "sucesion" ? "Asumió por sucesión" : "Elegido en las elecciones generales",
      fuente: "Gobierno nacional", enlace: null,
    });
    if (p.desde > DESDE && p.desde <= hasta) {
      marcas.push({ fecha: p.desde, tipo: "gobierno", texto: `Asumió ${p.presidente}` });
      cambios.push({ fecha: p.desde, quien: p.presidente });
    }
  });
  marcas.push(...marcasEleccion(DESDE, hasta, nacional.length ? "general" : gobLocal.length ? "regional" : undefined));

  for (const r of inf) {
    eventos.push({
      id: `informe:${r.codigo}`, carril: "control", tipo: "informe", fecha: r.fecha,
      titulo: r.titulo ? r.titulo : `Informe de control ${r.numero ?? r.codigo}`,
      detalle: [r.modalidad, r.responsabilidades?.length ? `Responsabilidad ${r.responsabilidades.join(", ").toLowerCase()}` : null, r.funcionarios ? `${r.funcionarios} funcionarios comprendidos` : null].filter(Boolean).join("; ") || null,
      severidad: sevInforme(r.responsabilidades), href: `${base}?seccion=control`, fuente: "Contraloría General de la República", enlace: r.url,
    });
  }
  for (const o of obr) {
    eventos.push({
      id: `obra:${o.codigo}`, carril: "obras", tipo: "obra", fecha: o.inicio, monto: num(o.monto),
      titulo: o.nombre ? `Empezó la obra «${o.nombre}»` : "Empezó una obra",
      detalle: [o.estado ? `Estado: ${o.estado.toLowerCase()}` : null, o.ejecutor && o.ejecutor_ruc?.startsWith("20") ? `La ejecuta ${titulo(o.ejecutor)}` : null].filter(Boolean).join("; ") || null,
      href: `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo),
    });
    if (o.paralizada && o.fecha_par) {
      eventos.push({
        id: `paralizada:${o.codigo}`, carril: "obras", tipo: "paralizada", fecha: o.fecha_par, severidad: "alta", monto: num(o.monto),
        titulo: o.nombre ? `Se paralizó la obra «${o.nombre}»` : "Se paralizó una obra",
        detalle: o.causal ? `Causa: ${o.causal}` : null, href: `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo),
      });
    }
  }
  for (const b of ban) {
    const empresa = /^20\d{9}$/.test(b.ruc) && b.proveedor ? titulo(b.proveedor) : "una persona natural";
    eventos.push({
      id: `bandera:${b.ocid}:${b.ruc}`, carril: "banderas", tipo: "contrato", fecha: b.fecha, monto: num(b.monto), severidad: sev(b.severidad),
      titulo: `Buena pro a ${empresa}${b.objeto ? ` (${b.objeto.toLowerCase()})` : ""}`,
      detalle: b.n_alta > 0 ? `${b.n_alta} ${b.n_alta === 1 ? "antecedente grave" : "antecedentes graves"} del ganador` : "Antecedentes del ganador",
      href: rutaContrato(b.ocid), fuente: "OECE y cruces de Vigía", enlace: procesoOece(b.ocid),
    });
  }

  // La ola que siguió a cada cambio de gestión: órdenes a personas, plazas CAS y altas en la planilla.
  const secuencias: SecuenciaHistoria[] = [
    ...olasDeGestion(personas, cambios, { tipo: "ola_personas", minimo: 30, que: "las órdenes a personas", href: `${base}?seccion=personas`, fuente: "CONOSCE (OECE)" }),
    ...olasDeGestion({ unidad: "convocatorias CAS", huecos: "cero", puntos: plz.map((r) => ({ periodo: r.mes, n: r.n })) }, cambios, { tipo: "ola_plazas", minimo: 10, que: "las plazas CAS", href: `${base}?seccion=plazas`, fuente: "SERVIR Talento Perú" }),
    ...olasDeGestion({ unidad: "personas que entraron", huecos: "sin_dato", puntos: pla.filter((r) => r.altas != null && !r.incompleto).map((r) => ({ periodo: r.mes, n: r.altas ?? 0 })) }, cambios, { tipo: "ola_planilla", minimo: 30, que: "las entradas a la planilla", href: `${base}?seccion=planilla`, fuente: "Portal de Transparencia Estándar" }),
  ];

  const { eventos: quedan, omitidos } = acotar(eventos, { control: 120, obras: 80, banderas: 120 }, fijosDe(secuencias, eventos));
  const primera = [...series.flatMap((s) => s.puntos.map((p) => (p.periodo.length === 4 ? `${p.periodo}-01` : `${p.periodo}-01`))), ...quedan.filter((e) => e.carril !== "gobierno").map((e) => e.fecha)].sort()[0];
  return {
    sujeto: { tipo: "entidad", id: ruc, nombre: ent.nombre },
    desde: primera && primera > DESDE ? `${primera.slice(0, 4)}-01-01` : DESDE,
    hasta,
    carriles: soloConDatos(CARRILES_ENTIDAD, series, quedan),
    series,
    eventos: quedan,
    marcas: marcas.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    secuencias,
    omitidos,
    fuentes: [
      { texto: "Procesos y órdenes en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Quién gobierna: Plataforma Electoral del JNE", href: PLATAFORMA_JNE },
      { texto: "Registro de Visitas en Línea", href: VISITAS_EN_LINEA },
    ],
  };
}

historiaRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const cuerpo = await memo.obtener(`entidad:${ruc}`, () => historiaEntidad(ruc));
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── Empresa ────────────────────────────────────────────────────────────────────────────────────

const CARRILES_EMPRESA: CarrilHistoria[] = [
  { clave: "empresa", titulo: "La empresa", explica: "Cuándo se fundó (SUNAT) y cuándo entraron sus socios, representantes y directivos (RNP), por su papel." },
  { clave: "compras", titulo: "Contratos que ganó", explica: "Las buenas pro que le dieron en procesos del SEACE (OECE), por mes; los puntos son los más grandes y los que tienen banderas." },
  { clave: "ordenes", titulo: "Órdenes que recibió", explica: "Sus órdenes de compra y de servicio en CONOSCE (OECE), por mes, desde 2018." },
  { clave: "menores", titulo: "Contratos menores", explica: "Sus contratos de hasta 8 UIT en el SEACE, por mes." },
  { clave: "visitas", titulo: "Visitas a entidades", explica: "Las visitas de su gente a entidades del Estado (Registro de Visitas en Línea), por mes." },
  { clave: "politica", titulo: "Política", explica: "Aportes de su gente a partidos (ONPE), lo que le vendió a campañas, candidaturas y cargos de elección (JNE)." },
  { clave: "banderas", titulo: "Contratos con banderas", explica: "Los contratos que ganó con antecedentes graves o medios, en la fecha de la buena pro." },
  { clave: "control", titulo: "Sanciones y penalidades", explica: "Las sanciones del Tribunal de Contrataciones (con su periodo) y las penalidades que le aplicaron las entidades." },
  { clave: "obras", titulo: "Obras que ejecutó", explica: "Las obras públicas donde figura como ejecutora (INFOBRAS)." },
];

const ROL_EMPRESA: Record<string, [string, string]> = {
  SOCIO_ACCIONISTA_TITULAR: ["un socio", "socios"],
  REPRESENTANTE_LEGAL: ["un representante legal", "representantes legales"],
  ORGANO_ADMINISTRACION: ["un directivo", "directivos"],
};

async function historiaEmpresa(ruc: string): Promise<Historia | null> {
  const [emp] = await filas<{ nombre: string | null; fundada: string | null; estado: string | null }>(
    "empresa",
    `SELECT COALESCE(r.nombre, e.razon_social) AS nombre, to_char(COALESCE(r.fecha_alta, e.fecha_alta_ruc), 'YYYY-MM-DD') AS fundada,
            COALESCE(r.estado_sunat, e.estado_sunat) AS estado
       FROM (SELECT $1::text AS ruc) k
       LEFT JOIN empresa_resumen r ON r.ruc = k.ruc
       LEFT JOIN empresas e ON e.ruc = k.ruc
      WHERE r.ruc IS NOT NULL OR e.ruc IS NOT NULL`, [ruc]);
  if (!emp) return null;
  const [adj, ord, men, san, pen, cru, vis, obr, soc, ban] = await Promise.all([
    filas<{ codigo: string; entidad_ruc: string | null; entidad: string | null; fecha: string | null; monto: number | null; referencial: number | null; descripcion: string | null; consorcio: string | null; ocid: string | null }>(
      "contratos",
      `WITH a AS (
         SELECT a.codigo_convocatoria, a.entidad_ruc, a.entidad, a.fecha_buenapro, a.monto_adjudicado, a.monto_referencial, a.moneda,
                a.descripcion_proceso, NULL::text AS consorcio
           FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1
         UNION ALL
         SELECT a.codigo_convocatoria, a.entidad_ruc, a.entidad, a.fecha_buenapro, a.monto_adjudicado, a.monto_referencial, a.moneda,
                a.descripcion_proceso, a.proveedor
           FROM conosce_adjudicaciones a
          WHERE a.ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = $1) AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
       ), pr AS (
         SELECT codigo_convocatoria AS codigo, entidad_ruc, max(entidad) AS entidad, to_char(max(fecha_buenapro), 'YYYY-MM-DD') AS fecha,
                sum(monto_adjudicado) FILTER (WHERE moneda IN ${SOLES})::float AS monto,
                sum(monto_referencial) FILTER (WHERE moneda IN ${SOLES})::float AS referencial,
                max(descripcion_proceso) AS descripcion, max(consorcio) AS consorcio
           FROM a GROUP BY 1, 2
       )
       SELECT pr.*, cv.ocid FROM pr
         LEFT JOIN LATERAL (SELECT c.ocid FROM convocatorias c WHERE c.codigo = pr.codigo AND c.entidad_ruc = pr.entidad_ruc LIMIT 1) cv ON true
        WHERE pr.fecha IS NOT NULL`, [ruc]),
    filas<{ mes: string; ordenes: number; monto: number; entidades: number }>(
      "órdenes por mes",
      `SELECT to_char(mes, 'YYYY-MM') AS mes, ordenes, monto::float AS monto, entidades FROM empresa_orden_mes WHERE ruc = $1 ORDER BY mes`, [ruc]),
    filas<{ mes: string; n: number; monto: number }>(
      "menores",
      `SELECT to_char(date_trunc('month', fecha_suscripcion), 'YYYY-MM') AS mes, count(*)::int AS n,
              COALESCE(sum(monto) FILTER (WHERE moneda IS NULL OR moneda ILIKE '%sol%' OR moneda = 'PEN'), 0)::float AS monto
         FROM seace_menores WHERE proveedor_ruc = $1 AND fecha_suscripcion IS NOT NULL GROUP BY 1 ORDER BY 1`, [ruc]),
    filas<{ id: number; tipo: string | null; desde: string | null; hasta: string | null; resolucion: string | null; fecha_res: string | null; multa: number | null; infraccion: string | null }>(
      "sanciones",
      `SELECT id, tipo, to_char(fecha_desde, 'YYYY-MM-DD') AS desde, to_char(fecha_hasta, 'YYYY-MM-DD') AS hasta, resolucion,
              to_char(fecha_resolucion, 'YYYY-MM-DD') AS fecha_res, monto_multa_soles::float AS multa, infraccion
         FROM osce_sancionados WHERE ruc = $1`, [ruc]),
    filas<{ id: number; fecha: string; entidad: string | null; monto: number | null; tipo: string | null; descripcion: string | null }>(
      "penalidades",
      `SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, entidad_contratante AS entidad, monto::float AS monto, tipo_penalidad AS tipo, descripcion
         FROM penalidades WHERE empresa_ruc = $1 AND fecha IS NOT NULL ORDER BY fecha DESC LIMIT 300`, [ruc]),
    filas<CruceSecuencia & { id: number }>(
      "cruces",
      `SELECT p.id, p.tipo, p.severidad, p.fecha, p.monto::float AS monto, p.ocid, p.detalle,
              cv.fecha_buena_pro AS buena_pro, cv.entidad, cv.codigo
         FROM cruces_proveedor p
         LEFT JOIN LATERAL (SELECT c.fecha_buena_pro, c.codigo, e.nombre AS entidad FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
                             WHERE p.ocid IS NOT NULL AND c.ocid = p.ocid LIMIT 1) cv ON true
        WHERE p.ruc_empresa = $1
          AND p.tipo IN ('aporte', 'proveedor_campana', 'candidato', 'autoridad', 'partido_gobernante', 'vendio_gobernante', 'visita_previa',
                         'recien_fundada_medio_ano', 'recien_fundada_un_ano', 'recien_fundada_dos_anos', 'empresa_espejo')
        LIMIT 3000`, [ruc]),
    filas<{ id: number; fecha: string; entidad: string | null; entidad_ruc: string | null; cargo: string | null; area: string | null }>(
      "visitas",
      `SELECT v.id, to_char(v.fecha_visita, 'YYYY-MM-DD') AS fecha, v.entidad_visitada AS entidad, ev.entidad_ruc,
              v.funcionario_cargo AS cargo, v.funcionario_area AS area
         FROM empresa_visita ev JOIN visitas_entidades v ON v.id = ev.visita_id
        WHERE ev.ruc = $1 AND v.fecha_visita IS NOT NULL
        ORDER BY v.fecha_visita DESC LIMIT 3000`, [ruc]),
    filas<{ codigo: number; nombre: string | null; inicio: string; monto: number | null; entidad: string | null; entidad_ruc: string | null; paralizada: boolean | null; fecha_par: string | null; causal: string | null }>(
      "obras",
      `SELECT codigo, nombre, to_char(fecha_inicio, 'YYYY-MM-DD') AS inicio, contrato_monto::float AS monto, entidad_nombre AS entidad, entidad_ruc,
              paralizada, to_char(fecha_paralizacion, 'YYYY-MM-DD') AS fecha_par, causal_paralizacion AS causal
         FROM obra_infobras WHERE ejecutor_ruc = $1 AND NOT retirada AND fecha_inicio IS NOT NULL
        ORDER BY contrato_monto DESC NULLS LAST LIMIT 200`, [ruc]),
    filas<{ fecha: string; rol: string; n: number }>(
      "socios",
      `SELECT to_char(fecha_inicio_vigencia, 'YYYY-MM-DD') AS fecha, tipo_rol AS rol, count(DISTINCT numero_documento)::int AS n
         FROM rnp_conformacion_juridica WHERE ruc_empresa = $1 AND fecha_inicio_vigencia IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1`, [ruc]),
    filas<{ ocid: string; entidad: string | null; objeto: string | null; fecha: string; monto: number | null; severidad: string; n_alta: number }>(
      "banderas",
      `SELECT ocid, entidad, objeto, to_char(fecha_buena_pro, 'YYYY-MM-DD') AS fecha, monto::float AS monto, severidad, n_alta
         FROM casos_cruce WHERE ruc = $1 AND severidad IN ('alta', 'media') AND fecha_buena_pro IS NOT NULL
        ORDER BY fecha_buena_pro DESC LIMIT 400`, [ruc]),
  ]);

  const hasta = hoy();
  const base = `/empresa/${ruc}`;
  const series: SerieHistoria[] = [];
  const eventos: EventoHistoria[] = [];

  // Los contratos: la serie por mes (sin el monto de los que parecen mal cargados) y, como hechos, cada uno.
  const porMes = new Map<string, { n: number; monto: number }>();
  for (const a of adj) {
    const mes = a.fecha!.slice(0, 7);
    const ref = a.referencial ?? 0;
    const m = a.monto ?? 0;
    const dudoso = (ref <= 1 && m > 100_000) || (ref > 1 && m >= 20 * ref && m > 1_000_000);
    const x = porMes.get(mes) ?? { n: 0, monto: 0 };
    x.n += 1;
    x.monto += dudoso ? 0 : m;
    porMes.set(mes, x);
    eventos.push({
      id: `contrato:${a.codigo}:${a.entidad_ruc ?? ""}`, carril: "compras", tipo: "buena_pro", fecha: a.fecha!, monto: dudoso ? null : num(a.monto),
      titulo: `Ganó la buena pro en ${a.entidad ? titulo(a.entidad) : "una entidad"}`,
      detalle: [a.descripcion, a.consorcio ? `En consorcio: ${titulo(a.consorcio)}` : null, dudoso ? "El monto adjudicado parece mal cargado en el OECE: no se suma" : null].filter(Boolean).join("; ") || null,
      href: a.ocid ? rutaContrato(a.ocid) : `${base}?seccion=ventas&vista=contratos`, fuente: "OECE (CONOSCE)", enlace: a.ocid ? procesoOece(a.ocid) : CONOSCE_BUSCADOR,
    });
  }
  const meses = [...porMes.keys()].sort();
  if (meses.length) series.push({ carril: "compras", titulo: "Contratos ganados", medida: "n", unidad: "contratos", huecos: "cero", puntos: meses.map((m) => ({ periodo: m, ...porMes.get(m)! })), fuente: "OECE (CONOSCE)", enlace: CONOSCE_BUSCADOR, href: `${base}?seccion=ventas&vista=contratos` });
  if (ord.length) series.push({ carril: "ordenes", titulo: "Órdenes recibidas", medida: "n", unidad: "órdenes", extra: "entidades", huecos: "cero", puntos: ord.map((r) => ({ periodo: r.mes, n: r.ordenes, monto: r.monto, extra: r.entidades })), fuente: "CONOSCE (OECE)", enlace: CONOSCE_BUSCADOR, href: `${base}?seccion=ventas&vista=ordenes` });
  if (men.length) series.push({ carril: "menores", titulo: "Contratos menores", medida: "n", unidad: "contratos menores", huecos: "cero", puntos: men.map((r) => ({ periodo: r.mes, n: r.n, monto: r.monto })), fuente: "SEACE (contratos menores)", href: `${base}?seccion=ventas&vista=menores` });

  // Las visitas: la serie por mes y, como hechos, las que fueron antes de un contrato con esa entidad (visita previa) o las
  // más recientes. De quien la recibió, sólo su cargo y su área.
  const visMes = new Map<string, number>();
  for (const v of vis) visMes.set(v.fecha.slice(0, 7), (visMes.get(v.fecha.slice(0, 7)) ?? 0) + 1);
  if (visMes.size) series.push({ carril: "visitas", titulo: "Visitas a entidades", medida: "n", unidad: "visitas", huecos: "cero", puntos: [...visMes.keys()].sort().map((m) => ({ periodo: m, n: visMes.get(m)! })), fuente: "Registro de Visitas en Línea", enlace: VISITAS_EN_LINEA, href: `${base}?seccion=gente&vista=visitas` });
  for (const v of vis) {
    eventos.push({
      id: `visita:${v.id}`, carril: "visitas", tipo: "visita", fecha: v.fecha,
      titulo: `Visitó ${v.entidad ? titulo(v.entidad) : "una entidad"}`,
      detalle: v.cargo || v.area ? `Lo recibió: ${[v.cargo, v.area].filter(Boolean).join(", ")}` : null,
      href: v.entidad_ruc ? `/entidad/${v.entidad_ruc}` : `${base}?seccion=gente&vista=visitas`, fuente: "Registro de Visitas en Línea", enlace: VISITAS_EN_LINEA,
    });
  }

  if (emp.fundada) {
    eventos.push({ id: "fundacion", carril: "empresa", tipo: "fundacion", fecha: emp.fundada, titulo: "Se fundó (inscripción en el RUC)", detalle: emp.estado ? `Estado en SUNAT hoy: ${emp.estado.toLowerCase()}` : null, fuente: "SUNAT", enlace: CONSULTA_RUC_SUNAT });
  }
  for (const s of soc) {
    const [uno, varios] = ROL_EMPRESA[s.rol] ?? ["una persona", "personas"];
    eventos.push({ id: `rnp:${s.fecha}:${s.rol}`, carril: "empresa", tipo: "conformacion", fecha: s.fecha, titulo: s.n === 1 ? `Entró ${uno}` : `Entraron ${s.n} ${varios}`, detalle: "Fecha de inicio en su conformación jurídica del RNP", href: `${base}?seccion=gente&vista=socios`, fuente: "Registro Nacional de Proveedores (OECE)", enlace: DATASET_SOCIOS_RNP });
  }

  for (const s of san) {
    const desde = s.desde ?? s.fecha_res;
    if (!desde) continue;
    const multa = s.tipo === "multa" || (s.multa ?? 0) > 0;
    eventos.push({
      id: `sancion:${s.id}`, carril: "control", tipo: multa ? "multa" : "sancion", fecha: desde, hasta: multa ? null : s.hasta,
      titulo: multa ? "Multa del Tribunal de Contrataciones" : s.tipo === "definitivo" ? "Inhabilitada para siempre por el Tribunal" : "Inhabilitada por el Tribunal de Contrataciones",
      detalle: [s.resolucion ? `Resolución ${s.resolucion}` : null, s.infraccion ? s.infraccion.replace(/^[-\s]*[a-z]\)\s*/i, "") : null].filter(Boolean).join("; ") || null,
      monto: num(s.multa), severidad: multa ? "baja" : s.tipo === "definitivo" ? "alta" : "media",
      href: `${base}?seccion=antecedentes`, fuente: "Tribunal de Contrataciones (OECE)", enlace: DATASET_SANCIONADOS,
    });
  }
  for (const p of pen) {
    eventos.push({
      id: `penalidad:${p.id}`, carril: "control", tipo: "penalidad", fecha: p.fecha, monto: num(p.monto), severidad: "baja",
      titulo: `Penalidad de ${p.entidad ? titulo(p.entidad) : "una entidad"}`, detalle: p.tipo ?? p.descripcion,
      href: `${base}?seccion=antecedentes`, fuente: "Penalidades (OECE)", enlace: DATASET_PENALIDADES,
    });
  }

  // La política: los aportes y las campañas, una vez cada uno (un cruce se repite por cada contrato y cada persona).
  const vistos = new Set<string>();
  for (const x of cru) {
    const d = (x.detalle ?? {}) as Record<string, unknown>;
    const f = dia(x.fecha);
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    let e: EventoHistoria | null = null;
    if ((x.tipo === "aporte" || (x.tipo === "partido_gobernante" && s("via") === "aporte")) && f && s("partido")) {
      e = { id: `aporte:${f}:${s("partido")}:${x.monto ?? ""}`, carril: "politica", tipo: "aporte", fecha: f, monto: num(x.monto), titulo: `Aporte de su gente a ${titulo(s("partido"))}`, detalle: "Un socio, representante o directivo de la empresa", fuente: "ONPE (aportes)", enlace: CLARIDAD_ONPE, href: `${base}?seccion=antecedentes` };
    } else if ((x.tipo === "proveedor_campana" || (x.tipo === "vendio_gobernante" && s("via") === "proveedor_campana")) && fechaEleccion(s("proceso")) && s("organizacion")) {
      e = { id: `campana:${s("proceso")}:${s("organizacion")}`, carril: "politica", tipo: "campana", fecha: fechaEleccion(s("proceso"))!, monto: num(x.monto), titulo: `Le vendió a la campaña de ${titulo(s("organizacion"))}`, detalle: `${s("proceso")} (gastos de campaña declarados a la ONPE)`, fuente: "ONPE (gastos de campaña)", enlace: CLARIDAD_ONPE, href: `${base}?seccion=antecedentes` };
    } else if (x.tipo === "candidato" && fechaEleccion(s("proceso"))) {
      e = { id: `candidato:${s("proceso")}:${s("organizacion")}`, carril: "politica", tipo: "candidatura", fecha: fechaEleccion(s("proceso"))!, severidad: "media", titulo: `Alguien de su gente postuló${s("organizacion") ? ` por ${titulo(s("organizacion"))}` : ""}`, detalle: s("proceso"), fuente: "JNE", enlace: PLATAFORMA_JNE, href: `${base}?seccion=antecedentes` };
    } else if (x.tipo === "autoridad" && f) {
      e = { id: `autoridad:${f}:${s("cargo")}`, carril: "politica", tipo: "autoridad", fecha: f, hasta: dia(d.hasta), severidad: "alta", titulo: `Alguien de su gente es ${s("cargo")?.toLowerCase() ?? "autoridad electa"}`, detalle: [s("organizacion") ? titulo(s("organizacion")) : null, s("departamento") ? titulo(s("departamento")) : null].filter(Boolean).join(", ") || null, fuente: "JNE", enlace: PLATAFORMA_JNE, href: `${base}?seccion=antecedentes` };
    }
    if (e && !vistos.has(e.id)) {
      vistos.add(e.id);
      eventos.push(e);
    }
  }

  for (const o of obr) {
    eventos.push({ id: `obra:${o.codigo}`, carril: "obras", tipo: "obra", fecha: o.inicio, monto: num(o.monto), titulo: o.nombre ? `Empezó la obra «${o.nombre}»` : "Empezó una obra", detalle: o.entidad ? `Para ${titulo(o.entidad)}` : null, href: o.entidad_ruc ? `/entidad/${o.entidad_ruc}?seccion=obras` : `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo) });
    if (o.paralizada && o.fecha_par) {
      eventos.push({ id: `paralizada:${o.codigo}`, carril: "obras", tipo: "paralizada", fecha: o.fecha_par, severidad: "alta", monto: num(o.monto), titulo: o.nombre ? `Se paralizó la obra «${o.nombre}»` : "Se paralizó una obra", detalle: o.causal ? `Causa: ${o.causal}` : null, href: `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo) });
    }
  }
  for (const b of ban) {
    eventos.push({ id: `bandera:${b.ocid}`, carril: "banderas", tipo: "contrato", fecha: b.fecha, monto: num(b.monto), severidad: sev(b.severidad), titulo: `Buena pro en ${b.entidad ? titulo(b.entidad) : "una entidad"}${b.objeto ? ` (${b.objeto.toLowerCase()})` : ""}`, detalle: b.n_alta > 0 ? `${b.n_alta} ${b.n_alta === 1 ? "antecedente grave" : "antecedentes graves"}` : "Antecedentes medios", href: rutaContrato(b.ocid), fuente: "OECE y cruces de Vigía", enlace: procesoOece(b.ocid) });
  }

  const secuencias = secuenciasDeCruces(cru, rutaContrato);
  const { eventos: quedan, omitidos } = acotar(eventos, { compras: 150, visitas: 80, control: 100, politica: 80, obras: 60, banderas: 120, empresa: 60 }, fijosDe(secuencias, eventos));
  const primera = [...series.flatMap((s) => s.puntos.map((p) => `${p.periodo}-01`)), ...quedan.map((e) => e.fecha)].sort()[0];
  return {
    sujeto: { tipo: "empresa", id: ruc, nombre: emp.nombre },
    desde: primera ? `${primera.slice(0, 4)}-01-01` : DESDE,
    hasta,
    carriles: soloConDatos(CARRILES_EMPRESA, series, quedan),
    series,
    eventos: quedan,
    marcas: marcasEleccion(primera ? `${primera.slice(0, 4)}-01-01` : DESDE, hasta),
    secuencias,
    omitidos,
    fuentes: [
      { texto: "Sus procesos en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Su ficha en la SUNAT", href: CONSULTA_RUC_SUNAT },
      { texto: "Aportes y gastos de campaña (ONPE)", href: CLARIDAD_ONPE },
    ],
  };
}

historiaRouter.get("/empresa/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  // Sólo empresas (RUC 20): una persona natural tiene su propio perfil, y su RUC 10 nunca va en una URL.
  if (!/^20\d{9}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const cuerpo = await memo.obtener(`empresa:${ruc}`, async () => {
    const h = await historiaEmpresa(ruc);
    // Por si un nombre de persona llegó en un texto (una razón social que es un nombre): publicar() lo tapa.
    return h ? publicar({ ...h, visitasHasta: await visitasHasta() }) : null;
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── Partido ────────────────────────────────────────────────────────────────────────────────────

const CARRILES_PARTIDO: CarrilHistoria[] = [
  { clave: "gobierno", titulo: "Dónde gobernó", explica: "Cuántos gobiernos regionales, provinciales y distritales ganó en cada elección (JNE)." },
  { clave: "compras", titulo: "Procesos en sus gobiernos", explica: "Los procesos que convocaron las entidades que gobernaba, por mes (OECE)." },
  { clave: "banderas", titulo: "Procesos con banderas", explica: "De esos procesos, los que tienen señales de riesgo, por mes." },
  { clave: "politica", titulo: "Aportes y campañas", explica: "Los aportes que recibió, por mes, y lo que gastó en cada campaña (ONPE)." },
];
const NIVEL_PLURAL: Record<string, [string, string]> = {
  regional: ["gobierno regional", "gobiernos regionales"],
  provincial: ["municipalidad provincial", "municipalidades provinciales"],
  distrital: ["municipalidad distrital", "municipalidades distritales"],
};

async function historiaPartido(clave: string): Promise<Historia | null> {
  const [p] = await filas<{ nombre: string | null }>(
    "partido",
    `SELECT COALESCE((SELECT org_nombre FROM gobierno_periodo WHERE org_clave = $1 LIMIT 1),
                     (SELECT org_clave FROM partido_resumen_mes WHERE org_clave = $1 LIMIT 1)) AS nombre`, [clave]);
  if (!p?.nombre) return null;
  const [gob, meses, aportes, gastos] = await Promise.all([
    filas<{ anio: number; nivel: string; n: number; desde: string; hasta: string }>(
      "gobiernos",
      `SELECT anio_eleccion AS anio, nivel, count(*)::int AS n, to_char(min(desde), 'YYYY-MM-DD') AS desde, to_char(max(hasta), 'YYYY-MM-DD') AS hasta
         FROM gobierno_periodo WHERE org_clave = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [clave]),
    filas<{ mes: string; procesos: number; monto: number; con_senales: number }>(
      "procesos por mes",
      `SELECT mes, sum(procesos)::int AS procesos, COALESCE(sum(monto_pen), 0)::float AS monto, sum(con_senales)::int AS con_senales
         FROM partido_resumen_mes WHERE org_clave = $1 AND mes ~ '^\\d{4}-\\d{2}' GROUP BY 1 ORDER BY 1`, [clave]),
    filas<{ mes: string; n: number; monto: number }>(
      "aportes",
      `SELECT to_char(date_trunc('month', fecha_aporte), 'YYYY-MM') AS mes, count(*)::int AS n, COALESCE(sum(monto), 0)::float AS monto
         FROM onpe_aportantes
        WHERE mef_norm(partido) IN (mef_norm($1), mef_norm($1) || ' DEL PERU') AND fecha_aporte >= DATE '2014-01-01' AND fecha_aporte <= current_date
        GROUP BY 1 ORDER BY 1`, [p.nombre]),
    filas<{ proceso: string; n: number; monto: number; proveedores: number }>(
      "gastos de campaña",
      `SELECT proceso, count(*)::int AS n, COALESCE(sum(monto), 0)::float AS monto, count(DISTINCT documento)::int AS proveedores
         FROM onpe_gastos_proveedores WHERE mef_norm(organizacion) = mef_norm($1) GROUP BY 1`, [p.nombre]),
  ]);

  const hasta = hoy();
  const base = `/app/partidos/${encodeURIComponent(clave)}`;
  const series: SerieHistoria[] = [];
  const meses2 = meses.map((r) => ({ ...r, mes: r.mes.slice(0, 7) }));
  if (meses2.length) {
    series.push({ carril: "compras", titulo: "Procesos en sus gobiernos", medida: "n", unidad: "procesos", huecos: "cero", puntos: meses2.map((r) => ({ periodo: r.mes, n: r.procesos, monto: r.monto })), fuente: "OECE (CONOSCE) y JNE", href: `${base}?seccion=procesos` });
    series.push({ carril: "banderas", titulo: "Procesos con banderas", medida: "n", unidad: "procesos con señales", huecos: "cero", puntos: meses2.map((r) => ({ periodo: r.mes, n: r.con_senales })), fuente: "Vigía", href: `${base}?seccion=procesos` });
  }
  if (aportes.length) series.push({ carril: "politica", titulo: "Aportes recibidos", medida: "monto", unidad: "aportes", huecos: "cero", puntos: aportes.map((r) => ({ periodo: r.mes, n: r.n, monto: r.monto })), fuente: "ONPE (aportes)", enlace: CLARIDAD_ONPE });

  const eventos: EventoHistoria[] = [];
  const porAnio = new Map<number, typeof gob>();
  for (const g of gob) porAnio.set(g.anio, [...(porAnio.get(g.anio) ?? []), g]);
  for (const [anio, gs] of porAnio) {
    const total = gs.reduce((s, g) => s + g.n, 0);
    eventos.push({
      id: `gobiernos:${anio}`, carril: "gobierno", tipo: "periodo", fecha: gs[0].desde, hasta: gs[0].hasta,
      titulo: `Gobernó ${total} ${total === 1 ? "entidad" : "entidades"} (elegido en ${anio})`,
      detalle: gs.map((g) => `${g.n} ${(NIVEL_PLURAL[g.nivel] ?? [g.nivel, g.nivel])[g.n === 1 ? 0 : 1]}`).join(", "),
      href: `${base}?seccion=gobiernos`, fuente: "JNE (Infogob)", enlace: PLATAFORMA_JNE,
    });
  }
  for (const g of gastos) {
    const f = fechaEleccion(g.proceso);
    if (!f) continue;
    eventos.push({ id: `gasto:${g.proceso}`, carril: "politica", tipo: "campana", fecha: f, monto: g.monto, titulo: `Campaña ${g.proceso}: gastos declarados`, detalle: `${g.n} gastos a ${g.proveedores} proveedores`, fuente: "ONPE (gastos de campaña)", enlace: CLARIDAD_ONPE });
  }
  const primera = [...series.flatMap((s) => s.puntos.map((x) => `${x.periodo}-01`)), ...eventos.map((e) => e.fecha)].sort()[0];
  const desde = primera && primera > DESDE ? `${primera.slice(0, 4)}-01-01` : DESDE;
  return {
    sujeto: { tipo: "partido", id: clave, nombre: p.nombre },
    desde,
    hasta,
    carriles: soloConDatos(CARRILES_PARTIDO, series, eventos),
    series,
    eventos: eventos.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    marcas: marcasEleccion(desde, hasta),
    secuencias: [],
    omitidos: {},
    fuentes: [
      { texto: "Plataforma Electoral del JNE", href: PLATAFORMA_JNE },
      { texto: "Claridad (ONPE): aportes y gastos de campaña", href: CLARIDAD_ONPE },
    ],
  };
}

historiaRouter.get("/partido/:clave", async (c) => {
  const clave = c.req.param("clave");
  if (!/^[a-z0-9-]{2,120}$/.test(clave)) return c.json({ error: "invalid_clave" }, 400);
  const cuerpo = await memo.obtener(`partido:${clave}`, () => historiaPartido(clave));
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
