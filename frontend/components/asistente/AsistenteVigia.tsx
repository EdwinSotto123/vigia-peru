"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUp, Briefcase, Building2, Check, FileSearch, Landmark, Link2, Loader2, LogIn, MessageSquarePlus, RotateCcw, ShieldCheck, Square,
  TriangleAlert, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Respuesta } from "@/components/admin/chat/Respuesta";
import { RevisionRespuesta } from "@/components/admin/chat/RevisionRespuesta";
import { BurbujaUsuario } from "@/components/admin/chat/Turno";
import {
  aplicarEvento, cerrarTurno, comoEvento, historial, nuevoId, turnoVacio, type EventoChat, type Mensaje, type MensajeAsistente,
  type MensajeUsuario, type PasoHerramienta,
} from "@/components/admin/chat/conversacion";
import { Llamita } from "@/components/marca/Llamita";
import { authFetch } from "@/lib/cuentas";
import { cn } from "@/lib/utils";

/**
 * El asistente de investigación de Vigía (auditoría de producto del 2026-11-12, decisión D5): una pregunta en palabras
 * y una respuesta armada sólo con los datos de Vigía, con sus enlaces, lo que consultó para darla y la revisión
 * automática de enlaces y montos. Es el motor del chat del panel (POST /cuentas/me/chat) con tope de preguntas por día.
 * La conversación vive en esta pestaña: no se guarda en el servidor.
 *
 * Se ve como un chat desde el primer momento (pedido del usuario del 2026-11-13: «debería mostrar un chat con "¿Quieres
 * saber más?"»): el asistente saluda y pregunta qué quieres saber, las preguntas de ejemplo son respuestas rápidas, y
 * tras cada respuesta ofrece cómo seguir. Sin cuenta también se escribe: la pregunta se guarda en esta pestaña
 * (sessionStorage, nunca en la URL ni en el servidor) y se envía sola al volver de entrar.
 */

const PENDIENTE = "vigia-asistente-pendiente";
const MAX_PREGUNTAS = 10;

/** Las preguntas de ejemplo, con el tipo de dato que tocan (su ícono). */
const EJEMPLOS: { icono: LucideIcon; texto: string }[] = [
  { icono: Building2, texto: "¿Qué proveedores ganaron más contratos con la Municipalidad Provincial de Cajamarca?" },
  { icono: FileSearch, texto: "Encuentra contratos de 2026 con una sola oferta válida en Áncash" },
  { icono: TriangleAlert, texto: "¿Qué evidencia respalda las señales del contrato 1255784?" },
  { icono: Landmark, texto: "Compara lo que gastan en consultorías los gobiernos regionales de Cusco y Arequipa" },
];

/** Cómo seguir después de una respuesta: valen para cualquier pregunta. */
const SEGUIR = [
  "¿De dónde sale cada dato?",
  "¿Qué no pudiste verificar?",
  "Explícamelo más simple",
  "¿Qué debería revisar primero?",
];

/** Lo que puede buscar, para la columna de al lado. */
const ALCANCE: { icono: LucideIcon; titulo: string; ejemplo: string }[] = [
  { icono: FileSearch, titulo: "Contratos y órdenes", ejemplo: "sus señales, quién ganó, cuánto y cuándo" },
  { icono: Building2, titulo: "Entidades", ejemplo: "a quién le compran, sus banderas y su presupuesto" },
  { icono: Briefcase, titulo: "Empresas", ejemplo: "lo que ganaron, sus socios y antecedentes" },
  { icono: Landmark, titulo: "Partidos y gobiernos", ejemplo: "quién gobierna y qué se contrató en su gestión" },
];

const COMO: string[] = [
  "Sólo con los datos que ves en Vigía: no busca en internet.",
  "Cada dato lleva su enlace a la ficha o a la fuente oficial.",
  "Revisa por su cuenta los enlaces y montos que da, y marca los que no cuadran.",
  "Dice lo que no pudo verificar.",
  "No muestra DNI y tapa un apellido de las personas naturales.",
];

