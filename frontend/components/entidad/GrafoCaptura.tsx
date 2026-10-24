import { getPoderGrafoEntidad } from "@/lib/poder";
import { GrafoCapturaViz } from "./GrafoCapturaViz";

/**
 * Trae el grafo de captura de la entidad (/poder/entidad/:ruc/grafo, migración 125) y, si hay empresas ligadas al
 * partido que la gobierna, lo dibuja. Si no hay gobierno mapeado o ninguna empresa, no muestra nada (el resumen de
 * captura lo da {@link CapturaEntidad}). Indicios para revisión humana, no una acusación.
 */
export async function GrafoCaptura({ ruc }: { ruc: string }) {
  const data = await getPoderGrafoEntidad(ruc).catch(() => null);
  if (!data?.partido || !data.empresas?.length) return null;
  return <GrafoCapturaViz data={data} />;
}
