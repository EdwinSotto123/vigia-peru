"use client";

// Pasos en columnas del formulario de denuncia (compartido por FormObra y FormEntidad).
//
// En escritorio (desde lg) los tres pasos se ven a la vez, uno por columna, con la misma altura. El
// siguiente paso está BLOQUEADO (atenuado, con candado, sin foco ni clics: `inert`) hasta que el
// anterior tiene lo mínimo; al completarlo se habilita solo, la columna destaca un momento y un aviso
// educado (aria-live) lo dice. Los pasos completados se pueden volver a editar y nada se borra.
//
// En el teléfono (< lg) los mismos pasos son un acordeón: solo el activo está abierto, los
// completados quedan en una línea de resumen editable y los bloqueados, plegados con su candado.
//
// El foco solo se mueve solo cuando la persona NO está escribiendo (si tecleas la dirección y se
// completa el paso, no te quitamos el cursor). Para pasar de paso a mano está "Seguir".

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Paso {
  id: string;
  titulo: string;
  /** Ícono pequeño del encabezado (se cambia por el check al completarse). */
  icono: React.ReactNode;
  completa: boolean;
  bloqueado: boolean;
  /** Por qué está bloqueado ("Completa la foto para seguir"). */
  motivo: string;
  /** Una línea que se ve cuando el paso está completo y plegado (móvil). */
  resumen: string;
  children: React.ReactNode;
}

const TECLEO = new Set(["text", "search", "email", "number", "date", "tel", "url"]);

/** ¿La persona está escribiendo en este momento? Si sí, no le movemos el foco. */
function estaEscribiendo(): boolean {
  const a = document.activeElement;
  if (a instanceof HTMLTextAreaElement) return true;
  return a instanceof HTMLInputElement && TECLEO.has(a.type);
}

const movimientoReducido = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const esMovil = () => !window.matchMedia("(min-width: 1024px)").matches;

/** ¿Hay espacio para las tres columnas (lg)? En escritorio el encabezado no es un botón. */
function useEscritorio(): boolean {
  const [si, setSi] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const leer = () => setSi(mq.matches);
    leer();
    mq.addEventListener("change", leer);
    return () => mq.removeEventListener("change", leer);
  }, []);
  return si;
}

