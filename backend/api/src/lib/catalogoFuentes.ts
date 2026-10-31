/**
 * Catálogo único de las fuentes de datos de Vigía: qué trae cada una, dónde corre, cuándo y cada cuántos días debería
 * tener una carga buena. Lo usan /admin/fuentes (agenda) y /admin/cobertura (fuentes externas), y lo explica SCRAPERS.md
 * (raíz del repo). Una fuente nueva del Worker (backend/scrapers-worker/src/workflow.ts) o un cargador nuevo de PC va
 * acá también; si no, el panel la muestra igual, pero como «sin catálogo».
 *
 * Dos bitácoras, y el estado sale de las dos:
 *   corridas_fuente (migración 74)  cada corrida del Worker vigia-scrapers con su estado: si corrió y si falló.
 *   datasets_cargas (migración 23)  cada archivo nuevo cargado (por sha256): cuándo llegó un dato nuevo. Los cargadores
 *                                   de la PC sólo escriben acá.
 */

import type pg from "pg";

/** Por dónde sale el pedido: lo que hay que mirar si una fuente deja de llegar. */
export type Donde = "cloudflare" | "zurich" | "navegador" | "pc" | "ci";

export interface FuenteCatalogo {
  fuente: string;
  nombre: string;
  /** Qué trae y para qué sirve, en una línea. */
  que: string;
  donde: Donde;
  /** Cuándo corre, en hora de Lima. */
  agenda: string;
  /** Días como máximo entre dos cargas buenas antes de marcarla «Atrasada»; null: sin plazo (relleno o legado). */
  cadaDias: number | null;
  /** Corridas que lanza al terminar (quedan en corridas_fuente con su propia clave). */
  lanza?: string[];
}

