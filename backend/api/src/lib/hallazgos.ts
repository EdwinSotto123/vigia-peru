/**
 * Hallazgos por entidad: cada cifra de una entidad comparada con la de sus pares (migración 256, entidad_metricas). Todo
 * lo de aquí es puro (sin base): qué se mide, quiénes son los pares, los percentiles, cuándo una cifra es un hallazgo y
 * la frase que la explica. La ruta (routes/hallazgos.ts) sólo lee las tablas y arma la respuesta.
 *
 * Una cifra es un HALLAZGO cuando:
 *   · es una señal (las cifras de volumen, como el monto adjudicado o el PIM, son contexto: nunca hallazgo; también los
 *     conceptos de gasto normales de operación, como telefonía o mantenimiento: categoria_gasto.es_senal = false, 257);
 *   · la entidad cumple el piso de su cifra (por ejemplo 10 procesos para un porcentaje de procesos; S/ 50 mil, 1 % y 50
 *     órdenes para un concepto de gasto): un 100 % sobre dos procesos no dice nada;
 *   · al menos MIN_PARES pares tienen el dato;
 *   · cae en el 10 % más alto de sus pares (percentil ≥ 90 y sobre la mediana) o, en la ejecución del presupuesto, en el
 *     10 % más bajo.
 * El percentil es el «rango medio»: el % de pares con un valor menor más la mitad de los que tienen el mismo. Si una de
 * cada cinco entidades o más comparte el valor más alto (un informe, una obra paralizada), empatar con ellas no llega al 90.
 *
 * Pares: las entidades del mismo grupo (municipalidad distrital, gobierno regional…) y del mismo tercio de presupuesto
 * dentro del grupo (`banda`); si la entidad no tiene presupuesto en el MEF, o su tercio tiene menos de MIN_PARES
 * entidades, todo el grupo. Son comparaciones estadísticas, no acusaciones.
 */

export const MIN_PARES = 15;
export const PERCENTIL_ALTO = 90;
export const PERCENTIL_BAJO = 10;

// ─── Las filas ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Una fila de entidad_metricas (los numeric llegan como float8) más sus conceptos de gasto. */
export interface FilaMetricas {
  ruc: string;
  nombre: string | null;
  grupo: string;
  banda: number | null;
  departamento: string | null;
  anio_completo: number;
  pim_ref: number | null;
  adj_procesos: number;
  adj_monto: number;
  adj_directas: number;
  adj_con_postores: number;
  adj_unico: number;
  adj_top5_monto: number;
  adj_proveedores: number;
  ord_ordenes: number;
  ord_monto: number;
  ord_monto_personas: number;
  ord_ordenes_completos: number;
  ord_monto_completos: number;
  ord_monto_diciembre: number;
  borde_ordenes: number;
  mef_pim: number | null;
  mef_devengado: number | null;
  mef_pim_actual: number | null;
  mef_devengado_actual: number | null;
  ctl_informes: number;
  ctl_penal: number;
  obras_activas: number;
  obras_paralizadas: number;
  /** Por clave de concepto (categoria_gasto): lo que suman sus órdenes desde 2023. */
  categorias: Record<string, { monto: number; ordenes: number }>;
}

/** Un concepto de gasto de categoria_gasto, ya calculado. */
export interface Categoria {
  clave: string;
  nombre: string;
  /** Las palabras de `consulta` y `excluir` (to_tsquery) como términos para gasto_por_concepto. */
  terminos: string[];
  excluir: string[];
  /**
   * false: gasto normal de operación (telefonía, mantenimiento de vehículos…): se compara con los pares como contexto, pero
   * nunca es hallazgo (categoria_gasto.es_senal, migración 257). Sin el dato, señal (como en la 256).
   */
  senal?: boolean;
}

// ─── Los grupos ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Los grupos de entidad_grupo() (migración 256): nombre en plural, para «sus pares». */
export const GRUPOS: Record<string, string> = {
  municipalidad_distrital: "Municipalidades distritales",
  municipalidad_provincial: "Municipalidades provinciales (con Lima Metropolitana y el Callao)",
  gobierno_regional: "Gobiernos regionales (sede, gerencias subregionales y unidades ejecutoras)",
  nacional: "Ministerios y organismos nacionales",
  salud: "Hospitales, redes y direcciones de salud",
  educacion: "UGEL, direcciones regionales de educación y colegios",
  universidad: "Universidades públicas",
  empresa_publica: "Empresas públicas (FONAFE, EPS y empresas municipales)",
  organismo_municipal: "Organismos municipales (institutos viales, SAT, beneficencias, mancomunidades)",
  otros: "Otras entidades",
};