/** Lee el NDJSON del asistente línea por línea. */
async function leer(r: Response, aplicar: (e: EventoChat) => void) {
  const procesar = (linea: string) => {
    const t = linea.trim();
    if (!t) return;
    try {
      const e = comoEvento(JSON.parse(t));
      if (e) aplicar(e);
    } catch {
      /* una línea rota no corta la respuesta */
    }
  };
  if (!r.body) {
    (await r.text()).split("\n").forEach(procesar);
    return;
  }
  const lector = r.body.getReader();
  const deco = new TextDecoder();
  let resto = "";
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    resto += deco.decode(value, { stream: true });
    const lineas = resto.split("\n");
    resto = lineas.pop() ?? "";
    lineas.forEach(procesar);
  }
  procesar(resto);
}

function guardarPendiente(q: string) {
  try {
    sessionStorage.setItem(PENDIENTE, q);
  } catch {
    /* sin almacenamiento: la pregunta se vuelve a escribir */
  }
}
function tomarPendiente(): string | null {
  try {
    const q = sessionStorage.getItem(PENDIENTE);
    sessionStorage.removeItem(PENDIENTE);
    return q;
  } catch {
    return null;
  }
}

export function AsistenteVigia() {
  const { user, loading } = useAuth();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [corriendo, setCorriendo] = useState(false);
  /** Sin cuenta: la pregunta que se escribió, a la espera de entrar. */
  const [sinCuenta, setSinCuenta] = useState<string | null>(null);
  const control = useRef<AbortController | null>(null);
  const ultimos = useRef<Mensaje[]>([]);
  const fin = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  ultimos.current = mensajes;

  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => {
    if (mensajes.length || sinCuenta) fin.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mensajes.length, sinCuenta]);

  const enviar = useCallback(
    async (crudo: string, base?: Mensaje[]) => {
      const pregunta = crudo.trim();
      if (!pregunta || control.current) return;
      if (!user) {
        // Sin cuenta: se muestra la pregunta y el asistente pide entrar; la pregunta espera en esta pestaña.
        guardarPendiente(pregunta);
        setSinCuenta(pregunta);
        setTexto("");
        return;
      }
      const previos = base ?? ultimos.current;
      const usuario: MensajeUsuario = { id: nuevoId(), rol: "usuario", texto: pregunta };
      const asistente = turnoVacio(nuevoId(), "rapido");
      setMensajes([...previos, usuario, asistente]);
      setTexto("");
      setCorriendo(true);
      const ac = new AbortController();
      control.current = ac;
      const cambiar = (fn: (m: MensajeAsistente) => MensajeAsistente) =>
        setMensajes((ms) => ms.map((m) => (m.id === asistente.id && m.rol === "asistente" ? fn(m) : m)));
      const aplicar = (e: EventoChat) => cambiar((m) => aplicarEvento(m, e));
      try {
        const r = await authFetch("/cuentas/me/chat", {
          method: "POST",
          headers: { Accept: "application/x-ndjson" },
          body: JSON.stringify({ mensajes: historial([...previos, usuario]) }),
          signal: ac.signal,
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { detail?: string } | null;
          aplicar({ tipo: "error", mensaje: j?.detail ?? (r.status === 401 ? "Tu sesión terminó. Vuelve a entrar." : "El asistente no pudo responder. Vuelve a intentarlo.") });
        } else {
          await leer(r, aplicar);
        }
      } catch {
        if (!ac.signal.aborted) aplicar({ tipo: "error", mensaje: "Se perdió la conexión. Vuelve a preguntar." });
      } finally {
        if (control.current === ac) control.current = null;
        cambiar((m) => cerrarTurno(m, ac.signal.aborted));
        setCorriendo(false);
      }
    },
    [user],
  );

  // Al volver de entrar: la pregunta que se dejó escrita se envía sola, una vez.
  useEffect(() => {
    if (loading || !user) return;
    const q = tomarPendiente();
    if (q) {
      setSinCuenta(null);
      void enviar(q);
    }
  }, [loading, user, enviar]);

  const reintentar = useCallback(() => {
    const ms = ultimos.current;
    const i = ms.map((m) => m.rol).lastIndexOf("usuario");
    if (i >= 0) void enviar((ms[i] as MensajeUsuario).texto, ms.slice(0, i));
  }, [enviar]);

  const nueva = () => {
    control.current?.abort();
    tomarPendiente();
    setMensajes([]);
    setSinCuenta(null);
    setTexto("");
    campo.current?.focus();
  };

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void enviar(texto);
    }
  };

  const ultimoAsistente = [...mensajes].reverse().find((m): m is MensajeAsistente => m.rol === "asistente");
  const puedeSeguir = !!user && !corriendo && ultimoAsistente?.estado === "listo" && ultimoAsistente.texto != null;
  const vacio = mensajes.length === 0 && !sinCuenta;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <section
        aria-label="Conversación con el asistente"
        className="flex min-w-0 flex-col rounded-2xl border border-line bg-paper lg:h-[calc(100dvh-15rem)] lg:min-h-[34rem] lg:overflow-hidden"
      >
        {/* Cabecera del chat: quién responde y con qué. */}
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Avatar />
          <div className="min-w-0 flex-1">
            <p className="text-dato font-semibold leading-tight text-ink">Asistente de Vigía</p>
            <p className="flex items-center gap-1.5 text-rotulo text-mute">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-moss" aria-hidden />
              Responde con los datos de Vigía
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-rotulo text-inkSoft sm:inline">
            Hasta {MAX_PREGUNTAS} preguntas por día
          </span>
          {!vacio && (
            <button type="button" onClick={nueva} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft">
              <MessageSquarePlus size={15} aria-hidden />
              <span className="max-sm:sr-only">Nueva conversación</span>
            </button>
          )}
        </header>

        {/* Los mensajes. En escritorio se desplazan dentro de la caja; el cuadro de escribir queda fijo abajo. */}
        <div className="flex-1 space-y-4 px-3 py-4 sm:px-5 lg:overflow-y-auto" aria-live="polite">
          <BurbujaAsistente>
            <p className="text-cuerpo font-semibold text-ink">Hola. ¿Qué quieres saber?</p>
            <p className="mt-1 text-dato leading-relaxed text-inkSoft">
              Pregúntame por un contrato, una entidad, una empresa o un partido, en tus palabras. Busco en los mismos datos
              que ves en Vigía y te enlazo de dónde sale cada cosa.
            </p>
            {!loading && !user && (
              <p className="mt-2 text-dato leading-relaxed text-inkSoft">
                Para responderte necesito que entres con tu cuenta, que es gratis. Puedes escribir ya: guardo tu pregunta
                mientras entras.
              </p>
            )}
          </BurbujaAsistente>

          {vacio && <Sugerencias titulo="Prueba con una de estas" opciones={EJEMPLOS} alElegir={(q) => void enviar(q)} desactivado={loading} />}

          {mensajes.map((m) =>
            m.rol === "usuario" ? (
              <BurbujaUsuario key={m.id} texto={m.texto} />
            ) : (
              <Turno key={m.id} m={m} alReintentar={m.id === ultimoAsistente?.id && !corriendo ? reintentar : undefined} />
            ),
          )}

          {sinCuenta && (
            <>
              <BurbujaUsuario texto={sinCuenta} />
              <BurbujaAsistente>
                <p className="text-dato leading-relaxed text-ink">
                  Buena pregunta. Entra con tu cuenta y te respondo enseguida: la guardé y la envío sola cuando vuelvas.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/login?next=/app/asistente" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-granate px-4 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
                    <LogIn size={15} aria-hidden />
                    Entrar o crear cuenta
                  </Link>
                  <button type="button" onClick={nueva} className="inline-flex min-h-10 items-center rounded-full border border-line px-4 text-meta font-semibold text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink">
                    Cambiar la pregunta
                  </button>
                </div>
              </BurbujaAsistente>
            </>
          )}

          {puedeSeguir && (
            <Sugerencias titulo="¿Quieres saber más?" opciones={SEGUIR.map((t) => ({ texto: t }))} alElegir={(q) => void enviar(q)} chicas />
          )}
          <div ref={fin} />
        </div>

        {/* El cuadro de escribir: dentro de la caja en escritorio, pegado abajo de la pantalla en el celular. */}
        <form
          className="sticky bottom-2 z-[1] mx-2 mb-2 flex items-end gap-2 rounded-2xl border border-line bg-paper p-1.5 shadow-pop lg:static lg:mx-0 lg:mb-0 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:bg-paperSoft/60 lg:p-3 lg:shadow-none"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(texto);
          }}
        >
          <label htmlFor="asistente-vigia" className="sr-only">Tu pregunta</label>
          <textarea
            ref={campo}
            id="asistente-vigia"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclear}
            rows={1}
            maxLength={4000}
            disabled={loading}
            placeholder={user || loading ? "Escribe tu pregunta…" : "Escribe tu pregunta y entra para enviarla…"}
            className="max-h-40 min-h-11 w-full flex-1 resize-none rounded-xl bg-transparent px-2.5 py-2.5 text-destacado leading-snug text-ink placeholder:text-mute focus:outline-none lg:border lg:border-line lg:bg-paper lg:focus:border-granate/50"
          />
          {corriendo ? (
            <button type="button" onClick={() => control.current?.abort()} aria-label="Detener la respuesta" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-paperSoft text-ink transition-colors duration-rapido hover:border-granate/40">
              <Square size={14} aria-hidden className="fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!texto.trim() || loading} aria-label="Enviar la pregunta" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-granate text-paper transition-opacity duration-rapido disabled:opacity-40">
              <ArrowUp size={18} aria-hidden />
            </button>
          )}
        </form>
      </section>

      {/* Al lado: qué puede buscar y cómo responde (antes, un párrafo gris bajo el cuadro de escribir). */}
      <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Caja titulo="Qué puedo buscar">
          <ul className="divide-y divide-line">
            {ALCANCE.map(({ icono: Icono, titulo, ejemplo }) => (
              <li key={titulo} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paperDeep text-inkSoft" aria-hidden>
                  <Icono size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-dato font-semibold text-ink">{titulo}</span>
                  <span className="block text-meta leading-snug text-mute">{ejemplo}</span>
                </span>
              </li>
            ))}
          </ul>
        </Caja>
        <Caja titulo="Cómo respondo">
          <ul className="space-y-2">
            {COMO.map((t) => (
              <li key={t} className="flex items-start gap-2 text-meta leading-snug text-inkSoft">
                <Check size={14} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-paperSoft px-3 py-2 text-meta leading-snug text-inkSoft">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            <span>
              Una señal es un indicio para revisar, no una acusación: comprueba la fuente antes de publicar.{" "}
              <Link href="/metodologia" className="font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
                Cómo trabaja Vigía
              </Link>
            </span>
          </p>
        </Caja>
      </aside>
    </div>
  );
}

/** El ojo de Vigía en su placa: quién habla en el chat. */
function Avatar() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-paperSoft text-ink [&_svg]:h-5 [&_svg]:w-5" aria-hidden>
      <Llamita />
    </span>
  );
}

