"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El número de colegiatura a la vista, con «Copiar el número» para pegarlo en «Conoce a tu médico». (No usa
 * components/gobserva/Copiar: su id con Math.random no coincide entre el servidor y el navegador.)
 */
export function CopiarNumero({ numero, etiqueta = "Copiar el número", className }: { numero: string; etiqueta?: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(numero);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* sin permiso: el número sigue a la vista y se puede seleccionar */
    }
  }
  return (
    <div className={cn("inline-flex min-w-0 items-center gap-2 rounded-xl border border-line bg-paperSoft py-1.5 pl-3.5 pr-1.5", className)}>
      <span className="select-all font-mono text-destacado font-semibold tabular-nums text-ink">{numero}</span>
      <button
        type="button"
        onClick={() => void copiar()}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-paper px-3.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        {copiado ? <Check size={14} aria-hidden className="text-mossTexto" /> : <Copy size={14} aria-hidden />}
        <span aria-live="polite">{copiado ? "Copiado" : etiqueta}</span>
      </button>
    </div>
  );
}
