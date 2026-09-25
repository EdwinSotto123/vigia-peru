"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Estado, type Conteo, ESTADO_UI, ORDEN_BARRA } from "./tipos";
// ── El flujo ──────────────────────────────────────────────────────────────

/** Mientras llega la lista: un bloque con brillo (span: vive dentro de un <button>). */
const Cargando = ({ className }: { className: string }) => (
  <span aria-hidden className={cn("inline-block animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%]", className)} />
);

/**
 * Cola → procesando → procesados, y aparte lo detenido. Cada caja filtra la
 * tabla al tocarla (y se vuelve a tocar para quitar el filtro). Arriba, una
 * barra con la proporción de todo, en los mismos colores.
 */
export function Flujo({ counts, total, activo, onElegir, cargando }: { counts: Conteo; total: number; activo: Estado | "todos"; onElegir: (e: Estado) => void; cargando: boolean }) {
  const caja = (e: Estado, ayuda: string) => {
    const n = counts[e];
    const sel = activo === e;
    return (
      <button
        key={e}
        onClick={() => onElegir(e)}
        aria-pressed={sel}
        className={cn(
          "group flex min-w-0 flex-1 flex-col rounded-2xl border bg-paper p-3 text-left sm:p-4 transition-[border-color,box-shadow] duration-rapido hover:border-ink/25",
          sel ? "border-ink shadow-[0_0_0_3px_rgba(30,25,27,0.08)]" : "border-line",
        )}
      >
        <span className="flex items-center gap-2 text-[12px] font-medium text-inkSoft">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", ESTADO_UI[e].punto)} aria-hidden />
          {ESTADO_UI[e].label}
        </span>
        {cargando ? <Cargando className="mt-2 h-7 w-12" /> : <span className="mt-1 font-mono text-2xl font-semibold text-ink sm:text-3xl">{n.toLocaleString("es-PE")}</span>}
        <span className="mt-0.5 hidden text-[11.5px] leading-snug text-mute sm:block">{ayuda}</span>
      </button>
    );
  };
  const DETENIDOS: [Estado, string][] = [
    ["esperando_documentos", "falta bajar sus documentos"],
    ["error", "fallaron 3 veces"],
    ["pendiente_de_procesamiento", "no hay revisiones para su tipo"],
  ];
  const flecha = <ChevronRight size={18} className="hidden shrink-0 self-center text-inkSoft/60 md:block" aria-hidden />;

  return (
    <section aria-label="Flujo de procesamiento">
      {total > 0 && (
        <div className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-paperDeep" aria-hidden>
          {ORDEN_BARRA.map((e) => (counts[e] > 0 ? <span key={e} className={ESTADO_UI[e].barra} style={{ width: `${(counts[e] / total) * 100}%` }} /> : null))}
        </div>
      )}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 md:flex md:flex-row md:gap-3">
          {caja("encolado", "se toman cada 5 min")}
          {flecha}
          {caja("procesando", "leyéndose ahora")}
          {flecha}
          {caja("procesado", "informe listo")}
        </div>
        {/* Lo detenido va en una franja aparte, debajo del flujo: no es una etapa más.
            Va sobre el fondo gris de la página: textos en inkSoft (mute no llega a 4.5:1 ahí). */}
        <div className="flex flex-col gap-1 rounded-2xl border border-dashed border-line bg-paper/40 p-2 md:flex-row md:items-center">
          <p className="px-2 text-[12px] font-medium text-inkSoft md:w-24 md:shrink-0">Detenidos</p>
          <ul className="grid flex-1 gap-1 md:grid-cols-3">
            {DETENIDOS.map(([e, ayuda]) => {
              const n = counts[e];
              const sel = activo === e;
              return (
                <li key={e}>
                  <button
                    onClick={() => onElegir(e)}
                    aria-pressed={sel}
                    title={ayuda}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-rapido hover:bg-paper",
                      sel && "bg-paper shadow-[0_0_0_2px_rgba(30,25,27,0.12)]",
                    )}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", ESTADO_UI[e].punto)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{ESTADO_UI[e].label}</span>
                      <span className="block text-[11.5px] text-inkSoft">{ayuda}</span>
                    </span>
                    {cargando ? <Cargando className="h-6 w-8" /> : <span className={cn("font-mono text-xl", n ? "font-semibold text-ink" : "text-inkSoft")}>{n.toLocaleString("es-PE")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
