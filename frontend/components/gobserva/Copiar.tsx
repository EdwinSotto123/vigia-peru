"use client";

import { useState, useId } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un texto para copiar (una URL, una configuración) con su botón. Si el navegador no deja escribir en el portapapeles,
 * selecciona el texto para copiarlo a mano. `bloque`: varias líneas en un <pre> (la configuración del MCP).
 */
export function Copiar({ texto, etiqueta = "Copiar", bloque = false, className }: { texto: string; etiqueta?: string; bloque?: boolean; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  // useId y no Math.random: el id del servidor y el del navegador tienen que ser iguales (aviso de hidratación en Obras
  // y en Salud).
  const id = `copiar-${useId().replace(/:/g, "")}`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      const el = document.getElementById(id);
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }
  };
  const boton = (
    <button
      type="button"
      onClick={copiar}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-paper px-3.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
    >
      {copiado ? <Check size={14} aria-hidden className="text-mossTexto" /> : <Copy size={14} aria-hidden />}
      <span aria-live="polite">{copiado ? "Copiado" : etiqueta}</span>
    </button>
  );
  if (bloque) {
    return (
      <div className={cn("overflow-hidden rounded-xl border border-line bg-paperSoft", className)}>
        <div className="flex items-center justify-end border-b border-line px-2 py-1.5">{boton}</div>
        <pre id={id} className="overflow-x-auto px-4 py-3 font-mono text-meta leading-relaxed text-ink">
          {texto}
        </pre>
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-xl border border-line bg-paperSoft py-1.5 pl-3 pr-1.5", className)}>
      <code id={id} className="min-w-0 flex-1 truncate font-mono text-meta text-ink" title={texto}>
        {texto}
      </code>
      {boton}
    </div>
  );
}
