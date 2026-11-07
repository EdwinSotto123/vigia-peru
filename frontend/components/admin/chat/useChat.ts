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
  turnoVacio,
  type EventoChat,
  type Guardado,
  type Mensaje,
  type MensajeAsistente,
  type MensajeUsuario,
  type ModeloChat,
} from "./conversacion";

/** Si el servidor no confirma el «Detener» en este tiempo, se deja de escuchar igual. */
const ESPERA_DETENER_MS = 8_000;

/**
 * La conversación del chat de investigación: el estado, el pedido a POST /api/admin/chat con su stream NDJSON, el botón
 * de detener y la copia en sessionStorage (una recarga no la pierde; cerrar la pestaña, sí).
 *
 * Cada pregunta es un informe que corre en el servidor (routes/admin_chat.ts → Durable Object): si se cierra la pestaña
 * o se recarga a la mitad, sigue corriendo y queda guardado en /admin/chat/informes. Al recargar, un turno que estaba
 * corriendo se retoma desde su informe (GET /api/admin/chat/informes/:id/eventos) en vez de darse por cortado.
 */
export function useChat() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  // Profundo por defecto: el equipo prefiere informes completos a ahorrar (2026-11-06). Rápido sigue en el selector.
  const [modelo, setModelo] = useState<ModeloChat>("fino");
  const [conversacion, setConversacion] = useState<string>(() => nuevoId());
  // Hasta leer sessionStorage no se escribe: si no, el estado vacío inicial pisaba lo guardado.
  const [cargado, setCargado] = useState(false);
  const control = useRef<AbortController | null>(null);
  const ultimos = useRef(mensajes);
  ultimos.current = mensajes;

  const actualizar = useCallback((id: string, fn: (m: MensajeAsistente) => MensajeAsistente) => {
    setMensajes((ms) => ms.map((m) => (m.id === id && m.rol === "asistente" ? fn(m) : m)));
  }, []);

  /** Lee un stream de eventos y lo aplica al turno `id`; al terminar (bien, mal o detenido) cierra el turno. */
  const escuchar = useCallback(
    async (id: string, pedir: (senal: AbortSignal) => Promise<Response>) => {
      const ac = new AbortController();
      control.current = ac;
      const aplicar = (e: EventoChat) => actualizar(id, (m) => aplicarEvento(m, e));
      try {
        const r = await pedir(ac.signal);
        // Como adminFetch: sin sesión, al login (y de vuelta acá al entrar).
        if (r.status === 401) {
          aplicar({ tipo: "error", mensaje: "Tu sesión expiró. Vuelve a entrar al panel para seguir." });
          window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { detail?: unknown; error?: unknown } | null;
          const detalle = typeof j?.detail === "string" && j.detail ? j.detail : typeof j?.error === "string" && j.error ? j.error : `El servidor respondió ${r.status}.`;
          aplicar({ tipo: "error", mensaje: detalle });
          return;
        }
        await leerStream(r, aplicar);
      } catch {
        if (!ac.signal.aborted) aplicar({ tipo: "error", mensaje: "Se perdió la conexión con el servidor. Si la pregunta alcanzó a empezar, sigue en Informes guardados." });
      } finally {
        if (control.current === ac) control.current = null;
        actualizar(id, (m) => cerrarTurno(m, ac.signal.aborted));
      }
    },
    [actualizar],
  );

  /** Retoma un turno que sigue corriendo en el servidor: vuelve a pedir sus eventos desde el primero. */
  const reanudar = useCallback(
    (m: MensajeAsistente) => {
      if (!m.informe || control.current) return;
      const informe = m.informe;
      actualizar(m.id, (t) => ({ ...turnoVacio(t.id, t.modeloPedido, t.inicio), informe }));
      void escuchar(m.id, (senal) =>
        fetch(`/api/admin/chat/informes/${encodeURIComponent(informe)}/eventos?desde=0`, { headers: { Accept: "application/x-ndjson" }, cache: "no-store", signal: senal }),
      );
    },
    [actualizar, escuchar],
  );

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
      setConversacion(g.conversacion);
      const ultimo = g.mensajes[g.mensajes.length - 1];
      if (ultimo?.rol === "asistente" && ultimo.estado === "corriendo") reanudar(ultimo);
    }
    setCargado(true);
    // Sólo al abrir la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Se guarda un momento después del último cambio: mientras llega el stream no se reescribe en cada línea.
  useEffect(() => {
    if (!cargado) return;
    const t = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(CLAVE_GUARDADO, JSON.stringify({ modelo, conversacion, mensajes }));
      } catch {
        /* sin lugar o bloqueado: la conversación sigue en pantalla */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [mensajes, modelo, conversacion, cargado]);

  // Al salir de la página se deja de escuchar (la pregunta sigue en el servidor y queda en Informes guardados).
  useEffect(() => () => control.current?.abort(), []);

  /** Envía una pregunta con la conversación de `base` (por defecto, la que está en pantalla). */
  const enviar = useCallback(
    async (textoCrudo: string, base?: Mensaje[]) => {
      const texto = textoCrudo.trim();
      if (!texto || control.current) return false;
      const previos = base ?? ultimos.current;
      const usuario: MensajeUsuario = { id: nuevoId(), rol: "usuario", texto };
      const asistente = turnoVacio(nuevoId(), modelo);
      const cuerpo = { mensajes: historial([...previos, usuario]), modelo, conversacion };
      setMensajes([...previos, usuario, asistente]);
      await escuchar(asistente.id, (senal) =>
        fetch("/api/admin/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify(cuerpo),
          cache: "no-store",
          signal: senal,
        }),
      );
      return true;
    },
    [modelo, conversacion, escuchar],
  );

  /**
   * «Detener»: si la pregunta corre en el servidor, se le pide que pare (el stream trae el aviso y se cierra solo); si
   * no responde a tiempo, o no hay informe, se deja de escuchar.
   */
  const detener = useCallback(() => {
    const ac = control.current;
    if (!ac) return;
    const enCurso = [...ultimos.current].reverse().find((m): m is MensajeAsistente => m.rol === "asistente" && m.estado === "corriendo");
    if (!enCurso?.informe) return ac.abort();
    // Si el stream ya terminó cuando vence, abortar no hace nada.
    window.setTimeout(() => ac.abort(), ESPERA_DETENER_MS);
    fetch(`/api/admin/chat/informes/${encodeURIComponent(enCurso.informe)}/detener`, { method: "POST", cache: "no-store" })
      .then((r) => {
        if (!r.ok) ac.abort();
      })
      .catch(() => ac.abort());
  }, []);

  /** Empieza de cero: lo que estaba corriendo sigue en el servidor (queda en Informes guardados). */
  const nueva = useCallback(() => {
    control.current?.abort();
    control.current = null;
    setMensajes([]);
    setConversacion(nuevoId());
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
export async function leerStream(r: Response, aplicar: (e: EventoChat) => void) {
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
