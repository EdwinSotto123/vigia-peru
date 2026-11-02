import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Las gráficas de Gobserva Obras, en CSS (se adaptan al ancho sin estirar el texto) y server-safe:
 *   · CaminoObra: el camino de una obra, de la idea a la ejecución, con cuántos proyectos y cuánta plata hay en cada paso.
 *   · BarrasDobles: dos series por fila (lo que se viene y lo que está en marcha), cada fila el enlace a su filtro.
 *   · Barras: una serie (empresas que ganan, causas de paralización), con enlace si lo hay.
 *   · Histograma: barras verticales por tamaño de obra, las dos series lado a lado.
 * Las series: granate (la marca) para lo que se viene, añil para lo que está en marcha. Cada número también va escrito.
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
  neutro: { borde: "border-t-paperEdge", barra: "bg-inkSoft/45", punto: "bg-inkSoft/60" },
  marca: { borde: "border-t-granate", barra: "bg-granate", punto: "bg-granate" },
  oportunidad: { borde: "border-t-amber", barra: "bg-amber", punto: "bg-amber" },
  marcha: { borde: "border-t-anil", barra: "bg-anil", punto: "bg-anil" },
  alerta: { borde: "border-t-crimson", barra: "bg-crimson", punto: "bg-crimson" },
};

/** El camino de una obra pública: cada paso con su número de proyectos, su plata (barra contra el paso mayor) y su enlace. */
export function CaminoObra({ pasos, etiqueta, className }: { pasos: PasoCamino[]; etiqueta: string; className?: string }) {
  const mayor = Math.max(1, ...pasos.map((p) => p.monto));
  return (
    <ol aria-label={etiqueta} className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0", className)}>
      {pasos.map((p, i) => {
        const t = TONO_PASO[p.tono];
        return (
          <li key={p.clave} className="relative min-w-0 lg:pr-4">
            {i < pasos.length - 1 && (
              <ChevronRight aria-hidden size={18} className="absolute -right-0.5 top-9 z-10 hidden text-mute lg:block" />
            )}
            <Link
              href={p.href}
              className={cn(
                "group flex h-full min-w-0 flex-col rounded-2xl border border-t-4 border-line bg-paper p-4 transition-[border-color,box-shadow,transform] duration-rapido hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-24px_rgb(var(--granate)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                t.borde,
              )}
            >
              <span className="flex items-center gap-2 text-meta font-semibold text-inkSoft">
                <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-micro font-bold text-paper", t.punto)}>
                  {i + 1}
                </span>
                <span className="min-w-0 truncate">{p.nombre}</span>
              </span>
              <span className="mt-3 font-display text-cifra font-bold leading-none tabular-nums text-ink">{numero(p.n)}</span>
              <span className="mt-1 text-meta text-inkSoft">{p.n === 1 ? "proyecto" : "proyectos"}</span>
              <span className="mt-3 font-mono text-dato font-semibold tabular-nums text-ink">{solesCompacto(p.monto)}</span>
              <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                <span className={cn("block h-full rounded-full", t.barra)} style={{ width: `${Math.max(2, (p.monto / mayor) * 100)}%` }} />
              </span>
              <span className="mt-3 flex-1 text-rotulo leading-snug text-mute">{p.detalle}</span>
              <span className="mt-3 inline-flex items-center gap-0.5 text-meta font-semibold text-granate">
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

/** Dos series por fila, cada una con su barra contra la mayor de todas (las dos en la misma escala). */
export function BarrasDobles({
  filas,
  etiqueta,
  serieA,
  serieB,
  columnas = 1,
  className,
}: {
  filas: FilaDoble[];
  etiqueta: string;
  serieA: string;
  serieB: string;
  columnas?: 1 | 2;
  className?: string;
}) {
  if (!filas.length) return <p className="text-dato text-mute">Sin datos para mostrar.</p>;
  const mayor = Math.max(1, ...filas.flatMap((f) => [f.a, f.b]));
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
      <ul aria-label={etiqueta} className={cn("mt-3 grid grid-cols-1 gap-x-8 gap-y-1", columnas === 2 && "md:grid-cols-2")}>
        {filas.map((f) => {
          const cuerpo = (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-dato font-medium text-ink" title={f.etiqueta}>
                  {f.etiqueta}
                </span>
                <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-ink">{f.textoA ?? solesCompacto(f.a)}</span>
              </span>
              <span aria-hidden className="mt-1 block h-2 overflow-hidden rounded-full bg-paperDeep">
                <span className="block h-full rounded-full bg-granate/80" style={{ width: `${Math.max(1.5, (f.a / mayor) * 100)}%` }} />
              </span>
              <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                <span className="block h-full rounded-full bg-anil/80" style={{ width: `${Math.max(1.5, (f.b / mayor) * 100)}%` }} />
              </span>
              <span className="mt-1 flex flex-wrap justify-between gap-x-3 text-rotulo text-mute">
                <span>{f.detalle}</span>
                <span className="font-mono tabular-nums">
                  {serieB}: {f.textoB ?? solesCompacto(f.b)}
                </span>
              </span>
              <span className="sr-only">
                {serieA}: {f.textoA ?? solesCompacto(f.a)}. {serieB}: {f.textoB ?? solesCompacto(f.b)}.
              </span>
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
      </ul>
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

/** Barras horizontales contra la mayor, una serie. */
export function Barras({ filas, etiqueta, tono = "marca", className }: { filas: FilaBarra[]; etiqueta: string; tono?: "marca" | "marcha" | "alerta"; className?: string }) {
  if (!filas.length) return <p className="text-dato text-mute">Sin datos para mostrar.</p>;
  const mayor = Math.max(1, ...filas.map((f) => f.valor));
  const color = tono === "alerta" ? "bg-crimson/80" : tono === "marcha" ? "bg-anil/80" : "bg-granate/80";
  return (
    <ul aria-label={etiqueta} className={cn("space-y-1", className)}>
      {filas.map((f) => {
        const cuerpo = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-dato font-medium text-ink" title={f.etiqueta}>
                {f.etiqueta}
              </span>
              <span className="shrink-0 font-mono text-dato font-semibold tabular-nums text-ink">{f.texto ?? numero(f.valor)}</span>
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
    </ul>
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
              <span className="mb-1 text-center font-mono text-micro tabular-nums text-inkSoft">{numero(x.a)}</span>
              <span className="block rounded-t-[4px] bg-granate/80" style={{ height: `${Math.max(1.5, (x.a / mayor) * 82)}%` }} />
            </span>
            <span className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <span className="mb-1 text-center font-mono text-micro tabular-nums text-inkSoft">{numero(x.b)}</span>
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
