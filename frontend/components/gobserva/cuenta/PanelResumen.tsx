"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, ArrowUpRight, Bell, Bookmark, Bot, CalendarClock, Check, Download, Inbox, Loader2, QrCode, Sparkles } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import {
  ESTADO_PLAN, NOMBRE_MEDIO, cargarBandeja, cargarLineas, cargarUsoMcp, enviarOperacion, fechaLarga, precioCorto, type Me, type PlanCliente,
} from "@/lib/gobserva-cuenta";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { cn } from "@/lib/utils";
import { usePerfilEmpleo } from "@/components/empleo-app/usePerfilEmpleo";
import { Aviso, COSAS, ETIQUETA, CAMPO, abiertoDe } from "./comun";
import { CLASE_ENLACE_PIE, Caja, VacioCaja } from "../app/Caja";
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
          <b className="font-bold text-ink">{usado.toLocaleString("es-PE")}</b> de {tope.toLocaleString("es-PE")}
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
  producto, base, me, onCambio, irA,
}: {
  producto: Producto;
  base: string;
  me: Me;
  onCambio: () => void;
  irA: Ir;
}) {
  return (
    <div className="grid gap-4 sm:gap-6">
      <ParaEmpezar producto={producto} base={base} me={me} onCambio={onCambio} irA={irA} />
      <PagosPorConfirmar producto={producto} me={me} onCambio={onCambio} />
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
        <CajaPlan producto={producto} base={base} me={me} irA={irA} />
        <CajaAvisos producto={producto} me={me} irA={irA} />
      </div>
    </div>
  );
}

/** Los pagos con QR que esperan su número de operación o la confirmación. */
export function PagosPorConfirmar({ producto, me, onCambio }: { producto: Producto; me: Me; onCambio: () => void }) {
  const pendientes = me.pendientes.filter((k) => k.producto === producto);
  if (pendientes.length === 0) return null;
  return (
    <section aria-labelledby="pend-t" className="rounded-2xl border border-amber/40 bg-amber-soft/50 p-4 sm:p-5">
      <h2 id="pend-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
        <QrCode size={18} aria-hidden className="text-amberTexto" /> Pagos por confirmar
      </h2>
      <ul className="mt-3 space-y-3">
        {pendientes.map((k) => <Pendiente key={k.numero} k={k} onCambio={onCambio} />)}
      </ul>
    </section>
  );
}

/**
 * Tu plan en una caja: cuál es (o «Gratis» y el paso a uno de pago) y cuánto usas de él. `angosta`: en la columna de
 * Inicio, el uso va debajo del plan y no al lado. Con los cobros en pausa (COBROS_EN_PAUSA), sin plan pagado es «Tu
 * cuenta»: con el correo confirmado (`abierto`) lo tiene todo gratis; sin él (`porVerificar`), dice que lo confirme.
 */
