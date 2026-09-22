"use client";

import { AlertTriangle, Bell, MessageSquareWarning, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { FiltroMes, type RangoMes } from "./FiltroMes";
import { LeyendaEscala } from "./LeyendaEscala";
import { FILTROS, MEDIDAS, type Escala, type FiltroZona, type Medida, type MedidaId } from "./escala";

/**
 * Barra de control del mapa: qué se pinta, de qué mes, qué capas se ven y qué
 * significa cada tono. Todo lo que antes flotaba sobre el lienzo tapando
 * geografía vive acá.
 */
export function BarraMapa({
  medida,
  onMedida,
  filtro,
  onFiltro,
  escala,
  medidaActual,
  ambito,
  conPines,
  cargando,
  mes,
  onMes,
  alertas,
  onAlertas,
  nAlertas,
  denuncias,
  onDenuncias,
  nDenuncias,
  misZonas,
  onMisZonas,
  nMisZonas,
  sinConexion,
}: {
  medida: MedidaId;
  onMedida: (m: MedidaId) => void;
  filtro: FiltroZona;
  onFiltro: (f: FiltroZona) => void;
  escala: Escala;
  medidaActual: Medida;
  ambito: string;
  conPines: boolean;
  cargando: boolean;
  mes: RangoMes | null;
  onMes: (r: RangoMes | null) => void;
  alertas: boolean;
  onAlertas: () => void;
  nAlertas: number;
  denuncias: boolean;
  onDenuncias: () => void;
  nDenuncias: number;
  misZonas: boolean;
  onMisZonas: () => void;
  nMisZonas: number;
  /** Qué fuentes no respondieron. Si hay alguna, se dice — nunca se rellena con otra cosa. */
  sinConexion: string[];
}) {
  return (
    <div className="space-y-3 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Qué se pinta */}
        {/* A 390 px este grupo medía 348 px y terminaba en x=389, pero el bloque
            corta en x=366 con overflow:hidden — o sea que "Con señal", una de las
            cinco medidas del mapa, quedaba recortada y sin forma de tocarla.
            Y los botones tenían DOS alturas en la misma píldora (24 y 40 px)
            porque "En cola" y "Con señal" envolvían a dos líneas.

            Se arregla con lo mínimo: `whitespace-nowrap` para que ninguna
            etiqueta se parta, y scroll horizontal propio del grupo para que la
            quinta medida siempre se pueda alcanzar deslizando. El rótulo
            "Pintar por" desaparece en pantalla angosta: el grupo ya se nombra
            para lectores de pantalla con su aria-label, y ahí el espacio vale
            más que la redundancia. */}
        <div
          className="scrollbar-warm -mx-1 flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-paperDeep p-0.5"
          role="group"
          aria-label="Qué se pinta en el mapa"
        >
          <span className="hidden shrink-0 whitespace-nowrap px-2 text-[11px] text-inkSoft sm:inline">Pintar por</span>
          {MEDIDAS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMedida(m.id)}
              aria-pressed={medida === m.id}
              title={m.ayuda}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
                medida === m.id ? "bg-ink text-paper" : "text-inkSoft hover:bg-paper hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* "Ver solo": acota el mapa a la pregunta que el usuario tiene en la
            cabeza. Atenúa lo que no cumple en vez de esconderlo, porque el
            valor está en ver dónde SÍ pasa contra dónde no. */}
        <div
          className="scrollbar-warm flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-paperDeep p-0.5"
          role="group"
          aria-label="Acotar el mapa"
        >
          <span className="hidden shrink-0 whitespace-nowrap px-2 text-[11px] text-inkSoft sm:inline">Ver solo</span>
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFiltro(f.id)}
              aria-pressed={filtro === f.id}
              title={f.ayuda}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
                filtro === f.id ? "bg-heroViolet text-paper" : "text-inkSoft hover:bg-paper hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <FiltroMes valor={mes} onChange={onMes} />

        {/* Capas de puntos */}
        <div className="flex items-center gap-1" role="group" aria-label="Capas del mapa">
          <BotonCapa activa={alertas} onClick={onAlertas} n={nAlertas} icono={<AlertTriangle size={13} />}>
            Señales
          </BotonCapa>
          <BotonCapa activa={denuncias} onClick={onDenuncias} n={nDenuncias} icono={<MessageSquareWarning size={13} />}>
            Denuncias
          </BotonCapa>
          {nMisZonas > 0 && (
            <BotonCapa activa={misZonas} onClick={onMisZonas} n={nMisZonas} icono={<Bell size={13} />}>
              Mis zonas
            </BotonCapa>
          )}
        </div>

        {sinConexion.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-inkSoft" role="status" aria-live="polite">
            <WifiOff size={13} className="text-clayTexto" aria-hidden />
            sin conexión con {sinConexion.join(" y ")} · reintentando
          </span>
        )}
      </div>

      <LeyendaEscala escala={escala} medida={medidaActual} ambito={ambito} conPines={conPines} cargando={cargando} />
    </div>
  );
}

/**
 * Conmutador de capa. El estado encendido/apagado lo lleva el contraste, no el
 * matiz: el `bg-amber text-paper` que tenía antes da 3,47:1 y no llega al piso
 * de 4,5:1 para texto. Qué capa es cada una lo dicen el ícono y la palabra, que
 * además sobreviven al daltonismo; el color de cada capa se ve en sus puntos.
 */
function BotonCapa({
  activa,
  onClick,
  n,
  icono,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  n: number;
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      disabled={n === 0}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-rapido",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-paperDeep disabled:text-mute",
        activa && n > 0
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paperDeep text-inkSoft hover:bg-paper hover:text-ink",
      )}
      title={n === 0 ? `No hay ${String(children).toLowerCase()} para mostrar` : undefined}
    >
      <span aria-hidden>{icono}</span>
      <span className="hidden sm:inline">{children}</span>
      <span className="font-mono text-[10px] tabular-nums opacity-80">{n.toLocaleString("es-PE")}</span>
    </button>
  );
}
