import { cn } from "@/lib/utils";
import { TONO, type Tone } from "./tono";

const RELLENO = { none: "", sm: "p-3", md: "p-3.5 sm:p-4" } as const;

/**
 * Caja base del panel: borde fino, radio 2xl, superficie `paperSoft` sobre la página carbón (la misma
 * jerarquía que el sitio público: la tarjeta apenas más clara que el fondo, sin sombra). `tono` la tiñe
 * (avisos, tarjetas destacadas).
 */
export function Card({
  tono,
  relleno = "md",
  className,
  children,
  id,
}: {
  tono?: Tone;
  relleno?: keyof typeof RELLENO;
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className={cn("rounded-2xl border", tono ? TONO[tono].caja : "border-line bg-paperSoft", RELLENO[relleno], className)}>
      {children}
    </div>
  );
}

/**
 * Caja con cabecera (título, descripción, acciones) y cuerpo. `sinRelleno` deja
 * el cuerpo a sangre para tablas y listas con separadores propios.
 */
export function Panel({
  titulo,
  descripcion,
  acciones,
  pie,
  sinRelleno,
  tono,
  className,
  id,
  children,
}: {
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  acciones?: React.ReactNode;
  pie?: React.ReactNode;
  sinRelleno?: boolean;
  tono?: Tone;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("overflow-hidden rounded-2xl border", tono ? TONO[tono].caja : "border-line bg-paperSoft", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-4 pt-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-dato font-semibold leading-snug text-ink">{titulo}</h3>
          {descripcion && <p className="mt-0.5 text-meta leading-snug text-mute">{descripcion}</p>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-1.5">{acciones}</div>}
      </header>
      <div className={sinRelleno ? "mt-2.5 border-t border-line" : "px-4 pb-3 pt-2.5 sm:px-5 sm:pb-4"}>{children}</div>
      {pie && <footer className="border-t border-line px-4 py-2.5 text-rotulo text-inkSoft sm:px-5">{pie}</footer>}
    </section>
  );
}