export const BANDAS: Record<number, string> = { 1: "el tercio de menor presupuesto", 2: "el tercio de presupuesto medio", 3: "el tercio de mayor presupuesto" };

// ─── Las cifras ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type Direccion = "alto" | "bajo";

export interface Profundizar {
  herramienta: string;
  argumentos: Record<string, unknown>;
}

interface Partes {
  /** El valor que se compara (un % o una cantidad). null: la entidad no tiene el dato. */
  valor: number | null;
  numerador: number | null;
  denominador: number | null;
}

export interface DefMetrica {
  clave: string;
  titulo: string;
  unidad: "%" | "S/" | "procesos" | "órdenes" | "informes";
  direccion: Direccion;
  /** false: cifra de contexto (volumen); se compara pero nunca es hallazgo. */
  senal: boolean;
  /** Qué son el numerador y el denominador. */
  base: string;
  partes: (f: FilaMetricas) => Partes;
  /**
   * El piso para que la cifra diga algo: para ser hallazgo y para entrar al ranking (un % sobre muy pocos casos no dice
   * nada). Sin piso: una cifra de volumen (el monto adjudicado, el PIM), que vale con cualquier valor.
   */
  piso?: (f: FilaMetricas) => boolean;
  /** La primera mitad de la frase: qué es, con su valor. */
  que: (x: Partes, f: FilaMetricas) => string;
  profundizar: (ruc: string) => Profundizar;
}

const DESDE = 2023;
const pct = (num: number | null | undefined, den: number | null | undefined): Partes => {
  const n = Number(num ?? 0);
  const d = Number(den ?? 0);
  return { valor: d > 0 ? (100 * n) / d : null, numerador: num == null ? null : n, denominador: den == null ? null : d };
};
const cantidad = (v: number | null | undefined, conDato = true): Partes => ({ valor: conDato && v != null ? Number(v) : null, numerador: v ?? null, denominador: null });

// Formatos (es-PE: 1,234.5).
const miles = (n: number) => Math.round(n).toLocaleString("es-PE");
export const fmtPct = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;
export function fmtSoles(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `S/ ${(v / 1e9).toLocaleString("es-PE", { maximumFractionDigits: 2 })} mil millones`;
  if (a >= 1e6) return `S/ ${(v / 1e6).toLocaleString("es-PE", { maximumFractionDigits: 1 })} millones`;
  return `S/ ${miles(v)}`;
}
export function fmtValor(v: number, unidad: DefMetrica["unidad"]): string {
  if (unidad === "%") return fmtPct(v);
  if (unidad === "S/") return fmtSoles(v);
  return miles(v);
}
const plural = (n: number, uno: string, varios: string) => `${miles(n)} ${n === 1 ? uno : varios}`;

const datos = (fuente: string, medida: string, por: string[], filtros: Record<string, unknown>): Profundizar =>
  ({ herramienta: "consultar_datos", argumentos: { fuente, medida, por, filtros } });

