import { Hono } from "hono";
import { z } from "zod";
import { consultaConPlazo, escaparLike, pool } from "../lib/db.js";
import { COLS_ESTADO_FILA, joinsEstadoFila } from "../lib/estadoFila.js";
import { cachePublico, parametros } from "../lib/http.js";
import { Memo } from "../lib/cache.js";
import { hayModelosLectura } from "../lib/esquema.js";
import { crucesDeEntidad, fraccionamientoDeEntidad } from "../lib/cruces.js";
import { apellidoFuncionario, publicar } from "../lib/privacidad.js";
import { alertaNoDemo, alertaPublica, convocatoriaNoDemo, ENTIDAD_METADATA_MOCK } from "../lib/publicacion.js";
import { hayObras } from "./obras.js";

export const entidadesRouter = new Hono();

// Agregados de alertas: solo `activa` (como siempre) y NUNCA las semillas de demo `ALT-…`. Tampoco
// se leen las claves `*_mock` que seed_db.py dejó en entidades.metadata (reportes_mock, serie_mock,
// contratos, contratos_vigilados…): eran cifras inventadas. Ver lib/publicacion.ts §1.
const ALERTAS_ACTIVAS = `a.estado = 'activa' AND ${alertaNoDemo("a")}`;

/**
 * De qué tipo es una entidad, por su nombre oficial (en minúsculas y sin tildes), con la primera regla que calce: la
 * MISMA lista y el mismo orden que frontend/lib/entidad-tipo.ts (test/entidades_tipo.test.ts las compara). `\m` y `\M`
 * son los bordes de palabra de Postgres (`\b` en JavaScript). Un tipo `null` corta ahí: esa entidad no se clasifica.
 *
 * Antes iba primero el tipo declarado en `entidades.tipo` (casi todo NULL, y el que hay vino de una semilla: Petroperú,
 * el Ejército, EMAPE y cuatro universidades decían «organismo autónomo») y todo «instituto», «autoridad» o «registro»
 * era un organismo autónomo (el Instituto Vial Provincial de Chupaca lo era). Ahora el nombre manda, «organismo
 * autónomo» es sólo para los que lo son de verdad (JNE, ONPE, RENIEC, Contraloría, Defensoría, BCRP, SBS, TC, JNJ,
 * Ministerio Público, Poder Judicial) y hay tipos para universidades, salud, educación, programas, beneficencias, las
 * Fuerzas Armadas y la Policía, empresas del Estado y el resto de organismos públicos. El orden importa: «Ministerio
 * Público» antes que «ministerio», «Ministerio de Salud» antes que «salud», un hospital del gobierno regional es salud.
 */
export const REGLAS_TIPO_ENTIDAD: [tipo: string | null, patron: string][] = [
  // Primero las municipalidades: son seis de cada diez y ningún nombre de municipalidad calza con las reglas de abajo
  // (así seis de cada diez filas salen con la primera o la segunda expresión: la faceta de tipos recorre las 3,162).
  ["municipal_distrital", String.raw`\m(municipalidad\s+(distrital|de\s+centro\s+poblado)|concejo\s+distrital|gobierno\s+local\s+distrital)\M`],
  ["municipal_provincial", String.raw`\mmunicipalidad\M`],
  ["organismo_autonomo", String.raw`\m(jurado nacional de elecciones|oficina nacional de procesos electorales|registro nacional de identificacion|reniec|contraloria general|defensoria del pueblo|banco central de reserva|superintendencia de banca|tribunal constitucional|junta nacional de justicia|consejo nacional de la magistratura|academia de la magistratura|ministerio publico|poder judicial|corte superior de justicia)\M`],
  // Una mancomunidad junta municipalidades: no es ninguna de ellas (ni la región que nombra).
  [null, String.raw`^mancomunidad\M`],
  ["universidad", String.raw`\muniversidad\M`],
  ["beneficencia", String.raw`\mbeneficencia\M`],
  ["salud", String.raw`\m(hospital|clinica|diris|diresa|geresa|essalud|utes|micro\s?red(es)?|enfermedades\s+neoplasicas)\M|\mred(es)?\s+(integradas\s+)?de\s+(servicios\s+de\s+)?salud\M|\mdireccion\s+(regional\s+)?de\s+salud\M|\minstituto\s+(nacional\s+(de\s+salud|materno|de\s+oftalmologia|de\s+rehabilitacion|de\s+ciencias\s+neurologicas)|regional\s+de\s+oftalmologia)|\m(establecimiento|seguro\s+social|seguro\s+integral|servicios\s+basicos)\s+de\s+salud\M|\munidad\s+ejecutora:?\s+(\d+\s+)?(de\s+)?salud\M`],
  ["educacion", String.raw`\m(ugel|colegio|unidad\s+de\s+gestion\s+educativa|(direccion|gerencia)\s+regional\s+de\s+educacion)\M|\munidad\s+ejecutora:?\s+(\d+\s+)?educacion\M`],
  ["ministerio", String.raw`\mministerio\M|^mef\M`],
  ["empresa_publica", String.raw`\m(empresa|e\.?p\.?s|entidad\s+prestadora|sedapal|petroleos\s+del\s+peru|petroperu|perupetro|electro\w*|egemsa|egasa|egesur|san\s+gaban|enapu|serpost|servicios\s+postales|corpac|banco\s+de\s+la\s+nacion|corporacion\s+financiera\s+de\s+desarrollo|fondo\s+mivivienda|fonafe|fondo\s+nacional\s+de\s+financiamiento\s+de\s+la\s+actividad\s+empresarial|activos\s+mineros|sociedad\s+electrica|servicio\s+industrial\s+de\s+la\s+marina|sociedad\s+anonima)\M|^servicio\s+(municipal\s+)?de\s+agua\s+potable\M|(^|[^a-z])(s\.?\s?a\.?\s?[ac]?\.?|s\.?\s?r\.?\s?l(tda)?\.?|sac|saa)\s*$`],
  ["fuerzas_armadas", String.raw`\m(ejercito|marina\s+de\s+guerra|fuerza\s+aerea|fuerzas\s+armadas|policia\s+nacional|policial|pnp|rpnp|dirtepol|comando\s+conjunto|militar|iafas)\M|\mdireccion\s+territorial\s+de\s+policia\M`],
  ["programa", String.raw`\m(programa|proyectos?\s+especial(es)?|provias|plan\s+copesco|foncodes|fondo\s+de\s+cooperacion\s+para\s+el\s+desarrollo\s+social|fondo\s+sierra\s+azul)\M`],
  ["salud", String.raw`\msalud\M`],
  ["educacion", String.raw`\m(educacion|educativ[ao]s?|escuela|pedagogico|conservatorio)\M`],
  ["gobierno_regional", String.raw`\mgobierno\s+rer?gional\M|\mregion\s+[a-z]|\mgerencia\s+sub-?\s?regional\M`],
  ["organismo_publico", String.raw`\m(organismo|superintendencia|instituto|institucion\s+vial|autoridad|servicio\s+nacional|servicio\s+de\s+administracion\s+tributaria|agencia|comision|consejo\s+nacional|centro\s+nacional|oficina\s+nacional|oficina\s+de\s+normalizacion\s+previsional|archivo\s+general|biblioteca\s+nacional|procuraduria|zona\s+registral|inpe|sunat|sunarp)\M|^onp\M`],
  ["gobierno_regional", String.raw`\mdireccion\s+regional\M`],
];

/**
 * Los tipos declarados en `entidades.tipo` que se aceptan cuando el nombre no dice nada. «organismo_autonomo» no: la
 * semilla lo puso a entidades que no lo son.
 */
const TIPOS_DECLARADOS_CONFIABLES = ["municipal_distrital", "municipal_provincial", "gobierno_regional", "ministerio", "empresa_publica"];

/**
 * El tipo de la entidad como lo MUESTRA la web (frontend/lib/entidad-tipo.ts): el que dice su nombre oficial
 * (`REGLAS_TIPO_ENTIDAD`) y, si no dice nada, el declarado en `tipo`. NULL = sin clasificar. `t` es el alias de la
 * tabla y `nombre`, su nombre en minúsculas y sin tildes.
 */
export const CLASE_SQL = (t: string, nombre: string) => `CASE
  ${REGLAS_TIPO_ENTIDAD.map(([tipo, p]) => `WHEN ${nombre} ~ '${p}' THEN ${tipo ? `'${tipo}'` : "NULL"}`).join("\n  ")}
  WHEN ${t}.tipo IN (${TIPOS_DECLARADOS_CONFIABLES.map((x) => `'${x}'`).join(", ")}) THEN ${t}.tipo
END`;

/** Sin tildes y en minúsculas, como `immutable_unaccent(lower(nombre))` (la ñ queda n). */
export const nombreNormal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const REGLAS_JS = REGLAS_TIPO_ENTIDAD.map(([tipo, p]) => [tipo, new RegExp(p.replace(/\\[mM]/g, "\\b"))] as const);

/** `CLASE_SQL` en JavaScript, para probar las reglas sin la base. */
export function tipoDeEntidad(nombre: string | null | undefined, declarado?: string | null): string | null {
  const n = nombreNormal(nombre ?? "");
  for (const [tipo, re] of REGLAS_JS) if (re.test(n)) return tipo;
  return declarado && TIPOS_DECLARADOS_CONFIABLES.includes(declarado) ? declarado : null;
}

/**
 * Un nombre que no es un nombre (la carga dejó «nan» en una entidad de 2016): no va en las listas ni en la búsqueda.
 * El registro sigue en la base y su ficha se abre por el RUC. `nombre`, en minúsculas y sin tildes.
 */
export const NOMBRE_VALIDO = (nombre: string) => `${nombre} !~ '^\\s*(nan|none|null|n/?a|-+)?\\s*$'`;
/** Lo mismo en JavaScript (la ficha no muestra «nan» como nombre). */
export const nombreValido = (nombre: string | null | undefined) => !!nombre && !/^\s*(nan|none|null|n\/?a|-+)?\s*$/i.test(nombre);

/** Cada `clase` del filtro y los tipos de `CLASE_SQL` que junta (`municipal`: las dos municipalidades; `sin`: ninguno). */
const CLASES: Record<string, (string | null)[]> = {
  ministerio: ["ministerio"],
  regional: ["gobierno_regional"],
  municipal: ["municipal_provincial", "municipal_distrital"],
  provincial: ["municipal_provincial"],
  distrital: ["municipal_distrital"],
  universidad: ["universidad"],
  salud: ["salud"],
  educacion: ["educacion"],
  programa: ["programa"],
  beneficencia: ["beneficencia"],
  fuerzas: ["fuerzas_armadas"],
  empresa: ["empresa_publica"],
  organismo: ["organismo_autonomo"],
  publico: ["organismo_publico"],
  sin: [null],
};
export const CLASES_ENTIDAD = Object.keys(CLASES) as [string, ...string[]];

