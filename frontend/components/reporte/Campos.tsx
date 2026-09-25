"use client";

// Piezas que repetían FormObra y FormEntidad, cada uno con su copia: la grilla de
// categorías (antes con emojis sueltos en vez de los íconos del catálogo de
// denuncias), el error junto al campo y el aviso de envío fallido.

import { AlertTriangle } from "lucide-react";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { cn } from "@/lib/utils";

/** Clase de los campos de texto del formulario (DESIGN_SYSTEM.md §5: inputs `rounded-xl`, hundidos). */
export const CAMPO = "w-full rounded-xl border border-line bg-paperDeep px-4 py-2.5 text-sm text-ink placeholder:text-mute focus:border-granate";
/** Etiqueta visible de un campo. */
export const ETIQUETA = "mb-1 block text-[13px] font-semibold text-inkSoft";

/**
 * Elegir la categoría de la denuncia. Cada opción lleva el ícono de su categoría
 * (el mismo que la tarjeta pública) y la elegida se marca en granate: selección,
 * no advertencia.
 */
export function OpcionesCategoria({
  opciones,
  elegida,
  onElegir,
  etiqueta,
  permiteQuitar = false,
}: {
  opciones: { id: CategoriaDenuncia; label: string }[];
  elegida: string;
  onElegir: (id: string) => void;
  /** Nombre del grupo para el lector de pantalla. */
  etiqueta: string;
  /** Si tocar la elegida la desmarca (categoría opcional). */
  permiteQuitar?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={etiqueta}>
      {opciones.map((c) => {
        const activa = elegida === c.id;
        const Icono = CATEGORIA_META[c.id].icon;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={activa}
            onClick={() => onElegir(activa && permiteQuitar ? "" : c.id)}
            className={cn(
              "flex min-h-[48px] items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors duration-rapido",
              activa
                ? "border-granate bg-granate-soft font-semibold text-granate"
                : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
            )}
          >
            <Icono size={18} className={cn("shrink-0", activa ? "text-granate" : "text-mute")} aria-hidden />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** Error en línea, junto al campo que lo causó. */
export function ErrorCampo({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-xs text-crimsonTexto">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** Qué falló al enviar, en palabras, sobre el botón de enviar. */
export function ErrorEnvio({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-crimson/25 bg-crimson-soft px-3 py-2.5 text-sm text-crimsonTexto" role="alert">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {children}
    </p>
  );
}
