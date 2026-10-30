/**
 * Las marcas de los medios de pago que acepta el aporte: Mercado Pago y las tarjetas que cobra (Visa, Mastercard,
 * American Express, Diners Club, de crédito o débito, activas en la cuenta al 2026-10-30), y Yape y Plin por QR.
 *
 * Dibujadas acá (letras y formas con el color de cada marca), sin imágenes de otros sitios: la página no le avisa a
 * nadie de cada visita y no espera descargas. Como los badges de PaymentMethods, son la única excepción a «sólo
 * tokens»: cada marca conserva su color. Las de tarjeta van en una placa blanca con el borde del tema, así se leen
 * igual de día y de noche. Todas miden 24 px de alto.
 */

import { Handshake } from "lucide-react";
import { cn } from "@/lib/utils";

const PLACA = "inline-flex h-6 shrink-0 items-center justify-center rounded-md";
const PLACA_BLANCA = cn(PLACA, "w-10 border border-line");
const BLANCO = "#FFFFFF";

export function MarcaMercadoPago({ className }: { className?: string }) {
  return (
    <span className={cn(PLACA, "gap-1 px-2 text-rotulo font-bold leading-none tracking-tight", className)} style={{ background: "#009EE3", color: BLANCO }}>
      <Handshake size={14} aria-hidden />
      mercado pago
    </span>
  );
}

export function MarcaVisa() {
  return (
    <span className={PLACA_BLANCA} style={{ background: BLANCO }} role="img" aria-label="Visa">
      <svg viewBox="0 0 34 12" className="h-3" aria-hidden>
        <text x="17" y="10.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="12" fontStyle="italic" fontWeight="900" fill="#1A1F71">VISA</text>
      </svg>
    </span>
  );
}

export function MarcaMastercard() {
  return (
    <span className={PLACA_BLANCA} style={{ background: BLANCO }} role="img" aria-label="Mastercard">
      <svg viewBox="0 0 26 16" className="h-4" aria-hidden>
        <circle cx="9" cy="8" r="7" fill="#EB001B" />
        <circle cx="17" cy="8" r="7" fill="#F79E1B" />
        {/* La parte que comparten los dos círculos. */}
        <path d="M13 2.255A7 7 0 0 1 13 13.745A7 7 0 0 1 13 2.255Z" fill="#FF5F00" />
      </svg>
    </span>
  );
}

export function MarcaAmex() {
  return (
    <span className={cn(PLACA, "w-10")} style={{ background: "#016FD0" }} role="img" aria-label="American Express">
      <svg viewBox="0 0 34 12" className="h-3" aria-hidden>
        <text x="17" y="10" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="10.5" fontWeight="900" fill={BLANCO}>AMEX</text>
      </svg>
    </span>
  );
}

export function MarcaDiners() {
  return (
    <span className={PLACA_BLANCA} style={{ background: BLANCO }} role="img" aria-label="Diners Club">
      <svg viewBox="0 0 34 12" className="h-3" aria-hidden>
        <text x="17" y="9.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="9.5" fontWeight="800" fill="#0079BE">Diners</text>
      </svg>
    </span>
  );
}

export function MarcaYape({ grande = false }: { grande?: boolean }) {
  return (
    <span className={cn(PLACA, "px-2 font-bold leading-none tracking-tight", grande ? "h-8 px-3 text-destacado" : "text-dato")} style={{ background: "#742284", color: BLANCO }}>
      yape
    </span>
  );
}

export function MarcaPlin({ grande = false }: { grande?: boolean }) {
  return (
    <span className={cn(PLACA, "px-2 font-bold leading-none tracking-tight", grande ? "h-8 px-3 text-destacado" : "text-dato")} style={{ background: "#00B398", color: BLANCO }}>
      plin
    </span>
  );
}

/** Las tarjetas que cobra Mercado Pago en la cuenta de Vigía, en una fila con su nombre para el lector de pantalla. */
export function TarjetasAceptadas({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)} role="list" aria-label="Tarjetas que acepta: Visa, Mastercard, American Express y Diners Club">
      <span role="listitem"><MarcaVisa /></span>
      <span role="listitem"><MarcaMastercard /></span>
      <span role="listitem"><MarcaAmex /></span>
      <span role="listitem"><MarcaDiners /></span>
    </span>
  );
}
