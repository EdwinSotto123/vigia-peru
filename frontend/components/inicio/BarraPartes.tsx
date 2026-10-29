import Link from "next/link";
import type { ReactNode } from "react";
import { numero, porcentaje } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Un total partido en sus partes: una barra con un tramo por parte y, debajo, su leyenda (la muestra de color, el nombre
 * y el número; la parte que tiene su lista, con su enlace). La usan «Esta entidad en Vigía» de la ficha del contrato y,
 * en el Inicio de una entidad, sus contratos por tipo y si Vigía los leyó: antes eran fichas sueltas y renglones de texto,
 * y el reparto no se veía. Sin estado ni funciones: sirve en el servidor y en el navegador.
 *
 * El color nunca es el único canal: los tramos van separados por 2 px, cada uno dice en su `title` cuánto es y qué parte
 * del total, y la leyenda va en el mismo orden que la barra (con tokens no hay siete matices distintos).
 */

/** El relleno de la pista: una parte con él se lee como «lo que queda» («Aún no», «Fuera de la cola») y su muestra lleva borde. */
export const PISTA = "bg-paperDeep";

/**
 * El relleno de las partes que no traen el suyo, por su LUGAR en la lista y no por su tamaño: el mismo tipo lleva el mismo
 * color en todas las fichas aunque falten otros. Marca y añil alternados y grises entre ellos: los vecinos se distinguen
 * también con daltonismo (comprobado contra la pista, de día y de noche).
 */
const TONOS = ["bg-granate", "bg-anil", "bg-inkSoft/60", "bg-granate/50", "bg-anil/50", "bg-inkSoft/30", "bg-granate/20"] as const;

export interface ParteBarra {
  /** Única en la barra: la clave de cada tramo y de su renglón. */
  clave: string;
  etiqueta: string;
  n: number;
  /** Un token de relleno (`bg-granate/45`); sin él, el de su lugar en `TONOS`. Para un orden (leído → no leído), una sola rampa. */
  clase?: string;
  /** Una línea bajo el nombre («13 de riesgo medio o alto»). */
  detalle?: ReactNode;
  /** El tono de esa línea (`text-amberTexto` para lo que pesa); por defecto, gris. */
  tonoDetalle?: string;
  /** La lista que muestra esa parte, ya filtrada: su renglón de la leyenda es el enlace. */
  href?: string;
  /** El nombre en tinta y negrita: la parte que importa («Con dictamen»). */
  destacada?: boolean;
}

export function BarraPartes({
  partes,
  total,
  etiqueta,
  leyenda = "lista",
  className,
}: {
  partes: ParteBarra[];
  /** La barra entera; por defecto, la suma de las partes. Si es mayor, lo que falta queda como pista vacía. */
  total?: number;
  /** Qué se reparte, para el lector de pantalla («Contratos por tipo»). */
  etiqueta: string;
  /**
   * `lista`: un renglón por parte con su número a la derecha y su detalle debajo (una columna angosta).
   * `en-linea`: las partes una tras otra, como una leyenda de gráfico (el valor de un `DatosClave`).
   */
  leyenda?: "lista" | "en-linea";
  className?: string;
}) {
  // El color se asigna antes de quitar las partes en 0: si falta una, las demás no cambian de color.
  const conTono = partes.map((p, i) => ({ ...p, clase: p.clase ?? TONOS[Math.min(i, TONOS.length - 1)] }));
  const visibles = conTono.filter((p) => p.n > 0);
  const suma = visibles.reduce((s, p) => s + p.n, 0);
  const base = Math.max(total ?? 0, suma);
  if (!visibles.length || base <= 0) return null;
  // «menos de 1 %» y no «0 %»: una parte que existe nunca se lee como nada.
  const cuota = (n: number) => {
    const p = (n / base) * 100;
    return p > 0 && p < 1 ? `menos de ${porcentaje(1)}` : porcentaje(p);
  };

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={`${etiqueta}: ${visibles.map((p) => `${p.etiqueta}, ${cuota(p.n)}`).join("; ")}`}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-paperDeep"
      >
        {visibles.map((p) => (
          // Cada tramo crece en proporción a su parte (descontados los 2 px de separación); el más chico se ve igual.
          <span key={p.clave} title={`${p.etiqueta}: ${numero(p.n)} (${cuota(p.n)})`} className={cn("h-full min-w-0.5", p.clase)} style={{ flex: `${p.n} 1 0%` }} />
        ))}
        {base > suma && <span className="h-full" style={{ flex: `${base - suma} 1 0%` }} />}
      </div>
      {leyenda === "lista" ? (
        <ul className="mt-3 space-y-1.5 text-meta">
          {visibles.map((p) => {
            const cuerpo = (
              <>
                <span className="flex min-w-0 items-start gap-2 text-inkSoft">
                  <Muestra clase={p.clase} className="mt-1" />
                  <span className="min-w-0">
                    <span className={p.destacada ? "font-semibold text-ink" : undefined}>{p.etiqueta}</span>
                    {p.detalle && <span className={cn("block text-rotulo", p.tonoDetalle ?? "text-mute")}>{p.detalle}</span>}
                  </span>
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums text-ink">{numero(p.n)}</span>
              </>
            );
            return (
              <li key={p.clave}>
                {p.href ? (
                  <Link
                    href={p.href}
                    prefetch={false}
                    className="-mx-1.5 flex items-start justify-between gap-3 rounded-md px-1.5 py-0.5 transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                  >
                    {cuerpo}
                  </Link>
                ) : (
                  <span className="flex items-start justify-between gap-3">{cuerpo}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-meta">
          {visibles.map((p) => {
            const cuerpo = (
              <>
                <Muestra clase={p.clase} />
                <span className={cn(p.destacada ? "font-semibold text-ink" : "text-inkSoft", p.href && "underline-offset-2 group-hover:text-granate group-hover:underline")}>
                  {p.etiqueta}
                </span>
                <span className="font-mono font-semibold tabular-nums text-ink">{numero(p.n)}</span>
                {p.detalle && <span className={cn("text-rotulo", p.tonoDetalle ?? "text-mute")}>{p.detalle}</span>}
              </>
            );
            return (
              <li key={p.clave}>
                {p.href ? (
                  <Link
                    href={p.href}
                    prefetch={false}
                    className="group inline-flex min-h-8 items-center gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                  >
                    {cuerpo}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-8 items-center gap-1.5">{cuerpo}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** La muestra de color de una parte en la leyenda; la de la pista, con borde (si no, no se ve). */
function Muestra({ clase, className }: { clase: string; className?: string }) {
  return <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", clase, clase === PISTA && "border border-line", className)} />;
}
