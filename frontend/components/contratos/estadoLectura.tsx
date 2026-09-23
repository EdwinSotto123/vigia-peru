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
 * LÍMITE CONOCIDO DEL DATO: `GET /contratos` no devuelve el estado de la alerta
 * (`alertas.estado`), así que hoy ningún contrato puede llegar acá como
 * "en_revision" — el backend lo colapsa a "procesado" en la lista (sí lo
 * distingue el dossier, que lee `alerta.estado`). El caso está implementado y
 * empieza a funcionar solo si el API algún día manda ese estado; no se simula.
 */

import { ESTADO_CONTRATO_EXTRA, type ContratoResumen, type EstadoContrato } from "@/lib/contratos";
import { ESTADO_PROC, type EstadoProc } from "@/lib/auditoria";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { COLOR_ESTADO, type EstadoOperativoZona } from "./ContratoPin";
import { cn } from "@/lib/utils";

export type EstadoLectura = EstadoOperativoZona;

export interface LecturaInfo {
  estado: EstadoLectura;
  /** Palabra corta: la que entra en una celda de tabla. */
  label: string;
  /** Qué significa y qué falta. Se muestra completa en el panel del contrato. */
  detalle: string;
}

/** Orden de avance, de nada leído a leído. Es el orden de la leyenda. */
export const ORDEN_LECTURA: EstadoLectura[] = [
  "sin_analizar",
  "documentos_listos",
  "en_cola",
  "procesado",
  "en_revision",
];

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
    label: "Procesado",
    detalle: "Los agentes leyeron el expediente y el dictamen está publicado.",
  },
  en_revision: {
    estado: "en_revision",
    label: "En revisión",
    detalle:
      "Los agentes lo leyeron, pero la autoevaluación bloqueó la publicación: lo está revisando una persona.",
  },
};

/** Etiquetas cortas de la leyenda, para no repetir el catálogo en cada superficie. */
export const LECTURA_LABEL: Record<EstadoLectura, string> = {
  sin_analizar: BASE.sin_analizar.label,
  documentos_listos: BASE.documentos_listos.label,
  en_cola: BASE.en_cola.label,
  procesado: BASE.procesado.label,
  en_revision: BASE.en_revision.label,
};

/**
 * Traduce una fila del API a uno de los cinco estados. Los estados del pipeline
 * (`procesando`, `encolado`, `esperando_documentos`, `error`) son más finos que
 * los cinco del catálogo: se agrupan en la familia "en cola" —que es su color—
 * pero conservan su palabra propia, que es información real y no se tira.
 */
export function estadoLecturaDe(
  c: Pick<ContratoResumen, "estadoProcesamiento" | "estadoOperativo">,
): LecturaInfo {
  // `revision` no está en el union EstadoContrato (el API de la lista no lo
  // manda hoy); se compara como string para que funcione solo si algún día llega.
  const proc = c.estadoProcesamiento as EstadoContrato | "revision";

  switch (proc) {
    case "revision":
      return BASE.en_revision;
    case "procesado":
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
      return {
        estado: "en_cola",
        label: "En cola",
        detalle: "Su lectura ya está financiada y espera turno. Se procesa por orden de llegada.",
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
        detalle: "La última corrida falló y el pipeline la va a reintentar.",
      };
    case "pendiente_de_procesamiento":
      return {
        estado: "sin_analizar",
        label: "No procesable",
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
 * Celda de estado de lectura: punto canónico + palabra, en texto neutro.
 * El texto va en `inkSoft` a propósito — si la palabra tomara el color del
 * estado, el ojo leería esta columna como una segunda escala de severidad.
 */
export function EstadoLecturaCelda({ info, className }: { info: LecturaInfo; className?: string }) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12px] text-inkSoft", className)}
      title={info.detalle}
    >
      <PuntoLectura estado={info.estado} />
      <span className="truncate">{info.label}</span>
    </span>
  );
}

/** Leyenda de los cinco estados. Densa, una línea, para el pie de la tabla. */
export function LeyendaLectura({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <span className="text-mute">Estado de lectura:</span>
      {ORDEN_LECTURA.map((e) => (
        <span key={e} className="inline-flex items-center gap-1.5 text-inkSoft" title={BASE[e].detalle}>
          <PuntoLectura estado={e} />
          {LECTURA_LABEL[e]}
        </span>
      ))}
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
