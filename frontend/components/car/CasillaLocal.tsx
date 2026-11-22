import type { ReactNode } from "react";
import { ArrowUpRight, FileCheck2, MapPin, Phone } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { direccionLegible } from "@/components/salud/ficha/piezas";
import { fechaCorta, nombrePropio } from "@/lib/gobserva-salud";
import { lugarDe, urlMapa, type Local } from "./directorio";

/**
 * Un local autorizado por el MTC como casilla (Gobserva Car): su dibujo, el nombre, dónde queda, la dirección con su enlace
 * al mapa, lo propio de cada lista (`children`: las líneas de un CITV, el tipo de gas) y, si los hay, el teléfono y la
 * resolución al pie. Sin teléfono ni resolución (los centros médicos) no hay pie: la casilla es más corta en el celular.
 */
export function CasillaLocal({ l, sprite, children, sinNombre = "Persona natural con negocio" }: { l: Local; sprite: NombreSprite; children?: ReactNode; sinNombre?: string }) {
  const mapa = urlMapa(l);
  const nombre = l.nombre ? nombrePropio(l.nombre) : sinNombre;
  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-granate-50 p-1.5">
          <Pixel nombre={sprite} escala={3} animado={false} acento="accion" className="max-h-full max-w-full" />
        </span>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-cuerpo font-bold leading-snug text-ink">{nombre}</h3>
          <p className="mt-0.5 flex items-start gap-1 text-meta text-inkSoft">
            <MapPin size={13} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <span>{lugarDe(l)}</span>
          </p>
        </div>
      </div>
      <div className="mt-2.5 space-y-2 px-4 pb-3.5 text-meta">
        {l.direccion && (
          <p className="text-inkSoft">
            <span className="line-clamp-3">{direccionLegible(l.direccion)}</span>
            {mapa && (
              <a href={mapa} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex min-h-9 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                Ver en el mapa <ArrowUpRight size={13} aria-hidden />
                <span className="sr-only"> ({nombre}, se abre en otra pestaña)</span>
              </a>
            )}
          </p>
        )}
        {children}
      </div>
      {(l.telefono || l.resolucion) && (
        <div className="mt-auto border-t border-line bg-paperSoft/50 px-4 py-2.5 text-rotulo text-inkSoft">
          <div className="min-w-0 space-y-1">
            {l.telefono && (
              <p className="flex items-center gap-1.5">
                <Phone size={12} aria-hidden className="shrink-0 text-mute" />
                {l.telefono.includes("•") ? (
                  <span title="Número de celular: lo tapamos por privacidad">{l.telefono}</span>
                ) : (
                  <a href={`tel:${l.telefono.replace(/[^\d+]/g, "")}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                    {l.telefono}
                  </a>
                )}
              </p>
            )}
            {l.resolucion && (
              <p className="flex items-center gap-1.5">
                <FileCheck2 size={12} aria-hidden className="shrink-0 text-mute" />
                <span className="min-w-0 break-words">
                  Autorizado: {l.resolucion}
                  {l.fechaResolucion ? `, ${fechaCorta(l.fechaResolucion)}` : ""}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** La rejilla de casillas (una columna en el celular, dos desde 560 px, tres en pantallas anchas). */
export const REJILLA_LOCALES = "grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-3";
