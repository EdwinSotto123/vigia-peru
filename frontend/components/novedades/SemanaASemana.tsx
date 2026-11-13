import Link from "next/link";
import { Clock } from "lucide-react";
import { colorSerie } from "@/components/charts/BarraSegmentada";
import { fechaCorta, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { diaMes, mesDe, rangoSemana } from "@/lib/semanas";
import { cn } from "@/lib/utils";

/**
 * Una semana de GET /novedades/semana. Tres clases:
 *   completa                  trae sus cifras y cuenta en el promedio;
 *   en curso (`enCurso`)      una de las últimas, que el Estado todavía publica a medias: trae lo que llegó hasta hoy
 *                             (desde el 2026-11-05; antes se daba por completa y abría la página con 4 contratos);
 *   en camino                 sin cifras: todavía no llega ni una buena pro con sus cruces.
 */
export interface SemanaNueva {
  desde: string;
  completa: boolean;
  enCurso?: boolean;
  buenasPro?: number;
  conAntecedente?: number;
  graves?: number;
  monto?: number;
}

/** Trae cifras: completa o en curso (una «en camino» no trae ninguna; una respuesta de antes tampoco marcaba `enCurso`). */
export const conCifras = (s: SemanaNueva) => s.completa || (s.enCurso === true && s.graves != null);

/** El relleno de las buenas pro: el gris de las series («lo demás»), lleno en los dos modos (no un rosado al 30 %). */
const FONDO_BUENAS_PRO = colorSerie("otros");

const cuota = (s: SemanaNueva) => (s.buenasPro ? ((s.graves ?? 0) / s.buenasPro) * 100 : null);

/** Lo que dice una semana, en una frase: el nombre accesible de su columna. */
function nombreSemana(s: SemanaNueva): string {
  const c = cuota(s);
  return `Semana ${rangoSemana(s.desde)}${s.completa ? "" : ", en curso"}: ${numero(s.graves ?? 0)} contratos con antecedente grave${
    s.buenasPro ? ` de ${numero(s.buenasPro)} buenas pro (${porcentaje(c)})` : ""
  }`;
}

/** De qué lado se abre el detalle: en las columnas de las orillas, hacia adentro (centrado se salía del gráfico). */
function lado(i: number, n: number) {
  return i < 2 ? "left-0" : i > n - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
}

/**
 * El detalle de una semana al pasar el mouse o llegar con el teclado (skill dataviz: toda barra con su detalle). Sólo CSS
 * (`group-hover`, `group-focus-visible`), así el gráfico sigue sirviendo en el servidor. El lector de pantalla ya oye lo
 * mismo en el nombre de la columna: aquí va oculto para él.
 */
function Detalle({ s, className }: { s: SemanaNueva; className?: string }) {
  const c = cuota(s);
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-[3] hidden w-max max-w-[16rem] rounded-xl border border-line bg-paper px-3 py-2 text-left text-meta leading-snug shadow-lg group-hover:block group-focus-visible:block",
        className,
      )}
    >
      <span className="block font-display font-bold text-ink">Semana {rangoSemana(s.desde)}</span>
      {!s.completa && <span className="block text-rotulo text-mute">En curso: siguen llegando buenas pro y cruces</span>}
      <span className="mt-1 flex items-center gap-1.5 text-inkSoft">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-rust" />
        <span className="font-mono font-semibold tabular-nums text-ink">{numero(s.graves ?? 0)}</span> con un antecedente grave
      </span>
      {s.buenasPro != null && (
        <span className="flex items-center gap-1.5 text-inkSoft">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: FONDO_BUENAS_PRO }} />
          <span className="font-mono tabular-nums text-ink">{numero(s.buenasPro)}</span> buenas pro{c != null ? ` (${porcentaje(c)} graves)` : ""}
        </span>
      )}
      {(s.monto ?? 0) > 0 && <span className="block text-rotulo text-mute">Los graves suman {solesCompacto(s.monto ?? 0)}</span>}
    </span>
  );
}

