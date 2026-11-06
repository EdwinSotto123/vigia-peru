import { Hono } from "hono";
import { consultaConPlazo, esErrorPg, pool } from "../lib/db.js";
import { Memo } from "../lib/cache.js";
import { cachePublico, parametros } from "../lib/http.js";
import { ETIQUETA_CRUCE } from "../lib/cruces.js";
import { CONOSCE_BUSCADOR } from "../lib/fuentes.js";
import { publicar } from "../lib/privacidad.js";

/**
 * Cifras a pedido para el MCP de Gobserva (consultar_datos, backend/mcp-worker v2): una medida de una fuente por hasta dos
 * dimensiones, con filtros. Todo sale de listas cerradas: la SQL se arma SÓLO con los fragmentos fijos de `FUENTES` (cada
 * clave elige el suyo) y lo que escribe quien pregunta va siempre como parámetro ($n); lo que no está en la lista es un 400
 * con las opciones que sí valen. Cada consulta tiene 5 s (`SET LOCAL statement_timeout`, en su propia transacción de sólo
 * lectura, como consultaConPlazo) y se guarda 10 min.
 *
 *   GET /datos/esquema    el catálogo: por fuente, sus medidas, dimensiones y filtros, la fuente oficial y hasta cuándo llega
 *   GET /datos/consulta   ?fuente=&medida=&por=dim1[,dim2]&<filtros>&orden=desc|asc&limite=1..100
 *                         → { fuente, medida, por, filtros, filas: [{ <dim>, <dim>_nombre?, valor }], filas_total, nota,
 *                             fuente_oficial }
 *
 * Privacidad: el proveedor sólo sale si es una empresa (RUC 20). Todo lo demás (personas naturales con RUC 10, 15 o 17,
 * consorcios, no domiciliados) va sumado en una fila con `proveedor: null` y «Personas naturales y otros»; un RUC 10 como
 * filtro es un 400. mcp_adjudicacion (migración 254) ni siquiera guarda el RUC de una persona. Igual todo sale por publicar().
 *
 * Fuentes: adjudicaciones (mcp_adjudicacion, 254), ordenes (empresa_orden_anual + mcp_orden_otros, 109/148/254),
 * presupuesto (mef_ejecutora_anual, 47/151), senales (cruces_proveedor; NUNCA sus columnas persona_*) y menores
 * (seace_menores, 251).
 */
export const datosRouter = new Hono();

const CACHE = cachePublico(600, { maxAge: 120, swr: 3600 });
const memo = new Memo<Record<string, unknown>>({ nombre: "datos:consulta", ttlMs: 600_000, staleMs: 1_800_000, max: 500 });
const memoEsquema = new Memo<Record<string, unknown>>({ nombre: "datos:esquema", ttlMs: 600_000, staleMs: 3_600_000, max: 2 });
const memoListas = new Memo<Listas>({ nombre: "datos:listas", ttlMs: 3_600_000, staleMs: 6 * 3_600_000, max: 1 });

/** Lo que tarda como mucho cada consulta. */
export const PLAZO_MS = 5_000;
export const MAX_DIMENSIONES = 2;
export const LIMITE_MAX = 100;
export const LIMITE_DEFECTO = 25;
export const OTROS = "Personas naturales y otros";

// ─── Regiones ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ubigeo, cómo lo escriben las tablas (mayúsculas sin tildes; Callao sin «Provincia Constitucional del») y cómo se muestra. */
export const DEPARTAMENTOS: [codigo: string, mayus: string, nombre: string][] = [
  ["01", "AMAZONAS", "Amazonas"], ["02", "ANCASH", "Áncash"], ["03", "APURIMAC", "Apurímac"], ["04", "AREQUIPA", "Arequipa"],
  ["05", "AYACUCHO", "Ayacucho"], ["06", "CAJAMARCA", "Cajamarca"], ["07", "CALLAO", "Callao"], ["08", "CUSCO", "Cusco"],
  ["09", "HUANCAVELICA", "Huancavelica"], ["10", "HUANUCO", "Huánuco"], ["11", "ICA", "Ica"], ["12", "JUNIN", "Junín"],
  ["13", "LA LIBERTAD", "La Libertad"], ["14", "LAMBAYEQUE", "Lambayeque"], ["15", "LIMA", "Lima"], ["16", "LORETO", "Loreto"],
  ["17", "MADRE DE DIOS", "Madre de Dios"], ["18", "MOQUEGUA", "Moquegua"], ["19", "PASCO", "Pasco"], ["20", "PIURA", "Piura"],
  ["21", "PUNO", "Puno"], ["22", "SAN MARTIN", "San Martín"], ["23", "TACNA", "Tacna"], ["24", "TUMBES", "Tumbes"],
  ["25", "UCAYALI", "Ucayali"],
];
const NOMBRE_REGION = new Map(DEPARTAMENTOS.map(([, m, n]) => [m, n]));

/** Minúsculas, sin tildes ni signos, espacios simples. */
export const normal = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** «Cusco», «cuzco», «Junín», «región Junín», «08», «Prov. Constitucional del Callao» → su departamento; null si no es uno. */
export function regionDe(texto: string): { codigo: string; mayus: string; nombre: string } | null {
  const t = normal(texto)
    .replace(/^(region|departamento|gobierno regional|prov(incia)? constituc(ional)?)( de| del)?\s+/, "")
    .replace(/^cuzco$/, "cusco")
    .replace(/^lima (metropolitana|provincias|region)$/, "lima");
  const d = DEPARTAMENTOS.find(([cod, mayus]) => cod === t || mayus.toLowerCase() === t);
  return d ? { codigo: d[0], mayus: d[1], nombre: d[2] } : null;
}

// ─── Listas cerradas ─────────────────────────────────────────────────────────────────────────────────────────────────

const NIVELES: Record<string, string> = {
  nacional: "Gobierno nacional",
  regional: "Gobiernos regionales",
  local: "Gobiernos locales",
  empresas: "Empresas del Estado (FONAFE y Petroperú)",
};
/** El nivel de gobierno del MEF (E, R, M). */
const NIVEL_MEF: Record<string, string> = { nacional: "E", regional: "R", local: "M" };

