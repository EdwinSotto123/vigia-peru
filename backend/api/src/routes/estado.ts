import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import { CATALOGO, type TipoSituacion } from "../lib/catalogoFuentes.js";
import {
  BUSCADOR_CONTRALORIA, CLARIDAD_ONPE, CONOSCE_BUSCADOR, CONSULTA_PERU_COMPRAS, CONSULTA_RUC_SUNAT, CONTRATACIONES_ABIERTAS,
  DATASET_AUTORIDADES_JNE, DATASET_DJI, DATASET_MEF, DATASET_PENALIDADES, DATASET_SANCIONADOS, DATASET_SOCIOS_RNP, DJI_CONSULTA,
  INFOBRAS, PLATAFORMA_JNE, PORTAL_TRANSPARENCIA, PRACTICAS_SERVIR, SEACE_MENORES, SEGUIMIENTO_INVERSIONES, TALENTO_PERU,
  VISITAS_CONGRESO, VISITAS_EN_LINEA, datasetVisitas,
} from "../lib/fuentes.js";

/**
 * GET /estado/datos — qué tan al día está cada fuente (fase 5 del plan del 2026-10-27): hasta qué fecha llegan sus datos,
 * cuándo fue su última carga buena y si está al día, atrasada, con error o se carga a mano. Lo muestra /fuentes arriba,
 * para que quien lee una cifra sepa hasta cuándo llega, y lo sirve estado_fuentes del MCP. Público: sin parámetros ni
 * mensajes de error internos (el panel admin tiene el detalle en /admin/fuentes).
 *
 * Las filas de acá son lo que ve la gente; el catálogo de lib/catalogoFuentes.ts, lo que corre. Cada fila nombra las
 * claves del catálogo que la cargan, y de ahí salen su bitácora y su `situacion` (rota, parada, sin archivo nuevo o
 * foto). Una clave nueva del catálogo va en una fila o en INTERNAS: test/estadoFuentes.test.ts falla si no.
 */
export const estadoRouter = new Hono();

const CACHE = cachePublico(600, { maxAge: 120, swr: 3600 });
const memo = new Memo<Record<string, unknown>>({ nombre: "estado:datos", ttlMs: 600_000, staleMs: 3_600_000, max: 2 });

export interface FuentePublica {
  clave: string;
  nombre: string;
  que: string;
  /** Cada cuántos días se espera una carga buena (con margen); null = a mano o sin refresco. */
  cada: number | null;
  cadencia: string;
  /**
   * Las claves del catálogo que la cargan. Su última carga buena sale de la bitácora de cada una: corridas_fuente si
   * corre sola en el Worker; datasets_cargas si se carga desde una PC (`donde` "pc" o "ci"), que no deja corridas.
   */
  claves: string[];
  /** Hasta qué fecha llegan sus datos (AAAA-MM-DD). */
  hasta: string;
  /** Algo que conviene saber al leerla y que no cambia su estado (la situación del catálogo sí lo cambia). */
  nota?: string;
  /** Dónde ver el registro oficial. */
  enlace?: string;
}

/** La fecha más reciente que anotó una fuente en datasets_cargas: para las que no tienen una fecha propia en su tabla. */
const deLaBitacora = (fuente: string, columna: "descargado_at" | "cargado_at") =>
  `SELECT to_char(max(${columna}), 'YYYY-MM-DD') AS v FROM datasets_cargas WHERE fuente = '${fuente}' AND estado = 'ok'`;

