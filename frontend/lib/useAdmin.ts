"use client";

import useSWR, { mutate, type SWRConfiguration } from "swr";
import { AdminError, adminFetch } from "./admin";

/**
 * Datos del panel admin con caché compartida entre páginas (SWR). Volver a una
 * página ya visitada pinta al instante lo último que se vio y revalida detrás;
 * dos componentes que piden la misma ruta comparten un solo request.
 *
 *   const { data, error, isLoading, mutate } = useAdmin<Operacion>("/operacion", { refreshInterval: 60_000 });
 *
 * `path` es la ruta bajo /api/admin (la misma que recibe `adminFetch`). `null` = no pedir todavía.
 */
/**
 * Precargas que todavía no respondieron. Si la página se monta mientras tanto, su hook se sube a
 * ese mismo pedido en vez de lanzar otro igual. Se borran apenas responden: nunca se sirve una
 * respuesta vieja desde acá (eso es lo que pasaba con `preload()`).
 */
const enVuelo = new Map<string, Promise<unknown>>();

const fetcher = <T,>(path: string) => (enVuelo.get(path) as Promise<T> | undefined) ?? adminFetch<T>(path);

export function useAdmin<T>(path: string | null, opts: SWRConfiguration<T, AdminError> = {}) {
  return useSWR<T, AdminError>(path, fetcher, {
    keepPreviousData: true,
    dedupingInterval: 5_000,
    revalidateOnFocus: true,
    // Sin sesión, sin permiso o sin la fila: reintentar no cambia nada.
    onErrorRetry: (err, _key, _cfg, revalidate, { retryCount }) => {
      if ([401, 403, 404].includes(err.status) || retryCount >= 2) return;
      setTimeout(() => revalidate({ retryCount }), 1_500 * (retryCount + 1));
    },
    ...opts,
  });
}

/**
 * Baja una ruta antes de que se abra la página (al pasar el mouse por un enlace) y la deja en la
 * caché de SWR, como si ya se hubiera visitado: la página pinta eso al instante y, al montarse,
 * revalida detrás (revalidateIfStale). No usa `preload()` de SWR: esa promesa queda guardada hasta
 * que algún hook la consume, así que una precarga de las 10:00 se servía a las 10:30 como nueva.
 * Una vez por ruta cada 30 s: pasar el mouse diez veces no son diez requests.
 */
const precargadas = new Map<string, number>();
export function precargarAdmin(path: string) {
  const antes = precargadas.get(path);
  if (antes && Date.now() - antes < 30_000) return;
  precargadas.set(path, Date.now());
  const pedido = adminFetch(path);
  enVuelo.set(path, pedido);
  const listo = () => {
    if (enVuelo.get(path) === pedido) enVuelo.delete(path);
  };
  pedido.then(listo, listo);
  // Si falla, la caché queda como estaba: la página lo vuelve a pedir y muestra el error ahí.
  mutate(path, pedido, { revalidate: false }).catch(() => {});
}

/**
 * Vuelve a pedir todo lo cacheado cuyo path empieza con alguno de los prefijos (tras publicar,
 * validar, encolar…). Uno solo: `refrescarAdmin("/revision")`; varios: `refrescarAdmin("/revision", "/log")`.
 */
export const refrescarAdmin = (...prefijos: string[]) =>
  mutate((k) => typeof k === "string" && prefijos.some((p) => k.startsWith(p)));

/**
 * Después de una decisión (publicar o descartar una alerta, validar o rechazar un aporte): todo lo
 * que cuenta algo de eso. Sin esto, el Resumen y la bitácora seguían con el número viejo hasta el
 * próximo sondeo. Las claves que no estén en caché (p. ej. /contribuciones para un revisor) no se piden.
 */
export const refrescarTodo = () =>
  refrescarAdmin("/revision", "/operacion", "/resumen", "/log", "/procesamientos", "/contribuciones");
