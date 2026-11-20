import { MuestraSerie } from "@/components/charts/BarraSegmentada";
import { cn } from "@/lib/utils";

/**
 * Dos gráficos chicos de la ficha, con la gramática de components/charts (ColumnasSerie, ColumnasAnio): columnas de
 * hasta 24 px con el remate redondeado de 4 px, 2 px de aire entre segmentos, la línea de base, el valor escrito sólo
 * en la más alta y en la última, los colores por rol (--serie-1…6) y el texto siempre en tinta. Cada columna dice su
 * detalle en `title` y en su nombre accesible; la leyenda va debajo. Server-safe: los textos llegan ya formateados.
 */

export interface SerieGrafico {
  nombre: string;
  /** El color de la paleta (1 a 6). */
  color: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface GrupoColumnas {
  clave: string;
  /** El rótulo del eje («2024», «oct.»). */
  rotulo: string;
  /** Un valor por serie, en el orden de `series`. */
  valores: (number | null)[];
  /** Lo que dice al pasar el mouse y al lector de pantalla. */
  detalle: string;
}

const fmt = new Intl.NumberFormat("es-PE");
const color = (c: SerieGrafico["color"]) => `rgb(var(--serie-${c}))`;

function Leyenda({ series }: { series: SerieGrafico[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft" aria-hidden>
      {series.map((s) => (
        <li key={s.nombre} className="inline-flex items-center gap-1.5">
          <MuestraSerie i={s.color - 1} />
          {s.nombre}
        </li>
      ))}
    </ul>
  );
}

/** Los rótulos del eje: todos si son pocos (≤ 8); si no, el primero, el del medio y el último. */
const conRotulo = (i: number, n: number) => n <= 8 || i === 0 || i === n - 1 || i === Math.floor((n - 1) / 2);

function Eje({ grupos }: { grupos: GrupoColumnas[] }) {
  return (
    <ol className="mt-1 flex gap-1" aria-hidden>
      {grupos.map((g, i) => (
        <li key={g.clave} className="relative h-4 min-w-0 flex-1">
          {conRotulo(i, grupos.length) && (
            <span
              className={cn(
                "absolute top-0 whitespace-nowrap font-mono text-rotulo tabular-nums text-mute",
                grupos.length > 8 && i === 0 ? "left-0" : grupos.length > 8 && i === grupos.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
              )}
            >
              {g.rotulo}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Columnas lado a lado por grupo (un año: denuncias, consultas y de oficio), sobre una sola escala. */
export function ColumnasAgrupadas({ grupos, series, etiqueta, className }: { grupos: GrupoColumnas[]; series: SerieGrafico[]; etiqueta: string; className?: string }) {
  const todos = grupos.flatMap((g) => g.valores.filter((v): v is number => typeof v === "number"));
  if (!todos.length) return null;
  const techo = Math.max(1, ...todos);
  const ultimo = grupos.length - 1;
  // El rótulo del valor: el mayor de todos y, en el último grupo, el de la primera serie.
  let mayor = { g: -1, s: -1 };
  grupos.forEach((g, gi) => g.valores.forEach((v, si) => { if (v === techo && mayor.g < 0) mayor = { g: gi, s: si }; }));
  return (
    <figure className={cn("min-w-0", className)}>
      <ol aria-label={etiqueta} className="relative flex h-40 items-end gap-1 border-b border-paperEdge pt-6 sm:h-48">
        {grupos.map((g, gi) => (
          <li key={g.clave} title={g.detalle} aria-label={g.detalle} className="relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]">
            {g.valores.map((v, si) => {
              const alto = v == null ? 0 : Math.max(v > 0 ? 2 : 0, (v / techo) * 100);
              const rotular = v != null && v > 0 && ((gi === mayor.g && si === mayor.s) || (gi === ultimo && si === 0 && !(mayor.g === gi)));
              return (
                <span key={series[si]?.nombre ?? si} className="relative flex h-full w-full max-w-[14px] items-end">
                  {v == null ? (
                    <span className="h-1 w-full rounded-sm border border-dashed border-line" />
                  ) : (
                    <span className="w-full rounded-t-[4px]" style={{ height: `${alto}%`, background: color(series[si]?.color ?? 1) }} />
                  )}
                  {rotular && (
                    <span
                      className={cn("pointer-events-none absolute whitespace-nowrap font-mono text-rotulo font-semibold tabular-nums text-ink", gi === ultimo ? "right-0" : gi === 0 ? "left-0" : "left-1/2 -translate-x-1/2")}
                      style={{ bottom: `calc(${alto}% + 3px)` }}
                    >
                      {fmt.format(v ?? 0)}
                    </span>
                  )}
                </span>
              );
            })}
          </li>
        ))}
      </ol>
      <Eje grupos={grupos} />
      <Leyenda series={series} />
    </figure>
  );
}

/** Columnas apiladas (cirugías mayores abajo, menores encima), una por mes. */
export function ColumnasApiladas({ grupos, series, etiqueta, className }: { grupos: GrupoColumnas[]; series: SerieGrafico[]; etiqueta: string; className?: string }) {
  const totales = grupos.map((g) => g.valores.reduce<number>((t, v) => t + (v ?? 0), 0));
  const techo = Math.max(1, ...totales);
  const iMayor = totales.indexOf(techo);
  const ultimo = grupos.length - 1;
  if (!grupos.length) return null;
  return (
    <figure className={cn("min-w-0", className)}>
      <ol aria-label={etiqueta} className="relative flex h-40 items-end gap-1 border-b border-paperEdge pt-6 sm:h-48">
        {grupos.map((g, gi) => {
          const total = totales[gi];
          const alto = (total / techo) * 100;
          const sinDato = g.valores.every((v) => v == null);
          const rotular = !sinDato && (gi === iMayor || (gi === ultimo && ultimo - iMayor > 1));
          return (
            <li key={g.clave} title={g.detalle} aria-label={g.detalle} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
              {sinDato ? (
                <span className="h-1 w-full max-w-[24px] rounded-sm border border-dashed border-line" />
              ) : (
                <span className="flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: `${Math.max(total ? 1.5 : 0, alto)}%` }}>
                  {g.valores.map((v, si) => {
                    if (!v) return null;
                    const arriba = g.valores.slice(si + 1).every((x) => !x);
                    return (
                      <span
                        key={series[si]?.nombre ?? si}
                        className={cn("w-full", arriba && "rounded-t-[4px]")}
                        style={{ height: `${(v / total) * 100}%`, minHeight: 2, background: color(series[si]?.color ?? 1) }}
                      />
                    );
                  })}
                </span>
              )}
              {rotular && (
                <span
                  className={cn("pointer-events-none absolute whitespace-nowrap font-mono text-rotulo font-semibold tabular-nums text-ink", gi === ultimo ? "right-0" : gi === 0 ? "left-0" : "left-1/2 -translate-x-1/2")}
                  style={{ bottom: `calc(${alto}% + 3px)` }}
                >
                  {fmt.format(total)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <Eje grupos={grupos} />
      <Leyenda series={series} />
    </figure>
  );
}
