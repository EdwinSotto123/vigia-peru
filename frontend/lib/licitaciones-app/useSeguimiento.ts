"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useSesion } from "@/components/gobserva/cuenta/comun";
import { ErrorCuenta, cargarSeguimiento, guardar, quitarGuardado, type EstadoGuardado, type ItemSeguimiento } from "@/lib/gobserva-cuenta";

/**
 * Lo que sigues, desde tu cuenta (GET /gobserva/cuenta/seguimiento): la misma lista que el tablero de Seguimiento, el
 * Calendario y el Inicio (la misma clave de SWR, así un cambio aquí se ve allá al toque). Seguir, cambiar de etapa y
 * anotar escriben en la cuenta (PUT/DELETE /guardados), con el cambio visible antes de que responda y deshecho si falla.
 */
export function useSeguimiento() {
  const { conCuenta } = useSesion();
  const swr = useSWR(conCuenta ? ["gobserva-seguimiento"] : null, () => cargarSeguimiento(), { revalidateOnFocus: true });
  const porRef = useMemo(() => new Map((swr.data?.data ?? []).filter((i) => i.tipo === "oportunidad").map((i) => [i.ref, i])), [swr.data]);

  /** Aplica un cambio en la lista en pantalla, lo manda y, si falla, vuelve a la lista de antes y lanza el error. */
  async function cambiar(ref: string, local: (xs: ItemSeguimiento[]) => ItemSeguimiento[], remoto: () => Promise<unknown>) {
    const antes = swr.data;
    await swr.mutate({ data: local(antes?.data ?? []) }, { revalidate: false });
    try {
      await remoto();
      void swr.mutate();
    } catch (e) {
      await swr.mutate(antes, { revalidate: false });
      throw e instanceof ErrorCuenta ? e : new ErrorCuenta(500, "error", "No pudimos guardarlo ahora. Vuelve a intentarlo.");
    }
  }

  const nuevo = (ref: string, titulo: string | null, estado: EstadoGuardado = "guardada", nota: string | null = null): ItemSeguimiento => {
    const ahora = new Date().toISOString();
    return { tipo: "oportunidad", ref, titulo, estado, nota, creado: ahora, actualizado: ahora, entidad: null, entidadRuc: null, valor: null, region: null, etapa: null, plazos: [], proximo: null };
  };

  return {
    ...swr,
    porRef,
    seguir: (ref: string, titulo: string | null) =>
      cambiar(ref, (xs) => [...xs.filter((x) => !(x.tipo === "oportunidad" && x.ref === ref)), nuevo(ref, titulo)], () =>
        guardar({ producto: "licitaciones", tipo: "oportunidad", ref, titulo: titulo?.slice(0, 300) ?? undefined, estado: "guardada" }),
      ),
    dejar: (ref: string) => cambiar(ref, (xs) => xs.filter((x) => !(x.tipo === "oportunidad" && x.ref === ref)), () => quitarGuardado("licitaciones", "oportunidad", ref)),
    etapa: (ref: string, titulo: string | null, estado: EstadoGuardado) =>
      cambiar(
        ref,
        (xs) => (xs.some((x) => x.tipo === "oportunidad" && x.ref === ref) ? xs.map((x) => (x.tipo === "oportunidad" && x.ref === ref ? { ...x, estado } : x)) : [...xs, nuevo(ref, titulo, estado)]),
        () => guardar({ producto: "licitaciones", tipo: "oportunidad", ref, titulo: titulo?.slice(0, 300) ?? undefined, estado }),
      ),
    anotar: (ref: string, titulo: string | null, nota: string) =>
      cambiar(
        ref,
        (xs) => (xs.some((x) => x.tipo === "oportunidad" && x.ref === ref) ? xs.map((x) => (x.tipo === "oportunidad" && x.ref === ref ? { ...x, nota } : x)) : [...xs, nuevo(ref, titulo, "guardada", nota)]),
        () => guardar({ producto: "licitaciones", tipo: "oportunidad", ref, titulo: titulo?.slice(0, 300) ?? undefined, nota }),
      ),
  };
}
