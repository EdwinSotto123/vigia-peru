import { cn } from "@/lib/utils";

/**
 * Columnas de una serie corta que NO es de años: una por corrida de validación, por día o por mes (`ColumnasAnio` rotula
 * con el año y pide dos series). Misma gramática (skill dataviz): columnas de hasta 24 px con el remate redondeado, la
 * línea de base, el valor escrito sólo en la más alta y en la última, color por rol (--serie-1) y texto en tinta. En el
 * eje van el primer y el último rótulo (todos si son cuatro o menos): a 390 px diez fechas no caben.
 *
 * `tope` fija el techo (1 para una tasa de 0 a 1); sin él, el mayor de la serie. Cada columna dice su detalle en `title`
 * y en el nombre accesible. Server-safe: los textos llegan ya formateados.
 */
export interface PuntoSerie {
  clave: string;
  /** El rótulo del eje («15 nov.», «nov. 2026»). */
  rotulo: string;
  valor: number | null;
  /** El valor como se lee («0.964», «1,365 análisis»). */
  texto: string;
  /** Lo que dice al pasar el mouse («15 nov. 2026, versión 7a29deb4: F1 0.964»). */
  detalle: string;
}

export function ColumnasSerie({
  puntos,
  etiqueta,
  tope,
  alto = "normal",
  serie = 1,
  className,
}: {
  puntos: PuntoSerie[];
  /** El nombre del gráfico para el lector de pantalla. */
  etiqueta: string;
  tope?: number;
  alto?: "normal" | "bajo";
  /** Qué color de la paleta (1 a 6). */
  serie?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const conValor = puntos.filter((p) => typeof p.valor === "number");
  if (!conValor.length) return null;
  const mayor = Math.max(...conValor.map((p) => p.valor as number));
  const techo = tope ?? (mayor > 0 ? mayor : 1);
  const iMayor = puntos.findIndex((p) => p.valor === mayor);
  const iUltimo = puntos.length - 1;
  // Los rótulos del eje: todos si son pocos; si no, sólo el primero y el último (a 390 px seis fechas se pisan).
  const conRotulo = (i: number) => puntos.length <= 4 || i === 0 || i === iUltimo;
  return (
    <figure className={cn("min-w-0", className)}>
      <ol aria-label={etiqueta} className={cn("relative flex items-end gap-1 border-b border-paperEdge pt-5", alto === "bajo" ? "h-20" : "h-32")}>
        {puntos.map((p, i) => {
          const v = typeof p.valor === "number" ? p.valor : null;
          const altura = v == null ? 0 : Math.max(v > 0 ? 3 : 0, Math.min(100, (v / techo) * 100));
          const rotular = v != null && (i === iMayor || i === iUltimo);
          return (
            <li key={p.clave} title={p.detalle} aria-label={p.detalle} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
              {v == null ? (
                <span className="h-1 w-full max-w-[24px] rounded-sm border border-dashed border-line" />
              ) : (
                <span className="w-full max-w-[24px] rounded-t-[4px]" style={{ height: `${altura}%`, background: `rgb(var(--serie-${serie}))` }} />
              )}
              {rotular && (
                <span
                  className={cn(
                    "pointer-events-none absolute whitespace-nowrap font-mono text-rotulo font-semibold tabular-nums text-ink",
                    i === iUltimo && puntos.length > 1 ? "right-0" : i === 0 ? "left-0" : "left-1/2 -translate-x-1/2",
                  )}
                  style={{ bottom: `calc(${altura}% + 3px)` }}
                >
                  {p.texto}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <ol className="mt-1 flex gap-1" aria-hidden>
        {puntos.map((p, i) => (
          <li key={p.clave} className="relative h-4 min-w-0 flex-1">
            {conRotulo(i) && (
              <span
                className={cn(
                  "absolute top-0 whitespace-nowrap font-mono text-rotulo tabular-nums text-mute",
                  i === 0 ? "left-0" : i === iUltimo ? "right-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                {p.rotulo}
              </span>
            )}
          </li>
        ))}
      </ol>
    </figure>
  );
}
