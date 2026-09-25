"use client";

import { MapPin } from "lucide-react";
import type { RegionGeo } from "@/lib/peru-data";
import type { ContratoZona } from "@/lib/contratos";
import { ZonaHubPanel, type ZonaTab } from "./mapa/ZonaHubPanel";
import { REGION_UBIGEO } from "./mapa/region-match";

/**
 * Panel lateral del mapa. Con una región elegida delega en `ZonaHubPanel`
 * (cola de auditoría, entidades, señales, denuncias y acciones); sin región,
 * muestra qué va a encontrar el usuario cuando toque el mapa.
 *
 * La provincia elegida ya no viaja por props: va por `MapaContratosContext`,
 * igual que el distrito, porque para el panel son la misma cosa: un ubigeo
 * que acota la cola. Antes el detalle de provincia traía un conteo de alertas
 * que salía del mock de `peru-data` y no existía en ninguna base.
 */
export function RegionDetailPanel({
  region,
  onClose,
  alertasApi,
  reportes,
  geo,
  tab,
  onTab,
}: {
  region: RegionGeo | null;
  onClose: () => void;
  /** Alertas reales desde la API (el mapa ya las trae para los puntos). `null` = cargando. */
  alertasApi: any[] | null;
  /** Denuncias ciudadanas reales desde la API. `null` = cargando. */
  reportes: any[] | null;
  /** Cifras del departamento en `/contratos/geo`, sin filtro de mes. `undefined` = cargando. */
  geo: ContratoZona | null | undefined;
  tab: ZonaTab;
  onTab: (t: ZonaTab) => void;
}) {
  if (!region) return <PanelVacio />;

  return (
    <ZonaHubPanel
      regionId={region.id}
      ubigeo={REGION_UBIGEO[region.id] ?? ""}
      nombre={region.nombre}
      onClose={onClose}
      alertas={alertasApi}
      reportes={reportes}
      geo={geo}
      tab={tab}
      onTab={onTab}
    />
  );
}

function PanelVacio() {
  // Arriba, no centrado: centrado en 680 px dejaba 200 px en blanco sobre el texto.
  return (
    <div className="flex h-full flex-col justify-start gap-4 bg-paperSoft px-7 py-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-paperEdge bg-paperDeep text-granate">
        <MapPin size={20} aria-hidden />
      </div>
      <h2 className="font-display text-xl font-bold leading-tight text-ink">Ningún departamento abierto</h2>
      <p className="max-w-[42ch] text-sm leading-relaxed text-mute">
        Toca un departamento del mapa, o llega a uno con Tab y Enter, y acá aparece lo que hay de esa zona.
      </p>
      <ul className="space-y-2 border-t border-line pt-4 text-[13px] leading-snug text-mute">
        <li>
          <strong className="font-semibold text-ink">Su cola de auditoría</strong>: cuántos contratos esperan lectura,
          cuánto suman y cuánto cuesta leerlos.
        </li>
        <li>
          <strong className="font-semibold text-ink">Lo que ya se encontró</strong>: contratos con señales y su norma
          citada, y las denuncias que dejaron los vecinos.
        </li>
        <li>
          <strong className="font-semibold text-ink">Quién contrata</strong>: las entidades de la zona y su presupuesto
          MEF.
        </li>
      </ul>
    </div>
  );
}
