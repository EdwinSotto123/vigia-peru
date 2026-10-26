import type { FasesMap, Procesamiento } from "@/lib/auditoria";
import type { AnalisisPublicado } from "@/components/convocatoria/analisisPublicados";
import { esAlertaDemo } from "@/lib/semillas";

/**
 * Tipos y conversiones de «Últimas lecturas» del Inicio (sin "use client": los usa el servidor y el cliente).
 *
 * Un solo bloque con dos fuentes que antes eran dos bloques con 4 de 6 contratos repetidos («Lo último que se leyó»
 * abría un panel, «Lo último que Vigía marcó» llevaba a otra página, con datos distintos para el mismo contrato):
 *   · la cola de lectura (`/financiamiento/procesamientos?estado=procesado`): lo financiado, también lo que quedó en
 *     revisión humana, con quién lo financió y su comprobante;
 *   · los análisis publicados (`/alertas/analizadas?orden=reciente`): toda lectura publicada, por cualquier vía, con sus
 *     señales por severidad.
 * Se juntan por OCID: lo publicado manda en la severidad y la cola aporta quién financió.
 */

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

/** Un contrato que terminó de leerse. */
export interface FilaLectura {
  ocid: string;
  titulo: string | null;
  entidad: string | null;
  /** La región o zona del contrato, tal como la trae su fuente. */
  lugar: string | null;
  /** Cuándo terminó de leerse (ISO). */
  fecha: string | null;
  score: number | null;
  /** Señales publicadas; `null` si no se sabe (alerta sin publicar). */
  banderas: number | null;
  /** Las señales publicadas por severidad (sólo de los análisis publicados). */
  porSeveridad: { alta: number; media: number; baja: number } | null;
  /** La alerta espera revisión humana: se dice «En revisión» y nada más (§10.4). */
  enRevision: boolean;
  /** La lectura terminó y su alerta se descartó: no hay nada que publicar. */
  descartada: boolean;
  /** Valor referencial de la convocatoria (lo trae la cola). */
  valorReferencial: number | null;
  /** Monto adjudicado (lo trae el análisis publicado). */
  montoAdjudicado: number | null;
  /** Quién financió la lectura, si se leyó por la cola. */
  financiador: string | null;
  /** Código del comprobante del aporte que la pagó. */
  comprobante: string | null;
}

export interface FotoVivo {
  enAnalisis: FilaVivo[];
  /** Cuántos contratos están en análisis en total (la lista trae sólo los primeros). */
  totalEnAnalisis: number;
  /** `false` si el resumen de la cola no respondió: no se sabe si hay algo en análisis ahora. */
  vivoConocido: boolean;
  /** Las últimas lecturas terminadas, la más reciente primero. */
  lecturas: FilaLectura[];
}

export function aFilaVivo(a: Record<string, any>): FilaVivo {
  return {
    ocid: String(a.ocid), titulo: a.titulo ?? null, zona: a.zona ?? null, financiador: a.financiador ?? null,
    faseActual: a.faseActual ?? null, faseIndex: a.faseIndex ?? null, fases: a.fases ?? null, desdeSeg: Number(a.desdeSeg) || 0,
  };
}

/** Una fila de la cola de lectura ya procesada. */
export function deProcesamiento(p: Procesamiento): FilaLectura {
  // Publicada = `activa` o `confirmada` (la función SQL `alerta_publicada`); sin alerta, el API no manda estado.
  const publicada = p.alertaEstado == null || p.alertaEstado === "activa" || p.alertaEstado === "confirmada";
  return {
    ocid: p.ocid,
    titulo: p.titulo,
    entidad: p.entidad,
    lugar: p.zona || null,
    fecha: p.finalizadoAt,
    score: p.score,
    banderas: publicada ? p.banderas ?? 0 : null,
    porSeveridad: null,
    enRevision: p.alertaEstado === "revision",
    descartada: p.alertaEstado === "descartada",
    valorReferencial: p.montoPen,
    montoAdjudicado: null,
    financiador: p.financiador || null,
    comprobante: p.contribucionCodigo || null,
  };
}

/** Sólo análisis reales: nunca las alertas de demo sembradas ni filas sin OCID o sin fecha de análisis. */
export const esAnalisisReal = (it: unknown): it is AnalisisPublicado => {
  const a = it as AnalisisPublicado | null;
  return !!a && !esAlertaDemo(a) && !!a.ocid && !!a.analizado_en;
};

/** Una fila de los análisis publicados. */
export function deAnalisis(a: AnalisisPublicado): FilaLectura {
  return {
    ocid: a.ocid,
    titulo: a.objeto ?? null,
    entidad: a.entidad ?? null,
    lugar: a.region ?? null,
    fecha: a.analizado_en,
    score: a.score ?? null,
    banderas: a.n_banderas ?? 0,
    porSeveridad: { alta: a.n_alta ?? 0, media: a.n_media ?? 0, baja: a.n_baja ?? 0 },
    enRevision: false,
    descartada: false,
    valorReferencial: null,
    montoAdjudicado: a.monto && a.monto > 0 ? a.monto : null,
    financiador: null,
    comprobante: null,
  };
}

const tiempo = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/** Dos filas del mismo contrato: lo publicado (`a`) manda en la severidad; la cola (`b`) aporta quién financió. */
function combinar(a: FilaLectura, b: FilaLectura): FilaLectura {
  return {
    ocid: a.ocid,
    titulo: a.titulo ?? b.titulo,
    entidad: a.entidad ?? b.entidad,
    lugar: a.lugar ?? b.lugar,
    fecha: tiempo(a.fecha) >= tiempo(b.fecha) ? a.fecha ?? b.fecha : b.fecha,
    score: a.score ?? b.score,
    banderas: a.banderas ?? b.banderas,
    porSeveridad: a.porSeveridad ?? b.porSeveridad,
    enRevision: a.enRevision || b.enRevision,
    descartada: a.descartada || b.descartada,
    valorReferencial: a.valorReferencial ?? b.valorReferencial,
    montoAdjudicado: a.montoAdjudicado ?? b.montoAdjudicado,
    financiador: a.financiador ?? b.financiador,
    comprobante: a.comprobante ?? b.comprobante,
  };
}

/**
 * Las últimas lecturas de varias fuentes en una sola lista, sin repetir contratos, la más reciente primero. La primera
 * fuente manda (los análisis publicados); las siguientes completan lo que le falta.
 */
export function unirLecturas(fuentes: FilaLectura[][], max = 6): FilaLectura[] {
  const porOcid = new Map<string, FilaLectura>();
  for (const fuente of fuentes) {
    for (const f of fuente) {
      const previa = porOcid.get(f.ocid);
      porOcid.set(f.ocid, previa ? combinar(previa, f) : f);
    }
  }
  return [...porOcid.values()].sort((x, y) => tiempo(y.fecha) - tiempo(x.fecha)).slice(0, max);
}
