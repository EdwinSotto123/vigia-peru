"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FILTROS_POR_DEFECTO, aParams, cambiar, leerFiltros, type FiltrosBandeja } from "./filtros";

/**
 * El estado de una lista en la URL: los filtros se leen de ella y cada cambio la escribe (con `push`, así el botón Atrás
 * vuelve al filtro anterior). Todo cambio que no sea de página vuelve a la 1. El cambio corre en una transición: mientras
 * llega la nueva página del servidor, `pendiente` está en true y los resultados se atenúan con aria-busy.
 *
 * Un solo proveedor por lista (ProveedorLista) para que la barra de filtros, los chips, el orden, la paginación y los
 * resultados compartan el mismo `pendiente`.
 */
interface Lista {
  filtros: FiltrosBandeja;
  pendiente: boolean;
  /** Cambia filtros (vuelve a la página 1 salvo que se cambie `pag`). */
  ir: (cambios: Partial<FiltrosBandeja>) => void;
  /** Aplica una búsqueda entera (una búsqueda guardada): `q=toner&tipo=bienes`. */
  aplicar: (query: string) => void;
  limpiar: () => void;
  /** La búsqueda actual como URL, sin «?» ni la página. */
  query: string;
}

const Contexto = createContext<Lista | null>(null);

export function ProveedorLista({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pendiente, iniciar] = useTransition();
  const deLaUrl = useMemo(() => leerFiltros(new URLSearchParams(sp.toString())), [sp]);
  // Lo elegido se ve al toque (la casilla marcada, el chip nuevo) mientras llega la página; cuando la URL cambia, manda
  // la URL. Dos clics seguidos se suman: cada cambio parte de lo que ya se ve.
  const [optimista, setOptimista] = useState<FiltrosBandeja | null>(null);
  useEffect(() => setOptimista(null), [sp]);
  const filtros = optimista ?? deLaUrl;

  const navegar = useCallback(
    (qs: string) => {
      // El camino del navegador, no el reescrito por el middleware («/licitaciones/app/…» en el servidor).
      const camino = window.location.pathname;
      iniciar(() => router.push(qs ? `${camino}?${qs}` : camino, { scroll: false }));
    },
    [router],
  );

  const valor = useMemo<Lista>(() => {
    const sinPagina = aParams({ ...filtros, pag: 1 }).toString();
    return {
      filtros,
      pendiente,
      ir: (cambios) => {
        const sig = cambiar(filtros, cambios);
        setOptimista(sig);
        navegar(aParams(sig).toString());
      },
      aplicar: (query) => {
        const sig = leerFiltros(new URLSearchParams(query));
        setOptimista(sig);
        navegar(aParams(sig).toString());
      },
      limpiar: () => {
        const sig = { ...FILTROS_POR_DEFECTO, orden: filtros.orden, tam: filtros.tam };
        setOptimista(sig);
        navegar(aParams(sig).toString());
      },
      query: sinPagina,
    };
  }, [filtros, pendiente, navegar]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useLista(): Lista {
  const v = useContext(Contexto);
  if (!v) throw new Error("useLista va dentro de <ProveedorLista>.");
  return v;
}
