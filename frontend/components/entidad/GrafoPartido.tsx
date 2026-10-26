import { getPoderGrafoPartido } from "@/lib/poder";
import { GrafoPartidoViz } from "./GrafoPartidoViz";

/**
 * Las empresas que se repiten en las entidades de un PARTIDO (/poder/partido/:partido/grafo, migración 125): las que
 * ganaron contratos con indicio en 2+ de las entidades que gobierna. Es el patrón que más señala: una misma empresa
 * ligada al partido repitiéndose por sus municipios. Red bipartita en escritorio, tabla en el celular. Si ninguna se
 * repite, no muestra nada. Pasa sólo datos al componente de cliente.
 */
export async function GrafoPartido({ partido }: { partido: string }) {
  const data = await getPoderGrafoPartido(partido).catch(() => null);
  if (!data?.empresas?.length) return null;
  return <GrafoPartidoViz data={data} />;
}
