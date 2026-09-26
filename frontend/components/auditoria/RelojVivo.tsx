"use client";

/**
 * El reloj de 1 s del tablero en vivo, aislado en las celdas que lo muestran.
 *
 * Antes el reloj era un `useState` del tablero: cada segundo se volvía a renderizar la
 * tabla entera (hasta 300 filas) para mover tres o cuatro cronómetros. Ahora hay un solo
 * `setInterval` para toda la página (una tienda externa con `useSyncExternalStore`) y lo
 * escuchan sólo estas piezas: la duración de un análisis, la antigüedad de una espera, el
 * paso en curso y los "hace N". El resto de la tabla no se entera del segundo.
 *
 * En el servidor (y en la hidratación) el reloj vale 0: el HTML no lleva cronómetros, así
 * que cada pieza muestra su forma quieta (una fecha) hasta montar.
 */

import { useSyncExternalStore } from "react";
import {
  duracion,
  faseHumana,
  fechaLima,
  haceCuanto,
  relojEdad,
  type FasesMap,
  type Procesamiento,
} from "@/lib/auditoria";

const oyentes = new Set<() => void>();
let ahoraActual = 0;
let intervalo: number | null = null;

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  if (intervalo == null) {
    ahoraActual = Date.now();
    intervalo = window.setInterval(() => {
      ahoraActual = Date.now();
      oyentes.forEach((f) => f());
    }, 1000);
  }
  return () => {
    oyentes.delete(avisar);
    if (oyentes.size === 0 && intervalo != null) {
      window.clearInterval(intervalo);
      intervalo = null;
    }
  };
}

const leer = () => ahoraActual;
const leerEnServidor = () => 0;

/** La hora actual en ms, que avanza de a un segundo. 0 en el servidor y al hidratar. */
export function useAhora(): number {
  return useSyncExternalStore(suscribir, leer, leerEnServidor);
}

/** Cuánto lleva un análisis: "2 min 13 s". Nada hasta montar (no hay hora en el servidor). */
export function TiempoEnAnalisis({ desde, className }: { desde: string; className?: string }) {
  const ahora = useAhora();
  const t = ahora > 0 ? ahora - Date.parse(desde) : NaN;
  if (!Number.isFinite(t) || t <= 0) return null;
  return (
    <span className={className} title="Tiempo en análisis" suppressHydrationWarning>
      {duracion(t)}
    </span>
  );
}

/** Cuánto lleva esperando: un reloj que avanza ("6 días 03:12:05"); en el servidor, la fecha. */
export function EdadEspera({ desde, className, title }: { desde: number; className?: string; title?: string }) {
  const ahora = useAhora();
  return (
    <span className={className} title={title} suppressHydrationWarning>
      {ahora > 0 ? relojEdad(ahora - desde) : fechaLima(desde)}
    </span>
  );
}

/** El paso en curso de un contrato en análisis ("Esperando turno…" depende del reloj). */
export function FaseEnCurso({
  p,
  fases,
  className,
}: {
  p: Pick<Procesamiento, "estado" | "faseActual" | "faseIndex" | "fases" | "iniciadoAt">;
  fases: FasesMap;
  className?: string;
}) {
  const ahora = useAhora();
  return (
    <span className={className} suppressHydrationWarning>
      {faseHumana(p, ahora || undefined, fases)}
    </span>
  );
}

/** "hace 3 min" que avanza solo; con `entreParentesis`, " (hace 3 min)". Nada hasta montar. */
export function HaceVivo({ desde, entreParentesis = false }: { desde: number; entreParentesis?: boolean }) {
  const ahora = useAhora();
  if (ahora <= 0) return null;
  const texto = haceCuanto(Math.max(0, ahora - desde));
  return <>{entreParentesis ? ` (${texto})` : texto}</>;
}
