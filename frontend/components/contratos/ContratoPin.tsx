"use client";

/**
 * Punto agregado de contratos por zona sobre el mapa (PeruChoropleth).
 * Radio ∝ √total · color por % con señales de riesgo · anillo cuando está seleccionado.
 * Las coordenadas ya vienen proyectadas (px, py) y `zoom` mantiene el tamaño visual al hacer zoom.
 */

import type { ContratoZona } from "@/lib/contratos";

export const COLOR_SIN_SENALES = "#5B6B7A";   // gris azulado: contratos sin analizar
export const COLOR_SENAL_BAJA = "#C28840";    // ámbar: algunas señales
export const COLOR_SENAL_ALTA = "#8B2A1E";    // rojo: muchas señales
export const COLOR_SELECCION = "#1B1611";

/** Color según la proporción de contratos con señales (score ≥ 40) sobre los procesados. */
export function colorPorSenales(z: Pick<ContratoZona, "procesados" | "conSenales">): string {
  if (!z.procesados) return COLOR_SIN_SENALES;
  const p = z.conSenales / z.procesados;
  if (p >= 0.5) return COLOR_SENAL_ALTA;
  if (p > 0) return COLOR_SENAL_BAJA;
  return "#3F7D43";                             // procesados sin señales: verde
}

/** Radio en unidades del viewBox (480×700): 2.2 … 11, proporcional a √total. */
export function radioPorTotal(total: number, maxTotal: number): number {
  const t = Math.sqrt(Math.max(0, total)) / Math.sqrt(Math.max(1, maxTotal));
  return 2.2 + t * 8.8;
}

export interface ContratoPinProps {
  px: number;
  py: number;
  r: number;
  color: string;
  total: number;
  nombre: string;
  zoom: number;
  selected?: boolean;
  hovered?: boolean;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}

export function ContratoPin({ px, py, r, color, total, nombre, zoom, selected, hovered, onClick, onHover }: ContratoPinProps) {
  const rr = r / zoom;
  const sw = 0.7 / zoom;
  return (
    <g
      transform={`translate(${px},${py})`}
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      {(selected || hovered) && (
        <circle r={rr + 2.4 / zoom} fill="none" stroke={COLOR_SELECCION} strokeWidth={1.4 / zoom} strokeOpacity={selected ? 0.9 : 0.5}>
          {selected && <animate attributeName="r" values={`${rr + 1.8 / zoom};${rr + 3.2 / zoom};${rr + 1.8 / zoom}`} dur="1.8s" repeatCount="indefinite" />}
        </circle>
      )}
      <circle r={rr} fill={color} fillOpacity={0.78} stroke="#F4EEDD" strokeWidth={sw}>
        <title>{`${nombre} · ${total.toLocaleString("es-PE")} contrato${total === 1 ? "" : "s"}`}</title>
      </circle>
      {rr >= 6 / zoom && (
        <text textAnchor="middle" dy="0.35em" fontSize={Math.min(rr * 0.9, 7 / zoom)} fontFamily="JetBrains Mono, monospace" fontWeight={600} fill="#F4EEDD" pointerEvents="none">
          {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total}
        </text>
      )}
    </g>
  );
}

/** Leyenda compacta de la capa Contratos (para el cuadro de leyenda del mapa). */
export function ContratoPinLeyenda() {
  const rows: [string, string][] = [
    [COLOR_SIN_SENALES, "Sin analizar"],
    ["#3F7D43", "Procesados, sin señal"],
    [COLOR_SENAL_BAJA, "Con algunas señales"],
    [COLOR_SENAL_ALTA, "Mayoría con señales"],
  ];
  return (
    <div className="space-y-0.5 text-[9px] text-mute">
      {rows.map(([c, l]) => (
        <div key={l} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c, opacity: 0.85 }} />
          <span>{l}</span>
        </div>
      ))}
      <div className="pt-0.5 text-[9px] text-mute">Tamaño = cantidad de contratos</div>
    </div>
  );
}
