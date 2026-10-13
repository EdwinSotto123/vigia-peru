"use client";

/**
 * Pago pendiente, siempre a mano: si creaste un aporte (VIG-…) y saliste sin pagar o sin subir el comprobante,
 * una ventana flotante lo sigue mostrando en cualquier página del sitio, minimizada o abierta.
 *
 *   · Se alimenta del borrador local de financiar (`vigia:financiar:*`, lib/cuentas) — sobrevive a recargar,
 *     cambiar de página y cerrar la pestaña (7 días, igual que el formulario). Sin cuenta también.
 *   · Se sincroniza entre pestañas (`storage`) y dentro de la misma (EVENTO_BORRADOR).
 *   · Minimizada (por defecto): una píldora con el monto y el código. Abierta: QR / número, comprobante y salidas.
 *   · No aparece en /admin ni en la página donde ese mismo aporte ya se está mostrando completo.
 *   · "Descartar" solo la quita de ESTE navegador: el aporte sigue en la base hasta que venza sin comprobante.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronUp, Clock, X } from "lucide-react";
import { soles, plural } from "@/lib/formato";
import { EVENTO_BORRADOR, borrarBorrador, hrefDeBorrador, listarPagosPendientes, type BorradorFinanciar } from "@/lib/cuentas";
import { PaymentMethods, type PagoPublico } from "./PaymentMethods";
import { SubirComprobante } from "./SubirComprobante";

type Pendiente = ReturnType<typeof listarPagosPendientes>[number];
const CLAVE_MIN = "vigia:pago-flotante:min";

const leerMin = () => { try { return localStorage.getItem(CLAVE_MIN) !== "0"; } catch { return true; } };

export function PagoPendienteFlotante() {
  const ruta = usePathname() ?? "";
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [minimizado, setMinimizado] = useState(true);
  const [indice, setIndice] = useState(0);

  const refrescar = useCallback(() => setPendientes(listarPagosPendientes()), []);
  useEffect(() => {
    refrescar();
    setMinimizado(leerMin());
    const alCambiar = (e: StorageEvent) => { if (!e.key || e.key.startsWith("vigia:financiar:")) refrescar(); };
    window.addEventListener("storage", alCambiar);
    window.addEventListener(EVENTO_BORRADOR, refrescar);
    return () => { window.removeEventListener("storage", alCambiar); window.removeEventListener(EVENTO_BORRADOR, refrescar); };
  }, [refrescar]);

  const cambiarMin = (v: boolean) => {
    setMinimizado(v);
    try { localStorage.setItem(CLAVE_MIN, v ? "1" : "0"); } catch { /* sin storage */ }
  };

  if (ruta.startsWith("/admin")) return null;
  // En la página de ese aporte el formulario ya muestra el pago completo: no se duplica.
  const visibles = pendientes.filter((p) => hrefDeBorrador(p.ubigeo).split("?")[0] !== ruta);
  if (visibles.length === 0) return null;
  const p = visibles[Math.min(indice, visibles.length - 1)];
  const c = p.creada;
  const href = hrefDeBorrador(p.ubigeo);
  const pago = c.pago as (PagoPublico & { concepto?: string; metodo?: string }) | undefined;

  return (
    <aside
      aria-label="Pago pendiente"
      className="fixed bottom-3 right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] pb-[env(safe-area-inset-bottom)] sm:bottom-4 sm:right-4"
    >
      <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-lg">
        <div className="flex items-center gap-2 px-3 py-2">
          <Clock size={16} className="shrink-0 text-granate" aria-hidden />
          <button
            type="button"
            onClick={() => cambiarMin(!minimizado)}
            aria-expanded={!minimizado}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-[13px] font-semibold text-ink">
              Pago pendiente · {soles(c.montoPen)}
            </span>
            <span className="block truncate font-mono text-[11px] text-mute">
              {c.codigo}{visibles.length > 1 ? ` · +${visibles.length - 1} más` : ""}
            </span>
          </button>
          <button
            type="button"
            onClick={() => cambiarMin(!minimizado)}
            aria-label={minimizado ? "Abrir el pago pendiente" : "Minimizar el pago pendiente"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-inkSoft hover:bg-granate-50 hover:text-ink"
          >
            {minimizado ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
          </button>
        </div>

        {!minimizado && (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto border-t border-line px-3 py-3">
            {visibles.length > 1 && (
              <label className="block text-[12px] text-inkSoft">
                Aporte
                <select
                  value={Math.min(indice, visibles.length - 1)}
                  onChange={(e) => setIndice(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-line bg-paper px-2 py-1.5 text-sm text-ink"
                >
                  {visibles.map((v, i) => (
                    <option key={v.creada.codigo} value={i}>{v.creada.codigo} · {soles(v.creada.montoPen)}</option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-[13px] leading-snug text-inkSoft">
              Financia {plural(c.contratos, "contrato", "contratos")}. Paga {soles(c.montoPen)} con el código{" "}
              <span className="font-mono font-semibold text-ink">{c.codigo}</span> como concepto y sube tu comprobante.
            </p>
            {pago && <PaymentMethods pago={pago as PagoPublico} monto={soles(c.montoPen)} concepto={c.codigo} metodoPreferido={pago.metodo} />}
            <SubirComprobante codigo={c.codigo} email={emailDe(p)} compacto onSubido={() => borrarBorrador(p.ubigeo)} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <Link href={href} className="font-semibold text-granate underline underline-offset-2">Ir a la página del aporte</Link>
              <button
                type="button"
                onClick={() => { if (window.confirm("¿Quitar este aviso de este navegador? El código seguirá existiendo hasta que venza.")) borrarBorrador(p.ubigeo); }}
                className="inline-flex items-center gap-1 text-mute underline underline-offset-2 hover:text-ink"
              >
                <X size={12} aria-hidden /> Descartar
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

const emailDe = (b: BorradorFinanciar) => b.email?.trim() || null;
