"use client";

import { useState } from "react";
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
  ranking,
  medidaTitulo,
  onElegirRegion,
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
  /** Los departamentos ya ordenados por lo que pinta el mapa; `null` = cargando. Llena el panel cuando no hay región abierta. */
  ranking?: FilaPais[] | null;
  /** Qué mide el ranking (lo que pinta el mapa), en palabras. */
  medidaTitulo?: string;
  onElegirRegion?: (ubigeo: string) => void;
}) {
  if (!region) return <PanelPais ranking={ranking ?? null} medidaTitulo={medidaTitulo ?? ""} onElegir={onElegirRegion} />;

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

/** Un departamento del ranking del país: lo que pinta el mapa y lo que se leyó. */
export interface FilaPais {
  ubigeo: string;
  nombre: string;
  /** Lo que ordena y fija el largo de la barra (la medida del mapa). */
  valor: number;
  /** Ese valor, ya formateado ("S/ 5.9 mil M"). */
  texto: string;
  total: number;
  leidos: number;
  conSenales: number;
}

const FILAS_INICIALES = 12;

/**
 * Sin región abierta, el panel no se queda vacío: ordena los departamentos por lo que pinta el
 * mapa. Es otra puerta al mismo mapa (un toque abre la región), con las mismas cifras de la API.
 */
function PanelPais({ ranking, medidaTitulo, onElegir }: { ranking: FilaPais[] | null; medidaTitulo: string; onElegir?: (ubigeo: string) => void }) {
  const [todas, setTodas] = useState(false);
  const max = Math.max(1, ...(ranking ?? []).map((f) => f.valor));
  const filas = ranking ? (todas ? ranking : ranking.slice(0, FILAS_INICIALES)) : [];
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-paperSoft px-5 py-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold leading-tight text-ink">
        <MapPin size={18} className="shrink-0 text-granate" aria-hidden />
        Todo el Perú
      </h2>
      <p className="mt-1 text-[13px] leading-snug text-mute">
        {medidaTitulo ? `Departamentos por ${medidaTitulo.toLowerCase()}. ` : ""}Toca uno aquí o en el mapa.
      </p>
      {ranking === null ? (
        <div className="mt-4 space-y-2" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-paperDeep" />
          ))}
        </div>
      ) : (
        <>
          <ol className="mt-3 divide-y divide-line border-y border-line">
            {filas.map((f, i) => (
              <li key={f.ubigeo}>
                <button
                  type="button"
                  onClick={() => onElegir?.(f.ubigeo)}
                  className="group flex w-full items-center gap-2.5 py-2 text-left transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate"
                >
                  <span aria-hidden className="w-5 shrink-0 text-right font-mono text-[12px] tabular-nums text-mute">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[14px] font-semibold text-ink group-hover:text-granate">{f.nombre}</span>
                      <span className="shrink-0 font-mono text-[12.5px] font-semibold tabular-nums text-ink">{f.texto}</span>
                    </span>
                    <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                      <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(2, (f.valor / max) * 100)}%` }} />
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-mute">
                      {f.leidos.toLocaleString("es-PE")} leídos de {f.total.toLocaleString("es-PE")}
                      {f.conSenales > 0 ? `, ${f.conSenales.toLocaleString("es-PE")} con riesgo medio o alto` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {ranking.length > FILAS_INICIALES && (
            <button
              type="button"
              onClick={() => setTodas((v) => !v)}
              aria-expanded={todas}
              className="mt-2 self-start text-[13px] font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate"
            >
              {todas ? "Ver menos" : `Ver los ${ranking.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