export const OBJETOS_ADJ = ["Bien", "Servicio", "Obra", "Consultoría de Obra"];
export const TIPOS_PROCESO = [
  "Adjudicación Simplificada", "Subasta Inversa Electrónica", "Contratación Directa", "Licitación Pública",
  "Licitación Pública Abreviada", "Concurso Público", "Concurso Público Abreviado", "Comparación de Precios", "Régimen Especial",
  "Convenio", "Contratación Internacional", "Procedimiento Especial de Contratación", "Otros",
];
/** Los objetos de los contratos menores como los escribe el SEACE y como se muestran. */
const OBJETOS_MENOR: Record<string, string> = { BIEN: "Bien", SERVICIO: "Servicio", CONSULTORIA: "Consultoría", OBRA: "Obra" };
const SEVERIDADES = ["alta", "media", "baja"];

/** Las listas que salen de la base (cambian cuando cambia la fuente): los sectores del MEF y los tipos de señal. */
export interface Listas { sectores: string[]; tiposSenal: string[] }

const SECTOR_SQL = `COALESCE(NULLIF(btrim(m.sector_nombre), ''), 'GOBIERNOS LOCALES')`;

const cargarListas = () =>
  memoListas.obtener("listas", async () => {
    const [s, t] = await Promise.all([
      pool.query<{ v: string }>(`SELECT DISTINCT ${SECTOR_SQL} AS v FROM mef_ejecutora_anual m ORDER BY 1`),
      pool.query<{ v: string }>(`SELECT DISTINCT tipo AS v FROM cruces_proveedor WHERE tipo IS NOT NULL ORDER BY 1`),
    ]);
    return { sectores: s.rows.map((r) => r.v), tiposSenal: t.rows.map((r) => r.v) };
  });

// ─── Errores de la consulta ──────────────────────────────────────────────────────────────────────────────────────────

/** Un pedido que no vale: `detail` dice qué cambiar (y cabe en los 400 caracteres que el MCP muestra). */
export class ErrorConsulta extends Error {
  constructor(readonly detail: string, readonly opciones?: string[]) {
    super(detail);
  }
}

const lista = (xs: string[]) => xs.join(", ");
/** «Usa: a, b, c.» con las opciones que entren en ~280 caracteres (el MCP muestra `detail` sólo si tiene menos de 400). */
export function usa(xs: string[]): string {
  const todas = `Usa: ${lista(xs)}.`;
  if (todas.length <= 280) return todas;
  let n = xs.length;
  while (n > 1 && lista(xs.slice(0, n)).length > 220) n--;
  return `Usa: ${lista(xs.slice(0, n))}… (${xs.length} en total: en «opciones» y en GET /datos/esquema).`;
}

/** RUC de una empresa (20…). Una persona natural (RUC 10, 15, 17 o un DNI) no se consulta. */
export function rucEmpresa(v: string, que: string): string {
  const s = v.trim();
  if (/^(1[0-7]\d{9}|\d{8})$/.test(s)) {
    throw new ErrorConsulta(`${que}: persona natural: no se consulta. Vigía no muestra ni filtra personas naturales por su RUC o DNI.`);
  }
  if (!/^20\d{9}$/.test(s)) throw new ErrorConsulta(`${que}: va el RUC de 11 dígitos de una empresa o entidad (empieza con 20).`);
  return s;
}

function anio(v: string, que: string): number {
  const n = Number(v.trim());
  if (!/^\d{4}$/.test(v.trim()) || n < 2000 || n > 2100) throw new ErrorConsulta(`${que}: un año de 4 cifras, por ejemplo 2023.`);
  return n;
}

/** Busca `v` en `opciones` sin mayúsculas ni tildes; si no está, 400 con la lista. */
function deLista(v: string, opciones: string[], que: string): string {
  const t = normal(v);
  const hallado = opciones.find((o) => normal(o) === t);
  if (!hallado) throw new ErrorConsulta(`${que}: «${v.slice(0, 60)}» no es una opción. ${usa(opciones)}`, opciones);
  return hallado;
}

const siNo = (v: string, que: string) => {
  const t = normal(v);
  if (t === "si" || t === "true" || t === "1") return true;
  if (t === "no" || t === "false" || t === "0") return false;
  throw new ErrorConsulta(`${que}: si o no.`, ["si", "no"]);
};

// ─── Las fuentes ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Valor = string | number | boolean | null;

interface Medida {
  nombre: string;
  unidad: string;
  descripcion: string;
  /** Agregado sobre las filas de la fuente (`m`). */
  sql?: string;
  /**
   * Agregado por una llave (procesos distintos, empresas distintas…): primero se agrupa por las dimensiones y la llave
   * (`interno`, agregados por llave como `bool_or(…) AS x`), después se cuenta (`externo`). Con hash es mucho más rápido
   * que count(DISTINCT …) sobre 2 M de filas.
   */
  porLlave?: { llave: string; donde?: string; interno?: string; externo: string };
  nota?: string;
}

interface Dimension {
  nombre: string;
  /** Expresión del valor (sobre `m`, y `c` si va con la convocatoria). */
  sql: string;
  /** Expresión del nombre que lo acompaña (`<dim>_nombre`), agregada con max(). */
  nombreSql?: string;
  /** El valor como se muestra (región, nivel, objeto). */
  mostrar?: (v: Valor) => Valor;
  /** El `<dim>_nombre` desde el valor (la etiqueta de un tipo de señal). */
  etiqueta?: (v: Valor) => string | null;
  /** Dimensión de proveedor: `null` es la fila «Personas naturales y otros». */
  proveedor?: true;
  conConvocatoria?: true;
}

interface Contexto { p: (v: unknown) => string; listas: Listas }

interface Filtro {
  tipo: string;
  descripcion: string;
  valores?: string[] | ((l: Listas) => string[]);
  /** La condición (con el valor como parámetro) y el valor como se aplicó. */
  armar: (v: string, cx: Contexto) => { sql: string; valor: Valor };
  conConvocatoria?: true;
}

