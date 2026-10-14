/**
 * Cliente de la Plataforma Nacional de Datos Abiertos (datosabiertos.gob.pe): lo de
 * backend/scrapers/_core/pnda.py. La PNDA corre sobre DKAN y su API CKAN no responde: se lee el HTML de
 * la página del dataset, que es estable (recursos en sites/default/files/ y la fecha de modificación).
 */

import type { Env } from "./config.ts";
import { texto } from "./http.ts";
import { strip } from "./py.ts";

export const BASE = "https://www.datosabiertos.gob.pe";
export const DATA_EXT = [".csv", ".xlsx", ".xls", ".json", ".zip", ".txt", ".rar"];
/** Archivos que acompañan al dataset pero no son datos. */
const SALTAR = ["diccionario", "metadato", "metadata", "formato_", ".docx", ".pdf", ".css"];

const RE_RECURSO = /href="(https?:\/\/www\.datosabiertos\.gob\.pe\/sites\/default\/files\/[^"]+)"/g;
const RE_MODIFICADO = /field-name-field-modified-date">\s*(\d{4}-\d{2}-\d{2})/;
const RE_TITULO = /<title>([^|<]+)/;

export interface Recurso {
  url: string;
  archivo: string;
  ext: string;
}

export interface Dataset {
  slug: string;
  titulo: string;
  /** AAAA-MM-DD según la PNDA. */
  modificado: string | null;
  recursos: Recurso[];
}

export const urlDataset = (slug: string) => `${BASE}/dataset/${slug}`;

/** El dataset no existe: la PNDA redirige al buscador (el `LookupError` de Python). */
export class DatasetInexistente extends Error {}

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó",
  uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
  ordm: "º", ordf: "ª", iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", deg: "°",
};

/** `html.unescape` para lo que aparece en títulos y enlaces de la PNDA (numéricas y las nombradas comunes). */
export function desescaparHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

/** `urllib.parse.unquote` (UTF-8 con reemplazo; '+' no se toca). */
export function desescaparUrl(s: string): string {
  return s.replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
    const bytes = new Uint8Array(m.length / 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(m.slice(i * 3 + 1, i * 3 + 3), 16);
    return new TextDecoder("utf-8").decode(bytes);
  });
}

export async function obtenerDataset(env: Env, slug: string): Promise<Dataset> {
  const pagina = await texto(env, urlDataset(slug));
  const t = RE_TITULO.exec(pagina);
  const titulo = t ? strip(desescaparHtml(t[1])) : slug;
  // Si la PNDA no encuentra el dataset redirige al buscador: el título lo delata.
  if (titulo.startsWith("Plataforma Nacional de Datos Abiertos")) {
    throw new DatasetInexistente(`dataset '${slug}' no existe en la PNDA (redirigió al buscador)`);
  }
  const vistos = new Set<string>();
  const recursos: Recurso[] = [];
  for (const m of pagina.matchAll(RE_RECURSO)) {
    const url = desescaparHtml(m[1]);
    if (vistos.has(url)) continue;
    vistos.add(url);
    const archivo = desescaparUrl(url.slice(url.lastIndexOf("/") + 1));
    const ext = archivo.includes(".") ? `.${archivo.slice(archivo.lastIndexOf(".") + 1).toLowerCase()}` : "";
    recursos.push({ url, archivo, ext });
  }
  return { slug, titulo, modificado: RE_MODIFICADO.exec(pagina)?.[1] ?? null, recursos };
}

/** Recursos de datos (sin diccionarios ni metadatos) con alguna de esas extensiones. */
export function recursosDeDatos(ds: Dataset, exts: string[] = DATA_EXT): Recurso[] {
  return ds.recursos.filter((r) => {
    const bajo = r.archivo.toLowerCase();
    return !SALTAR.some((p) => bajo.includes(p)) && exts.includes(r.ext);
  });
}

/** El primer recurso cuyo nombre contiene `parte` (sin distinguir mayúsculas). */
export function urlRecurso(ds: Dataset, parte: string): string | null {
  return ds.recursos.find((r) => r.archivo.toLowerCase().includes(parte.toLowerCase()))?.url ?? null;
}
