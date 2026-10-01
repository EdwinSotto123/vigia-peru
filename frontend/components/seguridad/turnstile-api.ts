/**
 * El script de Cloudflare Turnstile, cargado una sola vez por página, y los errores del lado
 * del navegador. Sólo navegador (lo usa `useTurnstile`, en Turnstile.tsx).
 *
 * Se carga en modo explícito (`?render=explicit`): ningún widget se dibuja solo, cada
 * formulario dibuja el suyo cuando hace falta.
 */

const URL_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Sin respuesta del script en este tiempo, se da por bloqueado (red, bloqueador de anuncios). */
const ESPERA_SCRIPT_MS = 15_000;

/** La sitekey pública. Sin ella (desarrollo) no hay verificación y los pedidos van sin cabecera. */
export const SITE_KEY_TURNSTILE = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export interface OpcionesWidget {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  language?: string;
  size?: "normal" | "flexible" | "compact";
  appearance?: "always" | "execute" | "interaction-only";
  execution?: "render" | "execute";
  retry?: "auto" | "never";
  "refresh-expired"?: "auto" | "manual" | "never";
  "refresh-timeout"?: "auto" | "manual" | "never";
  "response-field"?: boolean;
  callback?: (token: string) => void;
  "error-callback"?: (codigo: string) => boolean | void;
  "expired-callback"?: (token: string) => void;
  "timeout-callback"?: () => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
  "unsupported-callback"?: () => void;
}

export interface ApiTurnstile {
  render(contenedor: HTMLElement | string, opciones: OpcionesWidget): string | null | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
}

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
  }
}

export type CodigoTurnstile = "sin_script" | "fallo" | "vencido" | "no_soportado" | "sin_respuesta" | "cancelado";

const MENSAJE: Record<CodigoTurnstile, string> = {
  sin_script:
    "No se pudo cargar la verificación contra robots. Si usas un bloqueador de anuncios, desactívalo para este sitio y vuelve a intentarlo.",
  fallo: "No pudimos comprobar que no seas un robot. Vuelve a intentarlo.",
  vencido: "La verificación contra robots venció. Vuelve a intentarlo.",
  no_soportado: "Tu navegador no admite la verificación contra robots. Actualízalo o prueba con otro.",
  sin_respuesta: "La verificación contra robots no respondió. Revisa tu conexión y vuelve a intentarlo.",
  cancelado: "Se canceló la verificación contra robots. Vuelve a intentarlo.",
};

/** Lo que rechaza `obtenerToken`: el mensaje ya está en castellano, listo para mostrar. */
export class ErrorTurnstile extends Error {
  constructor(public codigo: CodigoTurnstile) {
    super(MENSAJE[codigo]);
    this.name = "ErrorTurnstile";
  }
}

let carga: Promise<ApiTurnstile> | null = null;

/**
 * El script de Turnstile, una vez por página (lo comparten todos los widgets). Si no carga
 * (bloqueado o sin red) rechaza con `sin_script`, y el próximo intento lo vuelve a pedir.
 */
export function cargarTurnstile(): Promise<ApiTurnstile> {
  if (typeof window === "undefined") return Promise.reject(new ErrorTurnstile("sin_script"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  carga ??= new Promise<ApiTurnstile>((resolve, reject) => {
    const previo = document.querySelector<HTMLScriptElement>(`script[src="${URL_SCRIPT}"]`);
    const script = previo ?? document.createElement("script");
    let listo = false;
    const terminar = (ok: boolean) => {
      if (listo) return;
      listo = true;
      window.clearTimeout(espera);
      if (ok && window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      carga = null;
      script.remove();
      reject(new ErrorTurnstile("sin_script"));
    };
    const espera = window.setTimeout(() => terminar(false), ESPERA_SCRIPT_MS);
    script.addEventListener("load", () => terminar(true));
    script.addEventListener("error", () => terminar(false));
    if (!previo) {
      script.src = URL_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return carga;
}