interface Fuente {
  nombre: string;
  descripcion: string;
  cobertura: string;
  oficial: { nombre: string; enlace: string };
  desde: string;
  /** El JOIN a la convocatoria, sólo si una dimensión o un filtro lo pide. */
  convocatoria?: string;
  medidas: Record<string, Medida>;
  dimensiones: Record<string, Dimension>;
  filtros: Record<string, Filtro>;
  nota: string;
  /** Hasta qué fecha llegan los datos (una fila, columna `v`, AAAA-MM-DD). */
  hasta: string;
}

const mostrarRegion = (v: Valor) => (typeof v === "string" ? NOMBRE_REGION.get(v) ?? v : v);

/** anio_desde y anio_hasta: `desde` y `hasta` reciben el marcador del año (con `siguiente`, el del año siguiente: `<`). */
const filtrosAnio = (desde: (p: string) => string, hasta: (p: string) => string, siguiente = false): Record<string, Filtro> => ({
  anio_desde: {
    tipo: "año", descripcion: "Desde ese año (incluido).",
    armar: (v, { p }) => { const n = anio(v, "anio_desde"); return { sql: desde(p(n)), valor: n }; },
  },
  anio_hasta: {
    tipo: "año", descripcion: "Hasta ese año (incluido).",
    armar: (v, { p }) => { const n = anio(v, "anio_hasta"); return { sql: hasta(p(siguiente ? n + 1 : n)), valor: n }; },
  },
});

const filtroRegion = (expr: (p: string) => string, conConvocatoria = false): Filtro => ({
  tipo: "región", descripcion: "Departamento, sin importar tildes ni mayúsculas (Cusco, Junín, Callao).",
  valores: DEPARTAMENTOS.map((d) => d[2]),
  armar: (v, { p }) => {
    const r = regionDe(v);
    if (!r) throw new ErrorConsulta(`region: «${v.slice(0, 40)}» no es un departamento. Usa: ${lista(DEPARTAMENTOS.map((d) => d[2]))}.`);
    return { sql: expr(p(r.mayus)), valor: r.nombre };
  },
  ...(conConvocatoria ? { conConvocatoria: true as const } : {}),
});

const filtroEntidad = (expr: (p: string) => string, conConvocatoria = false): Filtro => ({
  tipo: "RUC", descripcion: "RUC de la entidad pública (11 dígitos).",
  armar: (v, { p }) => { const r = rucEmpresa(v, "entidad"); return { sql: expr(p(r)), valor: r }; },
  ...(conConvocatoria ? { conConvocatoria: true as const } : {}),
});

const filtroProveedor = (expr: (p: string) => string): Filtro => ({
  tipo: "RUC", descripcion: "RUC de una empresa (empieza con 20). Las personas naturales no se consultan.",
  armar: (v, { p }) => { const r = rucEmpresa(v, "proveedor"); return { sql: expr(p(r)), valor: r }; },
});

const PROVEEDORES_RUC20 = (col: string): Medida => ({
  nombre: "Empresas proveedoras", unidad: "empresas", descripcion: "Empresas distintas (RUC 20). Las personas naturales no se cuentan.",
  porLlave: { llave: col, donde: `${col} ~ '^20[0-9]{9}$'`, externo: "count(*)" },
});

const NOTA_OTROS = `Con «proveedor», todo lo que no es una empresa (RUC 20) va en una sola fila: «${OTROS}».`;