/** La condición sobre `CLASE_SQL` de una clase del filtro. */
const condicionClase = (clase: string) => {
  const tipos = CLASES[clase];
  return tipos.includes(null) ? "IS NULL" : `IN (${tipos.map((t) => `'${t}'`).join(", ")})`;
};

/** Los RUC de cada tipo (`tipoDeEntidad`; `sin` = sin clasificar). */
export type RucsPorTipo = Record<string, string[]>;
/** Los RUC de una clase del filtro, de la lista ya clasificada. */
export const rucsDeClase = (porTipo: RucsPorTipo, clase: string) => CLASES[clase].flatMap((t) => porTipo[t ?? "sin"] ?? []);

const tiposMemo = new Memo<RucsPorTipo>({ nombre: "entidades:tipos", ttlMs: 600_000, staleMs: 3_600_000, max: 2 });
/**
 * Los RUC de cada tipo, clasificados una vez en JavaScript con `tipoDeEntidad` (las mismas reglas que `CLASE_SQL`): con
 * `CLASE_SQL` el filtro por tipo recorría las 3,162 con ~17 expresiones regulares (100 a 160 ms en prod; con la lista,
 * 2 a 3 ms por la llave, EXPLAIN del 2026-10-27). null si no se pudo: entonces el filtro va con `CLASE_SQL`.
 */
export const rucsPorTipo = (modelos: boolean) =>
  tiposMemo
    .obtener(modelos ? "es" : "e", async () => {
      const r = await pool.query<{ ruc: string; nombre: string | null; tipo: string | null }>(
        `SELECT ruc::text AS ruc, nombre, tipo FROM ${modelos ? "entidad_stats" : "entidades"}`);
      const out: RucsPorTipo = {};
      for (const x of r.rows) (out[tipoDeEntidad(x.nombre, x.tipo) ?? "sin"] ??= []).push(x.ruc.trim());
      return out;
    })
    .catch((e) => { console.warn(`[entidades] tipos: ${(e as Error).message}`); return null; });

/**
 * Las entidades donde un pariente que un funcionario declaró en su DJI es su locador: lo mismo que la vista
 * dji_nepotismo (migraciones 136-139), sin agruparla. La vista cruza `substr(ruc, 3, 8)` con el DNI del pariente y
 * recorre todas las órdenes de cada entidad (la lista tardaba 2,6 s, y 6 s con el filtro puesto); el RUC 10 es «10» +
 * DNI + un dígito, así que basta un rango sobre la llave de persona_orden_anual (entidad, ruc). Son ~115 de 3,162: se
 * calculan una vez para todas (`entidadesConNepotismo`) y la lista y sus conteos sólo miran si el RUC está entre ellas.
 */
export const PARIENTE_LOCADOR = `length(v.pariente_doc) = 8
     AND EXISTS (SELECT 1 FROM persona_orden_anual po
                  WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9')`;
/** Los funcionarios (entidad y nombre normalizado, el de la planilla) que declararon a un pariente que es su locador. */
export const SQL_NEPOTISMO = `SELECT DISTINCT v.entidad_ruc AS entidad, v.declarante_norm AS declarante FROM dji_vinculos v
   WHERE v.declarante_norm IS NOT NULL AND ${PARIENTE_LOCADOR}`;

export interface FuncionariosConPariente { entidades: string[]; declarantes: string[] }
const nepotismoMemo = new Memo<FuncionariosConPariente>({ nombre: "entidades:nepotismo", ttlMs: 600_000, staleMs: 3_600_000, max: 1 });
/**
 * Los pares entidad × funcionario del indicio (~320), calculados una vez para todas las listas (la de entidades y la de
 * planilla), o null si no se pudo (entonces cada condición va fila por fila, con `PARIENTE_LOCADOR`).
 */
export const funcionariosConPariente = () =>
  nepotismoMemo
    .obtener("todos", async () => {
      const r = await consultaConPlazo<{ entidad: string; declarante: string }>(SQL_NEPOTISMO, [], 30_000);
      return { entidades: r.rows.map((x) => x.entidad), declarantes: r.rows.map((x) => x.declarante) };
    })
    .catch((e) => { console.warn(`[nepotismo] ${(e as Error).message}`); return null; });

/** La lista de entidades con el indicio, o null si no se pudo calcular. */
const entidadesConNepotismo = async () => {
  const f = await funcionariosConPariente();
  return f ? [...new Set(f.entidades)] : null;
};

/** El RUC (`ruc`, la columna) tiene el indicio: está en la lista (`param`, su `$n`) o, sin ella, por su cuenta. */
const enNepotismo = (ruc: string, param: string | null) =>
  param ? `${ruc}::text = ANY (${param}::text[])` : `EXISTS (SELECT 1 FROM dji_vinculos v WHERE v.entidad_ruc = ${ruc} AND ${PARIENTE_LOCADOR})`;

/**
 * Lo que otros registros dicen de la entidad, como condición sobre su RUC (`r`): la misma filtra la lista y cuenta cada
 * opción. Todas van por un índice de su tabla (entidad primero).
 */
export const SENALES_ENTIDAD = {
  // Contratos con indicio de captura por el partido que la gobierna (financió, vendió a su campaña, socio en la entidad).
  captura: (r: string) => `EXISTS (SELECT 1 FROM poder_entidad p WHERE p.entidad_ruc = ${r} AND p.n_captura > 0)`,
  // Informes de control de la Contraloría, con responsabilidad presunta (no es una condena).
  penal: (r: string) => `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r} AND 'penal' = ANY (i.responsabilidades))`,
  civil: (r: string) => `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r} AND 'civil' = ANY (i.responsabilidades))`,
  administrativa: (r: string) =>
    `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r} AND i.responsabilidades && ARRAY['administrativa_entidad', 'administrativa_pas', 'administrativa'])`,
  informes: (r: string) => `EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = ${r})`,
  // Su planilla (Portal de Transparencia): alguien con una señal alta, o que la publica.
  planillaAlta: (r: string) => `EXISTS (SELECT 1 FROM planilla_persona pp WHERE pp.entidad_ruc = ${r} AND pp.sev = 3)`,
  planilla: (r: string) => `EXISTS (SELECT 1 FROM planilla_persona pp WHERE pp.entidad_ruc = ${r})`,
  // Sus plazas CAS (SERVIR): alguna con señales de plaza a la medida, o alguna publicada.
  plazasSenales: (r: string) => `EXISTS (SELECT 1 FROM servir_convocatoria s WHERE s.entidad_ruc = ${r} AND s.n_senales > 0)`,
  plazas: (r: string) => `EXISTS (SELECT 1 FROM servir_convocatoria s WHERE s.entidad_ruc = ${r})`,
  // Quienes financiaron la campaña del que gobierna trabajan para ella (locadores o planilla, migraciones 177-178).
  financio: (r: string) => `EXISTS (SELECT 1 FROM entidad_senal_politica esp WHERE esp.ruc = ${r}::text)`,
} as const;

