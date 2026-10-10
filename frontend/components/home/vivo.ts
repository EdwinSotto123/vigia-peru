import type { FasesMap, Procesamiento } from "@/lib/auditoria";

/** Tipos y conversiones de "se están analizando ahora" (sin "use client": los usa el servidor y el cliente). */

export interface FilaVivo {
  ocid: string;
  titulo: string | null;
  zona: string | null;
  financiador: string | null;
  faseActual: string | null;
  faseIndex: number | null;
  fases: FasesMap | null;
  /** Segundos que llevaba procesándose al momento de la foto. */
  desdeSeg: number;
}
export interface FilaLeida {
  ocid: string;
  titulo: string | null;
  zona: string | null;
  entidad: string | null;
  montoPen: number | null;
  financiador: string | null;
  finalizadoAt: string | null;
  banderas: number;
}
export interface FotoVivo {
  enAnalisis: FilaVivo[];
  /** Cuántos contratos están en análisis en total (la lista trae sólo los primeros). */
  totalEnAnalisis: number;
  ultimosLeidos: FilaLeida[];
}

export function aFilaVivo(a: Record<string, any>): FilaVivo {
  return {
    ocid: String(a.ocid), titulo: a.titulo ?? null, zona: a.zona ?? null, financiador: a.financiador ?? null,
    faseActual: a.faseActual ?? null, faseIndex: a.faseIndex ?? null, fases: a.fases ?? null, desdeSeg: Number(a.desdeSeg) || 0,
  };
}
export function aFilaLeida(p: Procesamiento): FilaLeida {
  return {
    ocid: p.ocid, titulo: p.titulo, zona: p.zona, entidad: p.entidad, montoPen: p.montoPen, financiador: p.financiador,
    finalizadoAt: p.finalizadoAt, banderas: p.banderas ?? 0,
  };
}

