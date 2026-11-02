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
 * sección, una cifra con ícono, la tira de cifras de una búsqueda, los pasos, la barra de avance de una obra (lo real
 * contra lo programado) y el paginador.
 */

/**
 * El tono de cada fase, con su punto: la oportunidad (licitándose) resalta y late; lo detenido, en rojo; lo terminado,
 * apagado. «Viable» va con borde y sin relleno: con el gris de los chips de sector no se distinguía la fase.
 */
const TONO_FASE: Record<Fase, { chip: string; punto: string }> = {
  viable: { chip: "bg-paper text-ink ring-1 ring-inset ring-paperEdge", punto: "bg-inkSoft" },
  expediente: { chip: "bg-granate-50 text-granate ring-1 ring-inset ring-granate/30", punto: "bg-granate" },
  licitacion: { chip: "bg-amber-soft text-amberTexto ring-1 ring-inset ring-amber/40", punto: "bg-amber" },
  ejecucion: { chip: "bg-anil/10 text-anilTexto ring-1 ring-inset ring-anil/30", punto: "bg-anil" },
  paralizada: { chip: "bg-crimson-soft text-crimsonTexto ring-1 ring-inset ring-crimson/35", punto: "bg-crimson" },
  terminada: { chip: "bg-paperDeep text-inkSoft ring-1 ring-inset ring-line", punto: "bg-mute" },
  sin_movimiento: { chip: "bg-paperDeep text-mute ring-1 ring-inset ring-line", punto: "bg-mute" },
  cerrada: { chip: "bg-paperDeep text-mute ring-1 ring-inset ring-line", punto: "bg-mute" },
};

/** La fase de un proyecto: lo primero que se lee de cada fila y de cada ficha. `md`, para la cabecera de la ficha. */
export function FaseInsignia({ fase, tamano = "sm", className }: { fase: Fase | null | undefined; tamano?: "sm" | "md"; className?: string }) {
  if (!fase) return null;
  const t = TONO_FASE[fase];
  const md = tamano === "md";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold",
        md ? "px-3 py-1 text-meta" : "px-2.5 py-0.5 text-rotulo",
        t.chip,
        className,
      )}
      title={FASES[fase].detalle}
    >
      <span aria-hidden className={cn("relative inline-flex shrink-0", md ? "h-2 w-2" : "h-1.5 w-1.5")}>
        {fase === "licitacion" && <span className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", t.punto)} />}
        <span className={cn("relative h-full w-full rounded-full", t.punto)} />
      </span>
      {md ? FASES[fase].nombre : FASES[fase].corto}
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
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-3xl">
        <h2 id={id} className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          {titulo}
        </h2>
        {bajada && <p className="mt-2 text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
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

export interface CifraTira {
  Icono: LucideIcon;
  etiqueta: string;
  valor: string;
  /** Una línea debajo del valor: el contexto («de 2,335 entidades», «Gastado este año: S/ 84 M»). */
  detalle?: ReactNode;
  destacado?: boolean;
}

/**
 * Cifras en una sola caja con divisiones (no cuatro tarjetas sueltas): el resumen de una búsqueda o de un proyecto. Dos
 * columnas en el celular y todas en fila desde `sm` (con `enDos`, dos columnas siempre: para una columna angosta). Cada
 * una: qué es (con su ícono) arriba y el valor debajo.
 */
export function TiraCifras({ items, etiqueta, enDos = false, className }: { items: CifraTira[]; etiqueta?: string; enDos?: boolean; className?: string }) {
  const n = items.length;
  return (
    <dl
      aria-label={etiqueta}
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-paper",
        !enDos && (n >= 4 ? "sm:grid-cols-4" : n === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"),
        className,
      )}
    >
      {items.map((x, i) => (
        <div
          key={x.etiqueta}
          className={cn(
            "min-w-0 border-line px-3.5 py-3 sm:px-4",
            i % 2 === 1 && "border-l",
            i >= 2 && (enDos ? "border-t" : "border-t sm:border-t-0"),
            i > 0 && !enDos && "sm:border-l",
            // Impar en dos columnas: la última va a lo ancho, sin hueco al lado.
            n % 2 === 1 && i === n - 1 && (enDos ? "col-span-2" : "col-span-2 sm:col-span-1"),
            x.destacado && "bg-granate-50",
          )}
        >
          <dt className="flex items-center gap-1.5 text-meta leading-snug text-inkSoft">
            <x.Icono size={15} aria-hidden className="shrink-0 text-granate" />
            <span className="min-w-0">{x.etiqueta}</span>
          </dt>
          <dd className="mt-1 font-display text-bloque font-bold leading-tight tabular-nums text-ink sm:text-seccion">{x.valor}</dd>
          {x.detalle && <dd className="mt-0.5 text-rotulo leading-snug text-mute">{x.detalle}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * Un paso de «Cómo funciona»: el número en su círculo, el título con su ícono y una frase. Sin tarjeta: en escritorio los
 * pasos van en fila unidos por una línea (cada uno dibuja la que lo lleva al siguiente, salvo el `ultimo`; el `<ol>` va
 * con `gap-8`), en el celular uno bajo otro.
 */
export function Paso({ n, Icono, titulo, texto, ultimo = false }: { n: number; Icono: LucideIcon; titulo: string; texto: string; ultimo?: boolean }) {
  return (
    <li className="relative flex min-w-0 gap-4 md:flex-col md:gap-0">
      {!ultimo && <span aria-hidden className="absolute left-14 top-[22px] hidden h-px bg-line md:-right-5 md:block" />}
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-granate font-display text-bloque font-bold text-paper">
        {n}
      </span>
      <div className="min-w-0 md:mt-4">
        <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
          <span className="sr-only">Paso {n}: </span>
          <Icono size={18} aria-hidden className="shrink-0 text-granate" />
          {titulo}
        </h3>
        <p className="mt-1.5 max-w-[42ch] text-dato leading-relaxed text-inkSoft">{texto}</p>
      </div>
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
      <p className={cn("flex flex-wrap items-baseline justify-between gap-x-2 text-meta", oscuro ? "text-paper/75" : "text-inkSoft")}>
        <span>{etiqueta}</span>
        <span className="tabular-nums">
          <b className={cn("font-semibold", oscuro ? "text-paper" : atrasada ? "text-crimsonTexto" : "text-ink")}>
            {numero(r)}
            {" "}%
          </b>
          {p != null && <span className={oscuro ? "text-paper/60" : "text-mute"}> de {numero(p)}{" "}% programado</span>}
        </span>
      </p>
      <span
        role="img"
        aria-label={`${etiqueta}: ${numero(r)} %${p != null ? ` de ${numero(p)} % programado` : ""}${atrasada ? ", atrasada" : ""}`}
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