/** Las cifras fijas (las de los conceptos de gasto se arman con `metricaCategoria`). El orden es el de `metricas`. */
export const METRICAS_FIJAS: DefMetrica[] = [
  {
    clave: "monto_adjudicado", titulo: "Monto adjudicado en procesos", unidad: "S/", direccion: "alto", senal: false,
    base: "soles adjudicados en procesos con buena pro desde 2023 (sin los montos que parecen mal cargados)",
    partes: (f) => cantidad(f.adj_monto, f.adj_procesos > 0),
    que: (x, f) => `Desde ${DESDE} adjudicó ${fmtSoles(x.valor!)} en ${plural(f.adj_procesos, "proceso", "procesos")} de selección`,
    profundizar: (ruc) => ({ herramienta: "proveedores_de_entidad", argumentos: { ruc, anio_desde: DESDE } }),
  },
  {
    clave: "procesos", titulo: "Procesos con buena pro", unidad: "procesos", direccion: "alto", senal: false,
    base: "procesos de selección con buena pro convocados desde 2023",
    partes: (f) => cantidad(f.adj_procesos, f.adj_procesos > 0),
    que: (x) => `Desde ${DESDE} tuvo ${plural(x.valor!, "proceso", "procesos")} de selección con buena pro`,
    profundizar: (ruc) => datos("adjudicaciones", "procesos", ["anio"], { entidad: ruc, anio_desde: DESDE }),
  },
  {
    clave: "pct_unico_postor", titulo: "Procesos con un solo postor", unidad: "%", direccion: "alto", senal: true,
    base: "procesos con un solo postor / procesos con postores conocidos (sin las contrataciones directas)",
    partes: (f) => pct(f.adj_unico, f.adj_con_postores),
    piso: (f) => f.adj_con_postores >= 10,
    que: (x) => `En ${fmtPct(x.valor!)} de sus procesos con competencia desde ${DESDE} (${miles(x.numerador!)} de ${miles(x.denominador!)}, sin contar las contrataciones directas) se presentó un solo postor`,
    profundizar: (ruc) => datos("adjudicaciones", "monto_adjudicado", ["proveedor"], { entidad: ruc, unico_postor: "si", directa: "no", anio_desde: DESDE }),
  },
  {
    clave: "pct_directas", titulo: "Contrataciones directas", unidad: "%", direccion: "alto", senal: true,
    base: "procesos por contratación directa / procesos con buena pro",
    partes: (f) => pct(f.adj_directas, f.adj_procesos),
    piso: (f) => f.adj_procesos >= 10,
    que: (x) => `${fmtPct(x.valor!)} de sus procesos desde ${DESDE} fueron contrataciones directas (${miles(x.numerador!)} de ${miles(x.denominador!)})`,
    profundizar: (ruc) => datos("adjudicaciones", "monto_adjudicado", ["proveedor"], { entidad: ruc, directa: "si", anio_desde: DESDE }),
  },
  {
    clave: "pct_top5_proveedores", titulo: "Concentración en 5 proveedores", unidad: "%", direccion: "alto", senal: true,
    base: "lo adjudicado a sus 5 proveedores principales (empresas o consorcios) / todo lo adjudicado",
    partes: (f) => pct(f.adj_top5_monto, f.adj_monto),
    piso: (f) => f.adj_procesos >= 10 && f.adj_proveedores > 5,
    que: (x) => `Sus cinco proveedores principales se llevaron ${fmtPct(x.valor!)} de lo que adjudicó desde ${DESDE} (${fmtSoles(x.numerador!)} de ${fmtSoles(x.denominador!)})`,
    profundizar: (ruc) => ({ herramienta: "proveedores_de_entidad", argumentos: { ruc, anio_desde: DESDE } }),
  },
  {
    clave: "monto_ordenes", titulo: "Monto en órdenes de compra y servicio", unidad: "S/", direccion: "alto", senal: false,
    base: "soles en órdenes de compra y de servicio desde 2023 (sin anuladas ni montos dudosos)",
    partes: (f) => cantidad(f.ord_monto, f.ord_ordenes > 0),
    que: (x, f) => `Desde ${DESDE} emitió ${plural(f.ord_ordenes, "orden", "órdenes")} de compra y de servicio por ${fmtSoles(x.valor!)}`,
    profundizar: (ruc) => datos("ordenes", "monto_ordenes", ["anio"], { entidad: ruc, anio_desde: DESDE }),
  },
  {
    clave: "pct_personas_naturales", titulo: "Órdenes a personas naturales", unidad: "%", direccion: "alto", senal: true,
    base: "monto de órdenes a personas naturales (RUC 10) / monto de todas sus órdenes",
    partes: (f) => pct(f.ord_monto_personas, f.ord_monto),
    piso: (f) => f.ord_ordenes >= 50 && f.ord_monto >= 100_000,
    que: (x) => `${fmtPct(x.valor!)} del monto de sus órdenes desde ${DESDE} fue a personas naturales (${fmtSoles(x.numerador!)} de ${fmtSoles(x.denominador!)}), por lo general locadores de servicios`,
    profundizar: (ruc) => datos("ordenes", "monto_ordenes", ["proveedor"], { entidad: ruc, anio_desde: DESDE }),
  },
  {
    clave: "pct_diciembre", titulo: "Gasto concentrado en diciembre", unidad: "%", direccion: "alto", senal: true,
    base: "monto de órdenes emitidas en diciembre / monto de órdenes de los años completos desde 2023",
    partes: (f) => pct(f.ord_monto_diciembre, f.ord_monto_completos),
    piso: (f) => f.ord_ordenes_completos >= 50 && f.ord_monto_completos >= 100_000,
    que: (x, f) => `${fmtPct(x.valor!)} del monto de sus órdenes de ${DESDE} a ${f.anio_completo} se emitió en diciembre (${fmtSoles(x.numerador!)} de ${fmtSoles(x.denominador!)}; repartido parejo sería 8.3 %)`,
    profundizar: (ruc) => ({ herramienta: "historia", argumentos: { tipo: "entidad", id: ruc } }),
  },
  {
    clave: "pct_borde_tope", titulo: "Órdenes al borde del tope de 8 UIT", unidad: "%", direccion: "alto", senal: true,
    base: "órdenes de proveedores que casi siempre reciben órdenes entre el 95 % y el 100 % de 8 UIT / todas sus órdenes",
    partes: (f) => pct(f.borde_ordenes, f.ord_ordenes),
    piso: (f) => f.borde_ordenes >= 5 && f.ord_ordenes >= 50,
    que: (x) => `${fmtPct(x.valor!)} de sus órdenes desde ${DESDE} (${miles(x.numerador!)} de ${miles(x.denominador!)}) fueron a proveedores que casi siempre reciben órdenes justo debajo del tope de 8 UIT, el monto desde el que la ley pide un proceso de selección`,
    profundizar: (ruc) => ({ herramienta: "ficha_entidad", argumentos: { ruc } }),
  },
  {
    clave: "pim", titulo: "Presupuesto (PIM)", unidad: "S/", direccion: "alto", senal: false,
    base: "presupuesto institucional modificado del último año completo (MEF)",
    partes: (f) => cantidad(f.mef_pim, (f.mef_pim ?? 0) > 0),
    que: (x, f) => `Su presupuesto (PIM) de ${f.anio_completo} fue ${fmtSoles(x.valor!)}`,
    profundizar: (ruc) => datos("presupuesto", "pim", ["anio"], { entidad: ruc }),
  },
  {
    clave: "pct_ejecucion", titulo: "Ejecución del presupuesto (año completo)", unidad: "%", direccion: "bajo", senal: true,
    base: "devengado / PIM del último año completo (MEF)",
    partes: (f) => pct(f.mef_devengado, f.mef_pim),
    piso: (f) => (f.mef_pim ?? 0) >= 1_000_000,
    que: (x, f) => `En ${f.anio_completo} ejecutó (devengó) ${fmtPct(x.valor!)} de su presupuesto (${fmtSoles(x.numerador!)} de ${fmtSoles(x.denominador!)})`,
    profundizar: (ruc) => datos("presupuesto", "pct_ejecucion", ["anio"], { entidad: ruc }),
  },
  {
    clave: "pct_ejecucion_actual", titulo: "Ejecución del presupuesto (año en curso)", unidad: "%", direccion: "bajo", senal: true,
    base: "devengado / PIM del año en curso, al último corte del MEF",
    partes: (f) => pct(f.mef_devengado_actual, f.mef_pim_actual),
    piso: (f) => (f.mef_pim_actual ?? 0) >= 1_000_000,
    que: (x, f) => `En lo que va de ${f.anio_completo + 1} lleva ejecutado ${fmtPct(x.valor!)} de su presupuesto (${fmtSoles(x.numerador!)} de ${fmtSoles(x.denominador!)})`,
    profundizar: (ruc) => ({ herramienta: "gasto_entidad", argumentos: { ruc } }),
  },
  {
    clave: "informes_penal", titulo: "Informes de control con responsabilidad penal", unidad: "informes", direccion: "alto", senal: true,
    base: "informes de la Contraloría emitidos desde 2023 con presunta responsabilidad penal",
    partes: (f) => ({ valor: f.ctl_penal, numerador: f.ctl_penal, denominador: f.ctl_informes }),
    piso: (f) => f.ctl_penal >= 2,
    que: (x) => `Desde ${DESDE} la Contraloría le emitió ${plural(x.valor!, "informe", "informes")} de control con presunta responsabilidad penal (de ${plural(x.denominador!, "informe", "informes")} en total)`,
    profundizar: (ruc) => ({ herramienta: "informes_control", argumentos: { ruc, tipo: "penal" } }),
  },
  {
    clave: "pct_obras_paralizadas", titulo: "Obras paralizadas", unidad: "%", direccion: "alto", senal: true,
    base: "obras paralizadas hoy / obras en ejecución o paralizadas (INFOBRAS)",
    partes: (f) => pct(f.obras_paralizadas, f.obras_activas),
    piso: (f) => f.obras_activas >= 5 && f.obras_paralizadas >= 2,
    que: (x) => `${miles(x.numerador!)} de sus ${miles(x.denominador!)} obras en ejecución figuran paralizadas en INFOBRAS (${fmtPct(x.valor!)})`,
    profundizar: (ruc) => ({ herramienta: "obras_entidad", argumentos: { ruc, estado: "paralizada" } }),
  },
];