export const FUENTES: FuentePublica[] = [
  // ── Contrataciones: OECE, SEACE y Perú Compras ───────────────────────────────────────────────────────────────────
  { clave: "oece_ocds", nombre: "Contratos del SEACE", que: "Convocatorias y su ganador (OECE, Contrataciones Abiertas).", cada: 3, cadencia: "Diaria", claves: ["oece_ocds"],
    enlace: CONTRATACIONES_ABIERTAS,
    hasta: `SELECT to_char(max(fecha_convocatoria), 'YYYY-MM-DD') AS v FROM convocatorias WHERE fecha_convocatoria <= current_date` },
  { clave: "conosce", nombre: "Adjudicaciones y postores", que: "Buenas pro, postores y contratos (OECE, CONOSCE).", cada: 10, cadencia: "Semanal", claves: ["conosce"],
    enlace: CONOSCE_BUSCADOR,
    // Por el índice del año: sin él, recorrer las 325 mil adjudicaciones pasaba el tope de la API y salía vacío.
    hasta: `SELECT to_char(max(fecha_buenapro), 'YYYY-MM-DD') AS v FROM conosce_adjudicaciones WHERE anio >= extract(year FROM current_date)::int - 1 AND fecha_buenapro <= current_date` },
  { clave: "conosce_ordenes", nombre: "Órdenes de compra y de servicio", que: "Cada orden de cada entidad (OECE, CONOSCE).", cada: 10, cadencia: "Semanal", claves: ["conosce_ordenes"],
    enlace: CONOSCE_BUSCADOR,
    hasta: `SELECT to_char(max(fecha_emision), 'YYYY-MM-DD') AS v FROM conosce_ordenes WHERE fecha_emision <= current_date`,
    // Medido el 2026-11-18 (la carga baja cada vez el año entero, con lo registrado tarde): de 1 933 entidades que
    // publicaron órdenes los doce meses de 2025, 1 092 publicaron en setiembre de 2026 y 188 no publican desde diciembre.
    nota: "En 2026 publican sus órdenes en CONOSCE menos entidades que en 2025 (de las 1 933 que publicaron todos los meses de " +
      "2025, unas 1 100 lo hicieron en setiembre de 2026). Una baja de órdenes en 2026 puede ser falta de datos de la fuente." },
  { clave: "seace_menores", nombre: "Contratos menores", que: "Contratos de hasta 8 UIT (SEACE).", cada: 10, cadencia: "Semanal", claves: ["seace_menores"],
    enlace: SEACE_MENORES,
    hasta: `SELECT to_char(max(fecha_suscripcion), 'YYYY-MM-DD') AS v FROM seace_menores WHERE fecha_suscripcion <= current_date` },
  { clave: "seace_cotizaciones", nombre: "Compras menores abiertas", que: "Las compras de hasta 8 UIT que todavía se pueden cotizar (SEACE).", cada: 2, cadencia: "Cada hora", claves: ["seace_cotizaciones"],
    enlace: SEACE_MENORES,
    hasta: `SELECT to_char(max(fec_publica) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS v FROM seace_cotizacion WHERE fec_publica <= now()` },
  { clave: "perucompras", nombre: "Catálogos electrónicos de Perú Compras", que: "Órdenes de los catálogos electrónicos con sus ítems, precios unitarios y fichas de producto (Perú Compras).", cada: null, cadencia: "Por cargas, a mano", claves: ["perucompras"],
    enlace: CONSULTA_PERU_COMPRAS,
    hasta: `SELECT to_char(max(fecha_publicacion), 'YYYY-MM-DD') AS v FROM perucompras_orden WHERE fecha_publicacion <= current_date` },
  { clave: "documentos", nombre: "Expedientes de los procesos", que: "Bases, actas y contratos de los procesos que entran a lectura; no de todos (OECE, Contrataciones Abiertas).", cada: 2, cadencia: "Cada hora", claves: ["documentos"],
    enlace: CONTRATACIONES_ABIERTAS,
    hasta: `SELECT to_char(max(creado_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS v FROM documentos_gcs` },
  { clave: "sancionados", nombre: "Sanciones del Tribunal", que: "Proveedores inhabilitados y multados (OECE).", cada: 10, cadencia: "Semanal", claves: ["pnda_sancionados"],
    enlace: DATASET_SANCIONADOS,
    // La wiki del OECE (desde el 2026-11-18) no trae la fecha de la resolución: vale el inicio de la sanción.
    hasta: `SELECT to_char(max(COALESCE(fecha_resolucion, fecha_desde)), 'YYYY-MM-DD') AS v FROM osce_sancionados
             WHERE COALESCE(fecha_resolucion, fecha_desde) <= current_date` },
  { clave: "penalidades", nombre: "Penalidades a contratistas", que: "Las penalidades que las entidades aplicaron por incumplir un contrato (OECE).", cada: 10, cadencia: "Semanal", claves: ["osce_penalidades"],
    enlace: DATASET_PENALIDADES,
    hasta: `SELECT to_char(max(fecha), 'YYYY-MM-DD') AS v FROM penalidades WHERE fecha <= current_date` },
  // ── Presupuesto ──────────────────────────────────────────────────────────────────────────────────────────────────
  { clave: "mef", nombre: "Presupuesto y gasto", que: "Presupuesto (PIM) y gasto (devengado) de cada unidad ejecutora (MEF).", cada: 10, cadencia: "Semanal", claves: ["mef_presupuesto", "mef_opds_etes"],
    enlace: DATASET_MEF,
    hasta: `SELECT to_char(max(corte), 'YYYY-MM-DD') AS v FROM mef_ejecutora_anual` },
  // ── Empresas ─────────────────────────────────────────────────────────────────────────────────────────────────────
  { clave: "sunat", nombre: "Estado de las empresas", que: "Si cada empresa está activa, de baja, suspendida o no habida (padrón reducido de SUNAT).", cada: 10, cadencia: "Semanal", claves: ["sunat_padron"],
    enlace: CONSULTA_RUC_SUNAT,
    hasta: `SELECT to_char(max(cargado_at), 'YYYY-MM-DD') AS v FROM sunat_padron` },
  { clave: "sunat_ruc", nombre: "Fichas de las empresas", que: "Domicilio, actividad y fecha de alta de los proveedores (Consulta RUC de la SUNAT).", cada: null, cadencia: "A mano, cuando entran proveedores nuevos", claves: ["sunat_ruc"],
    enlace: CONSULTA_RUC_SUNAT,
    hasta: deLaBitacora("sunat_ruc", "descargado_at") },
  { clave: "rnp", nombre: "Socios y representantes", que: "Quién está detrás de cada proveedor: socios, representantes y directivos (RNP del OECE).", cada: 40, cadencia: "Mensual", claves: ["rnp_conformacion_juridica"],
    enlace: DATASET_SOCIOS_RNP,
    // La fecha de corte de la última fila cargada, por la llave primaria: no hay índice por fecha en 1,4 M de filas.
    hasta: `SELECT to_char(fecha_corte, 'YYYY-MM-DD') AS v FROM rnp_conformacion_juridica ORDER BY id DESC LIMIT 1` },
  // ── Política ─────────────────────────────────────────────────────────────────────────────────────────────────────
  { clave: "onpe", nombre: "Aportes y candidatos", que: "Aportes a organizaciones políticas y sus candidatos (ONPE, Claridad).", cada: 10, cadencia: "Semanal", claves: ["onpe_claridad"],
    enlace: CLARIDAD_ONPE,
    hasta: `SELECT to_char(max(fecha_aporte), 'YYYY-MM-DD') AS v FROM onpe_aportantes WHERE fecha_aporte <= current_date` },
  { clave: "onpe_gastos", nombre: "Gastos de campaña", que: "A quién le pagaron las campañas (ONPE).", cada: 10, cadencia: "Semanal", claves: ["onpe_gastos"],
    enlace: CLARIDAD_ONPE,
    hasta: `SELECT to_char(max(descargado_at), 'YYYY-MM-DD') AS v FROM onpe_gastos_proveedores` },
  { clave: "jne", nombre: "Autoridades electas", que: "Quién gobierna cada región, provincia y distrito (JNE).", cada: 40, cadencia: "Mensual", claves: ["jne_infogob"],
    enlace: DATASET_AUTORIDADES_JNE,
    hasta: `SELECT to_char(max(cargado_at), 'YYYY-MM-DD') AS v FROM jne_autoridades` },
  { clave: "jne_candidaturas", nombre: "Candidaturas", que: "Quién postuló y quién salió elegido en cada elección (JNE).", cada: null, cadencia: "Sin actualización", claves: ["jne_candidaturas"],
    enlace: PLATAFORMA_JNE,
    hasta: `SELECT to_char(max(cargado_en), 'YYYY-MM-DD') AS v FROM jne_candidaturas` },
  // ── Personas con cargo público ───────────────────────────────────────────────────────────────────────────────────
  { clave: "dji", nombre: "Declaraciones juradas de intereses: cargos y empleos", que: "El registro de declarantes con su cargo, su entidad y sus empleos anteriores (Contraloría, datos abiertos).", cada: 40, cadencia: "Mensual", claves: ["pnda_dji"],
    enlace: DATASET_DJI,
    // Cada reporte es el registro entero: llega hasta el día en que se bajó el último archivo distinto.
    hasta: deLaBitacora("pnda_dji", "descargado_at") },
  { clave: "dji_familiares", nombre: "Declaraciones juradas de intereses: familiares", que: "Los familiares y los intereses que declara cada funcionario, leídos de su declaración (Contraloría).", cada: null, cadencia: "Por rondas", claves: ["dji_familiares"],
    enlace: DJI_CONSULTA,
    hasta: `SELECT to_char(max(actualizado), 'YYYY-MM-DD') AS v FROM dji_descargas WHERE estado = 'ok'` },
  { clave: "planilla", nombre: "Planillas del Estado", que: "El personal que cada entidad publica (Portal de Transparencia).", cada: 40, cadencia: "Mensual", claves: ["pte_personal"],
    enlace: PORTAL_TRANSPARENCIA,
    hasta: `SELECT to_char((max(mes) + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD') AS v FROM planilla_entidad_mes` },
  { clave: "plazas", nombre: "Plazas CAS", que: "Convocatorias CAS (SERVIR Talento Perú).", cada: 3, cadencia: "Diaria", claves: ["servir_convocatorias"],
    enlace: TALENTO_PERU,
    hasta: `SELECT to_char(max(ultima_vez), 'YYYY-MM-DD') AS v FROM servir_convocatoria` },
  { clave: "practicas", nombre: "Prácticas", que: "Prácticas preprofesionales y profesionales (SERVIR Talento Perú).", cada: 3, cadencia: "Diaria", claves: ["servir_practicas"],
    enlace: PRACTICAS_SERVIR,
    hasta: `SELECT to_char(max(ultima_vez), 'YYYY-MM-DD') AS v FROM servir_practica` },
  // ── Visitas: tres registros distintos, cada uno con su carga ─────────────────────────────────────────────────────
  { clave: "visitas", nombre: "Visitas a entidades", que: "Visitas a unas 500 entidades desde 2020 (Registro de Visitas en Línea de la PCM).", cada: 40, cadencia: "Mensual, a mano", claves: ["portal_visitas_nacional"],
    enlace: VISITAS_EN_LINEA,
    hasta: `SELECT to_char(max(fecha_visita), 'YYYY-MM-DD') AS v FROM visitas_entidades WHERE fuente = 'portal_visitas_nacional' AND fecha_visita <= current_date` },
  { clave: "visitas_congreso", nombre: "Visitas al Congreso", que: "Quién entró al Congreso y a qué oficina fue (su registro público de visitas).", cada: 10, cadencia: "Semanal", claves: ["congreso_visitas"],
    enlace: VISITAS_CONGRESO,
    hasta: `SELECT to_char(max(fecha_visita), 'YYYY-MM-DD') AS v FROM visitas_entidades WHERE fuente = 'congreso_visitas' AND fecha_visita <= current_date` },
  { clave: "visitas_pnda", nombre: "Visitas (datos abiertos)", que: "El reporte mensual de visitas de la Plataforma Nacional de Datos Abiertos: sólo el Gobierno Regional de Loreto.", cada: 20, cadencia: "Quincenal", claves: ["pnda_visitas"],
    // El último reporte que publicó (lib/fuentes.ts: después de mayo de 2026 no hubo más).
    enlace: datasetVisitas("2026-05-01"),
    // El último mes cargado, por la bitácora (clave AAAA-MM): buscarlo en los 12 M de visitas no entra en el tope de la API.
    hasta: `SELECT to_char((to_date(max(clave), 'YYYY-MM') + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD') AS v
              FROM datasets_cargas WHERE fuente = 'pnda_visitas' AND estado = 'ok' AND clave ~ '^[0-9]{4}-[0-9]{2}$'` },
  // ── Control y anticorrupción ─────────────────────────────────────────────────────────────────────────────────────
  { clave: "contraloria", nombre: "Informes de control", que: "Informes con responsabilidad presunta de la Contraloría.", cada: 40, cadencia: "Mensual", claves: ["contraloria_informes"],
    enlace: BUSCADOR_CONTRALORIA,
    hasta: `SELECT to_char(max(fecha_emision), 'YYYY-MM-DD') AS v FROM informes_control WHERE fecha_emision <= current_date` },
  { clave: "contraloria_fichas", nombre: "Fichas de los informes de control", que: "El resumen de cada informe: objetivo, montos y observaciones (Contraloría).", cada: null, cadencia: "Mensual, a mano", claves: ["contraloria_fichas"],
    enlace: BUSCADOR_CONTRALORIA,
    hasta: `SELECT to_char(max(descargado_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS v FROM informe_control_ficha` },
  // Sin enlace: su sitio no responde (ver su `situacion` en el catálogo).
  { clave: "procuraduria", nombre: "Casos de la Procuraduría Anticorrupción", que: "Casos en trámite y con sentencia firme por sede, de su boletín mensual.", cada: 50, cadencia: "Mensual, a mano", claves: ["ppedc_boletin"],
    hasta: `SELECT to_char(max(corte), 'YYYY-MM-DD') AS v FROM procuraduria_casos_sede` },
  // ── Obras e inversiones ──────────────────────────────────────────────────────────────────────────────────────────
  { clave: "infobras", nombre: "Obras públicas", que: "Cada obra con su avance, su estado y sus adicionales (INFOBRAS, Contraloría).", cada: 10, cadencia: "Semanal", claves: ["infobras"],
    enlace: INFOBRAS,
    hasta: `SELECT to_char(max(dataset_fecha), 'YYYY-MM-DD') AS v FROM obra_infobras` },
  { clave: "inversiones", nombre: "Proyectos de inversión", que: "Cada inversión con su costo y su avance (Invierte.pe, MEF).", cada: 10, cadencia: "Semanal", claves: ["invierte_pe"],
    enlace: SEGUIMIENTO_INVERSIONES,
    // El día del archivo del MEF con que se escribió cada inversión (no `cargado_at`, que sólo cambia con un CUI nuevo).
    hasta: `SELECT to_char(max(dataset_fecha), 'YYYY-MM-DD') AS v FROM inversion_mef` },
];

