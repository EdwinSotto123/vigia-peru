"use client";

import { ExternalLink, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import { FUENTE_GROUPS } from "../constants";

const ESTADO_LEGIBLE: Record<string, string> = {
  alerta: "con alerta",
  ok: "con hallazgo",
  error: "no respondió",
  sin_menciones: "sin coincidencia",
};

export function FuentesConsultadasSection({ hallazgos }: { hallazgos: any[] }) {
  const conHallazgos = hallazgos.filter(h => h.estado === "alerta" || h.estado === "ok").length;
  const sinMenciones = hallazgos.filter(h => h.estado === "sin_menciones").length;
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-serif text-xl font-bold text-ink">
          <ScanSearch size={16} className="mr-1.5 inline text-heroViolet" aria-hidden />
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
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-mute">{g.label}</div>
              <ul className="space-y-0.5">
                {sources.map((h: any, i: number) => {
                  const ICON = h.estado === "alerta" ? "🔴" : h.estado === "ok" ? "🟢" : h.estado === "error" ? "⚠️" : "⚪";
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-md bg-paperSoft px-2 py-1 text-[11px]">
                      <span className="shrink-0" role="img" aria-label={ESTADO_LEGIBLE[h.estado] ?? "sin estado"}>{ICON}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{h.fuente}</div>
                        <div className="text-[10px] leading-snug text-mute">{redactDnis(h.mensaje)}</div>
                      </div>
                      {h.url && (
                        <a href={h.url} target="_blank" rel="noreferrer" className="shrink-0 text-heroViolet hover:underline"
                           aria-label={`Abrir la fuente: ${h.fuente}`}>
                          <ExternalLink size={10} aria-hidden />
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
