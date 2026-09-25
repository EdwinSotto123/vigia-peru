/**
 * Query tipada de /app/denuncias, leída desde `searchParams` en el server
 * component. Los filtros y la paginación los arma el kit de listados
 * (components/listado) a partir de estos mismos parámetros.
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

export function confirmadosDe(estado?: EstadoDenunciaFiltro): "true" | "false" | undefined {
  if (estado === "verificados") return "true";
  if (estado === "en_validacion") return "false";
  return undefined;
}
