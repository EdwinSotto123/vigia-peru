import { Burbuja, Calle, RenglonBurbuja } from "@/components/pixel/Escena";
import { Pixel } from "@/components/pixel/Pixel";
import { cn } from "@/lib/utils";

/**
 * El momento de la portada de Gobserva Empleo (2026-11-20, antes un celular con la pantalla bloqueada): un postulante,
 * con su mochila y su CV, frente al tablero de convocatorias, mira su celular a las 7:00 del lunes; en una burbuja
 * aparecen los avisos que le llegaron. Es lo que el producto hace por quien busca trabajo: la plaza nueva que calza, la
 * que cierra mañana. La escena se arma una vez y a pasos (el tablero se dibuja de abajo arriba, el postulante llega, la
 * burbuja se abre y cada aviso aparece en su turno); después sólo vive: él parpadea y la plaza nueva del tablero late.
 * Todo es un EJEMPLO y lo dice: entidades genéricas, ningún aviso real. Con movimiento reducido, todo quieto y a la
 * vista. Va sobre la banda oscura del héroe; la burbuja es una placa clara. Server-safe.
 */
export function EscenaEmpleo({ className }: { className?: string }) {
  return (
    <figure className={cn("relative mx-auto w-full max-w-[27rem] select-none", className)} aria-label="Ejemplo: un postulante recibe en su celular los avisos de Gobserva Empleo">
      <Burbuja titulo="Gobserva Empleo, lunes 7:00" className="w-[19rem] max-w-[92%] sm:w-[20.5rem]">
        <div className="space-y-2.5">
          <RenglonBurbuja icono="iconoCampana" texto="3 plazas nuevas para ti" detalle="Contador en una UGEL de Cusco, S/ 3,200 al mes. Cierra en 5 días." orden={0} />
          <RenglonBurbuja
            icono="iconoCalendario"
            texto="Mañana cierra una plaza que guardaste"
            detalle="Asistente administrativo en un hospital de Arequipa. Todavía estás a tiempo."
            orden={1}
          />
          <RenglonBurbuja texto="Calza contigo: pide 1 año de experiencia" detalle="Técnico en archivo en una municipalidad de Lima, S/ 2,400 al mes." orden={2} />
        </div>
      </Burbuja>
      <Calle
        className="-mt-2"
        izquierda={<Pixel nombre="postulante" escala={6} className="h-auto w-[4.5rem] sm:w-24" />}
        derecha={<Pixel nombre="tablero" escala={7} retardo={700} className="h-auto w-[11.5rem] sm:w-[13.5rem]" />}
      />
    </figure>
  );
}
