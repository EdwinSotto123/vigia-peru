"use client";

import { useEffect, useState } from "react";

/**
 * Lo que la persona vio hace poco en Gobserva Salud (2026-11-22, auditoría: «no hay memoria: hay que volver a escribir la
 * clínica o el número del médico en cada visita»). Las últimas 12 fichas (establecimientos, colegiaturas y medicamentos),
 * guardadas SÓLO en este dispositivo (localStorage): no viajan a ningún servidor y se borran con un botón. No se guarda
 * lo que se busca con palabras (una necesidad de salud es un dato sensible), sólo las fichas que se abrieron.
 */

export type TipoVisto = "establecimiento" | "medico" | "medicamento";

export interface Visto {
  tipo: TipoVisto;
  ref: string;
  nombre: string;
  /** Una línea: «III-2, Jesús María» o «Tableta, R.S. EE08059». */
  detalle?: string | null;
  /** Cuándo se abrió (ms). */
  en: number;
}

const CLAVE = "gobserva-salud:vistos";
const EVENTO = "gobserva-salud:vistos";
const TOPE = 12;

export function leerVistos(): Visto[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? "[]") as unknown;
    if (!Array.isArray(crudo)) return [];
    return crudo
      .filter((v): v is Visto => !!v && typeof v === "object" && typeof (v as Visto).ref === "string" && typeof (v as Visto).nombre === "string")
      .slice(0, TOPE);
  } catch {
    return [];
  }
}

function escribir(vs: Visto[]) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(vs.slice(0, TOPE)));
  } catch {
    // Sin almacenamiento (ventana privada): no se recuerda nada y la página sigue igual.
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function anotarVisto(v: Omit<Visto, "en">) {
  const resto = leerVistos().filter((x) => !(x.tipo === v.tipo && x.ref === v.ref));
  escribir([{ ...v, en: Date.now() }, ...resto]);
}

export function quitarVisto(tipo: TipoVisto, ref: string) {
  escribir(leerVistos().filter((x) => !(x.tipo === tipo && x.ref === ref)));
}

export function borrarVistos() {
  escribir([]);
}

/** Los vistos, al día (también si se abren fichas en otra pestaña). null hasta montar: el servidor no los conoce. */
export function useVistos(): Visto[] | null {
  const [vs, setVs] = useState<Visto[] | null>(null);
  useEffect(() => {
    const leer = () => setVs(leerVistos());
    leer();
    window.addEventListener(EVENTO, leer);
    window.addEventListener("storage", leer);
    return () => {
      window.removeEventListener(EVENTO, leer);
      window.removeEventListener("storage", leer);
    };
  }, []);
  return vs;
}

// ─── «Guardar» sin cuenta: lo pendiente se completa al volver con la cuenta abierta ────────────────

const PENDIENTE = "gobserva-salud:guardar-pendiente";

export function anotarPendiente(p: { tipo: TipoVisto; ref: string; nombre: string | null }) {
  try {
    localStorage.setItem(PENDIENTE, JSON.stringify({ ...p, en: Date.now() }));
  } catch {
    // Sin almacenamiento: se guarda a mano después de entrar.
  }
}

/** Lo pendiente de esta ficha, si se pidió hace menos de una hora; lo borra al leerlo. */
export function tomarPendiente(tipo: TipoVisto, ref: string): { nombre: string | null } | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDIENTE) ?? "null") as { tipo: string; ref: string; nombre: string | null; en: number } | null;
    if (!p || p.tipo !== tipo || p.ref !== ref) return null;
    localStorage.removeItem(PENDIENTE);
    return Date.now() - p.en < 3600_000 ? { nombre: p.nombre } : null;
  } catch {
    return null;
  }
}
