"use client";

import { Suspense, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { Cargando } from "@/components/patrones";
import { Panel } from "@/components/ui/Panel";
import { ReporteNuevo } from "@/app/(dashboard)/reporte/nuevo/ReporteNuevo";
import { cn } from "@/lib/utils";

const BOTON =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-2 text-dato leading-5 font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2";

/**
 * «Denunciar» sin salir de la lista: abre el formulario en una ventana sobre la página (2026-11-12, pedido del usuario:
 * «al dar clic debería aparecer una ventana flotante»). Antes llevaba a /reporte/nuevo y, al terminar, había que volver.
 * La página /reporte/nuevo sigue existiendo para los enlaces de afuera (el mapa, una entidad, el pie).
 */
export function BotonDenunciar({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={cn(BOTON, className)}>
        <MessageSquareWarning size={16} aria-hidden />
        {children ?? "Denunciar"}
      </button>
      <Panel
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo="Denuncia lo que viste"
        posicion="centro"
        ancho="xl"
        className="sm:max-w-6xl"
      >
        {abierto && (
          <Suspense fallback={<Cargando texto="Cargando el formulario…" />}>
            <ReporteNuevo enPanel />
          </Suspense>
        )}
      </Panel>
    </>
  );
}
