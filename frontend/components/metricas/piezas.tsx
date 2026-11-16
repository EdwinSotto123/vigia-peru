import type { ReactNode } from "react";
import { CalendarDays, CircleSlash, Database, Ruler } from "lucide-react";
import { Medidor } from "@/components/charts/BarraSegmentada";
import { fechaConAnio, numero, porcentaje } from "@/lib/formato";
import { diaDe, horaDe } from "@/lib/transparencia";
import { cn } from "@/lib/utils";

/**
 * Las piezas de /metricas. Cada bloque es una caja con su título, su contenido y, al pie, las dos cosas que el dueño
 * pidió en todos (2026-11-16): la fecha del dato y de dónde sale.
 */

/** «15 nov. 2026, 20:44» (hora de Lima) o sólo el día si no trae hora. */
export function fechaHora(f: string | null | undefined): string {
  const dia = diaDe(f);
  if (!dia) return "Sin fecha";
  const hora = horaDe(f);
  return hora ? `${fechaConAnio(dia)}, ${hora}` : fechaConAnio(dia);
}

/** El pie de un bloque: cuándo es el dato y de qué tabla o proceso sale. */
export function PieDato({ fecha, fuente, className }: { fecha: string | null | undefined; fuente: string; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2.5 text-rotulo text-mute", className)}>
      <div className="flex items-center gap-1.5">
        <CalendarDays size={13} className="shrink-0" aria-hidden />
        <dt>Fecha del dato:</dt>
        <dd className="font-medium tabular-nums text-inkSoft">{fechaHora(fecha)}</dd>
      </div>
      <div className="flex min-w-0 items-start gap-1.5">
        <Database size={13} className="mt-0.5 shrink-0" aria-hidden />
        <dt className="shrink-0">De dónde sale:</dt>
        <dd className="min-w-0 text-inkSoft">{fuente}</dd>
      </div>
    </dl>
  );
}

export function Caja({
  titulo,
  icono,
  bajada,
  children,
  fecha,
  fuente,
  className,
}: {
  titulo: string;
  icono?: ReactNode;
  bajada?: ReactNode;
  children: ReactNode;
  /** Con `fuente`, pinta el pie con la fecha del dato y de dónde sale. */
  fecha?: string | null;
  fuente?: string;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-paper p-4 sm:p-5", className)}>
      <header>
        <h3 className="flex items-center gap-2 font-display text-cuerpo font-bold text-ink">
          {icono && <span className="shrink-0 text-granate">{icono}</span>}
          {titulo}
        </h3>
        {bajada && <p className="mt-1 text-meta leading-relaxed text-inkSoft">{bajada}</p>}
      </header>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
      {fuente && <PieDato fecha={fecha} fuente={fuente} />}
    </section>
  );
}

/** Qué mide y qué no mide una cifra, en dos renglones con ícono (nunca un párrafo suelto). */
export function MideNoMide({ mide, noMide }: { mide: string; noMide: string }) {
  return (
    <dl className="space-y-1.5 text-meta leading-relaxed">
      <div className="flex gap-2">
        <Ruler size={14} className="mt-0.5 shrink-0 text-granate" aria-hidden />
        <div className="min-w-0">
          <dt className="inline font-semibold text-ink">Qué mide: </dt>
          <dd className="inline text-inkSoft">{mide}</dd>
        </div>
      </div>
      <div className="flex gap-2">
        <CircleSlash size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
        <div className="min-w-0">
          <dt className="inline font-semibold text-ink">Qué no mide: </dt>
          <dd className="inline text-inkSoft">{noMide}</dd>
        </div>
      </div>
    </dl>
  );
}

/**
 * Una medida de verificación: su nombre, la cifra («18,402 de 24,898»), la barra de esa proporción, y qué mide y qué no.
 * Sin denominador (`de` nulo o cero) no hay barra ni porcentaje: se muestra el conteo solo.
 */
export function Metrica({
  titulo,
  parte,
  de,
  unidad,
  mide,
  noMide,
  fecha,
  fuente,
  children,
}: {
  titulo: string;
  parte: number;
  de?: number | null;
  /** Qué se cuenta: «señales», «citas», «dictámenes». */
  unidad: string;
  mide: string;
  noMide: string;
  fecha: string | null | undefined;
  fuente: string;
  children?: ReactNode;
}) {
  const p = de ? parte / de : null;
  return (
    <Caja titulo={titulo} fecha={fecha} fuente={fuente}>
      <div>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-cifra font-bold tabular-nums leading-none text-ink">
            {p != null ? porcentaje(p * 100, { decimales: (p > 0 && p < 0.1) || (p > 0.99 && p < 1) ? 2 : 1 }) : numero(parte)}
          </span>
          <span className="text-meta tabular-nums text-inkSoft">
            {de ? `${numero(parte)} de ${numero(de)} ${unidad}` : unidad}
          </span>
        </p>
        {p != null && <Medidor parte={p} etiqueta={`${titulo}: ${numero(parte)} de ${numero(de)} ${unidad}`} className="mt-2" />}
      </div>
      {children}
      <MideNoMide mide={mide} noMide={noMide} />
    </Caja>
  );
}

/** Un renglón con su barra: nombre a la izquierda, la proporción dibujada y la cifra a la derecha. */
export function RenglonMedidor({ nombre, parte, texto, sub }: { nombre: string; parte: number | null; texto: string; sub?: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="min-w-0 text-meta leading-snug text-ink">{nombre}</span>
      <span className="font-mono text-meta tabular-nums text-ink">{texto}</span>
      {parte != null && <Medidor parte={parte} etiqueta={`${nombre}: ${texto}`} className="col-span-2" />}
      {sub && <span className="col-span-2 text-rotulo text-mute">{sub}</span>}
    </li>
  );
}

/** Un bloque que la base todavía no puede responder: se dice, con el porqué. Nunca un cero. */
export function NoMedido({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section role="note" className="rounded-2xl border border-dashed border-line bg-paperSoft p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-display text-cuerpo font-bold text-ink">
        <CircleSlash size={16} className="shrink-0 text-mute" aria-hidden />
        {titulo}: no medido
      </h3>
      <p className="mt-1 text-meta leading-relaxed text-inkSoft">{children}</p>
    </section>
  );
}