/** Claves del catálogo que no son un registro para el público: una prueba, una tabla de cruce, crudos sin cargar, un relleno ya hecho y un legado. */
export const INTERNAS = ["salud_lima", "oece_entidades", "pnda_oece", "oece_historico", "portal_visitas_manual", "oece_fichas"];

export type EstadoPublico = "al_dia" | "atrasada" | "error" | "manual" | "fuente_vieja";

/**
 * El estado que leen los clientes que todavía no conocen `situacion` (la web y el MCP ya desplegados): el que menos
 * engaña de los cinco de siempre. Una fuente rota o parada no puede salir «al día».
 */
export const ESTADO_DE_SITUACION: Record<TipoSituacion, EstadoPublico> = { rota: "atrasada", parada: "atrasada", sin_novedad: "fuente_vieja", foto: "manual" };

/**
 * El estado que dicen las bitácoras. `ultima`: la última corrida del Worker (las cargas de PC no tienen); `ultimaOk`: el
 * día de la última corrida o carga buena; `hasta`: hasta dónde llegan los datos. Fechas AAAA-MM-DD.
 */
export function estadoPublico(p: { cada: number | null; ultima: { estado: string; inicio: string } | null; ultimaOk: string | null; hasta: string | null; hoy: number }): EstadoPublico {
  if (p.cada == null) return "manual";
  const dias = (d: string) => (p.hoy - Date.parse(`${d}T12:00:00Z`)) / 86_400_000;
  if (p.ultima?.estado === "error" && (!p.ultimaOk || p.ultimaOk < p.ultima.inicio)) return "error";
  if (!p.ultimaOk || dias(p.ultimaOk) > p.cada) return "atrasada";
  // Se carga bien, pero lo que trae es de hace más de tres meses: la fuente dejó de publicar (no es «al día»).
  return p.hasta && dias(p.hasta) > 90 ? "fuente_vieja" : "al_dia";
}