/** La cifra de un concepto de gasto: qué parte del monto de sus órdenes fue a ese concepto. */
export function metricaCategoria(c: Categoria): DefMetrica {
  return {
    clave: `gasto_${c.clave}`, titulo: `Gasto en ${c.nombre.charAt(0).toLowerCase()}${c.nombre.slice(1)}`, unidad: "%", direccion: "alto",
    // Un gasto normal de operación (es_senal = false) se compara igual, pero como contexto: nunca es hallazgo.
    senal: c.senal !== false,
    base: `monto de órdenes cuya descripción es de «${c.nombre}» / monto de todas sus órdenes, desde 2023`,
    partes: (f) => {
      const x = f.categorias[c.clave];
      // Más que el total: el concepto (refrescar_gasto_categoria) y el total (entidad_orden_mes) salieron de cortes
      // distintos (un año de entidad_orden_mes sin refrescar, una orden que cambió): ese % no es comparable.
      if (f.ord_monto > 0 && (x?.monto ?? 0) > f.ord_monto) return { valor: null, numerador: x!.monto, denominador: f.ord_monto };
      return f.ord_monto > 0 ? pct(x?.monto ?? 0, f.ord_monto) : { valor: null, numerador: x?.monto ?? null, denominador: null };
    },
    piso: (f) => (f.categorias[c.clave]?.monto ?? 0) >= 50_000 && f.ord_ordenes >= 50 && f.ord_monto > 0 && (100 * (f.categorias[c.clave]?.monto ?? 0)) / f.ord_monto >= 1,
    que: (x, f) => {
      const n = f.categorias[c.clave]?.ordenes ?? 0;
      return `${fmtSoles(x.numerador ?? 0)} de sus órdenes desde ${DESDE} (${fmtPct(x.valor!)} del total, ${plural(n, "orden", "órdenes")}) fueron de ${c.nombre.charAt(0).toLowerCase()}${c.nombre.slice(1)}, según la descripción de cada orden`;
    },
    profundizar: (ruc) => ({
      herramienta: "gasto_por_concepto",
      argumentos: { entidad_ruc: ruc, terminos: c.terminos.slice(0, 20), excluir: c.excluir.slice(0, 15), desde: DESDE, fuentes: ["ordenes"] },
    }),
  };
}

