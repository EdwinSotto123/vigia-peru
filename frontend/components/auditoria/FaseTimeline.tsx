import { AlertTriangle, Check, Circle, Loader2, XCircle } from "lucide-react";
import { FASES, TOTAL_FASES, type EstadoProc, type EventoFase } from "@/lib/auditoria";

interface Props {
  faseIndex: number | null;
  estado: EstadoProc;
  eventos?: EventoFase[];
}

type EstadoFase = "hecha" | "actual" | "pendiente";

function estadoDe(i: number, faseIndex: number | null, estado: EstadoProc): EstadoFase {
  if (estado === "procesado") return "hecha";
  if (estado === "encolado") return "pendiente";
  const idx = faseIndex ?? 0;
  if (idx >= TOTAL_FASES) return "hecha";
  if (i < idx) return "hecha";
  if (i === idx) return "actual";
  return "pendiente";
}

function hora(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Línea de tiempo vertical de las 10 fases del pipeline. Hechas = check verde,
 * actual = spinner ámbar con el último mensaje de esa fase, pendientes = gris.
 * Debajo, las advertencias y errores que emitió el pipeline (kind warn/error).
 */
export function FaseTimeline({ faseIndex, estado, eventos = [] }: Props) {
  const ultimoMsgPorFase = new Map<string, EventoFase>();
  for (const ev of eventos) if (ev.kind === "phase") ultimoMsgPorFase.set(ev.name, ev);
  const notas = eventos.filter((e) => e.kind === "warn" || e.kind === "error");
  const hechas = FASES.filter((_, i) => estadoDe(i, faseIndex, estado) === "hecha").length;

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-mute">
        <span>Fases del análisis</span>
        <span className="font-mono normal-case tracking-normal" aria-live="polite">
          {hechas} / {TOTAL_FASES}
        </span>
      </div>
      <ol className="mt-3 space-y-0" aria-label="Fases del análisis">
        {FASES.map((f, i) => {
          const st = estadoDe(i, faseIndex, estado);
          const ev = ultimoMsgPorFase.get(f.key);
          const esUltima = i === FASES.length - 1;
          return (
            <li key={f.key} className="relative flex gap-3 pb-4 last:pb-0">
              {!esUltima && (
                <span
                  aria-hidden
                  className={`absolute left-[11px] top-6 h-[calc(100%-12px)] w-px transition-colors duration-500 ${st === "hecha" ? "bg-moss/50" : "bg-line"}`}
                />
              )}
              <span
                aria-hidden
                className={`relative z-[1] mt-0.5 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-all duration-500 ${
                  st === "hecha"
                    ? "border-moss bg-moss text-paper"
                    : st === "actual"
                      ? "border-amber bg-amber-soft text-amber"
                      : "border-line bg-paper text-line"
                }`}
              >
                {st === "hecha" ? <Check size={12} strokeWidth={3} /> : st === "actual" ? <Loader2 size={12} className="animate-spin" /> : <Circle size={6} fill="currentColor" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`text-sm transition-colors ${st === "pendiente" ? "text-mute" : "text-ink"} ${st === "actual" ? "font-semibold" : ""}`}>
                    {f.label}
                    <span className="sr-only">{st === "hecha" ? " (completada)" : st === "actual" ? " (en curso)" : " (pendiente)"}</span>
                  </span>
                  <span className="font-mono text-[10px] text-mute">
                    {st === "actual" ? "en curso" : ev ? hora(ev.ts) : ""}
                  </span>
                </div>
                {st === "actual" && (
                  <p className="mt-0.5 text-[12px] leading-snug text-mute" aria-live="polite">
                    {ev?.msg ?? `Ejecutando ${f.agente.replace(/_/g, " ")}…`}
                  </p>
                )}
                {st === "hecha" && ev?.msg && <p className="mt-0.5 line-clamp-1 text-[12px] text-mute/80">{ev.msg}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {notas.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3" aria-label="Notas del pipeline">
          {notas.map((n, i) => (
            <li key={`${n.ts}-${i}`} className={`flex items-start gap-2 text-[12px] ${n.kind === "error" ? "text-crimson" : "text-amber"}`}>
              {n.kind === "error" ? <XCircle size={13} className="mt-0.5 shrink-0" aria-label="Error" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-label="Advertencia" />}
              <span className="min-w-0">
                <span className="font-mono text-[10px] text-mute">{hora(n.ts)}</span>{" "}
                <span className="text-inkSoft">{n.name}{n.msg ? ` — ${n.msg}` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
