import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Building,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Factory,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  RadioTower,
  Route,
  Scale,
  ShieldCheck,
  Sprout,
  Theater,
  Users,
  Zap,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { FASES, type Fase } from "@/lib/gobserva-obras";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Piezas de Gobserva Obras, todas server-safe: la insignia de la fase, el ícono de cada sector, la cabecera de una
 * sección, una cifra con ícono, los pasos, la barra de avance de una obra (lo real contra lo programado) y el paginador.
 */

/** El tono de cada fase: la oportunidad (licitándose) resalta; lo detenido, en rojo; lo terminado, apagado. */
const TONO_FASE: Record<Fase, string> = {
  viable: "bg-paperDeep text-inkSoft",
  expediente: "bg-granate-50 text-granate ring-1 ring-inset ring-granate/25",
  licitacion: "bg-amber-soft text-amberTexto ring-1 ring-inset ring-amber/30",
  ejecucion: "bg-anil/10 text-anilTexto ring-1 ring-inset ring-anil/25",
  paralizada: "bg-crimson-soft text-crimsonTexto ring-1 ring-inset ring-crimson/30",
  terminada: "bg-paperDeep text-mute",
  sin_movimiento: "bg-paperDeep text-mute",
  cerrada: "bg-paperDeep text-mute",
};

export function FaseInsignia({ fase, className }: { fase: Fase | null | undefined; className?: string }) {
  if (!fase) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-rotulo font-semibold", TONO_FASE[fase], className)} title={FASES[fase].detalle}>
      {fase === "licitacion" && (
        <span aria-hidden className="relative inline-flex h-2 w-2">
          <span className="absolute inset-0 rounded-full bg-amber opacity-60 motion-safe:animate-ping" />
          <span className="relative h-2 w-2 rounded-full bg-amber" />
        </span>
      )}
      {FASES[fase].corto}
    </span>
  );
}

/** El ícono de cada sector. */
export const ICONO_SECTOR: Record<string, LucideIcon> = {
  transporte: Route,
  saneamiento: Droplets,
  educacion: GraduationCap,
  salud: HeartPulse,
  agro: Sprout,
  urbano: Building,
  deporte: Theater,
  energia: Zap,
  ambiente: Leaf,
  seguridad: ShieldCheck,
  gestion: Landmark,
  social: Users,
  comercio: Factory,
  justicia: Scale,
  comunicaciones: RadioTower,
  otros: Shapes,
};
export const iconoSector = (s: string | null | undefined): LucideIcon => (s && ICONO_SECTOR[s]) || Shapes;

