"use client";

import useSWR from "swr";
import { useSesion } from "@/components/gobserva/cuenta/comun";
import { API_PUBLICA } from "@/lib/api-client";
import { cargarBusquedas } from "@/lib/gobserva-cuenta";
import type { PlazaEmpleo } from "@/lib/empleo";
import { NOMBRE_PERFIL, conQueBuscar, dePerfilQuery, paramsCalce, type PerfilEmpleo } from "@/lib/empleo-app/entrevista";

/** Lo que devuelve GET /empleo/calce (backend/api/src/routes/empleo.ts). */
export interface CalceEmpleo {
  total: number;
  /** Cuántas plazas abiertas piden cada carrera del perfil (con los filtros). */
  porCarrera: { variantes: string[]; n: number }[];
  /** Lo mismo para las carreras que sólo se cuentan (`contar`). */
  otrasCarreras: { variantes: string[]; n: number }[];
  /** Cuántas tienen cada puesto en el título (entre las de tu carrera, si hay). */
  porPalabra: { palabra: string; n: number }[];
  page: number;
  size: number;
  data: PlazaEmpleo[];
}

export async function pedirCalce(query: string): Promise<CalceEmpleo> {
  const r = await fetch(`${API_PUBLICA}/empleo/calce?${query}`);
  if (!r.ok) throw new Error("sin calce");
  return r.json();
}

/**
 * El perfil de quien busca trabajo (la búsqueda «Mi perfil» de su cuenta, que arma el onboarding) y su id para
 * rehacerlo. `perfil` es null si todavía no lo armó.
 */
export function usePerfilEmpleo(activo = true) {
  const { conCuenta } = useSesion();
  const r = useSWR(conCuenta && activo ? ["gobserva-busquedas", "empleo"] : null, () => cargarBusquedas("empleo"), { revalidateOnFocus: false });
  const guardada = r.data?.data.find((b) => b.nombre === NOMBRE_PERFIL) ?? null;
  return {
    ...r,
    cargando: activo && (r.isLoading || (!r.data && !r.error && conCuenta)),
    id: guardada?.id ?? null,
    perfil: guardada ? dePerfilQuery(guardada.query) : null,
  };
}

/** Las plazas que calzan con un perfil (una página: las más afines, por cierre, sueldo o recientes). */
export function useCalceEmpleo(perfil: PerfilEmpleo | null, extra: Record<string, string | number> = {}) {
  const q = perfil && conQueBuscar(perfil) ? paramsCalce(perfil, [], extra).toString() : null;
  return useSWR<CalceEmpleo>(q ? ["empleo-calce", q] : null, () => pedirCalce(q!), { keepPreviousData: true, revalidateOnFocus: false, shouldRetryOnError: false });
}