export const FUENTES: Record<string, Fuente> = {
  adjudicaciones: {
    nombre: "Procesos adjudicados (buena pro)",
    descripcion:
      "Cada proceso de selección con buena pro y su ganador, desde 2018 (CONOSCE). Un proceso con varios ganadores aparece una vez por proveedor.",
    cobertura: "2018 en adelante",
    oficial: { nombre: "OECE, CONOSCE: adjudicaciones y postores", enlace: CONOSCE_BUSCADOR },
    desde: "mcp_adjudicacion m",
    medidas: {
      monto_adjudicado: {
        nombre: "Monto adjudicado", unidad: "S/", descripcion: "Suma de lo adjudicado en soles.",
        sql: "sum(m.monto) FILTER (WHERE NOT m.dudoso)",
      },
      procesos: {
        nombre: "Procesos", unidad: "procesos", descripcion: "Procesos con buena pro (codigo de convocatoria distinto).",
        porLlave: { llave: "m.codigo_convocatoria", externo: "count(*)" },
      },
      proveedores: PROVEEDORES_RUC20("m.ruc_proveedor"),
      pct_unico_postor: {
        nombre: "% con único postor", unidad: "%",
        descripcion: "De los procesos con postores conocidos, cuántos tuvieron un solo postor en todos sus ítems.",
        porLlave: {
          llave: "m.codigo_convocatoria", interno: "bool_or(m.unico_postor) AS x",
          externo: "100.0 * count(*) FILTER (WHERE x) / NULLIF(count(*) FILTER (WHERE x IS NOT NULL), 0)",
        },
        nota: "La contratación directa tiene un solo proveedor por definición: con directa=no queda fuera.",
      },
      pct_directas: {
        nombre: "% contratación directa", unidad: "%", descripcion: "De los procesos, cuántos fueron contratación directa.",
        porLlave: { llave: "m.codigo_convocatoria", interno: "bool_or(m.es_directa) AS x", externo: "100.0 * count(*) FILTER (WHERE x) / NULLIF(count(*), 0)" },
      },
    },
    dimensiones: {
      anio: { nombre: "Año de la convocatoria", sql: "m.anio::int" },
      mes: { nombre: "Mes de la buena pro (AAAA-MM)", sql: "to_char(m.mes, 'YYYY-MM')" },
      region: { nombre: "Departamento de la entidad", sql: "m.departamento", mostrar: mostrarRegion },
      nivel: { nombre: "Nivel de gobierno", sql: "m.nivel", mostrar: (v) => (typeof v === "string" ? NIVELES[v] ?? v : v) },
      entidad: { nombre: "Entidad (RUC)", sql: "m.entidad_ruc", nombreSql: "m.entidad" },
      proveedor: { nombre: "Proveedor (RUC 20)", sql: "m.ruc_proveedor", nombreSql: "m.proveedor", proveedor: true },
      objeto: { nombre: "Objeto (bien, servicio, obra, consultoría de obra)", sql: "m.objeto" },
      tipo_proceso: { nombre: "Tipo de procedimiento", sql: "m.tipo_proceso" },
    },
    filtros: {
      ...filtrosAnio((n) => `m.anio >= ${n}`, (n) => `m.anio <= ${n}`),
      region: filtroRegion((n) => `m.departamento = ${n}`),
      nivel: {
        tipo: "lista", descripcion: "Nivel de gobierno.", valores: Object.keys(NIVELES),
        armar: (v, { p }) => {
          const k = Object.keys(NIVELES).find((x) => normal(x) === normal(v) || normal(NIVELES[x]) === normal(v));
          if (!k) throw new ErrorConsulta(`nivel: usa ${lista(Object.keys(NIVELES))}.`, Object.keys(NIVELES));
          return { sql: `m.nivel = ${p(k)}`, valor: k };
        },
      },
      entidad: filtroEntidad((n) => `m.entidad_ruc = ${n}`),
      proveedor: filtroProveedor((n) => `m.ruc_proveedor = ${n}`),
      objeto: {
        tipo: "lista", descripcion: "Objeto de la contratación.", valores: OBJETOS_ADJ,
        armar: (v, { p }) => { const o = deLista(v, OBJETOS_ADJ, "objeto"); return { sql: `m.objeto = ${p(o)}`, valor: o }; },
      },
      tipo_proceso: {
        tipo: "lista", descripcion: "Tipo de procedimiento (las variantes por ley o decreto van juntas).", valores: TIPOS_PROCESO,
        armar: (v, { p }) => { const o = deLista(v, TIPOS_PROCESO, "tipo_proceso"); return { sql: `m.tipo_proceso = ${p(o)}`, valor: o }; },
      },
      unico_postor: {
        tipo: "si/no", descripcion: "si: sólo procesos con un único postor; no: con dos o más.", valores: ["si", "no"],
        armar: (v) => { const s = siNo(v, "unico_postor"); return { sql: s ? "m.unico_postor" : "m.unico_postor = false", valor: s ? "si" : "no" }; },
      },
      directa: {
        tipo: "si/no", descripcion: "si: sólo contratación directa; no: sin ella.", valores: ["si", "no"],
        armar: (v) => { const s = siNo(v, "directa"); return { sql: s ? "m.es_directa" : "NOT m.es_directa", valor: s ? "si" : "no" }; },
      },
      monto_min: {
        tipo: "número", descripcion: "Sólo adjudicaciones (proceso y proveedor) de al menos ese monto en soles.",
        armar: (v, { p }) => {
          const n = Number(v.trim());
          if (!/^\d+(\.\d+)?$/.test(v.trim()) || n > 1e13) throw new ErrorConsulta("monto_min: un número en soles, sin separadores (por ejemplo 1000000).");
          return { sql: `m.monto >= ${p(n)}`, valor: n };
        },
      },
    },
    nota:
      "Montos en soles: no suman los ítems en otra moneda ni los procesos con un monto que parece mal cargado. «anio» es el año " +
      "de la convocatoria y «mes» el de la buena pro.",
    hasta: `SELECT to_char(max(fecha_buenapro), 'YYYY-MM-DD') AS v FROM conosce_adjudicaciones
             WHERE anio >= extract(year FROM current_date)::int - 1 AND fecha_buenapro <= current_date`,
  },

  ordenes: {
    nombre: "Órdenes de compra y de servicio",
    descripcion:
      "Las órdenes de compra y de servicio de cada entidad (CONOSCE), en soles y sin anuladas, por año de emisión. Las que no " +
      "fueron a una empresa (personas naturales, RUC 15 y 17) van en «Personas naturales y otros».",
    cobertura: "2018 en adelante",
    oficial: { nombre: "OECE, CONOSCE: órdenes de compra y de servicio", enlace: CONOSCE_BUSCADOR },
    desde: `(SELECT e.ruc, e.entidad_ruc, e.anio, e.entidad, e.nombre, replace(e.departamento, 'PROV.CONSTITUC.DEL ', '') AS departamento,
                    e.ordenes, e.monto
               FROM empresa_orden_anual e
             UNION ALL
             SELECT NULL, o.entidad_ruc, o.anio, o.entidad, NULL, o.departamento, o.ordenes, o.monto FROM mcp_orden_otros o) m`,
    medidas: {
      monto_ordenes: { nombre: "Monto de las órdenes", unidad: "S/", descripcion: "Suma de las órdenes (sin las de monto dudoso).", sql: "sum(m.monto)" },
      ordenes: { nombre: "Órdenes", unidad: "órdenes", descripcion: "Número de órdenes.", sql: "sum(m.ordenes)" },
      proveedores: PROVEEDORES_RUC20("m.ruc"),
    },
    dimensiones: {
      anio: { nombre: "Año de emisión", sql: "m.anio::int" },
      region: { nombre: "Departamento de la entidad", sql: "m.departamento", mostrar: mostrarRegion },
      entidad: { nombre: "Entidad (RUC)", sql: "m.entidad_ruc", nombreSql: "m.entidad" },
      proveedor: { nombre: "Proveedor (RUC 20)", sql: "m.ruc", nombreSql: "m.nombre", proveedor: true },
    },
    filtros: {
      ...filtrosAnio((n) => `m.anio >= ${n}`, (n) => `m.anio <= ${n}`),
      region: filtroRegion((n) => `m.departamento = ${n}`),
      entidad: filtroEntidad((n) => `m.entidad_ruc = ${n}`),
      proveedor: filtroProveedor((n) => `m.ruc = ${n}`),
    },
    nota: "En soles, sin anuladas; el monto no suma las órdenes con monto dudoso (sí se cuentan).",
    hasta: `SELECT to_char(max(fecha_emision), 'YYYY-MM-DD') AS v FROM conosce_ordenes WHERE fecha_emision <= current_date`,
  },

  presupuesto: {
    nombre: "Presupuesto y gasto (MEF)",
    descripcion: "Presupuesto institucional modificado (PIM) y gasto devengado de cada unidad ejecutora, por año (SIAF).",
    cobertura: "2015 en adelante",
    oficial: { nombre: "MEF, Consulta Amigable y datos abiertos de presupuesto", enlace: "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto" },
    desde: "mef_ejecutora_anual m",
    medidas: {
      pim: { nombre: "PIM", unidad: "S/", descripcion: "Presupuesto institucional modificado.", sql: "sum(m.pim)" },
      devengado: { nombre: "Devengado", unidad: "S/", descripcion: "Gasto devengado.", sql: "sum(m.devengado)" },
      pct_ejecucion: {
        nombre: "% de ejecución", unidad: "%", descripcion: "Devengado sobre PIM (100 × Σ devengado / Σ PIM).",
        sql: "100.0 * sum(m.devengado) / NULLIF(sum(m.pim), 0)",
      },
    },
    dimensiones: {
      anio: { nombre: "Año", sql: "m.anio::int" },
      region: { nombre: "Departamento de la ejecutora", sql: "replace(m.departamento_nombre, 'PROVINCIA CONSTITUCIONAL DEL ', '')", mostrar: mostrarRegion },
      nivel: {
        nombre: "Nivel de gobierno",
        sql: "CASE m.nivel_gobierno WHEN 'E' THEN 'nacional' WHEN 'R' THEN 'regional' WHEN 'M' THEN 'local' END",
        mostrar: (v) => (typeof v === "string" ? NIVELES[v] ?? v : v),
      },
      sector: { nombre: "Sector", sql: SECTOR_SQL },
      ejecutora: { nombre: "Unidad ejecutora (código SIAF)", sql: "m.sec_ejec", nombreSql: "m.ejecutora_nombre" },
    },
    filtros: {
      ...filtrosAnio((n) => `m.anio >= ${n}`, (n) => `m.anio <= ${n}`),
      region: filtroRegion((n) => `replace(m.departamento_nombre, 'PROVINCIA CONSTITUCIONAL DEL ', '') = ${n}`),
      nivel: {
        tipo: "lista", descripcion: "Nivel de gobierno.", valores: Object.keys(NIVEL_MEF),
        armar: (v, { p }) => {
          const k = Object.keys(NIVEL_MEF).find((x) => normal(x) === normal(v) || normal(NIVELES[x]) === normal(v));
          if (!k) throw new ErrorConsulta(`nivel: usa ${lista(Object.keys(NIVEL_MEF))}.`, Object.keys(NIVEL_MEF));
          return { sql: `m.nivel_gobierno = ${p(NIVEL_MEF[k])}`, valor: k };
        },
      },
      sector: {
        tipo: "lista", descripcion: "Sector del MEF (los gobiernos locales son «GOBIERNOS LOCALES»).", valores: (l) => l.sectores,
        armar: (v, { p, listas }) => { const s = deLista(v, listas.sectores, "sector"); return { sql: `${SECTOR_SQL} = ${p(s)}`, valor: s }; },
      },
      entidad: {
        tipo: "RUC", descripcion: "RUC de la entidad: sus unidades ejecutoras según el registro de la OECE.",
        armar: (v, { p }) => {
          const r = rucEmpresa(v, "entidad");
          return {
            sql: `m.sec_ejec IN (SELECT s.sec_ejec::text FROM entidad_siaf s
                                  WHERE btrim(s.ruc::text) = ${p(r)} AND s.sec_ejec IS NOT NULL AND NOT COALESCE(s.fuera_siaf, false))`,
            valor: r,
          };
        },
      },
    },
    nota: "Del SIAF por unidad ejecutora. Las entidades fuera del SIAF (empresas de FONAFE, EsSalud, EPS…) no están.",
    hasta: `SELECT to_char(max(corte), 'YYYY-MM-DD') AS v FROM mef_ejecutora_anual`,
  },

  senales: {
    nombre: "Señales de riesgo (cruces)",
    descripcion:
      "Cruces de los ganadores con otros registros (sanciones, aportes, socios en la entidad, fraccionamiento, único postor…): " +
      "un caso por señal, proveedor y contrato. Son indicios con evidencia, no acusaciones.",
    cobertura: "Según cada registro (la mayoría desde 2018)",
    oficial: { nombre: "Vigía, cruzando OECE, ONPE, JNE, SUNAT, Contraloría y otros registros públicos", enlace: "https://vigia.gobserva.cloud/fuentes" },
    desde: "cruces_proveedor m",
    // El departamento y la entidad de cada contrato (migración 254): sin recorrer convocatorias.
    convocatoria: "LEFT JOIN mcp_cruce_lugar c ON c.ocid = m.ocid",
    medidas: {
      casos: { nombre: "Casos", unidad: "casos", descripcion: "Señales registradas (una por señal, proveedor y contrato).", sql: "count(*)" },
      contratos: {
        nombre: "Contratos con señal", unidad: "contratos", descripcion: "Contratos (OCID) distintos con al menos una señal.",
        porLlave: { llave: "m.ocid", donde: "m.ocid IS NOT NULL", externo: "count(*)" },
      },
      empresas: PROVEEDORES_RUC20("m.ruc_empresa"),
    },
    dimensiones: {
      anio: { nombre: "Año del hecho", sql: "extract(year FROM m.fecha)::int" },
      tipo: { nombre: "Tipo de señal", sql: "m.tipo", etiqueta: (v) => (typeof v === "string" ? ETIQUETA_CRUCE[v] ?? null : null) },
      severidad: { nombre: "Severidad (alta, media, baja)", sql: "m.severidad" },
      proveedor: { nombre: "Proveedor (RUC 20)", sql: "CASE WHEN m.ruc_empresa ~ '^20[0-9]{9}$' THEN m.ruc_empresa END", proveedor: true },
      region: { nombre: "Departamento del contrato", sql: "c.departamento", mostrar: mostrarRegion, conConvocatoria: true },
    },
    filtros: {
      ...filtrosAnio((n) => `m.fecha >= make_date(${n}::int, 1, 1)`, (n) => `m.fecha < make_date(${n}::int, 1, 1)`, true),
      tipo: {
        tipo: "lista", descripcion: "Tipo de señal (clave).", valores: (l) => l.tiposSenal,
        armar: (v, { p, listas }) => { const t = deLista(v, listas.tiposSenal, "tipo"); return { sql: `m.tipo = ${p(t)}`, valor: t }; },
      },
      severidad: {
        tipo: "lista", descripcion: "Severidad.", valores: SEVERIDADES,
        armar: (v, { p }) => { const s = deLista(v, SEVERIDADES, "severidad"); return { sql: `m.severidad = ${p(s)}`, valor: s }; },
      },
      proveedor: filtroProveedor((n) => `m.ruc_empresa = ${n}`),
      region: filtroRegion((n) => `c.departamento = ${n}`, true),
      entidad: filtroEntidad((n) => `c.entidad_ruc = ${n}`, true),
    },
    nota: "Indicios, no acusaciones: cada caso cita su registro oficial en la ficha del contrato. «anio» es el del hecho.",
    hasta: `SELECT to_char(max(refrescado_at) AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS v FROM cruces_proveedor`,
  },

  menores: {
    nombre: "Contratos menores (hasta 8 UIT)",
    descripcion: "Las compras de hasta 8 UIT registradas en el SEACE nuevo (prod6), con su proveedor y monto.",
    cobertura: "2026 en adelante",
    oficial: { nombre: "OECE, SEACE: contratos menores (buscador público)", enlace: "https://prod6.seace.gob.pe/buscador-publico" },
    desde: "seace_menores m",
    medidas: {
      monto: { nombre: "Monto", unidad: "S/", descripcion: "Suma de los contratos en soles.", sql: "sum(m.monto) FILTER (WHERE m.moneda = 'PEN')" },
      compras: { nombre: "Compras", unidad: "contratos", descripcion: "Número de contratos menores.", sql: "count(*)" },
      proveedores: PROVEEDORES_RUC20("m.proveedor_ruc"),
    },
    dimensiones: {
      anio: { nombre: "Año", sql: "m.anio::int" },
      entidad: { nombre: "Entidad (RUC)", sql: "m.entidad_ruc", nombreSql: "m.entidad" },
      proveedor: {
        nombre: "Proveedor (RUC 20)", sql: "CASE WHEN m.proveedor_ruc ~ '^20[0-9]{9}$' THEN m.proveedor_ruc END",
        nombreSql: "CASE WHEN m.proveedor_ruc ~ '^20[0-9]{9}$' THEN m.proveedor END", proveedor: true,
      },
      objeto: { nombre: "Objeto", sql: "m.objeto", mostrar: (v) => (typeof v === "string" ? OBJETOS_MENOR[v] ?? v : v) },
      estado: { nombre: "Estado del proceso", sql: "COALESCE(m.estado_prod6, m.estado)" },
    },
    filtros: {
      ...filtrosAnio((n) => `m.anio >= ${n}`, (n) => `m.anio <= ${n}`),
      entidad: filtroEntidad((n) => `m.entidad_ruc = ${n}`),
      proveedor: filtroProveedor((n) => `m.proveedor_ruc = ${n}`),
      objeto: {
        tipo: "lista", descripcion: "Objeto.", valores: Object.values(OBJETOS_MENOR),
        armar: (v, { p }) => {
          const o = deLista(v, Object.values(OBJETOS_MENOR), "objeto");
          const k = Object.keys(OBJETOS_MENOR).find((x) => OBJETOS_MENOR[x] === o)!;
          return { sql: `m.objeto = ${p(k)}`, valor: o };
        },
      },
    },
    nota: "Sólo lo registrado en el SEACE nuevo (desde 2026); el monto suma los contratos en soles.",
    hasta: `SELECT to_char(max(fecha_suscripcion), 'YYYY-MM-DD') AS v FROM seace_menores WHERE fecha_suscripcion <= current_date`,
  },
};

