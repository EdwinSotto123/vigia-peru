"use client";

import { Building2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import { Evidencia } from "./Evidencia";

export function OtrosContratosSection({ otros, relacion, fmtMoney }: { otros: any[]; relacion: any; fmtMoney: (n: any) => string }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-serif text-xl font-bold text-ink">
          <Building2 size={16} className="mr-1.5 inline text-heroViolet" aria-hidden />
          Otros contratos detectados ({otros.length})
        </h2>
        <p className="mt-0.5 text-[12px] text-mute">Historial del proveedor con el Estado, según fuentes públicas</p>
        {relacion && (typeof relacion.contratos_previos === "number" || relacion.detalle) && (
          <p className="mt-1 text-xs leading-relaxed text-mute">
            {typeof relacion.contratos_previos === "number" && (
              <>
                Relación previa con esta entidad:{" "}
                <strong className={cn(relacion.contratos_previos > 0 ? "text-crimsonTexto" : "text-ink")}>
                  {relacion.contratos_previos} contrato{relacion.contratos_previos === 1 ? "" : "s"} previo{relacion.contratos_previos === 1 ? "" : "s"}
                </strong>
                .{" "}
              </>
            )}
            {redactDnis(relacion.detalle)}
          </p>
        )}
      </div>
      <ul className="divide-y divide-line">
        {otros.map((c, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{c.entidad}</div>
                <div className="mt-0.5 text-xs text-inkSoft">{c.objeto}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[10px] text-mute">
                  {c.fecha && <span className="font-mono">{c.fecha}</span>}
                  {c.ocid_o_contrato && <span>{c.ocid_o_contrato}</span>}
                </div>
                {c.evidencia && <Evidencia value={c.evidencia} className="mt-1 text-[10px] text-mute" />}
              </div>
              <div className="text-right">
                {c.monto && (
                  <div className="font-mono text-sm font-bold text-heroViolet">{fmtMoney(c.monto)}</div>
                )}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                    <ExternalLink size={9} aria-hidden /> Fuente
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
