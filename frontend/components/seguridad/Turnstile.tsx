"use client";

/**
 * Verificación contra robots (Cloudflare Turnstile) de los formularios públicos.
 *
 *   const verificacion = useTurnstile("denuncia");
 *   …
 *   const token = await verificacion.obtenerToken(); // uno NUEVO por pedido
 *   fetch(url, { headers: { ...cabeceraTurnstile(token) } });
 *   …
 *   {verificacion.widget}  // junto al botón que envía
 *
 * Cómo se ve: el widget es "managed" con apariencia `interaction-only`, así que a casi todos
 * no se les muestra nada; sólo si Cloudflare duda aparece la casilla, con una línea que dice
 * por qué. Nada de texto fijo de relleno.
 *
 * Un token sirve UNA vez: el primer pedido dibuja el widget (que resuelve el desafío) y cada
 * pedido siguiente lo reinicia (`reset`), que vuelve a resolverlo y entrega otro token. Los
 * pedidos se atienden en fila, así que dos subidas seguidas nunca comparten token.
 *
 * Sin `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (desarrollo) no hay widget y `obtenerToken` da `null`:
 * los pedidos van sin cabecera (el servidor sin secreto tampoco la exige).
 *
 * `obtenerToken` rechaza con `ErrorTurnstile`, con el mensaje en castellano: script bloqueado,
 * desafío fallido o vencido, navegador sin soporte. Nunca se envía un pedido sin token cuando
 * la verificación está activa.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorTurnstile, SITE_KEY_TURNSTILE, cargarTurnstile, type CodigoTurnstile } from "./turnstile-api";

export { ErrorTurnstile } from "./turnstile-api";

/** Sin token ni casilla visible en este tiempo, se da por perdido (iframe bloqueado, red caída). */
const SIN_RESPUESTA_MS = 30_000;
/** Ancho mínimo del widget `normal`/`flexible`; por debajo se usa el `compact` (150 px). */
const ANCHO_WIDGET = 300;

interface Pendiente {
  resolver: (token: string) => void;
  rechazar: (e: ErrorTurnstile) => void;
}

export interface Verificacion {
  /** Un token nuevo para UN pedido protegido; `null` sin sitekey (desarrollo). Rechaza con `ErrorTurnstile`. */
  obtenerToken: () => Promise<string | null>;
  /** El lugar del widget: junto al botón que envía, donde se vea si hay que marcar la casilla. */
  widget: ReactNode;
}

/**
 * @param accion nombre corto del formulario (letras, números, `-` y `_`, hasta 32): aparece en las
 *   estadísticas de Turnstile para separar aportes, comprobantes y denuncias.
 */
export function useTurnstile(accion: string, className?: string): Verificacion {
  const activo = SITE_KEY_TURNSTILE !== "";
  const contenedor = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const pendiente = useRef<Pendiente | null>(null);
  const reloj = useRef<number | null>(null);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const [interactivo, setInteractivo] = useState(false);

  // El script se pide al montar: así el primer envío no espera la descarga.
  useEffect(() => {
    if (activo) cargarTurnstile().catch(() => {});
  }, [activo]);

  /** Saca el pedido en curso (si hay) y apaga su reloj. */
  const soltar = useCallback((): Pendiente | null => {
    if (reloj.current != null) {
      window.clearTimeout(reloj.current);
      reloj.current = null;
    }
    const p = pendiente.current;
    pendiente.current = null;
    return p;
  }, []);

  const fallar = useCallback(
    (codigo: CodigoTurnstile) => {
      setInteractivo(false);
      soltar()?.rechazar(new ErrorTurnstile(codigo));
    },
    [soltar],
  );

  useEffect(
    () => () => {
      const id = widgetId.current;
      widgetId.current = null;
      if (id) {
        try {
          window.turnstile?.remove(id);
        } catch {
          // ya no estaba
        }
      }
      soltar()?.rechazar(new ErrorTurnstile("cancelado"));
    },
    [soltar],
  );

  const pedirUno = useCallback(async (): Promise<string> => {
    const ts = await cargarTurnstile();
    const el = contenedor.current;
    if (!el) throw new ErrorTurnstile("cancelado");
    return new Promise<string>((resolve, reject) => {
      pendiente.current = { resolver: resolve, rechazar: reject };
      reloj.current = window.setTimeout(() => fallar("sin_respuesta"), SIN_RESPUESTA_MS);
      try {
        if (widgetId.current) {
          // El token anterior ya se usó: reiniciar vuelve a resolver el desafío y trae uno nuevo.
          ts.reset(widgetId.current);
          return;
        }
        const id = ts.render(el, {
          sitekey: SITE_KEY_TURNSTILE,
          action: accion,
          // El sitio no tiene modo oscuro: con `auto`, un sistema en oscuro mostraría una casilla
          // negra sobre el papel claro.
          theme: "light",
          language: "es",
          size: el.clientWidth >= ANCHO_WIDGET ? "flexible" : "compact",
          appearance: "interaction-only",
          // Cada token se entrega apenas llega y se usa en el acto; para el siguiente pedido se
          // reinicia el widget. Nada se renueva ni se reintenta solo.
          retry: "never",
          "refresh-expired": "never",
          "refresh-timeout": "never",
          "response-field": false,
          callback: (token) => {
            setInteractivo(false);
            soltar()?.resolver(token);
          },
          "error-callback": (codigo) => {
            console.warn("[turnstile] error", codigo);
            // 200500: no cargó el iframe del desafío (bloqueador o red), igual que el script.
            fallar(String(codigo).startsWith("200500") ? "sin_script" : "fallo");
            return true;
          },
          "timeout-callback": () => fallar("vencido"),
          "unsupported-callback": () => fallar("no_soportado"),
          "before-interactive-callback": () => {
            // Hay que marcar la casilla: se espera a la persona, sin reloj.
            if (reloj.current != null) {
              window.clearTimeout(reloj.current);
              reloj.current = null;
            }
            setInteractivo(true);
          },
          "after-interactive-callback": () => setInteractivo(false),
        });
        if (!id) throw new Error("render sin id");
        widgetId.current = id;
      } catch (e) {
        console.warn("[turnstile]", (e as Error).message);
        fallar("fallo");
      }
    });
  }, [accion, fallar, soltar]);

  const obtenerToken = useCallback((): Promise<string | null> => {
    if (!activo) return Promise.resolve(null);
    // En fila: cada pedido espera al anterior, así nadie recibe un token que ya tiene otro.
    const p = fila.current.then(pedirUno, pedirUno);
    fila.current = p.catch(() => undefined);
    return p;
  }, [activo, pedirUno]);

  const widget = activo ? (
    <div role="group" aria-label="Verificación contra robots" className={cn(interactivo && "my-3", className)}>
      <p aria-live="polite" className={interactivo ? "mb-2 flex items-center gap-1.5 text-rotulo text-inkSoft" : "sr-only"}>
        {interactivo && (
          <>
            <ShieldCheck size={13} className="shrink-0 text-granate" aria-hidden />
            Verificamos que no seas un robot: marca la casilla para continuar.
          </>
        )}
      </p>
      <div ref={contenedor} className="max-w-full" />
    </div>
  ) : null;

  return { obtenerToken, widget };
}
