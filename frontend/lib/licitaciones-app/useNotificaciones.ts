"use client";

import { useMemo, useSyncExternalStore } from "react";
import useSWR from "swr";
import { useSesion } from "@/components/gobserva/cuenta/comun";
import { cargarBandeja } from "@/lib/gobserva-cuenta";
import { armarNotificaciones, sinLeer, type Notificacion } from "./notificaciones";
import { useSeguimiento } from "./useSeguimiento";

/**
 * Las notificaciones de la cuenta (lib/licitaciones-app/notificaciones.ts) y cuáles leíste. Las leídas se guardan en el
 * navegador por id (las 400 últimas); el contenido viene siempre de la cuenta. La campana de la cabecera y la página
 * /app/notificaciones usan este hook: lo que marques en una se ve en la otra.
 */
const CLAVE = "gobserva-notificaciones-leidas";
const oyentes = new Set<() => void>();
let cache: Set<string> | null = null;
const VACIO = new Set<string>();

function leer(): Set<string> {
  if (cache) return cache;
  try {
    cache = new Set(JSON.parse(window.localStorage.getItem(CLAVE) ?? "[]") as string[]);
  } catch {
    cache = new Set();
  }
  return cache;
}

function escribir(s: Set<string>) {
  cache = new Set([...s].slice(-400));
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify([...cache]));
  } catch {
    // Sin espacio o sin permiso: quedan leídas mientras dure la pestaña.
  }
  oyentes.forEach((o) => o());
}

export function useNotificaciones() {
  const { conCuenta } = useSesion();
  const seg = useSeguimiento();
  const bandeja = useSWR(conCuenta ? ["gobserva-bandeja", "licitaciones"] : null, () => cargarBandeja("licitaciones"), { revalidateOnFocus: true, refreshInterval: 5 * 60_000 });
  const leidas = useSyncExternalStore(
    (o) => {
      oyentes.add(o);
      return () => oyentes.delete(o);
    },
    leer,
    () => VACIO,
  );
  const lista: Notificacion[] = useMemo(
    () => armarNotificaciones({ seguimiento: seg.data?.data ?? [], envios: bandeja.data?.data ?? [] }),
    [seg.data, bandeja.data],
  );
  return {
    lista,
    leidas,
    cargando: seg.isLoading || bandeja.isLoading,
    error: !!(seg.error || bandeja.error),
    noLeidas: sinLeer(lista, leidas),
    marcar: (id: string) => escribir(new Set([...leer(), id])),
    marcarTodas: () => escribir(new Set([...leer(), ...lista.map((n) => n.id)])),
    reintentar: () => {
      void seg.mutate();
      void bandeja.mutate();
    },
  };
}
