import type { ReactNode } from "react";
import { CreditCard, Inbox, Mail, Megaphone, QrCode, Receipt, ShieldCheck } from "lucide-react";
import { MarcaMercadoPago, MarcaPlin, MarcaYape, TarjetasAceptadas } from "@/components/financiar/MarcasPago";
import { Nota } from "@/components/patrones/Estructura";
import type { PlanesServidor } from "@/lib/gobserva-planes";
import { cn } from "@/lib/utils";

/**
 * Debajo de los planes de un producto (2026-11-01): cómo se empieza, en pasos numerados, y cómo se paga, con los medios
 * abiertos en el panel (tarjeta por Mercado Pago, Yape o Plin por meses, con sus marcas) y el comprobante que corresponde:
 * recibo con RUC o constancia de pago, según la configuración del vendedor. Mientras los correos no salen, lo dice.
 * Server-safe.
 */
type MedioPago = { Icono: typeof CreditCard; titulo: string; marcas?: ReactNode; texto: string };

/** `sinPagos`: con los cobros en pausa (2026-11-24) no hay medios de pago que mostrar: la cuenta es gratis. */
export function ComoFunciona({ pasos, cat, className, sinPagos = false }: { pasos: { titulo: string; texto: string }[]; cat: PlanesServidor; className?: string; sinPagos?: boolean }) {
  const medios = ([
    cat.medios.tarjeta && {
      Icono: CreditCard,
      titulo: "Tarjeta de crédito o débito",
      marcas: <><MarcaMercadoPago /><TarjetasAceptadas /></>,
      texto: "Con Mercado Pago. Se cobra cada mes y lo cancelas desde tu cuenta cuando quieras.",
    },
    cat.medios.qr && {
      Icono: QrCode,
      titulo: cat.medios.yape && !cat.medios.plin ? "Yape" : !cat.medios.yape && cat.medios.plin ? "Plin" : "Yape o Plin",
      marcas: cat.medios.yape || cat.medios.plin ? <>{cat.medios.yape && <MarcaYape />}{cat.medios.plin && <MarcaPlin />}</> : null,
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
  ] as (MedioPago | false)[]).filter((m): m is MedioPago => !!m);

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
        <h2 className="font-display text-bloque font-bold leading-tight text-ink">{sinPagos ? "Sin pagos, por ahora" : "Cómo pagas"}</h2>
        {sinPagos && (
          <p className="mt-3 flex items-start gap-3 text-dato leading-relaxed text-inkSoft">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
              <ShieldCheck size={18} aria-hidden />
            </span>
            <span>Tu cuenta es gratis y no te pedimos tarjeta ni datos de pago. Los planes de pago llegan pronto.</span>
          </p>
        )}
        <ul className="mt-5 space-y-4" hidden={sinPagos}>
          {medios.map(({ Icono, titulo, marcas, texto }) => (
            <li key={titulo} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
                <Icono size={18} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-dato font-semibold text-ink">{titulo}</span>
                {marcas && <span className="my-1.5 flex flex-wrap items-center gap-1.5">{marcas}</span>}
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
