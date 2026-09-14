import { MapPin, Heart, Camera } from "lucide-react";
import Link from "next/link";
import { MapaWrapper } from "@/components/MapaWrapper";
import { PageHeader } from "@/components/dashboard/PageHeader";
import type { ZonaTab } from "@/components/mapa/ZonaHubPanel";

const TABS: ZonaTab[] = ["resumen", "cola", "entidades", "alertas", "denuncias"];

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
        icon={<MapPin size={11} className="text-clay" />}
        title="Elige tu región"
        subtitle="Cada departamento tiene contratos públicos esperando ser leídos. Toca uno para ver su cola de auditoría, las señales halladas, quién contrata y qué denuncian los vecinos — y financiar o denunciar desde ahí."
        actions={
          <>
            <Link
              href="/financiar"
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-coal"
            >
              <Heart size={14} className="text-amber" />
              Financiar
            </Link>
            <Link
              href="/reporte/nuevo"
              className="inline-flex items-center gap-1.5 rounded-full border border-rust/40 bg-crimson-soft px-4 py-2 text-sm font-medium text-rust hover:bg-rust hover:text-paper"
            >
              <Camera size={14} />
              Denunciar
            </Link>
          </>
        }
      />
      <MapaWrapper initialRegionId={region} initialTab={tab} />
    </div>
  );
}
