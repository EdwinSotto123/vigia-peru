"use client";

/**
 * Las piezas del trámite de aportar que comparten el formulario ciudadano (ContribuirForm)
 * y el lote del administrador (LoteAdmin): el selector de cantidad, las opciones en
 * píldora y los pasos. Antes vivían dentro de ContribuirForm.
 */

import { useId } from "react";
import { numero, soles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Tarjeta del formulario en reposo: borde, sin sombra (DESIGN_SYSTEM.md §5). */
export const TARJETA = "rounded-2xl border border-line bg-paper p-5 sm:p-6";
/** Etiqueta de un grupo de campos: 1–3 palabras, así que va en versalitas (§4). */
export const ETIQUETA_GRUPO = "text-[11px] font-semibold uppercase tracking-wide text-mute";

/**
 * Opción de un grupo de radio con apariencia de píldora. Es un <input type="radio"> nativo
 * (flechas del teclado, lector de pantalla y foco gratis) escondido dentro de su etiqueta;
 * el anillo de foco se dibuja en la etiqueta con `has-[:focus-visible]`. La elegida va en
 * granate suave: es la marca diciendo "esto elegiste", no una segunda acción primaria.
 */
export function OpcionRadio({ name, checked, onChange, children, className = "" }: {
  name: string; checked: boolean; onChange: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors duration-150",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-granate has-[:focus-visible]:ring-offset-2",
        checked ? "border-granate bg-granate-soft font-semibold text-granate" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
        className,
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

/**
 * Paso "¿cuántos contratos?": mismo selector para el formulario ciudadano y para el admin.
 * El campo "Otro" guarda el TEXTO tal cual se escribe (antes se reescribía en cada tecla y
 * escribir "20" daba 50); se valida al salir del campo y al enviar, contra [mínimo, restantes].
 */
export function CantidadPicker({ nombreGrupo, cantidadTxt, setCantidadTxt, presets, tope, esTodos, precioPen, monto, error, onBlur }: {
  nombreGrupo: string;
  cantidadTxt: string;
  setCantidadTxt: (s: string) => void;
  presets: number[];
  /** Máximo que se puede pedir: lo que queda sin financiar (o el tope del lote admin). */
  tope: number;
  /** El tope es TODO lo que queda en la zona o la entidad: la opción se rotula "Todos (N)". */
  esTodos: boolean;
  precioPen: number;
  monto: number | null;
  error: string | null;
  onBlur: () => void;
}) {
  const idError = useId();
  const opciones = presets.includes(tope) ? presets : [...presets, tope];
  return (
    <div className="mt-5" role="group" aria-labelledby={`${nombreGrupo}-lbl`}>
      <div id={`${nombreGrupo}-lbl`} className={ETIQUETA_GRUPO}>Contratos</div>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Cantidad de contratos">
        {opciones.map((n) => (
          <OpcionRadio key={n} name={nombreGrupo} checked={cantidadTxt === String(n)} onChange={() => setCantidadTxt(String(n))}>
            <span className="tabular-nums">{n === tope && esTodos && !presets.includes(n) ? `Todos (${numero(n)})` : numero(n)}</span>
            <span className="ml-1 font-mono text-[12px] font-normal tabular-nums opacity-80">{soles(n * precioPen)}</span>
          </OpcionRadio>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`${nombreGrupo}-otro`} className="text-inkSoft">Otra cantidad</label>
        <input
          id={`${nombreGrupo}-otro`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={cantidadTxt}
          onChange={(e) => setCantidadTxt(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onBlur={onBlur}
          aria-invalid={!!error}
          aria-describedby={error ? idError : undefined}
          className={cn("w-24 rounded-xl border bg-paper px-3 py-1.5 font-mono tabular-nums", error ? "border-crimson" : "border-line")}
        />
        {monto != null && <span className="font-mono tabular-nums text-ink">= {soles(monto)}</span>}
      </div>
      {error && <p id={idError} className="mt-1.5 text-[12px] text-crimsonTexto" role="alert">{error}</p>}
    </div>
  );
}

/** Los tres pasos del trámite. Hecho = moss (positivo); en curso = granate (la marca). */
export function Stepper({ step, primero = "Zona" }: { step: 1 | 2 | 3 | 4; primero?: "Zona" | "Entidad" }) {
  const steps = [primero, "Cantidad", "Pago"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[12px]" aria-label="Pasos">
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < step, active = n === step;
        return (
          <li key={s} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px]",
              done ? "bg-moss text-paper" : active ? "bg-granate text-paper" : "bg-paperDeep text-mute",
            )}>
              {done ? <span aria-hidden>✓</span> : n}
              {done && <span className="sr-only">hecho:</span>}
            </span>
            <span className={active ? "font-semibold text-ink" : "text-mute"}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Valida la cantidad contra [mínimo, restantes]. null = válida. `mensajeTope` dice cuántos
 * quedan, con el nombre de la zona o de la entidad.
 */
export function errorCantidad(n: number, restantes: number, minimo: number, mensajeTope: string): string | null {
  if (!Number.isFinite(n)) return "Escribe cuántos contratos quieres financiar.";
  if (n < minimo) return minimo === 1 ? "Elige al menos 1 contrato." : `El mínimo son ${minimo} contratos por aporte.`;
  if (n > restantes) return mensajeTope;
  return null;
}
