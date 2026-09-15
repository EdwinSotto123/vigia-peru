"use client";

/**
 * Lista de documentos oficiales de un contrato. Cada fila enlaza al SEACE; si el documento
 * tiene copia vigente en el almacén de Vigía (retención 90 días) aparece "Ver": pide una URL
 * firmada (15 min) a la API y, si es PDF, lo previsualiza embebido debajo de la lista; otros
 * formatos (ZIP/RAR/DOCX) se abren en una pestaña nueva con la misma URL firmada.
 */

import { useState } from "react";
import { Eye, ExternalLink, FileText, Loader2, X, Download } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { tipoDocLabel, formatFecha, type ContratoDocumento } from "@/lib/contratos";
import { cn } from "@/lib/utils";

interface Firmada { url: string; formato: string; bytes: number | null; previsualizable: boolean; venceEnSeg: number }

export function DocumentosContrato({ ocid, documentos }: { ocid: string; documentos: ContratoDocumento[] }) {
  const [abierto, setAbierto] = useState<{ doc: ContratoDocumento; f: Firmada } | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ver(d: ContratoDocumento) {
    setError(null);
    setCargando(d.url);
    try {
      const res = await fetch(`${PUBLIC_API_BASE}/contratos/${encodeURIComponent(ocid)}/documento?url=${encodeURIComponent(d.url)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail ?? j.error ?? `HTTP ${res.status}`);
      const f = j as Firmada;
      if (f.previsualizable) setAbierto({ doc: d, f });
      else window.open(f.url, "_blank", "noopener");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(null);
    }
  }

  if (!documentos.length) return <p className="mt-2 text-sm text-mute">Sin documentos publicados en el registro.</p>;

  return (
    <>
      <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-paper">
        {documentos.map((d, i) => (
          <li key={`${d.url}-${i}`} className={cn("flex items-center gap-2 px-3 py-2 text-sm", abierto?.doc.url === d.url && "bg-paperSoft")}>
            <FileText size={14} className="shrink-0 text-mute" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{d.titulo ?? tipoDocLabel(d.tipo)}</span>
              <span className="block text-[10px] text-mute">
                {tipoDocLabel(d.tipo)}{d.seccion === "award" ? " · adjudicación" : d.seccion === "contract" ? " · contrato" : ""}{d.formato ? ` · ${d.formato.toUpperCase()}` : ""}{d.fecha ? ` · ${formatFecha(d.fecha)}` : ""}
                {d.enVigia ? " · copia en Vigía" : ""}
              </span>
            </span>
            {d.enVigia && (
              <button
                type="button"
                onClick={() => ver(d)}
                disabled={cargando === d.url}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] font-medium text-ink hover:bg-paperDeep disabled:opacity-60"
                title={d.formato?.toLowerCase() === "pdf" ? "Vista previa" : "Descargar (enlace de 15 min)"}
              >
                {cargando === d.url ? <Loader2 size={12} className="animate-spin" /> : d.formato?.toLowerCase() === "pdf" ? <Eye size={12} /> : <Download size={12} />}
                {d.formato?.toLowerCase() === "pdf" ? "Ver" : "Bajar"}
              </button>
            )}
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-mute hover:text-ink" title="Abrir en el SEACE (fuente oficial)">
              SEACE <ExternalLink size={11} />
            </a>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[12px] text-rust">{error}</p>}
      {abierto && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="flex items-center gap-2 border-b border-line bg-paperSoft px-3 py-1.5 text-[11px] text-mute">
            <span className="min-w-0 flex-1 truncate text-ink">{abierto.doc.titulo ?? tipoDocLabel(abierto.doc.tipo)}</span>
            {abierto.f.bytes ? <span className="font-mono">{(abierto.f.bytes / 1e6).toFixed(1)} MB</span> : null}
            <a href={abierto.f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink"><Download size={11} /> Abrir</a>
            <button type="button" onClick={() => setAbierto(null)} className="rounded p-0.5 hover:text-ink" aria-label="Cerrar vista previa"><X size={13} /></button>
          </div>
          <iframe src={`${abierto.f.url}#toolbar=1&view=FitH`} title="Vista previa del documento" className="h-[70vh] w-full bg-paperDeep" />
          <p className="px-3 py-1 text-[10px] text-mute">Copia del documento publicado en el SEACE, guardada por Vigía. El enlace vence en {Math.round(abierto.f.venceEnSeg / 60)} min.</p>
        </div>
      )}
    </>
  );
}
