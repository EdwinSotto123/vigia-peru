"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Check, CheckCircle2, Loader2, Lock, QrCode, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { MarcaMercadoPago, MarcaPlin, MarcaYape, TarjetasAceptadas } from "@/components/financiar/MarcasPago";
import { PagoTarjeta, type DatosTarjeta } from "@/components/financiar/PagoTarjeta";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import {
  ErrorCuenta, cargarCatalogo, enviarOperacion, pagarConQr, pagarConTarjeta, precioCorto, soles2, type MedioManual, type MedioQr, type PlanCatalogo,
} from "@/lib/gobserva-cuenta";
import { precioDe as precioTarjeta } from "@/lib/gobserva-planes";
import { cn } from "@/lib/utils";
import { Aviso, CAMPO, COSAS, ETIQUETA, Esqueleto, useMe, useSesion } from "./comun";

type Medio = "tarjeta" | MedioManual;
const MESES = [1, 3, 6, 12] as const;

/** El precio de hoy de un plan: el de fundador si quedan lugares (o si es por meses). */
function precioDe(p: PlanCatalogo) {
  const fundador = !!p.fundador && (p.fundador.libres == null || p.fundador.libres > 0);
  return { hoy: fundador ? p.fundador!.precio : p.precio, regular: p.precio, fundador, meses: fundador ? p.fundador!.meses ?? null : null };
}
/** «el primer mes» o «los 3 primeros meses»: cuánto dura el precio de fundador por meses. */
const losPrimeros = (meses: number) => (meses === 1 ? "el primer mes" : `los ${meses} primeros meses`);
/** Lo mismo que la API (lib/gobservaPlanes.ts → montoPorMeses): meses por adelantado con Yape o Plin. */
function totalMeses(p: PlanCatalogo, meses: number): number {
  const x = precioDe(p);
  if (!x.fundador) return Math.round(x.regular * meses * 100) / 100;
  const conDescuento = x.meses ? Math.min(meses, x.meses) : meses;
  return Math.round((x.hoy * conDescuento + x.regular * (meses - conDescuento)) * 100) / 100;
}
function loQueTrae(p: PlanCatalogo, producto: Producto): string[] {
  const l = p.limites;
  const cosas = COSAS[producto];
  return [
    `${l.alertas} alertas con lo nuevo, ${l.frecuencias.includes("diaria") ? "cada mañana" : "cada semana"}`,
    `Hasta ${l.guardados.toLocaleString("es-PE")} ${cosas.varias} guardadas, con recordatorio antes del cierre`,
    l.csv ? `Descarga en Excel (CSV) de hasta ${l.filasCsv.toLocaleString("es-PE")} filas por búsqueda` : "",
    l.mcp ? `${l.mcp.toLocaleString("es-PE")} créditos al mes para el asistente de la app y tu MCP (Claude, ChatGPT o Cursor)` : "",
    "Todo lo del plan gratis",
  ].filter(Boolean);
}

