import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Los estados de cualquier pantalla de la app: vacío (qué falta y qué hacer), error (qué pasó y cómo reintentar) y carga
 * (un esqueleto con la forma de lo que viene, no un spinner). Server-safe.
 */
export function EstadoVacio({ Icono = SearchX, titulo, texto, acciones, className }: { Icono?: LucideIcon; titulo: string; texto?: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-10 text-center sm:py-14", className)}>
      <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-ink/[0.06] text-inkSoft">
        <Icono size={22} />
      </span>
      <p className="mt-4 text-cuerpo font-semibold text-ink">{titulo}</p>
      {texto && <div className="mt-1.5 max-w-[48ch] text-pretty text-dato leading-relaxed text-inkSoft">{texto}</div>}
      {acciones && <div className="mt-5 flex flex-wrap justify-center gap-2">{acciones}</div>}
    </div>
  );
}

export function EstadoError({ titulo = "No pudimos cargar esto", texto, acciones }: { titulo?: string; texto?: ReactNode; acciones?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-10 text-center sm:py-14">
      <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-crimson-soft text-crimsonTexto">
        <AlertTriangle size={22} />
      </span>
      <p className="mt-4 text-cuerpo font-semibold text-ink">{titulo}</p>
      {texto && <div className="mt-1.5 max-w-[48ch] text-pretty text-dato leading-relaxed text-inkSoft">{texto}</div>}
      {acciones && <div className="mt-5 flex flex-wrap justify-center gap-2">{acciones}</div>}
    </div>
  );
}

export function Bloque({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-ink/[0.07]", className)} />;
}

/** El esqueleto de una tabla: la cabecera y N filas con la forma de las de verdad. */
export function EsqueletoTabla({ filas = 8 }: { filas?: number }) {
  return (
    <div role="status" aria-label="Cargando" className="divide-y divide-line">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex gap-4 px-4 py-4 sm:px-5">
          <Bloque className="h-5 w-5 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bloque className="h-4 w-11/12 max-w-xl" />
            <Bloque className="h-3 w-2/3 max-w-sm" />
          </div>
          <Bloque className="hidden h-4 w-24 md:block" />
          <Bloque className="hidden h-5 w-20 lg:block" />
        </div>
      ))}
    </div>
  );
}
