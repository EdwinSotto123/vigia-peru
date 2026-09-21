"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, FileText, Scale } from "lucide-react";
import { cn } from "@/lib/utils";

export function DocumentosSection({
  documentos, parserDocs, fundamento, modalidad,
}: { documentos: any[]; parserDocs: any[]; fundamento: string[]; modalidad?: string }) {
  const [normasOpen, setNormasOpen] = useState(false);
  const parserByUrl = new Map(parserDocs.map((d: any) => [d.url, d]));
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
          <FileText size={11} className="mr-1 inline" />
          Documentos del expediente · {documentos.length}
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Expediente del proceso
        </h2>
        {(modalidad || fundamento.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {modalidad && (
              <span className="rounded-full bg-paperSoft px-2 py-0.5 text-[10px] font-medium text-ink">Modalidad: {modalidad}</span>
            )}
            {(normasOpen ? fundamento : fundamento.slice(0, 3)).map((f, i) => (
              <span key={i} className="rounded-full bg-paperSoft px-2 py-0.5 text-[10px] font-medium text-ink">
                <Scale size={9} className="mr-0.5 inline text-heroViolet" />{f}
              </span>
            ))}
            {fundamento.length > 3 && (
              <button
                type="button"
                onClick={() => setNormasOpen((p) => !p)}
                className="rounded-full bg-heroViolet/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-heroViolet hover:bg-heroViolet/20"
              >
                {normasOpen
                  ? `▲ ocultar ${fundamento.length - 3} normas`
                  : `▼ ver +${fundamento.length - 3} normas`}
              </button>
            )}
          </div>
        )}
      </div>
      <ul className="divide-y divide-line">
        {documentos.map((d, i) => {
          const parsed: any = parserByUrl.get(d.url);
          return (
            <li key={i} className="px-5 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-heroViolet">
                  <FileText size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{d.titulo}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-mute">
                    <span className="font-mono uppercase">{d.tipo_ocds}</span>
                    {d.formato && <span>· {d.formato.toUpperCase()}</span>}
                    {d.fecha && <span>· {d.fecha}</span>}
                    {parsed?.n_pdfs_internos && parsed.n_pdfs_internos > 1 && (
                      <span className="rounded-full bg-heroViolet/10 px-1.5 py-0 text-[9px] font-bold uppercase text-heroViolet">{parsed.n_pdfs_internos} PDFs adentro</span>
                    )}
                  </div>
                  {parsed?.resumen && !parsed?.error && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-inkSoft">
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-heroViolet">doc_parser:</span> {parsed.resumen}
                    </p>
                  )}
                  {parsed?.error && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-crimson-soft px-2 py-0.5 text-[10px] text-rust">
                      <AlertTriangle size={9} /> {parsed.error}
                    </div>
                  )}
                </div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-[11px] font-medium text-heroViolet hover:bg-paperDeep">
                    <ExternalLink size={11} /> Descargar
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
