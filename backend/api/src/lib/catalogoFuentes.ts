/**
 * Catálogo único de las fuentes de datos de Vigía: qué trae cada una, dónde corre, cuándo y cada cuántos días debería
 * tener una carga buena. Lo usan /admin/fuentes (agenda) y /admin/cobertura (fuentes externas), y lo explica SCRAPERS.md
 * (raíz del repo). Una fuente nueva del Worker (backend/scrapers-worker/src/workflow.ts) o un cargador nuevo de PC va
 * acá también; si no, el panel la muestra igual, pero como «sin catálogo».
 *
 * Lo que ve el público (GET /estado/datos: la página /fuentes y estado_fuentes del MCP) es otra lista, la de
 * routes/estado.ts: junta estas claves en filas con nombre para la gente y dice hasta qué fecha llegan sus datos. Cada
 * clave de acá va en una fila de allá o en su lista de internas (test/estadoFuentes.test.ts lo exige).
 *
 * Dos bitácoras, y el estado sale de las dos:
 *   corridas_fuente (migración 74)  cada corrida del Worker vigia-scrapers con su estado: si corrió y si falló.
 *   datasets_cargas (migración 23)  cada archivo nuevo cargado (por sha256): cuándo llegó un dato nuevo. Los cargadores
 *                                   de la PC sólo escriben acá.
 */

import type pg from "pg";

/** Por dónde sale el pedido: lo que hay que mirar si una fuente deja de llegar. */
export type Donde = "cloudflare" | "zurich" | "lima" | "navegador" | "pc" | "ci";

/**
 * Lo que las bitácoras no pueden decir de una fuente: se declara a mano y se quita cuando deja de ser cierto.
 *   rota         el registro oficial no responde: no hay de dónde cargar
 *   parada       la captura está detenida a propósito
 *   sin_novedad  la carga corre bien, pero el portal no publica un archivo nuevo
 *   foto         se cargó una vez y no tiene refresco
 */
export type TipoSituacion = "rota" | "parada" | "sin_novedad" | "foto";

export interface Situacion {
  tipo: TipoSituacion;
  /** La explicación para el público (sale en /fuentes y en el MCP): de tú, sin nombres de personas. */
  nota: string;
}

const SIN_ARCHIVO_NUEVO = "La carga corre bien, pero el portal de datos abiertos no trae un archivo nuevo desde el 16 de setiembre de 2026.";

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
  /** Rota, parada, sin archivo nuevo o foto sin refresco: lo que el estado calculado no alcanza a decir. */
  situacion?: Situacion;
}

