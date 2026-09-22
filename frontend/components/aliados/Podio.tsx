import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { RankingRow } from "@/lib/financiamiento";
import { cn } from "@/lib/utils";
import { AvatarAliado, identidadAliado } from "./TarjetaAliado";

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
        <p className="mx-auto mt-1 max-w-[52ch] text-center text-[13px] leading-relaxed text-paper/60">
          Se cuenta en contratos, nunca en soles. Nadie elige cuáles: salen de la cola por antigüedad.
        </p>

        <ol className="mt-7 grid grid-cols-3 items-end gap-2 sm:gap-4">
          {filas.slice(0, 3).map((row, i) => {
            const puesto = (i + 1) as 1 | 2 | 3;
            const e = ESCALON[puesto];
            const maq = esMaqueta(row);
            const href = row.slug ? `/aliado/${row.slug}` : undefined;
            const pct = financiadosAmbito > 0 ? (row.contratosFinanciados / financiadosAmbito) * 100 : 0;

            const cabeza = (
              <>
                <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size={e.avatar} maqueta={maq} />
                <span className={cn("mt-2 block max-w-full truncate font-semibold text-paper", e.nombre)}>
                  {row.nombre}
                </span>
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
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-paper/50 group-hover:text-paper/80">
                      Ver su ficha <ArrowUpRight size={11} aria-hidden />
                    </span>
                  </Link>
                ) : (
                  <div className="flex min-w-0 flex-col items-center px-1 pb-2 pt-1 text-center">{cabeza}</div>
                )}

                <p className="text-center text-[12px] leading-tight text-paper/70">
                  <span className="font-mono text-base font-bold tabular-nums text-paper">{n(row.contratosFinanciados)}</span>{" "}
                  contratos
                  {financiadosAmbito > 0 && (
                    <span className="block text-paper/45">
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

/** Los que siguen al podio: fila compacta, mismo dato, sin pedestal. */
export function RestoDelPodio({
  filas,
  desde,
  financiadosAmbito,
  esMaqueta,
}: {
  filas: RankingRow[];
  /** Puesto del primero de esta lista (4 si el podio se llevó tres). */
  desde: number;
  financiadosAmbito: number;
  esMaqueta: (row: RankingRow) => boolean;
}) {
  if (!filas.length) return null;
  const n = (v: number) => v.toLocaleString("es-PE");
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
      {filas.map((row, i) => {
        const maq = esMaqueta(row);
        const pct = financiadosAmbito > 0 ? (row.contratosFinanciados / financiadosAmbito) * 100 : 0;
        return (
          <li key={row.slug ?? row.id} className={cn("relative", maq && "bg-amber-soft/25")}>
            <Link
              href={row.slug ? `/aliado/${row.slug}` : "#"}
              className="flex items-center gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft"
            >
              <span className="w-5 shrink-0 text-center font-mono text-[13px] tabular-nums text-mute">{desde + i}</span>
              <AvatarAliado tipo={row.tipo} logoUrl={row.logoUrl} nombre={row.nombre} size="sm" maqueta={maq} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">{row.nombre}</span>
                <span className="block truncate text-[12px] text-mute">{identidadAliado(row)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[14px] font-semibold tabular-nums text-ink">
                  {n(row.contratosFinanciados)}
                </span>
                <span className="block text-[11px] text-mute">
                  {financiadosAmbito > 0
                    ? `${pct.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`
                    : "contratos"}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
