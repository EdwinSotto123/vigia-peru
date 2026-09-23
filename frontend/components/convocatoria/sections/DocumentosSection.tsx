"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Download, ExternalLink, FileText, Scale } from "lucide-react";
import { tipoDocLabel } from "@/lib/contratos";

/** "APPLICATION/PDF", "pdf", ".PDF" → "pdf". El formato viene en cualquier caja. */
export function formatoNormalizado(f: unknown): string {
  const s = String(f ?? "").trim().toLowerCase();
  if (!s) return "";
  const sinMime = s.includes("/") ? s.split("/").pop() || s : s;
  return sinMime.replace(/^\./, "").replace(/^x-/, "");
}

const ETIQUETA_FORMATO: Record<string, string> = {
  pdf: "PDF",
  zip: "ZIP",
  rar: "RAR",
  docx: "Word",
  doc: "Word",
  "vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  xlsx: "Excel",
};

export function DocumentosSection({
  documentos,
  parserDocs,
  fundamento,
  modalidad,
  ocid,
}: {
  documentos: any[];
  parserDocs: any[];
  fundamento: string[];
  modalidad?: string;
  /** Para enlazar a /app/contratos/[ocid], donde cada cita abre la página exacta del documento. */
  ocid?: string | null;
}) {
  const [normasOpen, setNormasOpen] = useState(false);
  const parserByUrl = new Map(parserDocs.map((d: any) => [d.url, d]));
  const normas = (fundamento || []).filter((f) => typeof f === "string" && f.trim());
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-serif text-xl font-bold text-ink">Expediente del proceso</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mute">
          <span className="inline-flex items-center gap-1">
            <FileText size={11} aria-hidden /> {documentos.length} {documentos.length === 1 ? "documento publicado" : "documentos publicados"}
          </span>
          {ocid && (
            <Link
              href={`/app/contratos/${encodeURIComponent(ocid)}`}
              className="inline-flex items-center gap-1 font-medium text-heroViolet hover:underline"
            >
              Ver el contrato con las citas por página <ArrowRight size={11} aria-hidden />
            </Link>
          )}
        </p>
        {(modalidad || normas.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {modalidad && (
              <span className="rounded-full bg-paperSoft px-2 py-0.5 text-[11px] font-medium text-ink">Modalidad: {modalidad}</span>
            )}
            {(normasOpen ? normas : normas.slice(0, 3)).map((f, i) => (
              <span key={i} className="rounded-full bg-paperSoft px-2 py-0.5 text-[11px] font-medium text-ink">
                <Scale size={9} className="mr-0.5 inline text-heroViolet" aria-hidden />
                {f}
              </span>
            ))}
            {normas.length > 3 && (
              <button
                type="button"
                onClick={() => setNormasOpen((p) => !p)}
                aria-expanded={normasOpen}
                className="rounded-full bg-heroViolet/10 px-2 py-0.5 text-[11px] font-semibold text-heroViolet hover:bg-heroViolet/20"
              >
                {normasOpen ? "Ocultar normas" : `Ver ${normas.length - 3} normas más`}
              </button>
            )}
          </div>
        )}
      </div>
      <ul className="divide-y divide-line">
        {documentos.map((d, i) => {
          const parsed: any = parserByUrl.get(d.url);
          const formato = formatoNormalizado(d.formato);
          const esPdf = formato === "pdf";
          return (
            <li key={d.id ?? i} className="px-5 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-heroViolet">
                  <FileText size={14} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{d.titulo || "Documento sin título"}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-mute">
                    {d.tipo_ocds && <span>{tipoDocLabel(d.tipo_ocds)}</span>}
                    {formato && <span>{ETIQUETA_FORMATO[formato] ?? formato.toUpperCase()}</span>}
                    {d.fecha && <span>{d.fecha}</span>}
                    {parsed?.n_pdfs_internos && parsed.n_pdfs_internos > 1 && (
                      <span className="rounded-full bg-heroViolet/10 px-1.5 py-0 text-[10px] font-semibold text-heroViolet">
                        {parsed.n_pdfs_internos} PDF adentro
                      </span>
                    )}
                  </div>
                  {parsed?.resumen && !parsed?.error && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-inkSoft">
                      <span className="font-medium text-ink">Lo que leyó el agente: </span>
                      {parsed.resumen}
                    </p>
                  )}
                  {parsed?.error && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-crimson-soft px-2 py-0.5 text-[11px] text-crimsonTexto">
                      <AlertTriangle size={10} aria-hidden /> No se pudo leer este documento
                    </div>
                  )}
                </div>
                {d.url && (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-[11px] font-medium text-heroViolet hover:bg-paperDeep"
                    title={esPdf ? "Abrir el PDF en el SEACE" : "Descargar el archivo del SEACE"}
                  >
                    {esPdf ? <ExternalLink size={11} aria-hidden /> : <Download size={11} aria-hidden />}
                    {esPdf ? "Ver" : "Descargar"}
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
