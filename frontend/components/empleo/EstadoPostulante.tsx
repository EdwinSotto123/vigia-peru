import type { ReactNode } from "react";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { cn } from "@/lib/utils";

/**
 * Un estado vacío, de «no encontrado» o de error de Gobserva Empleo, con el postulante de la portada y su pregunta
 * encima en vez de un ícono: lo mismo que EstadoVacio, VacioCaja y EstadoError (components/gobserva), que sólo aceptan
 * un ícono de lucide. El texto y las acciones son los de cada página. `alerta` lo anuncia (role="alert") cuando es un
 * error. El personaje es decorativo. Server-safe, y también se puede usar desde un componente de cliente.
 */
export function EstadoPostulante({
  titulo,
  texto,
  acciones,
  alerta = false,
  compacto = false,
  className,
}: {
  titulo: string;
  texto?: ReactNode;
  acciones?: ReactNode;
  alerta?: boolean;
  /** Dentro de una caja de la app (como VacioCaja): menos aire y la letra un punto más chica. */
  compacto?: boolean;
  className?: string;
}) {
  return (
    <div role={alerta ? "alert" : undefined} className={cn("flex flex-col items-center px-4 text-center", compacto ? "py-8 sm:py-10" : "py-10 sm:py-14", className)}>
      <PersonajePregunta nombre="postulante" escala={compacto ? 2.5 : 3} />
      <p className={cn("font-semibold text-ink", compacto ? "mt-3 text-dato" : "mt-4 text-cuerpo")}>{titulo}</p>
      {texto && <div className={cn("text-pretty leading-relaxed text-inkSoft", compacto ? "mt-1 max-w-[44ch] text-meta" : "mt-1.5 max-w-[48ch] text-dato")}>{texto}</div>}
      {acciones && <div className={cn("flex flex-wrap justify-center gap-2", compacto ? "mt-4" : "mt-5")}>{acciones}</div>}
    </div>
  );
}
