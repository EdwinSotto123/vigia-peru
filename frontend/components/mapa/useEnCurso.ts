"use client";

import { useEffect, useState } from "react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { numero } from "@/lib/formato";
import { UBIGEO_REGION } from "./region-match";

/** Contratos financiados que ahora mismo se están leyendo o esperan su lectura, por departamento. */
export interface EnCurso {
  leyendo: number;
  enCola: number;
  esperandoDocs: number;
}

/** "3 contratos financiados: 1 leyéndose ahora, 2 en turno para leerse". */
export function fraseEnCurso(e: EnCurso): string {
  const partes: string[] = [];
  if (e.leyendo > 0) partes.push(`${numero(e.leyendo)} leyéndose ahora`);
  if (e.enCola > 0) partes.push(`${numero(e.enCola)} en turno para leerse`);
  if (e.esperandoDocs > 0) partes.push(`${numero(e.esperandoDocs)} esperando sus documentos`);
  const total = e.leyendo + e.enCola + e.esperandoDocs;
  return `${total === 1 ? "1 contrato financiado" : `${numero(total)} contratos financiados`}: ${partes.join(", ")}`;
}

/**
 * Dónde se está leyendo AHORA, por departamento (2 dígitos). Sólo datos reales:
 * si no hay nada en curso, el objeto queda vacío y no late nada en el mapa. Se
 * refresca cada minuto; sin conexión no se marca nada, porque un pulso inventado
 * sería peor que ninguno.
 */
export function useEnCurso(): Record<string, EnCurso> {
  const [enCurso, setEnCurso] = useState<Record<string, EnCurso>>({});

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const r = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-store" });
        if (!r.ok) return;
        const res = await r.json();
        const pe = res?.porEstado ?? {};
        const vivos = (pe.procesando ?? 0) + (pe.encolado ?? 0) + (pe.pendiente_de_procesamiento ?? 0) + (pe.esperando_documentos ?? 0);
        if (vivos <= 0) {
          if (vivo) setEnCurso({});
          return;
        }
        // El resumen trae `activos` sin ubigeo; la lista sí lo trae. Van primero los que se procesan.
        const l = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos?limit=300`, { cache: "no-store" });
        if (!l.ok) return;
        const lj = await l.json();
        const por: Record<string, EnCurso> = {};
        for (const p of (lj?.data ?? []) as { ubigeo?: string; estado?: string }[]) {
          const ub = String(p.ubigeo ?? "").slice(0, 2);
          if (!UBIGEO_REGION[ub]) continue;
          const e = (por[ub] ??= { leyendo: 0, enCola: 0, esperandoDocs: 0 });
          if (p.estado === "procesando") e.leyendo++;
          else if (p.estado === "encolado" || p.estado === "pendiente_de_procesamiento") e.enCola++;
          else if (p.estado === "esperando_documentos") e.esperandoDocs++;
        }
        for (const k of Object.keys(por)) if (por[k].leyendo + por[k].enCola + por[k].esperandoDocs === 0) delete por[k];
        if (vivo) setEnCurso(por);
      } catch {
        // Sin conexión: no se marca nada.
      }
    };
    cargar();
    const t = window.setInterval(cargar, 60_000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, []);

  return enCurso;
}