export const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  region: z.string().max(80).optional(),
  tipo: z.string().max(60).optional(),
  // El tipo de la entidad (`CLASE_SQL`). Es un filtro, no una afirmación categórica: "ministerio" incluye al
  // Ministerio Público, etc.
  clase: z.enum(CLASES_ENTIDAD).optional(),
  // La provincia: los cuatro primeros dígitos del ubigeo.
  provincia: z.string().regex(/^\d{4}$/).optional(),
  // El partido que la gobierna (poder_entidad: gobiernos regionales y municipalidades) y si tiene contratos con indicio
  // de captura por él (migraciones 125 y 140).
  partido: z.string().trim().min(2).max(120).optional(),
  captura: z.enum(["1"]).optional(),
  // Informes de la Contraloría por el tipo de responsabilidad (presunta) que señalan, o cualquiera (migración 90).
  control: z.enum(["penal", "civil", "administrativa", "alguno"]).optional(),
  planilla: z.enum(["alta", "con"]).optional(),
  plazas: z.enum(["senales", "con"]).optional(),
  // Solo las entidades con indicio de nepotismo (un pariente declarado en la DJI que es su locador; vista migr. 136).
  nepotismo: z.enum(["1"]).optional(),
  // Las que tienen locadores o personas de planilla que financiaron la campaña del que la gobierna (migración 178).
  financio: z.enum(["1"]).optional(),
  // Por defecto, las que más contratos tienen desde 2015: un dato que toda entidad tiene (con dictamen hay ~180 de 3,162
  // y la lista ordenada por eso se leía vacía: «0 de 426, Sin dato, Sin dato»).
  orden: z.enum(["contratos", "dictamen", "nombre"]).default("contratos"),
  // Con `facetas=1`, cuántas entidades hay en cada opción de los filtros (lo pide /app/entidades).
  facetas: z.enum(["1"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
type ListaEntidadesQ = z.infer<typeof ListQuery>;

const CONTROL: Record<NonNullable<ListaEntidadesQ["control"]>, keyof typeof SENALES_ENTIDAD> = {
  penal: "penal", civil: "civil", administrativa: "administrativa", alguno: "informes",
};

/**
 * Las condiciones de la lista sobre la tabla `t` (`nombre`: su nombre normalizado), con sus valores en `vals` (que puede
 * traer otros: las facetas juntan varias en una consulta). `nepotismo`: las entidades con ese indicio. `porTipo`: los RUC
 * de cada tipo ya clasificados (`rucsPorTipo`): el filtro por tipo va por la llave; sin ellos, con `CLASE_SQL`.
 */
export function filtrosEntidades(
  q: Partial<ListaEntidadesQ>, t: string, nombre: string, vals: unknown[] = [], nepotismo: string[] | null = null,
  porTipo: RucsPorTipo | null = null,
): { conds: string[]; vals: unknown[] } {
  const conds: string[] = [];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const ruc = `${t}.ruc`;
  // Un RUC (o su comienzo): el placeholder dice "por nombre o RUC" y antes sólo miraba el nombre.
  if (q.q && /^\d{4,11}$/.test(q.q)) conds.push(`${ruc}::text LIKE ${p(`${q.q}%`)}`);
  else if (q.q) conds.push(`${nombre} LIKE immutable_unaccent(${p(`%${escaparLike(q.q.toLowerCase())}%`)})`);
  if (q.region) conds.push(`${t}.region = ${p(q.region)}`);
  if (q.tipo) conds.push(`${t}.tipo = ${p(q.tipo)}`);
  if (q.clase) {
    conds.push(porTipo ? `${ruc} = ANY (${p(rucsDeClase(porTipo, q.clase))}::bpchar[])` : `(${CLASE_SQL(t, nombre)}) ${condicionClase(q.clase)}`);
  }
  if (q.provincia) conds.push(`left(${t}.ubigeo, 4) = ${p(q.provincia)}`);
  if (q.partido) conds.push(`EXISTS (SELECT 1 FROM poder_entidad pp WHERE pp.entidad_ruc = ${ruc} AND pp.partido = ${p(q.partido)})`);
  if (q.captura) conds.push(SENALES_ENTIDAD.captura(ruc));
  if (q.control) conds.push(SENALES_ENTIDAD[CONTROL[q.control]](ruc));
  if (q.planilla) conds.push(SENALES_ENTIDAD[q.planilla === "alta" ? "planillaAlta" : "planilla"](ruc));
  if (q.plazas) conds.push(SENALES_ENTIDAD[q.plazas === "senales" ? "plazasSenales" : "plazas"](ruc));
  if (q.nepotismo) conds.push(enNepotismo(ruc, nepotismo && p(nepotismo)));
  if (q.financio) conds.push(SENALES_ENTIDAD.financio(ruc));
  // Siempre: una entidad cuyo nombre es «nan» no se lista ni se cuenta (su ficha sigue abriéndose por el RUC).
  conds.push(NOMBRE_VALIDO(nombre));
  return { conds, vals };
}

const ORDEN_ENTIDADES: Record<ListaEntidadesQ["orden"], { es: string; e: string }> = {
  dictamen: { es: "es.alertas_activas DESC, es.contratos DESC NULLS LAST, es.nombre, es.ruc", e: "a.alertas DESC NULLS LAST, cv.contratos DESC NULLS LAST, e.nombre, e.ruc" },
  contratos: { es: "es.contratos DESC NULLS LAST, es.nombre, es.ruc", e: "cv.contratos DESC NULLS LAST, e.nombre, e.ruc" },
  nombre: { es: "es.nombre_norm, es.ruc", e: "immutable_unaccent(lower(e.nombre)), e.ruc" },
};

/**
 * Por entidad, cuántos de sus contratos tienen un ganador con antecedentes y cuántos uno grave: lo mismo que cuenta su
 * ficha («con antecedentes del ganador», GET /contratos/resumen?entidad=: casos_cruce, sin la semilla de demo), para
 * todas a la vez. Contado fila por fila en la lista costaba 0,5 s en frío (las veinte más grandes juntan ~40 mil casos);
 * para todas, una pasada por hash sobre casos_cruce (0,3 s; 0,8 s en frío, EXPLAIN en prod del 2026-10-27), una vez cada
 * diez minutos y en segundo plano (stale-while-revalidate). Cambia cuando cambia casos_cruce (el refresco de cruces).
 */
export const SQL_ANTECEDENTES_POR_ENTIDAD = `SELECT x.entidad_ruc AS ruc, count(*)::int AS con, (count(*) FILTER (WHERE x.alta))::int AS alta
   FROM (SELECT k.entidad_ruc, k.ocid, bool_or(k.n_alta > 0) AS alta FROM casos_cruce k
          WHERE ${convocatoriaNoDemo("k")} AND k.entidad_ruc IS NOT NULL GROUP BY 1, 2) x
  GROUP BY 1`;
const antecedentesMemo = new Memo<Record<string, [con: number, alta: number]>>({ nombre: "entidades:antecedentes", ttlMs: 600_000, staleMs: 3_600_000, max: 1 });
/** `{ ruc: [con, alta] }` de todas las entidades con algún contrato con antecedentes, o null si no se pudo contar. */
export const antecedentesPorEntidad = () =>
  antecedentesMemo
    .obtener("todas", async () => {
      // La cuenta ya hecha (migración 175: la rehace el Worker de scrapers con los cruces): agregar casos_cruce en cada
      // Worker frío costaba 1 a 10 s por pedido. Sin la tabla (una base sin la migración), en vivo como antes.
      const hecha = await pool.query<{ ruc: string; con: number; alta: number }>("SELECT ruc, con, alta FROM entidad_antecedentes").catch(() => null);
      const filas = hecha?.rows.length
        ? hecha.rows
        : (await consultaConPlazo<{ ruc: string; con: number; alta: number }>(SQL_ANTECEDENTES_POR_ENTIDAD, [], 30_000)).rows;
      return Object.fromEntries(filas.map((x) => [x.ruc.trim(), [x.con, x.alta] as [number, number]]));
    })
    .catch((e) => { console.warn(`[entidades] antecedentes: ${(e as Error).message}`); return null; });

/** El presupuesto de un año del MEF de una entidad (`mef_entity_budget.by_year`). */
interface AnioMef { year: number; pia: number; pim: number; devengado: number; girado: number }
export interface PresupuestoEntidad { anio: number; pim: number; devengado: number; deTodoElGobierno: boolean }

/**
 * Su presupuesto (PIM) del último año del MEF, como lo muestra su ficha: si el último año repite tal cual al anterior,
 * el archivo del año nuevo todavía no llegó y va el anterior; si cruzó con el pliego regional entero (`keyword`
 * «pliego …»), es el de todo el gobierno regional. null sin cruce con el MEF o sin presupuesto.
 */
export function presupuestoDe(porAnio: unknown, keyword: string | null | undefined, kind: string | null | undefined): PresupuestoEntidad | null {
  if (kind !== "ok" || !Array.isArray(porAnio)) return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const anios: AnioMef[] = porAnio
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ year: Number(x?.year), pia: n(x?.pia), pim: n(x?.pim), devengado: n(x?.devengado), girado: n(x?.girado) }))
    .filter((x) => Number.isInteger(x.year))
    .sort((a, b) => a.year - b.year);
  let fin = anios.length - 1;
  const u0 = anios[fin];
  const a = anios[fin - 1];
  if (u0 && a && u0.pim > 0 && u0.pia === a.pia && u0.pim === a.pim && u0.devengado === a.devengado && u0.girado === a.girado) fin--;
  // El último año con presupuesto vigente (migración 152: la historia desde 2015). Una unidad que se cierra suele traer un
  // año más con sólo el PIA y el PIM en cero (Progresa del MIDIS en 2020): ese no es su presupuesto.
  while (fin >= 0 && !(anios[fin].pim > 0)) fin--;
  const u = anios[fin];
  if (!u) return null;
  return { anio: u.year, pim: u.pim, devengado: u.devengado, deTodoElGobierno: (keyword ?? "").startsWith("pliego ") };
}

/**
 * Lo que la lista dice de cada entidad de la página además de sus conteos (`pag` ya recortada a la página): sus informes
 * de la Contraloría (y cuántos con responsabilidad penal presunta), su presupuesto del MEF y lo que cuentan los filtros
 * de «Filtros» (captura, planilla con señal alta, plazas a la medida). Todo por la llave o un índice de la entidad: ~1 ms
 * por fila (EXPLAIN en prod del 2026-10-27).
 */
export const COLS_LISTA_ENTIDAD = `ic.informes, ic.penal AS "informesPenal",
       b.by_year AS "mefAnios", b.keyword AS "mefCruce", b.kind AS "mefKind",
       COALESCE(pe.n_captura, 0)::int AS captura, pe.partido AS "capturaPartido",
       to_char(pe.periodo_inicio, 'YYYY-MM-DD') AS "capturaDesde", to_char(pe.periodo_fin, 'YYYY-MM-DD') AS "capturaHasta",
       (SELECT count(*) FROM planilla_persona pp WHERE pp.entidad_ruc = pag.ruc::text AND pp.sev = 3)::int AS "planillaAlta",
       (SELECT count(*) FROM servir_convocatoria s WHERE s.entidad_ruc = pag.ruc::text AND s.n_senales > 0)::int AS "plazasSenales",
       COALESCE(esp.locadores, 0)::int AS "financioLocadores", COALESCE(esp.planilla, 0)::int AS "financioPlanilla", esp.partido AS "financioPartido"`;
export const JOINS_LISTA_ENTIDAD = `LEFT JOIN LATERAL (
         SELECT count(*)::int AS informes, (count(*) FILTER (WHERE 'penal' = ANY (i.responsabilidades)))::int AS penal
           FROM informes_control i WHERE i.entidad_ruc = pag.ruc) ic ON true
       LEFT JOIN mef_entity_budget b ON b.entidad_ruc = pag.ruc
       LEFT JOIN poder_entidad pe ON pe.entidad_ruc = pag.ruc::text
       -- Quienes financiaron la campaña del que gobierna y trabajan aquí (migraciones 177-178).
       LEFT JOIN entidad_senal_politica esp ON esp.ruc = pag.ruc::text`;

const facetasMemo = new Memo<Record<string, unknown>>({ nombre: "entidades:facetas", ttlMs: 600_000, staleMs: 3_600_000, max: 300 });

/**
 * Cuántas entidades hay en cada opción de los filtros, sobre lo que fija el lugar y el tipo (región, provincia, tipo) y
 * sin el filtro de cada faceta (los tipos, sin el tipo elegido; las provincias, sin la provincia): así ninguna opción
 * lleva a cero. Las señales se cuentan sobre ese mismo alcance, no sobre las otras señales. Una sola consulta (con
 * plazo propio: en frío, las señales de las 3,162 entidades pasan los 10 s del rol), guardada por alcance.
 */