export function PasosEnColumnas({ pasos, etiqueta }: { pasos: Paso[]; etiqueta: string }) {
  const base = useId();
  const escritorio = useEscritorio();
  const contenedor = useRef<HTMLDivElement>(null);
  const celdas = useRef<(HTMLElement | null)[]>([]);
  const previo = useRef<boolean[]>(pasos.map((p) => p.completa));
  const [abierto, setAbierto] = useState(() => {
    const i = pasos.findIndex((p) => !p.completa);
    return i === -1 ? pasos.length - 1 : i;
  });
  const [recien, setRecien] = useState<number | null>(null);
  const [anuncio, setAnuncio] = useState("");

  const irA = useCallback(
    (i: number, enfocar = true) => {
      setAbierto(i);
      // El contenido de un paso plegado está oculto: se enfoca cuando ya se pintó.
      window.requestAnimationFrame(() => {
        const celda = celdas.current[i];
        if (!celda) return;
        if (esMovil()) celda.scrollIntoView({ behavior: movimientoReducido() ? "auto" : "smooth", block: "start" });
        if (!enfocar) return;
        const primero = celda.querySelector<HTMLElement>(
          "input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
        );
        primero?.focus({ preventScroll: true });
      });
    },
    [],
  );

  const clave = pasos.map((p) => (p.completa ? 1 : 0) + (p.bloqueado ? "b" : "")).join("");

  useEffect(() => {
    pasos.forEach((p, i) => {
      const sig = pasos[i + 1];
      if (!previo.current[i] && p.completa && sig && !sig.bloqueado) {
        setAnuncio(`Paso ${i + 1} listo: ya puedes seguir con «${sig.titulo}».`);
        setRecien(i + 1);
        window.setTimeout(() => setRecien((r) => (r === i + 1 ? null : r)), 1800);
        if (!estaEscribiendo()) irA(i + 1);
      }
    });
    previo.current = pasos.map((p) => p.completa);
    // Si el paso abierto se volvió a bloquear (se quitó la foto), vuelve al primero pendiente.
    if (pasos[abierto]?.bloqueado) {
      const i = pasos.findIndex((p) => !p.completa);
      setAbierto(i === -1 ? 0 : i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // `inert` saca del orden de tabulación y de los clics todo el contenido bloqueado. React 18 no lo
  // conoce como propiedad: se pone a mano.
  useEffect(() => {
    celdas.current.forEach((celda, i) => {
      const cuerpo = celda?.querySelector<HTMLElement>("[data-cuerpo]");
      if (!cuerpo) return;
      if (pasos[i]?.bloqueado) cuerpo.setAttribute("inert", "");
      else cuerpo.removeAttribute("inert");
    });
  }, [clave, pasos]);

  return (
    <div ref={contenedor}>
      <p className="sr-only" role="status" aria-live="polite">
        {anuncio}
      </p>
      <ol aria-label={etiqueta} className="grid gap-2.5 lg:grid-cols-3 lg:items-start lg:gap-4">
        {pasos.map((p, i) => {
          const idTitulo = `${base}-t-${i}`;
          const idMotivo = `${base}-m-${i}`;
          const abiertoMovil = abierto === i && !p.bloqueado;
          const siguiente = pasos[i + 1];
          return (
            <li key={p.id} className="flex min-w-0">
              <section
                ref={(el) => {
                  celdas.current[i] = el;
                }}
                aria-labelledby={idTitulo}
                aria-disabled={p.bloqueado || undefined}
                aria-describedby={p.bloqueado ? idMotivo : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col rounded-2xl border transition-[background-color,border-color,box-shadow] duration-normal",
                  p.bloqueado ? "border-dashed border-line bg-paperSoft/60" : "border-line bg-paper",
                  p.completa && !p.bloqueado && "border-moss/40",
                  recien === i && "border-granate shadow-[0_0_0_3px_rgb(var(--granate)/0.25)]",
                )}
              >
                {/* Encabezado: en el teléfono es el botón que abre o pliega el paso. */}
                <h2 id={idTitulo} className="m-0 font-display text-bloque">
                  <button
                    type="button"
                    onClick={() => !p.bloqueado && setAbierto(i)}
                    disabled={p.bloqueado}
                    tabIndex={escritorio ? -1 : undefined}
                    aria-expanded={escritorio ? undefined : abiertoMovil}
                    className={cn(
                      "flex min-h-[52px] w-full items-center gap-2.5 px-4 py-3 text-left font-display font-bold text-ink lg:pointer-events-none lg:min-h-0 lg:pb-2",
                      p.bloqueado && "text-mute",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-rotulo leading-4 font-bold tabular-nums transition-colors duration-rapido",
                        p.completa ? "bg-moss text-paper" : p.bloqueado ? "bg-paperDeep text-mute" : "bg-granate text-paper",
                      )}
                      aria-hidden
                    >
                      {p.completa ? <Check size={13} /> : p.bloqueado ? <Lock size={12} /> : i + 1}
                    </span>
                    <span className="sr-only">Paso {i + 1}: </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-mute" aria-hidden>
                        {p.icono}
                      </span>
                      {p.titulo}
                    </span>
                    {p.completa && !abiertoMovil && (
                      <span className="min-w-0 flex-1 truncate text-right text-rotulo leading-4 font-normal text-mute lg:hidden">{p.resumen}</span>
                    )}
                    {!p.bloqueado && (
                      <ChevronDown
                        size={16}
                        className={cn("ml-auto shrink-0 text-mute transition-transform duration-normal lg:hidden", abiertoMovil && "rotate-180")}
                        aria-hidden
                      />
                    )}
                  </button>
                </h2>

                <div
                  data-cuerpo
                  className={cn(
                    "min-w-0 flex-1 flex-col gap-3 px-4 pb-4",
                    abiertoMovil ? "flex" : "hidden lg:flex",
                    p.bloqueado && "opacity-55 lg:select-none",
                  )}
                >
                  {p.bloqueado && (
                    <p id={idMotivo} className="flex items-center gap-1.5 rounded-lg bg-paperDeep px-3 py-2 text-rotulo leading-4 font-medium text-inkSoft">
                      <Lock size={12} className="shrink-0" aria-hidden /> {p.motivo}
                    </p>
                  )}
                  {p.children}
                  {siguiente && p.completa && !siguiente.bloqueado && (
                    <button
                      type="button"
                      onClick={() => irA(i + 1)}
                      className="mt-auto inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-4 text-meta font-semibold text-granate transition-colors duration-rapido hover:bg-granate-soft"
                    >
                      Seguir con {siguiente.titulo.toLowerCase()} <ArrowRight size={14} aria-hidden />
                    </button>
                  )}
                </div>
              </section>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
