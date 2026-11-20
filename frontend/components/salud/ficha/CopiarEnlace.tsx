"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * «Copiar enlace»: la dirección de esta ficha, sin la pestaña abierta (cada quien la abre en su resumen). Si el navegador
 * no deja escribir en el portapapeles, lo dice y deja el enlace a la vista para copiarlo a mano.
 */
export function CopiarEnlace({ className }: { className?: string }) {
  const [estado, setEstado] = useState<"listo" | "copiado" | "fallo">("listo");
  const [url, setUrl] = useState<string | null>(null);
  async function copiar() {
    const u = `${window.location.origin}${window.location.pathname}`;
    setUrl(u);
    try {
      await navigator.clipboard.writeText(u);
      setEstado("copiado");
      window.setTimeout(() => setEstado("listo"), 2000);
    } catch {
      setEstado("fallo");
    }
  }
  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={() => void copiar()}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        {estado === "copiado" ? <Check size={16} aria-hidden className="text-mossTexto" /> : <Link2 size={16} aria-hidden />}
        <span aria-live="polite">{estado === "copiado" ? "Enlace copiado" : "Copiar enlace"}</span>
      </button>
      {estado === "fallo" && url && (
        <p role="status" className="mt-2 text-meta text-inkSoft">
          No pudimos copiarlo solo. Selecciónalo:{" "}
          <span className="select-all break-all font-mono text-rotulo text-ink">{url}</span>
        </p>
      )}
    </div>
  );
}
