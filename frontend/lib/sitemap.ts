import { API_BASE } from "@/lib/api-client";
import { REGIONES } from "@/lib/peru-data";
import { REGION_UBIGEO } from "@/components/mapa/region-match";
import { ANIO_GOBIERNO_VIGENTE } from "@/lib/partidosApi";
import { clavePartido } from "@/lib/poder";
import { rutaContrato } from "@/lib/rutas";
import { absoluta } from "@/lib/seo";

/**
 * El sitemap de la web (2026-10-30). /sitemap.xml es un índice; cada archivo vive en /sitemaps/<nombre>.xml:
 *   · paginas.xml: las secciones, las 25 regiones, los partidos que gobiernan hoy y su mapa de poder;
 *   · entidades-N, empresas-N, contratos-N, plazas-N: las fichas, con los identificadores que da la API
 *     (backend/api/src/routes/sitemap.ts), 45 mil por archivo.
 * Nada de personas naturales (sus fichas son noindex) ni de páginas con consulta (robots.txt las deja fuera).
 * Se arma en cada pedido con lo que la API tiene un día en su caché: no depende del build.
 */

export const TIPOS_FICHA = ["entidades", "empresas", "contratos", "plazas"] as const;
export type TipoFicha = (typeof TIPOS_FICHA)[number];

/** La ruta de la ficha de cada tipo: la misma que usan los enlaces de la web (la canónica de cada página). */
const RUTA: Record<TipoFicha, (id: string) => string> = {
  entidades: (ruc) => `/entidad/${ruc}`,
  empresas: (ruc) => `/empresa/${ruc}`,
  contratos: (ocid) => rutaContrato(ocid),
  plazas: (aviso) => `/app/personas/plazas/${aviso}`,
};

/** Las secciones que se indexan (las de personas, cuentas y formularios no). */
export const PAGINAS_FIJAS = [
  "/", "/app", "/app/contratos", "/app/entidades", "/app/empresas", "/app/partidos", "/app/poder", "/app/hallazgos",
  "/app/novedades", "/app/mapa", "/app/cuanto-cuesta", "/app/apoyar", "/app/aliados", "/glosario", "/preguntas",
  "/fuentes", "/privacidad",
];

async function leerApi<T>(ruta: string): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Los archivos del índice: paginas.xml y los de cada tipo según cuántas fichas tiene. Null si la API no respondió. */
export async function archivosSitemap(): Promise<string[] | null> {
  const r = await leerApi<{ porArchivo: number; totales: Record<TipoFicha, number> }>("/sitemap");
  if (!r) return null;
  const archivos = ["paginas.xml"];
  for (const t of TIPOS_FICHA) {
    const n = Math.max(1, Math.ceil((r.totales[t] ?? 0) / r.porArchivo));
    for (let i = 1; i <= n; i++) archivos.push(`${t}-${i}.xml`);
  }
  return archivos;
}

/** Las URL de un archivo de fichas. Null si la API no respondió (el archivo responde 503 y Google vuelve más tarde). */
export async function urlsDeFichas(tipo: TipoFicha, pagina: number): Promise<string[] | null> {
  const r = await leerApi<{ ids: string[] }>(`/sitemap/${tipo}/${pagina}`);
  return r ? r.ids.map((id) => absoluta(RUTA[tipo](id))) : null;
}

/** paginas.xml: secciones, regiones, partidos del período vigente y su mapa de poder (lo que falle se omite). */
export async function urlsDePaginas(): Promise<string[]> {
  const rutas = [...PAGINAS_FIJAS];
  for (const r of REGIONES) if (REGION_UBIGEO[r.id]) rutas.push(`/region/${REGION_UBIGEO[r.id]}`);
  for (let offset = 0; offset < 2_000; offset += 100) {
    const p = await leerApi<{ total?: number; data: { clave: string }[] }>(
      `/partidos/ranking?anio=${ANIO_GOBIERNO_VIGENTE}&limit=100&offset=${offset}`,
    );
    if (!p?.data.length) break;
    for (const f of p.data) if (f.clave) rutas.push(`/app/partidos/${f.clave}`);
    if (p.data.length < 100 || (p.total != null && offset + 100 >= p.total)) break;
  }
  const poder = await leerApi<{ data: { partido: string }[] }>("/poder/partidos");
  for (const f of poder?.data ?? []) if (f.partido) rutas.push(`/app/poder/${clavePartido(f.partido)}`);
  return [...new Set(rutas)].map(absoluta);
}

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

export const xmlUrlset = (urls: string[]) =>
  `${XML}<urlset ${NS}>\n${urls.map((u) => `<url><loc>${escapar(u)}</loc></url>`).join("\n")}\n</urlset>\n`;

export const xmlIndice = (urls: string[]) =>
  `${XML}<sitemapindex ${NS}>\n${urls.map((u) => `<sitemap><loc>${escapar(u)}</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`;

export const CABECERAS_XML = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
  "X-Robots-Tag": "noindex",
};
