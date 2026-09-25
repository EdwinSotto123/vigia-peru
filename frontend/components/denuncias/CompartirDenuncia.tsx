"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";

/**
 * "Compartir esta denuncia". Antes era un <button> sin manejador: se veía,
 * se podía tocar y no hacía nada. En el teléfono abre la hoja nativa de
 * compartir; donde no existe, copia el enlace y lo dice en pantalla.
 */
export function CompartirDenuncia({ id, titulo }: { id: string; titulo: string }) {
  const [estado, setEstado] = useState<"idle" | "copiado" | "error">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const avisar = (e: "copiado" | "error") => {
    setEstado(e);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setEstado("idle"), 3000);
  };

  const compartir = async () => {
    const url = `${window.location.origin}/app/denuncias/${encodeURIComponent(id)}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: titulo, text: titulo, url });
        return;
      } catch (err) {
        // El usuario cerró la hoja: no es un error que haya que mostrar.
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      avisar("copiado");
    } catch {
      avisar("error");
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={compartir}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
      >
        {estado === "copiado" ? <Check size={16} className="text-mossTexto" aria-hidden /> : <Share2 size={16} aria-hidden />}
        {estado === "copiado" ? "Enlace copiado" : "Compartir esta denuncia"}
      </button>
      <p className="mt-1 min-h-[1rem] text-center text-[11px] text-mute" role="status" aria-live="polite">
        {estado === "copiado"
          ? "Pégalo donde quieras compartirlo."
          : estado === "error"
            ? "No pudimos copiar el enlace. Cópialo desde la barra de direcciones."
            : ""}
      </p>
    </div>
  );
}