/** El título de una sección, su bajada y, si hay, la acción a la derecha. */
export function Cabecera({ id, titulo, bajada, accion }: { id: string; titulo: string; bajada?: ReactNode; accion?: { href: string; etiqueta: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        <h2 id={id} className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          {titulo}
        </h2>
        {bajada && <p className="mt-2 text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
      </div>
      {accion && (
        <Link href={accion.href} className="inline-flex shrink-0 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          {accion.etiqueta} <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * Una cifra con su ícono: el número grande y qué es. `destacado` la pone sobre el tinte de la marca. En el celular va en
 * fila (el ícono a la izquierda), a lo ancho: un monto como «S/ 662.8 mil M» no entra en media pantalla.
 */
export function Dato({
  Icono,
  valor,
  etiqueta,
  detalle,
  destacado = false,
  className,
}: {
  Icono: LucideIcon;
  valor: string;
  etiqueta: string;
  detalle?: ReactNode;
  destacado?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-2xl border px-4 py-3 sm:p-4", destacado ? "border-granate/40 bg-granate-50" : "border-line bg-paper", className)}>
      <dt className="sr-only">{etiqueta}</dt>
      <dd className="flex min-w-0 items-start gap-3 sm:block">
        <Icono size={18} aria-hidden className="mt-1 shrink-0 text-granate sm:mt-0" />
        <span className="block min-w-0">
          <span className="block font-display text-seccion font-bold leading-none tabular-nums text-ink sm:mt-2 sm:text-cifra">{valor}</span>
          <span className="mt-1.5 block text-meta leading-snug text-inkSoft">{etiqueta}</span>
          {detalle && <span className="mt-1 block text-rotulo leading-snug text-mute">{detalle}</span>}
        </span>
      </dd>
    </div>
  );
}

/** Un paso de «Cómo funciona». */
export function Paso({ n, Icono, titulo, texto }: { n: number; Icono: LucideIcon; titulo: string; texto: string }) {
  return (
    <li className="relative min-w-0 rounded-2xl border border-line bg-paper p-5">
      <span aria-hidden className="absolute right-5 top-4 font-mono text-cifra font-bold text-granate/15">
        {n}
      </span>
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-granate-50 text-granate">
        <Icono size={20} />
      </span>
      <h3 className="mt-4 font-display text-bloque font-bold leading-tight text-ink">
        <span className="sr-only">Paso {n}: </span>
        {titulo}
      </h3>
      <p className="mt-2 text-dato leading-relaxed text-inkSoft">{texto}</p>
    </li>
  );
}

/**
 * El avance de una obra: la barra de lo real (físico) y la marca de lo programado. Atrasada (20 puntos o más bajo lo
 * programado), la barra va en el tono de alerta. Sin dato, lo dice.
 */
export function BarraAvance({
  real,
  programado,
  etiqueta = "Avance físico",
  pie,
  oscuro = false,
  className,
}: {
  real: number | null | undefined;
  programado?: number | null;
  etiqueta?: string;
  pie?: ReactNode;
  oscuro?: boolean;
  className?: string;
}) {
  if (real == null) return <p className={cn("text-meta", oscuro ? "text-paper/60" : "text-mute", className)}>{etiqueta}: sin dato en INFOBRAS</p>;
  const r = Math.max(0, Math.min(100, real));
  const p = programado != null ? Math.max(0, Math.min(100, programado)) : null;
  const atrasada = p != null && p - r >= 20;
  return (
    <div className={cn("min-w-0", className)}>
      <p className={cn("flex items-baseline justify-between gap-2 text-meta", oscuro ? "text-paper/75" : "text-inkSoft")}>
        <span>{etiqueta}</span>
        <span className={cn("font-mono font-semibold tabular-nums", oscuro ? "text-paper" : "text-ink")}>
          {numero(r)}
          {" "}%{p != null && <span className={cn("font-normal", oscuro ? "text-paper/60" : "text-mute")}> de {numero(p)}{" "}% programado</span>}
        </span>
      </p>
      <span
        role="img"
        aria-label={`${etiqueta}: ${numero(r)} %${p != null ? ` de ${numero(p)} % programado` : ""}`}
        className={cn("relative mt-1.5 block h-2 overflow-visible rounded-full", oscuro ? "bg-paper/15" : "bg-paperDeep")}
      >
        <span className={cn("block h-full rounded-full", atrasada ? "bg-crimson" : oscuro ? "bg-maiz" : "bg-granate")} style={{ width: `${Math.max(r, 1.5)}%` }} />
        {p != null && (
          <span aria-hidden className={cn("absolute -top-1 h-4 w-0.5 rounded-full", oscuro ? "bg-paper" : "bg-ink")} style={{ left: `calc(${p}% - 1px)` }} />
        )}
      </span>
      {pie && <p className={cn("mt-1 text-rotulo", oscuro ? "text-paper/55" : "text-mute")}>{pie}</p>}
    </div>
  );
}

/** Anterior, «página X de Y» y siguiente, como enlaces (la página va en la URL). */
export function Paginador({ pagina, paginas, href, total }: { pagina: number; paginas: number; href: (p: number) => string; total?: ReactNode }) {
  if (paginas <= 1) return null;
  const boton =
    "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate";
  return (
    <nav aria-label="Páginas de la lista" className="flex flex-wrap items-center justify-center gap-3">
      {pagina > 1 ? (
        <Link href={href(pagina - 1)} className={boton} scroll>
          <ChevronLeft size={16} aria-hidden /> Anterior
        </Link>
      ) : (
        <span className={cn(boton, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronLeft size={16} /> Anterior
        </span>
      )}
      <span className="text-dato tabular-nums text-inkSoft">
        Página <b className="text-ink">{numero(pagina)}</b> de {numero(paginas)}
        {total}
      </span>
      {pagina < paginas ? (
        <Link href={href(pagina + 1)} className={boton} scroll>
          Siguiente <ChevronRight size={16} aria-hidden />
        </Link>
      ) : (
        <span className={cn(boton, "pointer-events-none opacity-40")} aria-hidden>
          Siguiente <ChevronRight size={16} />
        </span>
      )}
    </nav>
  );
}
