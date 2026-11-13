"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUp, Check, Loader2, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Respuesta } from "@/components/admin/chat/Respuesta";
import { RevisionRespuesta } from "@/components/admin/chat/RevisionRespuesta";
import { BurbujaUsuario } from "@/components/admin/chat/Turno";
import {
  aplicarEvento, cerrarTurno, comoEvento, historial, nuevoId, turnoVacio, type EventoChat, type Mensaje, type MensajeAsistente,
  type MensajeUsuario, type PasoHerramienta,
} from "@/components/admin/chat/conversacion";
import { Franja } from "@/components/patrones/Franja";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { authFetch } from "@/lib/cuentas";
import { cn } from "@/lib/utils";

/**
 * El asistente de investigación de Vigía (auditoría de producto del 2026-11-12, decisión D5): una pregunta en palabras
 * y una respuesta armada sólo con los datos de Vigía, con sus enlaces, lo que consultó para darla y la revisión
 * automática de enlaces y montos. Es el motor del chat del panel (POST /cuentas/me/chat) con tope de preguntas por día.
 * La conversación vive en esta pestaña: no se guarda en el servidor.
 */

const EJEMPLOS = [
  "¿Qué proveedores ganaron más contratos con la Municipalidad Provincial de Cajamarca?",
  "Encuentra contratos de 2026 con una sola oferta válida en Áncash",
  "¿Qué evidencia respalda las señales del contrato 1255784?",
  "Compara lo que gastan en consultorías los gobiernos regionales de Cusco y Arequipa",
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

export function AsistenteVigia() {
  const { user, loading } = useAuth();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [corriendo, setCorriendo] = useState(false);
  const control = useRef<AbortController | null>(null);
  const ultimos = useRef<Mensaje[]>([]);
  const fin = useRef<HTMLDivElement>(null);
  ultimos.current = mensajes;

  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => {
    if (mensajes.length) fin.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mensajes.length]);

  const enviar = useCallback(async (crudo: string, base?: Mensaje[]) => {
    const pregunta = crudo.trim();
    if (!pregunta || control.current) return;
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
  }, []);

  const reintentar = useCallback(() => {
    const ms = ultimos.current;
    const i = ms.map((m) => m.rol).lastIndexOf("usuario");
    if (i >= 0) void enviar((ms[i] as MensajeUsuario).texto, ms.slice(0, i));
  }, [enviar]);

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void enviar(texto);
    }
  };

  if (!loading && !user) {
    return (
      <div className="space-y-5">
        <Franja
          titulo="Entra con tu cuenta para preguntar"
          accion={
            <Link href="/login?next=/app/asistente" className={CLASE_ACCION_LISTA}>
              Entrar o crear cuenta
            </Link>
          }
        >
          La cuenta es gratis. El asistente responde hasta 10 preguntas por día con los datos de Vigía.
        </Franja>
        <Ejemplos />
      </div>
    );
  }

  const ultimoAsistente = [...mensajes].reverse().find((m): m is MensajeAsistente => m.rol === "asistente");

  return (
    <div className="space-y-5">
      {mensajes.length === 0 ? (
        <Ejemplos alElegir={user ? (q) => void enviar(q) : undefined} />
      ) : (
        <div className="space-y-4" aria-live="polite">
          {mensajes.map((m) =>
            m.rol === "usuario" ? (
              <BurbujaUsuario key={m.id} texto={m.texto} />
            ) : (
              <Turno key={m.id} m={m} alReintentar={m.id === ultimoAsistente?.id && !corriendo ? reintentar : undefined} />
            ),
          )}
          <div ref={fin} />
        </div>
      )}

      <form
        className="sticky bottom-3 flex items-end gap-2 rounded-2xl border border-line bg-paper p-2 shadow-pop"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto);
        }}
      >
        <label htmlFor="asistente-vigia" className="sr-only">Tu pregunta</label>
        <textarea
          id="asistente-vigia"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          rows={1}
          maxLength={4000}
          disabled={loading}
          placeholder="Pregunta por un contrato, una entidad, una empresa o un partido…"
          className="max-h-40 min-h-11 w-full flex-1 resize-none bg-transparent px-2 py-2.5 text-destacado leading-snug text-ink placeholder:text-mute focus:outline-none"
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
      <p className="text-rotulo text-mute">
        Responde sólo con datos de Vigía y enlaza cada cosa a su ficha. Una señal es un indicio para revisar, no una
        acusación: comprueba la fuente antes de publicar.{" "}
        <Link href="/metodologia" className="font-medium text-inkSoft underline underline-offset-2 hover:text-granate">
          Cómo trabaja Vigía
        </Link>
      </p>
    </div>
  );
}

/** Las preguntas de ejemplo: con sesión, un toque pregunta; sin sesión, sólo muestran para qué sirve. */
function Ejemplos({ alElegir }: { alElegir?: (q: string) => void }) {
  return (
    <section aria-labelledby="asistente-ejemplos">
      <p id="asistente-ejemplos" className="text-meta font-semibold text-inkSoft">Por ejemplo</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {EJEMPLOS.map((q) => (
          <li key={q}>
            {alElegir ? (
              <button type="button" onClick={() => alElegir(q)} className="w-full rounded-xl border border-line bg-paper px-3.5 py-3 text-left text-dato leading-snug text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
                {q}
              </button>
            ) : (
              <p className="rounded-xl border border-line bg-paper px-3.5 py-3 text-dato leading-snug text-inkSoft">{q}</p>
            )}
          </li>
        ))}
      </ul>
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
  return (
    <article aria-label="Respuesta del asistente" aria-busy={corriendo} className="min-w-0 rounded-2xl border border-line bg-paperSoft">
      {corriendo && (
        <p className="flex items-center gap-2 px-4 py-3 text-dato text-inkSoft sm:px-5" role="status">
          <Loader2 size={15} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          {enCurso ? `Consultando: ${enCurso.titulo}` : pasos.length ? "Armando la respuesta" : "Pensando"}
        </p>
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
            <button type="button" onClick={alReintentar} className={cn(CLASE_ACCION_LISTA, "gap-1.5")}>
              <RotateCcw size={14} aria-hidden />
              Volver a preguntar
            </button>
          )}
        </div>
      )}
      {pasos.length > 0 && !corriendo && (
        <details className="group border-t border-line px-4 py-2 sm:px-5">
          <summary className="cursor-pointer list-none text-meta font-semibold text-inkSoft underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
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
  );
}
