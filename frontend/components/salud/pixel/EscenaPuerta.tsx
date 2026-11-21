import { Ejemplo } from "@/components/licitaciones/portada/Maquetas";
import { fechaCorta } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { Pixel } from "./Pixel";

/**
 * El momento de la portada de Gobserva Salud: una vecina en la puerta de una clínica mira su celular antes de entrar, y
 * en una burbuja aparece lo que verificó. Es lo que el producto hace, dicho sin una tabla. La escena se arma una vez y
 * a pasos (la clínica se dibuja de abajo arriba, la vecina llega, la burbuja se abre desde el celular y cada chequeo
 * aparece en su turno); después sólo vive: la vecina parpadea, la pantalla y la cruz laten. Los chequeos son un ejemplo
 * marcado como tal, con las fechas de las fuentes de hoy. Con movimiento reducido, todo quieto y a la vista.
 * Va sobre la banda oscura del héroe; la burbuja es una placa clara (.sobre-claro). Server-safe.
 */
export function EscenaPuerta({ renipressAl, sancionesAl, className }: { renipressAl: string | null; sancionesAl: string | null; className?: string }) {
  const chequeos: { icono: "chequeo" | "pregunta"; texto: string; detalle: string }[] = [
    { icono: "chequeo", texto: "Activa en RENIPRESS", detalle: renipressAl ? `Revisado el ${fechaCorta(renipressAl)}` : "Registro de SUSALUD" },
    { icono: "chequeo", texto: "No figura en el Registro de Sanciones", detalle: sancionesAl ? `Revisado el ${fechaCorta(sancionesAl)}` : "Sanciones firmes de SUSALUD" },
    { icono: "pregunta", texto: "¿Centro quirúrgico? No lo declaró", detalle: "Si te ofrecen operarte aquí, pregunta dónde" },
  ];
  return (
    <figure className={cn("relative mx-auto w-full max-w-[27rem] select-none", className)} aria-label="Ejemplo: una vecina verifica una clínica desde su celular antes de entrar">
      {/* La burbuja: lo que vio en su celular. */}
      <div className="px-abre sobre-claro relative z-10 w-[17rem] max-w-[85%] rounded-2xl border border-line bg-paper p-3.5 text-ink shadow-dialog sm:w-[18.5rem]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta font-semibold text-inkSoft">Un centro médico de Lima</span>
          <Ejemplo />
        </div>
        <ul className="mt-2.5 space-y-2">
          {chequeos.map((c, i) => (
            <li key={c.texto} className="px-aparece flex items-start gap-2.5" style={{ animationDelay: `${1250 + i * 380}ms` }}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
                <Pixel nombre={c.icono} escala={c.icono === "chequeo" ? 2.5 : 2} acento="accion" animado={false} />
              </span>
              <span className="min-w-0">
                <span className="block text-dato font-semibold leading-snug text-ink">{c.texto}</span>
                <span className="block text-rotulo leading-snug text-mute">{c.detalle}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* La cola de la burbuja: tres cuadros que bajan hacia el celular. */}
      <div aria-hidden className="px-abre relative z-10 ml-[3.25rem] mt-1.5 flex flex-col items-start gap-1">
        <span className="h-2.5 w-2.5 bg-paper" />
        <span className="ml-1 h-2 w-2 bg-paper" />
        <span className="ml-2 h-1.5 w-1.5 bg-paper" />
      </div>

      {/* La calle: la vecina a la izquierda, la clínica a la derecha, sobre el mismo suelo. */}
      <div aria-hidden className="relative -mt-2 flex items-end justify-between gap-2">
        <div className="px-baja relative z-[1] pl-2 sm:pl-4">
          <Pixel nombre="vecina" escala={6} className="h-auto w-[4.5rem] sm:w-24" />
        </div>
        <div className="px-sube">
          <Pixel nombre="clinica" escala={7} retardo={700} className="h-auto w-[12.5rem] sm:w-[15rem]" />
        </div>
      </div>
      <div aria-hidden className="h-1.5 border-t-[6px] border-dashed border-[rgb(var(--px-linea)/0.3)]" />
    </figure>
  );
}
