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
  valor: ReactNode;
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

/** Los cinco pasos de una obra, en orden (el camino de una inversión). */
const PASOS_CAMINO: { fase: Fase; corto: string }[] = [
  { fase: "viable", corto: "Viable" },
  { fase: "expediente", corto: "Expediente" },
  { fase: "licitacion", corto: "Licitación" },
  { fase: "ejecucion", corto: "Ejecución" },
  { fase: "terminada", corto: "Terminada" },
];
const POSICION_CAMINO: Record<Fase, number> = { viable: 0, expediente: 1, licitacion: 2, ejecucion: 3, paralizada: 3, sin_movimiento: 3, terminada: 4, cerrada: 4 };
const LO_QUE_SIGUE: Partial<Record<Fase, string>> = {
  viable: "le falta el expediente técnico",
  expediente: "lo siguiente es licitar la obra",
  licitacion: "lo siguiente es contratar y empezar",
  ejecucion: "la obra está en marcha",
  paralizada: "la obra está paralizada",
  sin_movimiento: "sin gasto ni avance reciente",
  terminada: "falta liquidarla y cerrarla",
};

/**
 * El camino de una obra en una tira de cinco bloques (2026-11-22, «itera sobre todo, esto es texto plano»): lo cumplido
 * lleno, el paso de hoy lleno y latiendo (en rojo si está detenida), lo que falta apagado; debajo, en qué paso está y qué
 * sigue. Se lee de un vistazo en cada tarjeta de la lista. Server-safe.
 */
