/**
 * Precios de combustibles de Osinergmin (fuente oficial y abierta): el reporte diario del Registro de Precios de
 * Distribuidores Minoristas (SCOP), `CL-Registro-precios-DMIN.csv`, en UTF-8 y separado por `;`. Cada fila es
 * un precio declarado por un distribuidor: departamento, producto, fecha de registro, precio mínimo y máximo por
 * galón. El cron lo baja una vez al día y guarda las filas normalizadas; las estadísticas se calculan al consultar.
 */

export const URL_DMIN =
  "https://www.osinergmin.gob.pe/seccion/centro_documental/hidrocarburos/SCOP/SCOP-DOCS/Reporte-Diario/CL-Registro-precios-DMIN.csv";

export interface FilaCombustible {
  fecha: string; // YYYY-MM-DD
  departamento: string;
  producto: string; // canónico (productoCanonico)
  producto_original: string;
  ruc: string | null;
  razon_social: string | null;
  precio_min: number | null;
  precio_max: number | null;
  unidad: string | null;
}

/** Bytes del reporte → texto. Es UTF-8 (verificado 2026-10-17: "PETRÓLEO" llega como C3 93); si algún día
 * llegara en latin-1, los bytes inválidos se reemplazan y los nombres con tilde se ven en `producto_original`. */
export function decodificar(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Nombres de producto del registro → un id estable. null = producto que no se usa como referencia. */
export function productoCanonico(p: string): string | null {
  const t = sinTildes(p || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (/DIESEL B5 S-?50/.test(t)) return "diesel_b5_s50";
  if (/DIESEL B5/.test(t)) return "diesel_b5";
  if (/DIESEL 2|DIESEL B2/.test(t)) return "diesel_2";
  if (/GASOHOL.*PREMIUM|GASOLINA.*PREMIUM|GASOHOL 9[5-8]/.test(t)) return "gasohol_premium";
  if (/GASOHOL.*REGULAR|GASOLINA.*REGULAR|GASOHOL 9[0-4]/.test(t)) return "gasohol_regular";
  if (/\bGLP\b|GAS LICUADO/.test(t)) return "glp";
  if (/PETROLEO INDUSTRIAL/.test(t)) return "petroleo_industrial";
  return null;
}

/** Producto pedido en lenguaje libre ("diésel B5 S-50", "gasohol 90") → id canónico. */
export function productoDeConsulta(q: string): string | null {
  const t = sinTildes(q || "").toUpperCase();
  if (/DIESEL|PETROLEO D/.test(t)) return /S-?50/.test(t) || !/B2|DIESEL 2/.test(t) ? "diesel_b5_s50" : "diesel_2";
  return productoCanonico(t);
}

function numero(s: string | undefined): number | null {
  const v = Number(String(s ?? "").trim().replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** "2026/10/13 12:02:05.000" → "2026-10-13". */
function fechaIso(s: string): string | null {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})/.exec((s || "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** CSV del reporte → filas de productos de referencia. Las columnas se ubican por nombre (sin tildes ni basura de
 * codificación), no por posición. */
export function parsearDmin(texto: string): FilaCombustible[] {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const cab = lineas[0].split(";").map((c) => sinTildes(c).toUpperCase().replace(/[^A-Z_]/g, ""));
  const col = (nombre: string) => cab.findIndex((c) => c === nombre || c.startsWith(nombre));
  const i = {
    fecha: col("FECHA_DE_REGISTRO"), depto: col("DEPARTAMENTO"), prod: col("PRODUCTO"), min: col("PRECIO_MIN"),
    max: col("PRECIO_MAX"), unidad: col("UNIDAD"), ruc: col("RUC"), razon: col("RAZ"),
  };
  if (i.fecha < 0 || i.depto < 0 || i.prod < 0 || i.min < 0) return [];
  const out: FilaCombustible[] = [];
  for (const l of lineas.slice(1)) {
    const c = l.split(";").map((x) => x.trim());
    const producto = productoCanonico(c[i.prod] ?? "");
    const fecha = fechaIso(c[i.fecha] ?? "");
    if (!producto || !fecha) continue;
    const pmin = numero(c[i.min]);
    const pmax = i.max >= 0 ? numero(c[i.max]) : null;
    if (pmin === null && pmax === null) continue;
    out.push({
      fecha,
      departamento: sinTildes(c[i.depto] ?? "").toUpperCase(),
      producto,
      producto_original: c[i.prod] ?? "",
      ruc: i.ruc >= 0 && /^\d{11}$/.test(c[i.ruc] ?? "") ? c[i.ruc] : null,
      razon_social: i.razon >= 0 ? (c[i.razon] || null) : null,
      precio_min: pmin,
      precio_max: pmax,
      unidad: i.unidad >= 0 ? (c[i.unidad] || null) : null,
    });
  }
  return out;
}

export function percentil(vals: number[], p: number): number | null {
  const v = vals.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = (v.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, v.length - 1);
  return Math.round((v[lo] + (v[hi] - v[lo]) * (k - lo)) * 100) / 100;
}

export interface Estadistica {
  n: number;
  p25: number | null;
  mediana: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  desde: string | null;
  hasta: string | null;
}

/** Estadística del precio (punto medio entre mínimo y máximo declarado; si falta uno, el otro). */
export function estadistica(filas: Pick<FilaCombustible, "precio_min" | "precio_max" | "fecha">[]): Estadistica {
  const vals = filas
    .map((f) => (f.precio_min !== null && f.precio_max !== null ? (f.precio_min + f.precio_max) / 2 : (f.precio_min ?? f.precio_max)))
    .filter((x): x is number => x !== null);
  const fechas = filas.map((f) => f.fecha).sort();
  return {
    n: vals.length,
    p25: percentil(vals, 0.25),
    mediana: percentil(vals, 0.5),
    p75: percentil(vals, 0.75),
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    desde: fechas[0] ?? null,
    hasta: fechas[fechas.length - 1] ?? null,
  };
}
