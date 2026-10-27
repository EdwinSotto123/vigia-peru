/**
 * Qué fuentes tocan en cada cron. Mismas agendas que tenían en Cloud Scheduler (hora de Lima, que no
 * tiene horario de verano: Lima = UTC-5):
 *
 *   oece_ocds          diario 06:00                    → cron "0 11 * * *"
 *   pnda_sancionados   domingos 08:00                  ┐
 *   pnda_visitas       días 1 y 15, 08:00              │
 *   pnda_dji           día 5, 08:00                    ├ cron "0 13 * * *" (el día se decide acá)
 *   jne_infogob        día 5, 08:00                    │
 *   pnda_oece          día 1 (era 09:00; ahora 08:00)  │
 *   mef_presupuesto    lunes 08:00 (antes día 12; el   │
 *                      MEF regenera el archivo a diario)│
 *   mef_opds_etes      martes 08:00 (OPD y empresas    │
 *                      municipales del MEF, migr. 152; │
 *                      el día después del SIAF para que│
 *                      sus refrescos no se crucen)     │
 *   onpe_claridad      miércoles 08:00 (semanal mien-  │
 *   onpe_gastos        tras dure la rendición de ERM2026; antes era manual)
 *   conosce            sábados 08:00 (CONOSCE regenera │
 *   conosce_ordenes    los reportes los viernes)       ┘
 *
 *   documentos         cada hora, al minuto 40         → cron "40 * * * *" (los documentos de los contratos
 *                      financiados: lo que hacía vigia-batch en GCP; src/fuentes/documentos.ts)
 *
 *   pte_personal       día 20, 08:00: la planilla de los dos meses anteriores (Portal de Transparencia Estándar; las
 *                      entidades la publican con atraso). Migración 92.
 *
 *   contraloria_informes  SIN cron: el buscador de la Contraloría no responde fuera del Perú (522 desde Cloudflare,
 *                      también por el relay). Mensual, a mano desde una PC en el Perú:
 *                      backend/scripts/cargar_contraloria_informes.py (docs/CORRUPCION.md). Si un día llega,
 *                      agregarlo acá (día 10) con `dia === 10`.
 */

export const CRON_DIARIO = "0 11 * * *";
export const CRON_DATOS = "0 13 * * *";
export const CRON_DOCUMENTOS = "40 * * * *";
// Contratos menores del SEACE: cron propio (martes 05:00 Lima = 10:00 UTC, minuto 0) para NO competir con `documentos`
// (que usa el mismo relay cada hora al minuto 40) ni con los otros de las 06:00/08:00. Semanal: los menores nuevos son pocos.
export const CRON_MENORES = "0 10 * * 2";

/** Fuentes que corren en `cron` (expresión de wrangler.jsonc) en el instante `ms`. */
export function fuentesDelCron(cron: string, ms: number): string[] {
  if (cron === CRON_DIARIO) return ["oece_ocds"];
  if (cron === CRON_DOCUMENTOS) return ["documentos"];
  if (cron === CRON_MENORES) return ["seace_menores"];
  if (cron !== CRON_DATOS) return [];
  const lima = new Date(ms - 5 * 3600 * 1000);
  const dia = lima.getUTCDate();
  const out: string[] = [];
  if (lima.getUTCDay() === 0) out.push("pnda_sancionados");
  if (lima.getUTCDay() === 1) out.push("mef_presupuesto");
  if (lima.getUTCDay() === 2) out.push("mef_opds_etes");
  if (lima.getUTCDay() === 3) out.push("onpe_claridad", "onpe_gastos");
  if (lima.getUTCDay() === 6) out.push("conosce", "conosce_ordenes");
  if (dia === 1 || dia === 15) out.push("pnda_visitas");
  if (dia === 5) out.push("pnda_dji", "jne_infogob");
  if (dia === 1) out.push("pnda_oece");
  if (dia === 20) out.push("pte_personal");
  return out;
}
