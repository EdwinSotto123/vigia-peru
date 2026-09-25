/**
 * Qué dibuja el mapa como punto de riesgo. Una sola definición para el
 * encabezado, la tira, la capa de puntos, la pestaña Señales y el filtro.
 *
 * OJO con las palabras (DESIGN_SYSTEM.md §10.1): "con señales" es AL MENOS UNA
 * señal publicada, de cualquier peso. Lo que cuenta `esSenal` es otra cosa —el
 * peso del riesgo medio o alto (≥ 40)— y en pantalla se nombra así, "de riesgo
 * medio o alto". El nombre de la función queda por compatibilidad.
 *
 * `/alertas` devuelve TODOS los contratos analizados, no sólo los que tienen
 * algo: medido el 2026-09-23, de 84 filas reales 23 traen `banderas: []` y
 * score 0 (leídos sin nada que señalar) y 24 traen banderas pero un puntaje
 * menor a 40. Antes el mapa contaba y dibujaba las 84 como "señales", con un
 * punto verde de "Señal baja, score 0".
 *
 * Un contrato CON SEÑAL es el que tiene al menos una bandera y un puntaje en
 * el rango medio o alto de `lib/severidad` (≥ 40). Es exactamente lo que el
 * backend cuenta como `conSenales` en `/contratos/geo` (score ≥ 40 y alerta
 * publicada), así que el número del encabezado y el largo de la lista son el
 * mismo número: verificado departamento por departamento, 25 de 25.
 *
 * Los que tienen banderas de bajo peso (puntaje < 40) no se esconden: la
 * pestaña Señales los lista aparte, nombrados como lo que son.
 */

import { CORTE_MEDIA } from "@/lib/severidad";
import { departamentoDe, zonaDe } from "./region-match";

type AlertaLike = { score?: number | null; banderas?: unknown[] | null; region?: string | null; provincia?: string | null };

const nBanderas = (a: AlertaLike) => (Array.isArray(a.banderas) ? a.banderas.length : 0);

/** "Con señales" (DESIGN_SYSTEM.md §10.1): al menos una señal publicada, de cualquier peso. */
export const tieneSenales = (a: AlertaLike): boolean => nBanderas(a) > 0;

/** Contrato de peso del riesgo medio o alto: al menos una señal y puntaje ≥ 40. */
export const esSenal = (a: AlertaLike): boolean => nBanderas(a) > 0 && (a.score ?? 0) >= CORTE_MEDIA;

/** Leído con señales de bajo peso (puntaje < 40): son señales publicadas, de riesgo bajo. */
export const esSenalDeBajoPeso = (a: AlertaLike): boolean => nBanderas(a) > 0 && (a.score ?? 0) < CORTE_MEDIA;

/** Zona de una alerta: provincia (4 díg.) si se reconoce, si no departamento (2 díg.). En `/alertas`, `region` es la provincia. */
export const zonaDeAlerta = (a: AlertaLike): string | null => zonaDe(a, "provincia");

/** Departamento (2 díg.) de una alerta. */
export const departamentoDeAlerta = (a: AlertaLike): string | null => departamentoDe(a, "provincia");

/** Ruta del dossier de una alerta (misma regla que los puntos del mapa). */
export function alertaHref(a: { codigoconvocatoria?: string | null; codigo?: string | null; id?: string | null }): string {
  const ocid = a.codigoconvocatoria || (typeof a.codigo === "string" ? a.codigo.replace("OECE-", "") : null) || a.id;
  return `/app/convocatoria/${encodeURIComponent(String(ocid))}`;
}

/**
 * Una denuncia queda confirmada cuando la reportan dos personas distintas. La
 * regla vive en `lib/denuncias-meta` (`estaConfirmada`); acá sólo se nombra el
 * umbral para el texto de la interfaz.
 */
export const MIN_CONFIRMACIONES = 2;