/** Un mensaje del asistente que no viene del modelo (saludo, avisos): globo a la izquierda con su avatar. */
function BurbujaAsistente({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar />
      <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-paperSoft px-4 py-3 sm:max-w-[80%]">{children}</div>
    </div>
  );
}

/** Respuestas rápidas: con sesión, un toque pregunta; sin sesión, la pregunta espera a que entres. */
function Sugerencias({
  titulo,
  opciones,
  alElegir,
  chicas = false,
  desactivado = false,
}: {
  titulo: string;
  opciones: { icono?: LucideIcon; texto: string }[];
  alElegir: (q: string) => void;
  chicas?: boolean;
  desactivado?: boolean;
}) {
  return (
    <section aria-label={titulo} className="pl-[2.875rem]">
      <p className="mb-2 text-rotulo font-semibold uppercase tracking-wide text-mute">{titulo}</p>
      <ul className={cn("gap-2", chicas ? "flex flex-wrap" : "grid sm:grid-cols-2")}>
        {opciones.map(({ icono: Icono, texto }) => (
          <li key={texto} className="min-w-0">
            <button
              type="button"
              disabled={desactivado}
              onClick={() => alElegir(texto)}
              className={cn(
                "flex w-full items-start gap-2.5 border border-line bg-paper text-left text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate disabled:opacity-50",
                chicas ? "min-h-9 items-center rounded-full px-3.5 py-1.5 text-meta font-medium" : "rounded-xl px-3.5 py-3 text-dato leading-snug",
              )}
            >
              {Icono && <Icono size={16} className="mt-0.5 shrink-0 text-granate" aria-hidden />}
              <span className="min-w-0">{texto}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Caja({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="rounded-2xl border border-line bg-paper">
      <p className="border-b border-line px-4 py-2.5 text-dato font-semibold text-ink">{titulo}</p>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** Una respuesta: lo que va consultando mientras corre, la respuesta, su revisión y las consultas que hizo. */
function Turno({ m, alReintentar }: { m: MensajeAsistente; alReintentar?: () => void }) {
  const corriendo = m.estado === "corriendo";
  const pasos = m.pasos.filter((p): p is PasoHerramienta => p.tipo === "herramienta");
  const enlaces = useMemo(() => new Map((m.revision?.enlaces.dudosos ?? []).flatMap((d) => (d.url ? [[d.url, d.motivo] as const] : []))), [m.revision]);
  const montos = useMemo(() => new Map((m.revision?.montos.dudosos ?? []).map((d) => [d.texto, d.motivo] as const)), [m.revision]);
  const enCurso = [...pasos].reverse().find((p) => p.estado === "en_curso");
  const listos = pasos.filter((p) => p.estado === "listo").length;
  return (
    <div className="flex items-start gap-2.5">
      <Avatar />
      <article aria-label="Respuesta del asistente" aria-busy={corriendo} className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-md border border-line bg-paperSoft">
        {corriendo && (
          <div className="px-4 py-3 sm:px-5" role="status">
            <p className="flex items-center gap-2 text-dato text-inkSoft">
              <Loader2 size={15} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              {enCurso ? `Consultando: ${enCurso.titulo}` : pasos.length ? "Armando la respuesta" : "Pensando"}
            </p>
            {pasos.length > 0 && (
              <p className="mt-1 pl-6 text-rotulo tabular-nums text-mute">
                {listos} de {pasos.length} {pasos.length === 1 ? "consulta lista" : "consultas listas"}
              </p>
            )}
          </div>
        )}
        {m.texto != null && <Respuesta texto={m.texto} className="px-4 py-3.5 sm:px-5" enlacesPorRevisar={enlaces} montosPorRevisar={montos} />}
        {!corriendo && m.texto != null && m.revision && <RevisionRespuesta r={m.revision} />}
        {!corriendo && m.texto == null && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-dato text-crimsonTexto">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              {m.error ?? (m.estado === "detenido" ? "Detuviste la respuesta." : "El asistente no llegó a responder.")}
            </p>
            {alReintentar && (
              <button type="button" onClick={alReintentar} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40">
                <RotateCcw size={14} aria-hidden />
                Volver a preguntar
              </button>
            )}
          </div>
        )}
        {pasos.length > 0 && !corriendo && (
          <details className="group border-t border-line px-4 py-2 sm:px-5">
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-meta font-semibold text-inkSoft underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
              <Link2 size={14} className="shrink-0" aria-hidden />
              Lo que consultó para responder ({pasos.length})
            </summary>
            <ol className="mt-2 space-y-1 pb-1">
              {pasos.map((p) => (
                <li key={p.id} className="flex items-start gap-2 text-meta text-inkSoft">
                  {p.estado === "listo" ? <Check size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden /> : <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />}
                  <span className="min-w-0">
                    {p.titulo}
                    {p.estado !== "listo" && <span className="text-mute"> (sin resultado)</span>}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </article>
    </div>
  );
}
