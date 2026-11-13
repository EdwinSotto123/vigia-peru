import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, ExternalLink, Info, PanelRightOpen, RotateCw, type LucideIcon } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { cn } from "@/lib/utils";
import { EnlaceInicio, ListaConteos, type FilaConteo } from "./BloquesInicio";

/**
 * El Inicio de una ficha (entidad, región, partido) en UNA pantalla de escritorio (pedido del dueño del 2026-11-13: «todo
 * apilado de arriba abajo», «información repetida», «scroll sin fin»). Arriba, las cifras de la ficha; debajo, una fila
 * de cajas con borde de 1 px que usa el ancho:
 *
 *   ┌ Señales para revisar ┐ ┌ Quién gobierna ──────┐ ┌ Ver más ──────────────┐
 *   │ las tres que más     │ │ partido, autoridad,  │ │ una fila por pestaña  │
 *   │ pesan, con su lista  │ │ período, quién       │ │ con su cifra clave, o │
 *   │ ya filtrada          │ │ decide               │ │ un panel al costado   │
 *   └──────────────────────┘ └──────────────────────┘ └───────────────────────┘
 *
 * Lo demás ya vive en su pestaña (Compras, Personas, Obras, Control…): aquí se enlaza con una fila, no se repite. Lo que no
 * tiene pestaña propia (las empresas ligadas a la gestión, los parientes que le venden, las plazas de una gestión
 * saliente, en qué gasta una región) se abre en un panel al costado, sin salir de la ficha. Sin estado: sirve en el
 * servidor.
 */

/** La fila de cajas del resumen: una columna en el celular, dos desde lg y tres desde xl. Cada caja, del alto de la fila. */
export function RejillaResumen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 lg:grid-cols-2 xl:grid-cols-3", className)}>{children}</div>;
}

/**
 * Una caja del resumen: borde de 1 px, su título (h3) en una franja de cabecera con su ⓘ y su «Ver … ›», y el contenido.
 * `flush`: sin margen a los lados, para las listas que ya traen el suyo (ListaConteos, ListaMas).
 */
export function CajaResumen({
  titulo,
  ayuda,
  enlace,
  flush = false,
  className,
  children,
}: {
  titulo: string;
  ayuda?: ReactNode;
  enlace?: { href: string; texto: string };
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("tarjeta flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-paper", className)}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-line px-4 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="font-display text-cuerpo font-bold leading-snug text-ink">{titulo}</h3>
          {ayuda}
        </div>
        {enlace && <EnlaceInicio {...enlace} />}
      </header>
      <div className={cn("min-w-0 flex-1", flush ? "py-1.5" : "px-4 py-3")}>{children}</div>
    </section>
  );
}

const PESO = (f: FilaConteo) => (f.grave ? 2 : f.media ? 1 : 0);
const ORDEN = (a: FilaConteo, b: FilaConteo) => PESO(b) - PESO(a) || b.n - a.n;

/**
 * Las `n` señales que más pesan, de varias fuentes (sus contratos, su gente, sus obras): primero la mejor de cada fuente
 * (lo grave antes, y a igual gravedad la de más casos), para que no salgan tres de lo mismo; si faltan, las siguientes.
 * Las que no tienen casos no cuentan.
 */
export function elegirHallazgos(fuentes: FilaConteo[][], n = 3): FilaConteo[] {
  const porFuente = fuentes.map((f) => f.filter((x) => x.n > 0).sort(ORDEN));
  const primeras = porFuente.map((f) => f[0]).filter((x): x is FilaConteo => !!x).sort(ORDEN);
  const elegidas = primeras.slice(0, n);
  const resto = [...primeras.slice(n), ...porFuente.flatMap((f) => f.slice(1))].sort(ORDEN);
  return [...elegidas, ...resto.slice(0, Math.max(0, n - elegidas.length))].sort(ORDEN);
}

/** Las señales elegidas (`elegirHallazgos`), cada una con su barra y su lista ya filtrada; sin ninguna, una línea. */
export function HallazgosClave({ filas, vacio }: { filas: FilaConteo[]; vacio: string }) {
  if (!filas.length) return <LineaResumen>{vacio}</LineaResumen>;
  return <ListaConteos filas={filas} />;
}

