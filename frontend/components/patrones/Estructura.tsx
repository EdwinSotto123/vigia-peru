import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta } from "@/lib/formato";

/**
 * Piezas de estructura de página (DESIGN_SYSTEM.md §11.3 y §14). Una página
 * compone estas piezas y no define tipografías, colores ni espaciados propios.
 */

/**
 * El contenedor de toda página de la app (§10.7): usa el ancho que deja la barra
 * lateral, alineado a la izquierda, con el mismo padding en todas. Nada de
 * `mx-auto max-w-*` por página: centrar una vista de datos deja columnas vacías.
 * `lectura` es para prosa (preguntas, noticia): ahí sí conviene una medida de línea.
 */
export function Pagina({
  children,
  ancho = "datos",
  className,
}: {
  children: ReactNode;
  ancho?: "datos" | "lectura";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10",
        ancho === "datos" ? "max-w-[1600px]" : "max-w-3xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Título de página (el único h1), bajada y acciones. Sin kicker encima del título.
 * La bajada es UNA oración (≤ 140 caracteres); lo que explique más va en `ayuda`,
 * un ⓘ junto al título que abre la explicación al clic (§10.7).
 */
export function EncabezadoPagina({
  titulo,
  bajada,
  ayuda,
  acciones,
  className,
}: {
  titulo: ReactNode;
  bajada?: ReactNode;
  /** `<Ayuda titulo="¿Qué es…?">…</Ayuda>` ya armado. */
  ayuda?: ReactNode;
  acciones?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 max-w-3xl">
        {/* El ⓘ va al final de la bajada (lo que amplía), no junto al h1: un título que
            parte en dos líneas ocupa todo el ancho y empujaba el ⓘ al borde derecho. */}
        {bajada ? (
          <>
            <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[32px]">{titulo}</h1>
            <p className="mt-1.5 text-[15px] leading-snug text-inkSoft text-pretty">
              {bajada}
              {ayuda && <span className="ml-1 inline-flex align-middle">{ayuda}</span>}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[32px]">{titulo}</h1>
            {ayuda}
          </div>
        )}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

/** Una sección: h2, descripción opcional y contenido, con el ritmo vertical del sistema. */
export function Seccion({
  titulo,
  descripcion,
  ayuda,
  acciones,
  id,
  children,
  className,
}: {
  titulo: ReactNode;
  /** Una línea, o nada. Lo demás, en `ayuda`. */
  descripcion?: ReactNode;
  ayuda?: ReactNode;
  acciones?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-titulo` : undefined} className={cn("scroll-mt-24", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 id={id ? `${id}-titulo` : undefined} className="font-display text-[20px] font-bold leading-tight text-ink text-balance">
              {titulo}
            </h2>
            {ayuda}
          </div>
          {descripcion && <p className="mt-0.5 text-sm leading-snug text-inkSoft text-pretty">{descripcion}</p>}
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
