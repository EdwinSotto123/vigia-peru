"use client";

/**
 * Los tres carriles del DAG (Expediente · Proveedor · Síntesis) con cada agente como chip:
 * pendiente (gris) · corriendo (punto pulsante + cronómetro) · hecho (check + duración)
 * · omitido (tachado, con motivo en el title) · error (rojo). Los grupos "∥" del mismo
 * paso corren en paralelo.
 *
 * `compacto` = una fila por carril, chips pequeños (para el aside de /app/contratos/[ocid]).
 */

import { AlertCircle, Check, MinusCircle } from "lucide-react";
import { CARRILES, duracion, estadoDeFase, faseLabel, faseLabelCorto, type EstadoFase, type EstadoProc, type FasesMap } from "@/lib/auditoria";

interface Props {
  fases: FasesMap;
  estado: EstadoProc;
  ahora: number;
  compacto?: boolean;
}

const CHIP: Record<EstadoFase, string> = {
  pendiente: "border-line bg-paper text-mute",
  corriendo: "border-amber bg-amber-soft text-ink shadow-[0_0_0_3px_rgba(190,123,38,0.12)]",
  hecho: "border-moss/40 bg-moss/5 text-ink",
  omitido: "border-dashed border-line bg-paper text-mute/70 line-through decoration-mute/50",
  error: "border-rust/50 bg-crimson-soft text-rust",
};

function ms(desde: string | null | undefined, hasta: string | null | undefined, ahora: number): number | null {
  if (!desde) return null;
  const a = new Date(desde).getTime();
  const b = hasta ? new Date(hasta).getTime() : ahora;
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, b - a);
}

export function DagCarriles({ fases, estado, ahora, compacto = false }: Props) {
  return (
    <div className={compacto ? "space-y-2" : "space-y-3"} aria-label="Agentes del análisis por carril">
      {CARRILES.map((c) => {
        const claves = c.pasos.flat();
        const hechas = claves.filter((k) => ["hecho", "omitido"].includes(estadoDeFase(fases, k, estado))).length;
        const corriendo = claves.some((k) => estadoDeFase(fases, k, estado) === "corriendo");
        const contenido = (
          <ol className="flex min-w-0 flex-wrap items-center gap-y-1.5">
            {c.pasos.map((grupo, gi) => (
              <li key={gi} className="flex items-center">
                {gi > 0 && <span aria-hidden className={`mx-1 h-px ${compacto ? "w-2" : "w-3"} bg-line`} />}
                <span className={`flex flex-wrap items-center ${compacto ? "gap-1" : "gap-1.5"}`}>
                  {grupo.map((key, ki) => {
                    const st = estadoDeFase(fases, key, estado);
                    const f = fases[key];
                    // sin reloj (ahora = 0, render del servidor) no hay cronómetro para lo que corre
                    const t = st === "hecho" || (st === "corriendo" && ahora > 0) ? ms(f?.desde, f?.hasta, ahora) : null;
                    const title =
                      st === "omitido" ? `${faseLabel(key)}: omitido · ${f?.motivo ?? "no aplica"}`
                        : st === "error" ? `${faseLabel(key)}: error · ${f?.motivo ?? ""}`
                          : st === "corriendo" ? `${faseLabel(key)}: en curso${f?.msg ? ` · ${f.msg}` : ""}`
                            : st === "hecho" ? `${faseLabel(key)}: completada${f?.motivo ? ` · ${f.motivo}` : ""}`
                              : `${faseLabel(key)}: pendiente`;
                    return (
                      <span key={key} className="flex items-center">
                        {ki > 0 && <span aria-hidden className="mx-1 text-[10px] text-mute/70">∥</span>}
                        <span
                          title={title}
                          className={`inline-flex items-center gap-1 rounded-full border font-medium transition-all duration-500 ${compacto ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11.5px]"} ${CHIP[st]}`}
                        >
                          {st === "corriendo" && (
                            <span className="relative flex h-1.5 w-1.5" aria-hidden>
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
                            </span>
                          )}
                          {st === "hecho" && <Check size={compacto ? 10 : 11} strokeWidth={3} className="text-moss" aria-hidden />}
                          {st === "omitido" && <MinusCircle size={compacto ? 10 : 11} aria-hidden />}
                          {st === "error" && <AlertCircle size={compacto ? 10 : 11} aria-hidden />}
                          {st === "pendiente" && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full border border-line" />}
                          {faseLabelCorto(key)}
                          <span className="sr-only">{` (${st})`}</span>
                          {t != null && (st === "corriendo" || (!compacto && st === "hecho")) && (
                            <span className={`font-mono tabular-nums ${compacto ? "text-[9px]" : "text-[10px]"} ${st === "corriendo" ? "text-amber" : "text-mute"}`} suppressHydrationWarning>
                              {t < 1000 && st === "hecho" ? "<1 s" : duracion(t)}
                            </span>
                          )}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </li>
            ))}
          </ol>
        );
        if (compacto) {
          return (
            <div key={c.key} className="flex flex-col gap-1">
              <div className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-mute">{c.label}</div>
              {contenido}
            </div>
          );
        }
        return (
          <div key={c.key}>
            {/* móvil: acordeón por carril (abierto el que corre o el que falta); escritorio: fila */}
            <details className="sm:hidden" open={corriendo || hechas < claves.length}>
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-mute">
                <span>{c.label}</span>
                <span className="font-mono normal-case tracking-normal">{hechas}/{claves.length}{corriendo ? " · en curso" : ""}</span>
              </summary>
              <div className="mt-1.5">{contenido}</div>
            </details>
            <div className="hidden sm:flex sm:items-center sm:gap-3">
              <div className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-mute sm:w-20">{c.label}</div>
              {contenido}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Mini-progreso por carril (tres barritas) para las tarjetas del kanban. */
export function MiniCarriles({ carriles }: { carriles: { key: string; label: string; pct: number; activo: boolean }[] }) {
  return (
    <div className="flex items-center gap-1" aria-label="Avance por carril" role="img">
      {carriles.map((c) => (
        <span key={c.key} title={`${c.label}: ${c.pct}%`} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${c.pct >= 100 ? "bg-moss" : "bg-amber"}`}
            style={{ width: `${Math.max(c.pct > 0 ? 8 : 0, c.pct)}%` }}
          />
          {c.activo && c.pct < 100 && <span aria-hidden className="absolute inset-y-0 right-0 w-1/3 animate-pulse rounded-full bg-amber/40" />}
        </span>
      ))}
    </div>
  );
}
