"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  AlertTriangle, ArrowUp, BadgeCheck, Check, ClipboardList, Coins, Copy, FileSearch, History, Landmark, Loader2, MapPin, MessageSquarePlus,
  Pencil, RotateCcw, Scale, Search, Square, TrendingUp, X,
} from "lucide-react";
import { Respuesta } from "@/components/admin/chat/Respuesta";
import { Descargas } from "@/components/admin/chat/Descargas";
import type { MensajeAsistente, PasoHerramienta } from "@/components/admin/chat/conversacion";
import { IsotipoGobserva } from "@/components/gobserva/MarcaGobserva";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { cargarConversaciones, cargarUsoMcp, fechaLarga, renombrarConversacion } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Historial } from "./Historial";
import { MODOS, MODOS_DE, useAsistente, type AppAsistente } from "./useAsistente";

type Ejemplo = { Icono: typeof Search; texto: string };

const TEXTOS: Record<AppAsistente, { saludo: string; contexto: string; perfil: string; ejemplos: Ejemplo[]; placeholder: string }> = {
  empleo: {
    saludo: "¿Qué plaza buscamos hoy?",
    contexto: "Busco en las plazas CAS abiertas hoy y uso tu perfil (tu carrera, tus estudios y dónde quieres trabajar) sin que lo repitas.",
    perfil: "/app/bienvenida",
    ejemplos: [
      { Icono: Search, texto: "¿Qué plazas de mi carrera cierran esta semana?" },
      { Icono: MapPin, texto: "¿Qué plazas hay en Arequipa que paguen más de S/ 3,000?" },
      { Icono: ClipboardList, texto: "Explícame qué piden las plazas de asistente administrativo y si las cumplo." },
      { Icono: BadgeCheck, texto: "¿Qué plazas piden solo secundaria y pagan más de S/ 2,000?" },
    ],
    placeholder: "Pregunta por plazas, requisitos o sueldos…",
  },
  licitaciones: {
    saludo: "¿Qué le vendemos al Estado hoy?",
    contexto: "Busco en el SEACE, los contratos menores, las obras y el mercado, y uso tus líneas de negocio sin que las repitas.",
    perfil: "/cuenta?tab=para-ti",
    ejemplos: [
      { Icono: Search, texto: "¿Qué oportunidades de mi rubro cierran consultas esta semana?" },
      { Icono: TrendingUp, texto: "¿Quién gana más contratos de mi rubro en Lima y a qué precio?" },
      { Icono: FileSearch, texto: "¿Qué experiencia piden las bases de las licitaciones de uniformes de este mes?" },
      { Icono: Landmark, texto: "¿Qué obras de agua potable de más de S/ 5 millones se vienen en Puno?" },
    ],
    placeholder: "Pregunta por licitaciones, bases, compradores o competencia…",
  },
};

const NUM = new Intl.NumberFormat("es-PE");

/**
 * El asistente de cada app (2026-11-08): un espacio de trabajo como los de Claude o ChatGPT, con el historial de
 * conversaciones a un lado (en el celular, en una hoja), la conversación con su título editable y el campo abajo. Usa el
 * perfil de la cuenta, cobra de los créditos del plan y guarda cada conversación en la cuenta (migración 269). Sin plan,
 * ofrece los planes.
 */
