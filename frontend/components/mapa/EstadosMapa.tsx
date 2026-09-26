import { EstadoError } from "@/components/patrones";
import { Llamita } from "@/components/marca";

/** Mientras llega la geometría del Perú: la llamita camina y se dice qué se espera. */
export function MapaEsqueleto() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-paperSoft" role="status">
      <Llamita caminando className="w-12 text-granate/70" />
      <span className="text-sm text-mute">Cargando el mapa del Perú…</span>
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
          <a href="/app/contratos" className="text-sm font-semibold text-granate underline-offset-2 hover:underline">
            Ver los contratos en lista
          </a>
        }
      >
        {detalle} Recarga la página; si sigue igual, el problema es nuestro.
      </EstadoError>
    </div>
  );
}
