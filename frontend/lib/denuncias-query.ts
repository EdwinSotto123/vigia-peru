/**
 * Query tipada de /app/denuncias, leída desde `searchParams` en el server
 * component y compartida con FiltrosDenuncias/DenunciasGrid para armar los
 * links de paginación y de filtro sin perder los demás parámetros activos.
 *
 * `region` se valida contra el mismo catálogo (`REGIONES` de lib/peru-data)
 * que usa el formulario /reporte/nuevo para poblar su selector — así el
 * filtro solo acepta nombres que un reporte real puede tener.
 */

import { REGIONES } from "@/lib/peru-data";
import { TODAS_CATEGORIAS, type CategoriaDenuncia } from "@/lib/denuncias-meta";

export type EstadoDenunciaFiltro = "verificados" | "en_validacion";

export interface DenunciasQuery {
  region?: string;
  categoria?: CategoriaDenuncia;
  estado?: EstadoDenunciaFiltro;
  page: number;
}

const REGIONES_VALIDAS = new Set(REGIONES.map((r) => r.nombre));
const CATEGORIAS_VALIDAS = new Set<string>(TODAS_CATEGORIAS);

export function parseDenunciasQuery(
  sp: Record<string, string | string[] | undefined> = {},
): DenunciasQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const region = s("region");
  const categoria = s("categoria");
  const estado = s("estado");
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  return {
    region: region && REGIONES_VALIDAS.has(region) ? region : undefined,
    categoria: categoria && CATEGORIAS_VALIDAS.has(categoria) ? (categoria as CategoriaDenuncia) : undefined,
    estado: estado === "verificados" || estado === "en_validacion" ? estado : undefined,
    page,
  };
}

/** Arma el query string de la URL (omite `page` cuando es 1, para una URL limpia en la primera página). */
export function denunciasQueryString(q: Partial<DenunciasQuery>): string {
  const params = new URLSearchParams();
  if (q.region) params.set("region", q.region);
  if (q.categoria) params.set("categoria", q.categoria);
  if (q.estado) params.set("estado", q.estado);
  if (q.page && q.page > 1) params.set("page", String(q.page));
  return params.toString();
}

/** `confirmados` que espera el API a partir del filtro de estado del cliente (verificados/en validación). */
export function confirmadosDe(estado?: EstadoDenunciaFiltro): "true" | "false" | undefined {
  if (estado === "verificados") return "true";
  if (estado === "en_validacion") return "false";
  return undefined;
}
