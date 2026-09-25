"use client";

/**
 * ESTADO DE LECTURA de un contrato: en qué punto está Vigía de haberlo leído.
 *
 * No es severidad. Un contrato "procesado" no es bueno y uno "sin leer" no es
 * sospechoso: son dos ejes independientes, y mezclarlos es exactamente el error
 * que hacía que la lista dijera cosas distintas en el mapa y en la tabla. Por eso
 * este eje NO usa la escala rust/amber/moss de `lib/severidad`, sino el catálogo
 * canónico de cinco estados operativos que ya vive en `ContratoPin.tsx`
 * (COLOR_ESTADO / ESTADO_OPERATIVO_LABEL), el mismo que pinta los puntos del mapa.
 *
 * Lo que este módulo agrega es la traducción desde lo que el API manda por fila
 * (`estadoProcesamiento` del pipeline + `estadoOperativo` del alcance activo) a
 * esos cinco estados, con una frase que explica qué significa y qué falta.
 *
 * En revisión: `GET /contratos` manda `enRevision: true` (con score y señales en
 * null) cuando la autoevaluación frenó la alerta. Antes esa marca se ignoraba y la
 * misma fila decía "Sin leer todavía" en la columna de riesgo y "Procesado" en la
 * de lectura (auditoría de coherencia 2026-09-24, punto 9). Ahora manda sobre todo
 * lo demás y el chip de la fila dice "En revisión" (DESIGN_SYSTEM.md §10.4).
 *
 * Las palabras son las de §10.1: "Leído" (el análisis terminó), "En cola" (espera
 * financiamiento para leerse), "En revisión".
 */

import { ESTADO_CONTRATO_EXTRA, type ContratoResumen, type EstadoContrato } from "@/lib/contratos";
import { ESTADO_PROC, type EstadoProc } from "@/lib/auditoria";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { COLOR_ESTADO, type EstadoOperativoZona } from "./ContratoPin";
import { PesoRiesgo } from "./PesoRiesgo";
import { cn } from "@/lib/utils";

export type EstadoLectura = EstadoOperativoZona;

export interface LecturaInfo {
  estado: EstadoLectura;
  /** Palabra corta: la que entra en una celda de tabla. */
  label: string;
  /** Qué significa y qué falta. Se muestra completa en el panel del contrato. */
  detalle: string;
}

const BASE: Record<EstadoLectura, LecturaInfo> = {
  sin_analizar: {
    estado: "sin_analizar",
    label: "Sin leer",
    detalle:
      "Nadie lo ha leído y su expediente todavía no está descargado. Este tipo de contratación aún no entra en el alcance activo de los agentes.",
  },
  documentos_listos: {
    estado: "documentos_listos",
    label: "Docs listos",
    detalle:
      "El expediente ya está descargado en el almacén de Vigía, pero el análisis de este tipo de contratación todavía no está activo.",
  },
  en_cola: {
    estado: "en_cola",
    label: "En cola",
    detalle:
      "Está dentro del alcance activo de los agentes: se puede financiar hoy y se procesa por orden de llegada. Quien financia no elige cuál.",
  },
  procesado: {
    estado: "procesado",
    label: "Leído",
    detalle: "Los agentes leyeron el expediente y el dictamen está publicado.",
  },
  en_revision: {
    estado: "en_revision",
    label: "En revisión",
    detalle:
      "Los agentes lo leyeron, pero la autoevaluación frenó la publicación: una persona lo está revisando. Mientras tanto no se muestran puntaje ni señales.",
  },
};

/**
 * Traduce una fila del API a uno de los cinco estados. Los estados del pipeline
 * (`procesando`, `encolado`, `esperando_documentos`, `error`) son más finos que
 * los cinco del catálogo: se agrupan en la familia "en cola" —que es su color—
 * pero conservan su palabra propia, que es información real y no se tira.
 */
