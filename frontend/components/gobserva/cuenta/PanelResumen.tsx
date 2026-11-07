"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, ArrowUpRight, Bell, Bookmark, CalendarClock, Check, Download, Inbox, Loader2, QrCode, Sparkles } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import {
  ESTADO_PLAN, NOMBRE_MEDIO, cargarBandeja, cargarLineas, enviarOperacion, fechaLarga, precioCorto, type Me, type PlanCliente,
} from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso, COSAS, ETIQUETA, CAMPO } from "./comun";
import type { Seccion } from "./Cuenta";
import { BotonesVerificacion, NotaVerificacion, useVerificacion } from "./Verificacion";

type Ir = (t: Seccion) => void;

/** Una barra de uso: «2 de 5 alertas». */
function Uso({ Icono, etiqueta, usado, tope }: { Icono: typeof Bell; etiqueta: string; usado: number; tope: number }) {
  const pct = tope > 0 ? Math.min(100, Math.round((usado / tope) * 100)) : 0;
  return (
    <div>
      <p className="flex items-baseline justify-between gap-3 text-dato">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <Icono size={15} aria-hidden className="text-granate" /> {etiqueta}
        </span>
        <span className="tabular-nums text-inkSoft">
          <b className="font-bold text-ink">{usado}</b> de {tope}
        </span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={usado} aria-valuemin={0} aria-valuemax={tope} aria-label={etiqueta}>
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

export function PanelResumen({
  producto, base, me, onCambio, irA, sinPasos = false,
}: {
  producto: Producto;
  base: string;
  me: Me;
  onCambio: () => void;
  irA: Ir;
  /** Sin «Para empezar» (Inicio de Licitaciones lo pone arriba de sus cifras). */
  sinPasos?: boolean;
}) {
  const plan = me.planes.find((p) => p.producto === producto && p.estado === "activa") ?? null;
  const otros = me.planes.filter((p) => p.producto !== producto && p.estado === "activa");
  const pendientes = me.pendientes.filter((k) => k.producto === producto);
  const lim = me.producto?.limites;
  const usados = me.producto?.usados ?? { alertas: 0, guardados: 0 };
  const { data: bandeja } = useSWR(["gobserva-bandeja", producto], () => cargarBandeja(producto), { revalidateOnFocus: false });
  const cosas = COSAS[producto];

  return (
    <div className="space-y-10">
      {!sinPasos && <ParaEmpezar producto={producto} base={base} me={me} onCambio={onCambio} irA={irA} />}

      {pendientes.length > 0 && (
        <section aria-labelledby="pend-t" className="rounded-2xl border border-amber/40 bg-amber-soft/50 p-5 sm:p-6">
          <h2 id="pend-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
            <QrCode size={18} aria-hidden className="text-amberTexto" /> Pagos por confirmar
          </h2>
          <ul className="mt-3 space-y-3">
            {pendientes.map((k) => <Pendiente key={k.numero} k={k} onCambio={onCambio} />)}
          </ul>
        </section>
      )}

      {/* El plan de este producto y lo que se usa de él. */}
      <section aria-labelledby="plan-t">
        <TituloSeccion id="plan-t" titulo="Tu plan" accion={plan ? { etiqueta: "Pagos y recibos", onClick: () => irA("pagos") } : undefined} />
        <div className="mt-4 grid gap-5 rounded-2xl border border-line bg-paper p-5 sm:p-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-8">
          <div className="min-w-0">
            {plan ? (
              <>
                <p className="flex flex-wrap items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                  {plan.nombrePlan}
                  {plan.fundador && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-granate-50 px-2.5 py-0.5 text-meta font-semibold text-granate">
                      <Sparkles size={13} aria-hidden /> Precio de fundador
                    </span>
                  )}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-dato">
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
                  {plan.fundador && plan.mesesFundador ? (
                    <div>
                      <dt className="text-meta text-mute">Después de {plan.mesesFundador} meses</dt>
                      <dd className="font-semibold tabular-nums text-ink">{precioCorto(plan.regular)} al mes</dd>
                    </div>
                  ) : null}
                </dl>
                {!plan.renovar && plan.medio === "tarjeta" && (
                  <Aviso className="mt-3">Cancelaste la renovación: tu plan sigue hasta el {fechaLarga(plan.vigenteHasta)} y no se vuelve a cobrar.</Aviso>
                )}
                <Link href={rutaEn(base, "/planes")} className={claseAccion("secundario", "mt-4")}>Cambiar de plan</Link>
              </>
            ) : (
              <>
                <p className="font-display text-seccion font-bold leading-tight text-ink">Gratis</p>
                <p className="mt-2 max-w-[52ch] text-dato leading-relaxed text-inkSoft">
                  Buscas, lees las fichas y te avisamos una vez por semana. Con un plan de pago, tus alertas llegan cada mañana, guardas más{" "}
                  {cosas.varias} y descargas tus búsquedas en Excel.
                </p>
                <Link href={rutaEn(base, "/planes")} className={claseAccion("primario", "mt-4")}>
                  Ver los planes <ArrowRight size={15} aria-hidden />
                </Link>
              </>
            )}
          </div>
          {lim && (
            <div className="min-w-0 space-y-4 border-t border-line pt-5 md:border-l md:border-t-0 md:pl-8 md:pt-0">
              <Uso Icono={Bell} etiqueta="Alertas" usado={usados.alertas} tope={lim.alertas} />
              <Uso Icono={Bookmark} etiqueta="Guardados" usado={usados.guardados} tope={lim.guardados} />
              <p className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                <CalendarClock size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                {lim.frecuencias.includes("diaria") ? "Tus alertas llegan cada mañana, a las 7:00." : "Tus alertas llegan una vez por semana."}
              </p>
              <p className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                <Download size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                {lim.csv ? `Descargas en Excel hasta ${lim.filasCsv.toLocaleString("es-PE")} filas por búsqueda.` : "La descarga en Excel viene con un plan de pago."}
              </p>
            </div>
          )}
        </div>
        {otros.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {otros.map((p) => <TarjetaPlan key={p.codigo} p={p} />)}
          </div>
        )}
      </section>

      {/* Lo último que se avisó. */}
      <section aria-labelledby="bandeja-t">
        <TituloSeccion id="bandeja-t" titulo="Lo último que te avisamos" accion={{ etiqueta: "Ver tus alertas", onClick: () => irA("alertas") }} />
        {!bandeja ? (
          <div aria-hidden className="mt-4 h-20 animate-pulse rounded-2xl bg-paperDeep" />
        ) : bandeja.data.length === 0 ? (
          <div className="mt-4 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-3 text-dato leading-relaxed text-inkSoft">
              <Inbox size={20} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              Aquí verás lo nuevo de tus alertas{me.correoActivo ? ", además de recibirlo en tu correo" : ""}. Todavía no hay avisos.
            </p>
            <button type="button" onClick={() => irA("alertas")} className={claseAccion("secundario", "shrink-0")}>
              <Bell size={15} aria-hidden /> Crear una alerta
            </button>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {bandeja.data.slice(0, 4).map((e) => (
              <li key={e.id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 text-dato font-semibold text-ink">{e.asunto}</p>
                  <p className="text-meta text-mute">{e.creado}</p>
                </div>
                <p className="mt-0.5 text-meta text-inkSoft">
                  {e.estado === "enviado" ? "Enviado a tu correo" : e.estado === "en_la_web" ? "En tu cuenta" : "No se pudo enviar al correo"}
                </p>
                {/* recorte: dos por aviso; el resto, en la bandeja de Alertas («y N más en tu bandeja»). */}
                {e.items.slice(0, 2).map((i) => (
                  <a key={i.ref} href={i.enlace} className="mt-1 block truncate text-meta font-medium text-granate hover:underline">{i.titulo}</a>
                ))}
                {e.items.length > 2 && <p className="mt-1 text-meta text-mute">y {e.items.length - 2} más en tu bandeja</p>}
              </li>
            ))}
          </ul>
        )}
        {bandeja && bandeja.data.length > 4 && (
          <button type="button" onClick={() => irA("alertas")} className="mt-3 inline-flex min-h-11 items-center text-dato font-semibold text-granate hover:underline">
            Ver los {bandeja.data.length - 4} avisos más
          </button>
        )}
      </section>
    </div>
  );
}

export function TituloSeccion({ id, titulo, accion }: { id: string; titulo: string; accion?: { etiqueta: string; onClick: () => void } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="font-display text-bloque font-bold leading-tight text-ink">{titulo}</h2>
      {accion && (
        <button type="button" onClick={accion.onClick} className="inline-flex min-h-11 items-center text-dato font-semibold text-granate underline-offset-4 hover:underline">
          {accion.etiqueta}
        </button>
      )}
    </div>
  );
}

interface Paso {
  clave: string;
  listo: boolean;
  titulo: string;
  texto: ReactNode;
  accion: ReactNode;
}

/**
 * «Para empezar»: los pasos que hacen útil la cuenta (verificar el correo, decir qué vendes, crear una alerta, guardar
 * algo), con cuántos van y la acción del siguiente a un clic. Se va cuando están todos.
 */
export function ParaEmpezar({ producto, base, me, onCambio, irA }: { producto: Producto; base: string; me: Me; onCambio: () => void; irA: Ir }) {
  const conLineas = producto === "licitaciones";
  const { data: lineas } = useSWR(conLineas ? ["gobserva-lineas"] : null, () => cargarLineas(), { revalidateOnFocus: false });
  const verif = useVerificacion(onCambio);
  const usados = me.producto?.usados ?? { alertas: 0, guardados: 0 };
  const cosas = COSAS[producto];
  const unaCosa = producto === "obras" ? "un proyecto" : `una ${cosas.una}`;
  const pasos: Paso[] = [
    {
      clave: "correo",
      listo: me.cuenta.emailVerificado,
      titulo: "Verifica tu correo",
      texto: (
        <>
          Sin eso no te llegan alertas ni recibos a <span className="font-semibold text-ink [overflow-wrap:anywhere]">{me.cuenta.email}</span>.
          <NotaVerificacion estado={verif.estado} />
        </>
      ),
      accion: <BotonesVerificacion estado={verif.estado} reenviar={() => void verif.reenviar()} yaVerifique={() => void verif.yaVerifique()} />,
    },
  ];
  if (conLineas) {
    pasos.push({
      clave: "linea",
      listo: (lineas?.data.length ?? 0) > 0,
      titulo: "Dinos qué vende tu empresa",
      texto: "Con eso ordenamos las licitaciones y los contratos menores abiertos, de lo más parecido a lo que vendes a lo menos.",
      accion: (
        <button type="button" onClick={() => irA("para-ti")} className={claseAccion("primario")}>
          <Sparkles size={15} aria-hidden /> Armar mi «Para ti»
        </button>
      ),
    });
  }
  pasos.push(
    {
      clave: "alerta",
      listo: usados.alertas > 0,
      titulo: "Crea tu primera alerta",
      texto: `Te avisamos de las ${cosas.varias} nuevas que calzan con tu búsqueda, sin que tengas que entrar a mirar.`,
      accion: (
        <button type="button" onClick={() => irA("alertas")} className={claseAccion("primario")}>
          <Bell size={15} aria-hidden /> Crear una alerta
        </button>
      ),
    },
    {
      clave: "guardado",
      listo: usados.guardados > 0,
      titulo: `Guarda ${unaCosa}`,
      texto: "Con el botón de guardar de cada ficha la sigues desde aquí, con su estado y su fecha de cierre.",
      accion: (
        <Link href={rutaEn(base, cosas.lista)} className={claseAccion("primario")}>
          <Bookmark size={15} aria-hidden /> Ver {cosas.varias}
        </Link>
      ),
    },
  );
  const hechos = pasos.filter((p) => p.listo).length;
  if (conLineas && !lineas) return <div aria-hidden className="h-40 animate-pulse rounded-2xl bg-paperDeep" />;
  if (hechos === pasos.length) return null;
  const siguiente = pasos.find((p) => !p.listo)?.clave;

  return (
    <section aria-labelledby="empezar-t">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="empezar-t" className="font-display text-bloque font-bold leading-tight text-ink">Para empezar</h2>
        <p className="text-meta font-semibold tabular-nums text-inkSoft">
          {hechos} de {pasos.length} listos
        </p>
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden>
        {pasos.map((p) => (
          <span key={p.clave} className={cn("h-1.5 flex-1 rounded-full", p.listo ? "bg-granate" : "bg-ink/10")} />
        ))}
      </div>
      <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {pasos.map((p, i) => {
          const abierto = p.clave === siguiente;
          return (
            <li key={p.clave} className={cn("flex gap-4 px-4 py-4 sm:px-5", abierto && "bg-paperSoft")}>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-meta font-bold tabular-nums",
                  p.listo ? "bg-granate text-paper" : abierto ? "border-2 border-granate text-ink" : "border border-line text-mute",
                )}
              >
                {p.listo ? <Check size={15} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-destacado font-semibold leading-snug", p.listo ? "text-mute line-through decoration-1" : "text-ink")}>
                  <span className="sr-only">{p.listo ? "Listo: " : "Falta: "}</span>
                  {p.titulo}
                </p>
                {abierto && (
                  <>
                    <p className="mt-1 max-w-[62ch] text-dato leading-relaxed text-inkSoft">{p.texto}</p>
                    <div className="mt-3">{p.accion}</div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
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
