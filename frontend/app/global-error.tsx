"use client";

/**
 * Último recurso: si el error ocurre en el propio layout raíz (fuera de lo que cubre
 * app/error.tsx), Next.js reemplaza TODO el documento por este componente — por eso define su
 * propio <html>/<body> y usa estilos inline en vez de clases de Tailwind (globals.css puede no
 * estar disponible en este punto de falla). Tampoco importa nada del proyecto: si lo que falló
 * es un módulo compartido, esta pantalla no puede depender de él. Mismo botón de recarga
 * automática ante un chunk viejo de un deploy reciente que app/error.tsx.
 */

import { useEffect } from "react";

// Valores de los tokens de tailwind.config.ts (DESIGN_SYSTEM.md §3): acá no hay clases.
const PAPER = "#FFFFFF";
const INK = "#1E191B";
const INK_SOFT = "#463D41";
const MUTE = "#6B6166";
const GRANATE = "#711C30";

// La franja textil de la cabecera, en CSS puro: los hilos del tejido del isotipo
// (ladrillo, maíz, verde, ocre, añil). Sin SVG ni imagen que cargar.
const FRANJA =
  "repeating-linear-gradient(90deg, #843022 0 14px, #E2A460 14px 20px, #843022 20px 26px, #3E7B4F 26px 32px, #843022 32px 38px, #C47F3E 38px 42px, #2D3E6F 42px 48px)";

// `reset` no se usa: re-renderizar el layout raíz que acaba de fallar suele fallar
// igual. Recargar la página completa trae también el JS nuevo si hubo un deploy.
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[vigia] error de render en el layout raíz:", error);
    const esChunkViejo = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(
      `${error.name} ${error.message}`,
    );
    if (esChunkViejo && typeof window !== "undefined") {
      let yaRecargo = false;
      try { yaRecargo = window.sessionStorage.getItem("vigia_recarga_por_chunk") === "1"; } catch { /* ignorar */ }
      if (!yaRecargo) {
        try { window.sessionStorage.setItem("vigia_recarga_por_chunk", "1"); } catch { /* ignorar */ }
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html lang="es-PE">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", background: PAPER, color: INK }}>
        <div aria-hidden style={{ height: 4, background: FRANJA }} />
        <main
          style={{
            minHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "48px 16px",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
            Vigía <span style={{ color: GRANATE }}>Perú</span>
          </p>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>Algo salió mal</h1>
          <p style={{ margin: 0, maxWidth: 440, fontSize: 15, lineHeight: 1.6, color: INK_SOFT }}>
            Puede haber sido una actualización reciente del sitio. Recarga la página para continuar; si vuelve a
            pasar, inténtalo de nuevo en unos minutos.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 44,
              borderRadius: 999,
              padding: "10px 24px",
              background: GRANATE,
              color: PAPER,
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Recargar la página
          </button>
          {error.digest && (
            <p style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 12, color: MUTE }}>Referencia: {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
