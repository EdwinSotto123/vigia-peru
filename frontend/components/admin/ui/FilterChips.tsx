"use client";

import { cn } from "@/lib/utils";
import { TONO, type Tone } from "./tono";

/**
 * Flechas dentro de un grupo de opciones de selección única (role="radiogroup"): pasan a la
 * opción siguiente o anterior y la eligen, como un grupo de radios nativo. Sólo una opción está
 * en el orden del Tab (la elegida); el resto se alcanza con las flechas.
 */
export function flechasRadio(e: React.KeyboardEvent<HTMLElement>) {
  const paso = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  const extremo = e.key === "Home" ? "primero" : e.key === "End" ? "ultimo" : null;
  if (!paso && !extremo) return;
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'));
  if (!radios.length) return;
  const actual = radios.indexOf(document.activeElement as HTMLElement);
  const i = extremo === "primero" ? 0 : extremo === "ultimo" ? radios.length - 1 : (Math.max(actual, 0) + paso + radios.length) % radios.length;
  e.preventDefault();
  radios[i].focus();
  radios[i].click();
}

/**
 * Chip suelto. `rol="interruptor"` (por defecto): se prende y apaga solo, con aria-pressed (p. ej.
 * cada tipo de contrato que entra a la cola). `rol="radio"`: una opción de un grupo de selección
 * única (va dentro de un role="radiogroup", con aria-checked). Se ven igual.
 */
export function Chip({
  activo,
  onClick,
  cuenta,
  tono,
  title,
  disabled,
  rol = "interruptor",
  enfocable,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  cuenta?: number | null;
  tono?: Tone;
  title?: string;
  disabled?: boolean;
  rol?: "interruptor" | "radio";
  /** Radio: si entra en el orden del Tab. Por defecto, sólo el elegido. */
  enfocable?: boolean;
  children: React.ReactNode;
}) {
  const radio = rol === "radio";
  return (
    <button
      type="button"
      onClick={onClick}
      role={radio ? "radio" : undefined}
      aria-checked={radio ? activo : undefined}
      aria-pressed={radio ? undefined : activo}
      tabIndex={radio ? ((enfocable ?? activo) ? 0 : -1) : undefined}
      title={title}
      disabled={disabled}
      // Las píldoras de BarraFiltros del sitio público, en el tamaño del panel: la elegida en lima.
      className={cn(
        "inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-rapido active:translate-y-px disabled:opacity-50",
        activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
      )}
    >
      {tono && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", activo ? "bg-paper/70" : TONO[tono].punto)} aria-hidden />}
      {children}
      {cuenta != null && <span className="text-[12px] font-semibold tabular-nums opacity-80">{cuenta.toLocaleString("es-PE")}</span>}
    </button>
  );
}

export interface OpcionChip<K extends string> {
  valor: K;
  etiqueta: string;
  cuenta?: number | null;
  tono?: Tone;
}

/**
 * Grupo de filtros de selección única: para el lector de pantalla es un grupo de radios (una
 * opción elegida, flechas para moverse). Envuelve en varias líneas antes que desbordar la página.
 */
export function FilterChips<K extends string>({
  opciones,
  valor,
  onCambiar,
  etiqueta,
  className,
}: {
  opciones: OpcionChip<K>[];
  valor: K;
  onCambiar: (v: K) => void;
  /** Nombre del grupo para lectores de pantalla ("Estado del aporte"). */
  etiqueta: string;
  className?: string;
}) {
  // Si el valor no es ninguna opción (un ?estado= viejo en la URL), la primera queda alcanzable con Tab.
  const hayElegida = opciones.some((o) => o.valor === valor);
  return (
    <div role="radiogroup" aria-label={etiqueta} onKeyDown={flechasRadio} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {opciones.map((o, i) => (
        <Chip key={o.valor} rol="radio" activo={o.valor === valor} enfocable={hayElegida ? undefined : i === 0} onClick={() => onCambiar(o.valor)} cuenta={o.cuenta} tono={o.tono}>
          {o.etiqueta}
        </Chip>
      ))}
    </div>
  );
}
