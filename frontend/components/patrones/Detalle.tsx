import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * El formato del contenido de un panel lateral (`Revelar`/`Panel`) — DESIGN_SYSTEM.md
 * §14.4. Todo panel de detalle se arma igual, de arriba abajo:
 *
 *   chips de estado          (qué es, en una mirada)
 *   Indicadores              (2–3 cifras, si las hay)
 *   DatosClave               (etiqueta → valor, en filas alineadas)
 *   BloqueDetalle × n        (h3 + contenido: evidencia, norma, lista…)
 *   pie del panel            (acciones: abrir la ficha, fuente oficial)
 *
 * Antes cada panel apilaba párrafos y rótulos en mayúsculas a su manera, sin separación
 * entre bloques ni correspondencia entre dato y etiqueta. Server-safe.
 */

/** El cuerpo del panel: el ritmo vertical fijo entre sus piezas. */
export function CuerpoDetalle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-5 text-[14px] leading-relaxed text-ink", className)}>{children}</div>;
}

/** Chips de estado en una fila (severidad, estado, cotejo…). */
export function ChipsDetalle({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

export interface DatoClave {
  etiqueta: string;
  valor: ReactNode;
  /** `<Ayuda/>` junto a la etiqueta. */
  ayuda?: ReactNode;
  /** Valor en mono tabular (montos, códigos, fechas). */
  mono?: boolean;
}

/**
 * Pares etiqueta → valor en filas: la etiqueta a la izquierda en `mute`, el valor a la
 * derecha en `ink`. Se decide por el ancho DEL CONTENEDOR (container query), no de la
 * pantalla: en un panel o una tarjeta angosta la etiqueta va arriba aunque la pantalla
 * sea ancha. `null`/"" en el valor se lee "Sin dato".
 */
export function DatosClave({ items, className }: { items: DatoClave[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line/70 rounded-xl border border-line [container-type:inline-size]", className)}>
      {items.map((d) => (
        <div key={d.etiqueta} className="grid gap-x-4 gap-y-0.5 px-3.5 py-2.5 [@container(min-width:26rem)]:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <dt className="flex items-center gap-1 text-[13px] text-mute">
            {d.etiqueta}
            {d.ayuda}
          </dt>
          <dd className={cn("min-w-0 break-words text-[14px] text-ink", d.mono && "font-mono text-[13px] tabular-nums")}>
            {d.valor == null || d.valor === "" ? <span className="text-mute">Sin dato</span> : d.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Un bloque del panel con su título (h3): "Qué se encontró", "La norma que cita", "Contratos". */
export function BloqueDetalle({
  titulo,
  ayuda,
  acciones,
  children,
  className,
}: {
  titulo: string;
  ayuda?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // El primero del panel no lleva raya arriba: no separa nada de nada.
    <section className={cn("border-t border-line pt-4 first:border-t-0 first:pt-0", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1 font-display text-[15px] font-bold text-ink">
          {titulo}
          {ayuda}
        </h3>
        {acciones}
      </div>
      {children}
    </section>
  );
}

/** Una cita textual (evidencia, extracto del expediente): borde a la izquierda, fuente al pie. */
export function CitaDetalle({ children, fuente }: { children: ReactNode; fuente?: ReactNode }) {
  return (
    <figure className="rounded-r-xl border-l-2 border-granate/40 bg-paperSoft px-3.5 py-2.5">
      <blockquote className="text-[14px] leading-relaxed text-ink">{children}</blockquote>
      {fuente && <figcaption className="mt-1.5 text-[12px] text-mute">{fuente}</figcaption>}
    </figure>
  );
}

/**
 * El pie de un panel (`pie` de `Revelar`/`Panel`): la acción principal primero y las
 * secundarias o destructivas ("Dejar de seguir") a la derecha.
 */
export function PieDetalle({ principal, secundarias }: { principal?: ReactNode; secundarias?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{principal}</div>
      {secundarias && <div className="flex flex-wrap items-center gap-2">{secundarias}</div>}
    </div>
  );
}
