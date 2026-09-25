import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta } from "@/lib/formato";

/**
 * Piezas de estructura de página (DESIGN_SYSTEM.md §11.3 y §14). Una página
 * compone estas piezas y no define tipografías, colores ni espaciados propios.
 */

/** Título de página (el único h1), bajada y acciones. Sin kicker encima del título. */
export function EncabezadoPagina({
  titulo,
  bajada,
  acciones,
  className,
}: {
  titulo: ReactNode;
  bajada?: ReactNode;
  acciones?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 max-w-3xl">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[34px]">{titulo}</h1>
        {bajada && <p className="mt-2 text-[15px] leading-relaxed text-inkSoft text-pretty">{bajada}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

/** Una sección: h2, descripción opcional y contenido, con el ritmo vertical del sistema. */
export function Seccion({
  titulo,
  descripcion,
  acciones,
  id,
  children,
  className,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-titulo` : undefined} className={cn("scroll-mt-24", className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-titulo` : undefined} className="font-display text-[22px] font-bold leading-tight text-ink text-balance">
            {titulo}
          </h2>
          {descripcion && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-inkSoft text-pretty">{descripcion}</p>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Una cifra con su contexto obligatorio (DESIGN_SYSTEM.md §10.2): un número
 * suelto no dice nada. `contexto` es el denominador, la fuente o la fecha.
 */
export function Cifra({
  valor,
  etiqueta,
  contexto,
  tono = "claro",
  className,
}: {
  /** Ya formateado con lib/formato ("18,393", "S/ 1.3 M", "Sin dato"). */
  valor: ReactNode;
  etiqueta: ReactNode;
  contexto: ReactNode;
  tono?: "claro" | "oscuro";
  className?: string;
}) {
  const oscuro = tono === "oscuro";
  return (
    <div className={cn("min-w-0", className)}>
      <p className={cn("font-display text-[28px] font-extrabold leading-none tabular-nums", oscuro ? "text-maiz" : "text-ink")}>{valor}</p>
      <p className={cn("mt-2 text-sm font-semibold", oscuro ? "text-paper" : "text-ink")}>{etiqueta}</p>
      <p className={cn("mt-0.5 text-[13px] leading-snug", oscuro ? "text-paper/75" : "text-mute")}>{contexto}</p>
    </div>
  );
}

/** De dónde sale un dato y de cuándo es: "Fuente: SEACE · 14 set. 2026", con enlace al registro. */
export function FuenteDato({
  fuente,
  fecha,
  href,
  className,
}: {
  fuente: string;
  fecha?: string | null;
  href?: string | null;
  className?: string;
}) {
  const texto = (
    <>
      Fuente: {fuente}
      {fecha ? ` · ${fechaCorta(fecha)}` : ""}
    </>
  );
  return (
    <p className={cn("text-xs text-mute", className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-granate hover:underline">
          {texto} <ExternalLink size={11} aria-hidden />
        </a>
      ) : (
        texto
      )}
    </p>
  );
}
