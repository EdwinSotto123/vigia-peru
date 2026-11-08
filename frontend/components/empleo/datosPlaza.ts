"use client";

import useSWR from "swr";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import type { RequisitoPlaza } from "@/lib/empleo-app/cumplo";

/**
 * Lo que la ficha de una plaza pide a la API desde el navegador, compartido por sus piezas (¿Puedes postular?, Qué tienes
 * que hacer, Las bases, el botón «Ver las bases»): con la misma clave de SWR, un solo pedido por plaza.
 */

/** GET /empleo/plazas/:aviso/resumen: el aviso de SERVIR en palabras simples (Haiku, migración 270). */
export interface ResumenPlaza {
  en_una_frase: string;
  a_quien_buscan: string;
  requisitos: RequisitoPlaza[];
  competencias: string[];
  ojo: string[];
}

export type MedioPostulacion = "en_linea" | "correo" | "mesa_de_partes" | "plataforma" | "otro";

export interface LecturaBases {
  funciones: string[];
  requisitos_extra: string[];
  cronograma: { etapa: string; fecha: string; postulas?: boolean }[];
  evaluacion: { etapa: string; como: string }[];
  documentos: string[];
  como_postular: { medio: MedioPostulacion; detalle: string } | null;
  condiciones: string[];
  ojo: string[];
}

/** GET /empleo/plazas/:aviso/bases: las bases encontradas en la web de la entidad, con su copia y su lectura. */
export interface BasesPlaza {
  estado: "encontradas" | "no_encontradas" | "cerrada" | "error";
  pagina: string | null;
  documentos: { titulo: string; url: string; copia: string | null; leido: boolean }[];
  lectura: LecturaBases | null;
  sin_lectura: "tope" | "largas" | "sin_pdf" | "error" | null;
}

async function pedir<T>(ruta: string): Promise<T | null> {
  const r = await fetch(`${PUBLIC_API_BASE}${ruta}`);
  if (!r.ok) return null;
  return (await r.json()) as T;
}

export function useResumenPlaza(aviso: number) {
  return useSWR(["empleo-resumen", aviso], () => pedir<{ resumen?: ResumenPlaza }>(`/empleo/plazas/${aviso}/resumen`).then((x) => x?.resumen ?? null), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
}

export function useBasesPlaza(aviso: number) {
  return useSWR(["empleo-bases", aviso], () => pedir<BasesPlaza>(`/empleo/plazas/${aviso}/bases`), { revalidateOnFocus: false, shouldRetryOnError: false });
}

/** La copia guardada de un documento (nuestra, se puede ver dentro de la ficha) o el original de la entidad. */
export const urlDocumento = (d: BasesPlaza["documentos"][number]) => (d.copia ? `${PUBLIC_API_BASE}${d.copia}` : d.url);

/** El documento que se abre con «Ver las bases»: el que leímos, si no el primero. */
export const documentoPrincipal = (b: BasesPlaza | null | undefined) =>
  b?.estado === "encontradas" ? (b.documentos.find((d) => d.leido) ?? b.documentos[0] ?? null) : null;

/** La fecha de hoy en Lima («2026-11-08»). */
export const hoyEnLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

/** Días entre dos fechas «AAAA-MM-DD». */
export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
