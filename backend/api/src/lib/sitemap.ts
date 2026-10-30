/**
 * Lo puro del sitemap (routes/sitemap.ts): cuántos identificadores van por archivo y qué página pide la web.
 * Google acepta hasta 50 mil URL por archivo; con 45 mil queda margen y un archivo de contratos pesa unos 5 MB.
 */
export const POR_ARCHIVO = 45_000;

/** Tope de páginas por tipo: los 830 mil contratos son 19; más allá es un pedido mal armado. */
const MAX_PAGINAS = 1_000;

/** `/sitemap/:tipo/:pagina` → el tipo (uno de `tipos`), la página (desde 1) y cuántas filas saltar; null si no vale. */
export function leerPaginaSitemap<T extends string>(
  tipo: string,
  pagina: string,
  tipos: readonly T[],
): { tipo: T; pagina: number; offset: number } | null {
  if (!(tipos as readonly string[]).includes(tipo)) return null;
  if (!/^[1-9]\d{0,3}$/.test(pagina)) return null;
  const n = Number(pagina);
  if (n > MAX_PAGINAS) return null;
  return { tipo: tipo as T, pagina: n, offset: (n - 1) * POR_ARCHIVO };
}

/** Cuántos archivos hacen falta para `total` identificadores (al menos uno, aunque esté vacío). */
export const archivosPara = (total: number) => Math.max(1, Math.ceil(total / POR_ARCHIVO));
