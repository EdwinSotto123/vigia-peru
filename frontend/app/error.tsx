"use client";

/**
 * Red de seguridad para cualquier error de render que se escape en el árbol de la app (no
 * existía ninguna hasta ahora: un error client-side cualquiera caía en la pantalla genérica de
 * Next.js "Application error: a client-side exception has occurred", sin forma de recuperarse
 * ni de saber qué pasó).
 *
 * El caso más común y más inofensivo: publicamos una actualización del sitio mientras alguien
 * la tenía abierta — su navegador pide un chunk de JS que ya no existe en el servidor nuevo
 * (`ChunkLoadError` / "Loading chunk" / "dynamically imported module") y el error boundary de
 * React lo atrapa como si fuera un bug. Eso se autocura solo con una recarga, así que la
 * hacemos automáticamente (una sola vez — con un candado para no entrar en loop si el error
 * de verdad persiste).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Map, RefreshCw } from "lucide-react";

const CANDADO = "vigia_recarga_por_chunk";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [recargando, setRecargando] = useState(false);

  useEffect(() => {
    console.error("[vigia] error de render capturado:", error);
    const esChunkViejo = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(
      `${error.name} ${error.message}`,
    );
    if (esChunkViejo && typeof window !== "undefined") {
      let yaRecargo = false;
      try { yaRecargo = window.sessionStorage.getItem(CANDADO) === "1"; } catch { /* modo privado: seguimos igual */ }
      if (!yaRecargo) {
        try { window.sessionStorage.setItem(CANDADO, "1"); } catch { /* no bloquea la recarga */ }
        setRecargando(true);
        window.location.reload();
      }
    }
  }, [error]);

  if (recargando) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center text-mute">
        <RefreshCw size={20} className="animate-spin" aria-hidden />
        <p className="text-sm">Actualizamos el sitio hace un momento — recargando…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full bg-crimson-soft p-3 text-rust">
        <AlertTriangle size={22} aria-hidden />
      </div>
      <h1 className="font-serif text-2xl font-bold text-ink">Algo no cargó bien</h1>
      <p className="max-w-md text-sm text-mute">
        Puede haber sido una actualización del sitio justo mientras tenías esta página abierta.
        Reintentá — si te vuelve a pasar en el mismo lugar, contanos qué estabas viendo.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 rounded-full bg-heroViolet px-5 py-2.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper"
        >
          <RefreshCw size={14} aria-hidden /> Reintentar
        </button>
        <Link
          href="/app/mapa"
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink hover:bg-paperSoft"
        >
          <Map size={14} aria-hidden /> Ir al mapa
        </Link>
      </div>
      {error.digest && <p className="font-mono text-[10px] text-mute/70">ref: {error.digest}</p>}
    </div>
  );
}
