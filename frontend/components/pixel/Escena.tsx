import type { ReactNode } from "react";
import { Ejemplo } from "@/components/licitaciones/portada/Maquetas";
import { cn } from "@/lib/utils";
import { Pixel } from "./Pixel";
import type { NombreSprite } from "./sprites";

/**
 * Las piezas de una escena de píxeles de Gobserva (el héroe de cada producto, un cierre, un estado vacío): una burbuja
 * con lo que el personaje está viendo, sus renglones y la calle donde están parados. La escena se arma una vez, a pasos
 * (`.px-sube`, `.px-baja`, `.px-abre`, `.px-aparece` de globals.css) y con movimiento reducido queda quieta y a la vista.
 * Las figuras son decorativas (aria-hidden); la burbuja es texto real. Server-safe.
 */

/**
 * La burbuja: una placa clara (también dentro de una banda oscura: `.sobre-claro`) que se abre desde abajo a la
 * izquierda, con una cola de tres cuadros que baja hacia el personaje. `ejemplo` la marca como «Ejemplo».
 */
export function Burbuja({
  titulo,
  ejemplo = true,
  children,
  className,
  cola = "izquierda",
}: {
  titulo?: ReactNode;
  ejemplo?: boolean;
  children: ReactNode;
  className?: string;
  /** Hacia dónde baja la cola: el personaje que «habla» está a la izquierda o a la derecha. */
  cola?: "izquierda" | "derecha";
}) {
  return (
    <div className={cn("relative z-10", className)}>
      <div className={cn("px-abre sobre-claro rounded-2xl border border-line bg-paper p-3.5 text-ink shadow-dialog", cola === "derecha" && "[transform-origin:88%_100%]")}>
        {(titulo || ejemplo) && (
          <div className="flex items-center justify-between gap-2">
            {titulo ? <span className="min-w-0 text-meta font-semibold text-inkSoft">{titulo}</span> : <span />}
            {ejemplo && <Ejemplo />}
          </div>
        )}
        <div className={cn((titulo || ejemplo) && "mt-2.5")}>{children}</div>
      </div>
      <div aria-hidden className={cn("px-abre mt-1.5 flex flex-col gap-1", cola === "izquierda" ? "ml-[3.25rem] items-start" : "mr-[3.25rem] items-end")}>
        <span className="h-2.5 w-2.5 bg-paper" />
        <span className={cn("h-2 w-2 bg-paper", cola === "izquierda" ? "ml-1" : "mr-1")} />
        <span className={cn("h-1.5 w-1.5 bg-paper", cola === "izquierda" ? "ml-2" : "mr-2")} />
      </div>
    </div>
  );
}

/** Un renglón de la burbuja: un ícono de píxeles, el texto y un detalle; aparece en su turno (`orden` 0, 1, 2…). */
export function RenglonBurbuja({
  icono = "chequeo",
  texto,
  detalle,
  orden = 0,
  derecha,
}: {
  icono?: NombreSprite;
  texto: ReactNode;
  detalle?: ReactNode;
  orden?: number;
  /** Algo alineado a la derecha: un monto, un plazo. */
  derecha?: ReactNode;
}) {
  return (
    <div className="px-aparece flex items-start gap-2.5" style={{ animationDelay: `${1250 + orden * 380}ms` }}>
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
        <Pixel nombre={icono} escala={icono === "chequeo" ? 2.5 : 2} acento="accion" animado={false} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-dato font-semibold leading-snug text-ink">{texto}</span>
        {detalle && <span className="block text-rotulo leading-snug text-mute">{detalle}</span>}
      </span>
      {derecha && <span className="shrink-0 text-right text-dato font-semibold tabular-nums text-ink">{derecha}</span>}
    </div>
  );
}

/** La calle: lo que va a la izquierda (el personaje, que llega de arriba) y a la derecha (el lugar, que se dibuja de abajo arriba), sobre su suelo. */
export function Calle({ izquierda, derecha, className }: { izquierda: ReactNode; derecha?: ReactNode; className?: string }) {
  return (
    <div aria-hidden className={className}>
      <div className="relative flex items-end justify-between gap-2">
        <div className="px-baja relative z-[1] pl-2 sm:pl-4">{izquierda}</div>
        {derecha && <div className="px-sube">{derecha}</div>}
      </div>
      <Suelo />
    </div>
  );
}

/** El suelo de píxeles: una franja de cuadros. */
export function Suelo({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-1.5 border-t-[6px] border-dashed border-[rgb(var(--px-linea)/0.3)]", className)} />;
}

/** Un personaje con una pregunta encima: para lo que no se encontró, no se sabe o falló. Decorativo. */
export function PersonajePregunta({ nombre, escala = 3, className }: { nombre: NombreSprite; escala?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("relative inline-flex items-start", className)}>
      <Pixel nombre={nombre} escala={escala} />
      <Pixel nombre="pregunta" escala={escala * 0.75} className="-ml-1 px-anim px-late" />
    </div>
  );
}
