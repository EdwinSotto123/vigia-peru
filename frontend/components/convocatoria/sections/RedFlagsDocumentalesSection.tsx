"use client";

import { AlertTriangle, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { severidadColor } from "@/lib/formato";
import { Evidencia } from "./Evidencia";

const sevDe = (s: unknown): "alta" | "media" | "baja" => (s === "alta" || s === "media" ? s : "baja");

export function RedFlagsDocumentalesSection({ flags }: { flags: any[] }) {
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-serif text-xl font-bold text-ink">Señales en los documentos del expediente</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
          <AlertTriangle size={11} aria-hidden /> {flags.length} {flags.length === 1 ? "hallazgo" : "hallazgos"} al leer las
          bases y actas
        </p>
      </div>
      <ul className="divide-y divide-line">
        {flags.map((f, i) => (
          <li key={i} className="px-5 py-3">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", severidadColor(sevDe(f.severidad)))}>
              Severidad {sevDe(f.severidad)}
            </span>
            <Evidencia value={f.descripcion} className="mt-1.5 text-sm leading-relaxed text-ink" />
            {f.norma_citada && (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-paperDeep px-2 py-0.5 text-[11px] text-mute">
                <Scale size={11} className="text-heroViolet" aria-hidden />
                <strong className="text-ink">Norma:</strong> {String(f.norma_citada)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
