// Las herramientas de los productos de Gobserva (2026-11-01): Gobserva Empleo (plazas CAS) y Gobserva Licitaciones
// (convocatorias del SEACE e inteligencia de mercado). Sólo lectura y datos públicos: una plaza no tiene datos de personas,
// de las convocatorias no sale ningún ganador persona natural (mercado_rubro devuelve agregados y sólo empresas RUC 20,
// migración 227) y cada resultado lleva el enlace a la fuente oficial y a su ficha en Gobserva.
//
// Las palabras se buscan sin tildes ni mayúsculas con una expresión por palabra (`v[ií][aá]s`): de lo escrito sólo quedan
// letras y cifras, así que nada de lo que mande el cliente llega a la expresión sin limpiar.
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "pg";
import { conConexion, type Env } from "./db";
import type { Campo } from "./python";

type Definicion = { tool: Tool; campos: Campo[] };

const EMPLEO = "https://empleo.gobserva.cloud";
const LICITACIONES = "https://licitaciones.gobserva.cloud";
const NOTA_EMPLEO =
  "Datos públicos de SERVIR (ofertas laborales del Estado). Gobserva no intermedia postulaciones: se postula en la " +
  "publicación oficial de cada plaza.";
const NOTA_LICITACIONES =
  "Datos públicos del OECE (SEACE, OCDS y CONOSCE). El cronograma completo y las bases están en la ficha oficial del " +
  "SEACE: Gobserva no reemplaza al SEACE ni intermedia contrataciones.";

/** Las palabras de una búsqueda como expresiones sin tildes: «vías» → `v[ií][aá]s`. Hasta 6, de 3 letras o más. */
export function patrones(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length >= 3)
    .slice(0, 6)
    .map((w) =>
      w.replace(/a/g, "[aá]").replace(/e/g, "[eé]").replace(/i/g, "[ií]").replace(/o/g, "[oó]").replace(/u/g, "[uúü]").replace(/n/g, "[nñ]"),
    );
}

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();

/** El ubigeo de 2 dígitos de un departamento por su nombre («cusco», «Junín», «madre de dios»). */
const DEPARTAMENTOS: Record<string, string> = {
  amazonas: "01", ancash: "02", apurimac: "03", arequipa: "04", ayacucho: "05", cajamarca: "06", callao: "07", cusco: "08",
  cuzco: "08", huancavelica: "09", huanuco: "10", ica: "11", junin: "12", "la libertad": "13", lambayeque: "14", lima: "15",
  loreto: "16", "madre de dios": "17", moquegua: "18", pasco: "19", piura: "20", puno: "21", "san martin": "22", tacna: "23",
  tumbes: "24", ucayali: "25",
};

/** El nombre de cada departamento para mostrar, por su ubigeo. */
const NOMBRE_DEPARTAMENTO: Record<string, string> = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho", "06": "Cajamarca", "07": "Callao",
  "08": "Cusco", "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque",
  "15": "Lima", "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura", "21": "Puno",
  "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};

const SENAL_PLAZA: Record<string, string> = {
  pide_experiencia_propia: "Pide experiencia en la misma entidad que convoca: sólo la tiene quien ya trabaja ahí.",
  pide_poco: "Paga S/ 6,000 o más y pide muy poco (menos de un año de experiencia o ningún grado).",
  plazo_corto: "Estuvo publicada 3 días o menos: casi nadie de afuera alcanza a postular.",
  ya_hay_locadores: "La entidad ya pagaba ese trabajo por órdenes de servicio: la plaza puede ser para quien ya lo hacía.",
  gestion_saliente: "La convocó la gestión regional o municipal que se va, después de las elecciones.",
};