/** «a | b | (c & d & !x) | (e & (f | g))» → ["a", "b", "c d", "e f", "e g"]: los términos de una consulta de to_tsquery. */
export function terminosDe(consulta: string | null | undefined): string[] {
  if (!consulta) return [];
  const out: string[] = [];
  // Separa por «|» del primer nivel; dentro de un grupo con &, combina (como mucho dos niveles: basta para la tabla).
  const partir = (s: string, sep: string) => {
    const partes: string[] = [];
    let nivel = 0;
    let actual = "";
    for (const ch of s) {
      if (ch === "(") nivel++;
      if (ch === ")") nivel--;
      if (ch === sep && nivel === 0) { partes.push(actual); actual = ""; } else actual += ch;
    }
    partes.push(actual);
    return partes.map((p) => p.trim()).filter(Boolean);
  };
  // El paréntesis que abre en la primera letra, ¿cierra en la última? «(a | b) & (c | d)» empieza y termina con
  // paréntesis, pero no está envuelto.
  const envuelto = (t: string) => {
    let nivel = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") nivel++;
      else if (t[i] === ")" && --nivel === 0) return i === t.length - 1;
    }
    return false;
  };
  const sinParentesis = (s: string) => {
    let t = s.trim();
    while (t.startsWith("(") && envuelto(t)) t = t.slice(1, -1).trim();
    return t;
  };
  const expandir = (s: string): string[] => {
    const t = sinParentesis(s);
    const o = partir(t, "|");
    if (o.length > 1) return o.flatMap(expandir);
    // Lo negado («!combustible») no es un término: es lo que saca. «(viatico & !(responsable | auxiliar))» → «viatico».
    const y = partir(t, "&").filter((p) => !p.startsWith("!"));
    if (y.length > 1) {
      return y.map(expandir).reduce<string[]>((acc, xs) => (acc.length ? acc.flatMap((a) => xs.map((x) => `${a} ${x}`)) : xs), []);
    }
    if (!y.length) return [];
    if (y[0] !== t) return expandir(y[0]);
    return [t.replace(/[^a-z0-9ñ ]/gi, " ").replace(/\s+/g, " ").trim()].filter(Boolean);
  };
  for (const t of expandir(consulta)) if (!out.includes(t)) out.push(t);
  return out;
}

