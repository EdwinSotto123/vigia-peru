"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  aplicarEvento,
  cerrarTurno,
  CLAVE_GUARDADO,
  comoEvento,
  historial,
  leerGuardado,
  nuevoId,
  type EventoChat,
  type Guardado,
  type Mensaje,
  type MensajeAsistente,
  type MensajeUsuario,
  type ModeloChat,
} from "./conversacion";

/**
 * La conversación del chat de investigación: el estado, el pedido a POST /api/admin/chat con su stream NDJSON, el
 * botón de detener (AbortController) y la copia en sessionStorage (una recarga no la pierde; cerrar la pestaña, sí).
 */
export function useChat() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  // Profundo por defecto: el equipo prefiere informes completos a ahorrar (2026-11-06). Rápido sigue en el selector.
  const [modelo, setModelo] = useState<ModeloChat>("fino");
  // Hasta leer sessionStorage no se escribe: si no, el estado vacío inicial pisaba lo guardado.
  const [cargado, setCargado] = useState(false);
  const control = useRef<AbortController | null>(null);
  const ultimos = useRef(mensajes);
  ultimos.current = mensajes;

  useEffect(() => {
    let g: Guardado | null = null;
    try {
      g = leerGuardado(window.sessionStorage.getItem(CLAVE_GUARDADO));
    } catch {
      /* modo privado o almacenamiento bloqueado: se empieza vacío */
    }
    if (g) {
      setMensajes(g.mensajes);
      setModelo(g.modelo);
    }
    setCargado(true);
  }, []);

  // Se guarda un momento después del último cambio: mientras llega el stream no se reescribe en cada línea.
  useEffect(() => {
    if (!cargado) return;
    const t = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(CLAVE_GUARDADO, JSON.stringify({ modelo, mensajes }));
      } catch {
        /* sin lugar o bloqueado: la conversación sigue en pantalla */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [mensajes, modelo, cargado]);

  // Al salir de la página, el pedido en curso se corta.
  useEffect(() => () => control.current?.abort(), []);

  const actualizar = useCallback((id: string, fn: (m: MensajeAsistente) => MensajeAsistente) => {
    setMensajes((ms) => ms.map((m) => (m.id === id && m.rol === "asistente" ? fn(m) : m)));
  }, []);

  /** Envía una pregunta con la conversación de `base` (por defecto, la que está en pantalla). */
  const enviar = useCallback(
    async (textoCrudo: string, base?: Mensaje[]) => {
      const texto = textoCrudo.trim();
      if (!texto || control.current) return false;
      const previos = base ?? ultimos.current;
      const usuario: MensajeUsuario = { id: nuevoId(), rol: "usuario", texto };
      const asistente: MensajeAsistente = {
        id: nuevoId(),
        rol: "asistente",
        estado: "corriendo",
        inicio: Date.now(),
        modeloPedido: modelo,
        modelo: null,
        pasos: [],
        texto: null,
        fin: null,
        revision: null,
        error: null,
      };
      const cuerpo = { mensajes: historial([...previos, usuario]), modelo };
      setMensajes([...previos, usuario, asistente]);
      const ac = new AbortController();
      control.current = ac;
      const aplicar = (e: EventoChat) => actualizar(asistente.id, (m) => aplicarEvento(m, e));
      try {
        const r = await fetch("/api/admin/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify(cuerpo),
          cache: "no-store",
          signal: ac.signal,
        });
        // Como adminFetch: sin sesión, al login (y de vuelta acá al entrar).
        if (r.status === 401) {
          aplicar({ tipo: "error", mensaje: "Tu sesión expiró. Vuelve a entrar al panel para seguir." });
          window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
          return true;
        }
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { detail?: unknown; error?: unknown } | null;
          const detalle = typeof j?.detail === "string" && j.detail ? j.detail : typeof j?.error === "string" && j.error ? j.error : `El servidor respondió ${r.status}.`;
          aplicar({ tipo: "error", mensaje: detalle });
          return true;
        }
        await leerStream(r, aplicar);
      } catch {
        if (!ac.signal.aborted) aplicar({ tipo: "error", mensaje: "Se perdió la conexión con el servidor. Revisa tu conexión y vuelve a intentarlo." });
      } finally {
        if (control.current === ac) control.current = null;
        actualizar(asistente.id, (m) => cerrarTurno(m, ac.signal.aborted));
      }
      return true;
    },
    [modelo, actualizar],
  );

  const detener = useCallback(() => control.current?.abort(), []);

  const nueva = useCallback(() => {
    control.current?.abort();
    control.current = null;
    setMensajes([]);
  }, []);

  /** Vuelve a preguntar lo de un turno que no terminó: saca ese turno y su pregunta, y la envía otra vez. */
  const reintentar = useCallback(
    (idAsistente: string) => {
      const ms = ultimos.current;
      const i = ms.findIndex((m) => m.id === idAsistente);
      const pregunta = i > 0 ? ms[i - 1] : null;
      if (!pregunta || pregunta.rol !== "usuario") return;
      void enviar(pregunta.texto, [...ms.slice(0, i - 1), ...ms.slice(i + 1)]);
    },
    [enviar],
  );

  const corriendo = mensajes.some((m) => m.rol === "asistente" && m.estado === "corriendo");

  return { mensajes, modelo, setModelo, cargado, corriendo, enviar, detener, nueva, reintentar };
}

/**
 * Lee el cuerpo NDJSON a medida que llega: un TextDecoder en modo stream y un búfer con la línea a medias, que se
 * completa con el próximo trozo. Una línea que no es JSON se ignora.
 */
async function leerStream(r: Response, aplicar: (e: EventoChat) => void) {
  const procesar = (linea: string) => {
    const t = linea.trim();
    if (!t) return;
    let crudo: unknown;
    try {
      crudo = JSON.parse(t);
    } catch {
      return;
    }
    const e = comoEvento(crudo);
    if (e) aplicar(e);
  };
  if (!r.body) {
    (await r.text()).split("\n").forEach(procesar);
    return;
  }
  const lector = r.body.getReader();
  const decodificador = new TextDecoder();
  let bufer = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    bufer += decodificador.decode(value, { stream: true });
    let i = bufer.indexOf("\n");
    while (i >= 0) {
      procesar(bufer.slice(0, i));
      bufer = bufer.slice(i + 1);
      i = bufer.indexOf("\n");
    }
  }
  bufer += decodificador.decode();
  procesar(bufer);
}
