"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, MessagesSquare, SendHorizontal, Square } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { claseBoton } from "@/components/admin/ui";
import { BurbujaUsuario, TurnoAsistente } from "@/components/admin/chat/Turno";
import { useChat } from "@/components/admin/chat/useChat";
import { MODELOS, type Mensaje, type ModeloChat } from "@/components/admin/chat/conversacion";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Nota } from "@/components/patrones/Estructura";

/**
 * Chat de investigación (sólo administradores): el equipo pregunta en palabras («Dime todo sobre el alcalde de
 * Wanchaq») y el asistente (Claude, por el API) responde con las herramientas de datos de Vigía, las mismas del MCP,
 * mostrando cada paso que dio.
 *
 * Fuente: POST /api/admin/chat con la conversación entera (preguntas y respuestas finales, sólo texto) y el modelo
 * («rapido» o «fino»); responde un stream NDJSON (components/admin/chat/conversacion.ts). La conversación vive en la
 * página y en sessionStorage: una recarga no la pierde; cerrar la pestaña o «Nueva conversación», sí.
 */

const EJEMPLOS = [
  "Dime todo sobre el alcalde de Wanchaq",
  "¿Qué empresas concentran las compras del Gobierno Regional de Cusco desde 2024?",
  "Explícame el contrato 1228227 y por qué tiene 82 puntos",
  "¿En qué regiones creció la contratación directa en 2026?",
  "¿Qué obras de saneamiento están paralizadas en Piura?",
  "Compara el gasto de las municipalidades provinciales de Cusco y Arequipa",
];

/** Alto máximo del campo antes de deslizarse por dentro (unas 8 líneas). */
const ALTO_MAXIMO_CAMPO = 208;

export default function AdminChatPage() {
  return (
    <AdminShell title="Chat de investigación" subtitle="Pregunta en palabras: el asistente busca en los datos de Vigía y te muestra cada paso.">
      <Chat />
    </AdminShell>
  );
}

function Chat() {
  const chat = useChat();
  const { open } = useDialog();
  const [borrador, setBorrador] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  // ¿Está mirando el final de la conversación? Si subió a leer algo, lo que llega no lo arrastra de vuelta.
  const alFinal = useRef(true);

  useEffect(() => {
    const medir = () => {
      alFinal.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    medir();
    window.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, []);

  // Mientras el asistente trabaja (pasos, todavía sin respuesta), la página sigue al final si estabas ahí. Al abrir con
  // una conversación guardada, una vez al final (la página llega oculta hasta saber el perfil: se espera a que mida).
  const caja = useRef<HTMLDivElement>(null);
  const ultimo = chat.mensajes[chat.mensajes.length - 1];
  const esperando = ultimo?.rol === "asistente" && ultimo.estado === "corriendo" && ultimo.texto == null;
  const seguir = useRef({ esperando, hay: chat.mensajes.length > 0, inicial: true });
  seguir.current.esperando = esperando;
  seguir.current.hay = chat.mensajes.length > 0;
  useEffect(() => {
    const el = caja.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const s = seguir.current;
      if (!s.hay || !el.offsetHeight) return;
      if (s.inicial || (s.esperando && alFinal.current)) window.scrollTo({ top: document.documentElement.scrollHeight });
      s.inicial = false;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Llegó la respuesta y estabas siguiendo: se muestra desde su comienzo, no desde el final.
  const conRespuesta = ultimo?.rol === "asistente" && ultimo.texto != null;
  const ultimoId = ultimo?.id;
  const antes = useRef({ id: ultimoId, conRespuesta });
  useEffect(() => {
    const previo = antes.current;
    antes.current = { id: ultimoId, conRespuesta };
    if (ultimoId && previo.id === ultimoId && !previo.conRespuesta && conRespuesta && alFinal.current) {
      document.getElementById(`turno-${ultimoId}`)?.scrollIntoView({ block: "start" });
    }
  }, [ultimoId, conRespuesta]);

  // El campo crece con el texto hasta ALTO_MAXIMO_CAMPO; después se desliza por dentro.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ALTO_MAXIMO_CAMPO)}px`;
  }, [borrador]);

  const preguntar = (texto: string) => {
    if (!texto.trim() || chat.corriendo) return;
    alFinal.current = true;
    setBorrador("");
    void chat.enviar(texto);
  };

  const nueva = () => {
    const limpiar = () => {
      chat.nueva();
      setBorrador("");
      campo.current?.focus();
    };
    if (!chat.mensajes.length) return limpiar();
    open({
      title: "¿Empezar una conversación nueva?",
      body: "Esta conversación se borra de la pantalla y no queda guardada en ningún otro lado.",
      confirmLabel: "Empezar de nuevo",
      tone: "danger",
      onConfirm: limpiar,
    });
  };

  return (
    <div ref={caja} className="max-w-4xl">
      {chat.cargado && (chat.mensajes.length ? <Conversacion mensajes={chat.mensajes} onReintentar={chat.reintentar} /> : <Bienvenida onPregunta={preguntar} />)}

      {/* Pegado al borde de abajo de la pantalla mientras se lee la conversación. */}
      <div className="sticky bottom-0 z-barra -mx-1 bg-paper px-1 pb-3 pt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            preguntar(borrador);
          }}
          className="rounded-2xl border border-line bg-paperSoft transition-colors duration-rapido focus-within:border-granate focus-within:ring-2 focus-within:ring-granate/20"
        >
          <label htmlFor="chat-pregunta" className="sr-only">
            Tu pregunta
          </label>
          <textarea
            id="chat-pregunta"
            ref={campo}
            rows={1}
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía; Shift+Enter baja de línea. Mientras se compone un acento o un carácter (IME), no.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                preguntar(borrador);
              }
            }}
            placeholder="Escribe tu pregunta"
            // 16 px: el celular no hace zoom al tocar el campo.
            className="block min-h-[48px] w-full resize-none rounded-t-2xl bg-transparent px-4 pb-1 pt-3 text-destacado leading-6 text-ink placeholder:text-mute focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5 pt-1">
            <label className="inline-flex min-h-[34px] items-center rounded-full border border-line bg-paper pl-3 text-meta transition-colors duration-rapido focus-within:border-granate hover:bg-paperSoft">
              {/* En el celular sólo el modelo elegido: con «Modelo:» delante, «Detener» bajaba de renglón. */}
              <span className="sr-only text-mute sm:not-sr-only">Modelo:</span>
              <select
                value={chat.modelo}
                onChange={(e) => chat.setModelo(e.target.value as ModeloChat)}
                className="h-8 cursor-pointer rounded-full border-0 bg-transparent pl-1 pr-2 text-meta font-medium text-ink focus:outline-none focus:ring-0"
              >
                {MODELOS.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </label>
            {/* En el celular, sólo el ícono: con el texto, «Detener» no cabía en el renglón. */}
            <button type="button" onClick={nueva} disabled={!chat.mensajes.length && !borrador} title="Nueva conversación" className={claseBoton("fantasma", "sm")}>
              <MessageSquarePlus size={14} aria-hidden />
              <span className="sr-only sm:not-sr-only">Nueva conversación</span>
            </button>
            {chat.corriendo ? (
              <button type="button" onClick={chat.detener} className={claseBoton("peligro", "sm", "ml-auto")}>
                <Square size={12} aria-hidden /> Detener
              </button>
            ) : (
              <button type="submit" disabled={!borrador.trim()} className={claseBoton("primario", "sm", "ml-auto")}>
                <SendHorizontal size={14} aria-hidden />
                <span className="sr-only sm:not-sr-only">Enviar</span>
              </button>
            )}
          </div>
        </form>
      </div>

      <Nota className="px-3 py-2">Usa los mismos datos públicos y reglas de privacidad que el MCP de Vigía. Una señal no es una acusación.</Nota>

      <Anuncio mensajes={chat.mensajes} />
    </div>
  );
}

