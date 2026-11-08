import Link from "next/link";
import { Bell, BellPlus, CalendarDays, KanbanSquare, type LucideIcon } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

export interface Vista {
  clave: string;
  /** Dentro del producto: «/cuenta?tab=calendario», «/app/notificaciones». */
  ruta: string;
  etiqueta: string;
  Icono?: LucideIcon;
}

/**
 * Las vistas de una sección de la app, bajo su título (2026-11-08, «ordenar mejor»): lo que antes eran entradas sueltas
 * de la barra lateral. «Tablero | Calendario» en Postulaciones y «Recibidos | Mis alertas» en Avisos. Server-safe.
 */
export function Vistas({ base, vistas, actual, etiqueta }: { base: string; vistas: Vista[]; actual: string; etiqueta: string }) {
  return (
    <nav aria-label={etiqueta} className="mt-5">
      <ul className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-ink/[0.06] p-1 [scrollbar-width:none]">
        {vistas.map((v) => {
          const activa = v.clave === actual;
          const Icono = v.Icono;
          return (
            <li key={v.clave} className="shrink-0">
              <Link
                href={rutaEn(base, v.ruta)}
                aria-current={activa ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-dato font-semibold transition-colors duration-rapido",
                  activa ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                )}
              >
                {Icono && <Icono size={15} aria-hidden className={activa ? "text-granate" : "text-mute"} />}
                {v.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Postulaciones de Empleo: el tablero (por etapa) y el calendario (por fecha). */
export const POSTULACIONES = {
  titulo: "Postulaciones",
  bajada: "Las plazas que guardaste: por etapa en el tablero y por fecha en el calendario.",
  etiqueta: "Vistas de tus postulaciones",
  vistas: [
    { clave: "seguimiento", ruta: "/cuenta?tab=seguimiento", etiqueta: "Tablero", Icono: KanbanSquare },
    { clave: "calendario", ruta: "/cuenta?tab=calendario", etiqueta: "Calendario", Icono: CalendarDays },
  ] satisfies Vista[],
};

/** Avisos de Empleo: lo que te avisamos y las búsquedas que vigilamos por ti. */
export const AVISOS = {
  titulo: "Avisos",
  bajada: "Lo que te avisamos (plazas nuevas y cierres) y las búsquedas que vigilamos por ti.",
  etiqueta: "Vistas de tus avisos",
  vistas: [
    { clave: "recibidos", ruta: "/app/notificaciones", etiqueta: "Recibidos", Icono: Bell },
    { clave: "alertas", ruta: "/cuenta?tab=alertas", etiqueta: "Mis alertas", Icono: BellPlus },
  ] satisfies Vista[],
};
