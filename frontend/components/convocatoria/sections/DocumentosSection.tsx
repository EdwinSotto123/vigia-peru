"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Download, ExternalLink, FileText, Scale } from "lucide-react";
import { tipoDocLabel } from "@/lib/contratos";
import { plural } from "@/lib/formato";
import { fechaDossier } from "../dossier";

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
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">Expediente del proceso</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mute">
          <span className="inline-flex items-center gap-1">
            <FileText size={12} aria-hidden /> {plural(documentos.length, "documento publicado", "documentos publicados")} en el SEACE
          </span>
          {ocid && (
            <Link
              href={`/app/contratos/${encodeURIComponent(ocid)}`}
              className="inline-flex items-center gap-1 font-medium text-granate hover:underline"
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
                <Scale size={11} className="mr-1 inline text-mute" aria-hidden />
                {f}
              </span>
            ))}
            {normas.length > 3 && (
              <button
                type="button"
                onClick={() => setNormasOpen((p) => !p)}
                aria-expanded={normasOpen}
                className="min-h-[24px] rounded-full bg-granate-soft px-2.5 py-0.5 text-[11px] font-semibold text-granate hover:bg-granate/15"
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
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-inkSoft" aria-hidden>
                  <FileText size={14} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{d.titulo || "Documento sin título"}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-mute">
                    {d.tipo_ocds && <span>{tipoDocLabel(d.tipo_ocds)}</span>}
                    {formato && <span>{ETIQUETA_FORMATO[formato] ?? formato.toUpperCase()}</span>}
                    {d.fecha && <span>{fechaDossier(d.fecha, true)}</span>}
                    {parsed?.n_pdfs_internos && parsed.n_pdfs_internos > 1 && (
                      <span className="rounded-full bg-paperDeep px-2 py-0 text-[11px] font-semibold text-inkSoft">
                        {parsed.n_pdfs_internos} PDF adentro
                      </span>
                    )}
                  </div>
                  {parsed?.resumen && !parsed?.error && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-inkSoft">
                      <span className="font-medium text-ink">Lo que se leyó: </span>
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
                    className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-semibold text-granate hover:bg-paperDeep"
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