export function Checkout({ producto, base, plan: planPedido }: { producto: Producto; base: string; plan: string | null }) {
  const { loading, conCuenta } = useSesion();
  const { me } = useMe(producto);
  const { data: cat, error: errorCat } = useSWR(["gobserva-catalogo", producto], () => cargarCatalogo(producto));
  const [elegido, setElegido] = useState<string | null>(planPedido);
  const [medio, setMedio] = useState<Medio | null>(null);
  const [meses, setMeses] = useState<number>(1);
  const [autoriza, setAutoriza] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ tipo: "tarjeta" | "qr"; estado: string; vigenteHasta: string | null } | null>(null);
  const [qr, setQr] = useState<{ numero: string; monto: number; meses: number; medio: MedioManual; destino: MedioQr | { cuentas: unknown[] } } | null>(null);
  const [creandoQr, setCreandoQr] = useState(false);

  const plan = useMemo(() => cat?.planes.find((p) => p.id === elegido) ?? cat?.planes[0] ?? null, [cat, elegido]);
  const medios = useMemo(() => {
    if (!cat) return [] as Medio[];
    return (["tarjeta", "yape", "plin"] as const).filter((m) => !!cat.medios[m]);
  }, [cat]);
  const medioActivo: Medio | null = medio && medios.includes(medio) ? medio : medios[0] ?? null;
  const yaTiene = !!plan && me?.planes.some((p) => p.producto === producto && p.plan === plan.id && p.estado === "activa" && p.renovar);
  const volverAqui = `/checkout?plan=${plan?.id ?? planPedido ?? ""}`;

  if (errorCat) return <div className="container-page max-w-xl py-12"><Aviso tono="error">{(errorCat as Error).message}</Aviso></div>;
  if (!cat || loading) {
    return (
      <div className="container-page grid gap-6 py-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Esqueleto className="h-96" />
        <Esqueleto className="h-80" />
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="container-page max-w-xl py-12">
        <Aviso>Por ahora no hay planes de pago en {PRODUCTOS[producto].titulo}.</Aviso>
      </div>
    );
  }
  const precio = precioDe(plan);

  async function conTarjeta(d: DatosTarjeta) {
    setError(null);
    if (!autoriza) {
      const m = "Marca la casilla para autorizar el cobro de cada mes.";
      setError(m);
      throw new Error(m);
    }
    try {
      const r = await pagarConTarjeta({ producto, plan: plan!.id, tarjeta: d });
      setListo({ tipo: "tarjeta", estado: r.estado, vigenteHasta: r.vigenteHasta });
    } catch (e) {
      const m = e instanceof ErrorCuenta ? e.message : "No pudimos procesar el pago. Vuelve a intentarlo.";
      setError(m);
      throw e;
    }
  }

  async function generarQr(m: MedioManual) {
    setError(null);
    setCreandoQr(true);
    try {
      const r = await pagarConQr({ producto, plan: plan!.id, medio: m, meses });
      setQr({ numero: r.numero, monto: r.monto, meses: r.meses, medio: r.medio, destino: r.destino });
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos generar tu código de pago.");
    } finally {
      setCreandoQr(false);
    }
  }

  if (listo) {
    return (
      <div className="container-page max-w-2xl py-12">
        <div className="rounded-3xl border border-granate/40 bg-granate-50 p-6 sm:p-10" role="status">
          <CheckCircle2 size={40} aria-hidden className="text-granate" />
          <h1 className="mt-3 font-display text-titulo font-bold leading-tight text-ink">
            {listo.estado === "activa" ? `¡Listo! Tu plan ${plan.nombre} está activo` : listo.tipo === "qr" ? "Recibimos tu pago, lo estamos confirmando" : "Mercado Pago está confirmando tu tarjeta"}
          </h1>
          <p className="mt-2 text-cuerpo leading-relaxed text-inkSoft">
            {listo.estado === "activa"
              ? `Ya puedes crear tus alertas de cada mañana, guardar más y descargar tus búsquedas. ${cat.correoActivo ? "Te enviamos el recibo de cada cobro." : "El recibo de cada cobro queda en tu cuenta, en Pagos."}`
              : listo.tipo === "qr"
                ? `Lo confirmamos en menos de 24 horas hábiles con tu número de operación. Tu plan se activa solo y ${cat.correoActivo ? "te enviamos el recibo" : "el recibo queda en tu cuenta"}.`
                : "Puede tardar unos minutos. Te avisamos apenas se confirme; tu plan se activa solo."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={rutaEn(base, "/cuenta?tab=alertas")} className={claseAccion("primario")}>Crear mi primera alerta</Link>
            <Link href={rutaEn(base, "/cuenta")} className={claseAccion("secundario")}>Ir a mi cuenta</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-8 sm:py-12">
      <nav aria-label="Migas" className="text-meta text-mute">
        <Link href={rutaEn(base, "/planes")} className="hover:text-ink hover:underline">Planes</Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-inkSoft">Contratar</span>
      </nav>
      <h1 className="mt-3 font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Contrata {PRODUCTOS[producto].titulo}</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* 1. El plan. */}
          <section aria-labelledby="paso1" className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
            <h2 id="paso1" className="flex items-center gap-3 font-display text-bloque font-bold text-ink">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-granate text-meta font-bold text-paper">1</span> Elige tu plan
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {cat.planes.map((p) => {
                const x = precioDe(p);
                return (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer flex-col rounded-2xl border p-4 transition-colors duration-rapido",
                      plan.id === p.id ? "border-granate bg-granate-50" : "border-line hover:border-granate/40",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-destacado font-bold text-ink">{p.nombre}</span>
                      <input type="radio" name="plan" checked={plan.id === p.id} onChange={() => { setElegido(p.id); setQr(null); }} className="accent-[rgb(var(--granate))]" />
                    </span>
                    <span className="mt-2 flex flex-wrap items-baseline gap-x-2">
                      <span className="font-display text-cifra font-bold leading-none tabular-nums text-ink">{precioCorto(x.hoy)}</span>
                      <span className="text-meta text-inkSoft">al mes</span>
                      {x.fundador && <span className="text-meta tabular-nums text-mute line-through">{precioCorto(x.regular)}</span>}
                    </span>
                    {x.fundador && <span className="mt-1 text-meta font-semibold text-granate">{precioTarjeta(p).nota}</span>}
                  </label>
                );
              })}
            </div>
          </section>

          {/* 2. Cómo pagar. */}
          <section aria-labelledby="paso2" className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
            <h2 id="paso2" className="flex items-center gap-3 font-display text-bloque font-bold text-ink">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-granate text-meta font-bold text-paper">2</span> Paga
            </h2>

            {!conCuenta ? (
              <div className="mt-4 rounded-2xl border border-dashed border-line p-5">
                <p className="text-dato leading-relaxed text-inkSoft">
                  Para contratar necesitas una cuenta (gratis): ahí ves tu plan, tus recibos y cancelas cuando quieras.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href={rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent(volverAqui)}`)} className={claseAccion("primario")}>Crear mi cuenta</Link>
                  <Link href={rutaEn(base, `/entrar?next=${encodeURIComponent(volverAqui)}`)} className={claseAccion("secundario")}>Ya tengo una cuenta</Link>
                </div>
              </div>
            ) : yaTiene ? (
              <Aviso tono="ok" className="mt-4">Ya tienes este plan activo. Lo ves en tu cuenta, en Pagos.</Aviso>
            ) : medios.length === 0 ? (
              <Aviso className="mt-4">Los pagos están en mantenimiento. Escríbenos a {cat.vendedor.correo} y te ayudamos.</Aviso>
            ) : (
              <>
                <fieldset className="mt-4">
                  <legend className={ETIQUETA}>¿Cómo pagas?</legend>
                  <div className="grid grid-cols-2 gap-2.5">
                    {medios.map((m) => (
                      <OpcionMedio
                        key={m}
                        checked={medioActivo === m}
                        onChange={() => { setMedio(m); setError(null); setQr(null); }}
                        // La tarjeta va a lo ancho; Yape y Plin, lado a lado (o a lo ancho si hay uno solo).
                        ancha={m === "tarjeta" || medios.filter((x) => x !== "tarjeta").length === 1}
                        marca={m === "tarjeta" ? <MarcaMercadoPago /> : m === "yape" ? <MarcaYape /> : <MarcaPlin />}
                        titulo={m === "tarjeta" ? "Tarjeta de crédito o débito" : undefined}
                        detalle={m === "tarjeta" ? <TarjetasAceptadas /> : null}
                        nota={
                          m === "tarjeta"
                            ? <><RefreshCcw size={13} aria-hidden className="shrink-0" /> Se renueva sola cada mes</>
                            : <><QrCode size={13} aria-hidden className="shrink-0" /> Meses por adelantado</>
                        }
                      />
                    ))}
                  </div>
                </fieldset>

                {medioActivo === "tarjeta" && cat.medios.tarjeta && (
                  <div className="mt-5">
                    <p className="flex items-start gap-2 text-dato text-inkSoft">
                      <RefreshCcw size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                      Se cobra {precioCorto(precio.hoy)} cada mes en tu tarjeta{precio.meses ? ` (${losPrimeros(precio.meses)}; luego ${precioCorto(precio.regular)})` : ""}. Cancelas cuando quieras desde tu
                      cuenta y no se vuelve a cobrar.
                    </p>
                    <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 text-dato text-ink">
                      <input type="checkbox" checked={autoriza} onChange={(e) => setAutoriza(e.target.checked)} className="mt-1 h-4 w-4 accent-[rgb(var(--granate))]" />
                      Autorizo el cobro de {precioCorto(precio.hoy)} al mes{precio.meses ? ` (${losPrimeros(precio.meses)}; luego ${precioCorto(precio.regular)} al mes)` : ""} en mi tarjeta por{" "}
                      {PRODUCTOS[producto].titulo}, plan {plan.nombre}, hasta que lo cancele.
                    </label>
                    <div className="mt-4">
                      <PagoTarjeta key={`${plan.id}-${precio.hoy}`} clavePublica={cat.medios.tarjeta.publicKey} monto={precio.hoy} email={me?.cuenta.email} onPagar={conTarjeta} alternativa="paga con Yape o Plin" />
                    </div>
                    <p className="mt-3 flex items-center gap-1.5 text-meta text-mute"><Lock size={13} aria-hidden /> Tu tarjeta la procesa Mercado Pago: Gobserva no ve ni guarda sus datos.</p>
                  </div>
                )}

                {(medioActivo === "yape" || medioActivo === "plin") && (
                  <div className="mt-5">
                    {!qr ? (
                      <>
                        <p className="text-dato leading-relaxed text-inkSoft">
                          Pagas los meses por adelantado con {medioActivo === "yape" ? "Yape" : "Plin"} (sin renovación automática). Confirmamos tu pago en menos de 24 horas hábiles.
                        </p>
                        <fieldset className="mt-4">
                          <legend className={ETIQUETA}>¿Cuántos meses?</legend>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {MESES.map((n) => (
                              <label key={n} className={cn("flex cursor-pointer flex-col rounded-2xl border px-3 py-2.5", meses === n ? "border-granate bg-granate-50" : "border-line hover:border-granate/40")}>
                                <span className="flex items-center justify-between gap-2 text-dato font-semibold text-ink">
                                  {n} {n === 1 ? "mes" : "meses"}
                                  <input type="radio" name="meses" checked={meses === n} onChange={() => setMeses(n)} className="accent-[rgb(var(--granate))]" />
                                </span>
                                <span className="text-meta tabular-nums text-inkSoft">{soles2(totalMeses(plan, n))}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <button type="button" onClick={() => void generarQr(medioActivo)} disabled={creandoQr} className={claseAccion("primario", "mt-5")}>
                          {creandoQr && <Loader2 size={15} aria-hidden className="animate-spin" />} Generar mi código de pago
                        </button>
                      </>
                    ) : (
                      <PagoQr qr={qr} onListo={() => setListo({ tipo: "qr", estado: "pendiente", vigenteHasta: null })} base={base} />
                    )}
                  </div>
                )}
                {error && <Aviso tono="error" className="mt-4">{error}</Aviso>}
              </>
            )}
          </section>
        </div>

        {/* El resumen. */}
        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="rounded-3xl bg-ink p-6 text-paper sobre-oscuro">
            <p className="text-meta text-paper/70">{PRODUCTOS[producto].titulo}</p>
            <p className="mt-1 font-display text-seccion font-bold">Plan {plan.nombre}</p>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-cifra font-bold leading-none">{precioCorto(precio.hoy)}</span>
              <span className="text-dato text-paper/75">al mes</span>
              {precio.fundador && <span className="text-dato text-paper/55 line-through">{precioCorto(precio.regular)}</span>}
            </p>
            {precio.fundador && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1 text-meta font-semibold text-maiz">
                <Sparkles size={13} aria-hidden /> {plan.fundador?.cupo ? "Precio de fundador: lo conservas mientras sigas" : `Precio de fundador ${losPrimeros(precio.meses ?? 1)}`}
              </p>
            )}
            <ul className="mt-5 space-y-2.5 border-t border-paper/15 pt-4">
              {loQueTrae(plan, producto).map((x) => (
                <li key={x} className="flex gap-2.5 text-dato text-paper/85">
                  <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-maiz" /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-line bg-paper p-5 text-meta leading-relaxed text-inkSoft">
            <p className="flex items-center gap-2 font-semibold text-ink"><ShieldCheck size={15} aria-hidden className="text-granate" /> Sin letra chica</p>
            <p className="mt-1">Cancelas cuando quieras y no se vuelve a cobrar. Si algo no funciona, escríbenos a {cat.vendedor.correo}.</p>
            <p className="mt-3 text-mute">
              Vende {cat.vendedor.nombreComercial}
              {[cat.vendedor.razonSocial, cat.vendedor.ruc ? `RUC ${cat.vendedor.ruc}` : null].filter(Boolean).length
                ? ` (${[cat.vendedor.razonSocial, cat.vendedor.ruc ? `RUC ${cat.vendedor.ruc}` : null].filter(Boolean).join(", ")})`
                : ""}
              . {cat.vendedor.ruc ? "Cada pago tiene su recibo." : "Cada pago tiene su constancia de pago."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** El paso del QR: a quién pagar, cuánto, el código para el mensaje y el número de operación. */
function PagoQr({ qr, onListo, base }: { qr: { numero: string; monto: number; meses: number; medio: MedioManual; destino: MedioQr | { cuentas: unknown[] } }; onListo: () => void; base: string }) {
  const [operacion, setOperacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = "numero" in qr.destino ? qr.destino : null;
  async function enviar() {
    setError(null);
    setEnviando(true);
    try {
      await enviarOperacion(qr.numero, operacion.trim());
      onListo();
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos guardar el número de operación.");
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-paperSoft p-4">
        {qr.medio === "yape" ? <MarcaYape grande /> : <MarcaPlin grande />}
        {d?.qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.qrUrl} alt={`Código QR de ${qr.medio === "yape" ? "Yape" : "Plin"}`} width={176} height={176} className="h-44 w-44 rounded-xl bg-paper object-contain" />
        ) : (
          <QrCode size={64} aria-hidden className="text-mute" />
        )}
        {d && (
          <div className="text-center">
            <p className="text-dato font-bold tabular-nums text-ink">{d.numero}</p>
            {d.titular && <p className="text-meta text-inkSoft">{d.titular}</p>}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <ol className="space-y-3 text-dato text-ink">
          <li className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-granate-50 text-meta font-bold text-granate">1</span>
            <span>Paga exactamente <b>{soles2(qr.monto)}</b> ({qr.meses} {qr.meses === 1 ? "mes" : "meses"}) con {qr.medio === "yape" ? "Yape" : "Plin"}.</span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-granate-50 text-meta font-bold text-granate">2</span>
            <span>En el mensaje escribe tu código: <b className="font-mono">{qr.numero}</b>.</span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-granate-50 text-meta font-bold text-granate">3</span>
            <span>Escribe aquí el número de operación que te muestra la app.</span>
          </li>
        </ol>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="qr-op" className={ETIQUETA}>Número de operación</label>
            <input id="qr-op" value={operacion} onChange={(e) => setOperacion(e.target.value)} maxLength={40} className={CAMPO} />
          </div>
          <button type="button" onClick={() => void enviar()} disabled={enviando || operacion.trim().length < 4} className={claseAccion("primario")}>
            {enviando && <Loader2 size={15} aria-hidden className="animate-spin" />} Ya pagué
          </button>
        </div>
        {error && <Aviso tono="error" className="mt-3">{error}</Aviso>}
        <p className="mt-3 text-meta text-mute">
          ¿Lo haces luego? Tu código queda en tu cuenta, en <Link href={rutaEn(base, "/cuenta")} className="font-semibold text-granate hover:underline">Resumen</Link>.
        </p>
      </div>
    </div>
  );
}

/**
 * Un medio de pago para elegir, con la marca de quien lo cobra (como en /app/apoyar → OpcionMetodo): el radio nativo va
 * escondido en su etiqueta, así funcionan el teclado, el lector de pantalla y el foco sin código extra.
 */
function OpcionMedio({ checked, onChange, ancha, marca, titulo, detalle, nota }: {
  checked: boolean;
  onChange: () => void;
  ancha: boolean;
  marca: ReactNode;
  titulo?: string;
  detalle: ReactNode;
  nota: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer gap-3 rounded-2xl border p-3.5 transition-colors duration-rapido",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-granate has-[:focus-visible]:ring-offset-2",
        checked ? "border-granate bg-granate-50" : "border-line bg-paper hover:border-granate/40",
        ancha && "col-span-2",
      )}
    >
      <input type="radio" name="medio" checked={checked} onChange={onChange} className="sr-only" />
      <span aria-hidden className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-granate" : "border-paperEdge")}>
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-granate" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">{marca}</span>
        {titulo && <span className="mt-1.5 block text-dato font-semibold leading-5 text-ink">{titulo}</span>}
        {detalle && <span className="mt-2 block">{detalle}</span>}
        <span className="mt-2 flex items-center gap-1.5 text-rotulo text-inkSoft">{nota}</span>
      </span>
    </label>
  );
}
