import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Las gráficas de Gobserva Obras, en CSS (se adaptan al ancho sin estirar el texto) y server-safe:
 *   CaminoObra: el camino de una obra, de la idea a la ejecución, con cuántos proyectos y cuánta plata hay en cada paso.
 *   BarrasDobles: dos series por fila (lo que se viene y lo que está en marcha), cada fila el enlace a su filtro.
 *   Barras: una serie (empresas que ganan, causas de paralización), con enlace si lo hay.
 *   Histograma: barras verticales por tamaño de obra, las dos series lado a lado.
 * Las series: granate (la marca) para lo que se viene, añil para lo que está en marcha. Cada número también va escrito, al
 * lado de su barra y en cifras tabulares (no en monoespaciada: se leía como código).
 */

export interface PasoCamino {
  clave: string;
  nombre: string;
  /** Qué significa, en una línea. */
  detalle: string;
  n: number;
  monto: number;
  href: string;
  tono: "neutro" | "marca" | "oportunidad" | "marcha" | "alerta";
}

const TONO_PASO: Record<PasoCamino["tono"], { borde: string; barra: string; punto: string }> = {
  neutro: { borde: "lg:border-t-paperEdge", barra: "bg-inkSoft/45", punto: "bg-inkSoft/60" },
  marca: { borde: "lg:border-t-granate", barra: "bg-granate", punto: "bg-granate" },
  oportunidad: { borde: "lg:border-t-amber", barra: "bg-amber", punto: "bg-amber" },
  marcha: { borde: "lg:border-t-anil", barra: "bg-anil", punto: "bg-anil" },
  alerta: { borde: "lg:border-t-crimson", barra: "bg-crimson", punto: "bg-crimson" },
};

/**
 * El camino de una obra pública: cada paso con su número de proyectos, su plata (barra contra el paso mayor) y su enlace.
 * En escritorio, cinco columnas unidas por flechas; en el celular, una fila compacta por paso (eran cinco tarjetas de
 * 250 px una sobre otra).
 */
