"use client";

import useSWR from "swr";
import { useSesion } from "@/components/gobserva/cuenta/comun";
import { authFetch } from "@/lib/cuentas";

/**
 * La cuenta gratis de Gobserva Salud (2026-11-21): lo guardado (GET/PUT/DELETE /salud/cuenta/guardados, migración 442).
 * Con la cuenta del grupo de Salud en Cognito; sin sesión no se pide nada.
 */

export type TipoGuardado = "establecimiento" | "medico" | "medicamento";

export interface GuardadoSalud {
  tipo: TipoGuardado;
  ref: string;
  nombre: string | null;
  guardadoAl: string;
  // Establecimiento
  ipressNombre: string | null;
  ipressEstado: string | null;
  ipressActivo: boolean | null;
  ipressEnRegistro: boolean | null;
  categoria: string | null;
  distrito: string | null;
  departamento: string | null;
  sanciones: number;
  sancionesNuevas: number;
  cambiosNuevos: number;
  // Medicamento
  medNombre: string | null;
  concentracion: string | null;
  forma: string | null;
  registro: string | null;
  precioMediana: number | null;
  alertas: number;
  alertasNuevas: number;
  // Médico
  comoResponsable: number;
}

export class ErrorCuenta extends Error {
  constructor(public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await authFetch(`/salud/cuenta${ruta}`, init);
  } catch {
    throw new ErrorCuenta("red", "No pudimos conectarnos. Revisa tu internet y vuelve a intentarlo.");
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
  if (!r.ok) throw new ErrorCuenta(j.error ?? `http_${r.status}`, j.detail ?? "No pudimos hacerlo ahora. Vuelve a intentarlo.");
  return j as T;
}

export const cargarGuardados = () => pedir<{ guardados: GuardadoSalud[]; tope: number }>("/guardados");
export const guardar = (tipo: TipoGuardado, ref: string, nombre: string | null) =>
  pedir<{ ok: true }>("/guardados", { method: "PUT", body: JSON.stringify({ tipo, ref, nombre }) });
export const quitar = (tipo: TipoGuardado, ref: string) =>
  pedir<{ ok: true }>(`/guardados?${new URLSearchParams({ tipo, ref })}`, { method: "DELETE" });

/** Lo guardado de la cuenta abierta (una sola lectura compartida por la página: el botón y la lista). */
export function useGuardados() {
  const { user, conCuenta, loading } = useSesion();
  const r = useSWR(conCuenta && user ? ["salud-guardados", user.uid] : null, cargarGuardados, { revalidateOnFocus: true, shouldRetryOnError: false });
  return { ...r, guardados: r.data?.guardados ?? null, conCuenta, cargandoSesion: loading };
}

/** El código como lo guarda la API (para comparar): la IPRESS con 8 cifras, lo demás sin ceros a la izquierda. */
export const refNormal = (tipo: TipoGuardado, ref: string) => (tipo === "establecimiento" ? ref.padStart(8, "0") : ref.replace(/^0+(?=\d)/, ""));
