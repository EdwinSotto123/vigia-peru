"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FILTROS_POR_DEFECTO, aParams, leerFiltros, type FiltrosBandeja } from "./filtros";
import { FILTROS_MENORES, aParamsMenores, leerMenores, type FiltrosMenores } from "./filtrosMenores";

/**
 * El estado de una lista en la URL (la bandeja, los contratos menores): los filtros se leen de ella y cada cambio la
 * escribe con `push`, así el botón Atrás vuelve al filtro anterior. Todo cambio que no sea de página vuelve a la 1. El
 * cambio corre en una transición: mientras llega la página nueva del servidor, `pendiente` está en true y los resultados
 * se atenúan con aria-busy. Lo elegido se ve al toque (estado optimista) hasta que la URL cambia.
 *
 * `crearListaUrl` arma un proveedor y su hook para un tipo de filtros; la barra, los chips, el orden, la paginación y los
 * resultados de esa lista comparten el mismo `pendiente`.
 */
export interface Lista<F> {
  filtros: F;
  pendiente: boolean;
  /** Cambia filtros (vuelve a la página 1 salvo que se cambie `pag`). */
  ir: (cambios: Partial<F>) => void;
  /** Aplica una búsqueda entera (una búsqueda guardada): `q=toner&tipo=bienes`. */
  aplicar: (query: string) => void;
  limpiar: () => void;
  /** La búsqueda actual como URL, sin «?» ni la página. */
  query: string;
}

export function crearListaUrl<F extends { pag: number }>(cfg: {
  leer: (sp: URLSearchParams) => F;
  aParams: (f: F) => URLSearchParams;
  defecto: F;
  /** Lo que «Limpiar» conserva (el orden, el tamaño de página). */
  conservar: (keyof F)[];
}) {
  const Contexto = createContext<Lista<F> | null>(null);

  function Proveedor({ children }: { children: ReactNode }) {
    const router = useRouter();
    const sp = useSearchParams();
    const [pendiente, iniciar] = useTransition();
    const deLaUrl = useMemo(() => cfg.leer(new URLSearchParams(sp.toString())), [sp]);
    const [optimista, setOptimista] = useState<F | null>(null);
    useEffect(() => setOptimista(null), [sp]);
    const filtros = optimista ?? deLaUrl;

    const navegar = useCallback(
      (f: F) => {
        setOptimista(f);
        const qs = cfg.aParams(f).toString();
        // El camino del navegador, no el reescrito por el middleware («/licitaciones/app/…» en el servidor).
        const camino = window.location.pathname;
        iniciar(() => router.push(qs ? `${camino}?${qs}` : camino, { scroll: false }));
      },
      [router],
    );

    const valor = useMemo<Lista<F>>(
      () => ({
        filtros,
        pendiente,
        ir: (cambios) => navegar({ ...filtros, ...cambios, pag: cambios.pag ?? 1 }),
        aplicar: (query) => navegar(cfg.leer(new URLSearchParams(query))),
        limpiar: () => navegar({ ...cfg.defecto, ...Object.fromEntries(cfg.conservar.map((k) => [k, filtros[k]])) }),
        query: cfg.aParams({ ...filtros, pag: 1 }).toString(),
      }),
      [filtros, pendiente, navegar],
    );
    return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
  }

  function use(): Lista<F> {
    const v = useContext(Contexto);
    if (!v) throw new Error("Este hook va dentro de su proveedor de lista.");
    return v;
  }

  return { Proveedor, use };
}

const bandeja = crearListaUrl<FiltrosBandeja>({ leer: leerFiltros, aParams, defecto: FILTROS_POR_DEFECTO, conservar: ["orden", "tam"] });
export const ProveedorLista = bandeja.Proveedor;
export const useLista = bandeja.use;

const menores = crearListaUrl<FiltrosMenores>({ leer: leerMenores, aParams: aParamsMenores, defecto: FILTROS_MENORES, conservar: ["orden", "tam"] });
export const ProveedorMenores = menores.Proveedor;
export const useListaMenores = menores.use;
