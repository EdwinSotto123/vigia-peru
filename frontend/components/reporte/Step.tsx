"use client";

// Paso numerado del formulario, compartido por FormObra y FormEntidad (extraído de page.tsx).
// Este formulario NO es un wizard paginado: los 5-6 pasos están todos montados a
// la vez, uno debajo del otro, y "avanzar" es simplemente scrollear. Antes ese
// scroll no tenía ningún feedback de movimiento (todos los pasos aparecían de
// golpe, sin transición). Cada paso se pinta directo para
// que avanzar por el formulario se sienta como una progresión real.
export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-granate text-xs font-bold tabular-nums text-paper" aria-hidden>
            {n}
          </span>
          <h2 className="font-display text-[15px] font-bold text-ink">
            <span className="sr-only">Paso {n}: </span>
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}
