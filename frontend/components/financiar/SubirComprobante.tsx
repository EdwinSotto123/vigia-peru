"use client";

/**
 * Adjuntar el comprobante de pago (captura de Yape/Plin o constancia de transferencia)
 * a un aporte en `pendiente_pago`. Lo usan el paso de pago del formulario y Mi impacto
 * (donde la cuenta ya probó que el aporte es suyo), para que "lo envío después" tenga
 * un lugar real al que volver.
 */

import { useState } from "react";
import { Camera, CheckCircle2, Loader2, Upload } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";

const ERRORES: Record<string, string> = {
  invalid_body: "El archivo subió, pero no pudimos asociarlo al aporte. Inténtalo de nuevo.",
  not_found_or_not_pending: "Este aporte ya no espera comprobante: se validó o se anuló.",
};

const ANILLO_ETIQUETA =
  "focus-within:outline-none focus-within:ring-2 focus-within:ring-heroViolet/60 focus-within:ring-offset-1 focus-within:ring-offset-paper";

export function SubirComprobante({
  codigo,
  onSubido,
  compacto = false,
}: {
  codigo: string;
  onSubido?: () => void;
  compacto?: boolean;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subido, setSubido] = useState(false);

  async function enviar() {
    if (!archivo) return;
    setCargando(true);
    setError(null);
    setProgreso(0);
    try {
      const url = await subirConProgreso(archivo, setProgreso);
      const r = await fetch(`${PUBLIC_API_BASE}/contribuciones/${encodeURIComponent(codigo)}/comprobante`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(ERRORES[(j as { error?: string }).error ?? ""] ?? "No se pudo adjuntar el comprobante. Inténtalo de nuevo.");
      }
      setSubido(true);
      onSubido?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
      setProgreso(null);
    }
  }

  if (subido) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-moss" role="status">
        <CheckCircle2 size={14} aria-hidden /> Comprobante recibido para {codigo}.
      </p>
    );
  }

  return (
    <div className={compacto ? "" : "rounded-xl border border-line p-4"}>
      {!compacto && (
        <>
          <div className="text-[11px] uppercase tracking-wide text-mute">Comprobante de pago (opcional, acelera la validación)</div>
          <p className="mt-1 text-sm text-mute">Captura de Yape o Plin, o constancia de transferencia. Se guarda en privado; solo lo ve quien valida.</p>
        </>
      )}
      <div className={`${compacto ? "" : "mt-3 "}flex flex-wrap items-center gap-2`}>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink hover:bg-paperDeep sm:hidden ${ANILLO_ETIQUETA}`}>
          <Camera size={14} aria-hidden /> Tomar foto
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        </label>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink hover:bg-paperDeep ${ANILLO_ETIQUETA}`}>
          <Upload size={14} aria-hidden /> Elegir archivo
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        </label>
        {archivo && <span className="max-w-[16rem] truncate text-[12px] text-inkSoft">{archivo.name}</span>}
        <button type="button" onClick={enviar} disabled={!archivo || cargando} className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50">
          {cargando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />} Enviar comprobante
        </button>
      </div>
      {progreso != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Subiendo comprobante">
          <div className="h-full rounded-full bg-moss" style={{ width: `${progreso}%` }} />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rust" role="alert">{error}</p>}
    </div>
  );
}

/** Sube a /api/upload con progreso real (XHR). Devuelve la URL pública/firmada del archivo. */
function subirConProgreso(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "comprobante");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && j.url) resolve(j.url);
        else reject(new Error("No se pudo subir el comprobante. Revisa que sea una imagen o un PDF."));
      } catch { reject(new Error("No se pudo subir el comprobante.")); }
    };
    xhr.onerror = () => reject(new Error("Sin conexión al subir el comprobante."));
    xhr.send(fd);
  });
}