/**
 * «Semana a semana» de «Lo nuevo» (2026-11-01; rehecha el 2026-11-05): cada columna es una semana, alta según sus buenas
 * pro (en gris), y dentro, desde abajo, las que ganó alguien con un antecedente grave (en rojo, el color de lo grave).
 * Pedido del usuario del 2026-11-05: una semana flaca se tiene que VER flaca (antes sólo se dibujaban los graves, y la
 * semana del 19 de octubre con 4 parecía una semana tranquila y no una a medio llegar), y las barras de día eran un
 * rosado desvaído (`bg-rust/30`): ahora los dos rellenos son llenos y la semana que se lista abajo va sobre una banda.
 *
 * Después de las completas, las que siguen en curso (más claras y punteadas, con lo que llegó hasta hoy) y las que
 * todavía no llegan («en camino», sólo el contorno). El promedio cuenta sólo las completas. Cada columna es el enlace a
 * su semana, con su nombre completo para el lector de pantalla y su detalle al pasar el mouse o con el teclado. Barras
 * en CSS (como LineaMeses): se adaptan al ancho sin estirar el texto. Debajo, la leyenda y la tabla semana por semana
 * (plegada), que es también la versión accesible. Server-safe.
 */
export function SemanaASemana({ semanas, elegida, href }: { semanas: SemanaNueva[]; elegida: string; href: (desde: string) => string }) {
  const completas = semanas.filter((s) => s.completa);
  if (!completas.length) return null;
  const conDatos = semanas.filter(conCifras);
  // La escala: la semana con más buenas pro (o con más graves, si alguna no trae sus buenas pro). Hasta el 88 % del alto:
  // arriba queda aire para el número de la columna más alta.
  const tope = Math.max(1, ...conDatos.map((s) => Math.max(s.buenasPro ?? 0, s.graves ?? 0)));
  const promedio = Math.round(completas.reduce((a, s) => a + (s.graves ?? 0), 0) / completas.length);
  const enCurso = conDatos.length - completas.length;
  const enCamino = semanas.length - conDatos.length;
  // El mes se escribe en el eje del celular sólo donde empieza (no entran doce fechas en 390 px).
  const empiezaMes = (i: number) => i === 0 || mesDe(semanas[i].desde) !== mesDe(semanas[i - 1].desde);

  return (
    <figure className="min-w-0 space-y-3" data-lista="grafico">
      <ol data-lista="grafico" aria-label="Contratos con un antecedente grave del ganador, semana a semana" className="flex h-52 items-end gap-1 border-b border-line sm:gap-2">
        {semanas.map((s, i) => {
          if (!conCifras(s)) {
            return (
              <li key={s.desde} className="flex h-full min-w-0 max-w-[4.5rem] flex-1 flex-col items-center justify-end" title={`Semana ${rangoSemana(s.desde)}: el Estado todavía no la publica`}>
                <span className="mb-1 flex justify-center text-mute" aria-hidden>
                  <Clock size={13} />
                </span>
                <span className="block h-[30%] w-full max-w-[28px] rounded-t-[4px] border-2 border-b-0 border-dashed border-mute/50" aria-hidden />
                <span className="sr-only">Semana {rangoSemana(s.desde)}: en camino, el Estado todavía no la publica.</span>
              </li>
            );
          }
          const sel = s.desde === elegida;
          const curso = !s.completa;
          const graves = s.graves ?? 0;
          const total = Math.max(s.buenasPro ?? 0, graves);
          const alto = (total / tope) * 88;
          // Qué parte de la columna son los graves (la columna entera son sus buenas pro).
          const parte = total ? (graves / total) * 100 : 0;
          const nombre = nombreSemana(s);
          return (
            <li key={s.desde} className="flex h-full min-w-0 max-w-[4.5rem] flex-1 flex-col justify-end">
              <Link
                href={href(s.desde)}
                prefetch={false}
                scroll={false}
                aria-current={sel ? "true" : undefined}
                aria-label={sel ? `${nombre}. Es la semana que se lista abajo.` : `${nombre}. Ver esa semana.`}
                className={cn(
                  "group relative flex h-full flex-col items-center justify-end rounded-t-md transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                  // La semana que se lista abajo, sobre una banda (el color ya dice qué es cada parte de la columna).
                  sel ? "bg-paperDeep" : "hover:bg-paperDeep/50",
                )}
              >
                {curso && (
                  <span className="mb-1 flex justify-center text-mute" aria-hidden>
                    <Clock size={13} />
                  </span>
                )}
                <span
                  aria-hidden
                  className={cn("relative block w-full max-w-[28px] rounded-t-[4px]", curso && "border border-b-0 border-dashed border-mute opacity-70")}
                  style={{ height: `${Math.max(alto, 2)}%`, background: FONDO_BUENAS_PRO }}
                >
                  <span
                    className={cn("absolute inset-x-0 bottom-0 rounded-t-[4px]", curso ? "bg-rust/60" : "bg-rust")}
                    style={{ height: `${parte}%`, minHeight: graves ? 2 : 0 }}
                  />
                  {/* El número de graves, justo encima de su parte (dentro de la columna gris o arriba de ella). En el
                      celular sólo el de la semana elegida: doce números no entran en 390 px. */}
                  <span
                    className={cn(
                      "absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-rotulo tabular-nums",
                      sel ? "font-semibold text-ink" : "hidden text-inkSoft sm:block",
                    )}
                    style={{ bottom: `calc(${parte}% + 2px)` }}
                  >
                    {numero(graves)}
                  </span>
                </span>
                <Detalle s={s} className={cn("bottom-full mb-1.5", lado(i, semanas.length))} />
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
          Con un antecedente grave del ganador
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FONDO_BUENAS_PRO }} aria-hidden />
          Todas las buenas pro de la semana
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-line bg-paperDeep" aria-hidden />
          La semana que ves abajo
        </li>
        {enCurso > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-mute bg-rust/60" aria-hidden />
            En curso: llegó una parte, faltan buenas pro y cruces
          </li>
        )}
        {enCamino > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-mute" aria-hidden />
            En camino: el Estado aún no la publica
          </li>
        )}
        <li className="inline-flex items-center gap-1.5">
          Promedio de las {numero(completas.length)} semanas completas: {numero(promedio)} por semana
        </li>
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
              {[...conDatos].reverse().map((s) => (
                <tr key={s.desde} className={s.desde === elegida ? "bg-crimson-soft/40" : undefined}>
                  <td className="whitespace-nowrap px-3.5 py-1.5 text-inkSoft">
                    <Link href={href(s.desde)} prefetch={false} scroll={false} className="underline-offset-2 hover:text-granate hover:underline">
                      {rangoSemana(s.desde)}
                    </Link>
                    {!s.completa && <span className="ml-1.5 text-rotulo text-mute">(en curso)</span>}
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

/**
 * Las mismas semanas en chico, para el Inicio (pedido del usuario del 2026-11-05: «Lo nuevo» eran dos cajas de media
 * pantalla con un número cada una). Una columna por semana con cifras, alta según sus contratos graves; la que describen
 * las cifras de al lado, con una raya debajo; las en curso, claras y punteadas. Cada columna abre su semana en «Lo nuevo»
 * y muestra su detalle al pasar el mouse o con el teclado (hacia abajo: la tarjeta del Inicio recorta por arriba).
 * Una sola serie: sin leyenda, con su título encima. Server-safe.
 */
export function SemanasMini({
  semanas,
  elegida,
  href,
  className,
}: {
  semanas: SemanaNueva[];
  elegida: string;
  href: (desde: string) => string;
  className?: string;
}) {
  const datos = semanas.filter(conCifras);
  if (datos.filter((s) => s.completa).length < 2) return null;
  const mayor = Math.max(1, ...datos.map((s) => s.graves ?? 0));
  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="text-rotulo text-mute">Contratos graves, semana a semana</figcaption>
      <ol data-lista="grafico" aria-label="Contratos con un antecedente grave del ganador, semana a semana" className="mt-1.5 flex h-12 items-end gap-[3px] border-b border-line">
        {datos.map((s, i) => {
          const sel = s.desde === elegida;
          const curso = !s.completa;
          const nombre = nombreSemana(s);
          return (
            <li key={s.desde} className="relative flex h-full w-2.5 shrink-0 flex-col justify-end">
              <Link
                href={href(s.desde)}
                prefetch={false}
                aria-label={`${nombre}. Ver esa semana en Lo nuevo.`}
                className="group relative flex h-full flex-col justify-end rounded-t-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                <span
                  aria-hidden
                  className={cn("block w-full rounded-t-[3px] transition-opacity duration-rapido group-hover:opacity-80", curso ? "border border-b-0 border-dashed border-mute bg-rust/50" : "bg-rust")}
                  style={{ height: `${Math.max(4, ((s.graves ?? 0) / mayor) * 100)}%` }}
                />
                <Detalle s={s} className={cn("top-full mt-2.5", lado(i, datos.length))} />
              </Link>
              {/* La semana que dicen las cifras: una raya de tinta bajo su columna. */}
              {sel && <span aria-hidden className="absolute -bottom-1.5 inset-x-0 h-[3px] rounded-full bg-ink" />}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 flex justify-between gap-3 text-micro text-mute" aria-hidden>
        <span>desde el {fechaCorta(datos[0].desde)}</span>
        <span>la más alta: {numero(mayor)}</span>
      </p>
    </figure>
  );
}
