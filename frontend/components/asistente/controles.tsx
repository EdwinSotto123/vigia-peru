"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { LogIn, MessageSquarePlus, Microscope, Settings2, Trash2, Zap, type LucideIcon } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";
import { cuandoCorto, cuandoSeLibera, grupoDe, type CupoChat, type ModoVigia, type ResumenConversacion } from "./historial";

/**
 * Los controles del asistente de Vigía (2026-11-25): el modo (Rápido o Profundo), las preguntas que quedan hoy, la lista
 * de conversaciones guardadas en este navegador y los ajustes.
 */

export const MODOS: { id: ModoVigia; nombre: string; icono: LucideIcon; detalle: string; costo: number }[] = [
  { id: "rapido", nombre: "Rápido", icono: Zap, detalle: "Responde en segundos. Para un contrato, una empresa o una entidad.", costo: 1 },
  { id: "profundo", nombre: "Profundo", icono: Microscope, detalle: "Planifica, cruza más fuentes y verifica cada cifra. Tarda más.", costo: 3 },
];

/** Lo que cuesta un modo según el servidor (o el de la lista, mientras no llega). */
export const costoDe = (modo: ModoVigia, cupo: CupoChat | null) =>
  cupo?.modos.find((m) => m.id === modo)?.costo ?? MODOS.find((m) => m.id === modo)!.costo;

const preguntas = (n: number) => (n === 1 ? "1 pregunta" : `${n} preguntas`);

/** El modo, junto al cuadro de escribir: dos opciones, con flechas del teclado. */
export function SelectorModo({
  modo,
  alCambiar,
  cupo,
  desactivado,
}: {
  modo: ModoVigia;
  alCambiar: (m: ModoVigia) => void;
  cupo: CupoChat | null;
  desactivado?: boolean;
}) {
  const alcanza = (m: ModoVigia) => !cupo || cupo.quedan === 0 || cupo.quedan >= costoDe(m, cupo);
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const otro = modo === "rapido" ? "profundo" : "rapido";
    if (alcanza(otro)) {
      alCambiar(otro);
      (e.currentTarget.querySelector(`[data-modo="${otro}"]`) as HTMLButtonElement | null)?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-label="Modo de respuesta" onKeyDown={alTeclear} className="inline-flex shrink-0 rounded-full border border-line bg-paperSoft p-0.5">
      {MODOS.map(({ id, nombre, icono: Icono, detalle }) => {
        const activo = modo === id;
        const costo = costoDe(id, cupo);
        const puede = alcanza(id);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            data-modo={id}
            aria-checked={activo}
            tabIndex={activo ? 0 : -1}
            disabled={desactivado || !puede}
            title={puede ? `${detalle} Usa ${preguntas(costo)}.` : `Usa ${preguntas(costo)} y te ${cupo?.quedan === 1 ? "queda 1" : `quedan ${cupo?.quedan}`}.`}
            onClick={() => alCambiar(id)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-meta font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate disabled:cursor-not-allowed disabled:opacity-45",
              activo ? "bg-paper text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
            )}
          >
            <Icono size={14} aria-hidden className={activo ? "text-granate" : undefined} />
            {nombre}
          </button>
        );
      })}
    </div>
  );
}

/** Las rayitas del cupo: una por pregunta del día, llenas las que quedan. */
function Rayas({ tope, quedan, className }: { tope: number; quedan: number; className?: string }) {
  return (
    <span className={cn("flex gap-[3px]", className)} aria-hidden>
      {Array.from({ length: tope }, (_, i) => (
        <span key={i} className={cn("h-1.5 min-w-0 flex-1 rounded-full", i < quedan ? (quedan <= 2 ? "bg-amber" : "bg-moss") : "bg-paperEdge")} />
      ))}
    </span>
  );
}

function textoProxima(cupo: CupoChat): string | null {
  if (!cupo.proxima || cupo.quedan === cupo.tope) return null;
  return cupo.quedan === 0 ? `Vuelves a tener una ${cuandoSeLibera(cupo.proxima)}.` : `La próxima vuelve ${cuandoSeLibera(cupo.proxima)}.`;
}

