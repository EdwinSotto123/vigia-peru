"use client";

/**
 * Medios de pago (fase 0): Yape / Plin con QR, cuentas bancarias con CCI,
 * botón "copiar" en cada dato y el código del aporte siempre visible.
 * Las marcas se representan con badges tipográficos (colores de marca), no con
 * logos descargados: evita problemas de uso de marca y carga de imágenes.
 */

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";

export interface PagoPublico {
  yape: { numero: string; titular: string; qrUrl: string | null } | null;
  plin: { numero: string; titular: string; qrUrl: string | null } | null;
  cuentas: { banco: string; moneda: "PEN" | "USD"; tipo: string; numero: string; cci: string; titular: string }[];
  instrucciones: string;
  contactoEmail: string | null;
  configurado: boolean;
}

const BRAND: Record<string, { bg: string; fg: string; label: string }> = {
  yape: { bg: "#742284", fg: "#FFFFFF", label: "yape" },
  plin: { bg: "#00B398", fg: "#FFFFFF", label: "plin" },
  BCP: { bg: "#002A8D", fg: "#FF6A13", label: "BCP" },
  BBVA: { bg: "#072146", fg: "#FFFFFF", label: "BBVA" },
  Interbank: { bg: "#00A94F", fg: "#FFFFFF", label: "Interbank" },
  Scotiabank: { bg: "#EC111A", fg: "#FFFFFF", label: "Scotiabank" },
  "Banco de la Nación": { bg: "#B2001F", fg: "#FFFFFF", label: "Banco de la Nación" },
  BanBif: { bg: "#0057A8", fg: "#FFFFFF", label: "BanBif" },
  Pichincha: { bg: "#FFDD00", fg: "#14171A", label: "Pichincha" },
};

export function BrandBadge({ brand, size = "md" }: { brand: string; size?: "md" | "lg" }) {
  const b = BRAND[brand] ?? { bg: "#14171A", fg: "#FFFFFF", label: brand };
  return (
    <span className={`inline-flex items-center rounded-md font-bold tracking-tight ${size === "lg" ? "px-2.5 py-1 text-base" : "px-2 py-0.5 text-xs"}`} style={{ background: b.bg, color: b.fg }}>
      {b.label}
    </span>
  );
}

export function CopyValue({ value, label, mono = true }: { value: string; label?: string; mono?: boolean }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin clipboard */ }
  }
  return (
    <button type="button" onClick={copy} className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1 text-left hover:bg-paperDeep" title="Copiar">
      {label && <span className="text-[11px] text-mute">{label}</span>}
      <span className={`truncate text-sm text-ink ${mono ? "font-mono" : ""}`}>{value}</span>
      {ok ? <Check size={12} className="shrink-0 text-moss" /> : <Copy size={12} className="shrink-0 text-mute group-hover:text-ink" />}
    </button>
  );
}

export function PaymentMethods({ pago, monto, concepto, metodoPreferido }: { pago: PagoPublico; monto: string; concepto: string; metodoPreferido?: string }) {
  if (!pago.configurado) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-sm text-mute">
        Los medios de pago todavía no están configurados. Te escribimos con los datos{pago.contactoEmail ? ` desde ${pago.contactoEmail}` : ""} en las próximas horas.
      </div>
    );
  }
  const wallets = [pago.yape && { k: "yape", ...pago.yape }, pago.plin && { k: "plin", ...pago.plin }].filter(Boolean) as { k: string; numero: string; titular: string; qrUrl: string | null }[];
  const order = (k: string) => (k === metodoPreferido ? 0 : 1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ink px-4 py-3 text-paper">
        <span className="text-sm">Monto exacto</span><span className="font-mono text-lg font-semibold">{monto}</span>
        <span className="mx-1 text-paper/40">·</span>
        <span className="text-sm">Concepto</span><span className="font-mono text-lg font-semibold">{concepto}</span>
      </div>

      {wallets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {wallets.sort((a, b) => order(a.k) - order(b.k)).map((w) => (
            <div key={w.k} className={`rounded-xl border p-4 ${w.k === metodoPreferido ? "border-ink" : "border-line"}`}>
              <div className="flex items-center justify-between"><BrandBadge brand={w.k} size="lg" />{w.k === metodoPreferido && <span className="text-[11px] text-mute">tu método</span>}</div>
              <div className="mt-3 flex items-start gap-3">
                {w.qrUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={w.qrUrl} alt={`QR ${w.k}`} className="h-24 w-24 rounded-lg border border-line object-contain" />}
                <div className="min-w-0 space-y-1.5">
                  <CopyValue value={w.numero} label="número" />
                  {w.titular && <div className="text-[12px] text-mute">Titular: <span className="text-ink">{w.titular}</span></div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pago.cuentas.length > 0 && (
        <div className="rounded-xl border border-line p-4">
          <div className="text-[11px] uppercase tracking-wide text-mute">Transferencia bancaria</div>
          <ul className="mt-2 space-y-3">
            {pago.cuentas.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <BrandBadge brand={c.banco} />
                <span className="text-[12px] text-mute">{c.tipo} {c.moneda}</span>
                {c.numero && <CopyValue value={c.numero} label="cuenta" />}
                {c.cci && <CopyValue value={c.cci} label="CCI" />}
                {c.titular && <span className="text-[12px] text-mute">· {c.titular}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-mute">{pago.instrucciones}</p>
      {pago.contactoEmail && <p className="flex items-center gap-1 text-[12px] text-mute"><Mail size={12} /> ¿Problemas con el pago o necesitas recibo? <a href={`mailto:${pago.contactoEmail}?subject=${encodeURIComponent(`Aporte ${concepto}`)}`} className="underline">{pago.contactoEmail}</a></p>}
    </div>
  );
}
