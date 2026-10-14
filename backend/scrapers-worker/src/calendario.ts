/**
 * Qué fuentes tocan en cada cron. Mismas agendas que tenían en Cloud Scheduler (hora de Lima, que no
 * tiene horario de verano: Lima = UTC-5):
 *
 *   oece_ocds          diario 06:00                    → cron "0 11 * * *"
 *   pnda_sancionados   domingos 08:00                  ┐
 *   pnda_visitas       días 1 y 15, 08:00              │
 *   pnda_dji           día 5, 08:00                    ├ cron "0 13 * * *" (el día se decide acá)
 *   jne_infogob        día 5, 08:00                    │
 *   pnda_oece          día 1 (era 09:00; ahora 08:00)  ┘
 *
 * Sin portar: mef_presupuesto (la API del MEF cambió y el pipeline falla igual en GCP) y vigia-batch
 * (documentos de contratos financiados para los agentes, que siguen en GCP y están pausados).
 */

export const CRON_DIARIO = "0 11 * * *";
export const CRON_DATOS = "0 13 * * *";

/** Fuentes que corren en `cron` (expresión de wrangler.jsonc) en el instante `ms`. */
export function fuentesDelCron(cron: string, ms: number): string[] {
  if (cron === CRON_DIARIO) return ["oece_ocds"];
  if (cron !== CRON_DATOS) return [];
  const lima = new Date(ms - 5 * 3600 * 1000);
  const dia = lima.getUTCDate();
  const out: string[] = [];
  if (lima.getUTCDay() === 0) out.push("pnda_sancionados");
  if (dia === 1 || dia === 15) out.push("pnda_visitas");
  if (dia === 5) out.push("pnda_dji", "jne_infogob");
  if (dia === 1) out.push("pnda_oece");
  return out;
}
