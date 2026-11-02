"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowUpRight, Bell, Bookmark, CalendarClock, Download, Inbox, Loader2, QrCode, Sparkles } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import {
  ESTADO_PLAN, NOMBRE_MEDIO, cargarBandeja, enviarOperacion, fechaLarga, precioCorto, type Me, type PlanCliente,
} from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso, COSAS, ETIQUETA, CAMPO } from "./comun";

type Ir = (t: "resumen" | "alertas" | "guardados" | "pagos" | "perfil") => void;

/** Una barra de uso: «2 de 5 alertas». */
function Uso({ Icono, etiqueta, usado, tope }: { Icono: typeof Bell; etiqueta: string; usado: number; tope: number }) {
  const pct = tope > 0 ? Math.min(100, Math.round((usado / tope) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <p className="flex items-center gap-2 text-meta font-semibold text-inkSoft">
        <Icono size={16} aria-hidden className="text-granate" /> {etiqueta}
      </p>
      <p className="mt-2 font-display text-cifra font-bold leading-none text-ink">
        {usado} <span className="text-dato font-medium text-mute">de {tope}</span>
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={usado} aria-valuemin={0} aria-valuemax={tope} aria-label={etiqueta}>
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-crimson" : "bg-granate")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TarjetaPlan({ p }: { p: PlanCliente }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <p className="text-meta text-mute">{p.nombreProducto}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2 font-display text-bloque font-bold text-ink">
        {p.nombrePlan}
        <span className={cn("rounded-full px-2 py-0.5 text-rotulo font-semibold", p.estado === "activa" ? "bg-granate-50 text-granate" : "bg-paperDeep text-inkSoft")}>
          {ESTADO_PLAN[p.estado]}
        </span>
      </p>
      <p className="mt-1 text-meta text-inkSoft">
        {p.medio === "cortesia" ? "Cortesía" : `${precioCorto(p.monto)} al mes`} con {NOMBRE_MEDIO[p.medio].toLowerCase()}
        {p.vigenteHasta ? `, hasta el ${fechaLarga(p.vigenteHasta)}` : ""}
      </p>
      <a href={`https://${PRODUCTOS[p.producto].host}/cuenta`} className="mt-2 inline-flex items-center gap-1 text-meta font-semibold text-granate hover:underline">
        Ir a {PRODUCTOS[p.producto].titulo} <ArrowUpRight size={13} aria-hidden />
      </a>
    </div>
  );
}

export function PanelResumen({ producto, base, me, onCambio, irA }: { producto: Producto; base: string; me: Me; onCambio: () => void; irA: Ir }) {
  const plan = me.planes.find((p) => p.producto === producto && p.estado === "activa") ?? null;
  const otros = me.planes.filter((p) => p.producto !== producto && p.estado === "activa");
  const pendientes = me.pendientes.filter((k) => k.producto === producto);
  const lim = me.producto?.limites;
  const usados = me.producto?.usados ?? { alertas: 0, guardados: 0 };
  const { data: bandeja } = useSWR(["gobserva-bandeja", producto], () => cargarBandeja(producto), { revalidateOnFocus: false });
  const cosas = COSAS[producto];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        {/* El plan de este producto. */}
        <section aria-labelledby="plan-t" className={cn("rounded-3xl border p-5 sm:p-6", plan ? "border-granate/40 bg-granate-50" : "border-line bg-paper")}>
          <p className="flex items-center gap-2 text-meta font-semibold text-inkSoft">
            <Sparkles size={16} aria-hidden className="text-granate" /> Tu plan en {PRODUCTOS[producto].titulo}
          </p>
          {plan ? (
            <>
              <h2 id="plan-t" className="mt-2 font-display text-titulo font-bold leading-tight text-ink">{plan.nombrePlan}</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-dato sm:grid-cols-3 sm:gap-x-6">
                <div>
                  <dt className="text-meta text-mute">Pagas</dt>
                  <dd className="font-semibold tabular-nums text-ink">{plan.medio === "cortesia" ? "Cortesía" : `${precioCorto(plan.monto)} al mes`}</dd>
                </div>
                <div>
                  <dt className="text-meta text-mute">{plan.renovar && plan.medio === "tarjeta" ? "Próximo cobro" : "Activo hasta"}</dt>
                  <dd className="font-semibold text-ink">{fechaLarga(plan.vigenteHasta)}</dd>
                </div>
                <div>
                  <dt className="text-meta text-mute">Medio</dt>
                  <dd className="font-semibold text-ink">{NOMBRE_MEDIO[plan.medio]}</dd>
                </div>
              </dl>
              {plan.fundador && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-meta font-semibold text-granate">
                  <Sparkles size={13} aria-hidden /> Precio de fundador
                  {plan.mesesFundador ? ` por ${plan.mesesFundador} meses, luego ${precioCorto(plan.regular)}` : ", mientras sigas"}
                </p>
              )}
              {!plan.renovar && plan.medio === "tarjeta" && (
                <Aviso className="mt-3">Cancelaste la renovación: tu plan sigue hasta el {fechaLarga(plan.vigenteHasta)} y no se vuelve a cobrar.</Aviso>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => irA("pagos")} className={claseAccion("secundario")}>Pagos y recibos</button>
                <Link href={rutaEn(base, "/planes")} className={claseAccion("fantasma")}>Cambiar de plan</Link>
              </div>
            </>
          ) : (
            <>
              <h2 id="plan-t" className="mt-2 font-display text-titulo font-bold leading-tight text-ink">Gratis</h2>
              <p className="mt-2 max-w-[60ch] text-dato leading-relaxed text-inkSoft">
                Tienes 1 alerta semanal y {lim?.guardados ?? 30} guardados. Con un plan de pago, tus alertas llegan cada mañana, guardas más {cosas.varias} y
                descargas tus búsquedas en Excel.
              </p>
              <Link href={rutaEn(base, "/planes")} className={claseAccion("primario", "mt-4")}>Ver los planes</Link>
            </>
          )}
        </section>

        {pendientes.length > 0 && (
          <section aria-labelledby="pend-t" className="rounded-3xl border border-amber/40 bg-amber-soft/50 p-5 sm:p-6">
            <h2 id="pend-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
              <QrCode size={18} aria-hidden className="text-amberTexto" /> Pagos por confirmar
            </h2>
            <ul className="mt-3 space-y-3">
              {pendientes.map((k) => <Pendiente key={k.numero} k={k} onCambio={onCambio} />)}
            </ul>
          </section>
        )}

        {/* Lo último que se avisó. */}
        <section aria-labelledby="bandeja-t" className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="bandeja-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
              <Inbox size={18} aria-hidden className="text-granate" /> Lo último que te avisamos
            </h2>
            <button type="button" onClick={() => irA("alertas")} className="text-dato font-semibold text-granate hover:underline">Ver tus alertas</button>
          </div>
          {!bandeja ? (
            <div aria-hidden className="mt-4 h-16 animate-pulse rounded-2xl bg-paperDeep" />
          ) : bandeja.data.length === 0 ? (
            <p className="mt-3 text-dato leading-relaxed text-inkSoft">
              Todavía no hay avisos. Crea una alerta con lo que buscas y aquí verás lo nuevo{me.correoActivo ? ", además de recibirlo en tu correo" : ""}.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {bandeja.data.slice(0, 4).map((e) => (
                <li key={e.id} className="py-3">
                  <p className="flex flex-wrap items-center gap-2 text-dato font-semibold text-ink">
                    {e.asunto}
                    <span className="rounded-full bg-paperDeep px-2 py-0.5 text-rotulo font-medium text-inkSoft">
                      {e.estado === "enviado" ? "Enviado a tu correo" : e.estado === "en_la_web" ? "En tu cuenta" : "No se pudo enviar"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-meta text-mute">{e.creado}</p>
                  {e.items.slice(0, 2).map((i) => (
                    <a key={i.ref} href={i.enlace} className="mt-1 block truncate text-meta text-granate hover:underline">{i.titulo}</a>
                  ))}
                  {e.items.length > 2 && <p className="mt-1 text-meta text-mute">y {e.items.length - 2} más en tu bandeja</p>}
                </li>
              ))}
            </ul>
          )}
          {bandeja && bandeja.data.length > 4 && (
            <button type="button" onClick={() => irA("alertas")} className="mt-2 text-dato font-semibold text-granate hover:underline">
              Ver los {bandeja.data.length - 4} avisos más
            </button>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        {lim && (
          <>
            <Uso Icono={Bell} etiqueta="Alertas" usado={usados.alertas} tope={lim.alertas} />
            <Uso Icono={Bookmark} etiqueta="Guardados" usado={usados.guardados} tope={lim.guardados} />
            <div className="rounded-2xl border border-line bg-paper p-4 text-dato">
              <p className="flex items-center gap-2 font-semibold text-ink"><CalendarClock size={16} aria-hidden className="text-granate" /> Tus alertas llegan</p>
              <p className="mt-1 text-inkSoft">{lim.frecuencias.includes("diaria") ? "Cada mañana, a las 7:00." : "Una vez por semana."}</p>
              <p className="mt-3 flex items-center gap-2 font-semibold text-ink"><Download size={16} aria-hidden className="text-granate" /> Descarga en Excel</p>
              <p className="mt-1 text-inkSoft">{lim.csv ? `Hasta ${lim.filasCsv.toLocaleString("es-PE")} filas por búsqueda.` : "Con un plan de pago."}</p>
            </div>
          </>
        )}
        {otros.length > 0 && (
          <div className="space-y-3">
            <p className="text-meta font-semibold text-inkSoft">Tus otros planes</p>
            {otros.map((p) => <TarjetaPlan key={p.codigo} p={p} />)}
          </div>
        )}
      </aside>
    </div>
  );
}

/** Un pago con QR que espera: el código y, si falta, el número de operación para encontrarlo. */
function Pendiente({ k, onCambio }: { k: Me["pendientes"][number]; onCambio: () => void }) {
  const [operacion, setOperacion] = useState(k.operacion ?? "");
  const [estado, setEstado] = useState<"" | "enviando" | "listo">("");
  const [error, setError] = useState<string | null>(null);
  async function enviar() {
    setError(null);
    setEstado("enviando");
    try {
      await enviarOperacion(k.numero, operacion.trim());
      setEstado("listo");
      onCambio();
    } catch (e) {
      setError((e as Error).message);
      setEstado("");
    }
  }
  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      <p className="text-dato font-semibold text-ink">
        {precioCorto(k.monto)} con {NOMBRE_MEDIO[k.medio]} ({k.meses} {k.meses === 1 ? "mes" : "meses"})
      </p>
      <p className="mt-0.5 text-meta text-mute">Código de pago {k.numero}. Creado el {fechaLarga(k.creado)}.</p>
      {k.operacion || estado === "listo" ? (
        <p className="mt-2 text-meta text-inkSoft">Recibimos tu número de operación. Confirmamos el pago en menos de 24 horas hábiles y te avisamos.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`op-${k.numero}`} className={ETIQUETA}>Número de operación</label>
            <input id={`op-${k.numero}`} value={operacion} onChange={(e) => setOperacion(e.target.value)} className={CAMPO} placeholder="El que muestra tu Yape o tu banco" maxLength={40} />
          </div>
          <button type="button" onClick={enviar} disabled={estado === "enviando" || operacion.trim().length < 4} className={claseAccion("primario")}>
            {estado === "enviando" && <Loader2 size={15} aria-hidden className="animate-spin" />} Enviar
          </button>
        </div>
      )}
      {error && <Aviso tono="error" className="mt-2">{error}</Aviso>}
    </li>
  );
}
