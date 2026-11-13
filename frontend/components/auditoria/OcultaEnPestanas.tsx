"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EVENTO_ACTIVA } from "@/components/patrones/Pestanas";

/**
 * Lo que va encima de las pestañas pero sólo vale para algunas: en Auditoría en vivo, la barra de filtros (zona, fecha,
 * quién pagó, búsqueda) acota En curso y Ya leídos, pero no «Lo que falta leer», que trae sus propios filtros. Se esconde
 * mientras está abierta una de `ocultarEn`: la inicial la dice el servidor y después escucha a `Pestanas`, que avisa
 * cada cambio sin recargar (`EVENTO_ACTIVA`).
 */
export function OcultaEnPestanas({ inicial, ocultarEn, param = "seccion", children }: { inicial: string; ocultarEn: string[]; param?: string; children: ReactNode }) {
  const [activa, setActiva] = useState(inicial);
  useEffect(() => setActiva(inicial), [inicial]);
  useEffect(() => {
    const alCambiar = (e: Event) => {
      const d = (e as CustomEvent<{ param: string; clave: string }>).detail;
      if (d?.param === param) setActiva(d.clave);
    };
    window.addEventListener(EVENTO_ACTIVA, alCambiar);
    return () => window.removeEventListener(EVENTO_ACTIVA, alCambiar);
  }, [param]);
  // Escondida y no desmontada: al volver a En curso, la barra sigue con lo que tenía escrito.
  return <div hidden={ocultarEn.includes(activa)}>{children}</div>;
}