export function CaminoMini({ fase, oscuro = false, className }: { fase: Fase | null | undefined; oscuro?: boolean; className?: string }) {
  if (!fase || fase === "cerrada") return null;
  const pos = POSICION_CAMINO[fase];
  const detenida = fase === "paralizada" || fase === "sin_movimiento";
  const lleno = oscuro ? "bg-maiz" : "bg-granate";
  return (
    <div className={cn("min-w-0", className)}>
      <ol aria-label={`El camino de la obra: paso ${pos + 1} de 5, ${FASES[fase].nombre.toLocaleLowerCase("es-PE")}`} className="grid grid-cols-5 gap-1">
        {PASOS_CAMINO.map((p, i) => (
          <li
            key={p.fase}
            className={cn(
              "h-1.5 rounded-[2px]",
              i < pos || (i === pos && fase === "terminada")
                ? lleno
                : i === pos
                  ? cn(detenida ? "bg-crimson" : lleno, "motion-safe:animate-pulse")
                  : oscuro
                    ? "bg-paper/15"
                    : "bg-ink/[0.08]",
            )}
          >
            <span className="sr-only">
              {p.corto}
              {i < pos ? " (cumplido)" : i === pos ? " (aquí está)" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p aria-hidden className={cn("mt-1.5 text-rotulo", detenida ? "text-crimsonTexto" : oscuro ? "text-paper/60" : "text-mute")}>
        Paso {pos + 1} de 5{LO_QUE_SIGUE[fase] ? `: ${LO_QUE_SIGUE[fase]}` : ""}
      </p>
    </div>
  );
}

/** Cuánto se gastó del costo, en una barra fina debajo del monto (crece a pasos). Sin costo o sin gasto, nada. */
export function BarraGastado({ costo, gastado, className }: { costo: number | null | undefined; gastado: number | null | undefined; className?: string }) {
  if (!costo || costo <= 0 || !gastado || gastado <= 0) return null;
  const real = Math.min(100, (gastado / costo) * 100);
  return (
    <span role="img" aria-label={`${numero(real)} % del costo ya gastado`} className={cn("mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.07]", className)}>
      <span className="gs-barra-crece block h-full rounded-full bg-granate" style={{ width: `${Math.max(2, real)}%` }} />
    </span>
  );
}

export interface BarraComparada {
  etiqueta: string;
  valor: number | null | undefined;
  /** El texto del valor («S/ 17.1 mil M»). */
  texto: string;
  detalle?: ReactNode;
  tono?: "granate" | "ink" | "amber" | "suave";
}

/**
 * Varios montos uno debajo del otro, cada uno con su barra a la misma escala: se ve de golpe cuánto cambió el costo desde
 * que se declaró viable y cuánto se gastó. Los que no tienen valor dicen su texto sin barra. Server-safe.
 */
export function BarrasComparadas({ items, etiqueta, className }: { items: BarraComparada[]; etiqueta: string; className?: string }) {
  const max = Math.max(...items.map((i) => i.valor ?? 0), 1);
  const TONO = { granate: "bg-granate", ink: "bg-ink/70", amber: "bg-amber", suave: "bg-granate/35" } as const;
  return (
    <ul aria-label={etiqueta} className={cn("space-y-3.5", className)}>
      {items.map((i) => (
        <li key={i.etiqueta} className="min-w-0">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta">
            <span className="text-inkSoft">{i.etiqueta}</span>
            <span className="font-display text-cuerpo font-bold tabular-nums text-ink">{i.texto}</span>
          </p>
          {i.valor != null && i.valor > 0 && (
            <span aria-hidden className="mt-1.5 block h-2.5 overflow-hidden rounded-[3px] bg-ink/[0.06]">
              <span className={cn("gs-barra-crece block h-full rounded-[3px]", TONO[i.tono ?? "granate"])} style={{ width: `${Math.max(1.5, (i.valor / max) * 100)}%` }} />
            </span>
          )}
          {i.detalle && <p className="mt-1 text-rotulo text-mute">{i.detalle}</p>}
        </li>
      ))}
    </ul>
  );
}

export interface Hito {
  etiqueta: string;
  /** ISO (día) o «AAAA-MM» (sólo el mes): para ordenar y saber si ya pasó. */
  fecha: string | null | undefined;
  /** La fecha como se lee («14 nov. 2012», «enero de 2014»). */
  texto: string;
}

/**
 * Las fechas de un proyecto como una línea de tiempo vertical (2026-11-22): cada hito con su punto cuadrado, de lo más
 * viejo a lo que viene, y la marca de HOY entre lo pasado (punto lleno, línea continua) y lo previsto (punto hueco, línea
 * punteada). Los hitos sin fecha van al pie, apagados. Server-safe.
 */
export function LineaTiempo({ hitos, hoy, className }: { hitos: Hito[]; hoy: string; className?: string }) {
  const con = hitos.filter((h) => !!h.fecha).sort((a, b) => (a.fecha! < b.fecha! ? -1 : a.fecha! > b.fecha! ? 1 : 0));
  const sin = hitos.filter((h) => !h.fecha);
  const filas: ({ tipo: "hito"; h: Hito; futuro: boolean } | { tipo: "hoy" })[] = [];
  let hoyPuesto = false;
  for (const h of con) {
    const futuro = h.fecha!.slice(0, 10) > hoy;
    if (futuro && !hoyPuesto) {
      filas.push({ tipo: "hoy" });
      hoyPuesto = true;
    }
    filas.push({ tipo: "hito", h, futuro });
  }
  if (!hoyPuesto) filas.push({ tipo: "hoy" });
  return (
    <div className={className}>
      <ol aria-label="Las fechas del proyecto">
        {filas.map((f, i) => {
          const ultima = i === filas.length - 1;
          const siguienteFutura = !ultima && (filas[i + 1].tipo === "hoy" || (filas[i + 1] as { futuro?: boolean }).futuro);
          if (f.tipo === "hoy") {
            return (
              <li key="hoy" className="relative flex items-center gap-3 pb-4 last:pb-0">
                {!ultima && <span aria-hidden className="absolute bottom-0 left-[11px] top-6 w-0 border-l-2 border-dashed border-line" />}
                <span aria-hidden className="relative z-10 grid h-6 w-6 shrink-0 place-items-center">
                  <span className="absolute h-full w-full rounded-full bg-granate/25 motion-safe:animate-ping" />
                  <span className="relative h-3.5 w-3.5 rounded-full bg-granate ring-4 ring-paper" />
                </span>
                <span className="rounded-full bg-granate px-2.5 py-0.5 text-rotulo font-bold text-paper">Hoy</span>
              </li>
            );
          }
          return (
            <li key={f.h.etiqueta} className="relative flex gap-3 pb-4 last:pb-0">
              {!ultima && (
                <span
                  aria-hidden
                  className={cn("absolute bottom-0 left-[11px] top-6 w-0 border-l-2", f.futuro || siguienteFutura ? "border-dashed border-line" : "border-solid border-granate/45")}
                />
              )}
              <span aria-hidden className="relative z-10 grid h-6 w-6 shrink-0 place-items-center">
                <span className={cn("h-3 w-3 rounded-[3px]", f.futuro ? "border-2 border-granate bg-paper" : "bg-granate")} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-meta leading-tight text-mute">{f.h.etiqueta}</p>
                <p className={cn("mt-0.5 flex flex-wrap items-center gap-1.5 text-dato font-semibold", f.futuro ? "text-inkSoft" : "text-ink")}>
                  {f.h.texto}
                  {f.futuro && <span className="rounded-full bg-paperDeep px-2 py-0.5 text-rotulo font-medium text-mute">previsto</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {sin.length > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-meta text-mute">
          Sin fecha registrada: {sin.map((h) => h.etiqueta.toLocaleLowerCase("es-PE")).join(", ")}.
        </p>
      )}
    </div>
  );
}
