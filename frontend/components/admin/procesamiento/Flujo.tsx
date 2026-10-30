"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ayuda } from "@/components/patrones/Ayuda";
import { type Estado, type Conteo, DETENIDOS, ESTADO_UI, FLUJO, ORDEN_BARRA, PISTA_ESTADO } from "./tipos";
// ── El flujo ──────────────────────────────────────────────────────────────

/** Mientras llega el conteo: un bloque con brillo (span: vive dentro de un <button>). */
const Cargando = ({ className }: { className: string }) => (
  <span aria-hidden className={cn("inline-block animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%]", className)} />
);

/**
 * Cola → procesando → procesados y, aparte, lo detenido, en UNA franja: antes eran tres cajas grandes y debajo otra
 * caja punteada con tres cajas más (cajas dentro de cajas, 300 px de alto en el celular). Cada cifra es un atajo:
 * filtra la lista de contratos por ese estado (otra vez, quita el filtro). Abajo, una barra con la proporción de
 * todo, en los mismos colores. Qué quiere decir cada estado va en el ⓘ, no en una línea bajo cada número.
 *
 * En escritorio todo va en una línea (si no entra, el flujo arriba y lo detenido abajo); en el celular, dos grupos
 * de tres columnas.
 */
export function Flujo({ counts, total, activo, onElegir, cargando }: { counts: Conteo; total: number; activo: Estado | "todos"; onElegir: (e: Estado) => void; cargando: boolean }) {
  const cifra = (e: Estado, detenido = false) => {
    const n = counts[e];
    const sel = activo === e;
    return (
      <button
        type="button"
        onClick={() => onElegir(e)}
        aria-pressed={sel}
        title={`${ESTADO_UI[e].label}: ${PISTA_ESTADO[e]}`}
        className={cn(
          "flex w-full min-w-0 flex-col items-start gap-1 rounded-xl px-2 py-1.5 text-left transition-colors duration-rapido sm:w-auto sm:flex-row sm:items-baseline sm:gap-2",
          // El estado elegido filtra la lista: lima, el color de la selección.
          sel ? "bg-granate-50 ring-1 ring-inset ring-granate/40" : "hover:bg-paperDeep/60",
        )}
      >
        <span className="flex items-center gap-1.5 text-rotulo font-medium leading-tight text-inkSoft">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", ESTADO_UI[e].punto)} aria-hidden />
          {ESTADO_UI[e].label}
        </span>
        {cargando ? (
          <Cargando className="h-5 w-8" />
        ) : (
          // Un detenido en cero no pide atención: gris.
          <span className={cn("font-display text-bloque font-bold leading-none tabular-nums", detenido && !n ? "text-mute" : "text-ink")}>{n.toLocaleString("es-PE")}</span>
        )}
      </button>
    );
  };

  return (
    <section aria-label="Flujo de procesamiento" className="rounded-2xl border border-line bg-paperSoft px-2 py-2 sm:px-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
        <ol aria-label="Etapas" className="grid grid-cols-3 gap-1 sm:flex sm:items-center">
          {FLUJO.map((e, i) => (
            <li key={e} className="flex min-w-0 items-center gap-1">
              {cifra(e)}
              {i < FLUJO.length - 1 && <ChevronRight size={16} className="hidden shrink-0 text-inkSoft/60 sm:block" aria-hidden />}
            </li>
          ))}
        </ol>
        <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
        {/* Lo detenido no es una etapa más: va aparte, con su rótulo. En el celular, separado por un filete. */}
        <div className="flex flex-col gap-1 border-t border-line pt-1.5 sm:flex-row sm:items-center sm:border-0 sm:pt-0">
          <span className="flex items-center gap-0.5 pl-2 text-rotulo font-medium text-inkSoft">
            Detenidos
            <Ayuda titulo="¿Qué quiere decir cada estado?" ancho="w-80 sm:w-96">
              {[...FLUJO, ...DETENIDOS].map((e) => (
                <span key={e} className="block">
                  <strong className="font-semibold text-ink">{ESTADO_UI[e].label}:</strong> {PISTA_ESTADO[e]}.
                </span>
              ))}
              <span className="mt-1.5 block text-inkSoft">Toca una cifra para ver esos contratos en la lista; otra vez, para verlos todos.</span>
            </Ayuda>
          </span>
          <ul className="grid grid-cols-3 gap-1 sm:flex sm:items-center">
            {DETENIDOS.map((e) => (
              <li key={e} className="min-w-0">
                {cifra(e, true)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {total > 0 && (
        <div className="mx-2 mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
          {ORDEN_BARRA.map((e) => (counts[e] > 0 ? <span key={e} className={ESTADO_UI[e].barra} style={{ width: `${(counts[e] / total) * 100}%` }} /> : null))}
        </div>
      )}
    </section>
  );
}
