"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { oeceProcesoUrl } from "../utils";

export function AnalisisPostoresSection({ data }: { data: any }) {
  const postores: any[] = Array.isArray(data?.postores) ? data.postores : [];
  const patrones = (data?.patrones_red && typeof data.patrones_red === "object") ? data.patrones_red : {};

  const sospechaLabel: Record<string, string> = {
    direccion_compartida_con_otro_postor: "Misma dirección que otro postor",
  };

  if (postores.length === 0) {
    return <p className="px-4 py-3 text-[12px] text-mute">No se identificaron postores en el OCDS.</p>;
  }

  return (
    <div className="p-4">
      {/* Stats agregados */}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-paperDeep px-3 py-2">
          <div className="font-mono text-lg font-bold text-ink">{patrones.n_postores_total || postores.length}</div>
          <div className="text-[10px] text-mute">postores totales</div>
        </div>
        <div className={cn(
          "rounded-md px-3 py-2",
          (patrones.n_con_co_ocurrencia || 0) > 0 ? "bg-amber-soft" : "bg-paperDeep",
        )}>
          <div className={cn("font-mono text-lg font-bold", (patrones.n_con_co_ocurrencia || 0) > 0 ? "text-amber" : "text-ink")}>
            {patrones.n_con_co_ocurrencia || 0}
          </div>
          <div className="text-[10px] text-mute">con co-ocurrencia (base Vigía)</div>
        </div>
        <div className={cn(
          "rounded-md px-3 py-2",
          (patrones.n_con_direccion_compartida || 0) > 0 ? "bg-rust/10" : "bg-paperDeep",
        )}>
          <div className={cn("font-mono text-lg font-bold", (patrones.n_con_direccion_compartida || 0) > 0 ? "text-rust" : "text-ink")}>
            {patrones.n_con_direccion_compartida || 0}
          </div>
          <div className="text-[10px] text-mute">comparten domicilio</div>
        </div>
      </div>

      {/* Tabla de postores */}
      <ul className="divide-y divide-line">
        {postores.map((p: any, i: number) => {
          const score = p.score_sospecha || 0;
          const tone = score >= 50 ? "rust" : score >= 25 ? "amber" : "moss";
          return (
            <li key={i} className="flex items-start gap-3 py-2.5">
              <div className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-md text-paper",
                tone === "rust" && "bg-rust",
                tone === "amber" && "bg-amber",
                tone === "moss" && "bg-moss",
              )}>
                <span className="font-mono text-[11px] font-bold">{score}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] font-bold text-clay">RUC {p.ruc}</span>
                  <span className="line-clamp-1 text-sm font-semibold text-ink">{p.razon_social || "—"}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {(p.sospechas || []).map((s: string, j: number) => {
                    const label = sospechaLabel[s] || (s.startsWith("co_ocurrencia") ? `${s.split(":")[1]} co-ocurrencias` : s);
                    return (
                      <span key={j} className={cn(
                        "rounded-full px-1.5 py-0 text-[9px] font-bold",
                        s.includes("direccion") ? "bg-rust text-paper" : "bg-amber text-paper",
                      )}>
                        {label}
                      </span>
                    );
                  })}
                  {(p.sospechas || []).length === 0 && (
                    <span className="text-[10px] text-mute">— sin señales</span>
                  )}
                </div>
                {p.direccion && (
                  <div className="mt-0.5 line-clamp-1 text-[10px] text-mute">📍 {p.direccion}</div>
                )}
                <div className="mt-0.5 text-[10px] text-mute">
                  {p.n_apariciones_base_vigia || 0} aparició{(p.n_apariciones_base_vigia || 0) === 1 ? "n" : "nes"} en la base de Vigía
                  <span className="text-mute/60"> · no es su historial completo en SEACE</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Pares co-ocurrentes (señal de cartel) */}
      {Object.keys(patrones.pares_co_ocurrentes || {}).length > 0 && (
        <div className="mt-3 rounded-md border border-amber/30 bg-amber-soft/40 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber">
            <AlertTriangle size={10} className="mr-1 inline" />
            Co-ocurrencias en la base de Vigía
          </div>
          <p className="mt-1 text-[11px] text-inkSoft">
            Estos pares de postores aparecen juntos en otros procesos <strong>ya analizados por Vigía</strong>
            {" "}(no el universo completo del SEACE). Señal a investigar, no prueba de cartel.
          </p>
          <ul className="mt-1.5 space-y-1">
            {Object.entries(patrones.pares_co_ocurrentes).slice(0, 5).map(([par, ocids]: [string, any], i: number) => {
              const list: string[] = Array.isArray(ocids) ? ocids : [];
              return (
                <li key={i} className="font-mono text-[10px] text-ink">
                  <span className="text-amber">●</span> {par} · <strong>{list.length}</strong> proceso{list.length === 1 ? "" : "s"} compartido{list.length === 1 ? "" : "s"}
                  {list.length > 0 && (
                    <div className="ml-3 mt-0.5 flex flex-wrap gap-1">
                      {list.slice(0, 8).map((oc, j) => (
                        <a key={j} href={oeceProcesoUrl(oc)}
                           target="_blank" rel="noreferrer"
                           className="rounded bg-paperDeep px-1.5 py-0 text-[9px] text-clay hover:bg-paperSoft">
                          {oc.replace(/^ocds-[a-z0-9]+-seacev3-/i, "")}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
