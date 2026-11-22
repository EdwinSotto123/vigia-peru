"use client";

import { RotateCw } from "lucide-react";
import { EstadoError } from "@/components/gobserva/ui/Estados";
import { claseAccion } from "@/components/ui/EnlaceAccion";

/** Si una página de Salud falla al armarse: qué pasó y volver a intentar, dentro de la app (no la página en blanco). */
export default function ErrorSalud({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container-page py-10 sm:py-16">
      <div className="tarjeta mx-auto max-w-2xl rounded-2xl border border-line bg-paper">
        <EstadoError
          titulo="No pudimos mostrar esta página"
          texto="Suele ser momentáneo: las fuentes no respondieron a tiempo. Vuelve a intentarlo en unos segundos."
          acciones={
            <button type="button" onClick={reset} className={claseAccion("primario", "min-h-11")}>
              <RotateCw size={15} aria-hidden /> Volver a intentar
            </button>
          }
        />
      </div>
    </div>
  );
}