/** Todas las cifras, las fijas y una por concepto (en el orden de `categorias`). */
export const definiciones = (categorias: Categoria[]): DefMetrica[] => [...METRICAS_FIJAS, ...categorias.map(metricaCategoria)];

// ─── Estadística ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cuantil `q` (0 a 1) de una lista YA ORDENADA, con interpolación lineal (el tipo 7 de R, el de percentile_cont). */
export function cuantil(ordenados: number[], q: number): number | null {
  if (!ordenados.length) return null;
  const h = (ordenados.length - 1) * q;
  const i = Math.floor(h);
  const j = Math.min(i + 1, ordenados.length - 1);
  return ordenados[i] + (h - i) * (ordenados[j] - ordenados[i]);
}

/** Percentil de `v` entre `valores` (rango medio: los menores más la mitad de los iguales), de 0 a 100. */
export function percentilDe(v: number, valores: number[]): number | null {
  if (!valores.length) return null;
  let menores = 0;
  let iguales = 0;
  for (const x of valores) {
    if (x < v) menores++;
    else if (x === v) iguales++;
  }
  return (100 * (menores + iguales / 2)) / valores.length;
}

// ─── Pares ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Pares {
  pares: FilaMetricas[];
  /** true: mismo grupo y mismo tercio de presupuesto; false: todo el grupo. */
  porBanda: boolean;
}

/** Los pares de `e` (sin ella misma): su grupo y su tercio de presupuesto si alcanza; si no, todo su grupo. */
export function paresDe(e: FilaMetricas, todas: FilaMetricas[]): Pares {
  const grupo = todas.filter((x) => x.grupo === e.grupo && x.ruc !== e.ruc);
  if (e.banda != null) {
    const banda = grupo.filter((x) => x.banda === e.banda);
    if (banda.length >= MIN_PARES) return { pares: banda, porBanda: true };
  }
  return { pares: grupo, porBanda: false };
}

// ─── La evaluación ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface MetricaEvaluada {
  clave: string;
  titulo: string;
  valor: number | null;
  unidad: DefMetrica["unidad"];
  mediana_pares: number | null;
  p90_pares: number | null;
  p10_pares: number | null;
  /** 0 a 100, entre sus pares con el dato. */
  percentil: number | null;
  veces_mediana: number | null;
  direccion: Direccion;
  hallazgo: boolean;
  /** Señal o contexto (las de contexto nunca son hallazgo). */
  tipo: "senal" | "contexto";
  pares_con_dato: number;
  numerador: number | null;
  denominador: number | null;
  base: string;
  explicacion: string;
  profundizar: Profundizar;
}

const redondear = (v: number | null, unidad: DefMetrica["unidad"]) =>
  v == null ? null : unidad === "%" ? Math.round(v * 10) / 10 : Math.round(v);

/** La frase: qué es (con su valor) y cómo queda frente a sus pares. Una sola oración, sin acusar. */
function explicar(d: DefMetrica, x: Partes, f: FilaMetricas, mediana: number | null, percentil: number | null, n: number): string {
  if (x.valor == null) return `${d.titulo}: sin datos para esta entidad.`;
  const que = d.que(x, f);
  if (mediana == null || percentil == null || n < 5) return `${que}; no hay suficientes pares con el dato para compararla.`;
  const p = Math.round(percentil);
  const donde = d.direccion === "bajo"
    ? (p <= 50 ? `está por debajo del ${100 - p} % de ellos` : `está por encima del ${p} % de ellos`)
    : (p >= 50 ? `está por encima del ${p} % de ellos` : `está por debajo del ${100 - p} % de ellos`);
  return `${que}; la mediana de sus ${miles(n)} pares es ${fmtValor(mediana, d.unidad)}: ${donde}.`;
}

