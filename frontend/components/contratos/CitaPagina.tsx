"use client";

/**
 * Enlace a la página exacta de un documento del expediente: pide la URL firmada (15 min) a la
 * API y abre `…#page=N` en una pestaña nueva. Si el documento no está en el almacén de Vigía,
 * cae al SEACE (sin página).
 */

import { useState } from "react";
import { FileText, Loader2, ExternalLink } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import type { CitaDocumento } from "@/lib/contratos";

export function CitaPagina({ ocid, cita, className = "", corto = false }: { ocid: string; cita: CitaDocumento; className?: string; corto?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const largo = `${cita.pagina != null ? `p. ${cita.pagina}` : "documento"}${cita.documentoTitulo ? ` · ${cita.documentoTitulo}` : ""}`;
  const label = corto ? (cita.pagina != null ? `p. ${cita.pagina}` : "doc.") : largo;

  async function abrir() {
    if (!cita.documentoUrl) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${PUBLIC_API_BASE}/contratos/${encodeURIComponent(ocid)}/documento?url=${encodeURIComponent(cita.documentoUrl)}`);
      const j = await res.json();
      if (!res.ok || !j.url) throw new Error(j.detail ?? "no disponible");
      const hash = cita.pagina != null && j.previsualizable ? `#page=${cita.pagina}` : "";
      window.open(`${j.url}${hash}`, "_blank", "noopener");
    } catch {
      setError("no está en el almacén de Vigía");
      window.open(cita.documentoUrl, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }

  if (!cita.documentoUrl) {
    return <span className={`inline-flex items-center gap-1 text-[11px] text-mute ${className}`}><FileText size={11} aria-hidden /> {label}</span>;
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={abrir}
        disabled={busy}
        title={`${largo}${cita.cita ? ` — “${cita.cita.slice(0, 200)}”` : ""}`}
        aria-label={`Abrir ${largo}`}
        className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink hover:bg-paperDeep disabled:opacity-60"
      >
        {busy ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <FileText size={11} aria-hidden />}
        {label}
        <ExternalLink size={10} className="text-mute" aria-hidden />
      </button>
      {error && <span className="text-[10px] text-mute">({error}; abrimos el SEACE)</span>}
    </span>
  );
}