export function CajaPlan({ producto, base, me, irA, angosta = false }: { producto: Producto; base: string; me: Me; irA: Ir; angosta?: boolean }) {
  const plan = me.planes.find((p) => p.producto === producto && p.estado === "activa") ?? null;
  const otros = me.planes.filter((p) => p.producto !== producto && p.estado === "activa");
  const lim = me.producto?.limites;
  const usados = me.producto?.usados ?? { alertas: 0, guardados: 0 };
  const cosas = COSAS[producto];
  const abierto = !!me.producto?.abierto;
  const porVerificar = !!me.producto?.porVerificar;
  const tope = abiertoDe(producto);
  // Los créditos del MCP del mes (con un plan que los trae o, con los cobros en pausa, con la cuenta abierta).
  const mcp = useSWR((plan || abierto) && lim?.mcp ? ["gobserva-mcp", producto] : null, () => cargarUsoMcp(producto));
  return (
    <Caja
      id="plan"
      titulo={COBROS_EN_PAUSA && !plan ? "Tu cuenta" : "Tu plan"}
      accion={
        plan ? (
          <button type="button" onClick={() => irA("pagos")} className={CLASE_ENLACE_PIE}>Pagos y recibos</button>
        ) : (
          <Link href={rutaEn(base, "/planes")} className={CLASE_ENLACE_PIE}>{COBROS_EN_PAUSA ? "Lo que incluye" : "Comparar planes"}</Link>
        )
      }
    >
      <div className={cn("grid gap-5", !angosta && "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-8")}>
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
              {!COBROS_EN_PAUSA && <Link href={rutaEn(base, "/planes")} className={claseAccion("secundario", "mt-4")}>Cambiar de plan</Link>}
            </>
          ) : COBROS_EN_PAUSA ? (
            <>
              <p className="font-display text-seccion font-bold leading-tight text-ink">{abierto ? "Gratis, con todo" : "Gratis"}</p>
              <p className="mt-1.5 max-w-[52ch] text-dato leading-relaxed text-inkSoft">
                {abierto
                  ? `Tu correo está confirmado: tus alertas llegan cada mañana, guardas más ${cosas.varias}, descargas en Excel y usas el asistente y el MCP. Sin pagar nada.`
                  : `Te avisamos una vez por semana. Confirma tu correo y tienes todo gratis: alertas cada mañana, hasta ${(tope?.guardados ?? 0).toLocaleString("es-PE")} guardados, Excel y el asistente.`}
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-seccion font-bold leading-tight text-ink">Gratis</p>
              <p className="mt-1.5 max-w-[52ch] text-dato leading-relaxed text-inkSoft">
                Te avisamos una vez por semana. Con un plan de pago, tus alertas llegan cada mañana, guardas más {cosas.varias} y descargas en Excel.
              </p>
              <Link href={rutaEn(base, "/planes")} className={claseAccion("primario", "mt-4")}>
                Ver los planes <ArrowRight size={15} aria-hidden />
              </Link>
            </>
          )}
        </div>
        {lim && (
          <div className={cn("min-w-0 space-y-4 border-t border-line pt-5", !angosta && "md:border-l md:border-t-0 md:pl-8 md:pt-0")}>
            <Uso Icono={Bell} etiqueta="Alertas" usado={usados.alertas} tope={lim.alertas} />
            <Uso Icono={Bookmark} etiqueta="Guardados" usado={usados.guardados} tope={lim.guardados} />
            {mcp.data && mcp.data.creditos > 0 && <Uso Icono={Bot} etiqueta="Créditos del asistente y el MCP" usado={mcp.data.usados} tope={mcp.data.creditos} />}
            <ul className="space-y-2">
              <li className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                <CalendarClock size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                {lim.frecuencias.includes("diaria")
                  ? "Tus alertas llegan cada mañana, a las 7:00."
                  : COBROS_EN_PAUSA && porVerificar
                    ? "Tus alertas llegan una vez por semana. Confirma tu correo y llegan cada mañana."
                    : "Tus alertas llegan una vez por semana."}
              </li>
              <li className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                <Download size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                {lim.csv
                  ? `Descargas en Excel hasta ${lim.filasCsv.toLocaleString("es-PE")} filas por búsqueda.`
                  : COBROS_EN_PAUSA
                    ? "Confirma tu correo y descargas tus búsquedas en Excel, gratis."
                    : "La descarga en Excel viene con un plan de pago."}
              </li>
              <li className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                <Bot size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                {lim.mcp
                  ? `${plan ? "Tu plan" : "Tu cuenta"} trae ${lim.mcp.toLocaleString("es-PE")} créditos al mes${mcp.data ? `, se renuevan el ${fechaLarga(mcp.data.renueva)}` : ""}: una pregunta rápida al asistente usa 5; en el MCP, una búsqueda usa 1.`
                  : COBROS_EN_PAUSA
                    ? "Confirma tu correo y usas gratis el asistente y el MCP para preguntarle a tu IA."
                    : "El asistente y el MCP para preguntarle a tu IA vienen con un plan de pago."}
              </li>
            </ul>
          </div>
        )}
      </div>
      {otros.length > 0 && (
        <div className={cn("mt-5 grid gap-3 border-t border-line pt-5", !angosta && "sm:grid-cols-2")}>
          {otros.map((p) => <TarjetaPlan key={p.codigo} p={p} />)}
        </div>
      )}
    </Caja>
  );
}

