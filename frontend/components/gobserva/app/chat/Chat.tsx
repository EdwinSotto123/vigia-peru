"use client";

import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { ArrowUp, Check, PencilLine } from "lucide-react";
import { IsotipoGobserva } from "@/components/gobserva/MarcaGobserva";
import { cn } from "@/lib/utils";

/**
 * Las piezas de una entrevista en forma de chat (2026-11-07, el onboarding de Licitaciones y de Empleo): la conversación
 * (un registro que el lector de pantalla anuncia), la burbuja del asistente con la lupa de Gobserva, la tuya con
 * «Cambiar», los puntos de «escribiendo», las respuestas que se tocan y la barra para escribir. Sin lógica de negocio:
 * cada producto arma sus preguntas con esto.
 */

/** ¿Pidió el sistema menos movimiento? Sin demoras ni deslizamientos. */
export function useMenosMovimiento(): boolean {
  const [menos, setMenos] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMenos(m.matches);
    const f = () => setMenos(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return menos;
}

/**
 * `true` durante `ms` cada vez que cambia `clave` (los puntos de «escribiendo» antes de la pregunta nueva). Se calcula
 * en el mismo render en que cambia la clave: la pregunta nueva nunca se asoma un cuadro antes de los puntos.
 * `activo` en false (volver a una ya respondida) o con menos movimiento: sin demora.
 */
export function useEscribiendo(clave: string, activo = true, ms = 700): boolean {
  const menos = useMenosMovimiento();
  const [lista, setLista] = useState<string | null>(null);
  const necesita = activo && !menos;
  useEffect(() => {
    if (!necesita) return;
    const t = window.setTimeout(() => setLista(clave), ms);
    return () => window.clearTimeout(t);
  }, [clave, necesita, ms]);
  return necesita && lista !== clave;
}

/** El valor, recién cuando deja de cambiar por `ms` (para no pedir un conteo por cada toque). */
export function useRetrasado<T>(valor: T, ms = 350): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = window.setTimeout(() => setV(valor), ms);
    return () => window.clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function Conversacion({ etiqueta, children, className }: { etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <div role="log" aria-live="polite" aria-relevant="additions" aria-label={etiqueta} className={cn("space-y-5", className)}>
      {children}
    </div>
  );
}

function Avatar() {
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-caja shadow-caja">
      <IsotipoGobserva tamano={20} />
    </span>
  );
}

/** Lo que dice el asistente. `sinAvatar`: la segunda burbuja seguida (el avatar va sólo en la primera). */
export const MensajeBot = forwardRef<HTMLDivElement, { children: ReactNode; sinAvatar?: boolean; ancho?: boolean; className?: string; id?: string }>(
  function MensajeBot({ children, sinAvatar, ancho, className, id }, ref) {
    return (
      <div ref={ref} id={id} className={cn("flex scroll-mt-36 items-start gap-3 motion-safe:animate-slideUp", className)}>
        {sinAvatar ? <span aria-hidden className="w-9 shrink-0" /> : <Avatar />}
        <div
          className={cn(
            "min-w-0 rounded-2xl rounded-tl-md border border-line bg-caja px-4 py-3 text-cuerpo leading-relaxed text-ink shadow-caja [overflow-wrap:anywhere]",
            ancho ? "flex-1" : "max-w-[36rem]",
          )}
        >
          <span className="sr-only">Gobserva: </span>
          {children}
        </div>
      </div>
    );
  },
);

/** Lo que respondiste, a la derecha, con «Cambiar» para volver a esa pregunta. */
export function MensajeTuyo({ children, onCambiar, etiquetaCambiar = "Cambiar esta respuesta" }: { children: ReactNode; onCambiar?: () => void; etiquetaCambiar?: string }) {
  return (
    <div className="flex flex-col items-end gap-1 pl-12 motion-safe:animate-slideUp">
      <p className="max-w-[32rem] rounded-2xl rounded-tr-md bg-granate px-4 py-2.5 text-cuerpo font-medium leading-relaxed text-paper [overflow-wrap:anywhere]">
        <span className="sr-only">Tú: </span>
        {children}
      </p>
      {onCambiar && (
        <button
          type="button"
          onClick={onCambiar}
          aria-label={etiquetaCambiar}
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-meta font-semibold text-mute transition-colors duration-rapido hover:bg-ink/[0.05] hover:text-ink"
        >
          <PencilLine size={13} aria-hidden /> Cambiar
        </button>
      )}
    </div>
  );
}