export const CATALOGO: FuenteCatalogo[] = [
  // ── Worker vigia-scrapers (Cloudflare), con cron ─────────────────────────────────────────────────────────────────
  { fuente: "oece_ocds", nombre: "Contratos del OECE (OCDS)", donde: "zurich", agenda: "Diario, 06:00", cadaDias: 1,
    que: "Convocatorias y adjudicaciones de los últimos 7 días; después rehace todos los cruces y banderas." },
  { fuente: "documentos", nombre: "Documentos de los contratos financiados", donde: "zurich", agenda: "Cada hora, minuto 40", cadaDias: 1,
    que: "Bases, actas y contratos de lo que se financió, a R2 (reemplaza a vigia-batch)." },
  { fuente: "seace_menores", nombre: "Compras menores (hasta 8 UIT)", donde: "zurich", agenda: "Lunes, 05:00", cadaDias: 7,
    que: "Contratos menores del SEACE nuevo y el PDF de su requerimiento (prod6 sólo pasa por Zúrich). El detalle (área usuaria, invitación, ítems) lo completa la tarea menores-detalle de GitLab CI." },
  { fuente: "seace_cotizaciones", nombre: "Compras menores abiertas (para cotizar)", donde: "zurich", agenda: "Cada hora, minuto 40", cadaDias: 1,
    que: "Lo que un proveedor todavía puede cotizar (hasta 8 UIT, prod6): alta de las nuevas con sus ítems y su requerimiento, y cierre de las que dejan de estar vigentes." },
  { fuente: "pnda_sancionados", nombre: "Proveedores sancionados (Tribunal)", donde: "cloudflare", agenda: "Domingos, 08:00", cadaDias: 7,
    que: "Inhabilitaciones y multas del Tribunal de Contrataciones: bandera crítica al ganador sancionado." },
  { fuente: "osce_penalidades", nombre: "Penalidades de contratistas (OSCE)", donde: "cloudflare", agenda: "Domingos, 08:00", cadaDias: 7,
    que: "Las penalidades que las entidades aplicaron por incumplir un contrato (adjuntos de la wiki del OSCE): antecedente de la empresa." },
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
    que: "Registro de visitas publicado en la PNDA (hoy sólo el Gobierno Regional de Loreto).",
    situacion: { tipo: "sin_novedad", nota: `${SIN_ARCHIVO_NUEVO} Sólo lo publicaba el Gobierno Regional de Loreto.` } },
  { fuente: "pnda_dji", nombre: "Declaraciones de intereses: cargos y empleos (PNDA)", donde: "cloudflare", agenda: "Día 5, 08:00", cadaDias: 33,
    que: "Reportes 1 y 3 de la DJI: cargo, entidad y empleos previos (puerta giratoria). Los familiares salen de la DJIC.",
    situacion: { tipo: "sin_novedad", nota: SIN_ARCHIVO_NUEVO } },
  { fuente: "jne_infogob", nombre: "Autoridades electas y vigentes (JNE)", donde: "cloudflare", agenda: "Día 5, 08:00", cadaDias: 33,
    que: "Alcaldes, gobernadores y su organización política.",
    situacion: { tipo: "sin_novedad", nota: SIN_ARCHIVO_NUEVO } },
  { fuente: "pnda_oece", nombre: "Datasets del OECE en la PNDA", donde: "cloudflare", agenda: "Día 1, 08:00", cadaDias: 33,
    que: "Ofertantes, consorcios, SICAN, pronunciamientos y cuadernos de obra: sólo crudos en R2 (carga manual)." },
  { fuente: "pte_personal", nombre: "Planilla del Estado (Portal de Transparencia)", donde: "cloudflare", agenda: "Día 20, 08:00", cadaDias: 33,
    que: "Planilla de cada entidad de los dos meses anteriores; después señales de personas." },
  { fuente: "oece_historico", nombre: "OECE: procesos 2015-2017", donde: "zurich", agenda: "A mano (relleno)", cadaDias: null,
    que: "Procesos adjudicados antes de 2018, que CONOSCE no trae." },
  // ── Desde una PC en el Perú: la fuente bloquea la nube o pide captcha ──────────────────────────────────────────
  { fuente: "contraloria_informes", nombre: "Informes de control (Contraloría)", donde: "lima", agenda: "Día 10, 08:00", cadaDias: 33,
    que: "Informes con responsabilidad presunta. Sólo responde a IP peruana: sale por el relay de Lima (backend/relay-lima)." },
  { fuente: "contraloria_fichas", nombre: "Fichas resumen de los informes de control (Contraloría)", donde: "pc", agenda: "Mensual, a mano, después del día 10", cadaDias: null,
    que: "La ficha resumen de cada informe (PDF de texto): objetivo, montos y observaciones, leídas y atadas al contrato que nombran. backend/scripts/actualizar_contraloria.sh; no anota en datasets_cargas (su fecha es informe_control_ficha.descargado_at)." },
  { fuente: "ppedc_boletin", nombre: "Casos de la Procuraduría Anticorrupción", donde: "pc", agenda: "Mensual, a mano (cuando sale el boletín)", cadaDias: 45,
    que: "Casos por sede del boletín mensual (PDF): backend/scripts/cargar_ppedc_boletin.py.",
    situacion: { tipo: "rota", nota: "El sitio de la Procuraduría Anticorrupción no responde desde el 30 de octubre de 2026, así que no hay de dónde bajar su boletín mensual. Ves lo del último boletín que se cargó." } },
  { fuente: "salud_lima", nombre: "Salida peruana (tu PC)", donde: "lima", agenda: "Diario, 12:40", cadaDias: 2,
    que: "Prueba diaria de la salida con IP del Perú (backend/scrapers-pc/salida_peru): que responda y llegue a la Contraloría, INFOBRAS y SERVIR." },
  { fuente: "oece_fichas", nombre: "Ficha del proveedor en el OECE (sanciones vigentes)", donde: "lima", agenda: "Lunes, 08:00 (hasta 700 empresas)", cadaDias: 8,
    que: "Apto y habilitado hoy, y cada sanción con su fin, de las empresas sancionadas: corrige «sanción vigente» cuando el Tribunal la sustituyó o levantó (migración 337). El OECE sólo responde a IP peruana: sale por el relay de Lima. Respaldo: backend/scripts/oece_fichas.py." },
  { fuente: "infobras", nombre: "Obras públicas (INFOBRAS)", donde: "lima", agenda: "Jueves, 08:00", cadaDias: 8,
    que: "Obras con su avance y CUI. La Contraloría sólo responde a IP peruana: sale por el relay de Lima." },
  { fuente: "invierte_pe", nombre: "Inversiones (Invierte.pe)", donde: "cloudflare", agenda: "Viernes, 08:00", cadaDias: 7,
    que: "Proyectos de inversión por CUI (DETALLE e CIERRE_INVERSIONES del MEF); después refrescar_obras()." },
  { fuente: "servir_convocatorias", nombre: "Plazas CAS (SERVIR)", donde: "lima", agenda: "Diario, 08:00 (~20 min; jueves completa, ~1,5 h)", cadaDias: 3,
    que: "Convocatorias CAS con requisitos y sueldo. Cada día sólo abre las plazas nuevas o cambiadas; el jueves, todas. SERVIR responde 403 fuera del Perú: sale por el relay de Lima." },
  { fuente: "servir_practicas", nombre: "Prácticas (SERVIR)", donde: "lima", agenda: "Diario, 09:00 (~3 min)", cadaDias: 3,
    que: "Prácticas preprofesionales y profesionales de Talento Perú (modalidades formativas): subvención, duración, requisitos, cronograma y el correo institucional por el que se postula. Sale por el relay de Lima." },
  { fuente: "portal_visitas_nacional", nombre: "Visitas: plataforma nacional (PCM)", donde: "pc", agenda: "Mensual, a mano", cadaDias: 35,
    que: "Visitas de todas las entidades. Tu Chrome con el Turnstile del portal (backend/scrapers-pc/visitas_pcm) y carga por túnel." },
  { fuente: "sunat_padron", nombre: "Padrón reducido de SUNAT (empresas)", donde: "cloudflare", agenda: "Martes, 08:00", cadaDias: 7,
    que: "Estado y condición de domicilio de todas las empresas (RUC 20), sin captcha: de baja, suspendida, no habida." },
  { fuente: "sunat_ruc", nombre: "Fichas SUNAT (Consulta Múltiple de RUC)", donde: "pc", agenda: "A mano, para RUC nuevos", cadaDias: null,
    que: "Estado, domicilio y fecha de alta de proveedores. Tu Chrome por lotes de 100 (backend/scrapers-pc/sunat_ruc)." },
  { fuente: "oece_entidades", nombre: "Entidades del OECE y su código SIAF", donde: "cloudflare", agenda: "Día 2, 08:00", cadaDias: 33,
    que: "Une el RUC de cada entidad con su código del MEF (registro de la OECE); después refrescar_mef_presupuesto()." },
  { fuente: "portal_visitas_manual", nombre: "Visitas: exportación manual del portal (legado)", donde: "pc", agenda: "Legado (mayo de 2026)", cadaDias: null,
    que: "La exportación de ~345 entidades de mayo de 2026; la reemplaza la plataforma nacional." },
  { fuente: "perucompras", nombre: "Catálogos electrónicos (Perú Compras)", donde: "pc", agenda: "A mano, sin fecha fija", cadaDias: null,
    que: "Órdenes de los catálogos con sus ítems, precio unitario y fichas-producto (reporte detallado público) y el índice mensual de la PNDA: backend/scripts/cargar_perucompras.py y cargar_perucompras_dab.py." },
  { fuente: "rnp_conformacion_juridica", nombre: "Socios y representantes de proveedores (RNP)", donde: "pc", agenda: "Sin refresco (carga única)", cadaDias: null,
    que: "Conformación jurídica del RNP: socios, representantes y órganos de administración de cada proveedor. La normaliza backend/scripts/rnp_normalize.py; no anota en datasets_cargas (su fecha es fecha_corte).",
    situacion: { tipo: "foto", nota: "Es una foto: se cargó una vez y no se actualiza sola. Un socio o representante que cambió después de esa fecha no aparece." } },
  { fuente: "jne_candidaturas", nombre: "Candidaturas (JNE)", donde: "pc", agenda: "Sin refresco (carga única)", cadaDias: null,
    que: "Candidatos y electos de cada elección, de los archivos del JNE: backend/scripts/load_jne_candidaturas.py. Infogob pide captcha: no se actualiza sola, ni anota en datasets_cargas.",
    situacion: { tipo: "foto", nota: "Es una foto: se cargó una vez y no se actualiza sola. Las candidaturas inscritas después de esa fecha no aparecen." } },
  // ── GitLab CI + PC ──────────────────────────────────────────────────────────────────────────────────────────
  { fuente: "dji_familiares", nombre: "Declaraciones de intereses: familiares (DJIC)", donde: "ci", agenda: "Rondas hasta vaciar los pendientes (parada desde el 29-oct-2026)", cadaDias: null,
    que: "PDFs del portal DJIC en GitLab CI (10 IP), procesados en la PC: familiares e intereses. Su bitácora es dji_descargas.",
    situacion: { tipo: "parada", nota: "La captura de estas declaraciones está detenida desde el 29 de octubre de 2026. Lo que ya se leyó se sigue mostrando; falta una parte de los declarantes." } },
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
