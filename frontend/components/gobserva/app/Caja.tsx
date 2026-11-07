import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las piezas de cada página de la app (2026-11-07, «no hay headers, footers, paddings, cajas ni tokens»). Todas usan los
 * mismos tokens (globals.css: --lienzo, --caja, --sombra-caja) y la misma escala, así ninguna página inventa la suya:
 *
 *  - `Pagina`: el ancho y el aire de la página sobre el lienzo (16 px al costado en el celular, 32 desde lg).
 *  - `CabeceraPagina`: el título, su bajada y las acciones de la página, alineadas a la derecha.
 *  - `Caja`: un bloque con cabecera (título, bajada y acción), cuerpo con relleno y pie opcional. Entre cajas, 24 px
 *    (`ESPACIO_CAJAS`); dentro, 20 px. La cabecera y el pie van separados del cuerpo con una línea.
 *
 * Server-safe: sin estado ni eventos, sirven en páginas del servidor y en componentes del cliente.
 */

/** El aire entre cajas de una misma página (vertical y en las rejillas). */
export const ESPACIO_CAJAS = "gap-4 sm:gap-6";

/** El enlace del pie de una caja («Ver todo en Para ti →»). */
export const CLASE_ENLACE_PIE =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg text-dato font-semibold text-granate underline-offset-4 transition-colors duration-rapido hover:underline";

/** El ancho y el aire de una página de la app (también para las páginas del servidor que no usan `Pagina`). */
export const CLASE_PAGINA = "mx-auto w-full max-w-[84rem] px-4 pb-10 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12";

export function Pagina({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(CLASE_PAGINA, className)}>{children}</div>;
}

export function CabeceraPagina({
  titulo, bajada, acciones, children, className,
}: {
  titulo: ReactNode;
  bajada?: ReactNode;
  /** Las acciones de la página: la principal al final (a la derecha). */
  acciones?: ReactNode;
  /** Lo que va debajo del título (pestañas, una franja). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 sm:mb-8", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-balance font-display text-cifra font-bold leading-tight tracking-tight text-ink [overflow-wrap:anywhere] sm:text-titulo">
            {titulo}
          </h1>
          {bajada && <p className="mt-1.5 max-w-[68ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
        </div>
        {acciones && <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </header>
  );
}

export function Caja({
  id, titulo, descripcion, accion, pie, children, relleno = true, className, cuerpoClassName, as: Tag = "section",
}: {
  /** Ancla de la caja; el título queda en `${id}-t` (aria-labelledby). */
  id?: string;
  titulo?: ReactNode;
  descripcion?: ReactNode;
  /** A la derecha de la cabecera: un enlace, pestañas o un botón chico. */
  accion?: ReactNode;
  /** Abajo, separado por una línea: «Ver todo», una nota o la paginación. */
  pie?: ReactNode;
  children?: ReactNode;
  /** Sin relleno cuando el cuerpo es una lista que llega a los bordes (cada fila trae el suyo). */
  relleno?: boolean;
  className?: string;
  cuerpoClassName?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  const tituloId = id ? `${id}-t` : undefined;
  return (
    <Tag
      id={id}
      aria-labelledby={titulo && tituloId ? tituloId : undefined}
      className={cn("flex min-w-0 flex-col rounded-2xl border border-line bg-caja shadow-caja", className)}
    >
      {(titulo || accion) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {titulo && (
              <h2 id={tituloId} className="text-pretty font-display text-bloque font-bold leading-snug text-ink">
                {titulo}
              </h2>
            )}
            {descripcion && <p className="mt-0.5 text-pretty text-meta leading-snug text-inkSoft">{descripcion}</p>}
          </div>
          {accion && <div className="flex shrink-0 flex-wrap items-center gap-2">{accion}</div>}
        </div>
      )}
      <div className={cn("min-w-0 flex-1", relleno && "p-4 sm:p-5", cuerpoClassName)}>{children}</div>
      {pie && <div className="rounded-b-2xl border-t border-line bg-ink/[0.025] px-4 py-2.5 sm:px-5">{pie}</div>}
    </Tag>
  );
}

/** Una caja vacía de verdad: el ícono, qué falta y qué hacer, centrados y con aire. */
export function VacioCaja({ Icono, titulo, texto, accion }: { Icono: LucideIcon; titulo: string; texto?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center sm:py-10">
      <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-granate-50 text-granate">
        <Icono size={20} />
      </span>
      <p className="mt-3 text-dato font-semibold text-ink">{titulo}</p>
      {texto && <p className="mt-1 max-w-[44ch] text-pretty text-meta leading-relaxed text-inkSoft">{texto}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}
