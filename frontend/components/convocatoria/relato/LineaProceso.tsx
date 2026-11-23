"use client";

import type { ReactNode } from "react";
import { Award, CalendarClock, ChevronRight, Footprints, Hammer, Megaphone, PenLine, Timer, UsersRound, type LucideIcon } from "lucide-react";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { fechaConAnio, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { ContextoSenal } from "../senal/directorio";
import { senalDeBandera } from "../senal/normalizar";
import { VerSenal } from "../senal/PanelSenal";
import type { ChipPaso, ClavePaso } from "./historia";

/**
 * La cronología del proceso en «Qué pasó» (pedido del usuario del 2026-11-16: «ESTO no tiene FORMA»). Antes era la
 * `Cronologia` genérica del kit: un punto, la fecha en una línea gris y el texto debajo, todo del mismo peso. Ahora es
 * una línea de tiempo de verdad:
 *
 *   · arriba, los tiempos del proceso como DATOS (de la convocatoria a la buena pro, de la buena pro a la firma, total);
 *   · un riel con un hito por paso (su ícono; rojo o ámbar si ahí hay una señal), la fecha a la izquierda en su columna
 *     y, bajo ella, cuántos días pasaron desde el paso anterior;
 *   · cada paso en su caja, con su nombre («Buena pro»), lo que pasó y, PEGADAS a él, sus señales como banderas que se
 *     tocan: abren su evidencia en el panel lateral, sin moverse de la cronología.
 *
 * En el celular la fecha sube a la cabecera de la caja (una columna de fechas dejaba el texto en 200 px).
 */

export interface PasoProceso {
  clave: ClavePaso;
  /** AAAA-MM-DD. */
  fecha?: string | null;
  /** Otra forma de decir cuándo, si no hay fecha exacta («Antes de la convocatoria», «Todavía no consta»). */
  cuando?: string;
  titulo: ReactNode;
  detalle?: ReactNode;
  destacado?: boolean;
  /** Un paso que no consta («Sin contrato firmado en el registro»): hito hueco y texto tenue. */
  falta?: boolean;
  chips?: ChipPaso[];
}

const ETAPA: Record<ClavePaso, { nombre: string; icono: LucideIcon }> = {
  antes: { nombre: "Antes de convocar", icono: Footprints },
  convocatoria: { nombre: "Convocatoria", icono: Megaphone },
  ofertas: { nombre: "Participantes y ofertas", icono: UsersRound },
  buena_pro: { nombre: "Buena pro", icono: Award },
  firma: { nombre: "Contrato", icono: PenLine },
  ejecucion: { nombre: "Ejecución", icono: Hammer },
  plazo: { nombre: "Fin del plazo", icono: CalendarClock },
};

type Sev = "alta" | "media" | "baja";
const HITO: Record<Sev | "neutro" | "destacado" | "falta", string> = {
  alta: "border-crimson bg-crimson-soft text-crimsonTexto",
  media: "border-amber bg-amber-soft text-amberTexto",
  baja: "border-paperEdge bg-paperDeep text-inkSoft",
  destacado: "border-granate bg-granate-50 text-granate",
  neutro: "border-paperEdge bg-paper text-inkSoft",
  falta: "border-dashed border-paperEdge bg-paper text-mute",
};
// Dentro de una superficie (`.tarjeta`, el capítulo de la historia) el paso no lleva marco: caja dentro de caja. Va sobre un
// fondo del color de su señal más grave (crimson, ámbar) o apenas hundido si no tiene.
const CAJA: Record<Sev | "neutro", string> = {
  alta: "border-crimson/40 [.tarjeta_&]:border-transparent [.tarjeta_&]:bg-crimson-soft/50",
  media: "border-amber/40 [.tarjeta_&]:border-transparent [.tarjeta_&]:bg-amber-soft/50",
  baja: "border-line [.tarjeta_&]:border-transparent [.tarjeta_&]:bg-paperSoft",
  neutro: "border-line [.tarjeta_&]:border-transparent [.tarjeta_&]:bg-paperSoft",
};
const CHIP: Record<Sev, string> = {
  alta: "border-crimson/40 bg-crimson-soft text-crimsonTexto hover:border-crimson",
  media: "border-amber/40 bg-amber-soft text-amberTexto hover:border-amber",
  baja: "border-line bg-paperSoft text-inkSoft hover:border-paperEdge",
};
const PALABRA: Record<Sev, string> = { alta: "Señal alta", media: "Señal media", baja: "Señal baja" };

const dia = (f?: string | null) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? Date.parse(f.slice(0, 10)) : NaN);
const diasEntre = (a?: string | null, b?: string | null): number | null => {
  const x = dia(a);
  const y = dia(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86_400_000) : null;
};

/** Los tiempos del proceso que se pueden medir con las fechas del registro, como datos. */
function tiempos(pasos: PasoProceso[]): { etiqueta: string; dias: number }[] {
  const f = (c: ClavePaso) => pasos.find((p) => p.clave === c && !p.falta)?.fecha ?? null;
  const tramos: [string, ClavePaso, ClavePaso][] = [
    ["De la convocatoria a la buena pro", "convocatoria", "buena_pro"],
    ["De la buena pro a la firma", "buena_pro", "firma"],
    ["De la convocatoria a la firma", "convocatoria", "firma"],
  ];
  const out: { etiqueta: string; dias: number }[] = [];
  for (const [etiqueta, a, b] of tramos) {
    const d = diasEntre(f(a), f(b));
    // Una firma anterior a la convocatoria (dato raro del registro) no se presenta como un tiempo: lo dice su paso.
    if (d !== null && d >= 0) out.push({ etiqueta, dias: d });
  }
  // Con los dos tramos, el total es su suma: no se repite (en el celular era una fila más de 60 px).
  return out.length === 3 ? out.slice(0, 2) : out;
}

