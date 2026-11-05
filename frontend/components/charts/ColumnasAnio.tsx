"use client";

import { useState } from "react";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Columnas apiladas por año: dos series (la 1 abajo, la 2 encima) con un eje de montos, la línea de base y el detalle de
 * cada año al pasar el mouse o con el teclado (Tab y flechas). Skill dataviz: columnas de hasta 24 px con su remate
 * redondeado de 4 px y la base recta, 2 px de aire entre los segmentos, rejilla de un trazo apenas visible, el total
 * escrito sólo en el año más alto y en el último (nunca en todos), los colores por rol (--serie-1, --serie-2) y el texto
 * siempre en tinta. La leyenda y la tabla las pone quien lo usa (las cifras del panel hacen de leyenda).
 */
export interface AnioColumna {
  anio: number;
  a: number;
  b: number;
  /** El texto de cada serie en el detalle («S/ 12.3 M en 14 procesos»). */
  detalleA: string;
  detalleB: string;
  /** Ese año trae montos con un posible error de carga que no entran en la columna. */
  aparte?: boolean;
}

/** Un techo «redondo» y cercano para el eje (255 M → 300 M, no 500 M: con el techo lejos las columnas quedaban en la
 *  mitad de abajo). Pasos pares, para que la marca del medio también sea redonda. */
