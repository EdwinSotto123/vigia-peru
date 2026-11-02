import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Las gráficas de Gobserva Licitaciones, en CSS (se adaptan al ancho sin estirar el texto) y server-safe:
 *   - BarrasEnlace: barras horizontales contra la mayor, cada fila el enlace a su filtro (tipo, región, entidad).
 *   - SerieMeses: barras verticales por mes, con el monto escrito sobre cada barra (en pantallas anchas) y la tabla mes a
 *     mes plegada debajo.
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

/**
 * `mayor`: la cifra que llena la barra, cuando una lista se parte en dos (las primeras a la vista y el resto plegado) y
 * las dos mitades tienen que medirse con la misma vara.
 */
export function BarrasEnlace({ filas, etiqueta, className, mayor: mayorDado }: { filas: FilaBarra[]; etiqueta: string; className?: string; mayor?: number }) {
  const mayor = Math.max(1, mayorDado ?? Math.max(0, ...filas.map((f) => f.valor)));
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
          <li key={f.clave} className="min-w-0">
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
const MES_LARGO = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" });
const fechaMes = (ym: string) => new Date(`${ym}-01T00:00:00Z`);
const mesCorto = (ym: string) => MES.format(fechaMes(ym)).toLocaleLowerCase("es-PE").replace(".", "");
const mesLargo = (ym: string) => MES_LARGO.format(fechaMes(ym));

/** Barras por mes (monto adjudicado y procesos), las 12 últimas, con la tabla mes a mes plegada debajo. */
export function SerieMeses({ serie, etiqueta }: { serie: { mes: string; procesos: number; monto: number }[]; etiqueta: string }) {
  if (serie.length < 2) return null;
  const mayor = Math.max(1, ...serie.map((s) => s.monto));
  const total = serie.reduce((a, s) => a + s.monto, 0);
  const procesos = serie.reduce((a, s) => a + s.procesos, 0);
  return (
    <figure className="space-y-2">
      <ol aria-label={etiqueta} className="flex h-48 items-end gap-1 border-b border-line sm:gap-2">
        {serie.map((s) => {
          const pct = (s.monto / mayor) * 100;
          const esMayor = s.monto === mayor;
          return (
            <li
              key={s.mes}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${mesLargo(s.mes)}: ${solesCompacto(s.monto)} en ${numero(s.procesos)} ${s.procesos === 1 ? "proceso" : "procesos"}`}
            >
              {/* El monto sobre la barra: el del mes mayor desde sm; todos en pantallas anchas (en el celular, la tabla). */}
              <span
                className={cn(
                  "mb-1 hidden truncate text-center font-mono text-micro tabular-nums",
                  esMayor ? "font-semibold text-ink sm:block" : "text-mute lg:block",
                )}
              >
                {solesCompacto(s.monto)}
              </span>
              <span className={cn("block rounded-t-[4px] transition-colors duration-rapido group-hover:bg-granate", esMayor ? "bg-granate" : "bg-granate/70")} style={{ height: `${Math.max(pct, 2)}%` }} />
              <span className="sr-only">
                {mesLargo(s.mes)}: {solesCompacto(s.monto)}, {numero(s.procesos)} {s.procesos === 1 ? "proceso" : "procesos"}
              </span>
            </li>
          );
        })}
      </ol>
      <div aria-hidden className="flex gap-1 sm:gap-2">
        {serie.map((s, i) => (
          <span key={s.mes} className={cn("min-w-0 flex-1 truncate text-center font-mono text-micro text-mute", serie.length > 8 && i % 2 === 1 && "max-sm:invisible")}>
            {mesCorto(s.mes)}
          </span>
        ))}
      </div>
      <figcaption className="text-meta leading-snug text-inkSoft">
        {solesCompacto(total)} adjudicados en {numero(procesos)} {procesos === 1 ? "proceso" : "procesos"}, de {mesLargo(serie[0].mes)} a {mesLargo(serie[serie.length - 1].mes)}.
        La barra más intensa es el mes de mayor monto.
      </figcaption>
      <details className="group/tabla">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full text-meta font-semibold text-granate underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
          <ChevronDown size={15} aria-hidden className="transition-transform duration-rapido group-open/tabla:rotate-180" />
          Ver la tabla mes a mes
        </summary>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[18rem] text-left text-meta">
            <thead className="bg-paperSoft text-rotulo text-mute">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Mes
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Procesos
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Monto adjudicado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {serie.map((s) => (
                <tr key={s.mes}>
                  <th scope="row" className="px-3 py-2 font-medium text-ink">
                    {mesLargo(s.mes)}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-inkSoft">{numero(s.procesos)}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", s.monto === mayor ? "font-semibold text-ink" : "text-inkSoft")}>{solesCompacto(s.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Una cifra con su porcentaje en palabras: «41 % (20,969 de 51,063)». */
export const parteDe = (n: number | null | undefined, de: number | null | undefined) =>
  n != null && de ? `${porcentaje((n / de) * 100)} (${numero(n)} de ${numero(de)})` : "Sin dato";
