import { CreditCard, Inbox, Mail, Megaphone, QrCode, Receipt, ShieldCheck } from "lucide-react";
import { Nota } from "@/components/patrones/Estructura";
import type { PlanesServidor } from "@/lib/gobserva-planes";
import { cn } from "@/lib/utils";

/**
 * Debajo de los planes de un producto (2026-11-01): cómo se empieza, en pasos numerados, y cómo se paga, con los medios
 * abiertos en el panel (tarjeta por Mercado Pago, Yape o Plin por meses) y el comprobante que corresponde: recibo con RUC
 * o constancia de pago, según la configuración del vendedor. Mientras los correos no salen, lo dice. Server-safe.
 */
export function ComoFunciona({ pasos, cat, className }: { pasos: { titulo: string; texto: string }[]; cat: PlanesServidor; className?: string }) {
  const medios = [
    cat.medios.tarjeta && {
      Icono: CreditCard,
      titulo: "Tarjeta de crédito o débito",
      texto: "Con Mercado Pago. Se cobra cada mes y lo cancelas desde tu cuenta cuando quieras.",
    },
    cat.medios.qr && {
      Icono: QrCode,
      titulo: "Yape o Plin",
      texto: "Pagas 1, 3, 6 o 12 meses de una vez. Activamos tu plan apenas validamos la operación.",
    },
    {
      Icono: Receipt,
      titulo: cat.ruc ? "Recibo de cada pago" : "Constancia de cada pago",
      texto: `Queda en tu cuenta, lista para imprimir${cat.ruc ? ", con nuestro RUC" : ""}. Si necesitas boleta o factura, escríbenos.`,
    },
    cat.medios.tarjeta && {
      Icono: ShieldCheck,
      titulo: "Pago seguro",
      texto: "Los datos de tu tarjeta los recibe Mercado Pago. Gobserva nunca los ve ni los guarda.",
    },
  ].filter((m): m is { Icono: typeof CreditCard; titulo: string; texto: string } => !!m);

  return (
    <section aria-labelledby="como-t" id="como-funciona" className={cn("grid scroll-mt-24 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", className)}>
      <div className="min-w-0">
        <h2 id="como-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">Cómo funciona</h2>
        <ol className="mt-6 space-y-5">
          {pasos.map((p, i) => (
            <li key={p.titulo} className="flex gap-4">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-dato font-bold text-paper">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-cuerpo font-semibold text-ink">{p.titulo}</span>
                <span className="mt-0.5 block text-dato leading-relaxed text-inkSoft">{p.texto}</span>
              </span>
            </li>
          ))}
        </ol>
        {!cat.correoActivo && (
          <Nota icono={<Inbox size={15} aria-hidden />} className="mt-6">
            Los correos de las alertas salen en los próximos días. Mientras tanto, lo nuevo de tus alertas te espera cada mañana en tu cuenta, en «Lo último
            que te avisamos».
          </Nota>
        )}
      </div>

      <div className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-7">
        <h2 className="font-display text-bloque font-bold leading-tight text-ink">Cómo pagas</h2>
        <ul className="mt-5 space-y-4">
          {medios.map(({ Icono, titulo, texto }) => (
            <li key={titulo} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
                <Icono size={18} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-dato font-semibold text-ink">{titulo}</span>
                <span className="block text-meta leading-relaxed text-inkSoft">{texto}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-6 flex items-start gap-2 border-t border-line pt-4 text-meta leading-relaxed text-inkSoft">
          <Mail size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
          <span>
            ¿Varias cuentas, factura o una demo para tu equipo? Escríbenos a{" "}
            <a href="mailto:hello@gobserva.cloud" className="font-semibold text-granate underline-offset-2 hover:underline">hello@gobserva.cloud</a>.
          </span>
        </p>
      </div>
    </section>
  );
}

/** El aviso del panel arriba de los planes («Precio de fundador hasta el 30 de noviembre»). */
export function AvisoPlanes({ texto, className }: { texto: string | null; className?: string }) {
  if (!texto) return null;
  return (
    <p className={cn("inline-flex max-w-full items-start gap-2 rounded-2xl border border-granate/30 bg-granate-50 px-4 py-2.5 text-dato font-semibold text-granate", className)}>
      <Megaphone size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0">{texto}</span>
    </p>
  );
}