// ─── El armado de la consulta ────────────────────────────────────────────────────────────────────────────────────────

const RESERVADOS = new Set(["fuente", "medida", "por", "orden", "limite"]);

export interface Plan {
  fuente: string;
  medida: string;
  por: string[];
  filtros: Record<string, Valor>;
  orden: "desc" | "asc";
  limite: number;
  sql: string;
  vals: unknown[];
}

/**
 * Valida el pedido contra `FUENTES` y arma la SQL. Tira ErrorConsulta con lo que hay que cambiar. La SQL sólo lleva texto
 * de `FUENTES` (elegido por claves que existen) y marcadores $n; los valores del pedido van en `vals`.
 */
export function armarConsulta(params: Record<string, string>, listas: Listas): Plan {
  const fuentes = Object.keys(FUENTES);
  const claveFuente = (params.fuente ?? "").trim();
  if (!claveFuente) throw new ErrorConsulta(`Falta fuente. Usa: ${lista(fuentes)}.`, fuentes);
  const f = FUENTES[claveFuente];
  if (!f || !Object.hasOwn(FUENTES, claveFuente)) throw new ErrorConsulta(`fuente «${claveFuente.slice(0, 40)}» no existe. Usa: ${lista(fuentes)}.`, fuentes);

  const medidas = Object.keys(f.medidas);
  const claveMedida = (params.medida ?? "").trim();
  if (!claveMedida || !Object.hasOwn(f.medidas, claveMedida)) {
    throw new ErrorConsulta(`${claveMedida ? `medida «${claveMedida.slice(0, 40)}» no existe en ${claveFuente}` : "Falta medida"}. Usa: ${lista(medidas)}.`, medidas);
  }
  const medida = f.medidas[claveMedida];

  const dimsValidas = Object.keys(f.dimensiones);
  const por = (params.por ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (por.length > MAX_DIMENSIONES) throw new ErrorConsulta(`Hasta ${MAX_DIMENSIONES} dimensiones en por (pediste ${por.length}).`, dimsValidas);
  for (const d of por) {
    if (!Object.hasOwn(f.dimensiones, d)) throw new ErrorConsulta(`Dimensión «${d.slice(0, 40)}» no existe en ${claveFuente}. Usa: ${lista(dimsValidas)}.`, dimsValidas);
  }
  if (new Set(por).size !== por.length) throw new ErrorConsulta("La misma dimensión dos veces en por.", dimsValidas);

  const orden = (params.orden ?? "desc").trim().toLowerCase();
  if (orden !== "desc" && orden !== "asc") throw new ErrorConsulta("orden: desc o asc.", ["desc", "asc"]);
  const limiteTxt = (params.limite ?? String(LIMITE_DEFECTO)).trim();
  const limite = Number(limiteTxt);
  if (!/^\d{1,3}$/.test(limiteTxt) || limite < 1 || limite > LIMITE_MAX) throw new ErrorConsulta(`limite: un entero de 1 a ${LIMITE_MAX}.`);

  // Filtros: cada clave tiene que ser de esta fuente; el valor lo valida y lo convierte su filtro.
  const vals: unknown[] = [];
  const cx: Contexto = { p: (v) => { vals.push(v); return `$${vals.length}`; }, listas };
  const conds: string[] = [];
  const aplicados: Record<string, Valor> = {};
  const filtrosValidos = Object.keys(f.filtros);
  let conConvocatoria = por.some((d) => f.dimensiones[d].conConvocatoria);
  for (const [k, v] of Object.entries(params)) {
    if (RESERVADOS.has(k) || v == null || v === "") continue;
    if (!Object.hasOwn(f.filtros, k)) throw new ErrorConsulta(`Filtro «${k.slice(0, 40)}» no existe en ${claveFuente}. Usa: ${lista(filtrosValidos)}.`, filtrosValidos);
    const fl = f.filtros[k];
    const { sql, valor } = fl.armar(String(v), cx);
    conds.push(sql);
    aplicados[k] = valor;
    if (fl.conConvocatoria) conConvocatoria = true;
  }
  if (typeof aplicados.anio_desde === "number" && typeof aplicados.anio_hasta === "number" && aplicados.anio_desde > aplicados.anio_hasta) {
    throw new ErrorConsulta("anio_desde es mayor que anio_hasta.");
  }

  const dims = por.map((d) => f.dimensiones[d]);
  const desde = `${f.desde}${conConvocatoria && f.convocatoria ? ` ${f.convocatoria}` : ""}`;
  const selDims = dims.map((d, i) => `${d.sql} AS d${i}`);
  const selNombres = dims.flatMap((d, i) => (d.nombreSql ? [`max(${d.nombreSql}) AS n${i}`] : []));
  const nombresExternos = dims.flatMap((d, i) => (d.nombreSql ? [`max(n${i}) AS n${i}`] : []));
  const posDims = dims.map((_, i) => String(i + 1));
  const dimsExternas = dims.map((_, i) => `d${i}`);

  let agrupado: string;
  if (medida.sql) {
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    agrupado = `SELECT ${[...selDims, ...selNombres, `(${medida.sql}) AS valor`].join(", ")}
                  FROM ${desde} ${where}${posDims.length ? ` GROUP BY ${posDims.join(", ")}` : ""}`;
  } else {
    const l = medida.porLlave!;
    const where = [...conds, l.donde ?? `${l.llave} IS NOT NULL`];
    const posLlave = selDims.length + selNombres.length + 1;
    const interno = `SELECT ${[...selDims, ...selNombres, `${l.llave} AS k`, ...(l.interno ? [l.interno] : [])].join(", ")}
                       FROM ${desde} WHERE ${where.join(" AND ")} GROUP BY ${[...posDims, String(posLlave)].join(", ")}`;
    agrupado = `SELECT ${[...dimsExternas, ...nombresExternos, `(${l.externo}) AS valor`].join(", ")}
                  FROM (${interno}) t${dimsExternas.length ? ` GROUP BY ${dimsExternas.join(", ")}` : ""}`;
  }
  const dir = orden === "asc" ? "ASC" : "DESC";
  const sql = `SELECT g.*, round((g.valor)::numeric, 2)::float8 AS valor_n, count(*) OVER ()::int AS filas_total
                 FROM (${agrupado}) g
                ORDER BY g.valor ${dir} NULLS LAST${dimsExternas.map((d) => `, g.${d} NULLS LAST`).join("")}
                LIMIT ${limite}`;
  return { fuente: claveFuente, medida: claveMedida, por, filtros: aplicados, orden, limite, sql, vals };
}

/** Las filas de la base como las lee Claude: `<dim>`, `<dim>_nombre` y `valor`. */
export function aFilas(plan: Plan, rows: Record<string, unknown>[]): Record<string, Valor>[] {
  const f = FUENTES[plan.fuente];
  return rows.map((r) => {
    const fila: Record<string, Valor> = {};
    plan.por.forEach((clave, i) => {
      const d = f.dimensiones[clave];
      const crudo = (r[`d${i}`] ?? null) as Valor;
      fila[clave] = d.mostrar ? d.mostrar(crudo) : crudo;
      if (d.proveedor) {
        // El grupo de los que no son empresas nunca lleva un RUC ni un nombre.
        fila[`${clave}_nombre`] = crudo == null ? OTROS : ((r[`n${i}`] ?? null) as Valor);
        if (crudo == null) fila[clave] = null;
      } else if (d.nombreSql) {
        fila[`${clave}_nombre`] = (r[`n${i}`] ?? null) as Valor;
      } else if (d.etiqueta) {
        fila[`${clave}_nombre`] = d.etiqueta(crudo);
      }
    });
    fila.valor = (r.valor_n ?? null) as Valor;
    return fila;
  });
}

function notaDe(plan: Plan): string {
  const f = FUENTES[plan.fuente];
  const m = f.medidas[plan.medida];
  const partes = [f.nota];
  if (m.nota) partes.push(m.nota);
  if (plan.por.some((d) => f.dimensiones[d].proveedor)) partes.push(NOTA_OTROS);
  return partes.join(" ");
}

// ─── Hasta cuándo llega cada fuente ──────────────────────────────────────────────────────────────────────────────────

const uno = (sql: string) => pool.query<{ v: string | null }>(sql).then((r) => r.rows[0]?.v ?? null).catch(() => null);

const frescura = () =>
  memoEsquema.obtener("frescura", async () => {
    const claves = Object.keys(FUENTES);
    const [hasta, calculado] = await Promise.all([
      Promise.all(claves.map((k) => uno(FUENTES[k].hasta))),
      uno(`SELECT to_char(refrescado_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS v FROM mcp_estado WHERE id`),
    ]);
    return Object.fromEntries(claves.map((k, i) => [k, { datos_hasta: hasta[i], calculado: k === "adjudicaciones" || k === "ordenes" ? calculado : null }]));
  });

// ─── GET /datos/esquema ──────────────────────────────────────────────────────────────────────────────────────────────

datosRouter.get("/esquema", async (c) => {
  const cuerpo = await memoEsquema.obtener("esquema", async () => {
    const [listas, fr] = await Promise.all([cargarListas(), frescura()]);
    return {
      uso:
        "GET /datos/consulta?fuente=<clave>&medida=<clave>&por=<dim1>[,<dim2>]&<filtro>=<valor>…&orden=desc|asc&limite=1..100. " +
        "Sin por, una sola fila con el total. Las filas vienen ordenadas por valor.",
      limites: { dimensiones: MAX_DIMENSIONES, limite_max: LIMITE_MAX, limite_defecto: LIMITE_DEFECTO, segundos: PLAZO_MS / 1000 },
      privacidad: `El proveedor sólo sale si es una empresa (RUC 20); lo demás va sumado en «${OTROS}». Un RUC de persona natural no se consulta.`,
      regiones: DEPARTAMENTOS.map((d) => d[2]),
      fuentes: Object.entries(FUENTES).map(([clave, f]) => ({
        clave,
        nombre: f.nombre,
        descripcion: f.descripcion,
        cobertura: f.cobertura,
        fuente_oficial: f.oficial,
        ...((fr as Record<string, unknown>)[clave] as object),
        medidas: Object.entries(f.medidas).map(([k, m]) => ({ clave: k, nombre: m.nombre, unidad: m.unidad, descripcion: m.descripcion })),
        dimensiones: Object.entries(f.dimensiones).map(([k, d]) => ({ clave: k, nombre: d.nombre })),
        filtros: Object.entries(f.filtros).map(([k, fl]) => ({
          clave: k,
          tipo: fl.tipo,
          descripcion: fl.descripcion,
          ...(fl.valores ? { valores: typeof fl.valores === "function" ? fl.valores(listas) : fl.valores } : {}),
        })),
        nota: f.nota,
      })),
      tipos_senal: Object.fromEntries(listas.tiposSenal.map((t) => [t, ETIQUETA_CRUCE[t] ?? null])),
    };
  });
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});

// ─── GET /datos/consulta ─────────────────────────────────────────────────────────────────────────────────────────────

datosRouter.get("/consulta", async (c) => {
  const params = parametros(c);
  let plan: Plan;
  try {
    plan = armarConsulta(params, await cargarListas());
  } catch (e) {
    if (e instanceof ErrorConsulta) return c.json({ error: "consulta_invalida", detail: e.detail, ...(e.opciones ? { opciones: e.opciones } : {}) }, 400);
    throw e;
  }
  const clave = JSON.stringify([plan.fuente, plan.medida, plan.por, plan.filtros, plan.orden, plan.limite]);
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await memo.obtener(clave, async () => {
      // 5 s y 64 MB para agrupar en memoria (con los 4 MB de la base, contar empresas distintas en 2 M de órdenes iba a disco).
      const [r, fr] = await Promise.all([consultaConPlazo(plan.sql, plan.vals, PLAZO_MS, { memoriaMb: 64 }), frescura().catch(() => null)]);
      const f = FUENTES[plan.fuente];
      const filas = aFilas(plan, r.rows);
      // Los nombres de las empresas que la fuente no trae (señales): de empresa_resumen, por su RUC.
      const sinNombre = new Set<string>();
      for (const fila of filas) {
        for (const d of plan.por) if (f.dimensiones[d].proveedor && typeof fila[d] === "string" && fila[`${d}_nombre`] == null) sinNombre.add(fila[d] as string);
      }
      if (sinNombre.size) {
        const n = await pool.query<{ ruc: string; nombre: string }>(`SELECT ruc, nombre FROM empresa_resumen WHERE ruc = ANY($1::text[])`, [[...sinNombre]]);
        const nombres = new Map(n.rows.map((x) => [x.ruc, x.nombre]));
        for (const fila of filas) for (const d of plan.por) if (f.dimensiones[d].proveedor && typeof fila[d] === "string") fila[`${d}_nombre`] ??= nombres.get(fila[d] as string) ?? null;
      }
      const datos = (fr as Record<string, { datos_hasta: string | null; calculado: string | null }> | null)?.[plan.fuente];
      return publicar({
        fuente: plan.fuente,
        medida: plan.medida,
        unidad: f.medidas[plan.medida].unidad,
        por: plan.por,
        filtros: plan.filtros,
        orden: plan.orden,
        limite: plan.limite,
        filas,
        filas_total: (r.rows[0]?.filas_total as number | undefined) ?? 0,
        nota: notaDe(plan),
        fuente_oficial: { ...f.oficial, datos_hasta: datos?.datos_hasta ?? null },
      });
    });
  } catch (e) {
    // 57014: la consulta pasó los 5 s.
    if (esErrorPg(e, "57014")) {
      return c.json({ error: "consulta_lenta", detail: "La consulta pasó de 5 s: agrega filtros (años, región, entidad) o usa una dimensión menos." }, 504);
    }
    throw e;
  }
  c.header("Cache-Control", CACHE);
  return c.json(cuerpo);
});