export function sqlFacetasEntidades(
  q: Partial<ListaEntidadesQ>, modelos: boolean, nepotismo: string[] | null, porTipo: RucsPorTipo | null = null,
): { sql: string; vals: unknown[] } {
  const tabla = modelos ? "entidad_stats x" : "entidades x";
  const nombre = modelos ? "x.nombre_norm" : "immutable_unaccent(lower(x.nombre))";
  const vals: unknown[] = [];
  const donde = (f: Partial<ListaEntidadesQ>) => {
    const { conds } = filtrosEntidades(f, "x", nombre, vals, null, porTipo);
    return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  };
  const sinClase = donde({ region: q.region, provincia: q.provincia });
  const sinProvincia = donde({ region: q.region, clase: q.clase });
  const alcance = donde({ region: q.region, provincia: q.provincia, clase: q.clase });
  if (nepotismo) vals.push(nepotismo);
  const senales = [
    ...Object.entries(SENALES_ENTIDAD).map(([k, f]) => `'${k}', count(*) FILTER (WHERE ${f("x.ruc")})`),
    `'nepotismo', count(*) FILTER (WHERE ${enNepotismo("x.ruc", nepotismo && `$${vals.length}`)})`,
  ].join(", ");
  const sql = `SELECT
      (SELECT COALESCE(json_agg(json_build_object('valor', COALESCE(t.v, 'sin'), 'n', t.n) ORDER BY t.n DESC), '[]')
         FROM (SELECT ${CLASE_SQL("x", nombre)} AS v, count(*)::int AS n FROM ${tabla} ${sinClase} GROUP BY 1) t) AS tipos,
      (SELECT COALESCE(json_agg(json_build_object('valor', t.v, 'etiqueta', t.e, 'n', t.n) ORDER BY t.e), '[]')
         FROM (SELECT left(x.ubigeo, 4) AS v, z.nombre AS e, count(*)::int AS n
                 FROM ${tabla} JOIN zonas z ON z.ubigeo = left(x.ubigeo, 4) ${sinProvincia} GROUP BY 1, 2) t) AS provincias,
      (SELECT COALESCE(json_agg(json_build_object('valor', t.v, 'n', t.n) ORDER BY t.v), '[]')
         FROM (SELECT pe.partido AS v, count(*)::int AS n FROM ${tabla} JOIN poder_entidad pe ON pe.entidad_ruc = x.ruc ${alcance} GROUP BY 1) t) AS partidos,
      (SELECT json_build_object(${senales}) FROM ${tabla} ${alcance}) AS senales`;
  return { sql, vals };
}

async function facetasEntidades(q: ListaEntidadesQ, modelos: boolean, nepotismo: string[] | null, porTipo: RucsPorTipo | null) {
  const clave = JSON.stringify({ modelos, region: q.region, provincia: q.provincia, clase: q.clase, nepotismo: !!nepotismo });
  return facetasMemo.obtener(clave, async () => {
    const { sql, vals } = sqlFacetasEntidades(q, modelos, nepotismo, porTipo);
    return (await consultaConPlazo(sql, vals, 30_000)).rows[0] as Record<string, unknown>;
  });
}

// ─── GET /entidades — lista con contadores agregados (paginada) ─
// Fase 2 (auditoría C9): desde la vista materializada `entidad_stats` (migración 35), una fila por
// entidad con sus conteos ya hechos; antes cada pedido agrupaba TODAS las convocatorias. Mismas
// filas. Orden por defecto: las que más contratos tienen desde 2015, nombre; o las que más dictámenes publicados tienen,
// o por nombre. La provincia sale de `zonas` (con tildes, migración 72) y no del texto del SEACE. Va hasta un
// refresco detrás.
//
// Cada fila trae lo que toda entidad tiene (2026-10-27: con el dictamen como columna, 2,985 de 3,162 filas decían «0 de
// N, Sin dato, Sin dato»): sus contratos, cuántos tienen un ganador con antecedentes y cuántos uno grave
// (`antecedentesPorEntidad`), su presupuesto del MEF del año (`presupuestoDe`), sus informes de la Contraloría y las
// señales que cuentan los filtros (captura, nepotismo, planilla con señal alta, plazas a la medida). La página se corta
// primero (`pag`) y lo demás se busca sólo para sus filas.
entidadesRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const q = parsed.data;
  const { limit, offset } = q;
  const modelos = await hayModelosLectura();
  // Con un filtro por tipo, los RUC de cada tipo ya clasificados (`rucsPorTipo`: el filtro va por la llave).
  const [nepotismo, porTipo] = await Promise.all([entidadesConNepotismo(), q.clase ? rucsPorTipo(modelos) : null]);
  const col = modelos ? "es" : "e";
  const { conds, vals } = filtrosEntidades(q, col, modelos ? "es.nombre_norm" : "immutable_unaccent(lower(e.nombre))", [], nepotismo, porTipo);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const totalVals = [...vals];
  if (nepotismo) vals.push(nepotismo);
  const conNepotismo = enNepotismo(`${col}.ruc`, nepotismo && `$${vals.length}`);
  vals.push(limit, offset);
  const orden = ORDEN_ENTIDADES[q.orden][modelos ? "es" : "e"];
  // `_n`: el lugar de la fila en el orden pedido (los JOIN de afuera no lo conservan).
  const pagina = modelos
    ? `SELECT es.ruc, es.nombre, es.tipo, es.region,
              COALESCE((SELECT z.nombre FROM entidades e2 JOIN zonas z ON z.ubigeo = left(e2.ubigeo::text, 4) WHERE e2.ruc = es.ruc), es.provincia) AS provincia,
              es.distrito,
              es.pliego_nombre_mef AS "pliegoNombreMef",
              es.alertas_activas AS alertas,
              es.monto_alertas_activas::float AS monto,
              COALESCE(es.score_prom_activas, 0)::int AS "scorePromedio",
              NULL::int AS reportes,
              es.contratos,
              es.alertas_activas AS "contratosVigilados",
              NULL::jsonb AS serie,
              ${conNepotismo} AS "conNepotismo",
              row_number() OVER (ORDER BY ${orden}) AS _n
         FROM entidad_stats es
         ${where}
         ORDER BY ${orden}
         LIMIT $${vals.length - 1} OFFSET $${vals.length}`
    : `SELECT
         e.ruc, e.nombre, e.tipo, e.region,
         COALESCE((SELECT z.nombre FROM zonas z WHERE z.ubigeo = left(e.ubigeo::text, 4)), e.provincia) AS provincia, e.distrito,
         e.pliego_nombre_mef AS "pliegoNombreMef",
         COALESCE(a.alertas, 0)      AS alertas,
         COALESCE(a.monto, 0)::float AS monto,
         COALESCE(a.score_avg, 0)::int AS "scorePromedio",
         NULL::int                   AS reportes,   -- antes metadata.reportes_mock (inventado)
         COALESCE(cv.contratos, 0)::int AS contratos,
         COALESCE(a.alertas, 0)::int AS "contratosVigilados",
         NULL::jsonb                 AS serie,      -- antes metadata.serie_mock (inventado)
         ${conNepotismo} AS "conNepotismo",
         row_number() OVER (ORDER BY ${orden}) AS _n
       FROM entidades e
       LEFT JOIN (
         SELECT c.entidad_ruc, COUNT(*)::int AS contratos FROM convocatorias c WHERE ${convocatoriaNoDemo("c")} GROUP BY c.entidad_ruc
       ) cv ON cv.entidad_ruc = e.ruc
       LEFT JOIN (
         SELECT a.entidad_ruc, COUNT(*)::int AS alertas, SUM(a.monto_adjudicado) AS monto, AVG(a.score)::int AS score_avg
         FROM alertas a WHERE ${ALERTAS_ACTIVAS}
         GROUP BY a.entidad_ruc
       ) a ON a.entidad_ruc = e.ruc
       ${where}
       ORDER BY ${orden}
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`;
  const [r, total, facetas, antecedentes] = await Promise.all([
    pool.query(`WITH pag AS MATERIALIZED (${pagina})
      SELECT pag.*, ${COLS_LISTA_ENTIDAD}
        FROM pag
        ${JOINS_LISTA_ENTIDAD}
       ORDER BY pag._n`, vals),
    pool.query(`SELECT count(*)::int AS n FROM ${modelos ? "entidad_stats es" : "entidades e"} ${where}`, totalVals),
    // Sin las facetas, la lista sigue: los filtros van sin números.
    q.facetas ? facetasEntidades(q, modelos, nepotismo, porTipo).catch((e) => { console.warn(`[entidades] facetas: ${(e as Error).message}`); return null; }) : null,
    antecedentesPorEntidad(),
  ]);
  const data = r.rows.map(({ _n, informes, informesPenal, mefAnios, mefCruce, mefKind, captura, capturaPartido, capturaDesde, capturaHasta, planillaAlta, plazasSenales,
                             financioLocadores, financioPlanilla, financioPartido, ...e }) => ({
    ...e,
    // null: no se pudieron contar (la fila dice «Sin dato», no un cero que no es).
    antecedentes: antecedentes ? { con: antecedentes[String(e.ruc).trim()]?.[0] ?? 0, alta: antecedentes[String(e.ruc).trim()]?.[1] ?? 0 } : null,
    presupuesto: presupuestoDe(mefAnios, mefCruce, mefKind),
    informes: { total: informes ?? 0, penal: informesPenal ?? 0 },
    senales: {
      captura: captura ?? 0,
      // El partido que la gobierna y el período con que se cuenta la captura (el filtro de sus contratos usa las mismas fechas).
      capturaPartido: capturaPartido ?? null, capturaDesde: capturaDesde ?? null, capturaHasta: capturaHasta ?? null,
      planillaAlta: planillaAlta ?? 0, plazasSenales: plazasSenales ?? 0,
      financioLocadores: financioLocadores ?? 0, financioPlanilla: financioPlanilla ?? 0, financioPartido: financioPartido ?? null,
    },
  }));
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json({ data, total: total.rows[0].n, limit, offset, ...(q.facetas ? { facetas } : {}) });
});

