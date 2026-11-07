"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { FileText, Loader2, Receipt } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import {
  ESTADO_PLAN, ErrorCuenta, NOMBRE_MEDIO, cancelarPlan, cargarCobros, fechaLarga, precioCorto, soles2, type Me, type PlanCliente,
} from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso } from "./comun";

const ESTADO_COBRO = { pendiente: "Por confirmar", pagado: "Pagado", rechazado: "No se completó", reembolsado: "Devuelto" } as const;

export function PanelPagos({ producto, base, me, onCambio }: { producto: Producto; base: string; me: Me; onCambio: () => void }) {
  const { data, mutate, isLoading } = useSWR("gobserva-cobros", () => cargarCobros());
  const cobros = data?.data ?? [];
  const planes = me.planes;
  return (
    <div className="space-y-6">
      <section aria-labelledby="planes-t" className="rounded-2xl border border-line bg-caja p-5 shadow-caja sm:p-6">
        <h2 id="planes-t" className="font-display text-seccion font-bold leading-tight text-ink">Tus planes</h2>
        {planes.length === 0 ? (
          <div className="mt-3">
            <p className="text-dato text-inkSoft">Estás en el plan gratis de los tres productos.</p>
            <Link href={rutaEn(base, "/planes")} className={claseAccion("primario", "mt-4")}>Ver los planes de {PRODUCTOS[producto].titulo}</Link>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {planes.map((p) => <FilaPlan key={p.codigo} p={p} onCambio={() => { onCambio(); void mutate(); }} />)}
          </ul>
        )}
      </section>

      <section aria-labelledby="cobros-t" className="rounded-2xl border border-line bg-caja p-5 shadow-caja sm:p-6">
        <h2 id="cobros-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
          <Receipt size={20} aria-hidden className="text-granate" /> Pagos y recibos
        </h2>
        {isLoading ? (
          <div aria-hidden className="mt-4 h-24 animate-pulse rounded-2xl bg-paperDeep" />
        ) : cobros.length === 0 ? (
          <p className="mt-3 text-dato text-inkSoft">Todavía no hay pagos.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-dato">
              <thead>
                <tr className="border-b border-line text-meta text-mute">
                  <th scope="col" className="py-2 pr-3 font-semibold">Fecha</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Concepto</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Medio</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Monto</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Estado</th>
                  <th scope="col" className="py-2 font-semibold"><span className="sr-only">Recibo</span></th>
                </tr>
              </thead>
              <tbody>
                {cobros.map((k) => (
                  <tr key={k.numero} className="border-b border-line last:border-0">
                    <td className="py-3 pr-3 whitespace-nowrap text-inkSoft">{fechaLarga(k.pagado ?? k.creado)}</td>
                    <td className="py-3 pr-3 text-ink">
                      {PRODUCTOS[k.producto].titulo}, plan {k.plan}
                      {k.meses > 1 && <span className="text-mute"> ({k.meses} meses)</span>}
                    </td>
                    <td className="py-3 pr-3 text-inkSoft">{NOMBRE_MEDIO[k.medio]}</td>
                    <td className="py-3 pr-3 text-right font-semibold tabular-nums text-ink">{soles2(k.monto)}</td>
                    <td className="py-3 pr-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-rotulo font-semibold", k.estado === "pagado" ? "bg-granate-50 text-granate" : "bg-paperDeep text-inkSoft")}>
                        {ESTADO_COBRO[k.estado]}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      {k.estado === "pagado" && (
                        <Link href={rutaEn(base, `/cuenta/recibo/${k.numero}`)} className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-granate hover:underline">
                          <FileText size={14} aria-hidden /> {k.numero}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-meta leading-relaxed text-mute">
          Los cobros con tarjeta los procesa Mercado Pago: Gobserva nunca ve ni guarda los datos de tu tarjeta.
        </p>
      </section>
    </div>
  );
}

function FilaPlan({ p, onCambio }: { p: PlanCliente; onCambio: () => void }) {
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const puedeCancelar = (p.estado === "activa" && p.renovar && p.medio === "tarjeta") || p.estado === "pendiente";

  async function cancelar() {
    setOcupado(true);
    try {
      const r = await cancelarPlan(p.codigo);
      setResultado({ tono: "ok", texto: r.estado === "activa" ? `Listo: no se vuelve a cobrar. Tu plan sigue hasta el ${fechaLarga(r.vigenteHasta)}.` : "Listo: anulamos ese pago pendiente." });
      onCambio();
    } catch (e) {
      setResultado({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos cancelarlo. Escríbenos a hello@gobserva.cloud." });
    } finally {
      setOcupado(false);
      setConfirmar(false);
    }
  }

  return (
    <li className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-destacado font-bold text-ink">
            {p.nombreProducto}, {p.nombrePlan}
            <span className={cn("rounded-full px-2 py-0.5 text-rotulo font-semibold", p.estado === "activa" ? "bg-granate-50 text-granate" : "bg-paperDeep text-inkSoft")}>
              {ESTADO_PLAN[p.estado]}
            </span>
          </p>
          <p className="mt-1 text-meta text-inkSoft">
            {p.medio === "cortesia" ? "Cortesía" : `${precioCorto(p.monto)} al mes`} con {NOMBRE_MEDIO[p.medio].toLowerCase()}
            {p.vigenteHasta ? `. ${p.renovar && p.medio === "tarjeta" ? "Próximo cobro" : "Activo hasta"}: ${fechaLarga(p.vigenteHasta)}` : ""}
            {p.fundador ? ". Precio de fundador" : ""}
          </p>
          <p className="mt-0.5 text-meta text-mute">Código {p.codigo}</p>
        </div>
        {puedeCancelar && !confirmar && (
          <button type="button" onClick={() => setConfirmar(true)} className={claseAccion("fantasma", "text-crimsonTexto")}>
            {p.estado === "pendiente" ? "Anular" : "Cancelar la renovación"}
          </button>
        )}
      </div>
      {confirmar && (
        <div className="mt-3 rounded-xl bg-crimson-soft p-3 text-dato text-crimsonTexto">
          <p>{p.estado === "pendiente" ? "¿Anular este pago pendiente?" : "¿Cancelar la renovación? No se vuelve a cobrar y el plan sigue hasta el final de lo pagado."}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void cancelar()} disabled={ocupado} className={claseAccion("primario")}>
              {ocupado && <Loader2 size={15} aria-hidden className="animate-spin" />} Sí, cancelar
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className={claseAccion("secundario")}>No</button>
          </div>
        </div>
      )}
      {resultado && <Aviso tono={resultado.tono} className="mt-3">{resultado.texto}</Aviso>}
    </li>
  );
}
