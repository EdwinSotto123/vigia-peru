"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { usePerfilEmpleo } from "@/components/empleo-app/usePerfilEmpleo";
import { etapaDePostular, fechasDe, juzgar, requisitosDeServir, veredicto } from "@/lib/empleo-app/cumplo";
import { diasEntre, hoyEnLima, useBasesPlaza, useResumenPlaza } from "./datosPlaza";

/**
 * Lo que varias piezas de la ficha de una plaza calculan igual (la barra fija de arriba, las pestañas, ¿Puedes postular?
 * y Cómo postular): el veredicto contra tu perfil y la fecha en que se postula. Todo sale de los mismos pedidos (SWR).
 */

export interface PlazaParaCumplir {
  aviso: number;
  formacion: string | null;
  experiencia: string | null;
  especializacion: string | null;
  conocimiento: string | null;
  expGeneral: number | null;
  /** La región de la plaza como la URL («la-libertad»). */
  region: string | null;
  remuneracion: number | null;
}

const NINGUNO: string[] = [];

function leerMarcados(clave: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(clave) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Lo marcado en esta plaza («lo tengo»), en este navegador. Compartido: marcar abajo cambia el veredicto de arriba. En
 * SWR va como lista: su comparación toma dos Set cualesquiera por iguales (no tienen claves) y no avisaría el cambio.
 */
export function useMarcados(aviso: number) {
  const clave = `gobserva-empleo:cumplo:${aviso}`;
  const { data, mutate } = useSWR(["empleo-cumplo-marcados", aviso], () => leerMarcados(clave), { revalidateOnFocus: false, revalidateIfStale: false });
  const lista = data ?? NINGUNO;
  const marcados = useMemo<ReadonlySet<string>>(() => new Set(lista), [lista]);
  const alternar = (k: string) => {
    const n = lista.includes(k) ? lista.filter((x) => x !== k) : [...lista, k];
    try {
      window.localStorage.setItem(clave, JSON.stringify(n));
    } catch {
      /* sin almacenamiento: se marca igual, sin recordarlo */
    }
    void mutate(n, { revalidate: false });
  };
  return { marcados, alternar };
}

/** Cada requisito contra tu perfil (cumplo.ts) y el veredicto, con lo que marcaste. */
export function useCumplo(plaza: PlazaParaCumplir) {
  const { perfil, cargando } = usePerfilEmpleo();
  const resumen = useResumenPlaza(plaza.aviso);
  const bases = useBasesPlaza(plaza.aviso);
  const { marcados, alternar } = useMarcados(plaza.aviso);
  // Los del aviso (ordenados por la IA, o tal cual) y, cuando llegan, lo que las bases piden además.
  const extra = bases.data?.estado === "encontradas" ? (bases.data.lectura?.requisitos_extra ?? []) : [];
  const llaveExtra = extra.join("|");
  const requisitos = useMemo(
    () => [
      ...(resumen.data?.requisitos?.length ? resumen.data.requisitos : requisitosDeServir(plaza)),
      ...extra.map((que) => ({ que, tipo: "bases" as const })),
    ],
    [resumen.data, plaza, llaveExtra],
  );
  const juicios = useMemo(() => juzgar(requisitos, perfil, { expGeneral: plaza.expGeneral }), [requisitos, perfil, plaza.expGeneral]);
  return {
    perfil,
    listo: !cargando && !resumen.isLoading,
    resumen: resumen.data ?? null,
    juicios,
    v: veredicto(juicios, marcados),
    marcados,
    alternar,
  };
}

/** La fecha de hoy en Lima, sólo en el navegador (en el servidor sería la de la compilación). */
export function useHoy() {
  const [hoy, setHoy] = useState<string | null>(null);
  useEffect(() => setHoy(hoyEnLima()), []);
  return hoy;
}

/**
 * Cuándo se postula: la etapa del cronograma de las bases en que se presenta (manda sobre SERVIR) o, sin bases, el
 * cierre de SERVIR. `abre` cuando todavía no empieza.
 */
export function useFechaPostular(aviso: number, fechaFin: string | null) {
  const { data, isLoading } = useBasesPlaza(aviso);
  const hoy = useHoy();
  const lectura = data?.estado === "encontradas" ? data.lectura : null;
  const cronograma = lectura?.cronograma ?? [];
  const ip = etapaDePostular(cronograma);
  const anio = Number((hoy ?? fechaFin ?? "2026").slice(0, 4));
  const fp = ip >= 0 ? fechasDe(cronograma[ip].fecha, anio) : null;
  const hasta = fp?.hasta ?? fechaFin;
  const desde = fp?.desde ?? null;
  return {
    hoy,
    cargando: isLoading,
    lectura,
    cronograma,
    ip,
    anio,
    desde,
    hasta,
    deBases: !!fp,
    /** La fecha de las bases no es la de SERVIR. */
    difiere: !!(fp && fechaFin && fp.hasta !== fechaFin),
    abre: !!(hoy && desde && diasEntre(hoy, desde) > 0),
  };
}

export type TonoFecha = "urgente" | "aviso" | "neutro" | "pasado";

/** «Cierra hoy», «Cierra mañana», «Abre en 5 días», «Ya cerró»: cuánto falta para abrir o cerrar la postulación. */
export function cuandoEs(fecha: string, hoy: string, que: "abre" | "cierra"): { texto: string; tono: TonoFecha } {
  const d = diasEntre(hoy, fecha);
  const verbo = que === "abre" ? "Abre" : "Cierra";
  if (d < 0) return { texto: que === "abre" ? "Ya abrió" : "Ya cerró", tono: "pasado" };
  if (d === 0) return { texto: `${verbo} hoy`, tono: "urgente" };
  if (d === 1) return { texto: `${verbo} mañana`, tono: que === "abre" ? "aviso" : "urgente" };
  return { texto: `${verbo} en ${d} días`, tono: d <= 3 ? "aviso" : "neutro" };
}
