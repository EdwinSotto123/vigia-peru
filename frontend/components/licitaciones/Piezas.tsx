import type { ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { diasHasta, nombreTipo } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

/**
 * Piezas chicas de Gobserva Licitaciones (2026-11-02), las mismas en la lista, las tarjetas y la ficha: el plazo de
 * consultas con su urgencia, un monto compacto que no se desborda en el celular y los chips de tipo y procedimiento.
 * Server-safe.
 */

export type TonoPlazo = "urgente" | "pronto" | "normal" | "cerrado";

/** Cuántos días quedan para el fin del plazo de consultas y con qué tono se dice: rojo a 2 días o menos, ámbar a 5. */
export function plazo(hasta: string | null | undefined): { dias: number; tono: TonoPlazo } | null {
  const d = diasHasta(hasta);
  if (d == null) return null;
  return { dias: d, tono: d < 0 ? "cerrado" : d <= 2 ? "urgente" : d <= 5 ? "pronto" : "normal" };
}

/** «Vence hoy», «Queda 1 día», «Quedan 8 días». */
export const quedan = (d: number) => (d <= 0 ? "Vence hoy" : d === 1 ? "Queda 1 día" : `Quedan ${numero(d)} días`);

export const TONO_PLAZO: Record<TonoPlazo, string> = {
  urgente: "bg-crimson-soft text-crimsonTexto",
  pronto: "bg-amber-soft text-amberTexto",
  normal: "bg-paperDeep text-inkSoft",
  cerrado: "bg-paperDeep text-mute",
};

/**
 * El plazo de consultas y observaciones de una convocatoria: la fecha y, en un chip, cuántos días quedan (rojo a 2 días o
 * menos, ámbar a 5, neutro después). Sin fecha en los datos abiertos, se dice dónde está: en el cronograma del SEACE.
 * `alinear="fin"` lo alinea a la derecha desde lg (la columna de la lista).
 */
export function PlazoConsultas({ hasta, alinear = "inicio", className }: { hasta: string | null | undefined; alinear?: "inicio" | "fin"; className?: string }) {
  const p = plazo(hasta);
  const caja = cn("flex min-w-0 flex-col items-start gap-1", alinear === "fin" && "lg:items-end lg:text-right", className);
  if (!p || !hasta) {
    return (
      <span className={caja}>
        <span className="text-rotulo text-mute">Plazo de consultas</span>
        <span className="text-meta leading-snug text-inkSoft">En el cronograma del SEACE</span>
      </span>
    );
  }
  if (p.tono === "cerrado") {
    return (
      <span className={caja}>
        <span className="text-rotulo text-mute">Plazo de consultas</span>
        <span className="text-meta leading-snug text-inkSoft">Cerró el {fechaCorta(hasta)}</span>
      </span>
    );
  }
  return (
    <span className={caja}>
      <span className="text-rotulo text-mute">Consultas hasta el {fechaCorta(hasta)}</span>
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-rotulo font-semibold", TONO_PLAZO[p.tono])}>
        <Hourglass size={12} aria-hidden />
        {quedan(p.dias)}
      </span>
    </span>
  );
}

/**
 * Un monto compacto con la unidad en letra menor: «S/ 66.8» y, pegado, «mil M». Así una cifra grande entra en una tarjeta
 * de media pantalla del celular sin desbordarse (los espacios de un monto no se parten). `className` es el tamaño de la
 * cifra y `unidad` el de su unidad, los dos de la escala.
 */
export function MontoCompacto({ valor, className, unidad }: { valor: number | null | undefined; className?: string; unidad?: string }) {
  const s = solesCompacto(valor);
  const m = /^(S\/\s[\d.,]+)\s(.+)$/u.exec(s);
  if (!m) return <span className={className}>{s}</span>;
  return (
    <span className={className}>
      {m[1]}
      <span className={cn("ml-1", unidad)}>{m[2]}</span>
    </span>
  );
}

/** El tipo de contratación (Bienes, Obras…) en su chip de marca. */
export function ChipTipo({ tipo, className }: { tipo: string | null | undefined; className?: string }) {
  return <span className={cn("shrink-0 rounded-full bg-granate-50 px-2.5 py-0.5 text-rotulo font-semibold text-granate", className)}>{nombreTipo(tipo)}</span>;
}

/** Un chip neutro: el procedimiento («Licitación Pública Abreviada»), la etapa. */
export function ChipNeutro({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("min-w-0 truncate rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft", className)}>{children}</span>;
}

/**
 * Un estado vacío de Licitaciones (lo que no se encontró y qué hacer): la emprendedora con su pregunta en lugar del
 * ícono, con las mismas medidas que EstadoVacio (components/gobserva/ui/Estados). La figura es decorativa.
 */
export function VacioEmprendedora({ titulo, texto, acciones, className }: { titulo: string; texto?: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-10 text-center sm:py-14", className)}>
      <PersonajePregunta nombre="emprendedora" escala={3} />
      <p className="mt-4 text-cuerpo font-semibold text-ink">{titulo}</p>
      {texto && <div className="mt-1.5 max-w-[48ch] text-pretty text-dato leading-relaxed text-inkSoft">{texto}</div>}
      {acciones && <div className="mt-5 flex flex-wrap justify-center gap-2">{acciones}</div>}
    </div>
  );
}
