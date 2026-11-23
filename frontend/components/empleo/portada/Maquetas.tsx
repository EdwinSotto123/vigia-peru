import type { ReactNode } from "react";
import { BellRing, Check, Clock3, Eye, KanbanSquare, MessageCircle, Search, Star, TrendingUp } from "lucide-react";
import { IsotipoGobserva } from "@/components/gobserva/MarcaGobserva";
import { Ejemplo } from "@/components/licitaciones/portada/Maquetas";
import { cn } from "@/lib/utils";

/**
 * Las maquetas de la portada de Gobserva Empleo (2026-11-08): cómo se ve cada paso, armadas con las mismas piezas que la
 * app (no son capturas). Todo es un EJEMPLO y lo dice: entidades genéricas («una UGEL de Cusco»), ningún aviso real, y
 * los sueldos son de ejemplo. Server-safe.
 */
function Maqueta({ titulo, Icono, children, className }: { titulo: string; Icono: typeof Search; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("min-w-0 overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-paperSoft px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-meta font-semibold text-inkSoft">
          <Icono size={15} aria-hidden className="shrink-0 text-granate" />
          <span className="truncate">{titulo}</span>
        </span>
        <Ejemplo />
      </figcaption>
      <div className="p-4 sm:p-5">{children}</div>
    </figure>
  );
}

function Bot({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-paper">
        <IsotipoGobserva tamano={17} />
      </span>
      <p className="min-w-0 rounded-2xl rounded-tl-md border border-line bg-paperSoft px-3.5 py-2 text-dato leading-snug text-ink">{children}</p>
    </div>
  );
}

function Tu({ children }: { children: ReactNode }) {
  return (
    <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-md bg-granate px-3.5 py-2 text-dato font-medium leading-snug text-paper">{children}</p>
  );
}

/** Paso 1: la entrevista del onboarding, en un chat. */
export function MaquetaEntrevista() {
  return (
    <Maqueta titulo="Arma tu perfil" Icono={MessageCircle}>
      <div className="space-y-3">
        <Bot>
          <b className="font-semibold">¿Qué trabajo buscas?</b> Elige un área o escríbelo.
        </Bot>
        <div className="flex flex-wrap gap-1.5 pl-[2.6rem]">
          {["Administración", "Salud", "Contabilidad y finanzas", "Derecho"].map((x, i) => (
            <span
              key={x}
              className={cn(
                "inline-flex min-h-8 items-center rounded-full border px-3 text-meta font-semibold",
                i === 2 ? "border-granate bg-granate-50 text-ink" : "border-line bg-paper text-inkSoft",
              )}
            >
              {x}
            </span>
          ))}
        </div>
        <Tu>Contabilidad y finanzas</Tu>
        <Bot>
          <b className="font-semibold">¿Hasta dónde estudiaste?</b> Te muestro las plazas que piden eso o menos.
        </Bot>
        <Tu>Título profesional</Tu>
      </div>
    </Maqueta>
  );
}

const PLAZAS = [
  { titulo: "Contador", quien: "Una UGEL de Cusco", sueldo: "S/ 3,200", cierra: "Cierra en 2 días", urgente: true, guardada: true },
  { titulo: "Especialista en tesorería", quien: "Un gobierno regional", sueldo: "S/ 4,500", cierra: "Cierra en 4 días", urgente: false, guardada: false },
  { titulo: "Asistente contable", quien: "Una municipalidad de Puno", sueldo: "S/ 2,600", cierra: "Cierra en 6 días", urgente: false, guardada: false },
];

/** Paso 2: «Para ti», las que calzan, de las que cierran primero a las últimas. */
export function MaquetaParaTi() {
  return (
    <Maqueta titulo="Para ti: Contabilidad y finanzas" Icono={Search}>
      <ol className="-my-1 divide-y divide-line">
        {PLAZAS.map((p) => (
          <li key={p.titulo} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-dato font-semibold leading-snug text-ink">{p.titulo}</p>
              <p className="mt-0.5 text-meta text-inkSoft">{p.quien}</p>
              <p className={cn("mt-1 inline-flex items-center gap-1 text-rotulo font-semibold", p.urgente ? "text-crimsonTexto" : "text-granate")}>
                <Clock3 size={12} aria-hidden /> {p.cierra}
              </p>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              <p className="text-right">
                <span className="block font-display text-cuerpo font-bold tabular-nums text-ink">{p.sueldo}</span>
                <span className="block text-rotulo text-mute">al mes</span>
              </p>
              <Star size={17} aria-hidden className={cn("mt-0.5", p.guardada ? "fill-current text-granate" : "text-mute")} />
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-line pt-3 text-meta leading-relaxed text-mute">Solo las que puedes postular: tus estudios, tu experiencia, tu región y tu sueldo mínimo.</p>
    </Maqueta>
  );
}

/** Paso 3: el aviso que llega (correo o notificación). */
export function MaquetaAviso({ correo }: { correo: boolean }) {
  return (
    <Maqueta titulo={correo ? "Tu correo" : "Tu celular"} Icono={BellRing}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-granate-50 text-granate">
          <BellRing size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta text-mute">
            <span className="font-semibold text-inkSoft">Gobserva Empleo</span>
            <span>Hoy, 7:00</span>
          </p>
          <p className="mt-1 text-cuerpo font-semibold leading-snug text-ink">2 plazas nuevas para «contador» en Cusco</p>
          <ul className="mt-3 space-y-2">
            <li className="rounded-xl border border-line bg-paperSoft px-3 py-2">
              <p className="text-dato font-medium text-ink">Contador, S/ 3,200 al mes</p>
              <p className="text-rotulo text-mute">Una UGEL de Cusco, cierra en 5 días</p>
            </li>
            <li className="rounded-xl border border-crimson/25 bg-crimson-soft px-3 py-2">
              <p className="text-dato font-medium text-crimsonTexto">Mañana cierra una plaza que guardaste</p>
              <p className="text-rotulo text-crimsonTexto">Asistente contable en una municipalidad de Puno</p>
            </li>
          </ul>
        </div>
      </div>
    </Maqueta>
  );
}

/** Paso 4: la ficha, con «¿Cumples?», lo que pagan otras y lo que nadie te dice. */
export function MaquetaFicha() {
  const requisitos = [
    { t: "Título en Contabilidad", si: true },
    { t: "2 años de experiencia general", si: true },
    { t: "Curso de SIAF o SIGA", si: false },
  ];
  return (
    <Maqueta titulo="Contador, una UGEL de Cusco" Icono={Eye}>
      <div className="space-y-4">
        <div>
          <p className="flex items-center justify-between gap-3 text-meta font-semibold text-ink">
            ¿Cumples los requisitos? <span className="tabular-nums text-inkSoft">2 de 3</span>
          </p>
          <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-paperDeep">
            <div className="h-full w-2/3 rounded-full bg-granate" />
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {requisitos.map((r) => (
              <li key={r.t} className="flex items-center gap-2 text-meta text-ink">
                <span aria-hidden className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", r.si ? "border-granate bg-granate text-paper" : "border-line")}>
                  {r.si && <Check size={10} strokeWidth={3.5} />}
                </span>
                <span className={r.si ? "" : "text-inkSoft"}>{r.t}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-start gap-2 rounded-xl bg-paperSoft px-3 py-2.5 text-meta leading-snug text-ink">
          <TrendingUp size={15} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
          Paga más que la mayoría de plazas iguales en otras entidades.
        </p>
        <p className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber-soft/50 px-3 py-2.5 text-meta leading-snug text-ink">
          <Eye size={15} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
          <span>
            <b className="font-semibold">Lo que nadie te dice:</b> pide experiencia en la misma entidad que convoca.
          </span>
        </p>
      </div>
    </Maqueta>
  );
}

/** Tus postulaciones en un tablero: de guardada a «me eligieron». */
export function MaquetaTablero() {
  const columnas = [
    { t: "Guardada", tarjetas: ["Contador", "Analista de presupuesto"] },
    { t: "Postulé", tarjetas: ["Especialista en tesorería", "Auxiliar contable"] },
    { t: "Entrevista", tarjetas: ["Asistente contable"] },
    { t: "Me eligieron", tarjetas: ["Contador general"] },
  ];
  return (
    <figure className="min-w-0">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {columnas.map((c) => (
          <div key={c.t} className="min-w-0 rounded-xl border border-paper/15 bg-paper/[0.06] p-2">
            <p className="truncate px-1 pb-1.5 text-rotulo font-semibold text-paper/80">{c.t}</p>
            <ul className="space-y-1.5">
              {c.tarjetas.map((x) => (
                <li key={x} className="rounded-lg bg-paper px-2 py-1.5 text-rotulo font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
                  {x}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex items-center gap-2 text-rotulo text-paper/70">
        <Ejemplo oscuro />
        <KanbanSquare size={13} aria-hidden /> Tu tablero de postulaciones
      </figcaption>
    </figure>
  );
}

/** El asistente de la app (con un plan): le preguntas en tus palabras y responde con las plazas que te calzan. */
export function MaquetaAsistente() {
  const filas = [
    { t: "Contador", q: "Una UGEL de Arequipa", s: "S/ 3,200", c: "Cierra en 2 días" },
    { t: "Analista en presupuesto", q: "Un gobierno regional", s: "S/ 3,500", c: "Cierra en 5 días" },
    { t: "Asistente contable", q: "Una municipalidad", s: "S/ 2,600", c: "Cierra en 6 días" },
  ];
  return (
    <Maqueta titulo="Tu asistente" Icono={MessageCircle}>
      <div className="space-y-3">
        <Tu>Soy contadora con 3 años de experiencia: ¿a qué puedo postular en Arequipa?</Tu>
        <Bot>Hay 4 plazas que te calzan. La primera cierra en 2 días:</Bot>
        <ul className="ml-[2.6rem] divide-y divide-line overflow-hidden rounded-xl border border-line">
          {filas.map((f) => (
            <li key={f.t} className="flex items-start justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-dato font-semibold text-ink">{f.t}</span>
                <span className="block truncate text-rotulo text-mute">{f.q}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-dato font-bold tabular-nums text-ink">{f.s}</span>
                <span className="block text-rotulo text-granate">{f.c}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Maqueta>
  );
}
