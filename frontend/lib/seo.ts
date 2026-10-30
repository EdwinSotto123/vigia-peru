import type { Metadata } from "next";
import { SITIO } from "@/lib/compartir";

/**
 * Lo común del SEO (2026-10-30, pedido del usuario: «mejora robots.txt y haz SEO»). El resto vive en app/robots.ts, el
 * sitemap (app/sitemap.xml, app/sitemaps/[archivo], lib/sitemap.ts) y los datos estructurados
 * (components/seo/DatosEstructurados.tsx).
 *
 *  · `canonica(ruta)`: cada página que se indexa dice cuál es su URL, siempre sin consulta. robots.txt deja fuera las
 *    variantes con filtros, pestañas y páginas (`/app/*?`, `/entidad/*?`…): son combinaciones sin fin de lo mismo y cada
 *    ficha ya está en el sitemap.
 *  · `NO_INDEXAR`: lo que no sale en un buscador: las fichas de personas naturales (privacidad), las denuncias ciudadanas
 *    (no están verificadas), los comprobantes y perfiles de quien aporta, formularios y cuentas. Se siguen sus enlaces.
 *  · `absoluta(ruta)`: las URL de los datos estructurados y del sitemap, completas y en el dominio público.
 */
export const absoluta = (ruta: string) => new URL(ruta, SITIO).toString();

export const canonica = (ruta: string): Metadata["alternates"] => ({ canonical: ruta });

export const NO_INDEXAR: Metadata["robots"] = { index: false, follow: true };

/** El logo para los datos estructurados (Google pide al menos 112 px; el ícono de la pestaña es de 32). */
export const LOGO = "/assets/logo/vigia_peru_512.png";

/** Una descripción para la etiqueta `description`: sin espacios de más y cortada en una palabra (Google muestra ~155). */
export function descripcion(partes: (string | null | undefined | false)[], max = 160): string {
  const texto = partes.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max - 1);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), max - 20)).replace(/[\s,;:.]+$/, "")}…`;
}