export function estadoLecturaDe(
  c: Pick<ContratoResumen, "estadoProcesamiento" | "estadoOperativo" | "enRevision"> & { score?: number | null },
): LecturaInfo {
  // La marca de revisión manda: la fila llega con estadoProcesamiento "procesado".
  if (c.enRevision) return BASE.en_revision;
  // `revision` no está en el union EstadoContrato; se compara como string por si llega así.
  const proc = c.estadoProcesamiento as EstadoContrato | "revision";

  switch (proc) {
    case "revision":
      return BASE.en_revision;
    case "procesado":
      // Leído sin puntaje público y sin revisión pendiente: una persona lo descartó (el API
      // manda score null). Decir "dictamen publicado" ahí era falso.
      if ("score" in c && c.score == null) {
        return {
          estado: "procesado",
          label: "Leído, sin publicar",
          detalle: "Los agentes lo leyeron, pero el resultado no se publicó.",
        };
      }
      return BASE.procesado;
    case "procesando":
      return {
        estado: "en_cola",
        label: "Procesando",
        // Sin duración escrita a mano ("unos diez minutos"): la mediana real vive en la API y
        // la muestra el panel en vivo del contrato; acá no hay de dónde sacarla.
        detalle: "Los agentes lo están leyendo ahora mismo. El dossier muestra en vivo en qué paso va.",
      };
    case "encolado":
      // "En cola" es lo que espera financiamiento (§10.1); éste ya está financiado.
      return {
        estado: "en_cola",
        label: "Esperando turno",
        detalle: "Su lectura ya está financiada y espera turno. Se lee por orden de llegada.",
      };
    case "esperando_documentos":
      return {
        estado: "en_cola",
        label: "Esperando docs",
        detalle: "Está en la cola, pero falta bajar su expediente del SEACE. El lote nocturno lo trae.",
      };
    case "error":
      return {
        estado: "en_cola",
        label: "Reintentando",
        detalle: "La última lectura falló y se va a intentar de nuevo.",
      };
    case "pendiente_de_procesamiento":
      return {
        estado: "sin_analizar",
        label: "No procesable todavía",
        detalle:
          "Los agentes todavía no pueden leerlo: al expediente le falta lo mínimo para analizarlo (etapa, bases o postores).",
      };
  }

  switch (c.estadoOperativo) {
    case "documentos_listos":
      return BASE.documentos_listos;
    case "en_cola":
      return BASE.en_cola;
    default:
      return BASE.sin_analizar;
  }
}

/** El punto de color del catálogo canónico. Nunca va solo: siempre lo acompaña su palabra. */
export function PuntoLectura({ estado, className }: { estado: EstadoLectura; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ background: COLOR_ESTADO[estado] }}
    />
  );
}

/**
 * El chip de la columna "Estado" de un contrato (DESIGN_SYSTEM.md §14.1: la columna de
 * estado siempre es un chip). Uno solo, con lo más específico que se sabe:
 *  - leído → su peso del riesgo ("Riesgo alto", "Sin señales"…) o "En revisión" (§10.4);
 *  - sin leer → dónde está su lectura ("En cola", "Procesando", "Docs listos"…).
 * Son etapas sucesivas, no dos escalas en la misma celda: el peso sólo existe después
 * de leer. Y no se confunden a la vista: el peso usa la escala de severidad; la lectura
 * va neutra, con el punto del catálogo del mapa (el mismo color que el punto de su zona).
 */
export function EstadoContratoChip({
  c,
  className,
}: {
  c: Pick<ContratoResumen, "estadoProcesamiento" | "estadoOperativo" | "enRevision" | "score" | "banderas">;
  className?: string;
}) {
  if (c.enRevision || c.score != null) {
    return <PesoRiesgo score={c.score} banderas={c.banderas} enRevision={c.enRevision} formato="pastilla" className={className} />;
  }
  const l = estadoLecturaDe(c);
  return (
    <span className={cn("pill max-w-full border-line bg-paperSoft text-inkSoft", className)} title={l.detalle}>
      <PuntoLectura estado={l.estado} />
      <span className="truncate">{l.label}</span>
    </span>
  );
}

// ─── Píldora del dossier ─────────────────────────────────────────────────────
// Vive acá (y no en ContratosLista) porque es el mismo eje: el dossier muestra el
// estado del pipeline con toda su granularidad, la lista lo agrupa en cinco.
// La re-exporta ContratosLista.tsx para no tocar a sus importadores.

export function EstadoContratoPill({ estado, operativo }: { estado: EstadoContrato; operativo?: string | null }) {
  // Migración 19: sin analizar pero fuera del alcance activo → decir qué hay (documentos listos o no).
  if (estado === "sin_analizar" && operativo && operativo !== "en_cola") {
    const listo = operativo === "documentos_listos";
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
          listo ? "border border-inkSoft/40 text-inkSoft" : "bg-paperDeep text-mute",
        )}
        role="status"
        title={
          listo
            ? "Documentos descargados; el análisis de este tipo de contratación aún no está activo"
            : "Este tipo de contratación aún no está activo y sus documentos no se han descargado"
        }
      >
        {listo ? "Docs listos" : "Sin documentos"}
      </span>
    );
  }
  if (estado in ESTADO_PROC) return <EstadoPill estado={estado as EstadoProc} />;
  const e = ESTADO_CONTRATO_EXTRA[estado as keyof typeof ESTADO_CONTRATO_EXTRA] ?? ESTADO_CONTRATO_EXTRA.sin_analizar;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", e.cls)} role="status">
      {e.label}
    </span>
  );
}