export const CATALOGO: FuenteCatalogo[] = [
  // ── Worker vigia-scrapers (Cloudflare), con cron ─────────────────────────────────────────────────────────────────
  { fuente: "oece_ocds", nombre: "Contratos del OECE (OCDS)", donde: "zurich", agenda: "Diario, 06:00", cadaDias: 1,
    que: "Convocatorias y adjudicaciones de los últimos 7 días; después rehace todos los cruces y banderas." },
  { fuente: "documentos", nombre: "Documentos de los contratos financiados", donde: "zurich", agenda: "Cada hora, minuto 40", cadaDias: 1,
    que: "Bases, actas y contratos de lo que se financió, a R2 (reemplaza a vigia-batch)." },
  { fuente: "seace_menores", nombre: "Compras menores (hasta 8 UIT)", donde: "zurich", agenda: "Lunes, 05:00", cadaDias: 7,
    que: "Contratos menores del SEACE nuevo y el PDF de su requerimiento (prod6 sólo pasa por Zúrich)." },
  { fuente: "pnda_sancionados", nombre: "Proveedores sancionados (Tribunal)", donde: "cloudflare", agenda: "Domingos, 08:00", cadaDias: 7,
    que: "Inhabilitaciones y multas del Tribunal de Contrataciones: bandera crítica al ganador sancionado." },
  { fuente: "conosce_ordenes", nombre: "Órdenes de compra y servicio (CONOSCE)", donde: "cloudflare", agenda: "Domingos, 08:00 (unas 6 h)", cadaDias: 7,
    que: "El año en curso entero; después fraccionamiento, personas contratadas, señales y cruces." },
  { fuente: "mef_presupuesto", nombre: "Presupuesto público (MEF)", donde: "cloudflare", agenda: "Lunes, 08:00", cadaDias: 7,
    lanza: ["mef_detalle", "mef_cargar_gasto"],
    que: "Presupuesto y gasto de cada ejecutora (SIAF); lanza el detalle (en qué gasta) en dos pasadas." },
  { fuente: "mef_opds_etes", nombre: "MEF: organismos descentralizados y empresas municipales", donde: "cloudflare", agenda: "Martes, 08:00", cadaDias: 7,
    que: "Gasto de OPD y empresas municipales, para la ficha de cada entidad." },
  { fuente: "onpe_claridad", nombre: "Aportantes y candidatos (ONPE Claridad)", donde: "navegador", agenda: "Miércoles, 08:00", cadaDias: 7,
    que: "Aportes de campaña y padrón de candidatos: cruza aportantes con ganadores y da el DNI al JNE." },
  { fuente: "onpe_gastos", nombre: "Gastos de campaña (ONPE)", donde: "navegador", agenda: "Miércoles, 08:00", cadaDias: 7,
    que: "Proveedores de las campañas: cruces «proveedor de campaña» y «partido gobernante»." },
  { fuente: "congreso_visitas", nombre: "Visitas al Congreso", donde: "cloudflare", agenda: "Jueves, 08:00", cadaDias: 7,
    que: "Registro de visitas del Congreso de los últimos 14 días (sin captcha)." },
  { fuente: "conosce", nombre: "Adjudicaciones, postores y contratos (CONOSCE)", donde: "cloudflare", agenda: "Sábados, 08:00", cadaDias: 7,
    que: "Reportes del SEACE del año actual y el anterior, consorcios y procesos por partido; después, los cruces." },
  { fuente: "pnda_visitas", nombre: "Visitas a entidades (datos abiertos)", donde: "cloudflare", agenda: "Días 1 y 15, 08:00", cadaDias: 17,
    que: "Registro de visitas publicado en la PNDA (hoy sólo el Gobierno Regional de Loreto)." },
  { fuente: "pnda_dji", nombre: "Declaraciones de intereses: cargos y empleos (PNDA)", donde: "cloudflare", agenda: "Día 5, 08:00", cadaDias: 33,
    que: "Reportes 1 y 3 de la DJI: cargo, entidad y empleos previos (puerta giratoria). Los familiares salen de la DJIC." },
  { fuente: "jne_infogob", nombre: "Autoridades electas y vigentes (JNE)", donde: "cloudflare", agenda: "Día 5, 08:00", cadaDias: 33,
    que: "Alcaldes, gobernadores y su organización política." },
  { fuente: "pnda_oece", nombre: "Datasets del OECE en la PNDA", donde: "cloudflare", agenda: "Día 1, 08:00", cadaDias: 33,
    que: "Ofertantes, consorcios, SICAN, pronunciamientos y cuadernos de obra: sólo crudos en R2 (carga manual)." },
  { fuente: "pte_personal", nombre: "Planilla del Estado (Portal de Transparencia)", donde: "cloudflare", agenda: "Día 20, 08:00", cadaDias: 33,
    que: "Planilla de cada entidad de los dos meses anteriores; después señales de personas." },
  { fuente: "oece_historico", nombre: "OECE: procesos 2015-2017", donde: "zurich", agenda: "A mano (relleno)", cadaDias: null,
    que: "Procesos adjudicados antes de 2018, que CONOSCE no trae." },
  // ── Desde una PC en el Perú: la fuente bloquea la nube o pide captcha ──────────────────────────────────────────
  { fuente: "contraloria_informes", nombre: "Informes de control (Contraloría)", donde: "pc", agenda: "Mensual, a mano", cadaDias: 35,
    que: "Informes con responsabilidad presunta. Sólo responde a IP peruana: backend/scripts/cargar_contraloria_informes.py." },
  { fuente: "ppedc_boletin", nombre: "Casos de la Procuraduría Anticorrupción", donde: "pc", agenda: "Mensual, a mano (cuando sale el boletín)", cadaDias: 45,
    que: "Casos por sede del boletín mensual (PDF): backend/scripts/cargar_ppedc_boletin.py." },
  { fuente: "infobras", nombre: "Obras públicas (INFOBRAS)", donde: "pc", agenda: "Semanal, a mano", cadaDias: 8,
    que: "Obras con su avance y CUI; sólo responde a IP peruana: backend/scripts/cargar_obras.py." },
  { fuente: "invierte_pe", nombre: "Inversiones (Invierte.pe)", donde: "pc", agenda: "Semanal, a mano (con INFOBRAS)", cadaDias: 8,
    que: "Proyectos de inversión por CUI; los baja el mismo cargar_obras.py." },
  { fuente: "servir_convocatorias", nombre: "Plazas CAS (SERVIR)", donde: "pc", agenda: "Semanal, a mano", cadaDias: 8,
    que: "Convocatorias CAS; SERVIR responde 403 a Cloudflare: backend/scripts/cargar_servir_convocatorias.py." },
  { fuente: "portal_visitas_nacional", nombre: "Visitas: plataforma nacional (PCM)", donde: "pc", agenda: "Mensual, a mano", cadaDias: 35,
    que: "Visitas de todas las entidades. Tu Chrome con el Turnstile del portal (scrapers/visitas_pcm) y carga por túnel." },
  { fuente: "sunat_ruc", nombre: "Fichas SUNAT (Consulta Múltiple de RUC)", donde: "pc", agenda: "A mano, para RUC nuevos", cadaDias: null,
    que: "Estado, domicilio y fecha de alta de proveedores. Tu Chrome por lotes de 100 (scrapers/sunat_ruc)." },
  { fuente: "oece_entidades", nombre: "Entidades del OECE y su código SIAF", donde: "pc", agenda: "A mano, cuando cambia", cadaDias: null,
    que: "Une el RUC de cada entidad con su código del MEF: backend/scripts/cargar_entidades_oece.py." },
  { fuente: "portal_visitas_manual", nombre: "Visitas: exportación manual del portal (legado)", donde: "pc", agenda: "Legado (mayo de 2026)", cadaDias: null,
    que: "La exportación de ~345 entidades de mayo de 2026; la reemplaza la plataforma nacional." },
  // ── GitLab CI + PC ──────────────────────────────────────────────────────────────────────────────────────────
  { fuente: "dji_familiares", nombre: "Declaraciones de intereses: familiares (DJIC)", donde: "ci", agenda: "Rondas hasta vaciar los pendientes", cadaDias: null,
    que: "PDFs del portal DJIC en GitLab CI (10 IP), procesados en la PC: familiares e intereses. Su bitácora es dji_descargas." },
];

const HIJAS = new Set(CATALOGO.flatMap((f) => f.lanza ?? []));

