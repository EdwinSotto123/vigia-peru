import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { fechaConAnio } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Piezas para que una ficha CUENTE UNA HISTORIA en vez de apilar bloques (pedido del usuario del 2026-11-05: «veo que solo
 * apilamos y demás sin dar orden o contar una historia»). Una ficha con relato se lee así:
 *
 *   1. `EnUnaFrase`  el veredicto: qué es, quién, cuánto y qué llama la atención, en una o dos oraciones con sus datos.
 *   2. `CapitulosRelato` (./CapitulosRelato) capítulos numerados que se leen de a uno, con un título que es una pregunta o
 *                    una afirmación («Qué pasó», «Por qué llama la atención», «Quién ganó», «De dónde sale cada dato»), en
 *                    ese orden: de lo que pasó a la evidencia. Antes iban apilados con un índice de anclas arriba y la ficha
 *                    medía hasta 4 900 px («divídelo por subsecciones, menos scroll»).
 *   3. `Cronologia`  la columna vertebral de «Qué pasó»: los pasos en orden, cada uno con su fecha, lo que pasó y, PEGADAS
 *                    A ESE PASO, las señales que se ven ahí (la oferta igual al referencial, en la buena pro; la firma
 *                    meses después, en la firma). Así una señal se entiende en su momento y no en una lista suelta: su
 *                    chip abre el capítulo de su evidencia.
 *
 * Server-safe. Usa los tokens del sistema (severidad: crimson/amber/mute; enlaces: granate).
 */

type Severidad = "alta" | "media" | "baja";
const TONO_FRASE: Record<Severidad | "neutro", string> = {
  alta: "border-crimson/40 bg-crimson-soft/50",
  media: "border-amber/40 bg-amber-soft/50",
  baja: "border-line bg-paperSoft",
  neutro: "border-line bg-paperSoft",
};
const COLOR_SEV: Record<Severidad, string> = { alta: "text-crimsonTexto", media: "text-amberTexto", baja: "text-mute" };
const PALABRA_SEV: Record<Severidad, string> = { alta: "Señal alta", media: "Señal media", baja: "Señal baja" };
const PUNTO_SEV: Record<Severidad, string> = { alta: "bg-crimson", media: "bg-amber", baja: "bg-mute" };

/**
 * El veredicto, arriba: una o dos oraciones que cuentan lo esencial («El Ejército le compró a RM Logistic, el único postor,
 * dos reservorios por S/ 212 mil: justo el valor referencial»), con el tono de lo más grave que se encontró y, debajo,
 * los datos que la sostienen (`datos`: chips o `Dato`). Sin título: es lo primero que se lee.
 */
