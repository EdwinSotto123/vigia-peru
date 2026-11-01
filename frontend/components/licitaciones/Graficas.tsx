import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Las gráficas de Gobserva Licitaciones, en CSS (se adaptan al ancho sin estirar el texto) y server-safe:
 *   · BarrasEnlace: barras horizontales contra la mayor, cada fila el enlace a su filtro (tipo, región, entidad).
 *   · SerieMeses: barras verticales por mes, con el monto escrito sobre la mayor y la tabla en el título.
 */

export interface FilaBarra {
  clave: string;
  etiqueta: string;
  valor: number;
  /** Lo que se escribe a la derecha (por defecto, el número). */
  texto?: string;
  /** Una línea bajo la etiqueta. */
  detalle?: ReactNode;
  href?: string;
  /** La fila elegida (el filtro puesto). */
  activa?: boolean;
}

export function BarrasEnlace({ filas, etiqueta, className }: { filas: FilaBarra[]; etiqueta: string; className?: string }) {
  const mayor = Math.max(1, ...filas.map((f) => f.valor));
  if (!filas.length) return <p className="text-dato text-mute">Sin datos para mostrar.</p>;
  return (
    <ul aria-label={etiqueta} className={cn("space-y-1", className)}>
      {filas.map((f) => {
        const cuerpo = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className={cn("min-w-0 truncate text-dato", f.activa ? "font-semibold text-ink" : "font-medium text-ink")} title={f.etiqueta}>
                {f.etiqueta}
              </span>
              <span className="shrink-0 font-mono text-dato font-semibold tabular-nums text-ink">{f.texto ?? numero(f.valor)}</span>
            </span>
            <span aria-hidden className="mt-1 block h-2 overflow-hidden rounded-full bg-paperDeep">
              <span className={cn("block h-full rounded-full", f.activa ? "bg-granate" : "bg-granate/70")} style={{ width: `${Math.max(2, (f.valor / mayor) * 100)}%` }} />
            </span>
            {f.detalle && <span className="mt-1 block text-rotulo text-mute">{f.detalle}</span>}
          </>
        );
        return (
          <li key={f.clave}>
            {f.href ? (
              <Link
                href={f.href}
                prefetch={false}
                aria-current={f.activa ? "true" : undefined}
                className={cn(
                  "-mx-2 block rounded-xl px-2 py-1.5 transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                  f.activa ? "bg-granate-50 ring-1 ring-granate/40" : "hover:bg-paperSoft",
                )}
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

const MES = new Intl.DateTimeFormat("es-PE", { month: "short", timeZone: "UTC" });
const mesCorto = (ym: string) => MES.format(new Date(`${ym}-01T00:00:00Z`)).toLocaleLowerCase("es-PE").replace(".", "");

/** Barras por mes (monto adjudicado y procesos), las 12 últimas. */
export function SerieMeses({ serie, etiqueta }: { serie: { mes: string; procesos: number; monto: number }[]; etiqueta: string }) {
  if (serie.length < 2) return null;
  const mayor = Math.max(1, ...serie.map((s) => s.monto));
  const total = serie.reduce((a, s) => a + s.monto, 0);
  return (
    <figure className="space-y-2">
      <ol aria-label={etiqueta} className="flex h-44 items-end gap-1 border-b border-line sm:gap-2">
        {serie.map((s) => {
          const pct = (s.monto / mayor) * 100;
          return (
            <li key={s.mes} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${mesCorto(s.mes)} ${s.mes.slice(0, 4)}: ${solesCompacto(s.monto)} en ${numero(s.procesos)} procesos`}>
              <span className={cn("mb-1 hidden text-center font-mono text-micro tabular-nums text-mute sm:block", s.monto === mayor && "font-semibold text-ink")}>
                {s.monto === mayor ? solesCompacto(s.monto) : ""}
              </span>
              <span className="block rounded-t-[4px] bg-granate/75 transition-colors duration-rapido group-hover:bg-granate" style={{ height: `${Math.max(pct, 2)}%` }} />
              <span className="sr-only">
                {mesCorto(s.mes)}: {solesCompacto(s.monto)}, {numero(s.procesos)} procesos
              </span>
            </li>
          );
        })}
      </ol>
      <div aria-hidden className="flex gap-1 sm:gap-2">
        {serie.map((s, i) => (
          <span key={s.mes} className="min-w-0 flex-1 truncate text-center font-mono text-micro text-mute">
            {i % 2 === 0 || serie.length <= 8 ? mesCorto(s.mes) : ""}
          </span>
        ))}
      </div>
      <figcaption className="text-meta text-inkSoft">
        {solesCompacto(total)} adjudicados en {numero(serie.reduce((a, s) => a + s.procesos, 0))} procesos; la barra más alta es el mes de mayor monto.
      </figcaption>
    </figure>
  );
}

/** Una cifra con su porcentaje en palabras: «41 % (20,969 de 51,063)». */
export const parteDe = (n: number | null | undefined, de: number | null | undefined) =>
  n != null && de ? `${porcentaje((n / de) * 100)} (${numero(n)} de ${numero(de)})` : "Sin dato";
