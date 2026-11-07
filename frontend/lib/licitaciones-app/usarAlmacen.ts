"use client";

import { useSyncExternalStore } from "react";
import { VACIO, crearAlmacen, type Almacen, type EstadoUsuario } from "./almacen";

/**
 * El almacén del usuario en el navegador, uno por pestaña, y el hook que lo lee. En el servidor (y antes de hidratar)
 * se ve vacío: lo guardado aparece al montar, sin romper la hidratación.
 */
let almacen: Almacen | null = null;

export function getAlmacen(): Almacen {
  if (!almacen) {
    let guardado: Storage | null = null;
    try {
      guardado = window.localStorage;
    } catch {
      guardado = null;
    }
    almacen = crearAlmacen(guardado);
  }
  return almacen;
}

export function useEstadoUsuario(): EstadoUsuario {
  return useSyncExternalStore(
    (o) => getAlmacen().suscribir(o),
    () => getAlmacen().leer(),
    () => VACIO,
  );
}
