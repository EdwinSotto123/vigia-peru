"use client";

import { useState } from "react";
import { plural } from "@/lib/formato";

/**
 * Punto agregado de contratos por zona sobre el mapa (PeruChoropleth).
 * Radio ∝ √total · color por ESTADO OPERATIVO dominante (plan 2026-09-16 · U1) · anillo cuando está seleccionado.
 * Las coordenadas ya vienen proyectadas (px, py) y `zoom` mantiene el tamaño visual al hacer zoom.
 *
 * Estados (mismo vocabulario que EstadoPill / lib/auditoria): sin analizar · documentos listos ·
 * en cola · procesado · en revisión. Los colores salen de los tokens del tema (tailwind.config):
 * mute / inkSoft / amber / moss / clay. Las señales se ven en la capa de alertas, no acá.
 * Son hex porque el SVG del mapa pinta con `fill`: los valores son los de tailwind.config.ts
 * (neutros cálidos desde el 2026-09-25; el gris azulado viejo peleaba con el granate).
 */

import type { ContratoZona } from "@/lib/contratos";

export type EstadoOperativoZona = "sin_analizar" | "documentos_listos" | "en_cola" | "procesado" | "en_revision";

export const COLOR_ESTADO: Record<EstadoOperativoZona, string> = {
  sin_analizar: "#A79DA1",        // gris tierra claro (entre mute y paperEdge): nada descargado ni analizable aún
  documentos_listos: "#463D41",   // inkSoft: expediente en el almacén, análisis en preparación
  en_cola: "#BE7B26",             // amber: financiable hoy (bienes con adjudicación)
  procesado: "#3F7D43",           // moss: dictamen publicado
  en_revision: "#B26A2E",         // clay: procesado, espera revisión humana
};
export const ESTADO_OPERATIVO_LABEL: Record<EstadoOperativoZona, string> = {
  // Las palabras de la leyenda de la lista (estadoLectura.tsx, §10.1), con un poco más de aire.
  sin_analizar: "Sin leer",
  documentos_listos: "Expediente descargado, lectura en preparación",
  en_cola: "En cola, se puede financiar hoy",
  procesado: "Leído",
  en_revision: "En revisión",
};
export const COLOR_SELECCION = "#1E191B"; // ink

/**
 * Estado operativo dominante de una zona. Prioridad: lo ya hecho (procesado / en revisión) →
 * lo financiable (en cola) → lo que espera análisis (documentos listos) → nada.
 * Una zona "procesada" a la vista es una donde ya se publicó al menos un dictamen; si TODO lo
 * procesado está en revisión, se pinta como tal para no ocultar el freno humano.
 */
export function estadoDominante(z: Pick<ContratoZona, "procesados" | "enRevision" | "enCola" | "documentosListos">): EstadoOperativoZona {
  const procesados = z.procesados ?? 0, revision = z.enRevision ?? 0;
  if (procesados > 0) return revision >= procesados ? "en_revision" : "procesado";
  if ((z.enCola ?? 0) > 0) return "en_cola";
  if ((z.documentosListos ?? 0) > 0) return "documentos_listos";
  return "sin_analizar";
}

export const colorPorEstado = (z: Parameters<typeof estadoDominante>[0]): string => COLOR_ESTADO[estadoDominante(z)];

/** @deprecated usa colorPorEstado — se mantiene por compatibilidad con importadores viejos. */
export const colorPorSenales = colorPorEstado;

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
  /**
   * Píxeles de pantalla por unidad del viewBox (sin el zoom). Con esto el área
   * que se puede tocar mide al menos 12 px REALES aunque el punto dibujado sea
   * de 4: un punto de 2,2 unidades era imposible de acertar con el dedo.
   */
  escalaPantalla?: number;
  selected?: boolean;
  hovered?: boolean;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}

/** Radio mínimo del área táctil, en píxeles de pantalla (12 px de diámetro). */
const RADIO_TOQUE_PX = 6;

export function ContratoPin({ px, py, r, color, total, nombre, zoom, escalaPantalla = 1, selected, hovered, onClick, onHover }: ContratoPinProps) {
  const [foco, setFoco] = useState(false);
  const rr = r / zoom;
  const sw = 0.7 / zoom;
  const rToque = Math.max(rr, RADIO_TOQUE_PX / ((escalaPantalla || 1) * zoom));
  const etiqueta = `${nombre}: ${plural(total, "contrato ingresado", "contratos ingresados")}. Acota la lista a este distrito`;
  return (
    <g
      transform={`translate(${px},${py})`}
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      // Antes sólo se alcanzaba con el mouse: ahora es un control de verdad.
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? etiqueta : undefined}
      aria-pressed={onClick ? !!selected : undefined}
      className="foco-propio"
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onFocus={() => {
        setFoco(true);
        onHover?.(true);
      }}
      onBlur={() => {
        setFoco(false);
        onHover?.(false);
      }}
    >
      {/* Área táctil invisible: el punto dibujado puede medir 4 px. */}
      <circle r={rToque} fill="transparent" />
      {/* Anillo estático. El `<animate>` que latía sin fin sobre el punto
          seleccionado se retiró: era movimiento perpetuo sobre un dato y sobre
          la selección, justo donde el usuario necesita leer una cifra quieta.
          La selección ya se distingue por grosor y opacidad del anillo. */}
      {foco && <circle r={rr + 3.6 / zoom} fill="none" stroke="#711C30" strokeWidth={2.2 / ((escalaPantalla || 1) * zoom)} />}
      {(selected || hovered) && (
        <circle
          r={rr + 2.4 / zoom}
          fill="none"
          stroke={COLOR_SELECCION}
          strokeWidth={(selected ? 1.8 : 1.1) / zoom}
          strokeOpacity={selected ? 0.9 : 0.5}
        />
      )}
      <circle r={rr} fill={color} fillOpacity={0.78} stroke="#FFFFFF" strokeWidth={sw}>
        <title>{`${nombre}: ${plural(total, "contrato", "contratos")}`}</title>
      </circle>
      {rr >= 6 / zoom && (
        <text textAnchor="middle" dy="0.35em" fontSize={Math.min(rr * 0.9, 7 / zoom)} fontFamily="JetBrains Mono, monospace" fontWeight={600} fill="#FFFFFF" pointerEvents="none">
          {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total}
        </text>
      )}
    </g>
  );
}

/** Leyenda compacta de la capa Contratos (para el cuadro de leyenda del mapa): los 5 estados operativos. */
export function ContratoPinLeyenda() {
  const orden: EstadoOperativoZona[] = ["sin_analizar", "documentos_listos", "en_cola", "procesado", "en_revision"];
  return (
    <ul className="space-y-1 text-[12px] text-mute">
      {orden.map((e) => (
        <li key={e} className="flex items-start gap-1.5">
          <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR_ESTADO[e] }} />
          <span>{ESTADO_OPERATIVO_LABEL[e]}</span>
        </li>
      ))}
      <li className="border-t border-line pt-1.5 text-[11px]">
        Tamaño del punto = cantidad de contratos de la zona. Color = estado predominante.
      </li>
    </ul>
  );
}
