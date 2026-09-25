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
import { esPdf, formatoDoc, tipoDocLabel, type ContratoDocumento } from "@/lib/contratos";
import { fechaCorta, numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

interface Firmada { url: string; formato: string; bytes: number | null; previsualizable: boolean; venceEnSeg: number }

export function DocumentosContrato({ ocid, documentos }: { ocid: string; documentos: ContratoDocumento[] }) {
  const [abierto, setAbierto] = useState<{ doc: ContratoDocumento; f: Firmada } | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<{ url: string; titulo: string } | null>(null);

  async function ver(d: ContratoDocumento) {
    setError(null);
    setEnlace(null);
    setCargando(d.url);
    // Lo que no es PDF se abre en otra pestaña. Esa pestaña se abre YA, dentro del gesto
    // del clic, y después se le pone la URL firmada: un `window.open` después de un
    // `await` lo bloquean Safari en iOS y Firefox, y el botón "Bajar" no hacía nada.
    // (Sin "noopener" en la llamada, que la haría devolver null; se corta a mano.)
    const w = esPdf(d.formato) ? null : window.open("about:blank", "_blank");
    if (w) w.opener = null;
    try {
      const res = await fetch(`${PUBLIC_API_BASE}/contratos/${encodeURIComponent(ocid)}/documento?url=${encodeURIComponent(d.url)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail ?? j.error ?? `HTTP ${res.status}`);
      const f = j as Firmada;
      if (f.previsualizable) {
        w?.close();
        setAbierto({ doc: d, f });
      } else if (w && !w.closed) {
        w.location.href = f.url;
      } else {
        // El navegador bloqueó la pestaña: se deja el enlace firmado a mano, sin sacar a nadie de la página.
        setEnlace({ url: f.url, titulo: d.titulo ?? tipoDocLabel(d.tipo) });
      }
    } catch (e) {
      w?.close();
      setError(`No se pudo abrir la copia de Vigía (${(e as Error).message}). El enlace “SEACE” abre el original.`);
    } finally {
      setCargando(null);
    }
  }

  if (!documentos.length) {
    return <p className="rounded-2xl border border-dashed border-line bg-paperSoft px-4 py-6 text-center text-sm text-mute">El registro no publica documentos para este proceso.</p>;
  }

  return (
    <>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
        {documentos.map((d, i) => (
          <li key={`${d.url}-${i}`} className={cn("flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-paperSoft", abierto?.doc.url === d.url && "bg-paperSoft")}>
            <FileText size={14} className="shrink-0 text-mute" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{d.titulo ?? tipoDocLabel(d.tipo)}</span>
              {/* Cinco atributos del documento, antes encadenados con puntos
                  medios en un renglón de 10 px. Son una lista: se dibuja como
                  lista, separada por espacio. */}
              <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[11px] text-mute">
                <span>{tipoDocLabel(d.tipo)}</span>
                {d.seccion === "award" && <span>adjudicación</span>}
                {d.seccion === "contract" && <span>contrato</span>}
                {formatoDoc(d.formato) && <span className="font-mono">{formatoDoc(d.formato)!.toUpperCase()}</span>}
                {d.fecha && <span>{fechaCorta(d.fecha.slice(0, 10))}</span>}
                {d.enVigia && <span>copia en Vigía</span>}
              </span>
            </span>
            {d.enVigia && (
              <button
                type="button"
                onClick={() => ver(d)}
                disabled={cargando === d.url}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-medium text-ink hover:bg-paperDeep disabled:opacity-60"
                aria-label={`${esPdf(d.formato) ? "Ver la copia de Vigía de" : "Bajar la copia de Vigía de"} ${d.titulo ?? tipoDocLabel(d.tipo)}`}
              >
                {cargando === d.url ? <Loader2 size={12} className="animate-spin" aria-hidden /> : esPdf(d.formato) ? <Eye size={12} aria-hidden /> : <Download size={12} aria-hidden />}
                {cargando === d.url ? "Abriendo…" : esPdf(d.formato) ? "Ver" : "Bajar"}
              </button>
            )}
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-granate hover:underline"
              aria-label={`Abrir ${d.titulo ?? tipoDocLabel(d.tipo)} en el SEACE (fuente oficial)`}
            >
              SEACE <ExternalLink size={11} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-[12px] text-crimsonTexto">{error}</p>}
      {enlace && (
        <p className="mt-2 text-[12px] text-ink">
          Documento listo:{" "}
          <a href={enlace.url} target="_blank" rel="noopener noreferrer" className="font-medium text-granate underline underline-offset-2">
            abrir {enlace.titulo}
          </a>{" "}
          <span className="text-mute">(enlace válido por 15 minutos)</span>
        </p>
      )}
      {abierto && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="flex items-center gap-2 border-b border-line bg-paperSoft px-3 py-1.5 text-[12px] text-mute">
            <span className="min-w-0 flex-1 truncate text-ink">{abierto.doc.titulo ?? tipoDocLabel(abierto.doc.tipo)}</span>
            {abierto.f.bytes ? <span className="font-mono tabular-nums">{numero(Math.max(1, Math.round(abierto.f.bytes / 1e5)) / 10)} MB</span> : null}
            <a href={abierto.f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[28px] items-center gap-1 hover:text-ink"><Download size={12} aria-hidden /> Abrir</a>
            <button type="button" onClick={() => setAbierto(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-paperDeep hover:text-ink" aria-label="Cerrar la vista previa"><X size={14} aria-hidden /></button>
          </div>
          <iframe src={`${abierto.f.url}#toolbar=1&view=FitH`} title="Vista previa del documento" className="h-[70vh] w-full bg-paperDeep" />
          <p className="px-3 py-1.5 text-[11px] text-mute">Copia del documento publicado en el SEACE, guardada por Vigía. El enlace vence en {numero(Math.round(abierto.f.venceEnSeg / 60))} min.</p>
        </div>
      )}
    </>
  );
}