function Conversacion({ mensajes, onReintentar }: { mensajes: Mensaje[]; onReintentar: (id: string) => void }) {
  return (
    <div className="space-y-4 pb-2">
      {mensajes.map((m, i) =>
        m.rol === "usuario" ? (
          <BurbujaUsuario key={m.id} texto={m.texto} />
        ) : (
          <TurnoAsistente key={m.id} m={m} ultimo={i === mensajes.length - 1} onReintentar={onReintentar} />
        ),
      )}
    </div>
  );
}

/** Sin conversación: qué hace el chat y preguntas de ejemplo que se envían con un toque. */
function Bienvenida({ onPregunta }: { onPregunta: (texto: string) => void }) {
  return (
    <section aria-labelledby="chat-bienvenida" className="rounded-2xl border border-line bg-paperSoft px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-paperDeep text-granate" aria-hidden>
          <MessagesSquare size={16} />
        </span>
        <div className="min-w-0">
          <h2 id="chat-bienvenida" className="flex flex-wrap items-center gap-x-1.5 font-display text-bloque font-bold leading-tight text-ink">
            ¿Qué quieres investigar?
            <Ayuda titulo="¿Cómo responde?">
              El asistente consulta las herramientas de datos de Vigía (las mismas del MCP): busca entidades, autoridades,
              contratos, empresas y obras, y arma la respuesta con lo que encuentra. Debajo de cada respuesta ves qué
              consultó, cuánto tardó y cuánto costó. Rápido usa Haiku; Fino usa Sonnet, más lento y más caro.
            </Ayuda>
          </h2>
          <p className="mt-0.5 text-meta leading-snug text-mute">Escribe tu pregunta abajo o empieza con una de estas.</p>
        </div>
      </div>
      <ul className="mt-3.5 flex flex-wrap gap-2">
        {EJEMPLOS.map((q) => (
          <li key={q} className="min-w-0 max-w-full">
            <button
              type="button"
              onClick={() => onPregunta(q)}
              className="min-h-[34px] max-w-full rounded-2xl border border-line bg-paper px-3.5 py-1.5 text-left text-meta leading-snug text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50 active:translate-y-px"
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Para el lector de pantalla: cuando el último turno termina, se dice cómo terminó. */
function Anuncio({ mensajes }: { mensajes: Mensaje[] }) {
  const ultimo = mensajes[mensajes.length - 1];
  const texto =
    ultimo?.rol !== "asistente" || ultimo.estado === "corriendo"
      ? ""
      : ultimo.estado === "listo"
        ? "Llegó la respuesta."
        : ultimo.estado === "error"
          ? "El asistente no pudo terminar."
          : "La respuesta quedó sin terminar.";
  return (
    <p className="sr-only" aria-live="polite">
      {texto}
    </p>
  );
}
