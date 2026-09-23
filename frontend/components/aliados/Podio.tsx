import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { RankingRow } from "@/lib/financiamiento";
import { queryMaqueta } from "@/lib/maqueta-aliados";
import { cn } from "@/lib/utils";
import { AvatarAliado } from "./TarjetaAliado";
import { SelloMaqueta } from "./AvisoMaqueta";

/**
 * El podio de quienes más contratos hicieron leer.
 *
 * Dos decisiones que no son de gusto:
 *
 * 1. **Sin oro, plata y bronce.** `amber` y `clay` son los tokens de SEVERIDAD
 *    del producto: un primer puesto dorado se leería como "señal media" a dos
 *    pantallas de distancia de una lista donde ese mismo ámbar significa
 *    exactamente eso. El rango lo llevan la ALTURA del pedestal y el número,
 *    que es lo que un podio hace de verdad; el color es el violeta de la marca,
 *    más oscuro cuanto más alto.
 *
 * 2. **El podio mide contratos, no plata.** Es la regla del producto y acá se
 *    dice en el propio pie: trescientos vecinos que financian 300 contratos
 *    pesan lo mismo que una empresa que financia 300.
 *
 * El orden visual es 2 · 1 · 3 y los pedestales comparten piso, así que la
 * diferencia de altura se lee de un vistazo sin necesidad de leer el número.
 */

const ESCALON = {
  1: {
    pedestal: "h-24 sm:h-28",
    fondo: "bg-gradient-to-b from-heroViolet to-heroViolet-deep",
    avatar: "xl" as const,
    nombre: "text-base sm:text-lg",
    orden: "order-2",
  },
  2: {
    pedestal: "h-16 sm:h-20",
    fondo: "bg-gradient-to-b from-heroViolet/70 to-heroViolet",
    avatar: "lg" as const,
    nombre: "text-sm sm:text-base",
    orden: "order-1",
  },
  3: {
    pedestal: "h-11 sm:h-14",
    fondo: "bg-gradient-to-b from-heroViolet/45 to-heroViolet/75",
    avatar: "lg" as const,
    nombre: "text-sm sm:text-base",
    orden: "order-3",
  },
} as const;

export function Podio({
  filas,
  financiadosAmbito,
  esMaqueta,
}: {
  /** Los tres primeros, ya ordenados. */
  filas: RankingRow[];
  /** Total de contratos financiados del ámbito, para dar denominador. */
  financiadosAmbito: number;
  esMaqueta: (row: RankingRow) => boolean;
}) {
  if (filas.length < 3) return null;
  const n = (v: number) => v.toLocaleString("es-PE");

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-heroViolet-deep via-[#3a2d70] to-heroViolet px-4 pb-0 pt-7 sm:px-8 sm:pt-9">
      <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-heroGreen/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-heroViolet/40 blur-3xl" />

      <div className="relative">
        <h2 className="text-center font-serif text-xl font-bold text-paper sm:text-2xl">
          Quienes más contratos hicieron leer
        </h2>
        <p className="mx-auto mt-1 max-w-[52ch] text-center text-[13px] leading-relaxed text-paper/80">
          Se cuenta en contratos, nunca en soles. Nadie elige cuáles: salen de la cola por antigüedad.
        </p>

        <ol className="mt-7 grid grid-cols-3 items-end gap-2 sm:gap-4">
          {filas.slice(0, 3).map((row, i) => {
            const puesto = (i + 1) as 1 | 2 | 3;
            const e = ESCALON[puesto];
            const maq = esMaqueta(row);
            // Un aliado de maqueta sólo existe con el interruptor puesto: su ficha lo lleva.
            const href = row.slug ? `/aliado/${row.slug}${maq ? queryMaqueta(true) : ""}` : undefined;
            const pct = financiadosAmbito > 0 ? (row.contratosFinanciados / financiadosAmbito) * 100 : 0;

            const cabeza = (
              <>
                <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size={e.avatar} maqueta={maq} />
                <span className={cn("mt-2 block max-w-full truncate font-semibold text-paper", e.nombre)}>
                  {row.nombre}
                </span>
                {maq && <SelloMaqueta className="mt-1" />}
              </>
            );

            return (
              <li key={row.slug ?? row.id} className={cn("flex min-w-0 flex-col items-center", e.orden)}>
                {href ? (
                  <Link
                    href={href}
                    className="group flex min-w-0 flex-col items-center rounded-2xl px-1 pb-2 pt-1 text-center transition-transform duration-normal ease-salida hover:-translate-y-0.5"
                  >
                    {cabeza}
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-paper/80 group-hover:text-paper">
                      Ver su ficha <ArrowUpRight size={11} aria-hidden />
                    </span>
                  </Link>
                ) : (
                  <div className="flex min-w-0 flex-col items-center px-1 pb-2 pt-1 text-center">{cabeza}</div>
                )}

                <p className="text-center text-[12px] leading-tight text-paper/80">
                  <span className="font-mono text-base font-bold tabular-nums text-paper">{n(row.contratosFinanciados)}</span>{" "}
                  contratos
                  {financiadosAmbito > 0 && (
                    <span className="block text-paper/75">
                      {pct.toLocaleString("es-PE", { maximumFractionDigits: pct >= 10 ? 0 : 1 })} % del muro
                    </span>
                  )}
                </p>

                {/* El pedestal. La altura ES el rango; el número lo confirma. */}
                <div
                  className={cn(
                    "mt-2.5 flex w-full items-start justify-center rounded-t-xl pt-2 shadow-inset",
                    e.pedestal,
                    e.fondo,
                  )}
                >
                  <span className="font-serif text-2xl font-bold leading-none text-paper/90 sm:text-3xl">{puesto}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
