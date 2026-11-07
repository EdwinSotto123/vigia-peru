"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

/** Copia el enlace de esta página (con su pestaña). Si el navegador no deja, lo dice. */
export function CopiarEnlace() {
  const [estado, setEstado] = useState<"" | "ok" | "error">("");
  async function copiar() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("volver");
      await navigator.clipboard.writeText(url.toString());
      setEstado("ok");
    } catch {
      setEstado("error");
    }
    setTimeout(() => setEstado(""), 2500);
  }
  return (
    <button
      type="button"
      onClick={() => void copiar()}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-caja px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-ink/20"
    >
      {estado === "ok" ? <Check size={15} aria-hidden className="text-granate" /> : <Link2 size={15} aria-hidden />}
      <span aria-live="polite">{estado === "ok" ? "Copiado" : estado === "error" ? "No se pudo copiar" : "Copiar enlace"}</span>
    </button>
  );
}
