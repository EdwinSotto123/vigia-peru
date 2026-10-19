"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * Enlace de navegación que pide la página sólo cuando hay intención de abrirla: al pasar el mouse, al enfocarla con el
 * teclado o al tocarla. Un <Link> común la pide apenas se ve, y los menús (cabecera, barra lateral, pie) tienen ~15:
 * cada página abierta disparaba ~10 renders de otras páginas en el servidor (con sus consultas a la API) que en el
 * celular competían con lo que se estaba cargando. Medido 2026-10-18: 0,5–1,1 s cada uno en la red del celular.
 */
export function LinkIntencion({ href, onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const destino = typeof href === "string" ? href : null;
  const pedir = () => {
    if (destino) router.prefetch(destino);
  };
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        pedir();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        pedir();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        pedir();
        onTouchStart?.(e);
      }}
    />
  );
}
