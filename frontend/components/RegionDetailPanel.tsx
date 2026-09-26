"use client";

import { MapPin } from "lucide-react";
import type { RegionGeo } from "@/lib/peru-data";
import type { ContratoZona } from "@/lib/contratos";
import { ZonaHubPanel, type ZonaTab } from "./mapa/ZonaHubPanel";
import type { AlertasMapa } from "./mapa/puntos";
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
  senales,
  reportes,
  geo,
  tab,
  onTab,
}: {
  region: RegionGeo | null;
  onClose: () => void;
  /** Filas completas de `/alertas` para la pestaña Señales. `null` = cargando; `undefined` = la pestaña las pide. */
  alertasApi: any[] | null | undefined;
  /** Todas las alertas publicadas en filas mínimas (las de los puntos): de ahí salen los conteos. `null` = cargando. */
  senales: AlertasMapa | null;
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
      senales={senales}
      reportes={reportes}
      geo={geo}
      tab={tab}
      onTab={onTab}
    />
  );
}

/** Qué trae el panel de una zona: una línea por pestaña, sin párrafos (§10.7). */
const QUE_TRAE: { titulo: string; detalle: string }[] = [
  { titulo: "Cola de auditoría", detalle: "qué espera lectura y cuánto cuesta leerlo" },
  { titulo: "Lo ya encontrado", detalle: "señales con su norma y denuncias vecinales" },
  { titulo: "Quién contrata", detalle: "entidades y presupuesto MEF" },
];

function PanelVacio() {
  // Arriba, no centrado: centrado en 680 px dejaba 200 px en blanco sobre el texto.
  return (
    <div className="flex h-full flex-col justify-start gap-3 bg-paperSoft px-6 py-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold leading-tight text-ink">
        <MapPin size={18} className="shrink-0 text-granate" aria-hidden />
        Ningún departamento abierto
      </h2>
      <p className="text-[13px] text-mute">Toca uno en el mapa (o Tab y Enter) para ver:</p>
      <ul className="divide-y divide-line border-y border-line text-[13px]">
        {QUE_TRAE.map((q) => (
          <li key={q.titulo} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
            <span className="font-semibold text-ink">{q.titulo}</span>
            <span className="text-[12px] text-mute">{q.detalle}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
