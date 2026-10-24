import { getPoderGrafoPartido } from "@/lib/poder";
import { GrafoPartidoViz } from "./GrafoPartidoViz";

/**
 * El grafo de captura de un PARTIDO (/poder/partido/:partido/grafo, migración 125): las entidades que gobierna y las
 * empresas «puente» —las que ganaron contratos con indicio en 2+ de esas entidades—. Dibuja el patrón que más señala:
 * una misma empresa ligada al partido repitiéndose por sus municipios. Si ninguna se repite, no muestra nada.
 */
export async function GrafoPartido({ partido }: { partido: string }) {
  const data = await getPoderGrafoPartido(partido).catch(() => null);
  if (!data?.empresas?.length) return null;
  return <GrafoPartidoViz data={data} />;
}
