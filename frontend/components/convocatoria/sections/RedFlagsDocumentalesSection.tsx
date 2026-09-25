"use client";

import { FileText, Scale } from "lucide-react";
import { plural } from "@/lib/formato";
import { Severidad } from "@/components/ui/Severidad";
import { severidadDe } from "../dossier";
import { Evidencia } from "./Evidencia";

export function RedFlagsDocumentalesSection({ flags }: { flags: any[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">Señales en los documentos del expediente</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
          <FileText size={12} aria-hidden /> {plural(flags.length, "hallazgo", "hallazgos")} al leer las bases y las actas
        </p>
      </div>
      <ul className="divide-y divide-line">
        {flags.map((f, i) => (
          <li key={i} className="px-5 py-3">
            <Severidad bandera={severidadDe(f)} />
            <Evidencia value={f.descripcion} className="mt-1.5 text-sm leading-relaxed text-ink" />
            {f.norma_citada && (
              <p className="mt-1 inline-flex items-start gap-1.5 text-[12px] text-inkSoft">
                <Scale size={12} className="mt-0.5 shrink-0 text-mute" aria-hidden />
                <span><strong className="font-semibold text-ink">Norma:</strong> {String(f.norma_citada)}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
