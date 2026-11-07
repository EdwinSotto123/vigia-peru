"use client";

import { RotateCcw } from "lucide-react";
import { Caja, Pagina } from "@/components/gobserva/app/Caja";
import { EstadoError } from "@/components/licitaciones-app/ui/Estados";
import { claseAccion } from "@/components/ui/EnlaceAccion";

/** Un error inesperado en la bandeja: qué pasó y cómo reintentar, dentro del marco de la app. */
export default function ErrorBandeja({ reset }: { error: Error; reset: () => void }) {
  return (
    <Pagina>
      <Caja>
        <EstadoError
          titulo="La bandeja no se pudo mostrar"
          texto="Algo falló de nuestro lado. Vuelve a intentarlo; si sigue, escríbenos a hello@gobserva.cloud."
          acciones={
            <button type="button" onClick={reset} className={claseAccion("secundario")}>
              <RotateCcw size={15} aria-hidden /> Volver a intentar
            </button>
          }
        />
      </Caja>
    </Pagina>
  );
}