function techo(x: number): number {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

export function ColumnasAnio({
  anios,
  etiquetaA,
  etiquetaB,
  formato: tipo = "soles",
  etiqueta,
  className,
}: {
  anios: AnioColumna[];
  etiquetaA: string;
  etiquetaB: string;
  /** Cómo se escribe un valor en el eje y en las etiquetas: soles compactos («S/ 120 M») o un número. Un texto y no una
   *  función: quien lo usa es un componente de servidor y una función no cruza al cliente. */
  formato?: "soles" | "numero";
  /** El nombre del gráfico para el lector de pantalla. */
  etiqueta: string;
  className?: string;
}) {
  const formato = (n: number) => (tipo === "soles" ? solesCompacto(n) : numero(n));
  // En el eje, sin el «.0» de los montos redondos: «S/ 150 M», no «S/ 150.0 M».
  const marca = (n: number) => formato(n).replace(/([.,]0)(?=\s|$)/, "");
  const orden = [...anios].sort((x, y) => x.anio - y.anio);
  const [activo, setActivo] = useState<number | null>(null);
  if (!orden.length) return null;
  const tope = techo(Math.max(...orden.map((x) => x.a + x.b)));
  const marcas = [0, tope / 2, tope];
  const maxAnio = orden.reduce((m, x) => (x.a + x.b > m.a + m.b ? x : m), orden[0]).anio;
  const ultimo = orden[orden.length - 1].anio;
  const sel = activo != null ? orden.find((x) => x.anio === activo) ?? null : null;
  const mover = (i: number) => {
    const j = Math.max(0, Math.min(orden.length - 1, i));
    setActivo(orden[j].anio);
    (document.getElementById(`col-${etiqueta.length}-${orden[j].anio}`) as HTMLElement | null)?.focus();
  };
  return (
    <figure className={cn("min-w-0", className)} aria-label={etiqueta}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* El eje: tres marcas redondas, en tinta tenue. */}
        <div className="relative h-44 w-14 sm:h-52" aria-hidden>
          {marcas.map((m) => (
            <span key={m} className="absolute right-0 -translate-y-1/2 font-mono text-rotulo tabular-nums text-mute" style={{ bottom: `${(m / tope) * 100}%` }}>
              {m === 0 ? "0" : marca(m)}
            </span>
          ))}
        </div>
        <div className="relative h-44 sm:h-52" onMouseLeave={() => setActivo(null)}>
          {marcas.map((m) => (
            <span key={m} className={cn("absolute inset-x-0 h-px", m === 0 ? "bg-paperEdge" : "bg-line")} style={{ bottom: `${(m / tope) * 100}%` }} aria-hidden />
          ))}
          <ol className="absolute inset-0 flex items-end justify-around gap-1" aria-label={etiqueta}>
            {orden.map((x, i) => {
              const total = x.a + x.b;
              const alto = (total / tope) * 100;
              const partA = total ? (x.a / total) * 100 : 0;
              const rotular = x.anio === maxAnio || x.anio === ultimo;
              const on = activo === x.anio;
              return (
                <li key={x.anio} className="relative flex h-full min-w-0 flex-1 justify-center">
                  <button
                    type="button"
                    id={`col-${etiqueta.length}-${x.anio}`}
                    className="group relative flex h-full w-full max-w-[48px] items-end justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                    aria-label={`${x.anio}: ${etiquetaA} ${x.detalleA}; ${etiquetaB} ${x.detalleB}; en total ${formato(total)}${x.aparte ? "; con montos de un posible error de carga aparte" : ""}`}
                    onMouseEnter={() => setActivo(x.anio)}
                    onFocus={() => setActivo(x.anio)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight") { e.preventDefault(); mover(i + 1); }
                      if (e.key === "ArrowLeft") { e.preventDefault(); mover(i - 1); }
                    }}
                  >
                    {/* La zona de toque es la columna entera; la marca, de hasta 24 px. */}
                    <span className={cn("flex w-full max-w-[24px] flex-col-reverse gap-[2px] transition-opacity duration-rapido", activo != null && !on && "opacity-45")} style={{ height: `${Math.max(total ? 1.5 : 0, alto)}%` }}>
                      {x.a > 0 && <span className={cn("w-full", x.b > 0 ? "" : "rounded-t-[4px]")} style={{ height: `${partA}%`, minHeight: 2, background: "rgb(var(--serie-1))" }} />}
                      {x.b > 0 && <span className="w-full rounded-t-[4px]" style={{ height: `${100 - partA}%`, minHeight: 2, background: "rgb(var(--serie-2))" }} />}
                    </span>
                    {rotular && total > 0 && (
                      <span className={cn("pointer-events-none absolute whitespace-nowrap font-mono text-rotulo font-semibold tabular-nums text-ink",
                                         // La primera y la última, ancladas a su lado: centradas se salían del gráfico en el celular.
                                         i === orden.length - 1 ? "right-0" : i === 0 ? "left-0" : "left-1/2 -translate-x-1/2")}
                          style={{ bottom: `calc(${alto}% + 4px)` }}>
                        {formato(total)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          {/* El detalle del año activo, arriba a la izquierda del área: no tapa la columna que se mira. */}
          {sel && (
            <div role="status" className="pointer-events-none absolute left-2 top-0 z-[2] min-w-[12rem] rounded-xl border border-line bg-paper px-3 py-2 text-meta shadow-lg">
              <p className="font-display font-bold text-ink">{sel.anio}: {formato(sel.a + sel.b)}</p>
              <p className="mt-1 flex items-center gap-1.5 text-inkSoft">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: "rgb(var(--serie-1))" }} aria-hidden />
                {etiquetaA}: <span className="font-mono tabular-nums text-ink">{sel.detalleA}</span>
              </p>
              <p className="flex items-center gap-1.5 text-inkSoft">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: "rgb(var(--serie-2))" }} aria-hidden />
                {etiquetaB}: <span className="font-mono tabular-nums text-ink">{sel.detalleB}</span>
              </p>
              {sel.aparte && <p className="mt-1 text-rotulo text-amberTexto">Con montos de un posible error de carga, fuera de la columna.</p>}
            </div>
          )}
        </div>
        <span aria-hidden />
        <ol className="mt-1.5 flex justify-around gap-1" aria-hidden>
          {orden.map((x) => (
            <li key={x.anio} className={cn("min-w-0 flex-1 whitespace-nowrap text-center font-mono text-rotulo tabular-nums", activo === x.anio ? "font-semibold text-ink" : "text-mute")}>
              {/* En el celular (o con muchos años), «’18»: nueve «2018» no caben en 390 px. */}
              <span className={orden.length > 10 ? "" : "sm:hidden"}>{`’${String(x.anio).slice(2)}`}</span>
              {orden.length <= 10 && <span className="max-sm:hidden">{x.anio}</span>}
              {x.aparte && <span className="ml-0.5 text-amberTexto" title="Ese año hay montos con un posible error de carga, fuera de la columna">▲</span>}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
