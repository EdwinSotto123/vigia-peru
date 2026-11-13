"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EVENTO_ACTIVA } from "@/components/patrones/Pestanas";

/**
 * La cabecera de una ficha (entidad, región, partido) sabe qué pestaña está abierta (la que manda el servidor y, después,
 * la que avisa `Pestanas` al cambiar, sin recargar): fuera de la primera lleva `data-compacta` y se pliega al nombre.
 * `EncabezadoPagina` esconde su bajada, sus acciones y su placa, y pone el título en una línea; `BanderasFicha` cambia el
 * panel por UNA línea que se abre (las dos con `group-data-[compacta]/ficha:`). Pedido del dueño del 2026-11-13: con la
 * cabecera y las cifras completas arriba de cada pestaña, la lista empezaba a media pantalla (en el celular, debajo de la
 * primera).
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
