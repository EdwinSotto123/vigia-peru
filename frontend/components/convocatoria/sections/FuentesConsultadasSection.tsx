"use client";

import { AlertTriangle, CircleDashed, CircleSlash, ExternalLink, FileSearch, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import { FUENTE_GROUPS } from "../constants";

/**
 * Estado de cada fuente consultada, con ícono y palabra (antes, un emoji de color: 🔴🟢⚠️⚪,
 * con verde para "con hallazgo"). "Con alerta" es lo único que pide atención; el resto es
 * neutro: que una fuente responda o no coincida no es bueno ni malo.
 */
const ESTADO: Record<string, { texto: string; Icono: typeof AlertTriangle; clase: string }> = {
  alerta: { texto: "con alerta", Icono: AlertTriangle, clase: "text-amberTexto" },
  ok: { texto: "con hallazgo", Icono: FileSearch, clase: "text-inkSoft" },
  error: { texto: "no respondió", Icono: CircleSlash, clase: "text-mute" },
  sin_menciones: { texto: "sin coincidencia", Icono: CircleDashed, clase: "text-mute" },
};
const SIN_ESTADO = { texto: "sin estado", Icono: CircleDashed, clase: "text-mute" };

export function FuentesConsultadasSection({ hallazgos }: { hallazgos: any[] }) {
  const conHallazgos = hallazgos.filter(h => h.estado === "alerta" || h.estado === "ok").length;
  const sinMenciones = hallazgos.filter(h => h.estado === "sin_menciones").length;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">
          <ScanSearch size={16} className="mr-1.5 inline text-mute" aria-hidden />
          Cruce contra fuentes oficiales
        </h2>
        <p className="mt-0.5 text-[12px] text-mute">
          {hallazgos.length} fuente{hallazgos.length === 1 ? "" : "s"} cruzada{hallazgos.length === 1 ? "" : "s"}, {conHallazgos} con hallazgos, {sinMenciones} sin coincidencia
        </p>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2">
        {FUENTE_GROUPS.map(g => {
          const sources = hallazgos.filter((h: any) => g.keys.includes(h.categoria));
          if (sources.length === 0) return null;
          return (
            <div key={g.label}>
              <div className="mb-1 text-[11px] font-semibold text-inkSoft">{g.label}</div>
              <ul className="space-y-0.5">
                {sources.map((h: any, i: number) => {
                  const e = ESTADO[h.estado] ?? SIN_ESTADO;
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-lg bg-paperSoft px-2.5 py-1.5 text-[12px]">
                      <e.Icono size={13} className={cn("mt-0.5 shrink-0", e.clase)} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium text-ink">{h.fuente}</span>
                          <span className={cn("text-[11px]", e.clase)}>{e.texto}</span>
                        </div>
                        <div className="text-[11px] leading-snug text-mute">{redactDnis(h.mensaje)}</div>
                      </div>
                      {h.url && (
                        <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center text-granate hover:underline"
                           aria-label={`Abrir la fuente: ${h.fuente}`}>
                          <ExternalLink size={12} aria-hidden />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