/** Cada cifra de `e` frente a `pares` (sin `e`). Pura: la usan la ruta y las pruebas. */
export function evaluar(e: FilaMetricas, pares: FilaMetricas[], defs: DefMetrica[]): MetricaEvaluada[] {
  return defs.map((d) => {
    const x = d.partes(e);
    const valores = pares.map((p) => d.partes(p).valor).filter((v): v is number => v != null && Number.isFinite(v));
    const ordenados = [...valores].sort((a, b) => a - b);
    const n = ordenados.length;
    const mediana = cuantil(ordenados, 0.5);
    const p90 = cuantil(ordenados, 0.9);
    const p10 = cuantil(ordenados, 0.1);
    const percentil = x.valor == null ? null : percentilDe(x.valor, ordenados);
    const extremo = percentil != null && mediana != null && x.valor != null &&
      (d.direccion === "alto" ? percentil >= PERCENTIL_ALTO && x.valor > mediana : percentil <= PERCENTIL_BAJO && x.valor < mediana);
    const hallazgo = d.senal && x.valor != null && n >= MIN_PARES && (d.piso?.(e) ?? true) && extremo;
    return {
      clave: d.clave,
      titulo: d.titulo,
      valor: redondear(x.valor, d.unidad),
      unidad: d.unidad,
      mediana_pares: redondear(mediana, d.unidad),
      p90_pares: redondear(p90, d.unidad),
      p10_pares: redondear(p10, d.unidad),
      percentil: percentil == null ? null : Math.round(percentil * 10) / 10,
      veces_mediana: x.valor != null && mediana != null && mediana > 0 ? Math.round((100 * x.valor) / mediana) / 100 : null,
      direccion: d.direccion,
      hallazgo,
      tipo: d.senal ? "senal" : "contexto",
      pares_con_dato: n,
      numerador: x.numerador == null ? null : Math.round(x.numerador * 100) / 100,
      denominador: x.denominador == null ? null : Math.round(x.denominador * 100) / 100,
      base: d.base,
      explicacion: explicar(d, x, e, mediana, percentil, n),
      profundizar: d.profundizar(e.ruc),
    };
  });
}

/** Qué tan extrema es una cifra: la distancia del percentil al lado que preocupa, y después cuántas veces la mediana. */
const extremidad = (m: MetricaEvaluada) => (m.direccion === "alto" ? (m.percentil ?? 0) : 100 - (m.percentil ?? 100));
const razon = (m: MetricaEvaluada) => {
  if (m.veces_mediana == null) return Number.POSITIVE_INFINITY; // mediana en cero: cualquier valor es «infinitas veces»
  return m.direccion === "alto" ? m.veces_mediana : m.veces_mediana > 0 ? 1 / m.veces_mediana : Number.POSITIVE_INFINITY;
};

/** Los hallazgos, del más extremo al menos. */
export function seleccionarHallazgos(metricas: MetricaEvaluada[]): MetricaEvaluada[] {
  return metricas.filter((m) => m.hallazgo).sort((a, b) => extremidad(b) - extremidad(a) || razon(b) - razon(a) || a.clave.localeCompare(b.clave));
}

// ─── El ranking ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class ErrorHallazgos extends Error {
  constructor(readonly detail: string, readonly opciones?: string[]) {
    super(detail);
  }
}

export const LIMITE_RANKING_MAX = 100;
export const LIMITE_RANKING_DEFECTO = 20;

export interface PedidoRanking {
  metrica: DefMetrica;
  grupo: string;
  /** Departamento en mayúsculas sin tildes (como entidad_metricas.departamento). */
  region: string | null;
  banda: number | null;
  orden: "desc" | "asc";
  limite: number;
}

/**
 * Valida ?metrica=&grupo=&region=&banda=&orden=&limite= contra las listas cerradas. `region` llega ya resuelta (o null
 * si no se pidió); `regionInvalida` es el texto pedido que no es un departamento.
 */
