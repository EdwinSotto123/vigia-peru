"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUp, BadgeCheck, Check, CircleSlash, Copy, Gavel, Hospital, Loader2, MessageSquarePlus, Phone, RotateCcw, Scale,
  Scissors, Search, Square, Wrench, Pill, History, MessageSquare, X } from "lucide-react";
import { Respuesta } from "@/components/admin/chat/Respuesta";
import { entradaCompacta, type MensajeAsistente, type PasoHerramienta } from "@/components/admin/chat/conversacion";
import { IsotipoGobserva } from "@/components/gobserva/MarcaGobserva";
import { useTurnstile } from "@/components/seguridad/Turnstile";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { useAsistenteSalud, type AvisoSalud, type Conversacion } from "./useAsistenteSalud";

/** Las preguntas para empezar (se mandan al tocarlas). */
const EJEMPLOS: { Icono: typeof Search; texto: string }[] = [
  { Icono: Gavel, texto: "¿El Hospital Loayza tiene sanciones firmes de SUSALUD?" },
  { Icono: Scissors, texto: "¿La Clínica Anglo Americana tiene centro quirúrgico registrado?" },
  { Icono: Hospital, texto: "¿Qué categoría necesita un establecimiento para tener centro quirúrgico?" },
  { Icono: BadgeCheck, texto: "¿Cómo verifico si un médico está habilitado?" },
  { Icono: Pill, texto: "¿Hay alertas de DIGEMID sobre el Panadol Antigripal?" },
  { Icono: Scale, texto: "¿Qué diferencia hay entre una denuncia y una sanción de SUSALUD?" },
];

/** El aviso que no se puede saltar: no es consejo médico, y a quién llamar en una emergencia. */
function NoEsConsejo({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-meta leading-snug text-inkSoft", className)}>
      <Phone size={14} aria-hidden className="mt-0.5 shrink-0 text-crimsonTexto" />
      <span>
        <span className="font-semibold text-ink">No es consejo médico.</span> En una emergencia llama al{" "}
        <a href="tel:106" className="font-semibold text-ink underline underline-offset-2">106 (SAMU)</a> o al{" "}
        <a href="tel:113" className="font-semibold text-ink underline underline-offset-2">113</a>.
      </span>
    </p>
  );
}

/**
 * El asistente público de Gobserva Salud (sin cuenta ni créditos): responde con las herramientas del MCP de Salud
 * (RENIPRESS, el Registro de Sanciones, las denuncias, las normas) y cita cada dato con su fuente y su fecha. Muestra en
 * cada respuesta qué consultó. Una pregunta que llega por `?pregunta=` (desde una ficha) queda escrita en el campo,
 * para que la persona la revise y la mande. Cada envío pide un token de Turnstile (`useTurnstile`).
 */
