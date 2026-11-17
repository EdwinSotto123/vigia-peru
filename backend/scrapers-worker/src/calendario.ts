/**
 * Qué fuentes tocan en cada cron. Mismas agendas que tenían en Cloud Scheduler (hora de Lima, que no
 * tiene horario de verano: Lima = UTC-5):
 *
 *   oece_ocds          diario 06:00                    → cron "0 11 * * *"
 *   pnda_sancionados   domingos 08:00                  ┐
 *   osce_penalidades   domingos 08:00 (los adjuntos de │
 *                      la wiki del OSCE, migr. 238)    │
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
 *                      los reportes los viernes)       │
 *   conosce_ordenes    domingos 08:00: desde el 23-oct ┘
 *                      recarga el año entero (~6 h); el sábado, junto a `conosce`, las dos se quedaban sin conexiones
 *                      de Hyperdrive («Timed out while waiting for an open slot in the pool», 2026-10-27)
 *
 *   documentos         cada hora, al minuto 40         → cron "40 * * * *" (los documentos de los contratos
 *                      financiados: lo que hacía vigia-batch en GCP; src/fuentes/documentos.ts)
 *   salud_lima         todos los días a las 12:40, con el mismo cron: la prueba de la salida peruana (relay de Lima en
 *                      tu PC, backend/scrapers-pc/salida_peru), a una hora en que la PC suele estar prendida.
 *
 *   congreso_visitas   jueves 08:00: las visitas al Congreso de los últimos 14 días (su registro propio, sin captcha;
 *                      el relleno desde 2020 lo hizo backend/scripts/cargar_visitas_congreso.py).
 *
 *   servir_convocatorias  TODOS LOS DÍAS 08:00 (desde el 2026-11-08): las plazas CAS de SERVIR Talento Perú, por el relay de
 *                      Lima (403 desde Cloudflare y por Zúrich). Incremental (~15-25 min: el listado entero y sólo el detalle
 *                      de las plazas nuevas o cambiadas); los jueves, la lectura completa (~1,5 h: ~1,7 s por plaza, medido
 *                      en PROD el 31-oct). Respaldo: backend/scripts/cargar_servir_convocatorias.py.
 *
 *   servir_practicas   TODOS LOS DÍAS 09:00 (desde el 2026-11-08) → cron "0 14 * * *": las prácticas preprofesionales y
 *                      profesionales de Talento Perú (`modalidades_formativas`, migración 271), enteras (~10 páginas,
 *                      ~110 pedidos). Cron propio, una hora después de las plazas CAS, para no pedirle a SERVIR el doble a
 *                      la vez por el mismo relay.
 *
 *   infobras           jueves 08:00: las obras de INFOBRAS (Contraloría), por el relay de Lima (522 fuera del Perú). No el
 *                      viernes de invierte_pe (las dos terminan en refrescar_obras) ni el miércoles (la cadena de cruces de
 *                      onpe_gastos rehace también las banderas de obras). Respaldo: backend/scripts/cargar_obras.py.
 *
 *   pte_personal       día 20, 08:00: la planilla de los dos meses anteriores (Portal de Transparencia Estándar; las
 *                      entidades la publican con atraso). Migración 92.
 *
 *   sunat_padron       martes 08:00: el padrón reducido de la SUNAT (sólo RUC 20) → estado y condición de las empresas
 *                      (migración 224), sin el formulario con captcha de la Consulta Múltiple.
 *
 *   invierte_pe        viernes 08:00: el Banco de Inversiones del MEF (Invierte.pe: activas y cerradas, migración 223);
 *                      antes iba con INFOBRAS en backend/scripts/cargar_obras.py, que ahora sólo lo carga con --con-mef.
 *
 *   oece_entidades     día 2, 08:00: el registro de entidades contratantes de la OECE (RUC → CODIGO_SIAF, migración
 *                      150); antes, backend/scripts/cargar_entidades_oece.py a mano. Casi no cambia: con el mismo
 *                      sha256 no hace nada.
 *
 *   oece_fichas        lunes 08:00: la ficha del proveedor en el OECE de las empresas sancionadas (migración 337), por el relay
 *                      de Lima, hasta 700 por semana; corrige «sanción vigente» cuando el Tribunal sustituyó una sanción.
 *
 *   contraloria_informes  día 10, 08:00: el buscador de informes de la Contraloría, por el relay de Lima (sólo responde
 *                      a IPs del Perú: 522 desde Cloudflare y por Zúrich). Respaldo a mano:
 *                      backend/scripts/cargar_contraloria_informes.py (docs/CORRUPCION.md).
 */

export const CRON_DIARIO = "0 11 * * *";
export const CRON_DATOS = "0 13 * * *";
export const CRON_DOCUMENTOS = "40 * * * *";
// Contratos menores del SEACE: cron propio (minuto 0) para NO competir con `documentos` (que usa el mismo relay cada hora al
// minuto 40) ni con los otros de las 06:00/08:00. Semanal: los menores nuevos son pocos. OJO: en los crons de Cloudflare el
// día de la semana va de 1 (domingo) a 7, así que "2" es LUNES 05:00 Lima (10:00 UTC): corrió el lunes 2026-10-26.
export const CRON_MENORES = "0 10 * * 2";
// Las prácticas de SERVIR: 09:00 Lima, después de las plazas CAS de las 08:00 (mismo relay, mismo sitio).
export const CRON_PRACTICAS = "0 14 * * *";

/** Fuentes que corren en `cron` (expresión de wrangler.jsonc) en el instante `ms`. */
export function fuentesDelCron(cron: string, ms: number): string[] {
  if (cron === CRON_DIARIO) return ["oece_ocds"];
  // Cada hora también las contrataciones menores abiertas (seace_cotizaciones): sus ventanas duran horas.
  if (cron === CRON_DOCUMENTOS) return new Date(ms - 5 * 3600 * 1000).getUTCHours() === 12 ? ["documentos", "salud_lima", "seace_cotizaciones"] : ["documentos", "seace_cotizaciones"];
  if (cron === CRON_MENORES) return ["seace_menores"];
  if (cron === CRON_PRACTICAS) return ["servir_practicas"];
  if (cron !== CRON_DATOS) return [];
  const lima = new Date(ms - 5 * 3600 * 1000);
  const dia = lima.getUTCDate();
  const out: string[] = [];
  if (lima.getUTCDay() === 0) out.push("pnda_sancionados", "osce_penalidades", "conosce_ordenes");
  if (lima.getUTCDay() === 1) out.push("mef_presupuesto", "oece_fichas");
  if (lima.getUTCDay() === 2) out.push("mef_opds_etes", "sunat_padron");
  if (lima.getUTCDay() === 3) out.push("onpe_claridad", "onpe_gastos");
  if (lima.getUTCDay() === 4) out.push("congreso_visitas", "servir_convocatorias", "infobras");
  if (lima.getUTCDay() === 5) out.push("invierte_pe");
  if (lima.getUTCDay() === 6) out.push("conosce");
  // SERVIR todos los días (la corrida decide: completa los jueves, arriba; incremental los demás).
  if (lima.getUTCDay() !== 4) out.push("servir_convocatorias");
  if (dia === 1 || dia === 15) out.push("pnda_visitas");
  if (dia === 5) out.push("pnda_dji", "jne_infogob");
  if (dia === 1) out.push("pnda_oece");
  if (dia === 20) out.push("pte_personal");
  if (dia === 2) out.push("oece_entidades");
  if (dia === 10) out.push("contraloria_informes");
  return out;
}
