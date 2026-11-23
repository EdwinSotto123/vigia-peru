import type { ReactNode } from "react";
import { SuperficiePestana } from "@/components/fichas/SuperficiePestana";

/**
 * Un capítulo de un relato (la historia del dictamen, el proveedor) en su superficie, con su título grande ADENTRO
 * (2026-11-23, el usuario: «secciones que son solo texto sin fondo o forma», «no hay jerarquía»): antes el título y su
 * bajada flotaban sobre el fondo de la página y el contenido iba en otra caja debajo. Es `.tarjeta`: lo de adentro pierde
 * su propio marco. El título es un h3: el h2 del capítulo lo pone CapitulosRelato para el lector de pantalla.
 */
export function EnSuperficie({ titulo, bajada, accion, children }: { titulo: ReactNode; bajada?: ReactNode; accion?: ReactNode; children: ReactNode }) {
  return (
    <SuperficiePestana>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-3xl">
          <h3 className="font-display text-seccion font-bold leading-tight text-ink text-balance">{titulo}</h3>
          {bajada && <p className="mt-1 text-dato leading-snug text-inkSoft text-pretty">{bajada}</p>}
        </div>
        {accion && <div className="min-w-0 max-w-full">{accion}</div>}
      </div>
      {children}
    </SuperficiePestana>
  );
}
