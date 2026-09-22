import { MapaWrapper } from "@/components/MapaWrapper";
import type { ZonaTab } from "@/components/mapa/ZonaHubPanel";

const TABS: ZonaTab[] = ["resumen", "cola", "entidades", "alertas", "denuncias", "presupuesto"];

/**
 * Hub público: el mapa es la interfaz. Elegir un departamento abre su cola de
 * auditoría, entidades, señales y denuncias, con las acciones financiar/denunciar.
 * Acepta `?region=<regionId>`, `?tab=<…>`, `?ubigeo=<provincia|distrito>` y `?ocid=`.
 *
 * El `PageHeader` vive dentro de `MapaWrapper` y no acá: el encabezado tiene que
 * reflejar el estado. Un h1 fijo que sigue diciendo "Elige tu región" después de
 * que el usuario eligió una es un encabezado que miente sobre dónde está.
 */
export default function MapaPage({
  searchParams,
}: {
  searchParams?: { region?: string; tab?: string };
}) {
  const region = searchParams?.region?.toLowerCase() ?? null;
  const tab = TABS.includes(searchParams?.tab as ZonaTab) ? (searchParams?.tab as ZonaTab) : undefined;

  return (
    <div className="space-y-6 px-6 py-8 lg:px-10">
      <MapaWrapper initialRegionId={region} initialTab={tab} />
    </div>
  );
}
