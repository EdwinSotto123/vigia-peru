/**
 * Tipos, colores y utilidades compartidas de la página de procesamiento
 * (app/admin/procesamientos) y sus piezas.
 */

import { TONO, type Tone } from "@/components/admin/ui/tono";

export type Estado = "encolado" | "procesando" | "procesado" | "error" | "pendiente_de_procesamiento" | "esperando_documentos";

export interface ProcAdmin {
  ocid: string;
  estado: Estado;
  faseActual: string | null;
  faseIndex: number | null;
  intentos: number;
  worker: string | null;
  error: string | null;
  latidoAt: string | null;
  encoladoAt: string | null;
  iniciadoAt: string | null;
  finalizadoAt: string | null;
  contribucionCodigo: string | null;
  financiador: string | null;
  zona: string | null;
  titulo: string | null;
  entidad: string | null;
  perfil: "bienes" | "servicios" | "obras" | "otros" | null;
  tipo: string | null;
  alertaEstado: string | null;
  score: number | null;
}

/**
 * Un color por estado, el mismo en las cajas, en las barras de avance y en la
 * etiqueta de cada fila: se aprende una vez. Los colores salen del tono del kit
 * (components/admin/ui/tono.ts), así una etiqueta "En cola" se ve igual acá, en
 * el Resumen y en cualquier otra página.
 */
const ui = (label: string, corto: string, tono: Tone) => ({ label, corto, tono, barra: TONO[tono].barra, badge: TONO[tono].badge, punto: TONO[tono].punto });

export const ESTADO_UI: Record<Estado, ReturnType<typeof ui>> = {
  encolado: ui("En cola", "en cola", "neutral"),
  procesando: ui("Procesando", "procesando", "warn"),
  procesado: ui("Procesados", "procesados", "ok"),
  esperando_documentos: ui("Esperando documentos", "esperan documentos", "pending"),
  error: ui("Con error", "con error", "danger"),
  pendiente_de_procesamiento: ui("Sin análisis aplicable", "sin análisis", "muted"),
};

export const ORDEN_BARRA: Estado[] = ["procesado", "procesando", "encolado", "esperando_documentos", "error", "pendiente_de_procesamiento"];

// El API puede devolver snake_case (columnas crudas) o camelCase: normalizamos acá.
export function normalize(r: any): ProcAdmin {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined) return r[k];
    return null;
  };
  return {
    ocid: r.ocid,
    estado: r.estado,
    faseActual: pick("faseActual", "fase_actual"),
    faseIndex: pick("faseIndex", "fase_index"),
    intentos: Number(r.intentos ?? 0),
    worker: pick("worker"),
    error: pick("error"),
    latidoAt: pick("latidoAt", "latido_at"),
    encoladoAt: pick("encoladoAt", "encolado_at"),
    iniciadoAt: pick("iniciadoAt", "iniciado_at"),
    finalizadoAt: pick("finalizadoAt", "finalizado_at"),
    contribucionCodigo: pick("contribucionCodigo", "contribucion_codigo"),
    financiador: pick("financiador"),
    zona: pick("zona"),
    titulo: pick("titulo", "objeto"),
    entidad: pick("entidad"),
    perfil: pick("perfil"),
    tipo: pick("tipo", "tipo_contratacion"),
    alertaEstado: pick("alertaEstado", "alerta_estado"),
    score: pick("score"),
  };
}

export const PERFILES = ["bienes", "servicios", "obras", "otros"] as const;
export type Perfil = (typeof PERFILES)[number];
export type Conteo = Record<Estado, number>;
export const conteoVacio = (): Conteo => ({ encolado: 0, procesando: 0, procesado: 0, error: 0, pendiente_de_procesamiento: 0, esperando_documentos: 0 });

/** Estados que se pueden pedir por URL (?estado=). */
export const esEstado = (x: string | null | undefined): x is Estado => !!x && x in ESTADO_UI;

/** El conteo exacto por estado de GET /operacion (`cola`: un GROUP BY sobre toda la tabla, sin tope). */
export function conteoDeCola(cola: Record<string, number>): Conteo {
  const c = conteoVacio();
  for (const e of Object.keys(c) as Estado[]) c[e] = Number(cola[e] ?? 0);
  return c;
}

/**
 * GET /procesamientos trae a lo más esta cantidad de filas (las de movimiento más reciente, ver
 * backend/api/src/routes/admin.ts). Con esa cantidad justa la lista puede estar cortada: los totales
 * salen de /operacion y la página lo dice.
 */
export const TOPE_LISTA = 200;

/** Igual que el Resumen: el lote de documentos corre cada noche; más de 30 h sin correr es que no está corriendo. */
export const HORAS_LOTE_PARADO = 30;

/**
 * ¿El lote nocturno de documentos está parado? `null` mientras /operacion no llegó: hasta saberlo
 * no se afirma nada. Un lote en curso (iniciado y sin terminar) cuenta desde su inicio.
 */
export function loteNocturnoParado(op: { lote: { iniciadoAt: string | null; finalizadoAt: string | null } | null } | null): boolean | null {
  if (!op) return null;
  const fin = op.lote?.finalizadoAt ?? op.lote?.iniciadoAt ?? null;
  if (!fin) return true;
  return (Date.now() - new Date(fin).getTime()) / 3_600_000 > HORAS_LOTE_PARADO;
}

/**
 * Cómo se sondea GET /operacion (Resumen y Procesamiento comparten la misma caché).
 * Consulta los 4 servicios de agentes con timeout de 3 s, así que tarda: a lo más una
 * vez por minuto, también al volver a la pestaña. "Actualizar" siempre la pide de nuevo.
 */
export const SONDEO_OPERACION = { refreshInterval: 60_000, dedupingInterval: 30_000, focusThrottleInterval: 60_000 } as const;

/** El mismo "hace 3 h" (y el mismo plural) que el resto del panel. */
export { hace, plural } from "@/components/admin/ui/formato";
