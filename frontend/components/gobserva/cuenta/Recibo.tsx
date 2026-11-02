"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, Printer } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import { NOMBRE_MEDIO, cargarRecibo, fechaLarga, soles2 } from "@/lib/gobserva-cuenta";
import { MarcaGobserva } from "../MarcaGobserva";
import { Aviso, Esqueleto, useSesion } from "./comun";

/**
 * El recibo de un pago (o la constancia de pago, mientras el vendedor no tenga RUC en la configuración del panel): quién
 * vende, quién paga, qué y cuánto. Se imprime o se guarda en PDF desde el navegador.
 */
export function Recibo({ producto, base, numero }: { producto: Producto; base: string; numero: string }) {
  const { conCuenta, loading } = useSesion();
  const { data: r, error } = useSWR(conCuenta ? ["gobserva-recibo", numero] : null, () => cargarRecibo(numero));
  if (loading || (conCuenta && !r && !error)) return <div className="container-page max-w-3xl py-10"><Esqueleto className="h-[28rem]" /></div>;
  if (!conCuenta) {
    return (
      <div className="container-page max-w-xl py-12">
        <Aviso>Entra a tu cuenta para ver tus recibos.</Aviso>
        <Link href={rutaEn(base, `/entrar?next=${encodeURIComponent(`/cuenta/recibo/${numero}`)}`)} className={claseAccion("primario", "mt-4")}>Entrar</Link>
      </div>
    );
  }
  if (error || !r) return <div className="container-page max-w-xl py-12"><Aviso tono="error">{(error as Error | undefined)?.message ?? "No encontramos ese recibo."}</Aviso></div>;

  const conRuc = !!r.vendedor.ruc;
  const comprador = r.razonSocial || r.empresa || r.nombre || r.email;
  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={rutaEn(base, "/cuenta?tab=pagos")} className="inline-flex items-center gap-1.5 text-dato font-semibold text-granate hover:underline">
          <ArrowLeft size={15} aria-hidden /> Mis pagos
        </Link>
        <button type="button" onClick={() => window.print()} className={claseAccion("secundario")}>
          <Printer size={15} aria-hidden /> Imprimir o guardar en PDF
        </button>
      </div>
      <article className="rounded-3xl border border-line bg-paper p-6 sm:p-10 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <MarcaGobserva producto={producto} />
            <p className="mt-3 text-meta leading-relaxed text-inkSoft">
              {r.vendedor.razonSocial || r.vendedor.nombreComercial}
              {conRuc && <><br />RUC {r.vendedor.ruc}</>}
              {r.vendedor.direccion && <><br />{r.vendedor.direccion}</>}
              <br />{r.vendedor.correo}
            </p>
          </div>
          <div className="text-right">
            <p className="text-meta font-semibold text-mute">{conRuc ? "Recibo" : "Constancia de pago"}</p>
            <p className="font-mono text-bloque font-bold text-ink">{r.numero}</p>
            <p className="mt-1 text-meta text-inkSoft">{fechaLarga(r.pagado ?? r.creado)}</p>
            <p className="mt-2 inline-block rounded-full bg-granate-50 px-2.5 py-0.5 text-rotulo font-semibold text-granate">
              {r.estado === "pagado" ? "Pagado" : r.estado === "reembolsado" ? "Devuelto" : "Por confirmar"}
            </p>
          </div>
        </header>

        <section className="grid gap-4 border-b border-line py-5 sm:grid-cols-2">
          <div>
            <p className="text-meta font-semibold text-mute">Cliente</p>
            <p className="mt-1 text-dato font-semibold text-ink">{comprador}</p>
            {r.ruc && <p className="text-meta text-inkSoft">RUC {r.ruc}</p>}
            {r.direccionFiscal && <p className="text-meta text-inkSoft">{r.direccionFiscal}</p>}
            <p className="text-meta text-inkSoft">{r.email}</p>
          </div>
          <div>
            <p className="text-meta font-semibold text-mute">Medio de pago</p>
            <p className="mt-1 text-dato text-ink">{NOMBRE_MEDIO[r.medio]}</p>
            {r.operacion && <p className="text-meta text-inkSoft">Operación {r.operacion}</p>}
            <p className="text-meta text-inkSoft">Plan {r.codigo}</p>
          </div>
        </section>

        <table className="mt-5 w-full text-left text-dato">
          <thead>
            <tr className="border-b border-line text-meta text-mute">
              <th scope="col" className="py-2 font-semibold">Descripción</th>
              <th scope="col" className="py-2 text-right font-semibold">Importe</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="py-3 text-ink">
                {r.nombreProducto}, plan {r.nombrePlan}
                <span className="block text-meta text-inkSoft">{r.meses} {r.meses === 1 ? "mes" : "meses"} de suscripción</span>
              </td>
              <td className="py-3 text-right font-semibold tabular-nums text-ink">{soles2(r.monto)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 text-right font-semibold text-ink">Total</td>
              <td className="pt-4 text-right font-display text-bloque font-bold tabular-nums text-ink">{soles2(r.monto)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-8 text-meta leading-relaxed text-mute">
          {conRuc
            ? "Gracias por tu pago. Para cualquier consulta sobre este recibo, escríbenos con su número."
            : "Constancia de pago. Si necesitas un comprobante electrónico de SUNAT, escríbenos con este número y tus datos de facturación."}
        </p>
      </article>
    </div>
  );
}
