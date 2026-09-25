"use client";

import { Loader2, MapPin } from "lucide-react";
import { useNavegarFiltro } from "./FiltrosHistorico";

interface Opcion { ubigeo: string; nombre: string; hint?: string }

/**
 * Select de región que navega con `?ubigeo=` (sin JS cae al valor de la URL).
 *
 * Usa el mismo `useNavegarFiltro` que los otros dos filtros: antes hacía
 * `router.push(pathname + "?ubigeo=…")` a mano, y eso BORRABA el rango de fechas y el
 * patrocinador cada vez que alguien cambiaba de región.
 */
export function FiltroRegion({ opciones, valor }: { opciones: Opcion[]; valor?: string }) {
  const { navegar, pendiente } = useNavegarFiltro();
  return (
    <label
      // El anillo de foco lo dibuja la etiqueta (focus-within): el <select> va sin borde propio.
      className={`flex min-h-[40px] min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm text-ink focus-within:ring-2 focus-within:ring-granate focus-within:ring-offset-1 ${
        valor ? "border-granate/40 bg-granate-soft" : "border-line bg-paper"
      }`}
    >
      <MapPin size={14} className="shrink-0 text-mute" aria-hidden />
      <span className="sr-only">Filtrar por región</span>
      <select
        value={valor ?? ""}
        onChange={(e) => navegar({ ubigeo: e.target.value || undefined })}
        className="w-full min-w-0 bg-transparent pr-1 text-sm focus:outline-none"
      >
        <option value="">Todo el Perú</option>
        {opciones.map((o) => (
          <option key={o.ubigeo} value={o.ubigeo}>
            {o.nombre}{o.hint ? ` (${o.hint})` : ""}
          </option>
        ))}
      </select>
      {pendiente && <Loader2 size={14} className="shrink-0 animate-spin text-mute" aria-label="Cargando…" />}
    </label>
  );
}