const num = (v: unknown) => (v == null ? null : Number(v));
const diasHasta = (fecha: string | null) => {
  if (!fecha) return null;
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${fecha}T00:00:00`).getTime() - hoy.getTime()) / 86_400_000);
};

async function filas(c: Client, sql: string, params: unknown[]): Promise<unknown[][]> {
  const r = await c.query({ text: sql, values: params, rowMode: "array" });
  return r.rows as unknown[][];
}

// ─── Definiciones ────────────────────────────────────────────────────────────────────────────────────────────────────

const esquema = (nombre: string, props: Record<string, object>, requeridos: string[] = []) => ({
  properties: props,
  ...(requeridos.length ? { required: requeridos } : {}),
  title: `${nombre}Arguments`,
  type: "object" as const,
});

export const DEFINICIONES_GOBSERVA: Record<string, Definicion> = {
  buscar_plazas_cas: {
    campos: [
      { nombre: "texto", tipo: "str", defecto: "" },
      { nombre: "region", tipo: "str", defecto: "" },
      { nombre: "sueldo_min", tipo: "int", defecto: 0 },
      { nombre: "sin_experiencia", tipo: "int", defecto: 0 },
      { nombre: "limite", tipo: "int", defecto: 20 },
    ],
    tool: {
      name: "buscar_plazas_cas",
      description:
        "Busca plazas CAS (empleos públicos) ABIERTAS hoy en el Estado peruano, de Gobserva Empleo. Devuelve puesto, " +
        "entidad, lugar, sueldo, vacantes, cuándo cierra, requisitos y el enlace a la publicación oficial. " +
        "Args: texto: palabras del puesto o la carrera (ej. 'abogado', 'enfermera Cusco'); region: departamento " +
        "(ej. 'Lima', 'Arequipa'; vacío = todo el país); sueldo_min: sueldo mínimo en soles (0 = cualquiera); " +
        "sin_experiencia: 1 para sólo plazas que no piden experiencia general; limite: 1 a 50. Ordena por cierre más próximo.",
      inputSchema: esquema("buscar_plazas_cas", {
        texto: { default: "", title: "Texto", type: "string" },
        region: { default: "", title: "Region", type: "string" },
        sueldo_min: { default: 0, title: "Sueldo Min", type: "integer" },
        sin_experiencia: { default: 0, title: "Sin Experiencia", type: "integer" },
        limite: { default: 20, title: "Limite", type: "integer" },
      }),
    },
  },
  ficha_plaza_cas: {
    campos: [{ nombre: "aviso", tipo: "int" }],
    tool: {
      name: "ficha_plaza_cas",
      description:
        "La ficha completa de una plaza CAS por su número de aviso (el que devuelve buscar_plazas_cas): requisitos " +
        "(formación, experiencia, especialización, conocimientos, competencias), sueldo frente a lo que pagan otras " +
        "entidades por el mismo puesto, señales de transparencia y enlaces oficiales. Args: aviso: número del aviso.",
      inputSchema: esquema("ficha_plaza_cas", { aviso: { title: "Aviso", type: "integer" } }, ["aviso"]),
    },
  },
  buscar_licitaciones: {
    campos: [
      { nombre: "texto", tipo: "str", defecto: "" },
      { nombre: "region", tipo: "str", defecto: "" },
      { nombre: "tipo", tipo: "str", defecto: "" },
      { nombre: "dias", tipo: "int", defecto: 15 },
      { nombre: "limite", tipo: "int", defecto: 20 },
    ],
    tool: {
      name: "buscar_licitaciones",
      description:
        "Busca convocatorias del SEACE (licitaciones, concursos, adjudicaciones, comparaciones de precios) publicadas en " +
        "los últimos días, de Gobserva Licitaciones. Devuelve objeto, entidad, región, procedimiento, valor referencial, " +
        "fecha de convocatoria, fin de consultas y enlaces (SEACE y Gobserva). Args: texto: palabras del rubro (ej. " +
        "'combustible', 'útiles de escritorio'); region: departamento (vacío = todo el país); tipo: 'bienes', " +
        "'servicios', 'obras' o 'consultoria' (vacío = todos); dias: convocadas en los últimos N días (1 a 60); " +
        "limite: 1 a 50. El plazo de ofertas está en el cronograma de la ficha oficial del SEACE.",
      inputSchema: esquema("buscar_licitaciones", {
        texto: { default: "", title: "Texto", type: "string" },
        region: { default: "", title: "Region", type: "string" },
        tipo: { default: "", title: "Tipo", type: "string" },
        dias: { default: 15, title: "Dias", type: "integer" },
        limite: { default: 20, title: "Limite", type: "integer" },
      }),
    },
  },
  mercado_rubro: {
    campos: [
      { nombre: "rubro", tipo: "str" },
      { nombre: "meses", tipo: "int", defecto: 12 },
    ],
    tool: {
      name: "mercado_rubro",
      description:
        "Inteligencia de mercado de un rubro en las compras del Estado peruano (Gobserva Licitaciones): cuánto se " +
        "adjudicó en los últimos meses, mes a mes, qué entidades compran más, qué empresas ganan más (sólo empresas), " +
        "cuánto se adjudica frente al valor referencial y en qué regiones. Args: rubro: palabras (ej. 'combustible', " +
        "'mantenimiento de vías'); meses: 1 a 36.",
      inputSchema: esquema(
        "mercado_rubro",
        { rubro: { title: "Rubro", type: "string" }, meses: { default: 12, title: "Meses", type: "integer" } },
        ["rubro"],
      ),
    },
  },
};

// ─── Ejecución ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function ejecutarGobserva(nombre: string, v: Record<string, unknown>, env: Env, ctx: ExecutionContext): Promise<unknown> {
  const entero = (x: unknown, min: number, max: number, def: number) => {
    const n = Number(x ?? def);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
  };
  if (nombre === "buscar_plazas_cas") {
    const texto = String(v.texto ?? "");
    const region = sinTildes(String(v.region ?? ""));
    const limite = entero(v.limite, 1, 50, 20);
    return conConexion(env, ctx, async (c) => {
      const rs = await filas(
        c,
        `SELECT s.aviso, s.titulo, s.entidad, s.ubicacion, s.vacantes, s.remuneracion::float, to_char(s.fecha_fin, 'YYYY-MM-DD'),
                s.exp_general::float, left(s.formacion, 300), left(s.experiencia, 300), s.detalle_url, s.tipos
           FROM servir_convocatoria s
          WHERE s.fecha_fin >= (now() AT TIME ZONE 'America/Lima')::date
            AND (s.fecha_inicio IS NULL OR s.fecha_inicio <= (now() AT TIME ZONE 'America/Lima')::date)
            AND concat_ws(' ', s.titulo, s.entidad, s.servicio, s.formacion, s.ubicacion) ~* ALL ($1::text[])
            AND ($2 = '' OR split_part(s.ubicacion, ' - ', 1) ~* $3)
            AND COALESCE(s.remuneracion, 0) >= $4
            AND ($5 = 0 OR COALESCE(s.exp_general, 0) = 0)
          ORDER BY s.fecha_fin, s.remuneracion DESC NULLS LAST, s.aviso DESC
          LIMIT $6`,
        // La región se busca en la primera parte del lugar («LA LIBERTAD - TRUJILLO»): «la libertad» → `l[ií]b[eé]rt[aá]d`.
        [patrones(texto), region, patrones(region).join(".*"), entero(v.sueldo_min, 0, 1_000_000, 0), entero(v.sin_experiencia, 0, 1, 0), limite],
      );
      return {
        plazas: rs.map((r) => ({
          aviso: Number(r[0]),
          puesto: r[1],
          entidad: r[2],
          lugar: r[3],
          vacantes: num(r[4]),
          sueldo_soles: num(r[5]),
          cierra: r[6],
          dias_para_cerrar: diasHasta(r[6] as string | null),
          experiencia_general_anios: num(r[7]),
          formacion: r[8],
          experiencia: r[9],
          senales: ((r[11] as string[] | null) ?? []).map((t) => SENAL_PLAZA[t] ?? t),
          publicacion_oficial: r[10],
          en_gobserva: `${EMPLEO}/plaza/${r[0]}`,
        })),
        n: rs.length,
        nota: NOTA_EMPLEO,
      };
    });
  }
  if (nombre === "ficha_plaza_cas") {
    const aviso = entero(v.aviso, 0, 999_999_999, 0);
    return conConexion(env, ctx, async (c) => {
      const [r] = await filas(
        c,
        `SELECT s.aviso, s.titulo, s.entidad, s.ubicacion, s.numero, s.vacantes, s.remuneracion::float, to_char(s.fecha_inicio, 'YYYY-MM-DD'),
                to_char(s.fecha_fin, 'YYYY-MM-DD'), s.experiencia, s.formacion, s.especializacion, s.conocimiento, s.competencias,
                s.detalle_url, s.exp_general::float, s.tipos, mef_norm(s.titulo), s.entidad_ruc
           FROM servir_convocatoria s WHERE s.aviso = $1`,
        [aviso],
      );
      if (!r) return { encontrada: false, aviso };
      const [o] = await filas(
        c,
        `SELECT count(*)::int, count(DISTINCT entidad_ruc)::int,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY remuneracion)::float,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion)::float,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY remuneracion)::float
           FROM servir_convocatoria WHERE mef_norm(titulo) = $1 AND remuneracion > 0 AND entidad_ruc IS DISTINCT FROM $2`,
        [r[17], r[18]],
      );
      const comparable = o && Number(o[0]) >= 3;
      return {
        encontrada: true,
        aviso: Number(r[0]),
        puesto: r[1],
        entidad: r[2],
        lugar: r[3],
        convocatoria: r[4],
        vacantes: num(r[5]),
        sueldo_soles: num(r[6]),
        publicada: r[7],
        cierra: r[8],
        dias_para_cerrar: diasHasta(r[8] as string | null),
        requisitos: { formacion: r[10], experiencia: r[9], experiencia_general_anios: num(r[15]), especializacion: r[11], conocimientos: r[12], competencias: r[13] },
        sueldo_en_otras_entidades: comparable
          ? { plazas: Number(o[0]), entidades: Number(o[1]), p25: num(o[2]), mediana: num(o[3]), p75: num(o[4]) }
          : null,
        senales: ((r[16] as string[] | null) ?? []).map((t) => SENAL_PLAZA[t] ?? t),
        publicacion_oficial: r[14],
        en_gobserva: `${EMPLEO}/plaza/${r[0]}`,
        nota: NOTA_EMPLEO,
      };
    });
  }
  if (nombre === "buscar_licitaciones") {
    const texto = String(v.texto ?? "");
    const region = DEPARTAMENTOS[sinTildes(String(v.region ?? ""))] ?? "";
    const tipo = sinTildes(String(v.tipo ?? "")).replace("consultorias", "consultoria");
    const dias = entero(v.dias, 1, 60, 15);
    const limite = entero(v.limite, 1, 50, 20);
    return conConexion(env, ctx, async (c) => {
      const rs = await filas(
        c,
        `SELECT c.ocid, c.codigo, left(c.objeto, 400), e.nombre, left(c.ubigeo_zona, 2), c.tipo_contratacion,
                c.ocds_payload->'tender'->>'procurementMethodDetails', NULLIF(c.cuantia_referencial, 0)::float,
                to_char(c.fecha_convocatoria, 'YYYY-MM-DD'), left(c.ocds_payload->'tender'->'enquiryPeriod'->>'endDate', 10),
                jsonb_array_length(COALESCE(c.ocds_payload->'tender'->'items', '[]'::jsonb))
           FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
          WHERE c.etapa = 'convocada' AND c.fecha_convocatoria >= (now() AT TIME ZONE 'America/Lima')::date - $1::int
            AND concat_ws(' ', c.objeto, e.nombre) ~* ALL ($2::text[])
            AND ($3 = '' OR left(c.ubigeo_zona, 2) = $3)
            AND ($4 = '' OR c.tipo_contratacion = $4)
          ORDER BY c.fecha_convocatoria DESC, c.cuantia_referencial DESC NULLS LAST
          LIMIT $5`,
        [dias, patrones(texto), region, ["bienes", "servicios", "obras", "consultoria"].includes(tipo) ? tipo : "", limite],
      );
      return {
        convocatorias: rs.map((r) => ({
          ocid: r[0],
          codigo: r[1],
          objeto: r[2],
          entidad: r[3],
          region: r[4] ? NOMBRE_DEPARTAMENTO[r[4] as string] ?? r[4] : null,
          tipo: r[5],
          procedimiento: r[6],
          valor_referencial_soles: num(r[7]),
          convocada: r[8],
          consultas_hasta: r[9],
          items: num(r[10]),
          ficha_oficial: `https://contratacionesabiertas.oece.gob.pe/proceso/${encodeURIComponent(String(r[0]).startsWith("ocds-") ? String(r[0]) : `ocds-dgv273-seacev3-${r[0]}`)}`,
          en_gobserva: `${LICITACIONES}/oportunidad/${encodeURIComponent(String(r[0]))}`,
        })),
        n: rs.length,
        nota: NOTA_LICITACIONES,
      };
    });
  }
  // mercado_rubro
  const rubro = String(v.rubro ?? "");
  const meses = entero(v.meses, 1, 36, 12);
  return conConexion(env, ctx, async (c) => {
    const [r] = await filas(c, `SELECT gobserva_mercado_rubro($1, $2)`, [rubro, meses]);
    const datos = (r?.[0] ?? {}) as Record<string, unknown>;
    return { ...datos, en_gobserva: `${LICITACIONES}/mercado?q=${encodeURIComponent(rubro)}`, nota: NOTA_LICITACIONES };
  });
}