export function AsistenteSalud({ base, pregunta }: { base: string; pregunta?: string }) {
  const verificacion = useTurnstile("asistente_salud");
  const a = useAsistenteSalud(verificacion.obtenerToken);
  const [texto, setTexto] = useState("");
  // El historial: en el celular y la tableta, un panel en lugar del hilo; en pantalla ancha, además, al costado.
  const [verHistorial, setVerHistorial] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const hilo = useRef<HTMLDivElement>(null);

  // Lo nuevo, a la vista: al final del hilo (sin animación con movimiento reducido).
  const largo = a.mensajes.length;
  const ultimo = a.mensajes[largo - 1];
  const huella = ultimo?.rol === "asistente" ? `${ultimo.texto?.length ?? 0}-${ultimo.pasos.length}-${ultimo.estado}` : "";
  useEffect(() => {
    const h = hilo.current;
    // Sin mensajes no se baja: la bienvenida se lee desde arriba.
    if (!h || !largo) return;
    const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    h.scrollTo({ top: h.scrollHeight, behavior: quieto ? "auto" : "smooth" });
  }, [largo, huella]);
  // Desde una ficha (?pregunta=): la pregunta escrita en el campo, sin mandarla.
  useEffect(() => {
    if (!pregunta || !a.cargado) return;
    setTexto(pregunta.slice(0, 4000));
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("pregunta");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* la pregunta queda en la URL: no pasa nada */
    }
    requestAnimationFrame(() => campo.current?.focus());
  }, [pregunta, a.cargado]);
  // El campo crece con lo que se escribe (hasta 6 líneas).
  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = "auto";
    c.style.height = `${Math.min(c.scrollHeight, 168)}px`;
  }, [texto]);

  async function mandar(x: string) {
    if (!x.trim() || a.corriendo) return;
    setTexto("");
    await a.enviar(x);
    campo.current?.focus();
  }
  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void mandar(texto);
    }
  }
  function nueva() {
    a.nueva();
    setTexto("");
    setVerHistorial(false);
    requestAnimationFrame(() => campo.current?.focus());
  }
  function abrir(id: string) {
    a.abrir(id);
    setVerHistorial(false);
  }

  return (
    <div className="container-page flex h-[calc(100dvh-6.75rem)] min-h-[34rem] gap-5 py-3 sm:py-5 md:h-[calc(100dvh-4rem)]">
      <section aria-labelledby="asistente-t" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-paper">
        <header className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 sm:px-5">
          <IsotipoGobserva tamano={22} />
          <div className="min-w-0 flex-1">
            <h1 id="asistente-t" className="truncate font-display text-bloque font-bold leading-tight text-ink">
              Asistente de Gobserva Salud
            </h1>
            <p className="truncate text-rotulo text-mute">Gratis y sin cuenta. Responde con fuentes oficiales y su fecha.</p>
          </div>
          {a.conversaciones.length > 0 && (
            <button
              type="button"
              onClick={() => setVerHistorial((v) => !v)}
              aria-pressed={verHistorial}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                verHistorial ? "border-granate bg-granate text-paper" : "border-line text-inkSoft hover:border-granate/40 hover:text-ink",
              )}
            >
              <History size={16} aria-hidden />
              <span className="max-sm:sr-only">Historial</span>
              <span className={cn("tabular-nums", verHistorial ? "text-paper/80" : "text-mute")}>{a.conversaciones.length}</span>
            </button>
          )}
          {a.mensajes.length > 0 && (
            <button
              type="button"
              onClick={nueva}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-meta font-semibold text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
            >
              <MessageSquarePlus size={16} aria-hidden />
              <span className="max-sm:sr-only">Nueva conversación</span>
            </button>
          )}
        </header>

        <div ref={hilo} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite" aria-busy={a.corriendo}>
          {verHistorial ? (
            <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6">
              <Conversaciones lista={a.conversaciones} actual={a.actualId} onAbrir={abrir} onBorrar={a.borrar} onNueva={nueva} />
            </div>
          ) : a.mensajes.length === 0 ? (
            <Bienvenida onEjemplo={(x) => void mandar(x)} base={base} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
              {a.mensajes.map((m, i) =>
                m.rol === "usuario" ? (
                  <p
                    key={m.id}
                    className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-granate-50 px-4 py-2.5 text-dato leading-relaxed text-ink [overflow-wrap:anywhere]"
                  >
                    {m.texto}
                  </p>
                ) : (
                  <Turno key={m.id} m={m} ultimo={i === a.mensajes.length - 1} aviso={i === a.mensajes.length - 1 ? a.aviso : null} onReintentar={a.reintentar} onNueva={nueva} />
                ),
              )}
            </div>
          )}
        </div>

        <div className="border-t border-line px-3 pb-3 pt-2.5 sm:px-5">
          <div className="mx-auto max-w-3xl">
            {verificacion.widget}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mandar(texto);
              }}
              className="flex items-end gap-2 rounded-2xl border border-line bg-paperSoft p-1.5 pl-3.5 focus-within:border-granate focus-within:ring-2 focus-within:ring-granate/25"
            >
              <label htmlFor="pregunta-salud" className="sr-only">
                Tu pregunta
              </label>
              <textarea
                id="pregunta-salud"
                ref={campo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={alTeclear}
                rows={1}
                maxLength={4000}
                placeholder="Escribe tu pregunta…"
                className="max-h-[10.5rem] min-h-[2.75rem] w-full flex-1 resize-none bg-transparent py-2.5 text-destacado leading-snug text-ink placeholder:text-mute focus:outline-none sm:text-dato"
              />
              {a.corriendo ? (
                <button
                  type="button"
                  onClick={a.detener}
                  aria-label="Detener la respuesta"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-paper text-ink hover:border-granate/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                >
                  <Square size={14} aria-hidden className="fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!texto.trim()}
                  aria-label="Enviar la pregunta"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-granate text-paper transition-opacity duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-35"
                >
                  <ArrowUp size={18} aria-hidden />
                </button>
              )}
            </form>
            <NoEsConsejo className="mt-2" />
          </div>
        </div>
      </section>

      <aside aria-label="Tus conversaciones y cómo responde el asistente" className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto xl:flex">
        {a.conversaciones.length > 0 && (
          <section className="rounded-2xl border border-line bg-paper p-4">
            <Conversaciones lista={a.conversaciones} actual={a.actualId} onAbrir={abrir} onBorrar={a.borrar} onNueva={nueva} compacto />
          </section>
        )}
        <ComoResponde base={base} />
      </aside>
    </div>
  );
}