const DEL_CATALOGO = new Map(CATALOGO.map((f) => [f.fuente, f]));
/** Se carga desde una PC (o por rondas de CI que una PC procesa): su bitácora es datasets_cargas, no corridas_fuente. */
const deUnaPc = (clave: string) => ["pc", "ci"].includes(DEL_CATALOGO.get(clave)?.donde ?? "");

/** La situación declarada en el catálogo para la fila (la de la primera de sus claves que la tenga). */
export const situacionDe = (f: FuentePublica) => f.claves.map((k) => DEL_CATALOGO.get(k)?.situacion).find((s) => !!s) ?? null;

const uno = (sql: string) => pool.query<{ v: string | null }>(sql).then((r) => r.rows[0]?.v ?? null).catch(() => null);

/**
 * De a `n` a la vez y en orden. En Workers el pool de un pedido tiene 3 conexiones y la espera de una libre corta a los
 * 5 s (lib/db.ts): con una consulta por fuente lanzadas todas juntas, las últimas de la fila podían salir «Sin dato».
 */
async function deATandas<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await f(items[k]);
    }
  }));
  return out;
}

type Corrida = { fuente: string; ok: string | null; estado: string; inicio: string };

estadoRouter.get("/datos", async (c) => {
  const cuerpo = await memo.obtener("datos", async () => {
    const [corridas, cargas] = await Promise.all([
      pool
        .query<Corrida>(
          `SELECT DISTINCT ON (fuente) fuente, estado, to_char(inicio, 'YYYY-MM-DD') AS inicio,
                  (SELECT to_char(max(x.fin), 'YYYY-MM-DD') AS v FROM corridas_fuente x WHERE x.fuente = c.fuente AND x.estado = 'ok') AS ok
             FROM corridas_fuente c ORDER BY fuente, inicio DESC`)
        .then((r) => new Map(r.rows.map((x) => [x.fuente, x])))
        .catch(() => new Map<string, Corrida>()),
      // La última carga buena de cada fuente que se carga desde una PC. null: la bitácora no se pudo leer.
      pool
        .query<{ fuente: string; ok: string | null }>(
          `SELECT fuente, to_char(max(cargado_at) FILTER (WHERE estado = 'ok'), 'YYYY-MM-DD') AS ok FROM datasets_cargas GROUP BY fuente`)
        .then((r) => new Map(r.rows.map((x) => [x.fuente, x.ok])))
        .catch(() => null),
    ]);
    const hoy = Date.now();
    const fuentes = await deATandas(FUENTES, 3, async (f) => {
      const hasta = await uno(f.hasta);
      const delWorker = f.claves.filter((k) => !deUnaPc(k));
      const ultimas = delWorker.map((k) => corridas.get(k)).filter((u): u is Corrida => !!u);
      const buenas = [...ultimas.map((u) => u.ok), ...f.claves.filter(deUnaPc).map((k) => cargas?.get(k) ?? null)];
      const ultimaOk = buenas.filter((d): d is string => !!d).sort().pop() ?? null;
      const ultima = ultimas.sort((a, b) => b.inicio.localeCompare(a.inicio))[0] ?? null;
      // Sólo de PC y sin bitácora que leer: no se sabe cuándo cargó, así que no se la da por atrasada.
      const aCiegas = !delWorker.length && cargas === null;
      const situacion = situacionDe(f);
      const estado = situacion ? ESTADO_DE_SITUACION[situacion.tipo] : estadoPublico({ cada: aCiegas ? null : f.cada, ultima, ultimaOk, hasta, hoy });
      return {
        clave: f.clave, nombre: f.nombre, que: f.que, cadencia: f.cadencia, hasta, ultimaCarga: ultimaOk, estado,
        // Lo declarado a mano en el catálogo: manda sobre el estado calculado y trae su explicación.
        situacion: situacion?.tipo ?? null, nota: situacion?.nota ?? f.nota ?? null, enlace: f.enlace ?? null,
      };
    });
    return { fuentes, generado: new Date().toISOString() };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
