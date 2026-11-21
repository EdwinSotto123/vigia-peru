import { Burbuja, Calle, RenglonBurbuja } from "@/components/pixel/Escena";
import { Pixel } from "@/components/pixel/Pixel";
import { fechaCorta } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * El momento de la portada de Gobserva Salud: una vecina en la puerta de una clínica mira su celular antes de entrar, y
 * en una burbuja aparece lo que verificó. Es lo que el producto hace, dicho sin una tabla. La escena se arma una vez y
 * a pasos (la clínica se dibuja de abajo arriba, la vecina llega, la burbuja se abre desde el celular y cada chequeo
 * aparece en su turno); después sólo vive: la vecina parpadea, la pantalla y la cruz laten. Los chequeos son un ejemplo
 * marcado como tal, con las fechas de las fuentes de hoy. Con movimiento reducido, todo quieto y a la vista.
 * Va sobre la banda oscura del héroe; la burbuja es una placa clara. Server-safe.
 */
export function EscenaPuerta({ renipressAl, sancionesAl, className }: { renipressAl: string | null; sancionesAl: string | null; className?: string }) {
  return (
    <figure className={cn("relative mx-auto w-full max-w-[27rem] select-none", className)} aria-label="Ejemplo: una vecina verifica una clínica desde su celular antes de entrar">
      <Burbuja titulo="Un centro médico de Lima" className="w-[17rem] max-w-[85%] sm:w-[18.5rem]">
        <div className="space-y-2">
          <RenglonBurbuja texto="Activa en RENIPRESS" detalle={renipressAl ? `Revisado el ${fechaCorta(renipressAl)}` : "Registro de SUSALUD"} orden={0} />
          <RenglonBurbuja
            texto="No figura en el Registro de Sanciones"
            detalle={sancionesAl ? `Revisado el ${fechaCorta(sancionesAl)}` : "Sanciones firmes de SUSALUD"}
            orden={1}
          />
          <RenglonBurbuja icono="pregunta" texto="¿Centro quirúrgico? No lo declaró" detalle="Si te ofrecen operarte aquí, pregunta dónde" orden={2} />
        </div>
      </Burbuja>
      <Calle
        className="-mt-2"
        izquierda={<Pixel nombre="vecina" escala={6} className="h-auto w-[4.5rem] sm:w-24" />}
        derecha={<Pixel nombre="clinica" escala={7} retardo={700} className="h-auto w-[12.5rem] sm:w-[15rem]" />}
      />
    </figure>
  );
}
