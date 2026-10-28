"use client";

/** "Seguir entidad" en la ficha de una entidad. Solo con sesión (sin sesión no aparece). El botón es el de todas las fichas. */

import { SeguirBoton } from "@/components/cuenta/SeguirBoton";

export function SeguirEntidadBoton({ ruc, nombre, className }: { ruc: string; nombre: string; className?: string }) {
  return <SeguirBoton tipo="entidad" id={ruc} nombre={nombre} className={className} />;
}