export function LineaProceso({ pasos, ctx, perfil }: { pasos: PasoProceso[]; ctx: ContextoSenal | null; perfil?: string | null }) {
  const cifras = tiempos(pasos);
  return (
    <div className="space-y-4">
      {cifras.length > 0 && (
        <dl className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper sm:flex-row sm:divide-x sm:divide-y-0 [.tarjeta_&]:rounded-xl [.tarjeta_&]:border-0 [.tarjeta_&]:bg-paperSoft" aria-label="Los tiempos del proceso">
          {cifras.map((c) => (
            <div key={c.etiqueta} className="flex flex-1 items-center gap-3 px-4 py-2.5">
              <Timer size={16} className="shrink-0 text-mute" aria-hidden />
              <div className="min-w-0">
                <dt className="text-rotulo text-mute">{c.etiqueta}</dt>
                <dd className="font-display text-bloque font-bold tabular-nums leading-tight text-ink">{c.dias === 0 ? "El mismo día" : plural(c.dias, "día", "días")}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}

      <ol aria-label="Los pasos del proceso" className="relative">
        {pasos.map((p, i) => {
          const etapa = ETAPA[p.clave];
          const peor = (["alta", "media", "baja"] as const).find((s) => p.chips?.some((c) => c.severidad === s));
          const tono = p.falta ? "falta" : peor ?? (p.destacado ? "destacado" : "neutro");
          // Los días desde el paso anterior CON fecha (un paso sin fecha en el medio no corta la cuenta).
          const anterior = [...pasos.slice(0, i)].reverse().find((x) => Number.isFinite(dia(x.fecha)));
          const dias = diasEntre(anterior?.fecha, p.fecha);
          const cuando = p.fecha ? fechaConAnio(p.fecha.slice(0, 10)) : p.cuando ?? "Sin fecha";
          const despues =
            dias === null ? null : dias === 0 ? "el mismo día" : dias > 0 ? `${plural(dias, "día", "días")} después` : `${plural(-dias, "día", "días")} antes`;
          const ultimo = i === pasos.length - 1;
          return (
            <li key={`${p.clave}-${i}`} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[7.5rem_2rem_minmax(0,1fr)]">
              {/* La fecha, en su columna (desde sm): arriba el día, debajo cuánto pasó desde el paso anterior. */}
              <div className="hidden pb-5 pt-1 text-right sm:block">
                <p className={cn("font-mono text-meta tabular-nums", p.fecha ? "font-semibold text-ink" : "text-mute")}>{cuando}</p>
                {despues && <p className="mt-0.5 text-rotulo text-inkSoft">{despues}</p>}
              </div>

              {/* El riel: el hito y la línea hasta el paso siguiente. */}
              <div className="relative flex justify-center" aria-hidden>
                {!ultimo && <span className="absolute bottom-0 top-8 w-0.5 bg-line" />}
                <span className={cn("relative z-[1] flex size-8 items-center justify-center rounded-full border-2", HITO[tono])}>
                  <etapa.icono size={15} />
                </span>
              </div>

              {/* El paso, en su caja. */}
              <div className={cn("mb-4 min-w-0 rounded-2xl border bg-paper px-4 py-3", p.falta ? "border-dashed border-line" : CAJA[peor ?? "neutro"], ultimo && "mb-0")}>
                {/* Sin rótulo en mayúsculas encima del título (antes «CONVOCATORIA» sobre «El hospital publicó la convocatoria»): el
                    ícono del riel dice la etapa y el título la cuenta. Para el lector de pantalla, la etapa va escondida. En el
                    celular la fecha va debajo del título, no encima. */}
                <span className="sr-only">{etapa.nombre}: </span>
                <div className={cn("text-cuerpo font-semibold leading-snug text-pretty", p.falta ? "text-mute" : "text-ink")}>{p.titulo}</div>
                <p className="mt-0.5 text-rotulo sm:hidden">
                  <span className={cn("font-mono tabular-nums", p.fecha ? "font-semibold text-ink" : "text-mute")}>{cuando}</span>
                  {despues && <span className="text-inkSoft">, {despues}</span>}
                </p>
                {p.detalle && <div className="mt-1 text-meta leading-snug text-inkSoft text-pretty">{p.detalle}</div>}
                {p.chips && p.chips.length > 0 && (
                  <div className="mt-2.5 border-t border-line/70 pt-2.5">
                    <p className="mb-1.5 text-rotulo text-mute">
                      {p.chips.length === 1 ? "La señal de este paso" : `Las ${p.chips.length} señales de este paso`}
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {p.chips.map((c) => {
                        const Icono = ICONO_NIVEL[c.severidad];
                        return (
                          <li key={c.regla} className="min-w-0 max-w-full">
                            <VerSenal
                              senales={c.senales.map((s) => senalDeBandera(s.origen))}
                              ctx={ctx}
                              perfil={perfil}
                              etiqueta={`${PALABRA[c.severidad]}: ${c.etiqueta}${c.n > 1 ? `, ${c.n} hallazgos` : ""}. Ver la evidencia`}
                              className={cn(
                                "inline-flex min-h-8 w-auto max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-rotulo font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                                CHIP[c.severidad],
                              )}
                            >
                              <Icono size={13} className="shrink-0" aria-hidden />
                              <span className="min-w-0 break-words text-left">{c.etiqueta}</span>
                              {c.n > 1 && <span className="shrink-0 rounded-full bg-paper/70 px-1.5 font-mono tabular-nums">{c.n}</span>}
                              <ChevronRight size={13} className="shrink-0 opacity-70" aria-hidden />
                            </VerSenal>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
