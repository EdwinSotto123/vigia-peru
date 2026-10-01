/**
 * Protección contra bots de los formularios públicos (aportes, comprobantes, denuncias y sus
 * adjuntos): la cabecera con la que viaja la verificación y lo que se le dice a la persona
 * cuando el servidor la rechaza. Módulo plano: lo importan componentes de cliente y archivos
 * de datos que también usa el servidor.
 *
 * Contrato con la API y con /api/upload:
 *  - la verificación viaja en la cabecera `cf-turnstile-response` (un token por pedido: sirve una vez);
 *  - 403 `{ error: "captcha_requerido" }`: no llegó;
 *  - 403 `{ error: "captcha_invalido" }`: venció, ya se usó o es de otro sitio;
 *  - 429 `{ error: "demasiados_pedidos", reintentarEn: <segundos> }`: demasiados pedidos seguidos.
 */
import { plural } from "@/lib/formato";

export const CABECERA_TURNSTILE = "cf-turnstile-response";

/** La cabecera con el token, o nada si no hay token (desarrollo sin sitekey). */
export const cabeceraTurnstile = (token: string | null | undefined): Record<string, string> =>
  token ? { [CABECERA_TURNSTILE]: token } : {};

export type CodigoBots = "captcha_requerido" | "captcha_invalido" | "demasiados_pedidos";

export const MENSAJE_BOTS: Record<CodigoBots, string> = {
  captcha_requerido: "Falta la verificación contra robots. Recarga la página y vuelve a intentarlo.",
  captcha_invalido: "La verificación contra robots venció o no fue válida. Vuelve a intentarlo.",
  demasiados_pedidos: "Hiciste muchos intentos seguidos. Espera un minuto y vuelve a intentarlo.",
};

/** "Espera 40 segundos…", "Espera 2 minutos…"; sin dato, un minuto (la ventana del límite). */
function espera(segundos: number | undefined): string {
  if (!segundos || !Number.isFinite(segundos) || segundos <= 0) return "Espera un minuto y vuelve a intentarlo.";
  const s = Math.ceil(segundos);
  return s < 60
    ? `Espera ${plural(s, "segundo", "segundos")} y vuelve a intentarlo.`
    : `Espera ${plural(Math.ceil(s / 60), "minuto", "minutos")} y vuelve a intentarlo.`;
}

/**
 * El mensaje para una respuesta de la protección contra bots, o `null` si el error es otro.
 * Con `demasiados_pedidos` usa `reintentarEn` para decir cuánto esperar.
 */
export function mensajeBots(j: { error?: unknown; reintentarEn?: unknown } | null | undefined): string | null {
  switch (j?.error) {
    case "captcha_requerido":
    case "captcha_invalido":
      return MENSAJE_BOTS[j.error];
    case "demasiados_pedidos":
      return `Hiciste muchos intentos seguidos. ${espera(typeof j.reintentarEn === "number" ? j.reintentarEn : undefined)}`;
    default:
      return null;
  }
}
