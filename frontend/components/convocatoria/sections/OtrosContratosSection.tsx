"use client";

import { Building2, ExternalLink } from "lucide-react";
import { oracion, plural } from "@/lib/formato";
import { fechaDossier } from "../dossier";
import { redactDnis } from "../../Redact";
import { Evidencia } from "./Evidencia";

export function OtrosContratosSection({ otros, relacion, fmtMoney }: { otros: any[]; relacion: any; fmtMoney: (n: any) => string }) {
  return (
    <section className="rounded-2xl border border-line bg-paperSoft overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">
          <Building2 size={16} className="mr-1.5 inline text-mute" aria-hidden />
          Otros contratos del proveedor ({otros.length})
        </h2>
        <p className="mt-0.5 text-rotulo text-mute">Historial del proveedor con el Estado, según fuentes públicas</p>
        {relacion && (typeof relacion.contratos_previos === "number" || relacion.detalle) && (
          <p className="mt-1 text-rotulo leading-relaxed text-mute">
            {typeof relacion.contratos_previos === "number" && (
              <>
                Relación previa con esta entidad:{" "}
                <strong className="font-semibold text-ink">
                  {plural(relacion.contratos_previos, "contrato previo", "contratos previos")}
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
                <div className="text-dato leading-5 font-semibold text-ink">{c.entidad}</div>
                <div className="mt-0.5 text-rotulo leading-4 text-inkSoft">{c.objeto ? oracion(c.objeto) : null}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-micro text-mute">
                  {c.fecha && <span>{fechaDossier(c.fecha, true)}</span>}
                  {c.ocid_o_contrato && <span>{c.ocid_o_contrato}</span>}
                </div>
                {c.evidencia && <Evidencia value={c.evidencia} className="mt-1 text-micro text-mute" />}
              </div>
              <div className="text-right">
                {c.monto && (
                  <div className="font-mono text-dato leading-5 font-semibold tabular-nums text-ink">{fmtMoney(c.monto)}</div>
                )}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[24px] items-center gap-1 text-rotulo text-granate hover:underline">
                    Fuente <ExternalLink size={11} aria-hidden />
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
