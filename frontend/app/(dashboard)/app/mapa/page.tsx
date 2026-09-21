import { MapPin } from "lucide-react";
import { MapaWrapper } from "@/components/MapaWrapper";
import { PageHeader } from "@/components/dashboard/PageHeader";
import type { ZonaTab } from "@/components/mapa/ZonaHubPanel";

const TABS: ZonaTab[] = ["resumen", "cola", "entidades", "alertas", "denuncias", "presupuesto"];

/**
 * Hub público: el mapa es la interfaz. Elegir una región abre su cola de
 * auditoría, entidades, alertas y denuncias, con las acciones financiar/denunciar.
 * Acepta `?region=<regionId>` y `?tab=<resumen|cola|entidades|alertas|denuncias>`.
 */
export default function MapaPage({
  searchParams,
}: {
  searchParams?: { region?: string; tab?: string };
}) {
  const region = searchParams?.region?.toLowerCase() ?? null;
  const tab = TABS.includes(searchParams?.tab as ZonaTab) ? (searchParams?.tab as ZonaTab) : undefined;

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Mapa de auditoría"
        icon={<MapPin size={11} className="text-heroViolet" />}
        title="Elige tu región"
        subtitle="Cada departamento tiene contratos públicos esperando ser leídos. Toca uno para ver su cola de auditoría, las señales halladas, quién contrata y qué denuncian los vecinos — y financiar o denunciar desde ahí."
      />
      <MapaWrapper initialRegionId={region} initialTab={tab} />
    </div>
  );
}