export function Asistente({ app, base }: { app: AppAsistente; base: string }) {
  const uso = useSWR(["gobserva-mcp", app], () => cargarUsoMcp(app), { revalidateOnFocus: false });
  const lista = useSWR(["gobserva-conversaciones", app], () => cargarConversaciones(app), { revalidateOnFocus: false });
  const refrescar = useCallback(() => {
    void uso.mutate();
    void lista.mutate();
  }, [uso, lista]);
  const a = useAsistente(app, refrescar);
  const [texto, setTexto] = useState("");
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const hilo = useRef<HTMLDivElement>(null);
  const t = TEXTOS[app];
  const sinPlan = uso.data ? uso.data.creditos === 0 : false;
  const modos = MODOS_DE[app];
  const quedan = uso.data ? Math.max(0, uso.data.creditos - uso.data.usados) : null;

  // Lo nuevo, a la vista: al final del hilo.
  const largo = a.mensajes.length;
  const ultimoTexto = a.mensajes[largo - 1]?.rol === "asistente" ? (a.mensajes[largo - 1] as MensajeAsistente).texto : null;
  useEffect(() => {
    const h = hilo.current;
    if (h) h.scrollTo({ top: h.scrollHeight, behavior: "smooth" });
  }, [largo, ultimoTexto]);
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
    setHistorialAbierto(false);
    setTexto("");
    requestAnimationFrame(() => campo.current?.focus());
  }
  async function abrir(id: string) {
    setHistorialAbierto(false);
    await a.abrir(id);
  }

  const historial = (
    <Historial
      conversaciones={lista.data?.data}
      cargando={lista.isLoading}
      activa={a.conversacion?.id ?? null}
      onAbrir={(id) => void abrir(id)}
      onNueva={nueva}
      onCambio={(borrada) => {
        void lista.mutate();
        if (borrada && borrada === a.conversacion?.id) a.nueva();
      }}
      usoHref={rutaEn(base, "/cuenta?tab=pagos#uso")}
      producto={app}
    />
  );

  if (sinPlan) {
    return (
      <div className="mx-auto w-full max-w-[84rem] px-4 pb-10 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <div className="mx-auto max-w-xl rounded-2xl border border-line bg-caja p-6 text-center shadow-caja sm:p-8">
          <span aria-hidden className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-line bg-paper">
            <IsotipoGobserva tamano={24} />
          </span>
          <h1 className="mt-4 font-display text-seccion font-bold text-ink">El asistente viene con los planes de pago</h1>
          <p className="mx-auto mt-2 max-w-[48ch] text-dato leading-relaxed text-inkSoft">
            Con un plan, cada mes tienes créditos para preguntarle aquí y a tu IA por el MCP.{" "}
            {app === "empleo" ? "Con el plan Alertas son 300: cada pregunta usa 5." : "Con Inicia son 1,500: una pregunta rápida usa 5."}
          </p>
          <Link href={rutaEn(base, "/planes")} className={claseAccion("primario", "mt-5")}>Ver los planes</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))] w-full max-w-[84rem] gap-4 px-3 py-3 sm:px-6 lg:h-[calc(100dvh-4rem)] lg:gap-5 lg:px-8 lg:py-5">
      {/* El historial: al lado desde lg; en el celular, una hoja que se abre con «Historial». */}
      <aside aria-label="Historial del asistente" className="hidden w-72 shrink-0 overflow-hidden rounded-2xl border border-line bg-caja shadow-caja lg:block">
        {historial}
      </aside>
      {historialAbierto && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Historial del asistente">
          <button type="button" aria-label="Cerrar el historial" onClick={() => setHistorialAbierto(false)} className="absolute inset-0 bg-ink/40" />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-caja shadow-xl">
            <button type="button" onClick={() => setHistorialAbierto(false)} aria-label="Cerrar" className="absolute right-2 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full text-mute hover:bg-ink/[0.05]">
              <X size={16} aria-hidden />
            </button>
            {historial}
          </div>
        </div>
      )}

      <section aria-label="Conversación con el asistente" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-caja shadow-caja">
        <Cabecera
          titulo={a.conversacion?.titulo ?? null}
          id={a.conversacion?.id ?? null}
          onRenombrado={(titulo) => {
            if (a.conversacion) a.setConversacion({ ...a.conversacion, titulo });
            void lista.mutate();
          }}
          onHistorial={() => setHistorialAbierto(true)}
          onNueva={nueva}
          hayMensajes={a.mensajes.length > 0}
          quedan={quedan}
          delMes={uso.data?.creditos ?? null}
        />

        <div ref={hilo} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {a.abriendo ? (
            <p className="flex items-center gap-2 p-6 text-dato text-inkSoft"><Loader2 size={16} aria-hidden className="animate-spin text-granate" /> Abriendo la conversación…</p>
          ) : a.mensajes.length === 0 ? (
            <Bienvenida textos={t} base={base} onEjemplo={(x) => void mandar(x)} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
              {a.mensajes.map((m, i) =>
                m.rol === "usuario" ? (
                  <p key={m.id} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-granate-50 px-4 py-2.5 text-dato leading-relaxed text-ink [overflow-wrap:anywhere]">
                    {m.texto}
                  </p>
                ) : (
                  <Turno
                    key={m.id}
                    m={m}
                    app={app}
                    pregunta={i > 0 && a.mensajes[i - 1].rol === "usuario" ? (a.mensajes[i - 1] as { texto: string }).texto : null}
                    ultimo={i === a.mensajes.length - 1}
                    onReintentar={a.reintentar}
                    creditos={a.creditos[m.id] ?? null}
                  />
                ),
              )}
            </div>
          )}
        </div>

        <div className="border-t border-line bg-caja px-3 pb-3 pt-2.5 sm:px-5">
          <div className="mx-auto max-w-3xl">
            {a.aviso && (
              <p role="alert" className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-crimson/30 bg-crimson-soft px-3.5 py-2.5 text-dato text-crimsonTexto">
                <AlertTriangle size={15} aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1">{a.aviso.texto}</span>
                {(a.aviso.codigo === "sin_plan" || a.aviso.codigo === "sin_creditos") && (
                  <Link href={rutaEn(base, "/planes")} className="font-semibold underline underline-offset-2">Ver los planes</Link>
                )}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mandar(texto);
              }}
              className="flex items-end gap-2 rounded-2xl border border-line bg-paper p-1.5 pl-3.5 focus-within:border-granate focus-within:ring-2 focus-within:ring-granate/25"
            >
              <label htmlFor={`asistente-${app}`} className="sr-only">Tu pregunta</label>
              <textarea
                id={`asistente-${app}`}
                ref={campo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={alTeclear}
                rows={1}
                maxLength={4000}
                placeholder={t.placeholder}
                className="max-h-[10.5rem] min-h-[2.75rem] w-full flex-1 resize-none bg-transparent py-2.5 text-destacado leading-snug text-ink placeholder:text-mute focus:outline-none sm:text-dato"
              />
              {a.corriendo ? (
                <button type="button" onClick={a.detener} aria-label="Detener la respuesta" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-caja text-ink hover:border-granate/50">
                  <Square size={14} aria-hidden className="fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!texto.trim()}
                  aria-label="Enviar la pregunta"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate text-paper transition-opacity duration-rapido disabled:opacity-35"
                >
                  <ArrowUp size={18} aria-hidden />
                </button>
              )}
            </form>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              {modos.length > 1 ? (
                <fieldset className="flex flex-wrap items-center gap-1.5">
                  <legend className="sr-only">Modo</legend>
                  {modos.map((x) => (
                    <label
                      key={x}
                      title={MODOS[x].detalle}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-meta has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-granate",
                        a.modo === x ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line text-inkSoft hover:text-ink",
                      )}
                    >
                      <input type="radio" name={`modo-${app}`} value={x} checked={a.modo === x} onChange={() => a.setModo(x)} className="sr-only" />
                      {MODOS[x].etiqueta} <span className="font-normal text-mute">{MODOS[x].costo}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="text-meta text-mute">Cada pregunta usa 5 créditos.</p>
              )}
              <p className="text-meta text-mute">
                {uso.data?.renueva ? `Tus créditos se renuevan el ${fechaLarga(uso.data.renueva)}. ` : ""}Tus conversaciones quedan en tu cuenta y puedes borrarlas.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** El título de la conversación (editable), los créditos que quedan y, en el celular, el historial y «Nueva». */
function Cabecera({
  titulo, id, onRenombrado, onHistorial, onNueva, hayMensajes, quedan, delMes,
}: {
  titulo: string | null;
  id: string | null;
  onRenombrado: (titulo: string) => void;
  onHistorial: () => void;
  onNueva: () => void;
  hayMensajes: boolean;
  quedan: number | null;
  delMes: number | null;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    const v = valor.trim();
    if (!id || !v || v === titulo) return setEditando(false);
    setGuardando(true);
    try {
      await renombrarConversacion(id, v);
      onRenombrado(v);
      setEditando(false);
    } finally {
      setGuardando(false);
    }
  }
  return (
    <header className="flex min-h-14 items-center gap-2 border-b border-line px-3 py-2 sm:px-5">
      <button type="button" onClick={onHistorial} aria-label="Ver tus conversaciones" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-inkSoft hover:bg-ink/[0.05] lg:hidden">
        <History size={18} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        {editando ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void guardar();
            }}
            className="flex items-center gap-1.5"
          >
            <label htmlFor="titulo-conversacion" className="sr-only">Nombre de la conversación</label>
            <input
              id="titulo-conversacion"
              autoFocus
              value={valor}
              maxLength={120}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditando(false)}
              className="min-h-9 w-full rounded-lg border border-granate bg-paper px-2.5 text-dato text-ink focus:outline-none focus:ring-2 focus:ring-granate/30"
            />
            <button type="submit" disabled={guardando} aria-label="Guardar el nombre" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-granate text-paper">
              {guardando ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <Check size={16} aria-hidden />}
            </button>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate font-display text-bloque font-bold text-ink">{titulo ?? (hayMensajes ? "Conversación nueva" : "Asistente")}</h1>
            {id && (
              <button
                type="button"
                onClick={() => {
                  setValor(titulo ?? "");
                  setEditando(true);
                }}
                aria-label="Cambiar el nombre de la conversación"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mute hover:bg-ink/[0.05] hover:text-ink"
              >
                <Pencil size={14} aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
      {quedan != null && delMes != null && (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-meta text-inkSoft sm:inline-flex" title="Créditos de este mes">
          <Coins size={14} aria-hidden className="text-granate" />
          <b className="font-semibold tabular-nums text-ink">{NUM.format(quedan)}</b> de {NUM.format(delMes)}
        </span>
      )}
      {hayMensajes && (
        <button type="button" onClick={onNueva} aria-label="Nueva conversación" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-inkSoft hover:bg-ink/[0.05] lg:hidden">
          <MessageSquarePlus size={18} aria-hidden />
        </button>
      )}
    </header>
  );
}

/** Antes de la primera pregunta: qué hace, con qué datos y cuatro preguntas para empezar. */
function Bienvenida({ textos, base, onEjemplo }: { textos: (typeof TEXTOS)[AppAsistente]; base: string; onEjemplo: (x: string) => void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-8 sm:px-6">
      <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full border border-line bg-paper">
        <IsotipoGobserva tamano={24} />
      </span>
      <h2 className="mt-4 text-balance font-display text-cifra font-bold leading-tight text-ink">{textos.saludo}</h2>
      <p className="mt-2 max-w-[56ch] text-pretty text-dato leading-relaxed text-inkSoft">
        {textos.contexto}{" "}
        <Link href={rutaEn(base, textos.perfil)} className="font-semibold text-granate underline-offset-2 hover:underline">Revisa tu perfil</Link>
      </p>
      <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
        {textos.ejemplos.map(({ Icono, texto }) => (
          <li key={texto}>
            <button
              type="button"
              onClick={() => onEjemplo(texto)}
              className="flex h-full w-full items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 text-left text-dato leading-snug text-ink transition-colors duration-rapido hover:border-granate/50 hover:bg-granate-50/40"
            >
              <Icono size={17} aria-hidden className="mt-0.5 shrink-0 text-granate" />
              {texto}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-1.5 text-meta text-mute">
        <Scale size={13} aria-hidden /> Responde con datos públicos de hoy y el enlace oficial de cada uno.
      </p>
    </div>
  );
}

function Turno({
  m, app, pregunta, ultimo, onReintentar, creditos,
}: {
  m: MensajeAsistente;
  app: AppAsistente;
  pregunta: string | null;
  ultimo: boolean;
  onReintentar: () => void;
  creditos: number | null;
}) {
  const pintada = useRef<HTMLDivElement>(null);
  const [copiado, setCopiado] = useState(false);
  const corriendo = m.estado === "corriendo";
  const herramientas = m.pasos.filter((p): p is PasoHerramienta => p.tipo === "herramienta");
  const enCurso = [...herramientas].reverse().find((p) => p.estado === "en_curso");
  const consultas = [...new Set(herramientas.filter((p) => p.estado === "listo").map((p) => p.titulo))];
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
  return (
    <article aria-busy={corriendo} className="flex min-w-0 gap-3">
      <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-paper">
        <IsotipoGobserva tamano={16} />
      </span>
      <div className="min-w-0 flex-1">
        {m.texto != null && (
          <div ref={pintada}>
            <Respuesta texto={m.texto} />
          </div>
        )}
        {corriendo && (
          <p className="flex items-center gap-2 py-1 text-dato text-inkSoft">
            <Loader2 size={15} aria-hidden className="animate-spin text-granate" />
            {enCurso ? `Consultando: ${enCurso.titulo}` : consultas.length ? "Escribiendo la respuesta…" : "Pensando…"}
          </p>
        )}
        {!corriendo && m.texto == null && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-crimson/25 bg-crimson-soft px-3.5 py-2.5">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-dato text-crimsonTexto">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {m.estado === "detenido" ? "Detuviste la respuesta. No se usaron créditos." : m.error ?? "La respuesta se cortó antes de terminar. No se usaron créditos."}
              </span>
            </p>
            {ultimo && (
              <button type="button" onClick={onReintentar} className={claseAccion("secundario")}>
                <RotateCcw size={14} aria-hidden /> Reintentar
              </button>
            )}
          </div>
        )}
        {!corriendo && m.texto != null && (
          <div className="mt-2 space-y-2">
            {app === "licitaciones" && <Descargas texto={m.texto} pregunta={pregunta} modelo={m.modelo} pasos={m.pasos} revision={m.revision} contenido={pintada} />}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-mute">
              {app === "empleo" && (
                <button type="button" onClick={() => void copiar()} className="inline-flex items-center gap-1 font-semibold text-inkSoft hover:text-ink">
                  {copiado ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} {copiado ? "Copiado" : "Copiar"}
                </button>
              )}
              {consultas.length > 0 && <span>Consultó: {consultas.join(", ")}.</span>}
              {creditos != null && <span>Usó {creditos} {creditos === 1 ? "crédito" : "créditos"}.</span>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
