import { Loader2, SearchX } from "lucide-react";
import { EstadoError } from "@/components/patrones";
import { Llamita } from "@/components/marca";

/** Mientras llega la geometría del Perú: la llamita camina y se dice qué se espera. */
export function MapaEsqueleto() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-paperSoft" role="status">
      <Llamita caminando className="w-12 text-granate/70" />
      <span className="text-dato leading-5 text-mute">Cargando el mapa del Perú…</span>
    </div>
  );
}

/**
 * Respuesta visual a un filtro, encima del lienzo: el mapa se atenúa con "Actualizando el mapa…" mientras llega lo
 * filtrado, y si nada cumple lo dice con la salida a la mano (antes quedaba gris sin explicación). Lo dibuja el mapa
 * (componente cliente): `onQuitar` nunca cruza desde el servidor.
 */
export function VeloMapa({ cargando, onQuitar }: { cargando: boolean; onQuitar: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-paper/55 pt-10 backdrop-blur-[1px]">
      <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-4 py-2 text-meta font-semibold text-ink shadow-sm">
        {cargando ? (
          <>
            <Loader2 size={15} className="animate-spin text-granate" aria-hidden /> Actualizando el mapa…
          </>
        ) : (
          <>
            <SearchX size={15} className="text-amberTexto" aria-hidden /> Ningún contrato cumple estos filtros
            <button type="button" onClick={onQuitar} className="ml-1 font-semibold text-granate hover:underline">
              Quitar filtros
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/** La geometría no llegó (error de red) o falta el archivo: qué pasó, qué hacer y la salida a la lista. */
export function ErrorMapa({ faltaArchivo }: { faltaArchivo: boolean }) {
  const detalle = faltaArchivo ? "Falta el archivo con los límites del Perú." : "La geometría del Perú no llegó.";
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EstadoError
        titulo="No pudimos dibujar el mapa"
        className="max-w-md"
        accion={
          <a href="/app/contratos" className="text-dato leading-5 font-semibold text-granate underline-offset-2 hover:underline">
            Ver los contratos en lista
          </a>
        }
      >
        {detalle} Recarga la página; si sigue igual, el problema es nuestro.
      </EstadoError>
    </div>
  );
}
