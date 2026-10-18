/**
 * Gran Mercado Mayorista de Lima (EMMSA): precios diarios por kilo (mínimo, máximo y promedio) de ~110 variedades de
 * hortalizas, tubérculos y frutas. Es lo que muestra https://www.emmsa.com.pe/index.php/precios-diarios/: esa página
 * incrusta un reporte (`URL_FORMULARIO`) que pide la tabla a `URL_DATOS` por POST con la fecha y los códigos de
 * producto y variedad que lista el propio formulario. Responde también fechas pasadas (se puede cargar historial).
 * Solo por https; el servidor no envía su certificado intermedio (curl/Windows lo completan; algunos clientes no).
 */

export const URL_FORMULARIO = "https://old.emmsa.com.pe/emmsa_spv/rpEstadistica/rpt_precios-diarios-web.php";
export const URL_DATOS = "https://old.emmsa.com.pe/emmsa_spv/app/reportes/ajax/rpt07_gettable_new_web.php";
export const URL_PUBLICA = "https://www.emmsa.com.pe/index.php/precios-diarios/";

export interface Codigos {
  productos: string[];
  variedades: string[];
}

export interface FilaMayorista {
  producto: string;
  variedad: string;
  precio_min: number | null;
  precio_max: number | null;
  precio_prom: number | null;
}

/** Códigos de producto (2 dígitos) y variedad (4 dígitos) de los checkboxes del formulario. */
export function codigosDelFormulario(html: string): Codigos {
  const productos = [...html.matchAll(/<input id="(\d{2})" value="p"/g)].map((m) => m[1]);
  const variedades = [...html.matchAll(/<input id="(\d{4})" class="\d{2}" value="v"/g)].map((m) => m[1]);
  return { productos: [...new Set(productos)], variedades: [...new Set(variedades)] };
}

/** "2026-10-16" → "16/10/2026" (formato del reporte). */
export function fechaReporte(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function cuerpoConsulta(c: Codigos, fechaIso: string): string {
  return new URLSearchParams({
    vid_tipo: "1", vprod: c.productos.join(","), vvari: c.variedades.join(","), vfecha: fechaReporte(fechaIso),
  }).toString();
}

const limpiar = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const num = (s: string) => {
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Tabla del reporte → filas [producto, variedad, mín, máx, prom] (precios por kg en soles). */
export function parsearReporte(html: string): FilaMayorista[] {
  const out: FilaMayorista[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => limpiar(m[1]));
    if (c.length !== 5 || !/^[\d.,]+$/.test(c[4])) continue;
    out.push({ producto: c[0], variedad: c[1], precio_min: num(c[2]), precio_max: num(c[3]), precio_prom: num(c[4]) });
  }
  return out;
}

/** Texto comparable: mayúsculas sin tildes ni signos. */
export function normalizar(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9Ñ ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** ¿Todas las palabras de la consulta (sin conectores) están en producto + variedad? Las de hasta 4 letras, enteras
 * ("ajo" no es "ajonjolí"); las más largas, como prefijo ("limon" → "limones"). */
export function coincide(consulta: string, fila: Pick<FilaMayorista, "producto" | "variedad">): boolean {
  const palabrasFila = normalizar(`${fila.producto} ${fila.variedad}`).split(" ");
  const palabras = normalizar(consulta).split(" ").filter((p) => p.length > 1 && !["DE", "DEL", "LA", "EL", "X", "KG", "POR"].includes(p));
  return palabras.length > 0 && palabras.every((p) => palabrasFila.some((w) => (p.length <= 4 ? w === p : w.startsWith(p))));
}
