"use client";

import useSWR from "swr";
import type { Rol } from "./permisos";

/**
 * La sesión del equipo en el navegador: correo verificado y perfil (lib/permisos.ts). Una sola
 * consulta por sesión, compartida por la navegación y las páginas (misma clave SWR). Es para
 * mostrar u ocultar; quien de verdad deja pasar o no cada acción es el proxy del servidor.
 */
export interface SesionEquipo {
  admin: boolean;
  correo: string | null;
  rol: Rol | null;
  /** Administrador principal (secreto admin-emails): no se puede quitar desde el panel. */
  principal: boolean;
  /** Sólo llega si el perfil es admin. */
  principales?: string[];
}

const SIN_SESION: SesionEquipo = { admin: false, correo: null, rol: null, principal: false };

// Un 503 (perfil sin confirmar) se lanza para que SWR reintente: si se guardara como "sin sesión",
// el panel escondería secciones durante 5 min por un corte de segundos.
const leer = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (r.status === 503) throw new Error("perfil_sin_verificar");
    return (r.ok ? r.json() : SIN_SESION) as Promise<SesionEquipo>;
  });

export function useSesionEquipo() {
  const { data, isLoading } = useSWR("/api/admin/session", leer, { revalidateOnFocus: false, dedupingInterval: 300_000 });
  return { sesion: data ?? null, rol: data?.rol ?? null, cargando: isLoading && !data };
}
