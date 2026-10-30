"use client";

/**
 * El pago «Con QR» (Yape o Plin) o por transferencia de un aporte de «Ayúdanos a seguir vigilando», en tres pasos
 * numerados: pagar (QR y número, o la cuenta), poner el código en el mensaje y listo, con la captura como opción para
 * validarlo antes. Reemplaza, en este formulario, a la pantalla de PaymentMethods (pedido del usuario del 2026-10-30:
 * «se ve feo y mucho texto»): una sola app a la vista, con su QR grande, y el plazo de validación dicho una vez.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, Landmark, Mail, QrCode, Upload } from "lucide-react";
import { soles } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { MarcaPlin, MarcaYape } from "./MarcasPago";
import { BrandBadge, CopyValue, type PagoPublico } from "./PaymentMethods";
import { SubirComprobante } from "./SubirComprobante";
import { TARJETA } from "./PasosAporte";

type Cartera = "yape" | "plin";

function Paso({ n, titulo, children }: { n: number; titulo: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-granate text-rotulo font-bold tabular-nums text-paper">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-dato font-semibold leading-6 text-ink">{titulo}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

export function PagoConQr({
  pago,
  metodo,
  montoPen,
  mensual,
  codigo,
  email,
  onSubido,
  acciones,
}: {
  pago: PagoPublico;
  /** El medio con el que se registró el aporte: yape, plin o transferencia. */
  metodo: string;
  montoPen: number;
  mensual: boolean;
  codigo: string;
  /** El correo con el que se registró (para adjuntar la captura sin pedirlo de nuevo). */
  email: string | null;
  onSubido: () => void;
  /** Lo de abajo: ver el comprobante, cambiar a Mercado Pago, hacer otro aporte. */
  acciones: ReactNode;
}) {
  const carteras = (["yape", "plin"] as Cartera[]).filter((k) => pago[k]);
  const esTransferencia = metodo === "transferencia" || carteras.length === 0;
  const [cartera, setCartera] = useState<Cartera>(metodo === "plin" && pago.plin ? "plin" : carteras[0] ?? "yape");
  const w = pago[cartera];
  const app = cartera === "yape" ? "Yape" : "Plin";

  return (
    <div className={TARJETA}>
      <p className="inline-flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
        {esTransferencia ? <Landmark size={15} aria-hidden /> : <QrCode size={15} aria-hidden />}
        {esTransferencia ? "Transferencia bancaria" : "Con QR"}
      </p>
      <h2 className="mt-1 font-display text-bloque font-bold leading-snug text-ink text-balance">
        Paga {soles(montoPen)} {esTransferencia ? "por transferencia" : carteras.length > 1 ? "con Yape o Plin" : `con ${app}`}
      </h2>
      {mensual && <p className="mt-1 text-rotulo text-inkSoft">Es tu aporte de este mes: cada mes se paga de nuevo.</p>}

      {!esTransferencia && carteras.length > 1 && (
        <div role="group" aria-label="Con qué app pagas" className="mt-4 inline-flex gap-1 rounded-full border border-line p-1">
          {carteras.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={cartera === k}
              aria-label={k === "yape" ? "Yape" : "Plin"}
              onClick={() => setCartera(k)}
              className={cn(
                "inline-flex min-h-[36px] items-center rounded-full px-2.5 transition-colors duration-150",
                cartera === k ? "bg-paperDeep" : "opacity-60 hover:opacity-100",
              )}
            >
              {k === "yape" ? <MarcaYape /> : <MarcaPlin />}
            </button>
          ))}
        </div>
      )}

      <ol className="mt-5 space-y-5">
        {esTransferencia ? (
          <Paso n={1} titulo="Transfiere a esta cuenta">
            <ul className="space-y-3">
              {pago.cuentas.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <BrandBadge brand={c.banco} />
                  <span className="text-rotulo text-mute">{c.tipo} {c.moneda}</span>
                  {c.numero && <CopyValue value={c.numero} label="cuenta" />}
                  {c.cci && <CopyValue value={c.cci} label="CCI" />}
                  {c.titular && <span className="text-rotulo text-mute">A nombre de {c.titular}</span>}
                </li>
              ))}
            </ul>
          </Paso>
        ) : (
          w && (
            <Paso n={1} titulo={w.qrUrl ? `Escanea el QR con ${app} o usa el número` : `Paga con ${app} a este número`}>
              {w.qrUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={w.qrUrl} alt={`QR de ${app} para pagar a Vigía`} className="h-44 w-44 rounded-xl border border-line bg-paper object-contain" />
              )}
              <div className={w.qrUrl ? "mt-3" : ""}>
                <CopyValue value={w.numero} label="número" size="lg" />
              </div>
              {w.titular && (
                <p className="mt-1.5 text-rotulo text-mute">
                  A nombre de <span className="text-ink">{w.titular}</span>
                </p>
              )}
            </Paso>
          )
        )}

        <Paso n={2} titulo={esTransferencia ? "Pon tu código como concepto" : `Pon tu código en el mensaje del ${app}`}>
          <CopyValue value={codigo} size="lg" />
          <p className="mt-1.5 text-rotulo text-mute">Así sabemos que el pago es tuyo.</p>
        </Paso>

        <Paso n={3} titulo="Listo: lo validamos en menos de 48 h">
          <details className="group">
            <summary className="inline-flex min-h-[32px] cursor-pointer list-none items-center gap-1.5 text-dato font-medium text-granate hover:underline [&::-webkit-details-marker]:hidden">
              <Upload size={14} aria-hidden /> Sube la captura y lo validamos antes
              <ChevronDown size={14} aria-hidden className="transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <div className="mt-3">
              <SubirComprobante codigo={codigo} email={email} onSubido={onSubido} compacto />
              <p className="mt-2 text-rotulo text-mute">Se guarda en privado: sólo la ve quien valida.</p>
            </div>
          </details>
        </Paso>
      </ol>

      <div className="mt-6 flex flex-col items-start gap-3 border-t border-line pt-4">{acciones}</div>
      {pago.contactoEmail && (
        <p className="mt-3 flex flex-wrap items-center gap-1 text-rotulo text-mute">
          <Mail size={12} aria-hidden /> ¿Dudas o necesitas recibo?{" "}
          <a href={`mailto:${pago.contactoEmail}?subject=${encodeURIComponent(`Aporte ${codigo}`)}`} className="text-granate underline underline-offset-2">
            {pago.contactoEmail}
          </a>
        </p>
      )}
    </div>
  );
}
