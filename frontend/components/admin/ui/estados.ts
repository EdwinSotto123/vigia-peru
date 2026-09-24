/**
 * Estados y códigos del backend → etiqueta en palabras llanas + tono. Lo que el
 * admin lee nunca es un snake_case: si aparece un código sin etiqueta acá, sale
 * humanizado por `humanizar()` y conviene sumarlo a estos mapas.
 */

import { humanizar } from "./formato";
import type { Tone } from "./tono";

export interface EstadoUI { label: string; tono: Tone }

const de = (mapa: Record<string, EstadoUI>, clave: string | null | undefined, porDefecto: Tone = "neutral"): EstadoUI =>
  (clave && mapa[clave]) || { label: humanizar(clave) ?? "Sin dato", tono: clave ? porDefecto : "muted" };

// ── Aportes (contribuciones.estado) ──────────────────────────────────────────
export const ESTADO_APORTE: Record<string, EstadoUI> = {
  pendiente_pago: { label: "Por validar", tono: "warn" },
  pagada: { label: "Pagada", tono: "neutral" },
  en_proceso: { label: "En proceso", tono: "pending" },
  procesada: { label: "Procesada", tono: "ok" },
  rechazada: { label: "Rechazada", tono: "danger" },
  reembolsada: { label: "Reembolsada", tono: "muted" },
};
export const estadoAporte = (e: string | null | undefined) => de(ESTADO_APORTE, e);

/** Cómo se pagó (contribuciones.pasarela). */
const PASARELA: Record<string, string> = {
  institucional: "Aporte de Vigía Perú",
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia bancaria",
  mercadopago: "Mercado Pago",
};
export const pasarelaLabel = (p: string | null | undefined) => (p ? PASARELA[p] ?? humanizar(p) : null);

// ── Financiadores ────────────────────────────────────────────────────────────
const TIPO_FINANCIADOR: Record<string, string> = { persona: "Persona", empresa: "Empresa", organizacion: "Organización", institucion: "Institución" };
export const tipoFinanciadorLabel = (t: string | null | undefined) => (t ? TIPO_FINANCIADOR[t] ?? humanizar(t) : null);

/** Por qué un financiador no aparece en público (financiadores.motivo_no_visible). */
export const MOTIVO_NO_VISIBLE: Record<string, string> = {
  decision_admin: "Decisión del equipo",
  sancion_vigente_osce: "Sanción OSCE vigente",
  proveedor_con_alertas_activas: "Proveedor con alertas activas",
  solicitud_del_financiador: "Lo pidió el financiador",
};
export const motivoNoVisibleLabel = (m: string | null | undefined) => (m ? MOTIVO_NO_VISIBLE[m] ?? humanizar(m) : null);

/** Alcance de la zona de un aporte (zonas.nivel). */
const NIVEL: Record<string, string> = { departamento: "región", provincia: "provincia", distrito: "distrito", pais: "todo el país" };
export const nivelLabel = (n: string | null | undefined) => (n ? NIVEL[n] ?? humanizar(n)?.toLowerCase() ?? null : null);

// ── Lotes de ingesta (lotes_ingesta, migración 14) ───────────────────────────
export const ESTADO_LOTE: Record<string, EstadoUI> = {
  pending: { label: "En espera", tono: "neutral" },
  procesando: { label: "Cargando", tono: "warn" },
  ok: { label: "Completo", tono: "ok" },
  error: { label: "Con error", tono: "danger" },
};
export const estadoLote = (e: string | null | undefined) => de(ESTADO_LOTE, e);

const TIPO_LOTE: Record<string, string> = { releases: "Convocatorias nuevas", records: "Expedientes completos", documentos: "Documentos" };
export const tipoLoteLabel = (t: string | null | undefined) => (t ? TIPO_LOTE[t] ?? humanizar(t) : "Lote");

// ── Revisión humana: por qué la autoevaluación bloqueó una alerta ────────────
export const MOTIVO_BLOQUEO: Record<string, EstadoUI & { corto: string }> = {
  respaldo: { label: "Poco respaldo", corto: "respaldo", tono: "warn" },
  precio: { label: "Precio dudoso", corto: "precio", tono: "warn" },
  cita: { label: "Sin cita", corto: "cita", tono: "warn" },
  tono: { label: "Tono acusatorio", corto: "tono", tono: "danger" },
  coherencia: { label: "Ítems incoherentes", corto: "coherencia", tono: "danger" },
  urls: { label: "Enlaces sin verificar", corto: "enlaces", tono: "warn" },
  pipeline: { label: "Bloqueo del análisis", corto: "análisis", tono: "pending" },
};
export const motivoBloqueo = (c: string) => MOTIVO_BLOQUEO[c] ?? { label: humanizar(c) ?? c, corto: c, tono: "warn" as Tone };

/** Estado de una alerta (alertas.estado). */
export const ESTADO_ALERTA: Record<string, EstadoUI> = {
  revision: { label: "En revisión", tono: "pending" },
  activa: { label: "Publicada", tono: "ok" },
  descartada: { label: "Descartada", tono: "muted" },
};
export const estadoAlerta = (e: string | null | undefined) => de(ESTADO_ALERTA, e);