export function validarRanking(
  q: Record<string, string | undefined>, defs: DefMetrica[], region: { mayus: string } | null, regionInvalida = false,
): PedidoRanking {
  const claves = defs.map((d) => d.clave);
  const m = (q.metrica ?? "").trim();
  if (!m) throw new ErrorHallazgos(`Falta metrica. Usa: ${claves.join(", ")}.`, claves);
  const metrica = defs.find((d) => d.clave === m);
  if (!metrica) throw new ErrorHallazgos(`metrica «${m.slice(0, 40)}» no existe. Usa: ${claves.join(", ")}.`, claves);
  const grupos = Object.keys(GRUPOS);
  const g = (q.grupo ?? "").trim();
  if (!g) throw new ErrorHallazgos(`Falta grupo. Usa: ${grupos.join(", ")}.`, grupos);
  if (!Object.hasOwn(GRUPOS, g)) throw new ErrorHallazgos(`grupo «${g.slice(0, 40)}» no existe. Usa: ${grupos.join(", ")}.`, grupos);
  if (regionInvalida) throw new ErrorHallazgos(`region: «${(q.region ?? "").slice(0, 40)}» no es un departamento (Cusco, Junín, Callao…).`);
  const b = (q.banda ?? "").trim();
  if (b && !/^[123]$/.test(b)) throw new ErrorHallazgos("banda: 1 (tercio de menor presupuesto), 2 o 3 (mayor).", ["1", "2", "3"]);
  const o = (q.orden ?? "").trim().toLowerCase();
  if (o && o !== "desc" && o !== "asc") throw new ErrorHallazgos("orden: desc (de mayor a menor) o asc.", ["desc", "asc"]);
  const l = (q.limite ?? String(LIMITE_RANKING_DEFECTO)).trim();
  const limite = Number(l);
  if (!/^\d{1,3}$/.test(l) || limite < 1 || limite > LIMITE_RANKING_MAX) throw new ErrorHallazgos(`limite: un entero de 1 a ${LIMITE_RANKING_MAX}.`);
  return {
    metrica, grupo: g, region: region?.mayus ?? null, banda: b ? Number(b) : null,
    orden: (o || (metrica.direccion === "bajo" ? "asc" : "desc")) as "desc" | "asc", limite,
  };
}

export interface FilaRanking {
  ruc: string;
  nombre: string | null;
  departamento: string | null;
  banda: number | null;
  valor: number;
  percentil: number | null;
  veces_mediana: number | null;
  numerador: number | null;
  denominador: number | null;
  cumple_piso: boolean;
}

/**
 * Las entidades del grupo (y del tercio, si se pidió) ordenadas por la cifra, con su percentil dentro de ese conjunto;
 * `region` sólo filtra la lista (el percentil y la mediana son contra todo el grupo). Las que no cumplen el piso de la
 * cifra no entran (un 100 % sobre dos órdenes no encabeza nada), tampoco en un concepto de gasto de contexto; las cifras de
 * volumen no tienen piso.
 */
export function ranking(todas: FilaMetricas[], p: PedidoRanking): { filas: FilaRanking[]; total: number; mediana: number | null; con_dato: number } {
  const conjunto = todas.filter((f) => f.grupo === p.grupo && (p.banda == null || f.banda === p.banda));
  const conValor = conjunto.map((f) => ({ f, x: p.metrica.partes(f) })).filter((r): r is { f: FilaMetricas; x: Partes & { valor: number } } => r.x.valor != null && Number.isFinite(r.x.valor));
  const ordenados = conValor.map((r) => r.x.valor).sort((a, b) => a - b);
  const mediana = cuantil(ordenados, 0.5);
  const candidatas = conValor
    .filter((r) => p.region == null || r.f.departamento === p.region)
    .filter((r) => !p.metrica.piso || p.metrica.piso(r.f));
  candidatas.sort((a, b) => (p.orden === "desc" ? b.x.valor - a.x.valor : a.x.valor - b.x.valor) || a.f.ruc.localeCompare(b.f.ruc));
  const filas = candidatas.slice(0, p.limite).map(({ f, x }) => {
    const pc = percentilDe(x.valor, ordenados);
    return {
      ruc: f.ruc, nombre: f.nombre, departamento: f.departamento, banda: f.banda,
      valor: redondear(x.valor, p.metrica.unidad)!,
      percentil: pc == null ? null : Math.round(pc * 10) / 10,
      veces_mediana: mediana != null && mediana > 0 ? Math.round((100 * x.valor) / mediana) / 100 : null,
      numerador: x.numerador == null ? null : Math.round(x.numerador * 100) / 100,
      denominador: x.denominador == null ? null : Math.round(x.denominador * 100) / 100,
      cumple_piso: p.metrica.piso ? p.metrica.piso(f) : true,
    };
  });
  return { filas, total: candidatas.length, mediana: redondear(mediana, p.metrica.unidad), con_dato: ordenados.length };
}