/** En la cabecera del chat: cuántas quedan hoy, siempre a la vista. */
export function CupoChip({ cupo }: { cupo: CupoChat | null }) {
  if (!cupo) return <span className="h-7 w-24 shrink-0 animate-pulse rounded-full bg-paperDeep motion-reduce:animate-none" aria-hidden />;
  const proxima = textoProxima(cupo);
  return (
    <span
      className={cn(
        "inline-flex min-h-7 shrink-0 items-center gap-2 rounded-full border px-2.5 text-meta tabular-nums",
        cupo.quedan === 0 ? "border-amber/50 bg-amber/10 text-amberTexto" : "border-line bg-paperSoft text-inkSoft",
      )}
      title={proxima ?? "Cada pregunta vuelve 24 horas después de usarla."}
    >
      <Rayas tope={cupo.tope} quedan={cupo.quedan} className="hidden w-12 sm:flex" />
      <span>
        <span className="font-semibold text-ink">{cupo.quedan}</span> de {cupo.tope}
        <span className="max-sm:sr-only"> hoy</span>
      </span>
    </span>
  );
}

/** Al pie de la lista: las preguntas del día con su detalle. */
export function CupoDia({ cupo }: { cupo: CupoChat | null }) {
  if (!cupo) return <span className="block h-16 animate-pulse rounded-xl bg-paperDeep motion-reduce:animate-none" aria-hidden />;
  const proxima = textoProxima(cupo);
  return (
    <section aria-label="Tus preguntas de hoy">
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-meta font-semibold text-ink">Preguntas de hoy</span>
        <span className="shrink-0 text-meta tabular-nums text-inkSoft">
          <span className="sr-only">Te {cupo.quedan === 1 ? "queda" : "quedan"} </span>
          <span className="text-dato font-semibold text-ink">{cupo.quedan}</span> de {cupo.tope}
        </span>
      </p>
      <Rayas tope={cupo.tope} quedan={cupo.quedan} className="mt-2" />
      <p className="mt-2 text-rotulo leading-snug text-mute">{proxima ?? "Cada pregunta vuelve 24 horas después de usarla."}</p>
      {!cupo.verificado && (
        <Link href="/app/configuracion" className="mt-1.5 inline-block text-rotulo font-semibold text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
          Confirma tu correo y tendrás 10 cada día
        </Link>
      )}
    </section>
  );
}