export function EnUnaFrase({
  children,
  tono = "neutro",
  datos,
  pie,
  className,
}: {
  children: ReactNode;
  tono?: Severidad | "neutro";
  datos?: ReactNode;
  pie?: ReactNode;
  className?: string;
}) {
  const Icono = tono !== "neutro" ? ICONO_NIVEL[tono] : null;
  return (
    <section aria-label="En una frase" className={cn("rounded-2xl border px-4 py-3.5 sm:px-5 sm:py-4", TONO_FRASE[tono], className)}>
      <div className="flex items-start gap-3">
        {Icono && <Icono size={20} className={cn("mt-0.5 shrink-0", COLOR_SEV[tono as Severidad])} aria-hidden />}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-destacado font-semibold leading-snug text-ink text-pretty">{children}</p>
          {datos && <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-inkSoft">{datos}</div>}
          {pie && <div className="text-rotulo text-mute">{pie}</div>}
        </div>
      </div>
    </section>
  );
}

/** Una señal pegada a un paso de la cronología: su gravedad, su nombre y, si tiene, a dónde ver su evidencia. */
export interface SenalPaso {
  severidad: Severidad;
  texto: string;
  /** Un ancla (#senal-x) o una ruta a su evidencia. */
  href?: string | null;
}

export interface PasoRelato {
  /** AAAA-MM-DD (o AAAA-MM-DDTHH:MM): se escribe con su año. */
  fecha?: string | null;
  /** Otra forma de decir cuándo, si no hay fecha exacta («antes de cotizar»). */
  cuando?: string;
  titulo: ReactNode;
  detalle?: ReactNode;
  /** Las señales que se ven en este paso. */
  senales?: SenalPaso[];
  /** El paso al que lleva la historia (la buena pro, la firma): punto lleno. */
  destacado?: boolean;
  /** Un paso que no pasó o que no consta («Sin contrato publicado»): punto hueco y texto tenue. */
  falta?: boolean;
}

/**
 * La cronología del relato: cada paso con su fecha (y cuántos días después del anterior), lo que pasó y las señales que se
 * ven en ese momento, como chips de su gravedad. El punto de un paso con señal alta va en rojo: la vista encuentra
 * enseguida dónde se torció la historia.
 */
export function Cronologia({ pasos, etiqueta, className }: { pasos: PasoRelato[]; etiqueta: string; className?: string }) {
  const dia = (f?: string | null) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? Date.parse(f.slice(0, 10)) : NaN);
  return (
    <ol aria-label={etiqueta} className={cn("relative space-y-4 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-0.5 before:bg-line", className)}>
      {pasos.map((p, i) => {
        const peor = (["alta", "media", "baja"] as const).find((s) => p.senales?.some((x) => x.severidad === s));
        const antes = i > 0 ? dia(pasos[i - 1].fecha) : NaN;
        const ahora = dia(p.fecha);
        const dias = Number.isFinite(antes) && Number.isFinite(ahora) ? Math.round((ahora - antes) / 86_400_000) : null;
        return (
          <li key={i} className="relative pl-7">
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-1 size-4 rounded-full border-2",
                p.falta ? "border-paperEdge bg-paper" : peor ? cn("border-paper", PUNTO_SEV[peor]) : p.destacado ? "border-paper bg-granate" : "border-paper bg-inkSoft",
              )}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 text-rotulo">
              <span className="font-mono tabular-nums text-inkSoft">{p.fecha ? fechaConAnio(p.fecha.slice(0, 10)) : p.cuando ?? "Sin fecha"}</span>
              {dias != null && dias > 0 && <span className="font-semibold text-ink">{dias === 1 ? "1 día después" : `${dias} días después`}</span>}
              {dias === 0 && i > 0 && <span className="font-semibold text-ink">el mismo día</span>}
            </div>
            <div className={cn("text-dato font-semibold leading-snug text-pretty", p.falta ? "text-mute" : "text-ink")}>{p.titulo}</div>
            {p.detalle && <div className="mt-0.5 text-meta leading-snug text-inkSoft text-pretty">{p.detalle}</div>}
            {p.senales && p.senales.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Señales en este paso">
                {p.senales.map((s, k) => {
                  const Icono = ICONO_NIVEL[s.severidad];
                  const cuerpo = (
                    <>
                      <Icono size={12} className={cn("shrink-0", COLOR_SEV[s.severidad])} aria-hidden />
                      <span className="sr-only">{PALABRA_SEV[s.severidad]}: </span>
                      {s.texto}
                      {s.href && <ChevronRight size={12} className="shrink-0 opacity-60" aria-hidden />}
                    </>
                  );
                  const clase = cn(
                    "inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-rotulo font-semibold",
                    s.severidad === "alta" ? "border-crimson/30 bg-crimson-soft text-crimsonTexto" : s.severidad === "media" ? "border-amber/30 bg-amber-soft text-amberTexto" : "border-line bg-paperSoft text-inkSoft",
                  );
                  return (
                    <li key={k}>
                      {s.href ? (
                        s.href.startsWith("#") ? (
                          <a href={s.href} className={cn(clase, "hover:underline")}>{cuerpo}</a>
                        ) : (
                          <Link href={s.href} prefetch={false} className={cn(clase, "hover:underline")}>{cuerpo}</Link>
                        )
                      ) : (
                        <span className={clase}>{cuerpo}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
