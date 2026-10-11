import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Aviso de una línea con su acción, en horizontal: reemplaza al estado vacío de pantalla entera cuando lo único
 * que falta es una cuenta o un primer dato. Una caja con borde y poco texto no puede medir 250 px de alto
 * (docs/auditoria-ui): acá el texto manda y la altura es la de dos líneas.
 *
 * Server component: la acción llega armada (`<Link>` o `<button>`), nunca como función.
 */
export function Franja({
  icono,
  titulo,
  children,
  accion,
  apilada = false,
  className,
}: {
  /** En una columna angosta (media pantalla): el texto arriba a todo el ancho y los botones debajo, sin repartirse la fila. */
  apilada?: boolean;
  icono?: ReactNode;
  titulo: string;
  /** Una o dos frases: qué pasa y por qué. */
  children?: ReactNode;
  /** Qué hacer: uno o dos botones ya armados. */
  accion?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-line bg-paperSoft px-4 py-3 sm:px-5", apilada ? "items-start" : "sm:w-fit sm:max-w-full sm:flex-row sm:items-center sm:gap-5", className)}>
      {icono && (
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-granate sm:flex" aria-hidden>
          {icono}
        </span>
      )}
      <div className="min-w-0 max-w-2xl flex-1">
        <p className="font-display text-[16px] font-bold leading-tight text-ink">{titulo}</p>
        {children && <p className="mt-0.5 text-[13.5px] leading-snug text-inkSoft">{children}</p>}
      </div>
      {accion && (
        <div className={cn("flex w-full flex-wrap gap-2 [&>*]:flex-1 [&>*]:justify-center", apilada ? "sm:[&>*]:flex-none" : "sm:w-auto sm:shrink-0 sm:[&>*]:flex-none")}>{accion}</div>
      )}
    </div>
  );
}

export interface Beneficio {
  icono?: ReactNode;
  titulo: string;
  /** Una frase corta. */
  texto: string;
}

/**
 * Lo que se obtiene, en filas compactas: título y una frase, sin tarjetas de 250 px. Se ordena en 1, 2 o 3 (o 4)
 * columnas según el ancho y no deja huecos: cada celda es del alto de su texto.
 */
export function Beneficios({ items, className, columnas }: { items: Beneficio[]; className?: string; columnas?: 1 | 2 }) {
  // `columnas` fija el ancho de la rejilla cuando el bloque vive en media pantalla; sin él, se reparte según el ancho.
  const cols =
    columnas === 1 ? "grid-cols-1" : columnas === 2 ? "sm:grid-cols-2" : items.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <ul className={cn("grid gap-2.5", cols, className)}>
      {items.map((b) => (
        <li key={b.titulo} className="flex items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3">
          {b.icono && (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-granate" aria-hidden>
              {b.icono}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[14.5px] font-semibold leading-snug text-ink">{b.titulo}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-mute">{b.texto}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
