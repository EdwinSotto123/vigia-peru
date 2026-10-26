/**
 * Lo que la ficha de una región pide en el servidor para su árbol de provincias y distritos, con endpoints que ya
 * existen (nada nuevo en la API):
 *   · `municipalidadesDe`: el RUC de cada municipalidad provincial y distrital (GET /poder/territorio, el árbol del
 *     mapa de poder: una entidad electa por gobierno, con su departamento, provincia y distrito en palabras). El
 *     archivo del JNE que dibuja el árbol no trae RUC ni ubigeo de distrito: se empata por nombre, sin tildes.
 *   · `zonasDe`: cuántos contratos tienen las entidades con sede en cada provincia y cada distrito (GET /contratos/geo,
 *     el mismo conteo del mapa), con su ubigeo: así cada fila lleva a su lista de contratos.
 * Sólo se manda al navegador lo de la región (no las 1,800 entidades del país). `null` = el servicio no respondió.
 */

import { getPoderTerritorio } from "@/lib/poder";
import { getContratosGeo, type ContratosQuery } from "@/lib/contratos";
import { normalizar } from "@/lib/partidos";

export interface MunicipalidadRegion {
  ruc: string;
  nivel: "provincial" | "distrital";
  provincia: string;
  distrito: string | null;
  /** Como la nombra el registro de entidades ("MUNICIPALIDAD DISTRITAL DE SAN ISIDRO - LIMA"). */
  nombre: string;
}

export interface ZonaRegion {
  ubigeo: string;
  nombre: string;
  nivel: "departamento" | "provincia" | "distrito";
  total: number;
}

export async function municipalidadesDe(nombreRegion: string): Promise<MunicipalidadRegion[] | null> {
  const t = await getPoderTerritorio();
  if (!t) return null;
  const dep = normalizar(nombreRegion);
  return t.nodos
    .filter((n) => (n.nivel === "provincial" || n.nivel === "distrital") && !!n.provincia && normalizar(n.departamento) === dep)
    .map((n) => ({ ruc: n.ruc, nivel: n.nivel as MunicipalidadRegion["nivel"], provincia: n.provincia!, distrito: n.distrito, nombre: n.nombre }));
}

/** Provincias y distritos de la región con su conteo de contratos; con `filtros`, los de esa lista (sin su zona). */
export async function zonasDe(ubigeo: string, filtros: Pick<ContratosQuery, "tipo" | "etapa" | "riesgo" | "q" | "desde" | "hasta" | "lectura" | "cruces"> = {}): Promise<ZonaRegion[] | null> {
  const [prov, dist] = await Promise.all([
    getContratosGeo({ ...filtros, ubigeo, nivel: "provincia" }),
    getContratosGeo({ ...filtros, ubigeo, nivel: "distrito" }),
  ]);
  if (!prov && !dist) return null;
  return [...(prov ?? []), ...(dist ?? [])].map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre, nivel: z.nivel, total: z.total }));
}