/** Qué hace y con qué datos: al lado en pantallas anchas, dentro de la bienvenida en las demás. */
function ComoResponde({ base, compacto = false }: { base: string; compacto?: boolean }) {
  const Titulo = compacto ? "h3" : "h2";
  const items = [
    { Icono: Search, t: "Consulta antes de responder", d: "Busca el establecimiento y abre su ficha: RENIPRESS, sanciones firmes, denuncias y normas de salud." },
    { Icono: Check, t: "Cada dato con su fuente y su fecha", d: "Y el enlace a la ficha o a la fuente oficial para que lo compruebes." },
    { Icono: Scale, t: "Sanción no es denuncia", d: "Distingue una sanción firme de SUSALUD de una denuncia y de lo que la IPRESS declaró." },
    { Icono: CircleSlash, t: "No califica a nadie", d: "No dice que algo sea seguro o peligroso, ni busca médicos por su nombre." },
  ];
  return (
    // Dentro del panel (compacto) va sin caja propia: un filete arriba y la lista.
    <div className={cn(compacto ? "border-t border-line pt-5" : "tarjeta rounded-2xl border border-line bg-paper p-4")}>
      <Titulo className={cn("font-display font-bold text-ink", compacto ? "text-dato" : "text-bloque")}>Cómo responde</Titulo>
      <ul className="mt-3 space-y-3">
        {items.map(({ Icono, t, d }) => (
          <li key={t} className="flex items-start gap-2.5">
            <Icono size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            <span className="min-w-0 text-meta leading-snug text-inkSoft">
              <span className="block text-dato font-semibold text-ink">{t}</span>
              {d}
            </span>
          </li>
        ))}
      </ul>
      {!compacto && (
        <p className="mt-4 border-t border-line pt-3 text-meta leading-snug text-inkSoft">
          ¿Prefieres buscar tú?{" "}
          <Link href={rutaEn(base, "/buscar")} className="font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
            Usa el buscador
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function Bienvenida({ onEjemplo, base }: { onEjemplo: (x: string) => void; base: string }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto my-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <h2 className="text-balance font-display text-cifra font-bold leading-tight text-ink">¿Qué quieres verificar?</h2>
        <p className="mt-2 max-w-[56ch] text-pretty text-dato leading-relaxed text-inkSoft">
          Pregunta por una clínica, un hospital o un consultorio, por sus sanciones, o por cómo verificar a un médico. Las respuestas citan
          cada dato con su fuente y su fecha.
        </p>
        <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
          {EJEMPLOS.map(({ Icono, texto }) => (
            <li key={texto}>
              <button
                type="button"
                onClick={() => onEjemplo(texto)}
                className="flex h-full min-h-11 w-full items-start gap-3 rounded-xl border border-line bg-paperSoft px-3.5 py-3 text-left text-dato leading-snug text-ink transition-colors duration-rapido hover:border-granate/50 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                <Icono size={17} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                {texto}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6 xl:hidden">
          <ComoResponde base={base} compacto />
        </div>
      </div>
    </div>
  );
}

/** Las herramientas que usó una respuesta, con lo que buscó en cada una. */
function Herramientas({ pasos, abierto }: { pasos: PasoHerramienta[]; abierto: boolean }) {
  if (!pasos.length) return null;
  return (
    <details className="group rounded-xl border border-line bg-paperSoft" open={abierto}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-meta font-semibold text-inkSoft [&::-webkit-details-marker]:hidden">
        <Wrench size={14} aria-hidden className="shrink-0 text-mute" />
        {pasos.length === 1 ? "Consultó 1 herramienta" : `Consultó ${pasos.length} herramientas`}
        <span className="ml-auto text-rotulo font-normal text-mute group-open:hidden">Ver</span>
        <span className="ml-auto hidden text-rotulo font-normal text-mute group-open:inline">Ocultar</span>
      </summary>
      <ol className="space-y-2 border-t border-line px-3 py-2.5">
        {pasos.map((p) => {
          const entrada = entradaCompacta(p.entrada, 70);
          return (
            <li key={p.id} className="flex items-start gap-2 text-meta">
              {p.estado === "en_curso" ? (
                <Loader2 size={14} aria-hidden className="mt-0.5 shrink-0 animate-spin text-granate motion-reduce:animate-none" />
              ) : p.estado === "listo" ? (
                <Check size={14} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
              ) : (
                <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
              )}
              <span className="min-w-0">
                <span className="font-medium text-ink">{p.titulo}</span>
                {p.estado === "error" && <span className="text-amberTexto"> (no respondió)</span>}
                {p.estado === "cortado" && <span className="text-mute"> (sin terminar)</span>}
                {entrada.length > 0 && (
                  <span className="block text-rotulo text-mute [overflow-wrap:anywhere]">
                    {entrada.map((x) => `${x.clave}: ${x.valor}`).join("; ")}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function Turno({
  m, ultimo, aviso, onReintentar, onNueva,
}: {
  m: MensajeAsistente;
  ultimo: boolean;
  aviso: AvisoSalud | null;
  onReintentar: () => void;
  onNueva: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const corriendo = m.estado === "corriendo";
  const herramientas = m.pasos.filter((p): p is PasoHerramienta => p.tipo === "herramienta");
  const enCurso = [...herramientas].reverse().find((p) => p.estado === "en_curso");
  async function copiar() {
    if (!m.texto) return;
    try {
      await navigator.clipboard.writeText(m.texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* sin permiso para copiar */
    }
  }
  const larga = aviso?.estado === 413 || aviso?.codigo === "conversacion_larga";
  const esperar = aviso?.estado === 429;
  return (
    <article className="flex min-w-0 gap-3">
      <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-paperSoft">
        <IsotipoGobserva tamano={16} />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        {corriendo && (
          <p className="flex items-center gap-2 py-1 text-dato text-inkSoft" role="status">
            <Loader2 size={15} aria-hidden className="animate-spin text-granate motion-reduce:animate-none" />
            {enCurso ? `Consultando: ${enCurso.titulo}` : herramientas.length ? "Escribiendo la respuesta…" : "Pensando…"}
          </p>
        )}
        {corriendo && herramientas.length > 0 && <Herramientas pasos={herramientas} abierto />}
        {m.texto != null && <Respuesta texto={m.texto} />}
        {!corriendo && m.texto == null && (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-crimson/25 bg-crimson-soft px-3.5 py-2.5">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-dato text-crimsonTexto">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {m.estado === "detenido" ? "Detuviste la respuesta." : m.error ?? "La respuesta se cortó antes de terminar."}
              </span>
            </p>
            {ultimo && larga && (
              <button type="button" onClick={onNueva} className={claseAccion("secundario", "min-h-11")}>
                <MessageSquarePlus size={14} aria-hidden /> Empezar una nueva
              </button>
            )}
            {ultimo && !larga && !esperar && (
              <button type="button" onClick={onReintentar} className={claseAccion("secundario", "min-h-11")}>
                <RotateCcw size={14} aria-hidden /> Reintentar
              </button>
            )}
          </div>
        )}
        {!corriendo && m.texto != null && (
          <div className="space-y-2">
            <Herramientas pasos={herramientas} abierto={false} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-mute">
              <button
                type="button"
                onClick={() => void copiar()}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg font-semibold text-inkSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                {copiado ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} {copiado ? "Copiado" : "Copiar la respuesta"}
              </button>
              <span>Comprueba cada dato en el enlace de su fuente.</span>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/** «hoy, 10:32», «ayer, 18:05», «12 nov.»: cuándo fue una conversación. */
function cuando(en: number): string {
  const d = new Date(en);
  const hora = d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `hoy, ${hora}`;
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return `ayer, ${hora}`;
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "short" });
}

/**
 * Las conversaciones anteriores (2026-11-22, el usuario: «dale historial»): cada una con su primera pregunta, cuándo y
 * cuántas preguntas tuvo; se retoma con un toque y se borra con la X. Sólo en este dispositivo, como «lo visto».
 */
function Conversaciones({
  lista,
  actual,
  onAbrir,
  onBorrar,
  onNueva,
  compacto = false,
}: {
  lista: Conversacion[];
  actual: string;
  onAbrir: (id: string) => void;
  onBorrar: (id: string | "todas") => void;
  onNueva: () => void;
  compacto?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <History size={compacto ? 16 : 18} aria-hidden className="text-granate" /> Tus conversaciones
        </h2>
        {!compacto && (
          <button type="button" onClick={onNueva} className={claseAccion("primario", "min-h-11")}>
            <MessageSquarePlus size={16} aria-hidden /> Nueva
          </button>
        )}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-rotulo text-mute">
        Sólo en este dispositivo.
        <button type="button" onClick={() => onBorrar("todas")} className="inline-flex min-h-11 items-center font-semibold text-granate underline-offset-4 hover:underline sm:min-h-7">
          Borrar todas
        </button>
      </p>
      <ul className={cn("mt-2", compacto ? "space-y-1.5" : "grid gap-2.5 sm:grid-cols-2")}>
        {(compacto ? lista.slice(0, 8) : lista).map((c) => (
          <li
            key={c.id}
            className={cn(
              "group relative flex items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors duration-rapido",
              c.id === actual ? "border-granate/50 bg-granate-50" : "border-line bg-paper hover:border-granate/40",
            )}
          >
            <MessageSquare size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <button
              type="button"
              onClick={() => onAbrir(c.id)}
              aria-current={c.id === actual ? "true" : undefined}
              className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            >
              <span className="line-clamp-2 text-meta font-semibold leading-snug text-ink group-hover:text-granate">{c.titulo}</span>
              <span className="mt-0.5 block text-rotulo text-mute">
                {cuando(c.en)}, {c.preguntas === 1 ? "1 pregunta" : `${c.preguntas} preguntas`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onBorrar(c.id)}
              aria-label={`Borrar la conversación «${c.titulo}»`}
              className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full text-mute transition-colors duration-rapido hover:bg-ink/[0.06] hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
