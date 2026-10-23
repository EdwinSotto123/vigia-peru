import type { Modo } from "./modo";
/**
 * Quién gobierna dónde: las autoridades electas en las Elecciones Regionales y Municipales de
 * 2014, 2018 y 2022, de la Plataforma Electoral del JNE (Infogob). Los archivos
 * `public/data/autoridades-<año>.json` los genera `backend/scripts/generar_autoridades.py`.
 * Las elecciones de 2026 se suman cuando el JNE proclame los resultados.
 *
 * Reglas del módulo:
 *  - Sólo lo que dice la fuente. Lo que el archivo no trae se dice (`faltan`), no se rellena.
 *  - Se cuenta quién ganó, nunca qué hizo: esto no acusa a nadie ni compara honestidad.
 *  - Los colores de cada organización son nuestros y se asignan por tamaño; no imitan los
 *    colores de ningún partido (ninguno se lee como "el color de" alguien).
 */

export type TipoOrg = "partido" | "movimiento" | "alianza" | "otro";

/**
 * Cuánto de lo que se contrata ya lo leyó Vigía, para decir QUÉ TANTO se vigila cada lugar y cuánto
 * falta. Sale de `/contratos/geo` y del resumen de contratos (la API), nunca de una estimación: es
 * el mismo conteo que usa el mapa de contratos. La zona es la sede de la entidad que contrata.
 */
export interface Cobertura {
  /** Contratos publicados que Vigía tiene en su base. */
  publicados: number;
  /** Los que ya se leyeron a fondo. */
  leidos: number;
  /** Los que faltan por leer (publicados − leídos). */
  faltan: number;
  /** De los que faltan, los que ya pueden financiarse hoy. */
  enColaHoy: number;
  /** Precio de leer un contrato, en soles. */
  precioPen: number | null;
  regionesConLectura: number;
  regionesTotal: number;
  /** Por departamento (ubigeo de 2 dígitos). */
  porRegion: Record<string, { total: number; leidos: number; enCola: number; monto: number; conSenales: number }>;
}

export interface Org {
  /** Nombre como lo escribe el JNE, con las tildes repuestas de una lista corta. */
  n: string;
  t: TipoOrg;
}

export interface Gobernador {
  /** Ubigeo de departamento (2 dígitos). */
  u: string;
  /** Nombre de quien gobierna. */
  g: string;
  /** Índice en `orgs`. */
  o: number;
  /** Fracción de votos de la organización (0 a 1), si la fuente la trae. */
  p: number | null;
  /** Fuente propia, si no es el archivo del JNE (segunda vuelta regional 2022). */
  s?: string;
}

export interface AlcaldeProvincial {
  /** Ubigeo de provincia (4 dígitos). */
  u: string;
  n: string;
  a: string;
  o: number;
  p: number | null;
}

export interface AlcaldeDistrital {
  /** Ubigeo de la provincia a la que pertenece (4 dígitos). */
  u: string;
  /** Distrito. */
  n: string;
  /** Provincia. */
  pv: string;
  a: string;
  o: number;
  p: number | null;
}

export interface AutoridadesDatos {
  anio?: number;
  fuente: string;
  generado: string;
  orgs: Org[];
  regional: Gobernador[];
  provincial: AlcaldeProvincial[];
  distrital: AlcaldeDistrital[];
  faltan: { regional: string[] };
}

export type Nivel = "regional" | "provincial" | "distrital";

export const NIVEL_LABEL: Record<Nivel, { plural: string; singular: string; cargo: string }> = {
  regional: { plural: "regiones", singular: "región", cargo: "Gobernador o gobernadora regional" },
  provincial: { plural: "provincias", singular: "provincia", cargo: "Alcalde o alcaldesa provincial" },
  distrital: { plural: "distritos", singular: "distrito", cargo: "Alcalde o alcaldesa distrital" },
};

export const TIPO_ORG_LABEL: Record<TipoOrg, string> = {
  partido: "Partido político",
  movimiento: "Movimiento regional",
  alianza: "Alianza electoral",
  otro: "Organización política",
};

/** Los períodos con resultados cargados, y el que falta. */
export type Anio = 2014 | 2018 | 2022;

export interface Periodo {
  anio: number;
  /** Años del mandato, en palabras. */
  mandato: string;
  /** `false`: todavía no hay resultados cargados (elecciones de 2026). */
  cargado: boolean;
}

export const PERIODOS: Periodo[] = [
  { anio: 2014, mandato: "2015 a 2018", cargado: true },
  { anio: 2018, mandato: "2019 a 2022", cargado: true },
  { anio: 2022, mandato: "2023 a 2026", cargado: true },
  { anio: 2026, mandato: "2027 a 2030", cargado: false },
];

export const ANIO_ACTUAL: Anio = 2022;

/** El cargo regional se llamaba "presidente regional" hasta 2014. */
export const cargoRegional = (anio: number) => (anio <= 2014 ? "Presidente o presidenta regional" : "Gobernador o gobernadora regional");

const enVuelo = new Map<number, Promise<AutoridadesDatos | null>>();

