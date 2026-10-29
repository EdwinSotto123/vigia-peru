import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { pareceEmpresa, publicar } from "../lib/privacidad.js";
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
  enlaceFuente,
  obraInfobras,
  procesoOece,
} from "../lib/fuentes.js";
import { ETIQUETA_CRUCE } from "../lib/cruces.js";
import {
  acotar,
  armarHilos,
  cualDespues,
  dia,
  fechaEleccion,
  textoEleccion,
  marcasEleccion,
  olasDeGestion,
  patronesDeSeries,
  secuenciasDeCruces,
  sevDespues,
  type VisitaHilo,
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
 *   GET /historia/contrato/:ocid el proceso (convocatoria, ofertas, buena pro, consentimiento, contrato y su vigencia), las
 *                                visitas de la gente del ganador a la entidad, sus antecedentes en la fecha de cada hecho,
 *                                sus sanciones y penalidades, su fundación y la obra que ejecuta (INFOBRAS).
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

/** Como `filas`, pero si la primera consulta falla (una tabla precalculada que todavía no está) usa la segunda. */
async function filasOAlterna<T extends object>(nombre: string, sql: string, alterna: string, args: unknown[]): Promise<T[]> {
  try {
    return (await pool.query<T>(sql, args)).rows;
  } catch {
    return filas<T>(nombre, alterna, args);
  }
}

/**
 * Desde y hasta cuándo cubre cada fuente (en toda la base), para pintar «sin datos» lo de afuera: las órdenes de CONOSCE
 * empiezan en 2018, la planilla del PTE en 2025, de SERVIR sólo están las plazas vigentes… Una vez cada seis horas.
 */
type Rango = { desde: string | null; hasta: string | null };
let coberturaMemo: { t: number; c: Record<string, Rango> } | null = null;
async function cobertura(): Promise<Record<string, Rango>> {
  if (coberturaMemo && Date.now() - coberturaMemo.t < 6 * 3600_000) return coberturaMemo.c;
  const [r] = await filas<Record<string, string | null>>(
    "cobertura",
    `SELECT (SELECT to_char(min(mes), 'YYYY-MM') FROM entidad_orden_mes) AS ord_desde,
            (SELECT to_char(max(mes), 'YYYY-MM') FROM entidad_orden_mes) AS ord_hasta,
            (SELECT to_char(min(mes), 'YYYY-MM') FROM planilla_entidad_mes) AS pla_desde,
            (SELECT to_char(max(mes), 'YYYY-MM') FROM planilla_entidad_mes) AS pla_hasta,
            (SELECT to_char(min(fecha_inicio), 'YYYY-MM') FROM servir_convocatoria) AS plz_desde,
            (SELECT to_char(max(fecha_inicio), 'YYYY-MM') FROM servir_convocatoria) AS plz_hasta,
            (SELECT to_char(max(fecha_convocatoria), 'YYYY-MM') FROM convocatorias WHERE fecha_convocatoria <= current_date + 31) AS conv_hasta,
            (SELECT to_char(min(mes), 'YYYY-MM') FROM entidad_visita_mes) AS vis_desde,
            (SELECT to_char(max(mes), 'YYYY-MM') FROM entidad_visita_mes) AS vis_hasta,
            (SELECT min(anio)::text FROM mef_ejecutora_anual) AS mef_desde,
            (SELECT max(anio)::text FROM mef_ejecutora_anual) AS mef_hasta,
            (SELECT min(anio)::text || '-01' FROM conosce_adjudicaciones) AS adj_desde,
            (SELECT to_char(min(fecha_emision), 'YYYY-MM') FROM informes_control) AS ctl_desde,
            (SELECT to_char(max(fecha_emision), 'YYYY-MM') FROM informes_control) AS ctl_hasta,
            (SELECT to_char(min(fecha_suscripcion), 'YYYY-MM') FROM seace_menores WHERE fecha_suscripcion >= DATE '2015-01-01') AS men_desde,
            (SELECT to_char(max(fecha_suscripcion), 'YYYY-MM') FROM seace_menores WHERE fecha_suscripcion <= current_date) AS men_hasta`, []);
  const c: Record<string, Rango> = r
    ? {
        ordenes: { desde: r.ord_desde, hasta: r.ord_hasta },
        planilla: { desde: r.pla_desde, hasta: r.pla_hasta },
        plazas: { desde: r.plz_desde, hasta: r.plz_hasta },
        convocatorias: { desde: "2015-01", hasta: r.conv_hasta },
        visitas: { desde: r.vis_desde, hasta: r.vis_hasta },
        presupuesto: { desde: r.mef_desde, hasta: r.mef_hasta },
        adjudicaciones: { desde: r.adj_desde, hasta: r.ord_hasta },
        control: { desde: r.ctl_desde, hasta: r.ctl_hasta },
        menores: { desde: r.men_desde, hasta: r.men_hasta },
      }
    : {};
  if (r) coberturaMemo = { t: Date.now(), c };
  return c;
}

/** Les pone a los renglones lo que cubre su fuente (los que no se conocen quedan sin marca). */
function conCobertura(carriles: CarrilHistoria[], cubre: Partial<Record<Carril, { rango?: Rango; que: string }>>): CarrilHistoria[] {
  return carriles.map((c) => {
    const x = cubre[c.clave];
    return x?.rango?.desde && x.rango.hasta ? { ...c, cubre: { desde: x.rango.desde, hasta: x.rango.hasta, que: x.que } } : c;
  });
}

/** La fecha `dias` días antes de otra (AAAA-MM-DD). */
const diasAntes = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const hoy = () => new Date().toISOString().slice(0, 10);
const titulo = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/(^|[\s(«"/-])([a-záéíóúñü])/g, (_, p: string, l: string) => p + l.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|El|Y|E|En|Por|Para|A|Al)\b/g, (w) => w.toLowerCase())
    // Las siglas con puntos («S.A.C.», «E.I.R.L.», «S.R.L.») en mayúsculas: «e.i.r.l.» no es como se escriben.
    .replace(/\b[a-záéíóúñ](?:\.[a-záéíóúñ])+\.?/gi, (m) => m.toUpperCase())
    .replace(/^./, (l) => l.toUpperCase())
    .trim();
/** «a los 13 días» / «el mismo día». */
const aLos = (dias: number) => (dias === 0 ? "el mismo día" : `a los ${dias} ${dias === 1 ? "día" : "días"}`);
const sev =(v: unknown): Severidad | null => (v === "alta" || v === "media" || v === "baja" ? v : null);
/** Siglas que se leen en las descripciones del SEACE (todo viene en mayúsculas: al pasarlo a minúsculas se perdían). */
const SIGLAS_SEACE =
  /\b(essalud|incor|cui|uit|minsa|sis|ugel|ipress|inen|insn|pnp|mtc|mef|oece|osce|seace|sunat|sunarp|reniec|onp|inpe|devida|pronabec|pronied|digesa|digemid|cenares|diresa|geresa|dre|gore|ee\.ss|epp|covid|vih|tbc)\b/gi;
/** Una descripción del SEACE en una frase de a lo sumo `max` letras (entera, en la ficha del contrato). */
const corto = (s: string | null | undefined, max = 180): string | null => {
  // El SEACE trae las comillas convertidas en «¿» («¿ADQUISICION DE ECOCARDIOGRAFO¿»): sin un «?» no es una pregunta.
  const c = (s ?? "").replace(/[«»“”"]/g, "");
  const t = (c.includes("?") ? c : c.replace(/¿/g, "")).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const o = (t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).replace(SIGLAS_SEACE, (x) => x.toUpperCase());
  return o.length > max ? `${o.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : o;
};

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
  { clave: "visitas", titulo: "Visitas que recibió", explica: "Las visitas de cada mes (cuántas empresas distintas y cuántas a quien decide las compras) y, como puntos, las de la gente de empresas que después recibieron algo." },
  { clave: "banderas", titulo: "Contratos con banderas", explica: "Los contratos cuyo ganador tiene antecedentes graves o medios, en la fecha de la buena pro." },
  { clave: "control", titulo: "Control", explica: "Los informes de la Contraloría sobre la entidad." },
  { clave: "obras", titulo: "Obras", explica: "Las obras que inició (INFOBRAS) y las que se paralizaron." },
  { clave: "presupuesto", titulo: "Presupuesto", explica: "Su presupuesto de cada año (PIM) y cuánto gastó (devengado), según el MEF." },
];

const CARGO_NIVEL: Record<string, string> = { regional: "Gobernador regional", provincial: "Alcalde provincial", distrital: "Alcalde distrital" };
/** Cómo se dice cada responsabilidad que señala un informe (los códigos del buscador de la Contraloría). */
const RESPONSABILIDAD: Record<string, string> = {
  penal: "penal",
  civil: "civil",
  administrativa_entidad: "administrativa (la sanciona la entidad)",
  administrativa_pas: "administrativa (la sanciona la Contraloría)",
  administrativa: "administrativa",
};
const oracion = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null);

/** Los antecedentes de un contrato con banderas (casos_cruce.cruces), con su nombre y su gravedad: los graves primero. */
function banderasDeCruces(cruces: { tipo: string; severidad: string; n?: number }[] | null): NonNullable<EventoHistoria["banderas"]> {
  const PESO: Record<string, number> = { alta: 0, media: 1, baja: 2 };
  return (cruces ?? [])
    .filter((x) => x.tipo && ETIQUETA_CRUCE[x.tipo])
    .sort((x, y) => (PESO[x.severidad] ?? 3) - (PESO[y.severidad] ?? 3))
    .map((x) => ({ tipo: x.tipo, texto: ETIQUETA_CRUCE[x.tipo], severidad: sev(x.severidad) ?? "baja", n: x.n ?? null }));
}

/** «El ganador tenía un antecedente grave: obra con adicionales sobre el tope.» (antes, «1 antecedente grave» sin decir cuál). */
function decirBanderas(banderas: NonNullable<EventoHistoria["banderas"]>, quien: string): string {
  const graves = banderas.filter((x) => x.severidad === "alta");
  const xs = graves.length ? graves : banderas;
  if (!xs.length) return "Tiene antecedentes que Vigía marca.";
  const nombres = xs.map((x) => x.texto.charAt(0).toLowerCase() + x.texto.slice(1)).join("; ");
  if (!graves.length) return `${quien} ${xs.length === 1 ? "un antecedente" : `${xs.length} antecedentes`}: ${nombres}.`;
  return `${quien} ${graves.length === 1 ? "un antecedente grave" : `${graves.length} antecedentes graves`}: ${nombres}.`;
}

/** «N más en Contratos con banderas»: contra el total real de cada mes, no contra la muestra que se pidió. */
function conTotalDeBanderas(omitidos: Partial<Record<Carril, number>>, quedan: EventoHistoria[], porMes: { n: number }[]): void {
  const total = porMes.reduce((s, r) => s + r.n, 0);
  const vistos = quedan.filter((e) => e.carril === "banderas").length;
  if (total > vistos) omitidos.banderas = total - vistos;
  else delete omitidos.banderas;
}

/** Lo que se contrató, el tipo y el código del proceso, en el orden del detalle. */
function datosContrato(objeto: string | null, tipo: string | null, codigo: string | null): NonNullable<EventoHistoria["datos"]> {
  return [
    // En el detalle hay sitio: hasta 500 letras (la ficha del contrato la tiene entera).
    objeto ? { etiqueta: "Qué se contrató", valor: corto(objeto, 500)! } : null,
    tipo ? { etiqueta: "Tipo", valor: oracion(tipo)! } : null,
    codigo ? { etiqueta: "Proceso", valor: codigo } : null,
  ].filter((x): x is { etiqueta: string; valor: string } => !!x);
}
/** Las responsabilidades de un informe de control, de la más grave a la menos. */
function sevInforme(resp: unknown): Severidad {
  const r = (Array.isArray(resp) ? resp.join(" ") : String(resp ?? "")).toUpperCase();
  return /PENAL/.test(r) ? "alta" : /CIVIL/.test(r) ? "media" : "baja";
}

async function historiaEntidad(ruc: string): Promise<Historia | null> {
  const [ent] = await filas<{ nombre: string | null }>("entidad", `SELECT e.nombre FROM entidades e WHERE e.ruc::text = $1`, [ruc]);
  if (!ent) return null;
  const [gobLocal, nacional, conv, ord, pla, plz, vis, inf, obr, ban, banMes, mef] = await Promise.all([
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
    // Las visitas por mes, precalculadas (migración 205): contadas en vivo pasaban los 10 s en las entidades grandes y el
    // renglón desaparecía sin aviso. Con cuántas empresas distintas y cuántas fueron a quien decide las compras.
    filasOAlterna<{ mes: string; n: number; empresas: number | null; decisores: number | null }>(
      "visitas",
      `SELECT to_char(mes, 'YYYY-MM') AS mes, visitas AS n, empresas, decisores FROM entidad_visita_mes WHERE entidad_ruc = $1 ORDER BY mes`,
      `SELECT to_char(date_trunc('month', v.fecha_visita), 'YYYY-MM') AS mes, count(*)::int AS n, NULL::int AS empresas, NULL::int AS decisores
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
    filas<{ ocid: string; ruc: string; proveedor: string | null; objeto: string | null; tipo: string | null; fecha: string; monto: number | null; severidad: string; n_alta: number; tipos: string[]; cruces: { tipo: string; severidad: string; n?: number }[] | null; codigo: string | null }>(
      "banderas",
      `SELECT b.*, COALESCE(n.nomenclatura, b.convocatoria) AS codigo
         FROM (SELECT * FROM (
                 SELECT ocid, ruc, proveedor, objeto, tipo_contratacion AS tipo, to_char(fecha_buena_pro, 'YYYY-MM-DD') AS fecha, monto::float AS monto,
                        severidad, n_alta, tipos, cruces, codigo AS convocatoria, fecha_buena_pro,
                        row_number() OVER (PARTITION BY date_part('year', fecha_buena_pro)
                                           ORDER BY (severidad = 'alta') DESC, n_alta DESC, monto DESC NULLS LAST) AS rn
                   FROM casos_cruce WHERE entidad_ruc = $1 AND severidad IN ('alta', 'media') AND fecha_buena_pro IS NOT NULL) x
                WHERE rn <= 14) b
         LEFT JOIN LATERAL (SELECT a.nomenclatura FROM conosce_adjudicaciones a
                             WHERE a.codigo_convocatoria = b.convocatoria AND a.nomenclatura IS NOT NULL LIMIT 1) n ON true
        ORDER BY b.fecha_buena_pro DESC`, [ruc]),
    filas<{ mes: string; n: number; altas: number }>(
      "banderas por mes",
      `SELECT to_char(date_trunc('month', fecha_buena_pro), 'YYYY-MM') AS mes, count(*)::int AS n,
              count(*) FILTER (WHERE severidad = 'alta')::int AS altas
         FROM casos_cruce WHERE entidad_ruc = $1 AND severidad IN ('alta', 'media') AND fecha_buena_pro IS NOT NULL
        GROUP BY 1 ORDER BY 1`, [ruc]),
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
  serie({
    carril: "visitas", titulo: "Visitas registradas", medida: "n", unidad: "visitas", extra: "empresas distintas", extra2: "a quien decide las compras",
    huecos: "cero", puntos: vis.map((r) => ({ periodo: r.mes, n: r.n, extra: r.empresas, extra2: r.decisores })),
    fuente: "Registro de Visitas en Línea", enlace: VISITAS_EN_LINEA, href: `${base}?seccion=visitas`,
  });
  // Cuántos contratos con banderas tuvo cada mes (los puntos son sólo los más graves de cada año).
  serie({
    carril: "banderas", titulo: "Contratos con banderas", medida: "n", unidad: "contratos con banderas", extra: "con algún antecedente grave",
    huecos: "cero", puntos: banMes.map((r) => ({ periodo: r.mes, n: r.n, extra: r.altas })),
    fuente: "OECE y cruces de Vigía", href: `${base}?seccion=contratos&vista=contratos`,
  });
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
    // El que asumió el 28 de julio de 2026 (su resultado oficial no está en la base): «el Presidente elegido en las EG 2026».
    const sinNombre = /^Elegido/i.test(p.presidente);
    const quien = sinNombre ? `el Presidente ${p.presidente.charAt(0).toLowerCase()}${p.presidente.slice(1)}` : p.presidente;
    eventos.push({
      id: `presidente:${p.desde}`, carril: "gobierno", tipo: "presidente", fecha: p.desde, hasta: sig,
      titulo: sinNombre ? `Presidente ${p.presidente.charAt(0).toLowerCase()}${p.presidente.slice(1)}` : p.presidente,
      detalle: sinNombre ? "Asumió el 28 de julio de 2026" : p.como === "sucesion" ? "Asumió por sucesión" : "Elegido en las elecciones generales",
      fuente: "Gobierno nacional", enlace: null,
    });
    if (p.desde > DESDE && p.desde <= hasta) {
      marcas.push({ fecha: p.desde, tipo: "gobierno", texto: `Asumió ${quien}` });
      // Un Presidente de menos de 60 días (Merino) no es una gestión que pueda traer una ola.
      if (!sig || (Date.parse(sig) - Date.parse(p.desde)) / 86_400_000 >= 60) cambios.push({ fecha: p.desde, quien });
    }
  });
  marcas.push(...marcasEleccion(DESDE, hasta, nacional.length ? "general" : gobLocal.length ? "regional" : undefined));

  for (const r of inf) {
    eventos.push({
      id: `informe:${r.codigo}`, carril: "control", tipo: "informe", fecha: r.fecha,
      titulo: r.titulo ? r.titulo : `Informe de control ${r.numero ?? r.codigo}`,
      detalle: [
        oracion(r.modalidad),
        r.responsabilidades?.length ? `Responsabilidad ${r.responsabilidades.map((x) => RESPONSABILIDAD[x] ?? x.replace(/_/g, " ")).join(", ")}` : null,
        r.funcionarios ? `${r.funcionarios} ${r.funcionarios === 1 ? "funcionario comprendido" : "funcionarios comprendidos"}` : null,
      ].filter(Boolean).join("; ") || null,
      severidad: sevInforme(r.responsabilidades), href: `${base}?seccion=control`, fuente: "Contraloría General de la República", enlace: r.url,
      datos: [
        r.numero ? { etiqueta: "Informe", valor: r.numero } : null,
        r.modalidad ? { etiqueta: "Modalidad", valor: oracion(r.modalidad)! } : null,
        r.responsabilidades?.length ? { etiqueta: "Responsabilidad", valor: r.responsabilidades.map((x) => RESPONSABILIDAD[x] ?? x.replace(/_/g, " ")).join(", ") } : null,
        r.funcionarios ? { etiqueta: "Funcionarios comprendidos", valor: String(r.funcionarios) } : null,
      ].filter((x): x is { etiqueta: string; valor: string } => !!x),
    });
  }
  for (const o of obr) {
    eventos.push({
      id: `obra:${o.codigo}`, carril: "obras", tipo: "obra", fecha: o.inicio, monto: num(o.monto),
      titulo: o.nombre ? `Empezó la obra «${o.nombre}»` : "Empezó una obra",
      detalle: [o.estado ? `Estado: ${o.estado.toLowerCase()}` : null, o.ejecutor && o.ejecutor_ruc?.startsWith("20") ? `La ejecuta ${titulo(o.ejecutor)}` : null].filter(Boolean).join("; ") || null,
      href: `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo),
      quien: o.ejecutor && o.ejecutor_ruc?.startsWith("20") ? { nombre: titulo(o.ejecutor), rol: "La ejecuta", href: `/empresa/${o.ejecutor_ruc}?seccion=obras` } : null,
      datos: [o.estado ? { etiqueta: "Estado", valor: oracion(o.estado)! } : null, { etiqueta: "Código INFOBRAS", valor: String(o.codigo) }]
        .filter((x): x is { etiqueta: string; valor: string } => !!x),
    });
    if (o.paralizada && o.fecha_par) {
      eventos.push({
        id: `paralizada:${o.codigo}`, carril: "obras", tipo: "paralizada", fecha: o.fecha_par, severidad: "alta", monto: num(o.monto),
        titulo: o.nombre ? `Se paralizó la obra «${o.nombre}»` : "Se paralizó una obra",
        detalle: o.causal ? `Causa: ${o.causal}` : null, href: `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo),
        quien: o.ejecutor && o.ejecutor_ruc?.startsWith("20") ? { nombre: titulo(o.ejecutor), rol: "La ejecutaba", href: `/empresa/${o.ejecutor_ruc}?seccion=obras` } : null,
        datos: o.causal ? [{ etiqueta: "Por qué se paralizó", valor: o.causal }] : [],
      });
    }
  }
  for (const b of ban) {
    const esEmpresa = /^20\d{9}$/.test(b.ruc) && !!b.proveedor;
    const empresa = esEmpresa ? titulo(b.proveedor) : "una persona natural";
    const banderas = banderasDeCruces(b.cruces);
    eventos.push({
      id: `bandera:${b.ocid}:${b.ruc}`, carril: "banderas", tipo: "contrato", fecha: b.fecha, monto: num(b.monto), severidad: sev(b.severidad),
      titulo: `Buena pro${b.tipo ? ` de ${b.tipo.toLowerCase()}` : ""} a ${empresa}`,
      detalle: decirBanderas(banderas, "El ganador tenía"),
      // Una persona natural no se nombra ni se enlaza (su RUC 10 nunca va en una URL).
      quien: { nombre: esEmpresa ? empresa : "Una persona natural", rol: "Ganó la buena pro", href: esEmpresa ? `/empresa/${b.ruc}?seccion=antecedentes` : null },
      datos: datosContrato(b.objeto, b.tipo, b.codigo),
      banderas,
      href: rutaContrato(b.ocid), fuente: "OECE y cruces de Vigía", enlace: procesoOece(b.ocid),
    });
  }

  // Las empresas cuya gente la visitó (migraciones 203 y 204): las que recibieron algo después y las que además tienen
  // contratos con banderas u obras (para los hilos). Sin nombres de quienes visitan.
  const rucsOtros = [...new Set([...ban.map((b) => b.ruc), ...obr.map((o) => o.ejecutor_ruc ?? "")].filter((r) => /^20\d{9}$/.test(r)))];
  const vemp = await filas<VisitaHilo>(
    "empresas de quienes la visitan",
    `SELECT e.ruc, r.nombre, to_char(e.primera, 'YYYY-MM-DD') AS primera, to_char(e.ultima, 'YYYY-MM-DD') AS ultima,
            e.visitas, e.visitantes, e.decisores, e.antes, to_char(e.despues, 'YYYY-MM-DD') AS despues, e.dias, e.despues_tipo,
            e.despues_numero, e.despues_detalle, e.despues_monto::float AS despues_monto, e.despues_ocid, e.monto::float AS monto
       FROM entidad_visita_empresa e LEFT JOIN empresa_resumen r ON r.ruc = e.ruc
      WHERE e.entidad_ruc = $1 AND (e.despues IS NOT NULL OR e.ruc = ANY($2::text[]))
      ORDER BY (e.antes = 0) DESC, e.monto DESC NULLS LAST LIMIT 1500`, [ruc, rucsOtros]);
  const rucsHilos = [...new Set([...rucsOtros, ...vemp.filter((v) => v.despues).map((v) => v.ruc)])];
  const sanciones = rucsHilos.length
    ? await filas<{ ruc: string; tipo: string | null; desde: string | null; hasta: string | null }>(
        "sanciones",
        `SELECT ruc, tipo, to_char(fecha_desde, 'YYYY-MM-DD') AS desde, to_char(fecha_hasta, 'YYYY-MM-DD') AS hasta
           FROM osce_sancionados WHERE ruc = ANY($1::text[]) AND fecha_desde IS NOT NULL`, [rucsHilos])
    : [];
  const empresaRuta = (r: string, vista?: string) =>
    vista === "visitas" ? `/empresa/${r}?seccion=gente&vista=visitas` : vista ? `/empresa/${r}?seccion=${vista}` : `/empresa/${r}`;
  // Cada visita que terminó en algo dentro de los 180 días: un hecho en el renglón de visitas, en la fecha de la última
  // visita antes de lo que le dieron (lo más grave y lo más grande primero; acotar deja los que caben).
  const ganaron = vemp.filter((v) => v.despues && v.dias != null && v.dias <= 180);
  // Las que van como secuencia («Lo que llama la atención») no se repiten como punto en el renglón de visitas.
  const enSecuencia = new Set(
    ganaron.filter((v) => v.antes === 0 && v.dias! <= 90 && (v.decisores > 0 || (v.despues_monto ?? 0) >= 50_000))
      .sort((a, b) => Number(sevDespues(b) === "alta") - Number(sevDespues(a) === "alta") || (b.despues_monto ?? 0) - (a.despues_monto ?? 0))
      .slice(0, 6).map((v) => v.ruc),
  );
  for (const v of ganaron.filter((x) => !enSecuencia.has(x.ruc))) {
    const nombre = v.nombre ? titulo(v.nombre) : `la empresa ${v.ruc}`;
    eventos.push({
      id: `visita_gano:${v.ruc}`, carril: "visitas", tipo: "visita_gano", fecha: diasAntes(v.despues!, v.dias!),
      titulo: `La gente de ${nombre} la visitó; ${aLos(v.dias!)} le dieron ${cualDespues(v.despues_tipo, v.despues_numero)}`,
      detalle: [
        v.antes === 0 ? "Nunca le había vendido antes de esas visitas" : "Ya le vendía antes",
        v.decisores > 0 ? `${v.decisores} ${v.decisores === 1 ? "visita" : "visitas"} a quien decide las compras` : null,
        v.despues_detalle ? `Lo que le dieron: «${corto(v.despues_detalle)}»` : null,
      ].filter(Boolean).join("; "),
      monto: v.despues_monto, severidad: sevDespues(v), href: empresaRuta(v.ruc, "visitas"),
      fuente: "Registro de Visitas en Línea y CONOSCE (OECE)", enlace: VISITAS_EN_LINEA,
      quien: { nombre, rol: "La visitó su gente", href: empresaRuta(v.ruc, "visitas") },
      datos: [
        { etiqueta: "Visitas", valor: `${v.visitas} de ${v.visitantes} ${v.visitantes === 1 ? "persona" : "personas"}, del ${v.primera} al ${diasAntes(v.despues!, v.dias!)}` },
        ...(v.decisores > 0 ? [{ etiqueta: "A quien decide las compras", valor: `${v.decisores} ${v.decisores === 1 ? "visita" : "visitas"}` }] : []),
        { etiqueta: "Lo que le dieron", valor: `${cualDespues(v.despues_tipo, v.despues_numero)} el ${v.despues}${v.despues_monto ? `, S/ ${Math.round(v.despues_monto).toLocaleString("es-PE")}` : ""}` },
        ...(v.despues_detalle ? [{ etiqueta: "Qué se compró", valor: corto(v.despues_detalle)! }] : []),
        { etiqueta: "Antes de las visitas", valor: v.antes === 0 ? "Nunca le había vendido" : "Ya le vendía" },
      ],
    });
  }
  // Las más fuertes, como secuencia (una cosa lleva a otra): nunca le había vendido, y a los 90 días o menos le dieron algo.
  const visitoYGano: SecuenciaHistoria[] = ganaron
    .filter((v) => v.antes === 0 && v.dias! <= 90 && (v.decisores > 0 || (v.despues_monto ?? 0) >= 50_000))
    .sort((a, b) => Number(sevDespues(b) === "alta") - Number(sevDespues(a) === "alta") || (b.despues_monto ?? 0) - (a.despues_monto ?? 0))
    .slice(0, 6)
    .map((v) => {
      const nombre = v.nombre ? titulo(v.nombre) : `La empresa ${v.ruc}`;
      const ultima = diasAntes(v.despues!, v.dias!);
      const sev = sevDespues(v);
      return {
        id: `visito_gano:${v.ruc}`, tipo: "visito_gano", severidad: sev === "baja" ? "media" : sev,
        titulo: `${nombre}: su gente la visitó y ${aLos(v.dias!)} le dieron ${cualDespues(v.despues_tipo, v.despues_numero)}`,
        explica:
          `Nunca le había vendido antes de esas visitas${v.decisores > 0 ? "; fueron a quien decide las compras" : ""}. ` +
          `${v.despues_detalle ? `Lo que le dieron: «${corto(v.despues_detalle)}». ` : ""}Una visita no prueba un favor: es para revisar.`,
        pasos: [
          { fecha: v.primera, texto: `Primera visita de su gente (${v.visitas} ${v.visitas === 1 ? "visita" : "visitas"} en total)` },
          ...(ultima > v.primera ? [{ fecha: ultima, texto: "Última visita antes de lo que le dieron" }] : []),
          { fecha: v.despues!, texto: `Le dieron ${cualDespues(v.despues_tipo, v.despues_numero)}${v.despues_monto ? ` por S/ ${Math.round(v.despues_monto).toLocaleString("es-PE")}` : ""}` },
        ],
        href: empresaRuta(v.ruc, "visitas"),
        fuente: "Registro de Visitas en Línea y CONOSCE (OECE)",
      };
    });

  // La ola que siguió a cada cambio de gestión: órdenes a personas, plazas CAS y altas en la planilla.
  const secuencias: SecuenciaHistoria[] = [
    ...visitoYGano,
    ...olasDeGestion(personas, cambios, {
      tipo: "ola_personas", minimo: 30, que: "las órdenes a personas", href: `${base}?seccion=personas`, fuente: "CONOSCE (OECE)",
      // Contra sus demás órdenes en los mismos meses: que no sea que todo creció.
      otros: ord.map((r) => ({ periodo: r.mes, n: r.ordenes - r.a_personas })),
    }),
    ...olasDeGestion({ unidad: "convocatorias CAS", huecos: "cero", puntos: plz.map((r) => ({ periodo: r.mes, n: r.n })) }, cambios, { tipo: "ola_plazas", minimo: 10, que: "las plazas CAS", href: `${base}?seccion=plazas`, fuente: "SERVIR Talento Perú" }),
    ...olasDeGestion({ unidad: "personas que entraron", huecos: "sin_dato", puntos: pla.filter((r) => r.altas != null && !r.incompleto).map((r) => ({ periodo: r.mes, n: r.altas ?? 0 })) }, cambios, { tipo: "ola_planilla", minimo: 30, que: "las entradas a la planilla", href: `${base}?seccion=planilla`, fuente: "Portal de Transparencia Estándar" }),
  ];

  const enLinea = eventos.filter((e) => e.carril === "gobierno" || e.fecha >= DESDE || (e.hasta ?? "") >= DESDE);
  const { eventos: quedan, omitidos } = acotar(enLinea, { control: 120, obras: 80, banderas: 120, visitas: 80 }, fijosDe(secuencias, enLinea));
  // Los contratos con banderas que no van como punto son todos los demás (no sólo los de la muestra por año).
  conTotalDeBanderas(omitidos, quedan, banMes);
  const primera = [...series.flatMap((s) => s.puntos.map((p) => (p.periodo.length === 4 ? `${p.periodo}-01` : `${p.periodo}-01`))), ...quedan.filter((e) => e.carril !== "gobierno").map((e) => e.fecha)].sort()[0];
  return {
    sujeto: { tipo: "entidad", id: ruc, nombre: ent.nombre },
    desde: primera && primera > DESDE ? `${primera.slice(0, 4)}-01-01` : DESDE,
    hasta,
    carriles: carrilesEntidad(soloConDatos(CARRILES_ENTIDAD, series, quedan), await cobertura(), vis[0]?.mes ?? null),
    series,
    eventos: quedan,
    marcas: marcas.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    secuencias,
    // Los hilos: cada empresa con lo que pasó entre ella y la entidad (visitas, lo que le dieron, banderas, obras,
    // sanciones), si junta dos clases de hechos o más. Y los patrones de sus series (picos, cierre del año, elecciones).
    hilos: armarHilos(
      { visitas: vemp, banderas: ban.map((b) => ({ ...b, n_alta: b.n_alta ?? 0 })), obras: obr.map((o) => ({ ...o, codigo: o.codigo })), sanciones },
      { contrato: rutaContrato, empresa: empresaRuta },
    ),
    patrones: patronesDeSeries(series, marcas),
    omitidos,
    fuentes: [
      { texto: "Procesos y órdenes en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Quién gobierna: Plataforma Electoral del JNE", href: PLATAFORMA_JNE },
      { texto: "Registro de Visitas en Línea", href: VISITAS_EN_LINEA },
      { texto: "Sanciones del Tribunal de Contrataciones (OECE)", href: DATASET_SANCIONADOS },
    ],
  };
}

/**
 * Los renglones de una entidad con lo que cubre cada fuente y, si de su planilla, sus visitas o su presupuesto no hay
 * nada, ese renglón igual, en rojo y diciendo por qué (antes desaparecía y no se sabía si faltaba o si no había nada).
 * Las visitas empiezan cuando empieza SU registro: antes, no sabemos.
 */
function carrilesEntidad(carriles: CarrilHistoria[], cob: Record<string, Rango>, primerMesVisitas: string | null): CarrilHistoria[] {
  const con = conCobertura(carriles, {
    compras: { rango: cob.convocatorias, que: "las convocatorias del SEACE" },
    ordenes: { rango: cob.ordenes, que: "las órdenes de CONOSCE" },
    personas: { rango: cob.ordenes, que: "las órdenes de CONOSCE" },
    planilla: { rango: cob.planilla, que: "el personal del Portal de Transparencia" },
    plazas: { rango: cob.plazas, que: "las plazas CAS de SERVIR (sólo las vigentes)" },
    visitas: { rango: primerMesVisitas ? { desde: primerMesVisitas, hasta: cob.visitas?.hasta ?? null } : cob.visitas, que: "su registro de visitas" },
    control: { rango: cob.control, que: "los informes de la Contraloría" },
    presupuesto: { rango: cob.presupuesto, que: "el presupuesto del MEF" },
  });
  const hay = new Set(con.map((c) => c.clave));
  const faltan: CarrilHistoria[] = [
    !hay.has("planilla") && { clave: "planilla" as Carril, titulo: "Planilla", explica: "Cuánta gente publicó cada mes en el Portal de Transparencia.", sinDatos: "No tenemos su planilla: no la encontramos publicada en el Portal de Transparencia Estándar." },
    !hay.has("visitas") && { clave: "visitas" as Carril, titulo: "Visitas que recibió", explica: "Las visitas de su registro, por mes.", sinDatos: "No tenemos su registro de visitas: no está en los registros que cargamos (la plataforma de la PCM y el del Congreso)." },
    !hay.has("presupuesto") && { clave: "presupuesto" as Carril, titulo: "Presupuesto", explica: "Su presupuesto de cada año según el MEF.", sinDatos: "No tenemos su presupuesto: no la encontramos en el SIAF del MEF." },
  ].filter(Boolean) as CarrilHistoria[];
  // En su lugar de siempre (la planilla junto a las órdenes), no al final.
  const orden = (c: CarrilHistoria) => CARRILES_ENTIDAD.findIndex((x) => x.clave === c.clave);
  return [...con, ...faltan].sort((a, b) => orden(a) - orden(b));
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
/** Los papeles de una persona en la empresa, del más alto al más bajo. */
const ORDEN_ROL = ["REPRESENTANTE_LEGAL", "SOCIO_ACCIONISTA_TITULAR", "ORGANO_ADMINISTRACION"];
const PAPEL: Record<string, string> = { REPRESENTANTE_LEGAL: "representante legal", SOCIO_ACCIONISTA_TITULAR: "socio", ORGANO_ADMINISTRACION: "directivo" };
/** Cómo quedó ligada una visita a la empresa (migración 117): por el DNI de su gente o porque dijo venir de ella. */
const VIA_VISITA: Record<string, string> = {
  representante: "Su representante legal",
  socio: "Su socio",
  directivo: "Su directivo",
  nombre: "Dijo venir de la empresa",
};
const listaY = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
/** «21 de julio de 2023». */
const fechaLarga = (d: string) => {
  const [a, m, dd] = d.slice(0, 10).split("-").map(Number);
  return `${dd} de ${MESES_LARGO[m - 1]} de ${a}`;
};
const oracionMayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «09:40» de un «09:40:00». */
const hora = (h: string | null) => (h ? h.slice(0, 5) : null);
/** Dónde se ejerce (o se postuló a) un cargo: el distrito, la provincia o la región, según su nivel. */
function lugarDelCargo(cargo: string | null, distrito: string | null, provincia: string | null, region: string | null): string | null {
  const c = (cargo ?? "").toUpperCase();
  if (/DISTRITAL/.test(c)) return distrito ?? provincia;
  if (/PROVINCIAL/.test(c)) return provincia;
  if (/REGIONAL|GOBERNADOR|CONSEJER/.test(c)) return region;
  return null;
}
/** La elección de una candidatura del JNE por su año y su cargo (el registro no trae el proceso). */
function eleccionDe(anio: number | null, cargo: string | null): string | null {
  if (!anio) return null;
  if (anio === 2020) return "ECE2020";
  return /CONGRES|PRESIDENT|PARLAMENT/i.test(cargo ?? "") ? `EG${anio}` : `ERM${anio}`;
}

/**
 * `registro`: las personas que nombra (su gente y quienes la visitaron), para que publicar() les tape un apellido en toda
 * la respuesta; no se devuelve (va en su `extra`).
 */
async function historiaEmpresa(ruc: string): Promise<(Historia & { registro: unknown }) | null> {
  const [emp] = await filas<{ nombre: string | null; fundada: string | null; estado: string | null }>(
    "empresa",
    `SELECT COALESCE(r.nombre, e.razon_social) AS nombre, to_char(COALESCE(r.fecha_alta, e.fecha_alta_ruc), 'YYYY-MM-DD') AS fundada,
            COALESCE(r.estado_sunat, e.estado_sunat) AS estado
       FROM (SELECT $1::text AS ruc) k
       LEFT JOIN empresa_resumen r ON r.ruc = k.ruc
       LEFT JOIN empresas e ON e.ruc = k.ruc
      WHERE r.ruc IS NOT NULL OR e.ruc IS NOT NULL`, [ruc]);
  if (!emp) return null;
  // Su gente (las personas de su conformación jurídica en el RNP) entra en las consultas de aportes, candidaturas,
  // autoridades y visitas por su DNI, que nunca sale de aquí: los hechos dicen QUIÉN fue (su nombre, tapado por
  // publicar(), y su papel en la empresa). Pedido del 2026-10-29: «faltan varios detalles, mencionar quién hizo esa acción».
  const GENTE = `SELECT numero_documento FROM rnp_conformacion_juridica WHERE ruc_empresa = $1 AND numero_documento ~ '^[0-9]{8}$'`;
  const [adj, ord, men, san, pen, cru, vis, obr, soc, ban, banMes, gen, aut, cand, apo] = await Promise.all([
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
    // Quién fue (el visitante: su DNI sólo para saber su papel en la empresa) y cómo fue la visita. De quien la recibió,
    // sólo su cargo y su área: nunca su nombre.
    filas<{ id: number; fecha: string; entidad: string | null; entidad_ruc: string | null; cargo: string | null; area: string | null; visitante: string | null; doc: string | null; via: string; motivo: string | null; entra: string | null; sale: string | null; minutos: number | null; lugar: string | null }>(
      "visitas",
      `SELECT v.id, to_char(v.fecha_visita, 'YYYY-MM-DD') AS fecha, v.entidad_visitada AS entidad, ev.entidad_ruc,
              v.funcionario_cargo AS cargo, v.funcionario_area AS area, v.visitante, v.numero_documento AS doc, ev.via, v.motivo,
              v.hora_ingreso::text AS entra, v.hora_salida::text AS sale, v.duracion_min AS minutos, v.lugar_especifico AS lugar
         FROM empresa_visita ev JOIN visitas_entidades v ON v.id = ev.visita_id
        WHERE ev.ruc = $1 AND v.fecha_visita IS NOT NULL
        ORDER BY v.fecha_visita DESC LIMIT 3000`, [ruc]),
    filas<{ codigo: number; nombre: string | null; inicio: string; monto: number | null; entidad: string | null; entidad_ruc: string | null; paralizada: boolean | null; fecha_par: string | null; causal: string | null }>(
      "obras",
      `SELECT codigo, nombre, to_char(fecha_inicio, 'YYYY-MM-DD') AS inicio, contrato_monto::float AS monto, entidad_nombre AS entidad, entidad_ruc,
              paralizada, to_char(fecha_paralizacion, 'YYYY-MM-DD') AS fecha_par, causal_paralizacion AS causal
         FROM obra_infobras WHERE ejecutor_ruc = $1 AND NOT retirada AND fecha_inicio IS NOT NULL
        ORDER BY contrato_monto DESC NULLS LAST LIMIT 200`, [ruc]),
    filas<{ fecha: string; rol: string; n: number; nombres: string[] | null }>(
      "socios",
      `SELECT to_char(fecha_inicio_vigencia, 'YYYY-MM-DD') AS fecha, tipo_rol AS rol, count(DISTINCT numero_documento)::int AS n,
              array_agg(DISTINCT nombre) FILTER (WHERE nombre IS NOT NULL) AS nombres
         FROM rnp_conformacion_juridica WHERE ruc_empresa = $1 AND fecha_inicio_vigencia IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1`, [ruc]),
    filas<{ ocid: string; entidad: string | null; entidad_ruc: string | null; objeto: string | null; tipo: string | null; fecha: string; monto: number | null; severidad: string; n_alta: number; cruces: { tipo: string; severidad: string; n?: number }[] | null; codigo: string | null }>(
      "banderas",
      `SELECT b.*, COALESCE(n.nomenclatura, b.convocatoria) AS codigo
         FROM (SELECT * FROM (
                 SELECT ocid, entidad, entidad_ruc, objeto, tipo_contratacion AS tipo, to_char(fecha_buena_pro, 'YYYY-MM-DD') AS fecha, monto::float AS monto,
                        severidad, n_alta, cruces, codigo AS convocatoria, fecha_buena_pro,
                        row_number() OVER (PARTITION BY date_part('year', fecha_buena_pro)
                                           ORDER BY (severidad = 'alta') DESC, n_alta DESC, monto DESC NULLS LAST) AS rn
                   FROM casos_cruce WHERE ruc = $1 AND severidad IN ('alta', 'media') AND fecha_buena_pro IS NOT NULL) x
                WHERE rn <= 14) b
         LEFT JOIN LATERAL (SELECT a.nomenclatura FROM conosce_adjudicaciones a
                             WHERE a.codigo_convocatoria = b.convocatoria AND a.nomenclatura IS NOT NULL LIMIT 1) n ON true
        ORDER BY b.fecha_buena_pro DESC`, [ruc]),
    filas<{ mes: string; n: number; altas: number }>(
      "banderas por mes",
      `SELECT to_char(date_trunc('month', fecha_buena_pro), 'YYYY-MM') AS mes, count(*)::int AS n,
              count(*) FILTER (WHERE severidad = 'alta')::int AS altas
         FROM casos_cruce WHERE ruc = $1 AND severidad IN ('alta', 'media') AND fecha_buena_pro IS NOT NULL
        GROUP BY 1 ORDER BY 1`, [ruc]),
    filas<{ doc: string; nombre: string | null; roles: string[] | null; desde: string | null }>(
      "su gente",
      `SELECT numero_documento AS doc, max(nombre) AS nombre, array_agg(DISTINCT tipo_rol) AS roles,
              to_char(min(fecha_inicio_vigencia), 'YYYY-MM-DD') AS desde
         FROM rnp_conformacion_juridica WHERE ruc_empresa = $1 AND numero_documento ~ '^[0-9]{8}$'
        GROUP BY numero_documento`, [ruc]),
    filas<{ doc: string; cargo: string | null; distrito: string | null; provincia: string | null; departamento: string | null; org: string | null; desde: string | null; hasta: string | null; proceso: string | null; vigente: boolean | null }>(
      "autoridades de su gente",
      `SELECT a.dni AS doc, a.cargo, a.distrito, a.provincia, a.departamento, a.organizacion_politica AS org,
              to_char(a.periodo_inicio, 'YYYY-MM-DD') AS desde, to_char(a.periodo_fin, 'YYYY-MM-DD') AS hasta, a.proceso, a.vigente
         FROM jne_autoridades a WHERE a.dni IN (${GENTE}) AND a.periodo_inicio IS NOT NULL`, [ruc]),
    filas<{ doc: string; cargo: string | null; partido: string | null; anio: number | null; resultado: string | null; region: string | null; provincia: string | null; distrito: string | null }>(
      "candidaturas de su gente",
      `SELECT c.numero_documento AS doc, c.cargo, c.partido, c."año" AS anio, c.resultado, c.region, c.provincia, c.distrito
         FROM jne_candidaturas c WHERE c.numero_documento IN (${GENTE})`, [ruc]),
    // Sin el receptor: en un aporte de campaña puede ser un candidato con nombre, y los aportes se dicen del partido.
    filas<{ doc: string; fecha: string | null; anio: number | null; monto: number | null; partido: string | null; tipo: string | null; proceso: string | null; nivel: string | null }>(
      "aportes de su gente",
      `SELECT o.numero_documento AS doc, to_char(o.fecha_aporte, 'YYYY-MM-DD') AS fecha, o."año" AS anio, o.monto::float AS monto, o.partido,
              o.tipo_aporte AS tipo, o.proceso, o.nivel
         FROM onpe_aportantes o WHERE o.numero_documento IN (${GENTE})`, [ruc]),
  ]);

  const hasta = hoy();
  const base = `/empresa/${ruc}`;
  const hrefGente = `${base}?seccion=gente&vista=socios`;
  // Cada persona de su gente por su DNI (que no sale de aquí): su nombre, sus papeles y desde cuándo está.
  const gente = new Map(gen.map((g) => [g.doc, g]));
  const papeles = (roles: string[] | null | undefined) => ORDEN_ROL.filter((r) => roles?.includes(r)).map((r) => PAPEL[r]);
  /** «Su representante legal, socio y directivo»: el rol del recuadro «quién» (nunca un cargo de elección: publicar() lo destaparía). */
  const rolDe = (roles: string[] | null | undefined) => {
    const p = papeles(roles);
    return p.length ? `Su ${listaY(p)}` : "De su gente";
  };
  /** «Su representante legal»: el papel más alto, para el título del hecho. */
  const sujetoDe = (roles: string[] | null | undefined) => {
    const p = papeles(roles)[0];
    return p ? `Su ${p}` : "Alguien de su gente";
  };
  const quienDe = (doc: string | null | undefined): NonNullable<EventoHistoria["quien"]> | null => {
    const g = doc ? gente.get(doc) : undefined;
    return g?.nombre ? { nombre: g.nombre, rol: rolDe(g.roles), href: hrefGente, tipo: "persona" } : null;
  };
  /** «En la empresa desde: 21 de julio de 2023»: un hecho de antes de entrar no es de su tiempo en la empresa. */
  const enLaEmpresa = (doc: string | null | undefined, fecha: string) => {
    const desde = doc ? gente.get(doc)?.desde : null;
    if (!desde) return [];
    return [{ etiqueta: "En la empresa desde", valor: desde > fecha ? `${fechaLarga(desde)} (después de esto)` : fechaLarga(desde) }];
  };
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
      detalle: [corto(a.descripcion), a.consorcio ? `En consorcio: ${titulo(a.consorcio)}` : null, dudoso ? "El monto adjudicado parece mal cargado en el OECE: no se suma" : null].filter(Boolean).join("; ") || null,
      quien: a.entidad ? { nombre: titulo(a.entidad), rol: "Le dio la buena pro", href: a.entidad_ruc ? `/entidad/${a.entidad_ruc}` : null, tipo: "entidad" } : null,
      datos: [
        ...(a.descripcion ? [{ etiqueta: "Qué se contrató", valor: corto(a.descripcion, 400)! }] : []),
        ...(a.referencial && a.referencial > 1 ? [{ etiqueta: "Valor referencial", valor: `S/ ${Math.round(a.referencial).toLocaleString("en-US")}` }] : []),
        ...(a.consorcio ? [{ etiqueta: "En consorcio", valor: titulo(a.consorcio) }] : []),
        ...(dudoso ? [{ etiqueta: "Ojo", valor: "El monto adjudicado parece mal cargado en el OECE: no se suma" }] : []),
        { etiqueta: "Proceso", valor: a.codigo },
      ],
      href: a.ocid ? rutaContrato(a.ocid) : `${base}?seccion=ventas&vista=contratos`, fuente: "OECE (CONOSCE)", enlace: a.ocid ? procesoOece(a.ocid) : CONOSCE_BUSCADOR,
    });
  }
  const meses = [...porMes.keys()].sort();
  if (meses.length) series.push({ carril: "compras", titulo: "Contratos ganados", medida: "n", unidad: "contratos", huecos: "cero", puntos: meses.map((m) => ({ periodo: m, ...porMes.get(m)! })), fuente: "OECE (CONOSCE)", enlace: CONOSCE_BUSCADOR, href: `${base}?seccion=ventas&vista=contratos` });
  if (ord.length) series.push({ carril: "ordenes", titulo: "Órdenes recibidas", medida: "n", unidad: "órdenes", extra: "entidades", huecos: "cero", puntos: ord.map((r) => ({ periodo: r.mes, n: r.ordenes, monto: r.monto, extra: r.entidades })), fuente: "CONOSCE (OECE)", enlace: CONOSCE_BUSCADOR, href: `${base}?seccion=ventas&vista=ordenes` });
  if (men.length) series.push({ carril: "menores", titulo: "Contratos menores", medida: "n", unidad: "contratos menores", huecos: "cero", puntos: men.map((r) => ({ periodo: r.mes, n: r.n, monto: r.monto })), fuente: "SEACE (contratos menores)", href: `${base}?seccion=ventas&vista=menores` });
  // Cuántos de sus contratos tuvieron banderas cada mes (los puntos son sólo los más graves de cada año).
  if (banMes.length) series.push({ carril: "banderas", titulo: "Contratos con banderas", medida: "n", unidad: "contratos con banderas", extra: "con algún antecedente grave", huecos: "cero", puntos: banMes.map((r) => ({ periodo: r.mes, n: r.n, extra: r.altas })), fuente: "OECE y cruces de Vigía", href: `${base}?seccion=ventas&vista=contratos` });

  // Las visitas: la serie por mes y, como hechos, las que fueron antes de un contrato con esa entidad (visita previa) o las
  // más recientes. De quien la recibió, sólo su cargo y su área.
  const visMes = new Map<string, number>();
  for (const v of vis) visMes.set(v.fecha.slice(0, 7), (visMes.get(v.fecha.slice(0, 7)) ?? 0) + 1);
  if (visMes.size) series.push({ carril: "visitas", titulo: "Visitas a entidades", medida: "n", unidad: "visitas", huecos: "cero", puntos: [...visMes.keys()].sort().map((m) => ({ periodo: m, n: visMes.get(m)! })), fuente: "Registro de Visitas en Línea", enlace: VISITAS_EN_LINEA, href: `${base}?seccion=gente&vista=visitas` });
  for (const v of vis) {
    // Quién fue: alguien de su gente (por su DNI: su nombre y su papel) o quien dijo venir de la empresa (su nombre).
    const deSuGente = v.via !== "nombre" ? quienDe(v.doc) : null;
    const quien = deSuGente ?? (v.visitante ? { nombre: v.visitante, rol: VIA_VISITA[v.via] ?? "Dijo venir de la empresa", href: `${base}?seccion=gente&vista=visitas`, tipo: "persona" as const } : null);
    const recibio = [v.cargo, v.area].filter(Boolean).map((x) => titulo(x)).join(", ");
    const horario = hora(v.entra) ? `${hora(v.entra)}${hora(v.sale) ? ` a ${hora(v.sale)}` : ""}${v.minutos != null && v.minutos > 0 ? ` (${v.minutos} min)` : ""}` : null;
    eventos.push({
      id: `visita:${v.id}`, carril: "visitas", tipo: "visita", fecha: v.fecha,
      titulo: `${deSuGente ? sujetoDe(gente.get(v.doc ?? "")?.roles) : v.via === "nombre" ? "Alguien de la empresa" : VIA_VISITA[v.via] ?? "Su gente"} visitó ${v.entidad ? titulo(v.entidad) : "una entidad"}`,
      detalle: recibio ? `Lo recibió: ${recibio}` : null,
      quien,
      datos: [
        { etiqueta: "Entidad", valor: v.entidad ? titulo(v.entidad) : "Sin dato" },
        ...(recibio ? [{ etiqueta: "Lo recibió", valor: recibio }] : []),
        ...(v.motivo ? [{ etiqueta: "Motivo", valor: corto(v.motivo, 160) ?? v.motivo }] : []),
        ...(horario ? [{ etiqueta: "Hora", valor: horario }] : []),
        ...(v.lugar ? [{ etiqueta: "Dónde", valor: titulo(v.lugar) }] : []),
        ...(deSuGente ? enLaEmpresa(v.doc, v.fecha) : []),
      ],
      href: v.entidad_ruc ? `/entidad/${v.entidad_ruc}` : `${base}?seccion=gente&vista=visitas`, fuente: "Registro de Visitas en Línea", enlace: VISITAS_EN_LINEA,
    });
  }

  if (emp.fundada) {
    eventos.push({ id: "fundacion", carril: "empresa", tipo: "fundacion", fecha: emp.fundada, titulo: "Se fundó (inscripción en el RUC)", detalle: emp.estado ? `Estado en SUNAT hoy: ${emp.estado.toLowerCase()}` : null, fuente: "SUNAT", enlace: CONSULTA_RUC_SUNAT });
  }
  for (const s of soc) {
    const [uno, varios] = ROL_EMPRESA[s.rol] ?? ["una persona", "personas"];
    // Quién entró: su nombre (una persona, tapado por publicar(); una empresa socia, entera, con su razón social).
    const nombres = (s.nombres ?? []).slice().sort();
    eventos.push({
      id: `rnp:${s.fecha}:${s.rol}`, carril: "empresa", tipo: "conformacion", fecha: s.fecha,
      titulo: s.n === 1 ? `Entró ${uno}` : `Entraron ${s.n} ${varios}`,
      detalle: "Fecha de inicio en su conformación jurídica del RNP",
      quien: s.n === 1 && nombres[0] ? { nombre: nombres[0], rol: oracionMayus(uno.replace(/^un /, "")), href: hrefGente, tipo: "persona" } : null,
      datos: [
        { etiqueta: "Como", valor: oracionMayus(s.n === 1 ? uno.replace(/^un /, "") : varios) },
        ...(s.n > 1 && nombres.length ? [{ etiqueta: "Quiénes", valor: listaY(nombres) }] : []),
        { etiqueta: "Desde", valor: fechaLarga(s.fecha) },
      ],
      href: hrefGente, fuente: "Registro Nacional de Proveedores (OECE)", enlace: DATASET_SOCIOS_RNP,
    });
  }

  for (const s of san) {
    const desde = s.desde ?? s.fecha_res;
    if (!desde) continue;
    const multa = s.tipo === "multa" || (s.multa ?? 0) > 0;
    eventos.push({
      id: `sancion:${s.id}`, carril: "control", tipo: multa ? "multa" : "sancion", fecha: desde, hasta: multa ? null : s.hasta,
      titulo: multa ? "Multa del Tribunal de Contrataciones" : s.tipo === "definitivo" ? "Inhabilitada para siempre por el Tribunal" : "Inhabilitada por el Tribunal de Contrataciones",
      detalle: [s.resolucion ? `Resolución ${s.resolucion}` : null, s.infraccion ? s.infraccion.replace(/^[-\s]*[a-z]\)\s*/i, "") : null].filter(Boolean).join("; ") || null,
      quien: { nombre: "Tribunal de Contrataciones del Estado (OECE)", rol: multa ? "Le puso la multa" : "La inhabilitó", href: null, tipo: "entidad" },
      datos: [
        ...(s.infraccion ? [{ etiqueta: "Por qué", valor: oracionMayus(s.infraccion.replace(/^[-\s]*[a-z]\)\s*/i, "").trim()) }] : []),
        ...(s.resolucion ? [{ etiqueta: "Resolución", valor: `${s.resolucion}${s.fecha_res ? `, del ${fechaLarga(s.fecha_res)}` : ""}` }] : []),
        ...(!multa ? [{ etiqueta: "Sin poder contratar con el Estado", valor: s.tipo === "definitivo" ? `Para siempre, desde el ${fechaLarga(desde)}` : `Del ${fechaLarga(desde)}${s.hasta ? ` al ${fechaLarga(s.hasta)}` : ""}` }] : []),
      ],
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

  // La política. Las ventas a una campaña salen de los cruces (son de la empresa); los aportes, las candidaturas y los cargos
  // de elección, de los registros de cada persona de su gente (ONPE y JNE, por su DNI), para decir quién fue, dónde y
  // por qué partido. Antes decían «Alguien de su gente es alcalde distrital», sin quién ni de dónde.
  const vistos = new Set<string>();
  const agregar = (e: EventoHistoria) => {
    if (vistos.has(e.id)) return;
    vistos.add(e.id);
    eventos.push(e);
  };
  for (const x of cru) {
    const d = (x.detalle ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    if ((x.tipo === "proveedor_campana" || (x.tipo === "vendio_gobernante" && s("via") === "proveedor_campana")) && fechaEleccion(s("proceso")) && s("organizacion")) {
      agregar({
        id: `campana:${s("proceso")}:${s("organizacion")}`, carril: "politica", tipo: "campana", fecha: fechaEleccion(s("proceso"))!, monto: num(x.monto),
        titulo: `Le vendió a la campaña de ${titulo(s("organizacion"))}`,
        detalle: `${s("proceso")} (gastos de campaña declarados a la ONPE)`,
        quien: { nombre: titulo(s("organizacion")), rol: "Le compró", href: null, tipo: "entidad" },
        datos: [
          { etiqueta: "Elección", valor: textoEleccion(s("proceso")) ?? s("proceso")! },
          { etiqueta: "Qué es", valor: "La organización declaró a la ONPE un gasto de campaña pagado a esta empresa" },
        ],
        fuente: "ONPE (gastos de campaña)", enlace: CLARIDAD_ONPE, href: `${base}?seccion=antecedentes`,
      });
    }
  }
  for (const a of aut) {
    const desde = dia(a.desde);
    const g = gente.get(a.doc);
    if (!desde || !g) continue;
    const lugar = lugarDelCargo(a.cargo, a.distrito, a.provincia, a.departamento);
    const cargo = (a.cargo ?? "autoridad electa").toLowerCase();
    agregar({
      id: `autoridad:${desde}:${a.cargo ?? ""}:${lugar ?? ""}`, carril: "politica", tipo: "autoridad", fecha: desde, hasta: dia(a.hasta), severidad: "alta",
      titulo: `${sujetoDe(g.roles)} es ${cargo}${lugar ? ` de ${titulo(lugar)}` : ""}`,
      detalle: [a.org ? titulo(a.org) : null, a.departamento ? titulo(a.departamento) : null].filter(Boolean).join(", ") || null,
      quien: quienDe(a.doc),
      datos: [
        { etiqueta: "Cargo", valor: oracionMayus(cargo) },
        { etiqueta: "Dónde", valor: [a.distrito, a.provincia, a.departamento].filter(Boolean).map((x) => titulo(x)).join(", ") || "Sin dato" },
        ...(a.org ? [{ etiqueta: "Partido", valor: titulo(a.org) }] : []),
        { etiqueta: "Periodo", valor: `${desde.slice(0, 4)} a ${a.hasta ? a.hasta.slice(0, 4) : "hoy"}` },
        ...(a.proceso ? [{ etiqueta: "Elegido en", valor: textoEleccion(a.proceso) ?? a.proceso }] : []),
        { etiqueta: "Hoy", valor: a.vigente ? "Sigue en el cargo" : "Ya dejó el cargo" },
        ...enLaEmpresa(a.doc, desde),
      ],
      fuente: "JNE", enlace: PLATAFORMA_JNE, href: `${base}?seccion=antecedentes`,
    });
  }
  for (const c of cand) {
    const g = gente.get(c.doc);
    const proceso = eleccionDe(c.anio, c.cargo);
    const fecha = fechaEleccion(proceso);
    if (!g || !fecha) continue;
    const lugar = lugarDelCargo(c.cargo, c.distrito, c.provincia, c.region);
    const cargo = (c.cargo ?? "").toLowerCase();
    const aQue = !cargo ? "" : cargo === "accesitario" ? " como accesitario" : ` a ${cargo}${lugar ? ` de ${titulo(lugar)}` : ""}`;
    agregar({
      id: `candidato:${proceso}:${c.cargo ?? ""}:${c.partido ?? ""}`, carril: "politica", tipo: "candidatura", fecha, severidad: "media",
      titulo: `${sujetoDe(g.roles)} postuló${aQue}${c.partido ? ` por ${titulo(c.partido)}` : ""}`,
      detalle: textoEleccion(proceso),
      quien: quienDe(c.doc),
      datos: [
        ...(cargo ? [{ etiqueta: "A qué postuló", valor: oracionMayus(cargo) }] : []),
        ...(lugar || c.region ? [{ etiqueta: "Dónde", valor: [c.distrito, c.provincia, c.region].filter(Boolean).map((x) => titulo(x)).join(", ") }] : []),
        ...(c.partido ? [{ etiqueta: "Partido", valor: titulo(c.partido) }] : []),
        { etiqueta: "Elección", valor: textoEleccion(proceso) ?? proceso! },
        ...(c.resultado ? [{ etiqueta: "Resultado", valor: c.resultado === "electo" ? "Fue elegido" : "No fue elegido" }] : []),
        ...enLaEmpresa(c.doc, fecha),
      ],
      fuente: "JNE", enlace: PLATAFORMA_JNE, href: `${base}?seccion=antecedentes`,
    });
  }
  for (const o of apo) {
    const g = gente.get(o.doc);
    const fecha = dia(o.fecha) ?? (o.anio ? `${o.anio}-12-31` : null);
    if (!g || !fecha || !o.partido) continue;
    const campana = o.nivel === "campaña";
    const anual = o.nivel === "anual";
    agregar({
      id: `aporte:${fecha}:${o.partido}:${o.monto ?? ""}`, carril: "politica", tipo: "aporte", fecha, monto: num(o.monto),
      titulo: `${sujetoDe(g.roles)} aportó a ${titulo(o.partido)}`,
      detalle: campana ? `Para su campaña${o.proceso ? ` (${textoEleccion(o.proceso)})` : ""}` : anual ? "Al partido, en su informe del año" : null,
      quien: quienDe(o.doc),
      datos: [
        { etiqueta: "Partido", valor: titulo(o.partido) },
        ...(o.tipo ? [{ etiqueta: "Cómo", valor: o.tipo === "efectivo" ? "En efectivo" : o.tipo === "especie" ? "En especie (bienes o servicios)" : oracionMayus(o.tipo) }] : []),
        ...(campana || anual
          ? [{ etiqueta: "Para qué", valor: campana ? `La campaña${o.proceso ? ` de las ${textoEleccion(o.proceso)}` : ""}` : `El partido (informe financiero de ${o.anio ?? fecha.slice(0, 4)})` }]
          : []),
        ...(dia(o.fecha) ? [] : [{ etiqueta: "Fecha", valor: "La ONPE no publica el día: va al cierre del año" }]),
        ...enLaEmpresa(o.doc, fecha),
      ],
      fuente: "ONPE (aportes)", enlace: CLARIDAD_ONPE, href: `${base}?seccion=antecedentes`,
    });
  }

  for (const o of obr) {
    eventos.push({ id: `obra:${o.codigo}`, carril: "obras", tipo: "obra", fecha: o.inicio, monto: num(o.monto), titulo: o.nombre ? `Empezó la obra «${o.nombre}»` : "Empezó una obra", detalle: o.entidad ? `Para ${titulo(o.entidad)}` : null, href: o.entidad_ruc ? `/entidad/${o.entidad_ruc}?seccion=obras` : `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo) });
    if (o.paralizada && o.fecha_par) {
      eventos.push({ id: `paralizada:${o.codigo}`, carril: "obras", tipo: "paralizada", fecha: o.fecha_par, severidad: "alta", monto: num(o.monto), titulo: o.nombre ? `Se paralizó la obra «${o.nombre}»` : "Se paralizó una obra", detalle: o.causal ? `Causa: ${o.causal}` : null, href: `${base}?seccion=obras`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo) });
    }
  }
  for (const b of ban) {
    const banderas = banderasDeCruces(b.cruces);
    eventos.push({
      id: `bandera:${b.ocid}`, carril: "banderas", tipo: "contrato", fecha: b.fecha, monto: num(b.monto), severidad: sev(b.severidad),
      titulo: `Buena pro${b.tipo ? ` de ${b.tipo.toLowerCase()}` : ""} en ${b.entidad ? titulo(b.entidad) : "una entidad"}`,
      detalle: decirBanderas(banderas, "Tenía"),
      quien: b.entidad ? { nombre: titulo(b.entidad), rol: "Le dio la buena pro", href: b.entidad_ruc ? `/entidad/${b.entidad_ruc}` : null } : null,
      datos: datosContrato(b.objeto, b.tipo, b.codigo),
      banderas,
      href: rutaContrato(b.ocid), fuente: "OECE y cruces de Vigía", enlace: procesoOece(b.ocid),
    });
  }

  const secuencias = secuenciasDeCruces(cru, rutaContrato);
  const { eventos: quedan, omitidos } = acotar(eventos, { compras: 150, visitas: 80, control: 100, politica: 80, obras: 60, banderas: 120, empresa: 60 }, fijosDe(secuencias, eventos));
  conTotalDeBanderas(omitidos, quedan, banMes);
  // Empieza con lo primero que tiene, pero no antes de 2015 (una empresa de 2005 dejaba diez años vacíos: su fundación
  // sigue en la lista de hechos).
  const primera = [...series.flatMap((s) => s.puntos.map((p) => `${p.periodo}-01`)), ...quedan.map((e) => e.fecha)].filter((f) => f >= DESDE).sort()[0];
  return {
    sujeto: { tipo: "empresa", id: ruc, nombre: emp.nombre },
    desde: primera ? `${primera.slice(0, 4)}-01-01` : DESDE,
    hasta,
    carriles: conCobertura(soloConDatos(CARRILES_EMPRESA, series, quedan), {
      compras: { rango: (await cobertura()).adjudicaciones, que: "las adjudicaciones de CONOSCE" },
      ordenes: { rango: (await cobertura()).ordenes, que: "las órdenes de CONOSCE" },
      menores: { rango: (await cobertura()).menores, que: "los contratos menores del SEACE" },
      visitas: { rango: (await cobertura()).visitas, que: "los registros de visitas que cargamos" },
    }),
    series,
    eventos: quedan,
    marcas: marcasEleccion(primera ? `${primera.slice(0, 4)}-01-01` : DESDE, hasta),
    secuencias,
    // Los picos de lo que ganó y de las órdenes que recibió, con las elecciones cerca (patronesDeSeries).
    patrones: patronesDeSeries(series, marcasEleccion(primera ? `${primera.slice(0, 4)}-01-01` : DESDE, hasta), 6),
    omitidos,
    fuentes: [
      { texto: "Sus procesos en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
      { texto: "Su ficha en la SUNAT", href: CONSULTA_RUC_SUNAT },
      { texto: "Aportes y gastos de campaña (ONPE)", href: CLARIDAD_ONPE },
    ],
    registro: {
      // Las personas de su conformación (también las de carné de extranjería o pasaporte, que no entran por DNI) y los
      // visitantes, en el orden SUNAT: apellidos y nombres.
      socios: [
        ...gen.map((g) => ({ nombre: g.nombre })),
        ...soc.flatMap((s) => (s.nombres ?? []).filter((n) => !pareceEmpresa(n)).map((n) => ({ nombre: n }))),
      ],
      visitas: vis.filter((v) => v.visitante).map((v) => ({ visitante: v.visitante })),
    },
  };
}

historiaRouter.get("/empresa/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  // Sólo empresas (RUC 20): una persona natural tiene su propio perfil, y su RUC 10 nunca va en una URL.
  if (!/^20\d{9}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const cuerpo = await memo.obtener(`empresa:${ruc}`, async () => {
    const r = await historiaEmpresa(ruc);
    if (!r) return null;
    // Las personas de `registro` (su gente, sus visitantes) salen con un apellido tapado en todo el JSON; también un
    // nombre de persona que llegó en un texto (una razón social que es un nombre).
    const { registro, ...h } = r;
    return publicar({ ...h, visitasHasta: await visitasHasta() }, { extra: registro });
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
    carriles: conCobertura(soloConDatos(CARRILES_PARTIDO, series, eventos), {
      compras: { rango: (await cobertura()).convocatorias, que: "las convocatorias del SEACE" },
      banderas: { rango: (await cobertura()).convocatorias, que: "las convocatorias del SEACE" },
    }),
    series,
    eventos: eventos.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    marcas: marcasEleccion(desde, hasta),
    secuencias: [],
    patrones: patronesDeSeries(series, marcasEleccion(desde, hasta), 6),
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

// ─── Contrato ───────────────────────────────────────────────────────────────────────────────────

const CARRILES_CONTRATO: CarrilHistoria[] = [
  { clave: "compras", titulo: "El proceso", explica: "La convocatoria, las ofertas, la buena pro, el consentimiento, el contrato firmado y su vigencia (SEACE y CONOSCE)." },
  { clave: "visitas", titulo: "Visitas del ganador", explica: "Las de su gente (socios, representantes, directivos) a la entidad, del registro de visitas; de quien la recibió, sólo su cargo." },
  { clave: "banderas", titulo: "Antecedentes del ganador", explica: "Cada antecedente (una sanción, un aporte, un vínculo…) en la fecha del hecho: los de antes de la convocatoria pesan; los de después, no." },
  { clave: "control", titulo: "Sanciones y penalidades", explica: "Las del ganador en el Tribunal de Contrataciones y las penalidades que le aplicaron las entidades." },
  { clave: "empresa", titulo: "El ganador", explica: "Cuándo se fundó la empresa que ganó (SUNAT)." },
  { clave: "obras", titulo: "La obra", explica: "La obra que ejecuta o supervisa este contrato en INFOBRAS: su inicio, su paralización, su fin y su liquidación." },
];

/** Los cruces que van en el carril de visitas (uno por visita); los demás, en el de antecedentes. */
const VISITAS_CRUCE = new Set(["visita_previa"]);

async function historiaContrato(ocid: string): Promise<Historia | null> {
  const [k] = await filas<{ ocid: string; codigo: string | null; entidad_ruc: string | null; entidad: string | null; objeto: string | null; tipo: string | null; conv: string | null; bp: string | null }>(
    "contrato",
    `SELECT c.ocid, c.codigo, c.entidad_ruc::text AS entidad_ruc, e.nombre AS entidad, c.objeto, c.tipo_contratacion AS tipo,
            to_char(c.fecha_convocatoria, 'YYYY-MM-DD') AS conv, to_char(c.fecha_buena_pro, 'YYYY-MM-DD') AS bp
       FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc WHERE c.ocid = $1`, [ocid]);
  if (!k) return null;
  const codigo = k.codigo && /^\d+$/.test(k.codigo) ? k.codigo : null;
  const [adj, pos, fir, cru, obr] = await Promise.all([
    codigo && k.entidad_ruc
      ? filas<{ ruc: string; proveedor: string | null; bp: string | null; cons: string | null; monto: number | null }>(
          "adjudicaciones",
          `SELECT COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, max(COALESCE(m.miembro, a.proveedor)) AS proveedor,
                  to_char(max(a.fecha_buenapro), 'YYYY-MM-DD') AS bp, to_char(max(a.fecha_consentimiento), 'YYYY-MM-DD') AS cons,
                  sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ${SOLES})::float AS monto
             FROM conosce_adjudicaciones a
             LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)[0-9]{9}$'
            WHERE a.codigo_convocatoria = $1 AND a.entidad_ruc = $2
            GROUP BY 1`, [codigo, k.entidad_ruc])
      : Promise.resolve([]),
    codigo
      ? filas<{ n: number; ofertas: string | null }>(
          "postores",
          `SELECT count(DISTINCT ruc_postor)::int AS n, to_char(min(fecha_propuesta) FILTER (WHERE fecha_propuesta > '2000-01-01'), 'YYYY-MM-DD') AS ofertas
             FROM conosce_postores WHERE codigo_convocatoria = $1`, [codigo])
      : Promise.resolve([]),
    codigo
      ? filas<{ firmado: string | null; desde: string | null; hasta: string | null; total: number | null; adicional: number | null; reduccion: number | null; prorroga: number | null }>(
          "contratos firmados",
          `SELECT to_char(min(fecha_suscripcion), 'YYYY-MM-DD') AS firmado, to_char(min(fecha_vigencia_inicial), 'YYYY-MM-DD') AS desde,
                  to_char(max(COALESCE(fecha_vigencia_fin_actualizada, fecha_vigencia_final))
                            FILTER (WHERE COALESCE(fecha_vigencia_fin_actualizada, fecha_vigencia_final) < '2100-01-01'), 'YYYY-MM-DD') AS hasta,
                  max(monto_contratado_total)::float AS total, sum(monto_adicional)::float AS adicional,
                  sum(monto_reduccion)::float AS reduccion, sum(monto_prorroga)::float AS prorroga
             FROM conosce_contratos WHERE codigo_convocatoria = $1 HAVING count(*) > 0`, [codigo])
      : Promise.resolve([]),
    filas<CruceSecuencia & { id: number; ruc: string }>(
      "cruces",
      `SELECT p.id, p.tipo, p.severidad, p.fecha, p.monto::float AS monto, p.ocid, p.detalle, p.ruc_empresa AS ruc,
              c.fecha_buena_pro AS buena_pro, e.nombre AS entidad, c.codigo
         FROM cruces_proveedor p
         JOIN convocatorias c ON c.ocid = p.ocid
         LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
        WHERE p.ocid = $1
        LIMIT 2000`, [ocid]),
    filas<{ codigo: number; nombre: string | null; inicio: string | null; par: string | null; causal: string | null; fin_prog: string | null; fin: string | null; recepcion: string | null; liquidacion: string | null; rol: string | null }>(
      "obra",
      `SELECT o.codigo, o.nombre, to_char(o.fecha_inicio, 'YYYY-MM-DD') AS inicio,
              CASE WHEN o.paralizada THEN to_char(o.fecha_paralizacion, 'YYYY-MM-DD') END AS par, o.causal_paralizacion AS causal,
              to_char(COALESCE(o.fecha_fin_reprog, o.fecha_fin_prog), 'YYYY-MM-DD') AS fin_prog, to_char(o.fecha_fin_real, 'YYYY-MM-DD') AS fin,
              to_char(o.fecha_recepcion, 'YYYY-MM-DD') AS recepcion, to_char(o.fecha_liquidacion, 'YYYY-MM-DD') AS liquidacion, oc.rol
         FROM obra_contrato oc JOIN obra_infobras o ON o.codigo = oc.codigo
        WHERE oc.ocid = $1 AND NOT o.retirada LIMIT 10`, [ocid]),
  ]);

  // Sólo empresas (RUC 20) se nombran y se buscan en la SUNAT y el Tribunal; un RUC 10 es una persona.
  const empresas = [...new Set([...adj.map((a) => a.ruc), ...cru.map((x) => x.ruc)].filter((r) => /^20\d{9}$/.test(r ?? "")))];
  const [emp, san, pen] = await Promise.all([
    empresas.length
      ? filas<{ ruc: string; nombre: string | null; fundada: string | null }>(
          "empresas",
          `SELECT ruc::text AS ruc, razon_social AS nombre, to_char(fecha_alta_ruc, 'YYYY-MM-DD') AS fundada FROM empresas WHERE ruc::text = ANY($1)`, [empresas])
      : Promise.resolve([]),
    empresas.length
      ? filas<{ id: number; ruc: string; tipo: string | null; desde: string | null; hasta: string | null; resolucion: string | null; fecha_res: string | null; multa: number | null }>(
          "sanciones",
          `SELECT id, ruc, tipo, to_char(fecha_desde, 'YYYY-MM-DD') AS desde, to_char(fecha_hasta, 'YYYY-MM-DD') AS hasta, resolucion,
                  to_char(fecha_resolucion, 'YYYY-MM-DD') AS fecha_res, monto_multa_soles::float AS multa
             FROM osce_sancionados WHERE ruc = ANY($1)`, [empresas])
      : Promise.resolve([]),
    empresas.length
      ? filas<{ id: number; ruc: string; fecha: string; entidad: string | null; monto: number | null; tipo: string | null }>(
          "penalidades",
          `SELECT id, empresa_ruc AS ruc, to_char(fecha, 'YYYY-MM-DD') AS fecha, entidad_contratante AS entidad, monto::float AS monto, tipo_penalidad AS tipo
             FROM penalidades WHERE empresa_ruc = ANY($1) AND fecha IS NOT NULL ORDER BY fecha DESC LIMIT 200`, [empresas])
      : Promise.resolve([]),
  ]);

  const nombreDe = new Map<string, string>();
  for (const e of emp) if (e.nombre) nombreDe.set(e.ruc, titulo(e.nombre));
  for (const a of adj) if (/^20\d{9}$/.test(a.ruc) && a.proveedor && !nombreDe.has(a.ruc)) nombreDe.set(a.ruc, titulo(a.proveedor));
  const quien = (ruc: string) => nombreDe.get(ruc) ?? (/^20\d{9}$/.test(ruc) ? `la empresa con RUC ${ruc}` : "una persona natural");
  const ent = k.entidad ? titulo(k.entidad) : "la entidad";
  const aqui = rutaContrato(ocid);
  const eventos: EventoHistoria[] = [];
  const proceso = (id: string, fecha: string | null | undefined, tituloE: string, detalle?: string | null, extra: Partial<EventoHistoria> = {}) => {
    const f = dia(fecha);
    if (f) eventos.push({ id, carril: "compras", tipo: id, fecha: f, titulo: tituloE, detalle: detalle ?? null, href: aqui, fuente: "SEACE y CONOSCE (OECE)", enlace: procesoOece(ocid), ...extra });
  };

  // 1. El proceso.
  proceso("convocatoria", k.conv, `${ent} convocó el proceso${k.codigo ? ` ${k.codigo}` : ""}`, corto(k.objeto));
  const p0 = pos[0];
  if (p0?.ofertas) proceso("ofertas", p0.ofertas, "Se presentaron las ofertas", p0.n ? `${p0.n} ${p0.n === 1 ? "postor" : "postores"} en CONOSCE` : null);
  const bp = adj.map((a) => a.bp).filter((x): x is string => !!x).sort().pop() ?? k.bp;
  const montoAdj = adj.reduce<number | null>((s, a) => (a.monto == null ? s : (s ?? 0) + a.monto), null);
  proceso("buena_pro", bp, adj.length ? `Buena pro para ${adj.map((a) => quien(a.ruc)).join(", ")}` : "Buena pro", null, { monto: montoAdj });
  proceso("consentimiento", adj.map((a) => a.cons).filter((x): x is string => !!x).sort().pop(), "Quedó consentida la buena pro");
  const f0 = fir[0];
  if (f0) {
    const soles = (v: number) => `${Math.round(v).toLocaleString("es-PE")} soles`;
    const cambios = [
      (f0.adicional ?? 0) > 0 ? `adicionales por ${soles(f0.adicional!)}` : null,
      (f0.reduccion ?? 0) > 0 ? `reducciones por ${soles(f0.reduccion!)}` : null,
      (f0.prorroga ?? 0) > 0 ? "prórrogas" : null,
    ].filter(Boolean);
    proceso("contrato", f0.firmado, "Se firmó el contrato", cambios.length ? `Después: ${cambios.join(", ")}` : null, { monto: num(f0.total) });
    const desde = dia(f0.desde);
    const hasta = dia(f0.hasta);
    if (desde && hasta && hasta >= desde) {
      eventos.push({ id: "vigencia", carril: "compras", tipo: "vigencia", fecha: desde, hasta, titulo: "Vigencia del contrato", detalle: null, href: aqui, fuente: "CONOSCE (OECE)", enlace: CONOSCE_BUSCADOR });
    }
  }

  // 2. Las visitas y los antecedentes del ganador (uno por fecha y tipo; nunca un nombre de persona).
  const vistos = new Set<string>();
  for (const x of cru) {
    const f = dia(x.fecha);
    if (!f) continue;
    const d = (x.detalle ?? {}) as Record<string, unknown>;
    if (VISITAS_CRUCE.has(x.tipo)) {
      const cargo = typeof d.cargo_funcionario === "string" ? d.cargo_funcionario : null;
      const area = typeof d.area_funcionario === "string" ? d.area_funcionario : null;
      eventos.push({
        id: `visita:${x.id}`, carril: "visitas", tipo: "visita", fecha: f, severidad: sev(x.severidad),
        titulo: `Alguien de ${quien(x.ruc)} visitó ${ent}`,
        detalle: cargo || area ? `Lo recibió: ${[cargo, area].filter(Boolean).join(", ")}${d.decisor === true ? " (decide las compras)" : ""}` : null,
        href: `${aqui}?seccion=antecedentes`, fuente: "Registro de visitas", enlace: enlaceFuente("visitas_entidades", null, { detalle: d, fecha: f }),
      });
      continue;
    }
    const clave = `${x.tipo}:${f}:${x.ruc}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    eventos.push({
      id: `cruce:${x.id}`, carril: "banderas", tipo: x.tipo, fecha: f, severidad: sev(x.severidad), monto: num(x.monto),
      titulo: ETIQUETA_CRUCE[x.tipo] ?? x.tipo.replace(/_/g, " "),
      detalle: empresas.length > 1 ? `De ${quien(x.ruc)}` : null,
      href: `${aqui}?seccion=antecedentes`, fuente: "Cruces de Vigía con registros oficiales",
    });
  }

  // 3. El ganador: su fundación, sus sanciones y sus penalidades.
  for (const e of emp) {
    if (e.fundada) eventos.push({ id: `fundacion:${e.ruc}`, carril: "empresa", tipo: "fundacion", fecha: e.fundada, titulo: `Se fundó ${quien(e.ruc)}`, detalle: "Inscripción en el RUC", href: `/empresa/${e.ruc}`, fuente: "SUNAT", enlace: CONSULTA_RUC_SUNAT });
  }
  for (const s of san) {
    const desde = s.desde ?? s.fecha_res;
    if (!desde) continue;
    const multa = s.tipo === "multa" || (s.multa ?? 0) > 0;
    eventos.push({
      id: `sancion:${s.id}`, carril: "control", tipo: multa ? "multa" : "sancion", fecha: desde, hasta: multa ? null : s.hasta,
      titulo: `${multa ? "Multa a" : s.tipo === "definitivo" ? "Inhabilitación definitiva de" : "Inhabilitación de"} ${quien(s.ruc)}`,
      detalle: s.resolucion ? `Resolución ${s.resolucion}` : null, monto: num(s.multa), severidad: multa ? "baja" : s.tipo === "definitivo" ? "alta" : "media",
      href: `/empresa/${s.ruc}?seccion=antecedentes`, fuente: "Tribunal de Contrataciones (OECE)", enlace: DATASET_SANCIONADOS,
    });
  }
  for (const p of pen) {
    eventos.push({ id: `penalidad:${p.id}`, carril: "control", tipo: "penalidad", fecha: p.fecha, monto: num(p.monto), severidad: "baja", titulo: `Penalidad a ${quien(p.ruc)}${p.entidad ? ` de ${titulo(p.entidad)}` : ""}`, detalle: p.tipo, href: `/empresa/${p.ruc}?seccion=antecedentes`, fuente: "Penalidades (OECE)", enlace: DATASET_PENALIDADES });
  }

  // 4. La obra (INFOBRAS).
  const hoyD = hoy();
  for (const o of obr) {
    const n = o.nombre ? `«${corto(o.nombre)}»` : "la obra";
    const base = { carril: "obras" as const, href: `${aqui}?seccion=obra`, fuente: "INFOBRAS (Contraloría)", enlace: obraInfobras(o.codigo) };
    if (o.inicio) eventos.push({ ...base, id: `obra:${o.codigo}`, tipo: "inicio", fecha: o.inicio, titulo: `Empezó ${n}`, detalle: o.rol === "supervisor" ? "Este contrato la supervisa" : null });
    if (o.par) eventos.push({ ...base, id: `paralizada:${o.codigo}`, tipo: "paralizada", fecha: o.par, severidad: "alta", titulo: `Se paralizó ${n}`, detalle: o.causal ? `Causa: ${o.causal}` : null });
    if (o.fin) eventos.push({ ...base, id: `fin:${o.codigo}`, tipo: "fin", fecha: o.fin, titulo: `Terminó ${n}` });
    else if (o.fin_prog && o.fin_prog < hoyD) eventos.push({ ...base, id: `debia:${o.codigo}`, tipo: "atraso", fecha: o.fin_prog, severidad: "media", titulo: `Debía terminar ${n}`, detalle: "INFOBRAS no registra que haya terminado" });
    if (o.recepcion) eventos.push({ ...base, id: `recepcion:${o.codigo}`, tipo: "recepcion", fecha: o.recepcion, titulo: `Se recibió ${n}` });
    if (o.liquidacion) eventos.push({ ...base, id: `liquidacion:${o.codigo}`, tipo: "liquidacion", fecha: o.liquidacion, titulo: `Se liquidó ${n}` });
  }

  const secuencias = secuenciasDeCruces(cru, rutaContrato);
  const { eventos: quedan, omitidos } = acotar(eventos, { compras: 20, visitas: 80, banderas: 120, control: 80, empresa: 10, obras: 30 }, fijosDe(secuencias, eventos));
  // Desde el primer hecho (el más viejo suele ser la fundación o una sanción), no antes de 2015; hasta hoy.
  const primera = quedan.map((e) => e.fecha).filter((f) => f >= DESDE).sort()[0];
  const desde = primera ? `${primera.slice(0, 4)}-01-01` : DESDE;
  return {
    sujeto: { tipo: "contrato", id: ocid, nombre: corto(k.objeto) },
    desde,
    hasta: hoyD,
    carriles: soloConDatos(CARRILES_CONTRATO, [], quedan),
    series: [],
    eventos: quedan,
    marcas: marcasEleccion(desde, hoyD),
    secuencias,
    omitidos,
    fuentes: [
      { texto: "El proceso en Contrataciones Abiertas (OECE)", href: procesoOece(ocid) },
      { texto: "Buscador de CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
    ],
  };
}

historiaRouter.get("/contrato/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  if (!/^[A-Za-z0-9-]{3,100}$/.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const cuerpo = await memo.obtener(`contrato:${ocid}`, async () => {
    const h = await historiaContrato(ocid);
    // Por si una razón social es un nombre de persona: publicar() la tapa.
    return h ? publicar(h) : null;
  });
  if (!cuerpo) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
