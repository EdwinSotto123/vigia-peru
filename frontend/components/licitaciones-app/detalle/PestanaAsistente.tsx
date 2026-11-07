"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { ErrorCuenta, preguntarAsistente, type MensajeAsistente } from "@/lib/gobserva-cuenta";
import { Caja } from "@/components/gobserva/app/Caja";
import { cn } from "@/lib/utils";

const SUGERENCIAS = [
  "¿Qué se compra exactamente y en qué cantidades?",
  "¿Hasta cuándo puedo hacer consultas?",
  "¿Cuánto se pagó por algo parecido?",
  "¿A quién le compra esta entidad y con cuánta competencia?",
  "¿Qué señales debo tener en cuenta antes de postular?",
];
const LARGO = 500;

/**
 * El asistente del proceso: preguntas en tus palabras, respondidas con los datos de esta ficha (Haiku, por la API). Dice
 * qué no sabe (lo que está sólo en las bases) y manda al SEACE. La conversación vive en esta pestaña.
 */
export function PestanaAsistente({ id }: { id: string }) {
  const [mensajes, setMensajes] = useState<MensajeAsistente[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mensajes.length) fin.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [mensajes.length, pensando]);

  async function preguntar(pregunta: string) {
    const q = pregunta.trim();
    if (q.length < 2 || pensando) return;
    if (q.length > LARGO) return setError(`La pregunta puede tener hasta ${LARGO} caracteres.`);
    setError(null);
    setTexto("");
    const historial = mensajes;
    setMensajes([...historial, { rol: "usuario", texto: q }]);
    setPensando(true);
    try {
      const r = await preguntarAsistente(id, q, historial);
      setMensajes((xs) => [...xs, { rol: "asistente", texto: r.respuesta }]);
    } catch (e) {
      setMensajes(historial);
      setTexto(q);
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos preguntar ahora. Vuelve a intentarlo.");
    } finally {
      setPensando(false);
    }
  }

  return (
    <Caja
      id="asistente"
      titulo="Pregúntale a este proceso"
      descripcion="Responde con los datos de esta ficha: ítems, plazos, el comprador, precios de compras parecidas. Lo que está sólo en las bases te lo dice y te manda al SEACE."
      relleno={false}
    >
      <div className="max-h-[32rem] min-h-[12rem] space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
        {mensajes.length === 0 && !pensando && (
          <div>
            <p className="flex items-center gap-2 text-dato font-semibold text-ink">
              <Sparkles size={16} aria-hidden className="text-granate" /> Prueba con
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => void preguntar(s)} className="rounded-full border border-line bg-caja px-3 py-1.5 text-left text-meta font-medium text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={cn("flex gap-2.5", m.rol === "usuario" && "justify-end")}>
            {m.rol === "asistente" && (
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-granate-50 text-granate">
                <Bot size={16} />
              </span>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-dato leading-relaxed",
                m.rol === "usuario" ? "rounded-br-md bg-granate text-paper" : "rounded-bl-md border border-line bg-ink/[0.025] text-ink",
              )}
            >
              <span className="sr-only">{m.rol === "usuario" ? "Tú: " : "Asistente: "}</span>
              <Texto texto={m.texto} />
            </div>
          </div>
        ))}
        {pensando && (
          <p className="flex items-center gap-2 text-meta text-inkSoft">
            <Loader2 size={15} aria-hidden className="animate-spin" /> Leyendo la ficha…
          </p>
        )}
        <div ref={fin} />
      </div>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void preguntar(texto);
        }}
        className="rounded-b-2xl border-t border-line bg-ink/[0.025] p-3 sm:p-4"
      >
        <label htmlFor="asistente-pregunta" className="sr-only">Tu pregunta</label>
        <div className="flex gap-2">
          <input
            id="asistente-pregunta"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              if (error) setError(null);
            }}
            maxLength={LARGO + 50}
            placeholder="Escribe tu pregunta sobre este proceso"
            aria-invalid={!!error}
            className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-caja px-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 aria-[invalid=true]:border-crimson sm:text-dato"
          />
          <button type="submit" disabled={pensando || texto.trim().length < 2} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-granate px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-50">
            {pensando ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <Send size={16} aria-hidden />}
            <span className="hidden sm:inline">Preguntar</span>
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-meta font-medium text-crimsonTexto">
            {error}
          </p>
        )}
      </form>
    </Caja>
  );
}

/** El texto de una respuesta: párrafos y viñetas «- », sin HTML del modelo. */
function Texto({ texto }: { texto: string }) {
  const bloques = texto.split(/\n{2,}/);
  return (
    <>
      {bloques.map((b, i) => {
        const lineas = b.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lineas.length && lineas.every((l) => /^[-•*]\s/.test(l))) {
          return (
            <ul key={i} className={cn("list-disc space-y-1 pl-5", i > 0 && "mt-2")}>
              {lineas.map((l, k) => (
                <li key={k}>{l.replace(/^[-•*]\s/, "").replace(/\*\*/g, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className={cn("whitespace-pre-line", i > 0 && "mt-2")}>
            {b.replace(/\*\*/g, "")}
          </p>
        );
      })}
    </>
  );
}