/** Descarga el archivo de un año una sola vez por carga de página (lo pide quien lo necesite). */
export function cargarAutoridades(anio: Anio = ANIO_ACTUAL): Promise<AutoridadesDatos | null> {
  let p = enVuelo.get(anio);
  if (!p) {
    p = fetch(`/data/autoridades-${anio}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<AutoridadesDatos>) : null))
      .catch(() => null)
      .then((d) => {
        if (!d) enVuelo.delete(anio); // si falló, el próximo intento vuelve a pedirlo
        return d;
      });
    enVuelo.set(anio, p);
  }
  return p;
}

/** Lo que ganó un lugar en un período: la organización y quién la encabezó. */
export interface Gano {
  org: Org;
  persona: string;
  p: number | null;
}

export function ganoRegion(d: AutoridadesDatos | undefined, u: string): Gano | null {
  const g = d?.regional.find((x) => x.u === u);
  return g && d ? { org: orgDe(d, g.o), persona: g.g, p: g.p } : null;
}

export function ganoProvincia(d: AutoridadesDatos | undefined, u: string): Gano | null {
  const g = d?.provincial.find((x) => x.u === u);
  return g && d ? { org: orgDe(d, g.o), persona: g.a, p: g.p } : null;
}

/** El distrito se busca por (provincia, distrito) sin tildes: los códigos de ubigeo no viajan en los archivos. */
export function ganoDistrito(d: AutoridadesDatos | undefined, provincia: string, distrito: string): Gano | null {
  if (!d) return null;
  const kp = normalizar(provincia);
  const kd = normalizar(distrito);
  const g = d.distrital.find((x) => normalizar(x.pv) === kp && normalizar(x.n) === kd);
  return g ? { org: orgDe(d, g.o), persona: g.a, p: g.p } : null;
}

/** Cuántos gobiernos tiene cada organización, por nivel. */
export interface Conteo {
  org: number;
  regional: number;
  provincial: number;
  distrital: number;
  total: number;
}

export function conteos(d: AutoridadesDatos): Conteo[] {
  const m = new Map<number, Conteo>();
  const tomar = (o: number): Conteo => {
    let c = m.get(o);
    if (!c) m.set(o, (c = { org: o, regional: 0, provincial: 0, distrital: 0, total: 0 }));
    return c;
  };
  for (const g of d.regional) tomar(g.o).regional++;
  for (const g of d.provincial) tomar(g.o).provincial++;
  for (const g of d.distrital) tomar(g.o).distrital++;
  for (const c of m.values()) c.total = c.regional + c.provincial + c.distrital;
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/**
 * Colores de las 8 organizaciones más grandes del nivel mirado; desde la 9.ª, «Otras» en gris. Se asignan por orden de
 * tamaño y no por partido, a propósito. Una paleta por modo (lib/modo.ts), validada con el validador de paletas
 * (2026-10-22): los pares vecinos se distinguen con daltonismo (ΔE 8,4 o más), ninguno es gris y de noche todos dan
 * 3:1 o más sobre el carbón. De día tres (aqua, amarillo, rosa) quedan bajo 3:1 sobre blanco: por eso el color nunca va
 * solo, siempre con el nombre al lado (leyenda, pastilla, tabla). La anterior (12 colores) confundía los dos más
 * grandes, verde y rojo, con deuteranopía (ΔE 3) y tenía un gris entre los colores.
 */
export const PALETA_ORG = ["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181", "#008300", "#9085E9", "#E66767"] as const;
export const PALETA_ORG_DIA = ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#E87BA4", "#008300", "#6250D6", "#E34948"] as const;
export const COLOR_OTRAS = "#566663";
export const COLOR_OTRAS_DIA = "#A3AFAD";

/** Los colores de las organizaciones para el modo de color de la página. */
export function paletaOrg(modo: Modo): { colores: readonly string[]; otras: string } {
  return modo === "dia" ? { colores: PALETA_ORG_DIA, otras: COLOR_OTRAS_DIA } : { colores: PALETA_ORG, otras: COLOR_OTRAS };
}

/** Colores para un conjunto de gobiernos: las organizaciones con más puestos en ESE conjunto, en orden. */
export function coloresDeFilas(filas: { o: number }[], modo: Modo = "noche"): Map<number, string> {
  const { colores, otras } = paletaOrg(modo);
  const n = new Map<number, number>();
  for (const f of filas) n.set(f.o, (n.get(f.o) ?? 0) + 1);
  const orden = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const out = new Map<number, string>();
  orden.forEach(([o], i) => out.set(o, i < colores.length ? colores[i] : otras));
  return out;
}

export function coloresPorOrg(d: AutoridadesDatos, nivel: Nivel, modo: Modo = "noche"): Map<number, string> {
  return coloresDeFilas(nivel === "regional" ? d.regional : nivel === "provincial" ? d.provincial : d.distrital, modo);
}

export const pct = (p: number | null | undefined) => (p == null ? null : `${(p * 100).toFixed(1).replace(".", ",")} %`);

/** Sin tildes, mayúsculas y sólo letras y cifras: la forma de comparar nombres de lugares. */
export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** Nombre y tipo de una organización, listo para mostrar. */
export const orgDe = (d: AutoridadesDatos, i: number): Org => d.orgs[i] ?? { n: "Sin dato", t: "otro" };

/**
 * La clave estable de una organización, la MISMA que `clave_org` de backend/scripts/cargar_gobiernos.py
 * (sin tildes, en minúsculas, palabras unidas con guiones, 80 caracteres): es la que usan la API de partidos
 * y la ficha /app/partidos/<clave>.
 */
export const claveOrg = (nombre: string) =>
  nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
