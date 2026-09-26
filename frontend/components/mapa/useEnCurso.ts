"use client";

import { useEffect, useState } from "react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import type { ResumenProcesamientoVivo } from "@/lib/contratos";
import { numero } from "@/lib/formato";
import { UBIGEO_REGION } from "./region-match";

/**
 * Contratos financiados que ahora mismo se están leyendo o esperan su lectura, por
 * departamento. "En espera" junta el turno en la cola y la espera de documentos: el
 * resumen por departamento no los separa, y partirlo a ojo sería inventar un dato.
 */
export interface EnCurso {
  leyendo: number;
  enEspera: number;
}

/** "3 contratos financiados: 1 leyéndose ahora, 2 en espera". */
export function fraseEnCurso(e: EnCurso): string {
  const partes: string[] = [];
  if (e.leyendo > 0) partes.push(`${numero(e.leyendo)} leyéndose ahora`);
  if (e.enEspera > 0) partes.push(`${numero(e.enEspera)} en espera`);
  const total = e.leyendo + e.enEspera;
  return `${total === 1 ? "1 contrato financiado" : `${numero(total)} contratos financiados`}: ${partes.join(", ")}`;
}

/** Cada cuánto se vuelve a mirar con la pestaña visible. */
const INTERVALO_MS = 60_000;
/** Al volver a la pestaña se refresca, salvo que la última lectura sea muy reciente. */
const FRESCO_MS = 15_000;

/** Desde `porDepartamento` del resumen: activos incluye lo que está en análisis. */
function desdeResumen(por: NonNullable<ResumenProcesamientoVivo["porDepartamento"]>): Record<string, EnCurso> {
  const out: Record<string, EnCurso> = {};
  for (const [ub, v] of Object.entries(por)) {
    if (!UBIGEO_REGION[ub]) continue;
    const leyendo = Math.max(0, Number(v?.procesando) || 0);
    const enEspera = Math.max(0, (Number(v?.activos) || 0) - leyendo);
    if (leyendo + enEspera > 0) out[ub] = { leyendo, enEspera };
  }
  return out;
}

/**
 * COMPAT-API-VIEJA: mientras la API de prod no mande `porDepartamento`, se cuenta sobre la
 * lista del tablero (la que trae el ubigeo). Van primero los activos, así que las 300 filas
 * alcanzan para lo que está en curso. Cuando la API nueva esté en prod, esto se borra.
 */
async function desdeLista(): Promise<Record<string, EnCurso> | null> {
  const l = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos?limit=300`, { cache: "no-store" });
  if (!l.ok) return null;
  const lj = await l.json();
  const por: Record<string, EnCurso> = {};
  for (const p of (lj?.data ?? []) as { ubigeo?: string; estado?: string }[]) {
    const ub = String(p.ubigeo ?? "").slice(0, 2);
    if (!UBIGEO_REGION[ub]) continue;
    const e = (por[ub] ??= { leyendo: 0, enEspera: 0 });
    if (p.estado === "procesando") e.leyendo++;
    else if (p.estado === "encolado" || p.estado === "pendiente_de_procesamiento" || p.estado === "esperando_documentos") e.enEspera++;
  }
  for (const k of Object.keys(por)) if (por[k].leyendo + por[k].enEspera === 0) delete por[k];
  return por;
}

/**
 * Dónde se está leyendo AHORA, por departamento (2 dígitos). Sólo datos reales:
 * si no hay nada en curso, el objeto queda vacío y no late nada en el mapa. Se
 * refresca cada minuto y sólo con la pestaña visible (al volver a ella, enseguida);
 * sin conexión no se marca nada, porque un pulso inventado sería peor que ninguno.
 */
export function useEnCurso(): Record<string, EnCurso> {
  const [enCurso, setEnCurso] = useState<Record<string, EnCurso>>({});

  useEffect(() => {
    let vivo = true;
    let ultima = 0;
    let enVuelo = false;
    const cargar = async () => {
      if (enVuelo) return;
      enVuelo = true;
      ultima = Date.now();
      try {
        const r = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-store" });
        if (!r.ok) return;
        const res = (await r.json()) as Partial<ResumenProcesamientoVivo>;
        if (res.porDepartamento && typeof res.porDepartamento === "object") {
          if (vivo) setEnCurso(desdeResumen(res.porDepartamento));
          return;
        }
        const pe: Record<string, number> = res.porEstado ?? {};
        const vivos = (pe.procesando ?? 0) + (pe.encolado ?? 0) + (pe.pendiente_de_procesamiento ?? 0) + (pe.esperando_documentos ?? 0);
        if (vivos <= 0) {
          if (vivo) setEnCurso({});
          return;
        }
        const por = await desdeLista();
        if (vivo && por) setEnCurso(por);
      } catch {
        // Sin conexión: no se marca nada.
      } finally {
        enVuelo = false;
      }
    };
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    if (visible()) void cargar();
    const t = window.setInterval(() => {
      if (visible()) void cargar();
    }, INTERVALO_MS);
    const alVolver = () => {
      if (visible() && Date.now() - ultima > FRESCO_MS) void cargar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  return enCurso;
}
