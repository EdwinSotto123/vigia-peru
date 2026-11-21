import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight, Phone, Siren } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las piezas de página de Gobserva Salud (2026-11-20), server-safe: la ruta de arriba, el encabezado (h1 con su bajada), la
 * cabecera de una sección (h2), la tesela de una cifra con su fuente y el aviso de emergencias. Las mismas medidas que
 * las páginas de Obras (components/gobserva-obras/Piezas.tsx), sin depender de ese producto.
 */

/** La ruta arriba de una página interna: «Inicio › Sanciones». En el celular, sólo el paso anterior (para volver). */
export function Ruta({ items }: { items: { etiqueta: string; href?: string }[] }) {
  return (
    <nav aria-label="Ruta de navegación" className="text-meta">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((m, i) => {
          const ultima = i === items.length - 1;
          return (
            <li key={`${i}-${m.etiqueta}`} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", !ultima && i < items.length - 2 && "max-sm:hidden")}>
              {i > 0 && <ChevronRight size={14} aria-hidden className={cn("shrink-0 text-mute", i === items.length - 2 && items.length > 2 && "max-sm:hidden")} />}
              {m.href && !ultima ? (
                <Link href={m.href} className="inline-flex min-h-11 items-center truncate text-inkSoft underline-offset-4 hover:text-ink hover:underline sm:min-h-0">
                  {m.etiqueta}
                </Link>
              ) : (
                <span aria-current={ultima ? "page" : undefined} className={ultima ? "truncate font-semibold text-ink" : "truncate text-inkSoft"}>
                  {m.etiqueta}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** El encabezado de una página: el h1, una bajada y lo que vaya debajo (la fuente con su fecha, acciones). */
export function Encabezado({ titulo, bajada, children, className }: { titulo: ReactNode; bajada?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn("max-w-4xl", className)}>
      <h1 className="text-balance font-display text-cifra font-bold leading-tight tracking-[-0.02em] text-ink sm:text-titulo">{titulo}</h1>
      {bajada && <p className="mt-2 max-w-[70ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

/** La cabecera de una sección: h2, una bajada y, a la derecha, un enlace. */
export function CabeceraSeccion({
  id,
  titulo,
  bajada,
  accion,
  grande = false,
}: {
  id: string;
  titulo: ReactNode;
  bajada?: ReactNode;
  accion?: { href: string; etiqueta: string };
  /** En la portada: un escalón más (vitrina desde sm). */
  grande?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-3xl">
        <h2
          id={id}
          // La interlínea después del tamaño: tailwind-merge quita un `leading-*` que va antes de un `text-*`.
          className={cn("text-balance font-display font-bold tracking-[-0.02em] text-ink", grande ? "text-titulo sm:text-vitrina" : "text-seccion sm:text-titulo", "leading-[1.1]")}
        >
          {titulo}
        </h2>
        {bajada && <p className="mt-3 max-w-[66ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
      </div>
      {accion && (
        <Link href={accion.href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          {accion.etiqueta} <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * Una cifra con su ícono, qué es y de dónde sale: «27,000 IPRESS activas», «Fuente: RENIPRESS (SUSALUD), al 20 nov. 2026».
 * Ninguna cifra va sin su fuente (`pie`).
 */
export function Tesela({
  Icono,
  valor,
  etiqueta,
  detalle,
  pie,
  tono = "normal",
  href,
  className,
}: {
  Icono: LucideIcon;
  valor: string;
  etiqueta: ReactNode;
  detalle?: ReactNode;
  pie: ReactNode;
  /** `hecho`: el tono de la sanción firme; `denuncia`: el de la denuncia (los de InsigniaHecho, sólo para esas cifras). */
  tono?: "normal" | "hecho" | "denuncia";
  href?: string;
  className?: string;
}) {
  // Con `href`, toda la tesela lleva a la lista (el enlace de la etiqueta se estira sobre ella); la fuente queda encima, con
  // su propio enlace (un <a> dentro de otro no es HTML válido).
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col justify-between rounded-2xl border border-line bg-paper p-4 sm:p-5",
        href && "transition-colors duration-rapido focus-within:border-granate/50 hover:border-granate/40",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
            tono === "hecho" ? "bg-crimson-soft text-crimsonTexto" : tono === "denuncia" ? "bg-amber-soft text-amberTexto" : "bg-granate-50 text-granate",
          )}
        >
          <Icono size={19} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-cifra font-bold leading-none tabular-nums text-ink">{valor}</p>
          <p className="mt-1.5 text-dato font-semibold leading-snug text-ink">
            {href ? (
              <Link href={href} className="underline-offset-4 after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:underline focus-visible:outline-none">
                {etiqueta}
              </Link>
            ) : (
              etiqueta
            )}
          </p>
          {detalle && <p className="mt-0.5 text-meta leading-snug text-inkSoft">{detalle}</p>}
        </div>
      </div>
      <div className="relative z-10 mt-3 border-t border-line pt-2.5">{pie}</div>
    </div>
  );
}

/** Un paso numerado: el número, su título con ícono, el texto y, si hay, el enlace que lo hace. */
export function PasoNumerado({
  n,
  Icono,
  titulo,
  children,
  accion,
  ilustracion,
}: {
  n: number;
  Icono: LucideIcon;
  titulo: string;
  children: ReactNode;
  accion?: { href: string; etiqueta: string; externo?: boolean };
  /** Una escena de píxeles (components/salud/pixel) sobre el título: decorativa, sobre su suelo. */
  ilustracion?: ReactNode;
}) {
  return (
    <li className="relative flex min-w-0 gap-4">
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-granate font-display text-bloque font-bold text-paper">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        {ilustracion && (
          <div aria-hidden className="mb-4 flex h-40 items-end justify-center gap-4 overflow-hidden rounded-2xl border border-line bg-paperSoft px-4 pt-3">
            <div className="flex w-full items-end justify-center gap-4 border-b-[5px] border-dashed border-[rgb(var(--px-linea)/0.25)] pb-0">{ilustracion}</div>
          </div>
        )}
        <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
          <span className="sr-only">Paso {n}: </span>
          <Icono size={18} aria-hidden className="shrink-0 text-granate" />
          {titulo}
        </h3>
        <div className="mt-1.5 max-w-[52ch] text-dato leading-relaxed text-inkSoft">{children}</div>
        {accion &&
          (accion.externo ? (
            <a
              href={accion.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
            >
              {accion.etiqueta} <ArrowRight size={15} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          ) : (
            <Link href={accion.href} className="mt-2 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
              {accion.etiqueta} <ArrowRight size={15} aria-hidden />
            </Link>
          ))}
      </div>
    </li>
  );
}

/** «¿Es una emergencia? Llama al 106 (SAMU) o al 113»: con los números para tocar en el celular. */
export function AvisoEmergencia({ oscuro = false, className }: { oscuro?: boolean; className?: string }) {
  const enlace = oscuro
    ? "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-paper/25 px-3.5 font-display font-bold tabular-nums text-paper transition-colors duration-rapido hover:bg-paper/10"
    : "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 font-display font-bold tabular-nums text-ink transition-colors duration-rapido hover:border-granate/40";
  return (
    <div role="note" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-dato", oscuro ? "text-paper/80" : "text-inkSoft", className)}>
      <span className="inline-flex items-center gap-2">
        <Siren size={17} aria-hidden className={oscuro ? "text-alertaBanda" : "text-crimsonTexto"} />
        <span>
          <b className={cn("font-semibold", oscuro ? "text-paper" : "text-ink")}>¿Es una emergencia?</b> No busques aquí: llama.
        </span>
      </span>
      <span className="flex flex-wrap gap-2">
        <a href="tel:106" className={enlace}>
          <Phone size={14} aria-hidden /> 106 <span className="font-sans text-meta font-medium">SAMU</span>
        </a>
        <a href="tel:113" className={enlace}>
          <Phone size={14} aria-hidden /> 113 <span className="font-sans text-meta font-medium">Línea de salud</span>
        </a>
      </span>
    </div>
  );
}