// ─── GET /entidades/summary ── KPIs globales ────────────────────
// Las cifras de arriba de /app/entidades, de toda la base (no cambian con la búsqueda): cuántas hay (sin las de nombre
// inválido, como la lista), cuántas tienen contratos, cuántas algún ganador con antecedentes (y grave), cuántas informes
// de la Contraloría y cuántas dictamen publicado. Las de antecedentes salen del mismo conteo que las filas
// (`antecedentesPorEntidad`); null si no se pudo.
entidadesRouter.get("/summary", async (c) => {
  const modelos = await hayModelosLectura();
  const valida = NOMBRE_VALIDO("immutable_unaccent(lower(e.nombre))");
  const [r, antecedentes] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM entidades e WHERE ${valida}) AS total_entidades,
         (SELECT COUNT(*)::int FROM entidades e
            WHERE ${valida} AND EXISTS (SELECT 1 FROM alertas a WHERE a.entidad_ruc = e.ruc AND ${ALERTAS_ACTIVAS})
         ) AS con_alertas,
         (SELECT COALESCE(SUM(a.monto_adjudicado), 0)::float FROM alertas a WHERE ${ALERTAS_ACTIVAS}) AS monto,
         ${modelos ? `(SELECT COUNT(*)::int FROM entidad_stats es WHERE es.contratos > 0 AND ${NOMBRE_VALIDO("es.nombre_norm")})` : "NULL::int"} AS con_contratos,
         (SELECT COUNT(*)::int FROM entidades e
            WHERE ${valida} AND EXISTS (SELECT 1 FROM informes_control i WHERE i.entidad_ruc = e.ruc)) AS con_informes`,
    ),
    antecedentesPorEntidad(),
  ]);
  const conteos = antecedentes ? Object.values(antecedentes) : null;
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json({
    ...r.rows[0],
    con_antecedentes: conteos ? conteos.filter(([con]) => con > 0).length : null,
    con_graves: conteos ? conteos.filter(([, alta]) => alta > 0).length : null,
  });
});

// ─── GET /entidades/regiones — las regiones (departamentos) para el filtro de la lista ─
// Antes de /:ruc para que Hono no lo tome por un RUC.
entidadesRouter.get("/regiones", async (c) => {
  const modelos = await hayModelosLectura();
  const r = await pool.query<{ region: string }>(
    `SELECT DISTINCT region FROM ${modelos ? "entidad_stats" : "entidades"} WHERE region IS NOT NULL AND region <> '' ORDER BY region`,
  );
  c.header("Cache-Control", cachePublico(3600, { maxAge: 600, swr: 3600 }));
  return c.json({ regiones: r.rows.map((x) => x.region) });
});

// ─── GET /entidades/:ruc ─────────────────────────────────────────
// ─── GET /entidades/:ruc/cruces — procesos cuyo ganador tiene cruces con otras fuentes (migración 48) ─
entidadesRouter.get("/:ruc/cruces", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(publicar(await crucesDeEntidad(ruc)));
});

// ─── GET /entidades/:ruc/fraccionamiento — órdenes menores de un mismo día que juntas pasan 8 UIT (migración 51) ─
entidadesRouter.get("/:ruc/fraccionamiento", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  // `?limit=` hasta 1000: la ficha las pide todas y las pagina (antes cortaba en 50 y decía "se muestran los 50").
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit")) || 50));
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(publicar(await fraccionamientoDeEntidad(ruc, limit)));
});

// ─── GET /entidades/:ruc/gasto — en qué gasta, según el MEF (migraciones 63 y 64) ─
// Suma las unidades ejecutoras con que cruzó la entidad (`mef_entity_budget.sec_ejecs`) en su último año con desglose. Si la
// entidad cruzó con el pliego regional entero (`keyword` 'pliego …'), son las cifras de todo el gobierno regional:
// `cruce` lo dice y la ficha lo avisa. Ocho miradas, armadas en árbol donde corresponde:
//   genéricas › partidas › específicas · funciones · proyectos · fuentes › rubros · meses · programas › productos
type TipoGasto = "partida" | "funcion" | "proyecto" | "especifica" | "rubro" | "mes" | "programa" | "producto";
interface FilaGasto { tipo: TipoGasto; codigo: string; nombre: string | null; grupo: string | null; pim: number; devengado: number }
interface Dato { codigo: string; nombre: string; pim: number; devengado: number }

const porPim = (a: { pim: number }, b: { pim: number }) => b.pim - a.pim;

/** Junta en `lista` el dato con el mismo nombre (dos códigos que el clasificador llama igual son, en la ficha, uno). */
function sumarPorNombre<T extends Dato>(lista: T[], d: T): T {
  const igual = lista.find((p) => p.nombre.trim() === d.nombre.trim());
  if (!igual) {
    lista.push(d);
    return d;
  }
  igual.pim += d.pim;
  igual.devengado += d.devengado;
  return igual;
}

entidadesRouter.get("/:ruc/gasto", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  // El último año con desglose de sus unidades, que puede no ser el actual (una unidad que dejó de gastar en 2019): se
  // prueba año por año, de este para atrás, por la llave (anio, sec_ejec) de cada tabla; un max(anio) sobre sec_ejec
  // recorrería la tabla entera (~6 M de filas con la historia desde 2015). Las OPD y ETE (migración 152) tienen su propia
  // tabla; en las ETE, `devengado` es la ejecución que reporta la empresa (`origen` lo dice).
  const r = await pool.query<FilaGasto & { anio: number; cruce: string | null; origen: string | null; ultimoAnioMef: number | null }>(
    `WITH e AS (SELECT sec_ejecs, split_part(keyword, ' ', 1) AS cruce, COALESCE(origen, 'siaf') AS origen
                  FROM mef_entity_budget WHERE entidad_ruc = $1),
          -- el último año con desglose que hay de ese archivo del MEF (si el de la entidad es anterior, ya no gasta)
          m AS (SELECT CASE WHEN e.origen = 'siaf' THEN (SELECT max(anio) FROM mef_ejecutora_gasto)
                            ELSE (SELECT max(x.anio) FROM mef_opds_etes_gasto x WHERE x.origen = e.origen) END::int AS ultimo
                  FROM e),
          -- con algo de PIM o devengado: una unidad que se cierra trae un año más con sólo el PIA (Progresa en 2020)
          u AS (SELECT y.anio::smallint AS anio
                  FROM e, generate_series(extract(year FROM now())::int + 1, 2009, -1) AS y(anio)
                 WHERE EXISTS (SELECT 1 FROM mef_ejecutora_gasto x
                                WHERE x.anio = y.anio AND x.sec_ejec = ANY(e.sec_ejecs) AND (x.pim > 0 OR x.devengado > 0))
                    OR EXISTS (SELECT 1 FROM mef_opds_etes_gasto x
                                WHERE x.anio = y.anio AND x.sec_ejec = ANY(e.sec_ejecs) AND (x.pim > 0 OR x.devengado > 0))
                 ORDER BY y.anio DESC LIMIT 1)
     SELECT u.anio, e.cruce, e.origen, m.ultimo AS "ultimoAnioMef", g.tipo, g.codigo, max(g.nombre) AS nombre, max(g.grupo) AS grupo,
            sum(g.pim)::float AS pim, sum(g.devengado)::float AS devengado
       FROM e, m, u, LATERAL (
              SELECT x.tipo, x.codigo, x.nombre, x.grupo, x.pim, x.devengado FROM mef_ejecutora_gasto x
               WHERE x.anio = u.anio AND x.sec_ejec = ANY(e.sec_ejecs)
              UNION ALL
              SELECT x.tipo, x.codigo, x.nombre, x.grupo, x.pim, x.devengado FROM mef_opds_etes_gasto x
               WHERE x.anio = u.anio AND x.sec_ejec = ANY(e.sec_ejecs)) g
      GROUP BY u.anio, e.cruce, e.origen, m.ultimo, g.tipo, g.codigo
     HAVING sum(g.pim) > 0 OR sum(g.devengado) > 0`,
    [ruc],
  );
  c.header("Cache-Control", cachePublico(3600, { maxAge: 300, swr: 3600 }));
  const filas = r.rows;
  const de = (t: TipoGasto) => filas.filter((x) => x.tipo === t);
  // 2999999 es el "proyecto" del MEF para las inversiones sin código propio (su actividad dice sólo "ACCIONES DE
  // INVERSIÓN" u "OBRAS"): sin nombre en el archivo.
  const dato = (f: FilaGasto): Dato => ({
    codigo: f.codigo,
    nombre: f.nombre || (f.tipo === "proyecto" && f.codigo === "2999999" ? "OTRAS INVERSIONES, SIN CÓDIGO DE PROYECTO EN EL MEF" : f.codigo),
    pim: f.pim,
    devengado: f.devengado,
  });

  // Genéricas › partidas › específicas. Dos partidas con el mismo nombre en una genérica ("GASTOS VARIABLES Y
  // OCASIONALES" del personal activo y del CAS) van juntas; sus específicas, también.
  type Partida = Dato & { especificas: Dato[] };
  const genericas = new Map<string, { nombre: string; pim: number; devengado: number; partidas: Partida[] }>();
  const partidaPorCodigo = new Map<string, Partida>();
  for (const f of de("partida")) {
    const g = f.grupo || "OTROS";
    let x = genericas.get(g);
    if (!x) genericas.set(g, (x = { nombre: g, pim: 0, devengado: 0, partidas: [] }));
    x.pim += f.pim;
    x.devengado += f.devengado;
    partidaPorCodigo.set(f.codigo, sumarPorNombre<Partida>(x.partidas, { ...dato(f), especificas: [] }));
  }
  for (const f of de("especifica")) {
    const p = partidaPorCodigo.get(f.grupo ?? "");
    if (p) sumarPorNombre(p.especificas, dato(f));
  }
  for (const g of genericas.values()) {
    g.partidas.sort(porPim);
    for (const p of g.partidas) {
      p.especificas.sort(porPim);
      // Una sola específica que se llama como su partida no agrega nada.
      if (p.especificas.length === 1 && p.especificas[0].nombre.trim() === p.nombre.trim()) p.especificas = [];
    }
  }

  // Fuentes › rubros: de dónde viene la plata.
  const fuentes = new Map<string, { nombre: string; pim: number; devengado: number; rubros: Dato[] }>();
  for (const f of de("rubro")) {
    const k = f.grupo || "OTRAS FUENTES";
    let x = fuentes.get(k);
    if (!x) fuentes.set(k, (x = { nombre: k, pim: 0, devengado: 0, rubros: [] }));
    x.pim += f.pim;
    x.devengado += f.devengado;
    sumarPorNombre(x.rubros, dato(f));
  }
  for (const x of fuentes.values()) {
    x.rubros.sort(porPim);
    // "RECURSOS ORDINARIOS" › "RECURSOS ORDINARIOS": un solo rubro con el nombre de su fuente no agrega nada.
    if (x.rubros.length === 1 && x.rubros[0].nombre.trim() === x.nombre.trim()) x.rubros = [];
  }

  // Programas › productos.
  type Programa = Dato & { productos: Dato[] };
  const programas = new Map<string, Programa>(de("programa").map((f) => [f.codigo, { ...dato(f), productos: [] }]));
  for (const f of de("producto")) {
    const p = programas.get(f.grupo ?? "");
    if (p) sumarPorNombre(p.productos, { ...dato(f), codigo: f.codigo.split(".").pop() ?? f.codigo });
  }
  for (const p of programas.values()) p.productos.sort(porPim);

  const proyectos = de("proyecto").map(dato).sort(porPim);
  return c.json({
    anio: filas[0]?.anio ?? null,
    cruce: filas[0]?.cruce ?? null,
    // 'siaf' | 'opds' | 'etes' (migración 152): con 'etes', cada `devengado` es lo ejecutado que reporta la empresa.
    origen: filas[0]?.origen ?? null,
    // El último año con desglose de ese archivo del MEF: si `anio` es anterior, la unidad ya no gasta.
    ultimoAnioMef: filas[0]?.ultimoAnioMef ?? null,
    genericas: [...genericas.values()].sort(porPim),
    funciones: de("funcion").map(dato).sort(porPim),
    proyectos: {
      total: proyectos.length,
      pim: proyectos.reduce((s, p) => s + p.pim, 0),
      devengado: proyectos.reduce((s, p) => s + p.devengado, 0),
      // Todos: la ficha los pagina.
      lista: proyectos,
    },
    fuentes: [...fuentes.values()].sort(porPim),
    // Los doce meses, con cero los que no tienen devengado (la serie no salta).
    meses: Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1,
      devengado: de("mes").filter((f) => Number(f.codigo) === i + 1).reduce((s, f) => s + f.devengado, 0),
    })),
    programas: [...programas.values()].sort(porPim),
  });
});

// ─── GET /entidades/:ruc/procesos — sus procesos adjudicados desde 2015 (CONOSCE desde 2018, migración 66; OCDS antes, 68) ─
// La base de Vigía (GET /contratos?entidad=) es casi toda de 2026; CONOSCE trae la historia. Un proceso por fila
// (código de convocatoria; ítems repetidos entre años, una vez), con el ganador de mayor monto, como
// GET /partidos/:clave/procesos. `resumen` va siempre sin filtros: las cifras de la ficha y los conteos de los filtros.
const ProcesosEntidadQuery = z.object({
  q: z.string().trim().min(3).max(80).optional(),
  objeto: z.string().max(40).optional(),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  orden: z.enum(["fecha", "monto"]).default("fecha"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});

const PROCESOS_DE_ENTIDAD = `
  WITH a AS (SELECT DISTINCT ON (codigo_convocatoria, n_item) * FROM conosce_adjudicaciones WHERE entidad_ruc = $1
              ORDER BY codigo_convocatoria, n_item, anio DESC),
       c AS (SELECT a.codigo_convocatoria AS codigo, min(a.fecha_convocatoria) AS fecha, max(a.objeto) AS objeto, max(a.tipo_proceso) AS "tipoProceso",
                    max(a.nomenclatura) AS nomenclatura, max(a.descripcion_proceso) AS descripcion, max(a.entidad) AS entidad, count(*)::int AS items,
                    sum(a.monto_referencial)::float AS "montoReferencial", sum(a.monto_adjudicado)::float AS "montoAdjudicado",
                    (sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')))::float AS pen, max(a.moneda) AS moneda,
                    count(DISTINCT a.ruc_proveedor)::int AS proveedores,
                    (array_agg(a.proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS proveedor,
                    (array_agg(a.ruc_proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS "rucProveedor"
               FROM a GROUP BY a.codigo_convocatoria)
  SELECT * FROM c
  UNION ALL
  -- Antes de 2018, de la API OCDS (migración 68): CONOSCE empieza ese año.
  SELECT h.codigo, h.fecha_convocatoria, h.objeto, h.tipo_proceso, h.nomenclatura, h.descripcion, h.entidad, 1,
         h.monto_referencial::float, h.monto_adjudicado::float,
         CASE WHEN h.moneda IS NULL OR h.moneda = 'PEN' THEN h.monto_adjudicado::float END,
         CASE COALESCE(h.moneda, 'PEN') WHEN 'PEN' THEN 'Soles' WHEN 'USD' THEN 'Dólar Norteamericano' WHEN 'EUR' THEN 'Euro' ELSE h.moneda END,
         h.proveedores, h.proveedor, h.ruc_proveedor
    FROM procesos_historicos h
   WHERE h.entidad_ruc = $1 AND h.fecha_convocatoria < DATE '2018-01-01' AND NOT EXISTS (SELECT 1 FROM c WHERE c.codigo = h.codigo)`;

const procesosEntidadMemo = new Memo<Record<string, unknown>>({ nombre: "entidades:procesos", ttlMs: 300_000, staleMs: 300_000, max: 500 });

entidadesRouter.get("/:ruc/procesos", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const crudos = Object.fromEntries(Object.entries(parametros(c)).filter(([, v]) => v !== "" && v != null));
  const parsed = ProcesosEntidadQuery.safeParse(crudos);
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const cuerpo = await procesosEntidadMemo.obtener(`procesos:${ruc}:${JSON.stringify(q)}`, async () => {
    const vals: unknown[] = [ruc];
    const conds: string[] = [];
    if (q.objeto) { vals.push(q.objeto); conds.push(`p.objeto = $${vals.length}`); }
    if (q.anio) { vals.push(q.anio); conds.push(`extract(year FROM p.fecha) = $${vals.length}`); }
    if (q.q) {
      // El nombre de una persona natural (RUC 10) no se busca (como en casos_cruce y partido_proceso).
      vals.push(q.q);
      conds.push(`mef_norm(coalesce(p.descripcion, '') || ' ' || coalesce(p.nomenclatura, '') || ' ' ||
                  CASE WHEN p."rucProveedor" LIKE '10%' THEN '' ELSE coalesce(p.proveedor, '') END) LIKE '%' || mef_norm($${vals.length}) || '%'`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const orden = q.orden === "monto" ? `p.pen DESC NULLS LAST, p.fecha DESC` : `p.fecha DESC, p.pen DESC NULLS LAST`;
    const [filas, resumen] = await Promise.all([
      // La página primero (pag) y después, sólo para esas filas, lo que Vigía sabe de cada una (lib/estadoFila.ts).
      pool.query(
        `WITH p AS (${PROCESOS_DE_ENTIDAD}),
         pag AS (
           SELECT p.*, cv.ocid, count(*) OVER ()::int AS total, (sum(p.pen) OVER ())::float AS monto
             FROM p LEFT JOIN convocatorias cv ON cv.ocid = p.codigo
             ${where}
            ORDER BY ${orden}, p.codigo
            LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size})
         SELECT pag.codigo, pag.nomenclatura, pag.descripcion, pag.objeto, pag."tipoProceso", to_char(pag.fecha, 'YYYY-MM-DD') AS fecha,
                pag.entidad, $1::text AS "entidadRuc", pag.items, pag."montoReferencial", pag."montoAdjudicado", pag.moneda, pag.proveedores,
                pag.proveedor, pag."rucProveedor", pag.ocid, pag.total, pag.monto, ${COLS_ESTADO_FILA}
           FROM pag
           ${joinsEstadoFila("pag.ocid")}
          ORDER BY ${orden.replace(/p\./g, "pag.")}, pag.codigo`, vals),
      pool.query(
        `WITH p AS (${PROCESOS_DE_ENTIDAD})
         SELECT count(*)::int AS procesos, COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen", count(DISTINCT "rucProveedor")::int AS proveedores,
                to_char(min(fecha), 'YYYY-MM-DD') AS desde,
                COALESCE((SELECT json_agg(x ORDER BY x.anio) FROM (SELECT extract(year FROM fecha)::int AS anio, count(*)::int AS procesos,
                                  COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen" FROM p GROUP BY 1) x), '[]') AS "porAnio",
                COALESCE((SELECT json_agg(x ORDER BY x.procesos DESC) FROM (SELECT COALESCE(objeto, 'Sin dato') AS objeto, count(*)::int AS procesos,
                                  COALESCE(sum(pen), 0)::float AS "montoAdjudicadoPen" FROM p GROUP BY 1) x), '[]') AS "porObjeto"
           FROM p`, [ruc]),
    ]);
    const total = filas.rows[0]?.total ?? 0;
    const monto = filas.rows[0]?.monto ?? 0;
    const data = filas.rows.map(({ total: _t, monto: _m, ...x }) => ({ ...x, nivel: null, lugar: null }));
    // El ganador puede ser una persona natural: publicar() la reconoce por su RUC 10 y tapa su nombre.
    return publicar({ total, montoAdjudicadoPen: monto, page: q.page, size: q.size, data, resumen: resumen.rows[0] });
  });
  c.header("Cache-Control", cachePublico(600, { maxAge: 120, swr: 600 }));
  return c.json(cuerpo);
});

// ─── GET /entidades/:ruc/conteos — cuántas filas tiene cada pestaña de la ficha ─
// Lo que la ficha necesita para poner su número a cada pestaña y mandar las vacías al final, sin pedir las listas.

/** Las órdenes que lista GET /ordenes (sqlListaOrdenes, ruta ordenes.ts): en soles, sin anuladas, con monto, desde 2018. */
const ORDEN_LISTADA = `o.moneda = 'Nuevos Soles' AND o.estado IS DISTINCT FROM 'Anulada' AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL)
       AND o.fecha_emision >= DATE '2018-01-01' AND o.fecha_emision <= current_date + 31`;

/**
 * Una consulta, todo por la llave o por un índice de la entidad (7 a 45 ms en frío, EXPLAIN en prod del 2026-10-27): sus
 * contratos menores (seace_menores), las personas contratadas y la planilla (ya contadas en persona_resumen y
 * planilla_resumen: sin fila, el refresco no le encontró nada, como en sus listas), las plazas CAS, los informes de la
 * Contraloría y desde cuándo hay plazas y contratos menores en la base (lo dice la ficha cuando no tiene ninguno).
 *
 * Las órdenes de compra y de servicio no se pueden contar en vivo: CONOSCE repite órdenes entre archivos mensuales (van
 * una vez) y una entidad grande tiene cientos de miles (ONPE, 44 mil: 9 s en frío; contar sólo 3 mil, 2 s). Se cuentan en
 * entidad_orden_anual (migración 148) si ya existe (`conResumen`); siempre se mira si tiene alguna: la más reciente por el
 * índice de entidad y fecha (0,1 a 1,4 ms). Con un EXISTS el planificador recorría la tabla entera cuando la entidad tiene
 * muchas (EsSalud), apostando a encontrar una pronto. El RUC (11 dígitos ya validados) va como literal, como en
 * /ordenes: con un parámetro, Hyperdrive prepara la sentencia y el plan genérico puede dejar el índice de lado; el literal
 * sirve igual para las columnas text y char(11).
 */
export function sqlConteosEntidad(ruc: string, conResumen: boolean, conObras = false): string {
  if (!/^\d{11}$/.test(ruc)) throw new Error("RUC inválido");
  const r = `'${ruc}'`;
  const resumen = (tabla: string) => `COALESCE((SELECT (x.resumen->>'personas')::int FROM ${tabla} x WHERE x.alcance = 'ent:${ruc}'), 0)`;
  return `SELECT
       (SELECT count(*) FROM seace_menores m WHERE m.entidad_ruc = ${r} AND m.monto > 0)::int AS menores,
       (SELECT min(m.anio) FROM seace_menores m)::int AS "menoresDesde",
       ${resumen("persona_resumen")} AS personas,
       ${resumen("planilla_resumen")} AS planilla,
       (SELECT count(*) FROM servir_convocatoria s WHERE s.entidad_ruc = ${r})::int AS plazas,
       (SELECT to_char(min(s.fecha_inicio), 'YYYY-MM-DD') FROM servir_convocatoria s) AS "plazasDesde",
       (SELECT count(*) FROM informes_control i WHERE i.entidad_ruc = ${r})::int AS informes,
       -- Sus visitas, por todos los nombres con que la registra el portal (migración 186): la pestaña Visitas.
       (SELECT count(*) FROM visitas_entidades v WHERE v.entidad_visitada IN (SELECT vr.entidad_visitada FROM visita_entidad_ruc vr WHERE vr.ruc = ${r}))::int AS visitas,
       COALESCE((SELECT true FROM conosce_ordenes o WHERE o.entidad_ruc = ${r} AND ${ORDEN_LISTADA}
                  ORDER BY o.fecha_emision DESC LIMIT 1), false) AS "hayOrdenes"${conResumen
         ? `,
       (SELECT sum(a.ordenes)::int FROM entidad_orden_anual a WHERE a.entidad_ruc = ${r}) AS ordenes,
       (SELECT sum(a.monto)::float FROM entidad_orden_anual a WHERE a.entidad_ruc = ${r}) AS "ordenesMonto"`
         : ""}${conObras
         // Sus obras de INFOBRAS y sus inversiones de Invierte.pe (migración 160), por el índice de la entidad.
         ? `,
       (SELECT count(*) FROM obra_infobras ob WHERE ob.entidad_ruc = ${r} AND NOT ob.retirada)::int AS obras,
       (SELECT count(*) FROM inversion_mef iv WHERE iv.entidad_ruc = ${r} AND NOT iv.retirada)::int AS inversiones`
         : ""}`;
}

/** ¿Ya está entidad_orden_anual (migración 148)? Presente, no se vuelve a preguntar; ausente, cada minuto (lib/esquema.ts). */
let resumenOrdenes: { ok: boolean; at: number } | null = null;
async function hayResumenOrdenes(): Promise<boolean> {
  if (resumenOrdenes && (resumenOrdenes.ok || Date.now() - resumenOrdenes.at < 60_000)) return resumenOrdenes.ok;
  try {
    const r = await pool.query<{ ok: boolean }>(`SELECT to_regclass('public.entidad_orden_anual') IS NOT NULL AS ok`);
    resumenOrdenes = { ok: !!r.rows[0]?.ok, at: Date.now() };
  } catch {
    return false;
  }
  return resumenOrdenes.ok;
}

const conteosMemo = new Memo<Record<string, unknown>>({ nombre: "entidades:conteos", ttlMs: 300_000, staleMs: 3_600_000, max: 500 });

entidadesRouter.get("/:ruc/conteos", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "invalid_ruc" }, 400);
  const cuerpo = await conteosMemo.obtener(ruc, async () => {
    const [conResumen, conObras] = await Promise.all([hayResumenOrdenes(), hayObras()]);
    const f = (await pool.query(sqlConteosEntidad(ruc, conResumen, conObras))).rows[0] as Record<string, unknown> & { hayOrdenes: boolean; ordenes?: number | null };
    const { hayOrdenes, ordenes, ordenesMonto, ...resto } = f;
    // Sin la migración 160, null: no se sabe (la pestaña Obras va sin número, nunca con un 0 que no es).
    if (!conObras) Object.assign(resto, { obras: null, inversiones: null });
    // Sin ninguna orden, 0. Con alguna, su número si el resumen ya la contó; si no (sin la migración, o antes de su primer
    // refresco), null: tiene órdenes, pero no se sabe cuántas (nunca un 0 que no es).
    const contadas = hayOrdenes && typeof ordenes === "number" && ordenes > 0;
    return { ...resto, ordenes: hayOrdenes ? (contadas ? ordenes : null) : 0, ordenesMonto: contadas ? (ordenesMonto ?? null) : null };
  });
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json(cuerpo);
});

/**
 * Cuántos de sus contratos esperan que alguien financie su lectura. La fecha de la cola (cola_auditoria, migración 88) va
 * también afuera de la vista: así se cuenta con los índices de entidad y de fecha juntos (BitmapAnd) y no se leen todas sus
 * convocatorias desde 2015 (GORE Puno: 6,467 filas, 1,1 s en frío; ahora 17 a 45 ms, los mismos números). Era lo más lento
 * de esta ruta, que la ficha espera antes de mostrar nada.
 */
const EN_COLA = `(SELECT count(*) FROM cola_auditoria q WHERE q.entidad_ruc = e.ruc
                    AND (q.fecha_convocatoria IS NULL OR q.fecha_convocatoria >= COALESCE(procesamiento_cola_desde(), '-infinity'::date)))::int`;

entidadesRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const modelos = await hayModelosLectura();
  const [ent, mef, alertas, nep, ban, gente, visitasYOlas] = await Promise.all([
    pool.query(modelos
      // alertas, monto y contratos desde entidad_stats; la cola, en vivo (EN_COLA).
      ? `SELECT e.*,
                COALESCE(es.alertas_activas, 0)::int AS alertas,
                COALESCE(es.monto_alertas_activas, 0)::float AS monto,
                COALESCE(es.contratos, 0)::int AS contratos,
                ${EN_COLA} AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre",
                (SELECT p.id_pte FROM pte_entidad p WHERE p.ruc = e.ruc::text) AS "idPte"
           FROM entidades e
           LEFT JOIN entidad_stats es ON es.ruc = e.ruc
          WHERE e.ruc = $1`
      : `SELECT e.*,
                COALESCE(a.alertas, 0)::int AS alertas,
                COALESCE(a.monto, 0)::float AS monto,
                (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = e.ruc AND ${convocatoriaNoDemo("c")})::int AS contratos,
                ${EN_COLA} AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre",
                (SELECT p.id_pte FROM pte_entidad p WHERE p.ruc = e.ruc::text) AS "idPte"
           FROM entidades e
           LEFT JOIN (
             SELECT a.entidad_ruc, COUNT(*) AS alertas, SUM(a.monto_adjudicado) AS monto
             FROM alertas a WHERE ${ALERTAS_ACTIVAS} GROUP BY a.entidad_ruc
           ) a ON a.entidad_ruc = e.ruc
          WHERE e.ruc = $1`,
      [ruc],
    ),
    // `corte`: la fecha del archivo del MEF del que salió su último año (last_refreshed es cuándo se recalculó); sin
    // presupuesto, la del último archivo del SIAF. Va siempre, con o sin presupuesto (sin él, kind y by_year en null):
    // `fuente` dice de dónde salió su unidad ejecutora ('oece': el CODIGO_SIAF del registro de la OECE; 'heuristica': ubigeo
    // o nombre; 'ninguno': sin presupuesto), `fueraSiaf` que la OECE la registra fuera del SIAF (empresas de FONAFE,
    // EsSalud…: su presupuesto no está en los datos abiertos del MEF) y `secEjecSiaf`, la unidad que la OECE le da
    // (migraciones 150 y 151). Migración 152: `by_year` trae todos los años cargados (desde 2015), `origen` de qué archivo
    // del MEF sale ('siaf'; 'opds', un organismo público descentralizado; 'etes', una empresa municipal, cuyo «devengado»
    // es la ejecución que reporta, sin girado ni comprometido: van en null) y `ultimoAnioMef` el último año que el MEF
    // publica de ese archivo: si el último de la entidad es anterior, su unidad ejecutora ya no tiene presupuesto.
    pool.query(
      `SELECT b.entidad_ruc, b.keyword, b.total_rows, b.by_year, b.matched_pliegos, b.kind, b.last_refreshed, b.sec_ejecs,
              COALESCE(c.corte, (SELECT max(corte) FROM mef_ejecutora_anual
                                  WHERE anio = (SELECT max(anio) FROM mef_ejecutora_anual))) AS corte,
              CASE WHEN b.entidad_ruc IS NULL THEN 'ninguno' ELSE COALESCE(b.fuente, 'heuristica') END AS fuente,
              (b.entidad_ruc IS NULL AND COALESCE(s.fuera_siaf, false)) AS "fueraSiaf", s.sec_ejec AS "secEjecSiaf",
              CASE WHEN b.entidad_ruc IS NOT NULL THEN COALESCE(b.origen, 'siaf') END AS origen,
              CASE WHEN b.entidad_ruc IS NULL THEN NULL
                   WHEN b.origen IN ('opds', 'etes') THEN (SELECT max(anio) FROM mef_opds_etes_anual o WHERE o.origen = b.origen)
                   ELSE (SELECT max(anio) FROM mef_ejecutora_anual) END::int AS "ultimoAnioMef"
         FROM (SELECT $1::char(11) AS ruc) k
         LEFT JOIN mef_entity_budget b ON b.entidad_ruc = k.ruc
         LEFT JOIN entidad_siaf s ON s.ruc = k.ruc
         -- el archivo de su último año (by_year va por año, de menor a mayor), por la llave de cada tabla
         LEFT JOIN LATERAL (
           SELECT max(u.corte) AS corte
             FROM (SELECT a.corte FROM mef_ejecutora_anual a
                    WHERE a.anio = (b.by_year->-1->>'year')::smallint AND a.sec_ejec = ANY(b.sec_ejecs)
                   UNION ALL
                   SELECT o.corte FROM mef_opds_etes_anual o
                    WHERE o.anio = (b.by_year->-1->>'year')::smallint AND o.sec_ejec = ANY(b.sec_ejecs)) u) c ON true`,
      [ruc],
    ),
    // Solo alertas PUBLICADAS y no demo: antes salían también las que están en revisión humana o
    // descartadas, con su score (no publicado).
    pool.query(
      `SELECT a.id, a.codigo, a.codigo_convocatoria, a.score, a.fecha_buena_pro,
              a.monto_adjudicado, a.estado, a.objeto, a.region
         FROM alertas a WHERE a.entidad_ruc = $1 AND ${alertaPublica("a")}
         ORDER BY a.score DESC, a.id LIMIT 20`,
      [ruc],
    ),
    // Nepotismo (indicio, no acusación): parientes declarados en la DJI que son locadores de ESTA entidad.
    // Detalle: el FUNCIONARIO (cargo público, su DJI es pública) + el parentesco + el PROVEEDOR (RUC-10). El nombre
    // del proveedor lo tapa publicar() como a cualquier locador (un apellido). Ver vista dji_nepotismo (migr. 136).
    pool.query<{ declarante: string; cargo: string | null; declaranteFicha: string | null; grado: string; parentesco: string; proveedorRuc: string; proveedorNombre: string; proveedorCodigo: string | null; ordenes: number; monto: number }>(
      `SELECT n.declarante_norm AS declarante, n.cargo, pp.ficha AS "declaranteFicha", n.grado, n.parentesco,
              n.proveedor_ruc AS "proveedorRuc", n.proveedor_nombre AS "proveedorNombre", pc.codigo AS "proveedorCodigo", n.ordenes, n.monto
         FROM dji_nepotismo n
         LEFT JOIN persona_codigo pc ON pc.ruc = n.proveedor_ruc
         LEFT JOIN planilla_persona pp ON pp.entidad_ruc = n.entidad_ruc AND pp.nombre_norm = n.declarante_norm
        WHERE n.entidad_ruc = $1 ORDER BY n.monto DESC NULLS LAST LIMIT 40`,
      [ruc],
    ),
    // Lo que cuentan sus banderas en la lista (captura, planilla con señal alta, plazas a la medida, informes con
    // responsabilidad penal presunta): la ficha las lleva fijas bajo el título, en todas las pestañas. Las mismas
    // columnas que la lista, por la llave de la entidad. Si falla, la ficha sale sin ellas (no sin la ficha).
    pool.query(`SELECT ${COLS_LISTA_ENTIDAD} FROM (SELECT $1::char(11) AS ruc) pag ${JOINS_LISTA_ENTIDAD}`, [ruc])
      .catch((e) => { console.warn(`[entidades] banderas de ${ruc}: ${(e as Error).message}`); return null; }),
    // Las señales de su gente que no están en la lista (migración 179), para sus banderas: locadores con órdenes al borde
    // del tope o con un pariente en otra entidad del mismo gobierno; en su planilla, quienes cobran también en otra
    // entidad y los socios de una empresa que le vende. Por la llave de la entidad; sin ellas, la ficha sale igual.
    // Y las del plan del 2026-10-27 (migraciones 181-184): locadores socios de una empresa que le vende (por DNI), en su
    // planilla el pariente de un funcionario y el ascenso exprés, sus plazas CAS de la gestión saliente y los contratos
    // que ganó una empresa espejo de una inhabilitada.
    pool.query<{ alBorde: number; alBordeEmpresas: number; nepotismoGobierno: number; doblePlanilla: number; socioProveedor: number; socioLocador: number;
                 parientePlanilla: number; ascensoExpres: number; plazasSaliente: number; empresaEspejo: number }>(
      `SELECT (SELECT count(*) FROM persona_entidad pe WHERE pe.entidad_ruc = $1 AND 'al_borde_del_tope' = ANY(pe.tipos))::int AS "alBorde",
              -- Las empresas con la mitad o más de sus órdenes al borde del tope (migración 207).
              (SELECT count(*) FROM empresa_borde_tope eb WHERE eb.entidad_ruc = $1)::int AS "alBordeEmpresas",
              (SELECT count(*) FROM persona_entidad pe WHERE pe.entidad_ruc = $1 AND 'nepotismo_gobierno' = ANY(pe.tipos))::int AS "nepotismoGobierno",
              (SELECT count(*) FROM planilla_persona p WHERE p.entidad_ruc = $1 AND 'doble_planilla' = ANY(p.tipos))::int AS "doblePlanilla",
              (SELECT count(*) FROM planilla_persona p WHERE p.entidad_ruc = $1 AND 'socio_proveedor' = ANY(p.tipos))::int AS "socioProveedor",
              (SELECT count(*) FROM persona_entidad pe WHERE pe.entidad_ruc = $1 AND 'socio_proveedor' = ANY(pe.tipos))::int AS "socioLocador",
              (SELECT count(*) FROM planilla_persona p WHERE p.entidad_ruc = $1 AND 'pariente_planilla' = ANY(p.tipos))::int AS "parientePlanilla",
              (SELECT count(*) FROM planilla_persona p WHERE p.entidad_ruc = $1 AND 'ascenso_expres' = ANY(p.tipos))::int AS "ascensoExpres",
              (SELECT count(*) FROM servir_convocatoria s WHERE s.entidad_ruc = $1 AND 'gestion_saliente' = ANY(s.tipos))::int AS "plazasSaliente",
              (SELECT count(*) FROM cruces_proveedor c JOIN convocatorias cv ON cv.ocid = c.ocid
                WHERE c.tipo = 'empresa_espejo' AND cv.entidad_ruc = $1)::int AS "empresaEspejo"`,
      [ruc],
    ).catch((e) => { console.warn(`[entidades] señales de su gente en ${ruc}: ${(e as Error).message}`); return null; }),
    // La migración 188: visitas de familiares declarados de sus funcionarios y la ola de órdenes a personas tras un cambio
    // de gestión. Aparte: sin la migración, la consulta falla y las demás banderas siguen.
    pool.query<{ visitaPariente: number; olaGestion: number; olaSev: string | null; olaQuien: string | null; olaAntes: number | null; olaDespues: number | null }>(
      `SELECT (SELECT count(*) FROM entidad_visita_pariente p WHERE p.entidad_ruc = $1)::int AS "visitaPariente",
              (SELECT count(*) FROM entidad_ola_gestion o WHERE o.entidad_ruc = $1)::int AS "olaGestion",
              o.severidad AS "olaSev", o.quien AS "olaQuien", o.antes AS "olaAntes", o.despues AS "olaDespues"
         FROM (SELECT 1) x
         LEFT JOIN LATERAL (SELECT * FROM entidad_ola_gestion o WHERE o.entidad_ruc = $1 ORDER BY o.desde DESC LIMIT 1) o ON true`,
      [ruc],
    ).catch(() => null),
  ]);
  if (ent.rows.length === 0) return c.json({ error: "not_found" }, 404);
  // metadata sin las claves `*_mock` de seed_db.py (cifras inventadas).
  const entidad = ent.rows[0];
  // Un nombre que no es un nombre («nan» de una carga vieja) no se muestra: la ficha dice «Entidad con RUC …».
  if (!nombreValido(entidad.nombre)) entidad.nombre = null;
  if (entidad.metadata && typeof entidad.metadata === "object") {
    const limpia: Record<string, unknown> = { ...entidad.metadata };
    for (const k of ENTIDAD_METADATA_MOCK) delete limpia[k];
    entidad.metadata = limpia;
  }
  const porGradoMap = new Map<string, { grado: string; n: number; monto: number }>();
  for (const r of nep.rows) {
    const g = porGradoMap.get(r.grado) ?? { grado: r.grado, n: 0, monto: 0 };
    g.n += 1;
    g.monto += r.monto || 0;
    porGradoMap.set(r.grado, g);
  }
  const nepotismo = nep.rows.length
    ? {
        total: nep.rows.length,
        monto: nep.rows.reduce((a, r) => a + (r.monto || 0), 0),
        porGrado: [...porGradoMap.values()].sort((a, b) => b.monto - a.monto),
        // El proveedor (RUC-10) va tapado por publicar() como cualquier locador. Del funcionario, su cargo y, sólo si no
        // puede destapar el apellido tapado del pariente, su primer apellido (apellidoFuncionario); nunca el nombre
        // completo. Su ficha de planilla, tampoco cuando el parentesco no es seguro (ahí se ve su primer apellido).
        detalle: publicar(
          nep.rows.map(({ declarante, declaranteFicha, ...r }) => {
            const funcionarioApellido = apellidoFuncionario(r.parentesco, declarante);
            return { ...r, funcionarioApellido, declaranteFicha: funcionarioApellido ? declaranteFicha : null };
          }),
        ),
      }
    : null;
  const b = ban?.rows[0];
  const g = gente?.rows[0];
  c.header("Cache-Control", cachePublico(300, { maxAge: 60, swr: 3600 }));
  return c.json({
    entidad,
    mef: mef.rows[0] ?? null,
    alertas: alertas.rows,
    nepotismo,
    // La misma forma que en la lista (GET /entidades); null si no se pudieron leer.
    informes: b ? { total: b.informes ?? 0, penal: b.informesPenal ?? 0 } : null,
    senales: b
      ? {
          captura: b.captura ?? 0, capturaPartido: b.capturaPartido ?? null, capturaDesde: b.capturaDesde ?? null, capturaHasta: b.capturaHasta ?? null,
          planillaAlta: b.planillaAlta ?? 0, plazasSenales: b.plazasSenales ?? 0,
          financioLocadores: b.financioLocadores ?? 0, financioPlanilla: b.financioPlanilla ?? 0, financioPartido: b.financioPartido ?? null,
          ...(g ? {
            alBorde: g.alBorde, alBordeEmpresas: g.alBordeEmpresas, nepotismoGobierno: g.nepotismoGobierno, doblePlanilla: g.doblePlanilla, socioProveedor: g.socioProveedor,
            socioLocador: g.socioLocador, parientePlanilla: g.parientePlanilla, ascensoExpres: g.ascensoExpres, plazasSaliente: g.plazasSaliente,
            empresaEspejo: g.empresaEspejo,
          } : {}),
          ...(visitasYOlas?.rows[0] ? {
            visitaPariente: visitasYOlas.rows[0].visitaPariente,
            olaGestion: visitasYOlas.rows[0].olaGestion,
            // La más reciente, para decirla en la bandera.
            ola: visitasYOlas.rows[0].olaGestion > 0
              ? { severidad: visitasYOlas.rows[0].olaSev, quien: visitasYOlas.rows[0].olaQuien, antes: visitasYOlas.rows[0].olaAntes, despues: visitasYOlas.rows[0].olaDespues }
              : null,
          } : {}),
        }
      : null,
  });
});
