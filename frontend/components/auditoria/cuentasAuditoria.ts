/**
 * Las cuentas del estado global de la auditoría, a partir de GET /procesamientos/resumen.
 * Módulo plano (sin "use client"): lo usan la página (servidor, para el conteo de la
 * pestaña En curso) y los componentes que sondean el resumen (cliente). Una sola fuente:
 * las cifras de arriba, la barra del ciclo y el conteo de la pestaña no pueden discrepar.
 *
 *  · `procesado` se parte en "con dictamen publicado" (procesado − revisión) y "financiados
 *    en revisión": son doce de esos 33, no doce más. Sumarlos era el doble conteo de antes.
 *  · "En espera" es la misma palabra y el mismo número que el rótulo del grupo del tablero
 *    (esperan documentos + en cola + con error + sin análisis aplicable).
 */

import type { ResumenProcesamientoVivo } from "@/lib/contratos";
import { listaY, numero } from "@/lib/formato";

export interface Tramo {
  clave: string;
  label: string;
  value: number;
  /** Clase de relleno (token). */
  color: string;
  /** Qué es, para el ⓘ de la barra. */
  titulo: string;
}

export interface CuentasAuditoria {
  esperando: number;
  cola: number;
  conError: number;
  sinAnalisis: number;
  procesando: number;
  leidos: number;
  enRevision: number;
  publicados: number;
  enEspera: number;
  financiados: number;
  /** Los estados con al menos un contrato, en el orden del ciclo. */
  tramos: Tramo[];
}

export function cuentasAuditoria(data: ResumenProcesamientoVivo): CuentasAuditoria {
  const e = data.porEstado ?? {};
  const esperando = e.esperando_documentos ?? 0;
  const cola = e.encolado ?? 0;
  const conError = e.error ?? 0;
  const sinAnalisis = e.pendiente_de_procesamiento ?? 0;
  const procesando = e.procesando ?? 0;
  const leidos = e.procesado ?? 0;
  const enRevision = data.enRevision ?? e.revision ?? 0;
  // `revision` NO es un estado aparte en la base: es `procesado` con la alerta bloqueada por
  // la autoevaluación. Restarlo es lo que impide contar los mismos contratos dos veces.
  const publicados = Math.max(0, leidos - enRevision);
  const enEspera = esperando + cola + conError + sinAnalisis;

  // Orden cronológico del ciclo: llega → espera documentos → espera turno → lo leen →
  // lo revisa una persona → se publica. Los dos estados excepcionales van al final.
  const tramos: Tramo[] = [
    // Sin "lote nocturno": es el diseño (backend/dispatcher/README.md), pero los pedidos
    // pendientes pueden pasar días sin que nadie los tome. Se dice sólo lo que siempre es cierto.
    { clave: "esperando", label: "esperan documentos", value: esperando, color: "bg-mute",
      titulo: "Sus documentos del SEACE todavía no se descargaron. Se bajan desde una conexión en Perú, porque el SEACE bloquea los servidores en la nube." },
    { clave: "cola", label: "en cola", value: cola, color: "bg-inkSoft",
      titulo: "Con documentos listos, esperando turno. El turno es automático, por antigüedad." },
    { clave: "procesando", label: "en análisis", value: procesando, color: "bg-amber",
      titulo: "Los agentes los están leyendo en este momento." },
    // "Financiados en revisión" (§10.1): esta barra sólo conoce lo financiado.
    { clave: "revision", label: "en revisión", value: enRevision, color: "bg-clay",
      titulo: "Leídos, pero la autoevaluación no alcanzó el mínimo: una persona lo revisa antes de publicarlo." },
    { clave: "publicado", label: "con dictamen publicado", value: publicados, color: "bg-moss",
      titulo: "Dictamen público, con cada señal citando norma y evidencia." },
    // Error de SISTEMA = crimson (DESIGN_SYSTEM.md §3.7); rust es la severidad alta de una señal.
    { clave: "error", label: "con error", value: conError, color: "bg-crimson",
      titulo: "El análisis falló y se reintenta solo, hasta tres veces." },
    { clave: "pendiente", label: "sin análisis aplicable", value: sinAnalisis, color: "bg-paperEdge",
      titulo: "De un tipo o una etapa de contrato que todavía no se analiza." },
  ].filter((t) => t.value > 0);

  return {
    esperando,
    cola,
    conError,
    sinAnalisis,
    procesando,
    leidos,
    enRevision,
    publicados,
    enEspera,
    financiados: tramos.reduce((s, t) => s + t.value, 0),
    tramos,
  };
}

/** De qué está hecho "en espera", en palabras. Un solo motivo: "todos esperan sus documentos". */
export function composicionEspera({ esperando, cola, conError, sinAnalisis }: CuentasAuditoria): string {
  const partes = [
    { n: esperando, corta: "esperan documentos", todos: "esperan sus documentos" },
    { n: cola, corta: "en cola", todos: "esperan turno en la cola" },
    { n: conError, corta: "con error", todos: "esperan un reintento" },
    { n: sinAnalisis, corta: "sin análisis aplicable", todos: "esperan un análisis aplicable" },
  ].filter((p) => p.n > 0);
  if (partes.length === 0) return "ninguno esperando";
  if (partes.length === 1) return partes[0].n === 1 ? partes[0].todos.replace(/^esperan/, "espera") : `todos ${partes[0].todos}`;
  return listaY(partes.map((p) => `${numero(p.n)} ${p.corta}`));
}
