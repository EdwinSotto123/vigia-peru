"use client";

import { Building2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";

export function OtrosContratosSection({ otros, relacion, fmtMoney }: { otros: any[]; relacion: any; fmtMoney: (n: any) => string }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Building2 size={11} className="mr-1 inline" />
          Historial de contratos con el Estado
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Otros contratos detectados · {otros.length}
        </h2>
        {relacion && (
          <p className="mt-1 text-xs leading-relaxed text-mute">
            Relación previa con esta entidad: <strong className={cn(relacion.contratos_previos > 0 ? "text-rust" : "text-ink")}>
              {relacion.contratos_previos} contratos previos</strong>. {redactDnis(relacion.detalle)}
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
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
                  {c.fecha && <span className="font-mono">{c.fecha}</span>}
                  {c.ocid_o_contrato && <span>· contrato {c.ocid_o_contrato}</span>}
                </div>
              </div>
              <div className="text-right">
                {c.monto && (
                  <div className="font-mono text-sm font-bold text-clay">{fmtMoney(c.monto)}</div>
                )}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-clay hover:underline">
                    <ExternalLink size={9} /> link
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
