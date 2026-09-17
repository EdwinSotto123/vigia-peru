"use client";

import { AlertTriangle, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";

export function RedFlagsDocumentalesSection({ flags }: { flags: any[] }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-rust">
          <AlertTriangle size={11} className="mr-1 inline" />
          Red flags documentales · {flags.length}
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Hallazgos del document_parser_agent en los PDFs
        </h2>
      </div>
      <ul className="divide-y divide-line">
        {flags.map((f, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-baseline gap-2">
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                f.severidad === "alta"  ? "bg-rust text-paper" :
                f.severidad === "media" ? "bg-amber text-paper" :
                                          "bg-paperDeep text-mute",
              )}>● {f.severidad || "media"}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{redactDnis(f.descripcion)}</p>
            {f.norma_citada && (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-paperDeep px-2 py-0.5 text-[11px] text-mute">
                <Scale size={11} className="text-clay" />
                <strong className="text-ink">Norma:</strong> {f.norma_citada}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
