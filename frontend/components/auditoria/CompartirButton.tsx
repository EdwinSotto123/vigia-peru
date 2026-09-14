"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

interface Props {
  titulo: string;
  texto?: string;
  /** Ruta relativa (p. ej. `/impacto/VIG-2026-00002`); se resuelve contra el origen actual. */
  path: string;
  className?: string;
}

/** Copia la URL al portapapeles; si el navegador soporta Web Share, abre la hoja nativa. */
export function CompartirButton({ titulo, texto, path, className = "" }: Props) {
  const [hecho, setHecho] = useState<"copiado" | "compartido" | null>(null);

  const compartir = async () => {
    const url = typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: titulo, text: texto, url });
        setHecho("compartido");
      } else {
        await navigator.clipboard.writeText(url);
        setHecho("copiado");
      }
    } catch {
      try { await navigator.clipboard.writeText(url); setHecho("copiado"); } catch { /* sin permisos: no hacemos nada ruidoso */ }
    }
    window.setTimeout(() => setHecho(null), 2200);
  };

  return (
    <button
      type="button"
      onClick={compartir}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-all hover:bg-paperDeep ${className}`}
      aria-live="polite"
    >
      {hecho ? <Check size={14} className="text-moss" aria-hidden /> : <Share2 size={14} aria-hidden />}
      {hecho === "copiado" ? "Enlace copiado" : hecho === "compartido" ? "Compartido" : "Compartir"}
    </button>
  );
}