/** Una línea en gris con su ícono, dentro de una caja: lo que no tiene casos o no tiene dato. */
export function LineaResumen({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 px-4 py-2 text-meta leading-snug text-mute">
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Una fila de «Ver más»: una pestaña (o una lista) con la cifra que la resume, o un panel al costado. */
export interface FilaMas {
  clave: string;
  icono: LucideIcon;
  titulo: string;
  /** La cifra que la resume («32,908», «S/ 128.2 M»), en tinta. */
  cifra?: string | null;
  /** Lo que dice además, en una línea gris («35 con una señal grave»). */
  texto?: ReactNode;
  /** Una señal grave en `texto`: va en el tono de la gravedad. */
  tono?: "alta" | "media";
  href?: string;
  /** Un registro oficial: se abre afuera. */
  externo?: boolean;
  /** En vez de un enlace, lo que se abre en un panel al costado (lo que no tiene pestaña propia). */
  panel?: { titulo: string; descripcion?: string; contenido: ReactNode };
  /**
   * El servicio no respondió ESTA vez: la fila lo dice en gris y `href` es «Reintentar» (la misma página, con un `<a>`
   * para que el servidor la arme de nuevo). Antes era un bloque entero con «Sin dato: el servicio no respondió»
   * pintado como contenido.
   */
  sinRespuesta?: boolean;
}

const TONO_TEXTO = { alta: "text-crimsonTexto", media: "text-amberTexto" } as const;

/**
 * Las filas de «Ver más»: ícono, nombre, su línea y su cifra, y la flecha (o el ícono del panel). `columnas` las reparte en
 * dos o tres columnas cuando la caja es ancha (el contenedor, no la pantalla).
 */
export function ListaMas({ filas, columnas = 1 }: { filas: FilaMas[]; columnas?: 1 | 2 | 3 }) {
  const grilla = columnas === 3 ? "[@container(min-width:48rem)]:grid-cols-3 [@container(min-width:32rem)]:grid-cols-2" : columnas === 2 ? "[@container(min-width:32rem)]:grid-cols-2" : "";
  return (
    <div className="[container-type:inline-size]">
      <ul className={cn("grid grid-cols-1 gap-x-2", grilla)}>
        {filas.map((f) => (
          <li key={f.clave} className="min-w-0 border-t border-line/70 first:border-t-0">
            <Fila f={f} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fila({ f }: { f: FilaMas }) {
  const Icono = f.icono;
  const cuerpo = (accion: ReactNode) => (
    <span className="flex min-h-12 items-center gap-3 px-4 py-2">
      <Icono size={16} strokeWidth={1.9} className={cn("shrink-0", f.sinRespuesta ? "text-mute" : "text-inkSoft")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-dato font-medium leading-snug", f.sinRespuesta ? "text-inkSoft" : "text-ink group-hover:text-granate")}>{f.titulo}</span>
        {f.texto != null && (
          <span className={cn("block truncate text-meta leading-snug", f.tono ? TONO_TEXTO[f.tono] : "text-mute")} title={typeof f.texto === "string" ? f.texto : undefined}>
            {f.texto}
          </span>
        )}
      </span>
      {f.cifra && <span className="shrink-0 font-mono text-dato font-semibold tabular-nums text-ink">{f.cifra}</span>}
      {accion}
    </span>
  );
  const clase = "group block w-full text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";
  if (f.sinRespuesta) {
    return (
      <a href={f.href ?? "?"} className={clase}>
        {cuerpo(
          <span className="inline-flex shrink-0 items-center gap-1 text-meta font-semibold text-granate">
            <RotateCw size={13} aria-hidden /> Reintentar
          </span>,
        )}
      </a>
    );
  }
  if (f.panel) {
    return (
      <Revelar titulo={f.panel.titulo} descripcion={f.panel.descripcion} detalle={f.panel.contenido} className={clase} etiqueta={`${f.titulo}: abrir el detalle al costado`}>
        {cuerpo(<PanelRightOpen size={15} className="shrink-0 text-mute group-hover:text-granate" aria-hidden />)}
      </Revelar>
    );
  }
  if (f.href && f.externo) {
    return (
      <a href={f.href} target="_blank" rel="noopener noreferrer" className={clase}>
        {cuerpo(<ExternalLink size={14} className="shrink-0 text-mute" aria-hidden />)}
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    );
  }
  if (f.href) {
    return (
      <Link href={f.href} prefetch={false} className={clase}>
        {cuerpo(<ChevronRight size={15} className="shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate" aria-hidden />)}
      </Link>
    );
  }
  return cuerpo(null);
}
