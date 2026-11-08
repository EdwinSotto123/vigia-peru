"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useSesion } from "@/components/gobserva/cuenta/comun";
import { useProductoApp } from "@/components/gobserva/app/contexto";
import { ErrorCuenta, cargarSeguimiento, claveSeguimiento, guardar, quitarGuardado, seguidoDe, type EstadoGuardado, type ItemSeguimiento, type ProductoSeguido } from "@/lib/gobserva-cuenta";

export type TipoSeguido = "oportunidad" | "menor" | "plaza";

/**
 * Lo que sigues, desde tu cuenta (GET /gobserva/cuenta/seguimiento): la misma lista que el tablero de Seguimiento, el
 * Calendario, el Inicio y las notificaciones (la misma clave de SWR, así un cambio aquí se ve allá al toque). Seguir,
 * cambiar de etapa y anotar escriben en la cuenta (PUT/DELETE /guardados), con el cambio visible antes de que responda y
 * deshecho si falla. Sirve para licitaciones («oportunidad») y contratos menores («menor») en Licitaciones, y para las
 * plazas CAS («plaza») en Empleo: el producto es el de la app en la que estás, salvo que se pida otro.
 */
export function useSeguimiento(pedido?: ProductoSeguido) {
  const { conCuenta } = useSesion();
  const app = useProductoApp();
  const producto = pedido ?? seguidoDe(app);
  const swr = useSWR(conCuenta ? claveSeguimiento(producto) : null, () => cargarSeguimiento(producto), { revalidateOnFocus: true });
  const porClave = useMemo(() => new Map((swr.data?.data ?? []).map((i) => [`${i.tipo}:${i.ref}`, i])), [swr.data]);
  const porRef = useMemo(() => new Map((swr.data?.data ?? []).filter((i) => i.tipo === "oportunidad").map((i) => [i.ref, i])), [swr.data]);

  /** Aplica un cambio en la lista en pantalla, lo manda y, si falla, vuelve a la lista de antes y lanza el error. */
  async function cambiar(local: (xs: ItemSeguimiento[]) => ItemSeguimiento[], remoto: () => Promise<unknown>) {
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

  const es = (x: ItemSeguimiento, tipo: TipoSeguido, ref: string) => x.tipo === tipo && x.ref === ref;
  const nuevo = (tipo: TipoSeguido, ref: string, titulo: string | null, estado: EstadoGuardado = "guardada", nota: string | null = null): ItemSeguimiento => {
    const ahora = new Date().toISOString();
    return { tipo, ref, titulo, estado, nota, creado: ahora, actualizado: ahora, entidad: null, entidadRuc: null, valor: null, region: null, etapa: null, plazos: [], proximo: null };
  };
  const enviar = (tipo: TipoSeguido, ref: string, titulo: string | null, extra: { estado?: EstadoGuardado; nota?: string }) =>
    guardar({ producto, tipo, ref, titulo: titulo?.slice(0, 300) ?? undefined, ...extra });
  const conCambio = (tipo: TipoSeguido, ref: string, titulo: string | null, cambio: Partial<ItemSeguimiento>) => (xs: ItemSeguimiento[]) =>
    xs.some((x) => es(x, tipo, ref)) ? xs.map((x) => (es(x, tipo, ref) ? { ...x, ...cambio } : x)) : [...xs, { ...nuevo(tipo, ref, titulo), ...cambio }];

  return {
    ...swr,
    producto,
    porRef,
    item: (tipo: TipoSeguido, ref: string) => porClave.get(`${tipo}:${ref}`),
    seguir: (ref: string, titulo: string | null, tipo: TipoSeguido = "oportunidad") =>
      cambiar((xs) => [...xs.filter((x) => !es(x, tipo, ref)), nuevo(tipo, ref, titulo)], () => enviar(tipo, ref, titulo, { estado: "guardada" })),
    dejar: (ref: string, tipo: TipoSeguido = "oportunidad") => cambiar((xs) => xs.filter((x) => !es(x, tipo, ref)), () => quitarGuardado(producto, tipo, ref)),
    etapa: (ref: string, titulo: string | null, estado: EstadoGuardado, tipo: TipoSeguido = "oportunidad") =>
      cambiar(conCambio(tipo, ref, titulo, { estado }), () => enviar(tipo, ref, titulo, { estado })),
    anotar: (ref: string, titulo: string | null, nota: string, tipo: TipoSeguido = "oportunidad") =>
      cambiar(conCambio(tipo, ref, titulo, { nota }), () => enviar(tipo, ref, titulo, { nota })),
  };
}
