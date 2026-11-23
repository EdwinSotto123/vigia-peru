import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * La pestaña abierta de una ficha (empresa, partido, persona, contrato) como UNA superficie con su cabecera ADENTRO
 * (2026-11-23, el usuario: «secciones que son solo texto sin fondo o forma»): antes el h2 de `CabeceraPestana` y su línea
 * flotaban sobre el fondo de la página y la lista iba en otra caja debajo. Es `.tarjeta`, como `Seccion`: la tabla, las
 * franjas de cifras, los datos clave y las secciones de adentro van sin su propio marco (Tabla, CifrasEnFila, DatosClave).
 * En el celular, menos relleno a los lados: la tabla de adentro ya trae el suyo.
 */
export function SuperficiePestana({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("tarjeta min-w-0 rounded-2xl border border-line bg-paper px-3 py-4 sm:p-5", className)}>{children}</div>;
}
