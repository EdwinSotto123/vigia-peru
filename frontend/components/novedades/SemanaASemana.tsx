import Link from "next/link";
import { Clock } from "lucide-react";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { diaMes, mesDe, rangoSemana } from "@/lib/semanas";
import { cn } from "@/lib/utils";

/** Una semana de GET /novedades/semana. Las que todavía no llegan completas (`completa: false`) no traen cifras. */
export interface SemanaNueva {
  desde: string;
  completa: boolean;
  buenasPro?: number;
  conAntecedente?: number;
  graves?: number;
  monto?: number;
}

/**
 * «Semana a semana» de «Lo nuevo» (2026-11-01): cuántas buenas pro de cada semana las ganó alguien con un antecedente
 * grave, las 12 últimas semanas completas, y después las que el Estado todavía no termina de publicar, punteadas («en
 * camino»): el atraso de las fuentes se VE en la gráfica en vez de explicarse en un párrafo (antes la página decía «hasta
 * el 16 oct.» sin decir por qué).
 *
 * Una barra por semana, alta según sus contratos graves; la semana que se lista abajo va en rojo lleno y las demás más
 * claras. Cada barra es el enlace a su semana (`href`), con su nombre completo para el lector de pantalla. Barras en CSS
 * (como LineaMeses): se adaptan al ancho sin estirar el texto. Debajo, la leyenda y la tabla semana por semana (plegada),
 * que es también la versión accesible. Server-safe.
 */