/** Los tres puntos de «escribiendo». */
export function Escribiendo() {
  return (
    <div className="flex items-center gap-3" role="status">
      <Avatar />
      <span className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md border border-line bg-caja px-4 py-3.5 shadow-caja">
        <span className="sr-only">Escribiendo</span>
        {[0, 150, 300].map((d) => (
          <span key={d} aria-hidden className="h-2 w-2 rounded-full bg-mute motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
    </div>
  );
}

/** Las respuestas para tocar, debajo de la pregunta (alineadas con la burbuja). */
export function Respuestas({ etiqueta, children, className }: { etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={etiqueta} className={cn("pl-12 motion-safe:animate-fadeIn", className)}>
      {children}
    </div>
  );
}

/**
 * Una respuesta para tocar. `multiple`: se prende y apaga (con su check); si no, responde de una. `detalle`: un dato al
 * lado (cuántas hay hoy). `principal`: la acción de cierre («Listo»), en granate.
 */
export function Opcion({
  children, onClick, activa = false, multiple = false, principal = false, icono, detalle, disabled, className,
}: {
  children: ReactNode;
  onClick?: () => void;
  activa?: boolean;
  multiple?: boolean;
  principal?: boolean;
  icono?: ReactNode;
  detalle?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={multiple ? activa : undefined}
      className={cn(
        "inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border px-4 py-1.5 text-left text-dato font-semibold transition-colors duration-rapido disabled:cursor-not-allowed disabled:opacity-55",
        principal
          ? "border-granate bg-granate text-paper hover:bg-granate-deep"
          : activa
            ? "border-granate bg-granate-50 text-ink"
            : "border-line bg-caja text-ink hover:border-granate/50 hover:bg-granate-50",
        className,
      )}
    >
      {multiple && (
        <span aria-hidden className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", activa ? "border-granate bg-granate text-paper" : "border-ink/25")}>
          {activa && <Check size={10} strokeWidth={3.5} />}
        </span>
      )}
      {icono}
      <span className="min-w-0">{children}</span>
      {detalle != null && <span className={cn("shrink-0 text-meta font-medium tabular-nums", principal ? "text-paper/80" : "text-mute")}>{detalle}</span>}
    </button>
  );
}

/** La barra para escribir, pegada abajo. Sin `onEnviar` (una pregunta de tocar), queda apagada con su indicación. */
export function Compositor({
  valor, onCambio, onEnviar, placeholder, etiqueta, ayuda, error, maxLength = 1000,
}: {
  valor: string;
  onCambio: (v: string) => void;
  onEnviar?: () => void;
  placeholder: string;
  etiqueta: string;
  ayuda?: ReactNode;
  error?: string | null;
  maxLength?: number;
}) {
  const apagado = !onEnviar;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar?.();
      }}
      className="rounded-2xl border border-line bg-caja p-2 shadow-caja focus-within:border-granate focus-within:ring-2 focus-within:ring-granate/25"
    >
      <label htmlFor="chat-texto" className="sr-only">{etiqueta}</label>
      <div className="flex items-end gap-2">
        <textarea
          id="chat-texto"
          value={valor}
          rows={1}
          maxLength={maxLength}
          disabled={apagado}
          onChange={(e) => onCambio(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onEnviar?.();
            }
          }}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? "chat-error" : undefined}
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-destacado text-ink placeholder:text-mute focus:outline-none disabled:cursor-not-allowed sm:text-dato [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={apagado || !valor.trim()}
          aria-label="Enviar"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-granate text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:bg-ink/10 disabled:text-mute"
        >
          <ArrowUp size={18} aria-hidden />
        </button>
      </div>
      {(error || ayuda) && (
        <p id={error ? "chat-error" : undefined} role={error ? "alert" : undefined} className={cn("px-2.5 pb-1 pt-1 text-meta", error ? "font-medium text-crimsonTexto" : "text-mute")}>
          {error ?? ayuda}
        </p>
      )}
    </form>
  );
}