/** Las conversaciones guardadas en este navegador, por día. */
export function ListaConversaciones({
  conversaciones,
  actual,
  alAbrir,
  alBorrar,
  conCuenta,
  guardar,
}: {
  conversaciones: ResumenConversacion[];
  actual: string | null;
  alAbrir: (id: string) => void;
  alBorrar: (id: string) => void;
  conCuenta: boolean;
  guardar: boolean;
}) {
  if (!conCuenta) {
    return (
      <div className="px-3 py-4">
        <p className="text-meta leading-snug text-inkSoft">Entra con tu cuenta, que es gratis, para preguntar y guardar tus conversaciones.</p>
        <Link href="/login?next=/app/asistente" className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-granate px-3.5 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
          <LogIn size={14} aria-hidden />
          Entrar
        </Link>
      </div>
    );
  }
  if (!conversaciones.length) {
    return (
      <p className="px-3 py-4 text-meta leading-snug text-mute">
        {guardar ? "Tus conversaciones quedan aquí, guardadas sólo en este navegador." : "No estás guardando tus conversaciones. Puedes activarlo en Ajustes."}
      </p>
    );
  }
  const ahora = new Date();
  const grupos = new Map<string, ResumenConversacion[]>();
  for (const c of conversaciones) {
    const g = grupoDe(c.actualizada, ahora);
    grupos.set(g, [...(grupos.get(g) ?? []), c]);
  }
  return (
    <div className="space-y-3 px-2 py-2">
      {[...grupos].map(([grupo, items]) => (
        <section key={grupo} aria-label={grupo}>
          <p className="px-2.5 pb-1 text-rotulo font-semibold text-mute" aria-hidden>{grupo}</p>
          <ul className="space-y-0.5">
            {items.map((c) => {
              const esta = c.id === actual;
              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => alAbrir(c.id)}
                    aria-current={esta ? "true" : undefined}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-lg py-1.5 pl-2.5 pr-10 text-left transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                      esta ? "bg-paperDeep" : "hover:bg-paperSoft",
                    )}
                  >
                    <span className={cn("line-clamp-1 w-full text-dato text-ink [overflow-wrap:anywhere]", esta ? "font-semibold" : "font-medium")}>{c.titulo}</span>
                    <span className="flex items-center gap-1.5 text-rotulo tabular-nums text-mute">
                      {cuandoCorto(c.actualizada, ahora)}
                      {c.preguntas > 1 && <span>, {c.preguntas} preguntas</span>}
                      {c.profunda && <span className="rounded-full border border-line px-1.5 leading-4">Profundo</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => alBorrar(c.id)}
                    aria-label={`Borrar la conversación «${c.titulo}»`}
                    className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-mute opacity-0 transition-opacity duration-rapido hover:bg-paper hover:text-crimsonTexto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** «Nueva conversación», arriba de la lista. */
export function BotonNueva({ alNueva, desactivado }: { alNueva: () => void; desactivado?: boolean }) {
  return (
    <button
      type="button"
      onClick={alNueva}
      disabled={desactivado}
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-3 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate disabled:opacity-50"
    >
      <MessageSquarePlus size={16} aria-hidden className="text-granate" />
      Nueva conversación
    </button>
  );
}

/** Los ajustes: el modo por defecto, guardar o no el historial y cómo se cuentan las preguntas. */
export function Ajustes({
  modo,
  alCambiarModo,
  cupo,
  guardar,
  alCambiarGuardar,
  hayHistorial,
  alBorrarTodas,
}: {
  modo: ModoVigia;
  alCambiarModo: (m: ModoVigia) => void;
  cupo: CupoChat | null;
  guardar: boolean;
  alCambiarGuardar: (v: boolean) => void;
  hayHistorial: boolean;
  alBorrarTodas: () => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  return (
    <Popover
      titulo="Ajustes del asistente"
      lado="abajo"
      anchoClase="w-[min(20rem,calc(100vw-2rem))]"
      className="h-9 w-9 shrink-0 justify-center rounded-full border border-line text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      trigger={
        <>
          <Settings2 size={16} aria-hidden />
          <span className="sr-only">Ajustes del asistente</span>
        </>
      }
    >
      <span className="block text-meta font-semibold text-ink">Modo de respuesta</span>
      <span className="mt-1.5 block space-y-1" role="radiogroup" aria-label="Modo de respuesta">
        {MODOS.map(({ id, nombre, icono: Icono, detalle }) => {
          const costo = costoDe(id, cupo);
          return (
            <label
              key={id}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors duration-rapido",
                modo === id ? "border-granate/45 bg-paperSoft" : "border-line hover:bg-paperSoft",
              )}
            >
              <input type="radio" name="modo-asistente" checked={modo === id} onChange={() => alCambiarModo(id)} className="mt-1 accent-granate" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold text-ink">
                  <Icono size={14} aria-hidden className="text-granate" />
                  {nombre}
                  <span className="font-normal text-mute">usa {preguntas(costo)}</span>
                </span>
                <span className="block leading-snug text-inkSoft">{detalle}</span>
              </span>
            </label>
          );
        })}
      </span>
      <span className="mt-1.5 block leading-snug text-mute">Los dos son modelos abiertos y responden sólo con los datos de Vigía.</span>

      <span className="-mx-3 my-3 block border-t border-line" aria-hidden />
      <span className="block text-meta font-semibold text-ink">Historial</span>
      <label className="mt-1.5 flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" checked={guardar} onChange={(e) => alCambiarGuardar(e.target.checked)} className="mt-1 accent-granate" />
        <span className="leading-snug text-inkSoft">
          Guardar mis conversaciones en este navegador. No se suben a Vigía: sólo las ves tú, aquí.
        </span>
      </label>
      {hayHistorial && (
        <span className="mt-2 flex flex-wrap items-center gap-2">
          {confirmar ? (
            <>
              <button
                type="button"
                onClick={() => {
                  alBorrarTodas();
                  setConfirmar(false);
                }}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-crimson px-3 font-semibold text-paper"
              >
                <Trash2 size={13} aria-hidden />
                Sí, borrar todas
              </button>
              <button type="button" onClick={() => setConfirmar(false)} className="inline-flex min-h-8 items-center rounded-full border border-line px-3 font-semibold text-inkSoft hover:text-ink">
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line px-3 font-semibold text-inkSoft transition-colors duration-rapido hover:border-crimson/40 hover:text-crimsonTexto">
              <Trash2 size={13} aria-hidden />
              Borrar todas las conversaciones
            </button>
          )}
        </span>
      )}

      <span className="-mx-3 my-3 block border-t border-line" aria-hidden />
      <span className="block text-meta font-semibold text-ink">Cómo se cuentan</span>
      <span className="mt-1 block leading-snug text-inkSoft">
        Tienes {cupo?.tope ?? 10} preguntas cada 24 horas{cupo && !cupo.verificado ? "; con tu correo confirmado, 10" : ""}. Cada una vuelve 24
        horas después de usarla, y si el asistente no llega a responder, no se cuenta.
      </span>
    </Popover>
  );
}
