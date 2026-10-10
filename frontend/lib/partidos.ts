/**
 * Quién gobierna dónde: las autoridades electas en las Elecciones Regionales y Municipales 2022
 * (mandato 2023 a 2026), de la Plataforma Electoral del JNE (Infogob). El archivo lo genera
 * `backend/scripts/generar_autoridades_2022.py` a `public/data/autoridades-2022.json`.
 *
 * Reglas del módulo:
 *  - Sólo lo que dice la fuente. Lo que el archivo no trae se dice (`faltan`), no se rellena.
 *  - Se cuenta quién ganó, nunca qué hizo: esto no acusa a nadie ni compara honestidad.
 *  - Los colores de cada organización son nuestros y se asignan por tamaño; no imitan los
 *    colores de ningún partido (ninguno se lee como "el color de" alguien).
 */

export type TipoOrg = "partido" | "movimiento" | "alianza" | "otro";

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

let enVuelo: Promise<AutoridadesDatos | null> | null = null;

/** Descarga el archivo una sola vez por carga de página (lo pide quien lo necesite). */
export function cargarAutoridades(): Promise<AutoridadesDatos | null> {
  enVuelo ??= fetch("/data/autoridades-2022.json")
    .then((r) => (r.ok ? (r.json() as Promise<AutoridadesDatos>) : null))
    .catch(() => null)
    .then((d) => {
      if (!d) enVuelo = null; // si falló, el próximo intento vuelve a pedirlo
      return d;
    });
  return enVuelo;
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
 * Colores de las organizaciones más grandes del nivel mirado; el resto, un gris. Se asignan por
 * orden de tamaño y no por partido, a propósito.
 */
export const PALETA_ORG = ["#D4FF3F", "#FF6B5B", "#6C8CFF", "#FFB020", "#3DDC97", "#E7F0EE", "#C08CFF", "#FF8FA3", "#4FD1C5", "#F6AD55", "#9F9CFF", "#B5E04A"] as const;
export const COLOR_OTRAS = "#566663";

/** Colores para un conjunto de gobiernos: las organizaciones con más puestos en ESE conjunto, en orden. */
export function coloresDeFilas(filas: { o: number }[]): Map<number, string> {
  const n = new Map<number, number>();
  for (const f of filas) n.set(f.o, (n.get(f.o) ?? 0) + 1);
  const orden = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const out = new Map<number, string>();
  orden.forEach(([o], i) => out.set(o, i < PALETA_ORG.length ? PALETA_ORG[i] : COLOR_OTRAS));
  return out;
}

export function coloresPorOrg(d: AutoridadesDatos, nivel: Nivel): Map<number, string> {
  return coloresDeFilas(nivel === "regional" ? d.regional : nivel === "provincial" ? d.provincial : d.distrital);
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
