"use client";

import { MapPin } from "lucide-react";
import type { RegionData, ProvinciaData } from "@/lib/peru-data";
import { ZonaHubPanel, type ZonaTab } from "./mapa/ZonaHubPanel";
import { REGION_UBIGEO } from "./mapa/region-match";

/**
 * Panel lateral del mapa. Con una región elegida delega en `ZonaHubPanel`
 * (cola de auditoría, entidades, alertas, denuncias y acciones); sin región,
 * muestra la invitación a tocar el mapa.
 */
export function RegionDetailPanel({
  region,
  provinciaActiva,
  onClose,
  onClearProvincia,
  alertasApi,
  reportes,
  initialTab,
}: {
  region: RegionData | null;
  provinciaActiva: ProvinciaData | null;
  onClose: () => void;
  onClearProvincia: () => void;
  /** Alertas reales desde la API (el mapa ya las trae para los pines). */
  alertasApi?: any[];
  /** Reportes ciudadanos reales desde la API. */
  reportes?: any[];
  initialTab?: ZonaTab;
}) {
  if (!region) return <EmptyPanel />;

  return (
    <ZonaHubPanel
      regionId={region.id}
      ubigeo={REGION_UBIGEO[region.id] ?? ""}
      nombre={region.nombre}
      onClose={onClose}
      alertas={alertasApi}
      reportes={reportes}
      provinciaActiva={provinciaActiva ? { nombre: provinciaActiva.nombre, alertas: provinciaActiva.alertas } : null}
      onClearProvincia={onClearProvincia}
      initialTab={initialTab}
    />
  );
}

function EmptyPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-paperSoft p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-paperEdge bg-paperDeep text-clay">
        <MapPin size={26} />
      </div>
      <h3 className="font-serif text-xl font-bold text-ink">Toca una región</h3>
      <p className="max-w-xs text-sm text-mute">
        Verás cuántos contratos esperan auditoría, qué señales ya se hallaron, quién contrata y qué
        denuncian los vecinos. Desde ahí puedes financiar su auditoría o reportar una obra.
      </p>
    </div>
  );
}