export function SemanaASemana({ semanas, elegida, href }: { semanas: SemanaNueva[]; elegida: string; href: (desde: string) => string }) {
  const completas = semanas.filter((s) => s.completa);
  if (!completas.length) return null;
  const mayor = Math.max(1, ...completas.map((s) => s.graves ?? 0));
  const promedio = Math.round(completas.reduce((a, s) => a + (s.graves ?? 0), 0) / completas.length);
  const enCamino = semanas.length - completas.length;
  // El mes se escribe en el eje del celular sólo donde empieza (no entran doce fechas en 390 px).
  const empiezaMes = (i: number) => i === 0 || mesDe(semanas[i].desde) !== mesDe(semanas[i - 1].desde);
  const cuota = (s: SemanaNueva) => (s.buenasPro ? ((s.graves ?? 0) / s.buenasPro) * 100 : null);

  return (
    <figure className="space-y-3" data-lista="grafico">
      <ol aria-label="Contratos con un antecedente grave del ganador, semana a semana" className="flex h-48 items-end gap-1 border-b border-line sm:gap-2">
        {semanas.map((s) => {
          if (!s.completa) {
            return (
              <li key={s.desde} className="flex h-full min-w-0 max-w-[4.5rem] flex-1 flex-col justify-end" title={`Semana ${rangoSemana(s.desde)}: el Estado todavía no la publica completa`}>
                <span className="mb-1 flex justify-center text-mute" aria-hidden>
                  <Clock size={13} />
                </span>
                <span className="block h-[38%] rounded-t-[4px] border-2 border-b-0 border-dashed border-mute/50" aria-hidden />
                <span className="sr-only">Semana {rangoSemana(s.desde)}: en camino, el Estado todavía no la publica completa.</span>
              </li>
            );
          }
          const sel = s.desde === elegida;
          const pct = ((s.graves ?? 0) / mayor) * 100;
          const c = cuota(s);
          const nombre = `Semana ${rangoSemana(s.desde)}: ${numero(s.graves ?? 0)} contratos con antecedente grave${s.buenasPro ? ` de ${numero(s.buenasPro)} buenas pro (${porcentaje(c)})` : ""}`;
          return (
            <li key={s.desde} className="flex h-full min-w-0 max-w-[4.5rem] flex-1 flex-col justify-end">
              <Link
                href={href(s.desde)}
                prefetch={false}
                scroll={false}
                aria-current={sel ? "true" : undefined}
                aria-label={sel ? `${nombre}. Es la semana que se lista abajo.` : `${nombre}. Ver esa semana.`}
                title={nombre}
                className="group flex h-full flex-col justify-end rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mb-1 text-center font-mono text-rotulo tabular-nums",
                    sel ? "font-semibold text-ink" : "hidden text-mute sm:block",
                  )}
                >
                  {numero(s.graves ?? 0)}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "block rounded-t-[4px] transition-colors duration-rapido",
                    sel ? "bg-rust" : "bg-rust/30 group-hover:bg-rust/55",
                  )}
                  style={{ height: `${Math.max(pct, 2)}%` }}
                />
              </Link>
            </li>
          );
        })}
      </ol>
      {/* El eje: el lunes de cada semana. En el celular las columnas miden ~22 px: sólo la semana elegida y dónde empieza
          cada mes (salvo pegado a la elegida, que lo taparía), escritos sobre su columna sin recortarse. */}
      <div className="-mt-1.5 flex gap-1 sm:gap-2" aria-hidden>
        {semanas.map((s, i) => {
          const sel = s.desde === elegida;
          const pegada = semanas[i - 1]?.desde === elegida || semanas[i + 1]?.desde === elegida;
          const enCelular = sel ? diaMes(s.desde) : empiezaMes(i) && !pegada ? mesDe(s.desde) : "";
          return (
            <span key={s.desde} className={cn("relative h-4 min-w-0 max-w-[4.5rem] flex-1 font-mono text-micro", sel ? "font-semibold text-ink" : "text-mute")}>
              {enCelular && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap sm:hidden">{enCelular}</span>}
              <span className="absolute inset-x-0 hidden truncate text-center sm:block">{diaMes(s.desde)}</span>
            </span>
          );
        })}
      </div>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-rotulo text-inkSoft" aria-label="Cómo se lee la gráfica">
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rust" aria-hidden />
          La semana que ves abajo
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rust/30" aria-hidden />
          Otra semana: tócala para verla
        </li>
        {enCamino > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-mute" aria-hidden />
            En camino: el Estado aún no la publica completa
          </li>
        )}
        <li className="inline-flex items-center gap-1.5">Promedio de las {numero(completas.length)} semanas: {numero(promedio)} por semana</li>
      </ul>
      <details className="group rounded-xl border border-line">
        <summary className="cursor-pointer select-none px-3.5 py-2 text-meta font-semibold text-granate">Ver semana por semana</summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-meta">
            <thead className="bg-paperSoft text-left text-rotulo text-mute">
              <tr>
                <th className="px-3.5 py-2 font-medium">Semana</th>
                <th className="px-3.5 py-2 text-right font-medium">Buenas pro</th>
                <th className="px-3.5 py-2 text-right font-medium">Con algún antecedente</th>
                <th className="px-3.5 py-2 text-right font-medium">Con uno grave</th>
                <th className="px-3.5 py-2 text-right font-medium">Parte grave</th>
                <th className="px-3.5 py-2 text-right font-medium">Monto de los graves</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {[...completas].reverse().map((s) => (
                <tr key={s.desde} className={s.desde === elegida ? "bg-crimson-soft/40" : undefined}>
                  <td className="whitespace-nowrap px-3.5 py-1.5 text-inkSoft">
                    <Link href={href(s.desde)} prefetch={false} scroll={false} className="underline-offset-2 hover:text-granate hover:underline">
                      {rangoSemana(s.desde)}
                    </Link>
                  </td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-ink">{s.buenasPro != null ? numero(s.buenasPro) : "Sin dato"}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-inkSoft">{numero(s.conAntecedente ?? 0)}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono font-semibold tabular-nums text-ink">{numero(s.graves ?? 0)}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-inkSoft">{cuota(s) != null ? porcentaje(cuota(s)) : "Sin dato"}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-inkSoft">{solesCompacto(s.monto ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
