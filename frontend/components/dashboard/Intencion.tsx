"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Color por intención de la navegación: cada pantalla de la app toma el acento de su grupo del menú
 * (Explorar azul, Alertas rojo, Participar lima, Cuenta violeta). El color se define en globals.css
 * (`[data-intencion]`); acá solo se decide cuál toca según la ruta.
 *
 * Aliados toma el color de Participar y Partidos el de Explorar, como sus grupos del menú.
 * Sin intención, el acento es el de siempre y no hay lavado de fondo.
 */
export type Intencion = "explorar" | "alertas" | "participar" | "cuenta";

const RUTAS: [prefijo: string, intencion: Intencion][] = [
  ["/app/mapa", "explorar"],
  ["/region", "explorar"],
  ["/app/contratos", "explorar"],
  ["/app/convocatoria", "explorar"],
  ["/convocatoria", "explorar"],
  ["/app/entidades", "explorar"],
  ["/app/partidos", "explorar"],
  // Mapa de poder (grupo «Quién») y Lo nuevo (Alertas): antes quedaban sin la franja ni el tinte de su grupo.
  ["/app/poder", "explorar"],
  ["/entidad", "explorar"],
  // Empresas y personas contratadas están en Explorar en el menú: antes quedaban sin color.
  ["/app/empresas", "explorar"],
  ["/empresa", "explorar"],
  ["/app/personas", "explorar"],
  ["/app/hallazgos", "alertas"],
  ["/app/alertas", "alertas"],
  ["/app/novedades", "alertas"],
  ["/alerta", "alertas"],
  ["/app/denuncias", "alertas"],
  ["/app/financiar", "participar"],
  ["/app/apoyar", "participar"],
  ["/app/cuanto-cuesta", "participar"],
  ["/app/aliados", "participar"],
  ["/impacto", "participar"],
  ["/reporte", "participar"],
  ["/app/auditoria", "participar"],
  ["/noticia", "participar"],
  ["/app/mi-impacto", "cuenta"],
  ["/app/configuracion", "cuenta"],
];

export function intencionDe(pathname: string): Intencion | undefined {
  if (pathname === "/app") return "participar";
  return RUTAS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1];
}

export function MainConIntencion({ className, children }: { className?: string; children: ReactNode }) {
  const intencion = intencionDe(usePathname() || "");
  return (
    <main id="contenido" tabIndex={-1} data-intencion={intencion} className={cn(className, intencion && "fondo-intencion")}>
      {children}
    </main>
  );
}
