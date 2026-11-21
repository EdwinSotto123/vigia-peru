import { cn } from "@/lib/utils";
import { Pixel } from "./Pixel";

/**
 * Las escenas chicas de Gobserva Salud, armadas con los sprites de píxeles: siempre decorativas (aria-hidden), porque
 * el texto de al lado ya dice lo que pasa. Server-safe.
 */

/**
 * La vecina buscando dónde está: sobre su cabeza, el alfiler de la ubicación. Mientras el teléfono busca (`buscando`),
 * camina y el alfiler emite un ping; quieta, sólo parpadea. Es lo que de verdad pasa: no simula trabajo.
 */
export function VecinaUbicando({ buscando, escala = 3, className }: { buscando: boolean; escala?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("relative inline-flex flex-col items-center", className)}>
      <div className="relative mb-1">
        {buscando && <span className="px-ping absolute inset-0 m-auto h-full w-full border-2 border-[rgb(var(--marca-acento))]" />}
        <Pixel nombre="alfiler" escala={escala * 0.8} acento="marca" />
      </div>
      <Pixel nombre={buscando ? "vecinaCamina" : "vecina"} escala={escala} />
    </div>
  );
}

/** La vecina con una pregunta: cuando algo no se encontró, no se sabe o falló. */
export function VecinaPregunta({ escala = 3, className }: { escala?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("relative inline-flex items-start", className)}>
      <Pixel nombre="vecina" escala={escala} />
      <Pixel nombre="pregunta" escala={escala * 0.75} className="-ml-1 px-anim px-late" />
    </div>
  );
}

/** La doctora saluda (el brazo sube y baja cuatro veces). Cambiar `clave` la hace saludar de nuevo. */
export function DoctoraSaluda({ escala = 3, className, clave }: { escala?: number; className?: string; clave?: string }) {
  return (
    <div aria-hidden className={cn("inline-flex", className)}>
      <Pixel key={clave} nombre="doctora" escala={escala} />
    </div>
  );
}
