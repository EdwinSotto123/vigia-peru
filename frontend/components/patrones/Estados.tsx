import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Llamita } from "@/components/marca/Llamita";
import { Skeleton } from "@/components/ui/Skeleton";

/** Nivel del título: `p` dentro de una página; `h1` cuando el estado ES la página (404, error). */
type NivelTitulo = "h1" | "h2" | "h3" | "p";

/**
 * Los estados que toda vista con datos resuelve (DESIGN_SYSTEM.md §10.5): vacío,
 * error y carga. La llamita acompaña los tres: es la que le habla al usuario
 * cuando no hay contenido que hable por sí mismo.
 *
 * Server components: la acción (enlace o botón) llega armada como `accion`, nunca
 * como una función — pasar una función de server a client rompe producción.
 */

/** Nada que mostrar: la llamita, qué falta y qué se puede hacer. */
export function EstadoVacio({
  titulo,
  children,
  accion,
  compacto = false,
  conLlamita = true,
  nivel = "p",
  className,
}: {
  titulo: string;
  nivel?: NivelTitulo;
  /** `false` cuando ya hay una llamita en la pantalla (máximo una, §2.4): dos vacíos juntos. */
  conLlamita?: boolean;
  /** Qué falta, en palabras. */
  children?: ReactNode;
  /** Qué hacer: un `<Link>` o un `<button>` ya armado. */
  accion?: ReactNode;
  compacto?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-line bg-paperSoft text-center",
        compacto ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className,
      )}
    >
      {conLlamita && <Llamita className={cn("text-granate/80", compacto ? "w-7" : "w-10")} />}
      <Titulo nivel={nivel} className={cn("font-display font-bold text-ink text-balance", compacto ? "text-[15px]" : "text-lg")}>{titulo}</Titulo>
      {children && <div className="max-w-md text-sm leading-relaxed text-inkSoft text-pretty">{children}</div>}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  );
}

/** Algo falló: qué pasó en palabras, qué hacer, y el detalle técnico plegado. */
export function EstadoError({
  titulo = "No pudimos cargar esta información",
  children,
  accion,
  detalle,
  nivel = "p",
  conLlamita = true,
  className,
}: {
  titulo?: string;
  nivel?: NivelTitulo;
  /** `false` cuando ya hay una llamita en la pantalla (máximo una, §2.4). */
  conLlamita?: boolean;
  children?: ReactNode;
  accion?: ReactNode;
  /** Texto técnico (código, mensaje del servidor). Va plegado. */
  detalle?: string | null;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-2xl border border-crimson/25 bg-crimson-soft/60 px-6 py-8 text-center", className)}>
      {conLlamita && <Llamita className="w-9 text-crimsonTexto/80" />}
      <Titulo nivel={nivel} className="font-display text-lg font-bold text-crimsonTexto text-balance">{titulo}</Titulo>
      <div className="max-w-md text-sm leading-relaxed text-inkSoft text-pretty">
        {children ?? "Suele ser momentáneo. Vuelve a intentarlo en unos segundos."}
      </div>
      {accion && <div className="mt-1">{accion}</div>}
      {detalle && (
        <details className="mt-1 text-left text-xs text-mute">
          <summary className="cursor-pointer select-none">Detalle técnico</summary>
          <p className="mt-1 max-w-md break-words font-mono">{detalle}</p>
        </details>
      )}
    </div>
  );
}

/**
 * Esperando datos: esqueleto con la forma del contenido y la llamita caminando
 * (quieta con prefers-reduced-motion). Siempre visible desde el primer pintado:
 * nunca opacity 0 servido desde el servidor.
 */
export function Cargando({
  texto = "Cargando…",
  lineas = 3,
  className,
}: {
  texto?: string;
  lineas?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("rounded-2xl border border-line bg-paper p-5", className)}>
      <div className="flex items-center gap-2.5 text-sm text-mute">
        <Llamita caminando className="w-6 text-granate/70" />
        <span>{texto}</span>
      </div>
      <div className="mt-4 space-y-2.5" aria-hidden>
        {Array.from({ length: lineas }, (_, i) => (
          <Skeleton key={i} className={cn("h-3.5", i === lineas - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

function Titulo({ nivel, className, children }: { nivel: NivelTitulo; className: string; children: ReactNode }) {
  const Etiqueta = nivel;
  return <Etiqueta className={className}>{children}</Etiqueta>;
}
