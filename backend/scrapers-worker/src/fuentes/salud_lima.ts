/**
 * Prueba diaria de la salida peruana: el relay de Lima (backend/relay-lima/relay.py), que corre en tu PC del Perú
 * (backend/scrapers-pc/salida_peru) y, de respaldo, en la instancia de AWS. Mira que responda y que por él lleguen la
 * Contraloría, INFOBRAS y SERVIR, las fuentes que sólo contestan a IPs del Perú. No escribe datos.
 *
 * Corre todos los días a las 12:40 (src/calendario.ts, con el cron de cada hora) y queda en corridas_fuente: el panel
 * (Cobertura, Fuentes de datos) la marca «falló» el día que no hubo salida, antes de que lo note una carga de verdad. Falla
 * si el relay no responde o si no llega a ningún sitio; si llega a algunos, el resumen dice cuáles no.
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { obtener, saludLima } from "../http.ts";

/** Una página liviana de cada sitio que sólo responde desde el Perú. */
export const SITIOS_PERU: Record<string, string> = {
  contraloria: "https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/BusquedaInformesCGR.ashx?ActionPage=TransportType&Action=loadInformesElastic&PageSize=1&PageNumber=1&pGeneral=+&pResponsabilidad=%22PENAL%22",
  infobras: "https://infobras.contraloria.gob.pe/InfobrasWeb/DataSets",
  servir: "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml",
};

export async function correrSaludLima(env: Env, _p: ParamsCorrida, step: WorkflowStep): Promise<unknown> {
  return step.do("relay de Lima y sus sitios", { retries: { limit: 2, delay: "2 minutes" }, timeout: "5 minutes" }, async () => {
    const salud = await saludLima(env);
    if (!salud) throw new Error("el relay de Lima no responde: ¿la PC (backend/scrapers-pc/salida_peru) está apagada o sin el túnel?");
    const sitios: Record<string, number | string> = {};
    for (const [clave, url] of Object.entries(SITIOS_PERU)) {
      try {
        const r = await obtener(env, url, { relay: "lima", sinReintentos: true, timeoutMs: 60_000 });
        await r.body?.cancel();
        // Sin x-relay-status, el error es del relay (DNS, conexión), no del sitio.
        sitios[clave] = r.headers.get("x-relay-status") ? r.status : `relay ${r.status}`;
      } catch (e) {
        sitios[clave] = String((e as Error)?.message ?? e).slice(0, 100);
      }
    }
    const llegan = Object.values(sitios).filter((v) => v === 200).length;
    if (!llegan) throw new Error(`el relay de Lima (${salud.nombre}) responde, pero no llega a ningún sitio: ${JSON.stringify(sitios)}`);
    return { quien: salud.nombre, sitios, llegan, de: Object.keys(SITIOS_PERU).length };
  });
}