export interface Cargas {
  tabla: string | null;
  cargas: number;
  cargasConError: number;
  filas: number | string;
  ultimaClave: string | null;
  ultimaDescarga: string | null;
  /** La última carga buena: cuándo llegó un dato nuevo. */
  ultimaCarga: string | null;
  ultimoError: string | null;
}

export interface Corrida {
  fuente: string;
  instancia: string;
  estado: "corriendo" | "ok" | "error";
  inicio: string;
  fin: string | null;
  segundos: number | null;
  error: string | null;
  ultimaOk: string | null;
  ok30: number;
  error30: number;
}

export type Estado = "al_dia" | "atrasada" | "fallo" | "en_curso" | "a_mano" | "sin_registro";

export interface EstadoFuente extends FuenteCatalogo {
  /** false: apareció en una bitácora y no está en el catálogo. */
  enCatalogo: boolean;
  cargas: Cargas | null;
  /** La última corrida del Worker (las fuentes de PC no tienen). */
  ultima: Corrida | null;
  lanzadas: Corrida[];
  /** La última vez que terminó bien: corrida buena o carga buena, la más reciente. */
  ultimaBuena: string | null;
  estado: Estado;
}

const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

function estadoDe(f: FuenteCatalogo, ultima: Corrida | null, ultimaBuena: string | null, ahora: number): Estado {
  if (ultima?.estado === "error") return "fallo";
  if (ultima?.estado === "corriendo" && ahora - ms(ultima.inicio) < 12 * 3600_000) return "en_curso";
  if (!ultimaBuena) return "sin_registro";
  // Un día de gracia: una corrida diaria de las 06:00 no está atrasada a las 05:59 del día siguiente.
  if (f.cadaDias != null) return ahora - ms(ultimaBuena) > (f.cadaDias + 1) * 86_400_000 ? "atrasada" : "al_dia";
  return f.donde === "pc" || f.donde === "ci" ? "a_mano" : "al_dia";
}

/** Cada fuente del catálogo (y las que aparezcan en las bitácoras sin estar en él) con su última corrida, sus cargas y su estado. */
export async function estadoFuentes(pool: pg.Pool): Promise<EstadoFuente[]> {
  const [cargas, corridas] = await Promise.all([
    pool.query<Cargas & { fuente: string }>(
      `SELECT fuente, max(tabla) AS tabla, count(*)::int AS cargas, count(*) FILTER (WHERE estado <> 'ok')::int AS "cargasConError",
              COALESCE(sum(filas), 0)::bigint AS filas, max(clave) AS "ultimaClave", max(descargado_at) AS "ultimaDescarga",
              max(cargado_at) FILTER (WHERE estado = 'ok') AS "ultimaCarga",
              (array_agg(error ORDER BY cargado_at DESC) FILTER (WHERE error IS NOT NULL))[1] AS "ultimoError"
         FROM datasets_cargas GROUP BY fuente`).then((q) => q.rows).catch(() => []),
    pool.query<Corrida>(
      `SELECT DISTINCT ON (fuente) fuente, instancia, estado, inicio, fin, segundos, error,
              max(inicio) FILTER (WHERE estado = 'ok') OVER (PARTITION BY fuente) AS "ultimaOk",
              count(*) FILTER (WHERE estado = 'ok' AND inicio > now() - interval '30 days') OVER (PARTITION BY fuente)::int AS ok30,
              count(*) FILTER (WHERE estado = 'error' AND inicio > now() - interval '30 days') OVER (PARTITION BY fuente)::int AS error30
         FROM corridas_fuente ORDER BY fuente, inicio DESC`).then((q) => q.rows).catch(() => []),
  ]);
  const porCarga = new Map(cargas.map(({ fuente, ...c }) => [fuente, c]));
  const porCorrida = new Map(corridas.map((c) => [c.fuente, c]));
  const conocidas = new Set(CATALOGO.map((f) => f.fuente));
  const extra: FuenteCatalogo[] = [...new Set([...porCarga.keys(), ...porCorrida.keys()])]
    .filter((k) => !conocidas.has(k) && !HIJAS.has(k))
    .map((k) => ({ fuente: k, nombre: k, que: "No está en el catálogo (backend/api/src/lib/catalogoFuentes.ts).", donde: "pc", agenda: "Sin agenda conocida", cadaDias: null }));
  const ahora = Date.now();
  return [...CATALOGO, ...extra].map((f) => {
    const c = porCarga.get(f.fuente) ?? null;
    const ultima = porCorrida.get(f.fuente) ?? null;
    const fechas = [ultima?.ultimaOk, c?.ultimaCarga].filter((x): x is string => !!x).map((x) => new Date(x).toISOString());
    const ultimaBuena = fechas.length ? fechas.sort().at(-1)! : null;
    return {
      ...f,
      enCatalogo: conocidas.has(f.fuente),
      cargas: c,
      ultima,
      lanzadas: (f.lanza ?? []).map((h) => porCorrida.get(h)).filter((x): x is Corrida => !!x),
      ultimaBuena,
      estado: estadoDe(f, ultima, ultimaBuena, ahora),
    };
  });
}
