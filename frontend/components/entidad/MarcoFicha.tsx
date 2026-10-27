"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EVENTO_ACTIVA } from "@/components/patrones/Pestanas";

/**
 * La cabecera de la ficha de una entidad sabe qué pestaña está abierta (la que manda el servidor y, después, la que avisa
 * `Pestanas` al cambiar, sin recargar): fuera de la primera lleva `data-compacta` y lo que se quiere esconder en el
 * celular lo hace con `max-sm:group-data-[compacta]/ficha:hidden`. En el celular, con la cabecera y las cifras completas,
 * el primer contrato de la pestaña Contratos quedaba debajo de la primera pantalla.
 */
export function MarcoFicha({ activa, primera, children }: { activa: string; primera: string; children: ReactNode }) {
  const [abierta, setAbierta] = useState(activa);
  // Una navegación que trae otra pestaña del servidor (atrás, adelante) no pasa por el aviso de `Pestanas`.
  const [delServidor, setDelServidor] = useState(activa);
  if (activa !== delServidor) {
    setDelServidor(activa);
    setAbierta(activa);
  }
  useEffect(() => {
    const alCambiar = (e: Event) => {
      const d = (e as CustomEvent<{ param: string; clave: string }>).detail;
      if (d?.param === "seccion") setAbierta(d.clave);
    };
    window.addEventListener(EVENTO_ACTIVA, alCambiar);
    return () => window.removeEventListener(EVENTO_ACTIVA, alCambiar);
  }, []);
  return (
    <div className="group/ficha" data-compacta={abierta !== primera ? "" : undefined}>
      {children}
    </div>
  );
}
