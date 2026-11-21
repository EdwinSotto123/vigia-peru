import type { ReactNode } from "react";
import { Burbuja, Calle, RenglonBurbuja } from "@/components/pixel/Escena";
import { Pixel } from "@/components/pixel/Pixel";
import { cn } from "@/lib/utils";

/**
 * El momento de la portada de Gobserva Licitaciones (2026-11-20, en lugar del radar): una emprendedora con su caja, en
 * la calle de una entidad pública con el camión del reparto en la puerta, ve en una burbuja lo que calza con lo que
 * vende, con su puntaje de afinidad, como en «Para ti». La escena se arma una vez y a pasos (la entidad y el camión se
 * dibujan de abajo arriba, ella llega, la burbuja se abre y cada oportunidad aparece en su turno); después sólo vive: ella
 * parpadea y la bandera ondea. Es un EJEMPLO y lo dice. Con movimiento reducido, todo quieto y a la vista. Va sobre la
 * banda oscura del héroe; la burbuja es una placa clara. Server-safe.
 */
const CALZA = [
  { n: 92, titulo: "Útiles de oficina para el año escolar", quien: "Una UGEL de Cusco", cuando: "Cierra en 2 días" },
  { n: 88, titulo: "Tóner y cartuchos para impresoras", quien: "Una municipalidad de Puno", cuando: "Consultas hasta el viernes" },
  { n: 81, titulo: "Papel bond A4 para la sede central", quien: "Un hospital de Cusco", cuando: "Cierra mañana" },
];

export function EscenaLicitaciones({ className }: { className?: string }) {
  return (
    <figure className={cn("relative mx-auto w-full max-w-[31rem] select-none", className)}>
      <Burbuja titulo="Para ti: Útiles de oficina" className="w-[18.5rem] max-w-full sm:w-[21rem]">
        <div className="space-y-2.5">
          {CALZA.map((c, i) => (
            <RenglonBurbuja
              key={c.titulo}
              texto={c.titulo}
              detalle={
                <>
                  {c.quien}
                  <span className="block font-semibold text-granate">{c.cuando}</span>
                </>
              }
              derecha={<Afinidad n={c.n} />}
              orden={i}
            />
          ))}
        </div>
      </Burbuja>
      <Calle
        className="-mt-2"
        izquierda={<Pixel nombre="emprendedora" escala={6} className="h-auto w-16 sm:w-24" />}
        derecha={
          <div className="flex items-end gap-1 sm:gap-2">
            <Entra retardo={520}>
              <Pixel nombre="camion" escala={6} className="h-auto w-[7.5rem] sm:w-[11.25rem]" />
            </Entra>
            <Pixel nombre="entidad" escala={6} retardo={900} className="h-auto w-[8.5rem] sm:w-[12.75rem]" />
          </div>
        }
      />
      <figcaption className="mt-3 text-meta leading-snug text-paper/70">
        Lo que calza con una empresa que vende útiles de oficina y tóner, con su puntaje de afinidad.
      </figcaption>
    </figure>
  );
}

/** El puntaje de afinidad (0 a 100), chico, como el de «Para ti»: lleno, porque los tres calzan. */
function Afinidad({ n }: { n: number }) {
  return (
    <span className="inline-grid h-7 min-w-[1.75rem] place-items-center rounded-md bg-granate px-1 font-display text-dato font-bold leading-none text-paper">
      {n}
      <span className="sr-only"> de afinidad</span>
    </span>
  );
}

/** Lo que se dibuja de abajo arriba un poco después que el resto de la calle (el camión, que llega a la puerta). */
function Entra({ retardo, children }: { retardo: number; children: ReactNode }) {
  return (
    <div className="px-sube" style={{ animationDelay: `${retardo}ms` }}>
      {children}
    </div>
  );
}
