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
  const [enlace, setEnlace] = useState<string | null>(null);
  const largo = `${cita.pagina != null ? `p. ${cita.pagina}` : "documento"}${cita.documentoTitulo ? ` de ${cita.documentoTitulo}` : ""}`;
  const label = corto ? (cita.pagina != null ? `p. ${cita.pagina}` : "doc.") : largo;

  async function abrir() {
    if (!cita.documentoUrl) return;
    const seace = cita.documentoUrl;
    // La pestaña se abre AHORA, dentro del gesto del clic, y recién después se le pone la
    // URL firmada. Un `window.open` después de un `await` ya no cuenta como gesto del usuario:
    // Safari en iOS y Firefox lo bloquean como popup y el clic no hacía nada.
    // Sin "noopener" en la llamada (con él, `window.open` devuelve null); se corta a mano.
    const w = window.open("about:blank", "_blank");
    if (w) w.opener = null;
    // Si el navegador bloqueó la pestaña igual, se deja el enlace a mano en vez de sacar a
    // la persona de la página en la que está leyendo.
    const ir = (url: string) => {
      if (w && !w.closed) w.location.href = url;
      else setEnlace(url);
    };
    setBusy(true); setError(null); setEnlace(null);
    try {
      const res = await fetch(`${PUBLIC_API_BASE}/contratos/${encodeURIComponent(ocid)}/documento?url=${encodeURIComponent(seace)}`);
      const j = await res.json();
      if (!res.ok || !j.url) throw new Error(j.detail ?? "no disponible");
      const hash = cita.pagina != null && j.previsualizable ? `#page=${cita.pagina}` : "";
      ir(`${j.url}${hash}`);
    } catch {
      setError("no está en el almacén de Vigía");
      ir(seace);
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
        // Sin la cita textual en el `title`: suele traer el nombre y el RUC de una persona
        // natural ("Señor(es): ABEL CARPIO COBOS | RUC: 10…"), y un tooltip no se puede
        // poner en vidrio. La cita se lee en la página del PDF que abre este botón.
        title={largo}
        aria-label={`Abrir ${largo}`}
        className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[12px] text-ink transition-colors hover:bg-paperDeep disabled:opacity-60"
      >
        {busy ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <FileText size={11} aria-hidden />}
        {label}
        <ExternalLink size={10} className="text-mute" aria-hidden />
      </button>
      {error && <span className="text-[11px] text-mute">({error}; abrimos el SEACE)</span>}
      {enlace && (
        <a href={enlace} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-granate underline underline-offset-2">
          abrir el documento
        </a>
      )}
    </span>
  );
}
