import { REGIONES, REGION_TO_MEF_DEPT } from "@/lib/peru-data";
import { REGION_UBIGEO, UBIGEO_REGION } from "@/components/mapa/region-match";

/**
 * Una región (departamento) por su nombre corto («cusco», el de `lib/peru-data` y del mapa) o por su ubigeo de 2 dígitos
 * («08»): nombre para mostrar, ubigeo y cómo la nombra el MEF. La ficha vive en /region/<ubigeo>.
 */
export interface Region {
  id: string;
  nombre: string;
  ubigeo: string;
  mefDept: string | null;
}

export function regionDe(clave: string | null | undefined): Region | null {
  if (!clave) return null;
  const k = decodeURIComponent(clave).toLowerCase();
  const id = /^\d{2}$/.test(k) ? UBIGEO_REGION[k] : REGION_UBIGEO[k] ? k : null;
  if (!id) return null;
  const r = REGIONES.find((x) => x.id === id);
  return r ? { id, nombre: r.nombre, ubigeo: REGION_UBIGEO[id], mefDept: REGION_TO_MEF_DEPT[id] ?? null } : null;
}

/** La ficha de una región; `seccion` abre una pestaña y `q` busca en sus provincias y distritos. */
export function rutaRegion(ubigeo: string, seccion?: "inicio" | "gobiernos" | "territorio", q?: string): string {
  const p = new URLSearchParams();
  if (seccion) p.set("seccion", seccion);
  if (q) p.set("tq", q);
  const s = p.toString();
  return `/region/${ubigeo.slice(0, 2)}${s ? `?${s}` : ""}`;
}
