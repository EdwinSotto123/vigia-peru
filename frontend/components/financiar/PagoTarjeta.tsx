"use client";

/**
 * El formulario de tarjeta de Mercado Pago (Card Payment Brick) para el aporte de «Ayúdanos a seguir vigilando».
 * La tarjeta se escribe en los campos seguros de Mercado Pago: a Vigía sólo llega un token de un uso, que la API cobra
 * (backend/api/src/routes/pagos.ts). Sin cuotas: un aporte es un pago al contado. Sigue al modo día o noche.
 *
 * `onPagar` recibe lo que entrega el formulario y devuelve una promesa: si se rechaza (tarjeta rechazada, red caída),
 * el formulario queda listo para otro intento y el mensaje lo muestra quien lo usa.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useModo } from "@/lib/modo";

interface ControlBrick {
  unmount(): void;
}
interface MercadoPagoSdk {
  bricks(): { create(tipo: "cardPayment", contenedor: string, opciones: unknown): Promise<ControlBrick> };
}
declare global {
  interface Window {
    MercadoPago?: new (clavePublica: string, opciones?: { locale?: string }) => MercadoPagoSdk;
  }
}

/** Lo que entrega el formulario (los nombres de Vigía; el documento sólo va a Mercado Pago). */
export interface DatosTarjeta {
  token: string;
  paymentMethodId: string;
  issuerId?: string;
  email: string;
  identificacion?: { tipo: string; numero: string };
}

interface FormularioBrick {
  token: string;
  payment_method_id: string;
  issuer_id?: string | number;
  payer?: { email?: string; identification?: { type?: string; number?: string } };
}

const SDK = "https://sdk.mercadopago.com/js/v2";
const CONTENEDOR = "vigia-pago-tarjeta";
let cargaSdk: Promise<void> | null = null;

/** Un token de color de globals.css («R G B») como lo pide el formulario de Mercado Pago (#rrggbb). */
function colorDe(estilo: CSSStyleDeclaration, token: string): string | undefined {
  const [r, g, b] = estilo.getPropertyValue(`--${token}`).trim().split(/[\s,]+/).map(Number);
  const canales = [r, g, b];
  if (canales.some((n) => n === undefined || !Number.isFinite(n))) return undefined;
  return `#${canales.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Los colores de Vigía en el formulario (los del modo en que se dibuja, leídos donde está, así siguen a día y noche):
 * fondo del papel sin relleno propio, para que no sea una tarjeta dentro de otra, y el botón con el color de acción.
 */
function estiloVigia(caja: HTMLElement): Record<string, string> {
  const e = getComputedStyle(caja);
  const colores: Record<string, string | undefined> = {
    formBackgroundColor: colorDe(e, "paper"),
    inputBackgroundColor: colorDe(e, "paper"),
    baseColor: colorDe(e, "granate"),
    baseColorFirstVariant: colorDe(e, "granate-deep"),
    baseColorSecondVariant: colorDe(e, "granate-deep"),
    buttonTextColor: colorDe(e, "paper"),
    textPrimaryColor: colorDe(e, "ink"),
    textSecondaryColor: colorDe(e, "mute"),
    outlinePrimaryColor: colorDe(e, "paper-edge"),
    outlineSecondaryColor: colorDe(e, "line"),
    errorColor: colorDe(e, "crimson"),
    successColor: colorDe(e, "moss"),
  };
  const listos = Object.fromEntries(Object.entries(colores).filter((par): par is [string, string] => par[1] !== undefined));
  return { ...listos, formPadding: "0px", borderRadiusSmall: "8px", borderRadiusMedium: "12px", borderRadiusLarge: "12px" };
}

function cargarSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  cargaSdk ??= new Promise<void>((resolver, rechazar) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.async = true;
    s.onload = () => resolver();
    s.onerror = () => {
      cargaSdk = null;
      rechazar(new Error("sdk"));
    };
    document.head.appendChild(s);
  });
  return cargaSdk;
}

export function PagoTarjeta({
  clavePublica,
  monto,
  email,
  onPagar,
}: {
  clavePublica: string;
  monto: number;
  email?: string;
  onPagar: (datos: DatosTarjeta) => Promise<void>;
}) {
  const modo = useModo();
  const [listo, setListo] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);
  // El último `onPagar` (cambia en cada render); el formulario se arma una sola vez por monto, correo y modo.
  const pagar = useRef(onPagar);
  pagar.current = onPagar;

  useEffect(() => {
    let vivo = true;
    let control: ControlBrick | null = null;
    setListo(false);
    setFalla(null);
    cargarSdk()
      .then(async () => {
        if (!vivo || !window.MercadoPago) return;
        const mp = new window.MercadoPago(clavePublica, { locale: "es-PE" });
        control = await mp.bricks().create("cardPayment", CONTENEDOR, {
          initialization: { amount: monto, ...(email ? { payer: { email } } : {}) },
          customization: {
            visual: {
              // El título («Tarjeta de crédito o débito») ya lo dice la cabecera, con las tarjetas que acepta.
              hideFormTitle: true,
              style: {
                theme: modo === "noche" ? "dark" : "default",
                ...(caja.current ? { customVariables: estiloVigia(caja.current) } : {}),
              },
            },
            paymentMethods: { maxInstallments: 1 },
          },
          callbacks: {
            onReady: () => vivo && setListo(true),
            onSubmit: (d: FormularioBrick) =>
              pagar.current({
                token: d.token,
                paymentMethodId: d.payment_method_id,
                issuerId: d.issuer_id != null ? String(d.issuer_id) : undefined,
                email: d.payer?.email ?? email ?? "",
                identificacion: d.payer?.identification?.number
                  ? { tipo: d.payer.identification.type ?? "DNI", numero: d.payer.identification.number }
                  : undefined,
              }),
            onError: () => vivo && setFalla("El formulario de la tarjeta tuvo un problema. Recarga la página o aporta con Yape o Plin."),
          },
        });
        if (!vivo) control.unmount();
      })
      .catch(() => vivo && setFalla("No se pudo cargar el formulario de Mercado Pago. Revisa tu conexión o aporta con Yape o Plin."));
    return () => {
      vivo = false;
      control?.unmount();
    };
  }, [clavePublica, monto, email, modo]);

  return (
    <div className="min-w-0">
      {!listo && !falla && (
        <p className="inline-flex items-center gap-2 text-dato text-inkSoft">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Cargando el formulario seguro de Mercado Pago…
        </p>
      )}
      {falla && (
        <p className="text-dato leading-5 text-crimsonTexto" role="alert">
          {falla}
        </p>
      )}
      <div id={CONTENEDOR} ref={caja} />
    </div>
  );
}