export function CaminoObra({ pasos, etiqueta, className }: { pasos: PasoCamino[]; etiqueta: string; className?: string }) {
  const mayor = Math.max(1, ...pasos.map((p) => p.monto));
  return (
    <ol aria-label={etiqueta} className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-5 lg:gap-0", className)}>
      {pasos.map((p, i) => {
        const t = TONO_PASO[p.tono];
        return (
          <li key={p.clave} className="relative min-w-0 lg:pr-4">
            {i < pasos.length - 1 && <ChevronRight aria-hidden size={18} className="absolute -right-0.5 top-9 z-10 hidden text-mute lg:block" />}
            <Link
              href={p.href}
              className={cn(
                "group grid h-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl border border-line bg-paper px-4 py-3 transition-[border-color,box-shadow,transform] duration-rapido hover:border-granate/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                "lg:flex lg:flex-col lg:items-stretch lg:border-t-4 lg:p-4 lg:hover:-translate-y-0.5 lg:hover:shadow-[0_14px_40px_-24px_rgb(var(--granate)/0.6)]",
                t.borde,
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-meta font-semibold text-inkSoft">
                <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-micro font-bold text-paper", t.punto)}>
                  {i + 1}
                </span>
                <span className="min-w-0 truncate text-dato text-ink lg:text-meta lg:text-inkSoft">{p.nombre}</span>
              </span>
              <span className="col-start-2 row-start-1 inline-flex items-center gap-1 justify-self-end font-display text-bloque font-bold leading-none tabular-nums text-ink lg:mt-3 lg:justify-self-auto lg:text-cifra">
                {numero(p.n)}
                <span className="sr-only lg:hidden"> {p.n === 1 ? "proyecto" : "proyectos"}</span>
                <ChevronRight size={16} aria-hidden className="text-mute transition-transform duration-rapido group-hover:translate-x-0.5 lg:hidden" />
              </span>
              <span className="mt-1 hidden text-meta text-inkSoft lg:block">{p.n === 1 ? "proyecto" : "proyectos"}</span>
              {/* En el celular: la barra y su monto en una fila; en escritorio, el monto encima de la barra. */}
              <span className="col-span-2 mt-2 flex flex-row-reverse items-center gap-3 lg:mt-3 lg:block">
                <span className="shrink-0 text-meta font-semibold tabular-nums text-ink lg:text-dato">{solesCompacto(p.monto)}</span>
                <span aria-hidden className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paperDeep lg:mt-1.5">
                  <span className={cn("block h-full rounded-full", t.barra)} style={{ width: `${Math.max(2, (p.monto / mayor) * 100)}%` }} />
                </span>
              </span>
              <span className="col-span-2 mt-1.5 text-rotulo leading-snug text-mute lg:mt-3 lg:flex-1">{p.detalle}</span>
              <span className="mt-3 hidden items-center gap-0.5 text-meta font-semibold text-granate lg:inline-flex">
                Ver proyectos <ChevronRight size={14} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export interface FilaDoble {
  clave: string;
  etiqueta: string;
  a: number;
  b: number;
  /** Lo que se escribe de cada serie (por defecto, en soles). */
  textoA?: string;
  textoB?: string;
  detalle?: ReactNode;
  href?: string;
}

/**
 * Dos series por fila, cada una con su barra contra la mayor de todas (las dos en la misma escala) y su monto al lado.
 * Con `visibles`, las filas que pasan de ese número van plegadas debajo («Ver las otras 15 regiones»): están todas, pero
 * la portada no mide 2,500 px en el celular. `mas` es ese texto, con `{n}` donde va cuántas son.
 */
export function BarrasDobles({
  filas,
  etiqueta,
  serieA,
  serieB,
  columnas = 1,
  visibles,
  mas = "Ver las otras {n}",
  className,
}: {
  filas: FilaDoble[];
  etiqueta: string;
  serieA: string;
  serieB: string;
  columnas?: 1 | 2;
  visibles?: number;
  mas?: string;
  className?: string;
}) {
  if (!filas.length) return <p className="text-dato text-mute">Sin datos para mostrar.</p>;
  const mayor = Math.max(1, ...filas.flatMap((f) => [f.a, f.b]));
  // Plegar sólo si queda más de un par de filas: plegar dos no ahorra nada.
  const corte = visibles && filas.length > visibles + 2 ? visibles : filas.length;
  const primeras = filas.slice(0, corte);
  const resto = filas.slice(corte);
  const rejilla = cn("grid grid-cols-1 gap-x-8 gap-y-0.5", columnas === 2 && "md:grid-cols-2");

  const fila = (f: FilaDoble) => {
    const textoA = f.textoA ?? solesCompacto(f.a);
    const textoB = f.textoB ?? solesCompacto(f.b);
    const cuerpo = (
      <>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="min-w-0 truncate text-dato font-medium text-ink" title={f.etiqueta}>
            {f.etiqueta}
          </span>
          {f.detalle && <span className="text-rotulo text-mute">{f.detalle}</span>}
        </span>
        <span aria-hidden className="mt-1.5 grid grid-cols-[minmax(0,1fr)_6.75rem] items-center gap-x-3 gap-y-1">
          <span className="block h-2 overflow-hidden rounded-full bg-paperDeep">
            <span className="block h-full rounded-full bg-granate/80" style={{ width: `${Math.max(1.5, (f.a / mayor) * 100)}%` }} />
          </span>
          <span className="text-right text-meta font-semibold tabular-nums text-ink">{textoA}</span>
          <span className="block h-2 overflow-hidden rounded-full bg-paperDeep">
            <span className="block h-full rounded-full bg-anil/80" style={{ width: `${Math.max(1.5, (f.b / mayor) * 100)}%` }} />
          </span>
          <span className="text-right text-meta tabular-nums text-inkSoft">{textoB}</span>
        </span>
        <span className="sr-only">
          {serieA}: {textoA}. {serieB}: {textoB}.
        </span>
      </>
    );
    return (
      <li key={f.clave} className="min-w-0">
        {f.href ? (
          <Link
            href={f.href}
            prefetch={false}
            className="-mx-2 block rounded-xl px-2 py-2 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
          >
            {cuerpo}
          </Link>
        ) : (
          <span className="-mx-2 block px-2 py-2">{cuerpo}</span>
        )}
      </li>
    );
  };

  return (
    <figure className={className}>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-granate" /> {serieA}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-anil" /> {serieB}
        </span>
      </figcaption>
      <ul aria-label={etiqueta} className={cn("mt-2", rejilla)}>
        {primeras.map(fila)}
      </ul>
      {resto.length > 0 && (
        <details className="group/mas mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full px-1 text-dato font-semibold text-granate underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            <ChevronDown size={16} aria-hidden className="transition-transform duration-rapido group-open/mas:rotate-180" />
            <span className="group-open/mas:hidden">{mas.replace("{n}", numero(resto.length))}</span>
            <span className="hidden group-open/mas:inline">Ver menos</span>
          </summary>
          <ul aria-label={`${etiqueta} (el resto)`} className={rejilla}>
            {resto.map(fila)}
          </ul>
        </details>
      )}
    </figure>
  );
}

export interface FilaBarra {
  clave: string;
  etiqueta: string;
  valor: number;
  texto?: string;
  detalle?: ReactNode;
  href?: string;
}

/**
 * Barras horizontales contra la mayor, una serie. `numerado`, para un ranking: el puesto delante del nombre. Con
 * `visibles`, el resto va plegado debajo, como en BarrasDobles (`mas`, con `{n}`).
 */
export function Barras({
  filas,
  etiqueta,
  tono = "marca",
  numerado = false,
  visibles,
  mas = "Ver las otras {n}",
  className,
}: {
  filas: FilaBarra[];
  etiqueta: string;
  tono?: "marca" | "marcha" | "alerta";
  numerado?: boolean;
  visibles?: number;
  mas?: string;
  className?: string;
}) {
  if (!filas.length) return <p className="text-dato text-mute">Sin datos para mostrar.</p>;
  const mayor = Math.max(1, ...filas.map((f) => f.valor));
  const color = tono === "alerta" ? "bg-crimson/80" : tono === "marcha" ? "bg-anil/80" : "bg-granate/80";
  // Un ranking es una lista ordenada; con `start`, la parte plegada sigue la numeración.
  const Lista: ElementType = numerado ? "ol" : "ul";
  const corte = visibles && filas.length > visibles + 2 ? visibles : filas.length;
  const resto = filas.slice(corte);
  const lista = (xs: FilaBarra[], desde: number, nombre: string, clase?: string) => (
    <Lista aria-label={nombre} start={numerado && desde > 0 ? desde + 1 : undefined} className={cn("space-y-1", clase)}>
      {xs.map((f, j) => {
        const i = desde + j;
        const cuerpo = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                {numerado && (
                  <span aria-hidden className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center self-center rounded-full bg-paperDeep px-1 text-micro font-semibold tabular-nums text-inkSoft">
                    {i + 1}
                  </span>
                )}
                <span className="min-w-0 truncate text-dato font-medium text-ink" title={f.etiqueta}>
                  {f.etiqueta}
                </span>
              </span>
              <span className="shrink-0 text-dato font-semibold tabular-nums text-ink">{f.texto ?? numero(f.valor)}</span>
            </span>
            <span aria-hidden className="mt-1 block h-2 overflow-hidden rounded-full bg-paperDeep">
              <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.max(2, (f.valor / mayor) * 100)}%` }} />
            </span>
            {f.detalle && <span className="mt-1 block text-rotulo text-mute">{f.detalle}</span>}
          </>
        );
        return (
          <li key={f.clave} className="min-w-0">
            {f.href ? (
              <Link
                href={f.href}
                prefetch={false}
                className="-mx-2 block rounded-xl px-2 py-1.5 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                {cuerpo}
              </Link>
            ) : (
              <span className="-mx-2 block px-2 py-1.5">{cuerpo}</span>
            )}
          </li>
        );
      })}
    </Lista>
  );
  if (!resto.length) return lista(filas, 0, etiqueta, className);
  return (
    <div className={className}>
      {lista(filas.slice(0, corte), 0, etiqueta)}
      <details className="group/mas mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-1 text-dato font-semibold text-granate underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
          <ChevronDown size={16} aria-hidden className="transition-transform duration-rapido group-open/mas:rotate-180" />
          <span className="group-open/mas:hidden">{mas.replace("{n}", numero(resto.length))}</span>
          <span className="hidden group-open/mas:inline">Ver menos</span>
        </summary>
        {lista(resto, corte, `${etiqueta} (el resto)`, "mt-1")}
      </details>
    </div>
  );
}

/** Barras verticales por rango (tamaño de obra), las dos series lado a lado, con su número escrito encima. */
export function Histograma({
  barras,
  etiqueta,
  serieA,
  serieB,
}: {
  barras: { clave: string; etiqueta: string; a: number; b: number }[];
  etiqueta: string;
  serieA: string;
  serieB: string;
}) {
  if (!barras.length) return <p className="text-dato text-mute">Sin datos para mostrar.</p>;
  const mayor = Math.max(1, ...barras.flatMap((x) => [x.a, x.b]));
  return (
    <figure className="space-y-2">
      <ol aria-label={etiqueta} className="flex h-48 items-end gap-2 border-b border-line sm:gap-4">
        {barras.map((x) => (
          <li key={x.clave} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1">
            <span className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <span className="mb-1 text-center text-micro font-semibold tabular-nums text-inkSoft">{numero(x.a)}</span>
              <span className="block rounded-t-[4px] bg-granate/80" style={{ height: `${Math.max(1.5, (x.a / mayor) * 82)}%` }} />
            </span>
            <span className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <span className="mb-1 text-center text-micro font-semibold tabular-nums text-inkSoft">{numero(x.b)}</span>
              <span className="block rounded-t-[4px] bg-anil/80" style={{ height: `${Math.max(1.5, (x.b / mayor) * 82)}%` }} />
            </span>
            <span className="sr-only">
              {x.etiqueta}: {serieA} {numero(x.a)}, {serieB} {numero(x.b)}.
            </span>
          </li>
        ))}
      </ol>
      <div aria-hidden className="flex gap-2 sm:gap-4">
        {barras.map((x) => (
          <span key={x.clave} className="min-w-0 flex-1 text-center text-rotulo leading-tight text-mute">
            {x.etiqueta}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-meta text-inkSoft">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-granate" /> {serieA}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-anil" /> {serieB}
        </span>
      </figcaption>
    </figure>
  );
}
