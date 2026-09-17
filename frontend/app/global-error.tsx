"use client";

/**
 * Último recurso: si el error ocurre en el propio layout raíz (fuera de lo que cubre
 * app/error.tsx), Next.js reemplaza TODO el documento por este componente — por eso define su
 * propio <html>/<body> y usa estilos inline en vez de clases de Tailwind (globals.css puede no
 * estar disponible en este punto de falla). Mismo botón de recarga automática ante un chunk
 * viejo de un deploy reciente que app/error.tsx.
 */

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#FFFFFF", color: "#14171A" }}>
        <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Algo salió mal</h1>
          <p style={{ maxWidth: 420, fontSize: 14, color: "#687180", margin: 0 }}>
            Puede haber sido una actualización reciente del sitio. Recargá para continuar.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ borderRadius: 999, padding: "10px 22px", background: "#14171A", color: "#FFFFFF", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Recargar
          </button>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 10, color: "#687180" }}>ref: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