/** Lo último que se avisó, con lo que trajo cada aviso. */
export function CajaAvisos({ producto, me, irA }: { producto: Producto; me: Me; irA: Ir }) {
  const { data: bandeja } = useSWR(["gobserva-bandeja", producto], () => cargarBandeja(producto), { revalidateOnFocus: false });
  const mas = bandeja ? bandeja.data.length - 4 : 0;
  return (
    <Caja
      id="bandeja"
      titulo="Lo último que te avisamos"
      accion={<button type="button" onClick={() => irA("alertas")} className={CLASE_ENLACE_PIE}>Tus alertas</button>}
      relleno={false}
      pie={
        mas > 0 ? (
          <button type="button" onClick={() => irA("alertas")} className={CLASE_ENLACE_PIE}>
            Ver los {mas} avisos más <ArrowRight size={15} aria-hidden />
          </button>
        ) : undefined
      }
    >
      {!bandeja ? (
        <div aria-hidden className="m-4 h-20 animate-pulse rounded-xl bg-paperDeep sm:m-5" />
      ) : bandeja.data.length === 0 ? (
        <VacioCaja
          Icono={Inbox}
          titulo="Todavía no hay avisos"
          texto={`Aquí verás lo nuevo de tus alertas${me.correoActivo ? ", además de recibirlo en tu correo" : ""}.`}
          accion={
            <button type="button" onClick={() => irA("alertas")} className={claseAccion("secundario")}>
              <Bell size={15} aria-hidden /> Crear una alerta
            </button>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
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
    </Caja>
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
 * algo) en una fila, con cuántos van; debajo, el siguiente con su acción a un clic. Se va cuando están todos.
 */
export function ParaEmpezar({ producto, base, me, onCambio, irA }: { producto: Producto; base: string; me: Me; onCambio: () => void; irA: Ir }) {
  const conLineas = producto === "licitaciones";
  const { data: lineas } = useSWR(conLineas ? ["gobserva-lineas"] : null, () => cargarLineas(), { revalidateOnFocus: false });
  const perfilEmpleo = usePerfilEmpleo(producto === "empleo");
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
          {COBROS_EN_PAUSA
            ? "Con tu correo confirmado tienes todo gratis: alertas cada mañana, Excel y el asistente. Te mandamos el enlace a "
            : "Sin eso no te llegan alertas ni recibos a "}
          <span className="font-semibold text-ink [overflow-wrap:anywhere]">{me.cuenta.email}</span>.
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
        <Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>
          <Sparkles size={15} aria-hidden /> Armar mi perfil
        </Link>
      ),
    });
  }
  if (producto === "empleo") {
    pasos.push({
      clave: "perfil",
      listo: !!perfilEmpleo.perfil,
      titulo: "Dinos qué trabajo buscas",
      texto: "Siete preguntas en un chat: con eso te mostramos las plazas que calzan contigo, de las que cierran primero a las últimas.",
      accion: (
        <Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>
          <Sparkles size={15} aria-hidden /> Armar mi perfil
        </Link>
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
  if (conLineas && !lineas) return <div aria-hidden className="h-36 animate-pulse rounded-2xl bg-paperDeep" />;
  const siguiente = pasos.find((p) => !p.listo);
  if (!siguiente) return null;

  return (
    <Caja
      id="empezar"
      titulo="Para empezar"
      descripcion={`${hechos} de ${pasos.length} listos. Con los ${pasos.length}, la cuenta trabaja por ti.`}
      accion={
        <div className="flex w-28 gap-1" aria-hidden>
          {pasos.map((p) => (
            <span key={p.clave} className={cn("h-1.5 flex-1 rounded-full", p.listo ? "bg-granate" : "bg-ink/10")} />
          ))}
        </div>
      }
      relleno={false}
    >
      <ol className={cn("grid gap-px bg-line sm:grid-cols-2", pasos.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {pasos.map((p, i) => {
          const abierto = p.clave === siguiente.clave;
          return (
            <li key={p.clave} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", abierto ? "bg-granate-50" : "bg-caja")}>
              <span
                aria-hidden
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full text-meta font-bold tabular-nums",
                  p.listo ? "bg-granate text-paper" : abierto ? "border-2 border-granate bg-caja text-ink" : "border border-line text-mute",
                )}
              >
                {p.listo ? <Check size={15} strokeWidth={3} /> : i + 1}
              </span>
              <p className={cn("min-w-0 text-dato font-semibold leading-snug", p.listo ? "text-mute line-through decoration-1" : "text-ink")}>
                <span className="sr-only">{p.listo ? "Listo: " : abierto ? "Sigue: " : "Falta: "}</span>
                {p.titulo}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <p className="max-w-[72ch] text-pretty text-dato leading-relaxed text-inkSoft">
          <b className="font-semibold text-ink">{siguiente.titulo}.</b> {siguiente.texto}
        </p>
        <div className="shrink-0">{siguiente.accion}</div>
      </div>
    </Caja>
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
