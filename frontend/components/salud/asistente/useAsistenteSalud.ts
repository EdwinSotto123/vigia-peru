"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  aplicarEvento, cerrarTurno, comoEvento, historial, leerGuardado, nuevoId, turnoVacio, type EventoChat, type Mensaje, type MensajeAsistente,
  type MensajeUsuario,
} from "@/components/admin/chat/conversacion";
import { ErrorTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile } from "@/components/seguridad/mensajes";
import { URL_ASISTENTE_SALUD } from "@/lib/gobserva-salud";

/**
 * El asistente público de Gobserva Salud: la conversación en pantalla y el pedido a POST /salud/asistente (NDJSON, los
 * mismos eventos que los asistentes de las apps: inicio, paso, resultado, texto, respuesta, fin, error). Sin cuenta, sin
 * créditos y sin historial guardado: sessionStorage recuerda sólo la conversación de esta pestaña (una recarga no la
 * pierde; al cerrar la pestaña se va). Cada pregunta lleva un token nuevo de Turnstile (`obtenerToken`).
 */

const CLAVE = "gobserva-salud-asistente-v1";
/** Las conversaciones anteriores, sólo en este dispositivo (como «lo visto»): hasta 20, la más reciente primero. */
const HISTORIAL = "gobserva-salud-asistente-historial-v1";
const MAX_CONVERSACIONES = 20;

export interface Conversacion {
  id: string;
  /** La primera pregunta, recortada: el nombre de la conversación. */
  titulo: string;
  /** Cuándo se habló por última vez (ms). */
  en: number;
  preguntas: number;
  mensajes: Mensaje[];
}

/** Lo guardado en el historial, validado mensaje por mensaje (puede venir de otra versión de la página). */
function leerHistorial(crudo: string | null): Conversacion[] {
  if (!crudo) return [];
  try {
    const lista = JSON.parse(crudo) as unknown;
    if (!Array.isArray(lista)) return [];
    const out: Conversacion[] = [];
    for (const c of lista as Record<string, unknown>[]) {
      if (!c || typeof c.id !== "string" || typeof c.en !== "number") continue;
      const g = leerGuardado(JSON.stringify({ mensajes: c.mensajes }));
      if (!g || !g.mensajes.length) continue;
      const primera = g.mensajes.find((m) => m.rol === "usuario") as MensajeUsuario | undefined;
      out.push({
        id: c.id,
        titulo: primera?.texto.slice(0, 90) ?? "Conversación",
        en: c.en,
        preguntas: g.mensajes.filter((m) => m.rol === "usuario").length,
        mensajes: g.mensajes.map((m) => (m.rol === "asistente" ? cerrarTurno(m, false) : m)),
      });
    }
    return out.slice(0, MAX_CONVERSACIONES);
  } catch {
    return [];
  }
}
/** Los topes de la API (CuerpoAsistente): 16 mensajes y 16 mil caracteres por conversación. */
const MAX_MENSAJES = 16;
const MAX_CARACTERES = 16_000;

/** Por qué no se pudo preguntar: el código de la API (o el estado HTTP) y lo que se le dice a la persona. */
export interface AvisoSalud {
  codigo: string;
  estado: number | null;
  texto: string;
}

const PALABRAS_ESTADO: Record<number, string> = {
  400: "No pudimos mandar la pregunta así. Revísala y vuelve a intentarlo.",
  403: "Confirma que eres una persona (la casilla de verificación) y vuelve a preguntar.",
  413: "La conversación ya es muy larga: empieza una nueva.",
  429: "Hiciste varias preguntas seguidas. Espera un minuto.",
};

async function leer(r: Response, aplicar: (e: EventoChat) => void) {
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
  const deco = new TextDecoder();
  let bufer = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    bufer += deco.decode(value, { stream: true });
    let i = bufer.indexOf("\n");
    while (i >= 0) {
      procesar(bufer.slice(0, i));
      bufer = bufer.slice(i + 1);
      i = bufer.indexOf("\n");
    }
  }
  procesar(bufer + deco.decode());
}

/** Lo que se manda: las últimas vueltas que caben en los topes de la API, empezando siempre por una pregunta. */
function paraEnviar(mensajes: Mensaje[]): { rol: "usuario" | "asistente"; texto: string }[] {
  let h = historial(mensajes).map((m) => ({ ...m, texto: m.texto.slice(0, 4000) }));
  if (h.length > MAX_MENSAJES) h = h.slice(-MAX_MENSAJES);
  while (h.length > 1 && h.reduce((n, m) => n + m.texto.length, 0) > MAX_CARACTERES) h = h.slice(1);
  while (h.length && h[0].rol !== "usuario") h = h.slice(1);
  return h;
}

export function useAsistenteSalud(obtenerToken: () => Promise<string | null>) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [aviso, setAviso] = useState<AvisoSalud | null>(null);
  const [cargado, setCargado] = useState(false);
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [actualId, setActualId] = useState<string>(() => nuevoId());
  const actual = useRef(actualId);
  actual.current = actualId;
  const control = useRef<AbortController | null>(null);
  const ultimos = useRef(mensajes);
  ultimos.current = mensajes;
  const token = useRef(obtenerToken);
  token.current = obtenerToken;

  // La conversación de esta pestaña (lo que corría al recargar queda cortado).
  useEffect(() => {
    try {
      // leerGuardado valida cada mensaje (lo guardado puede venir de otra versión de la página).
      const g = leerGuardado(sessionStorage.getItem(CLAVE));
      if (g) {
        setMensajes(g.mensajes.map((m) => (m.rol === "asistente" ? cerrarTurno(m, false) : m)));
        setActualId(g.conversacion);
      }
    } catch {
      /* sin sessionStorage: empieza vacía */
    }
    try {
      setConversaciones(leerHistorial(localStorage.getItem(HISTORIAL)));
    } catch {
      /* sin localStorage: sin historial */
    }
    setCargado(true);
  }, []);
  useEffect(() => {
    if (!cargado) return;
    try {
      if (mensajes.length) sessionStorage.setItem(CLAVE, JSON.stringify({ modelo: "rapido", conversacion: actual.current, mensajes: mensajes.slice(-40) }));
      else sessionStorage.removeItem(CLAVE);
    } catch {
      /* lleno o bloqueado: no se guarda */
    }
  }, [mensajes, cargado]);
  // Al terminar cada respuesta, la conversación entra (o sube) al historial de este dispositivo.
  useEffect(() => {
    if (!cargado || !mensajes.some((m) => m.rol === "usuario")) return;
    if (mensajes.some((m) => m.rol === "asistente" && m.estado === "corriendo")) return;
    const primera = mensajes.find((m) => m.rol === "usuario") as MensajeUsuario;
    const esta: Conversacion = {
      id: actual.current,
      titulo: primera.texto.slice(0, 90),
      en: Date.now(),
      preguntas: mensajes.filter((m) => m.rol === "usuario").length,
      mensajes: mensajes.slice(-40),
    };
    setConversaciones((cs) => {
      const previa = cs.find((c) => c.id === esta.id);
      // Sin cambios (se abrió una vieja y no se preguntó nada): no se mueve arriba.
      if (previa && previa.mensajes.length === esta.mensajes.length) return cs;
      const nuevas = [esta, ...cs.filter((c) => c.id !== esta.id)].slice(0, MAX_CONVERSACIONES);
      try {
        localStorage.setItem(HISTORIAL, JSON.stringify(nuevas.map(({ id, en, mensajes: ms }) => ({ id, en, mensajes: ms }))));
      } catch {
        /* lleno o bloqueado: queda sólo en esta pestaña */
      }
      return nuevas;
    });
  }, [mensajes, cargado]);
  const guardarHistorial = (cs: Conversacion[]) => {
    try {
      if (cs.length) localStorage.setItem(HISTORIAL, JSON.stringify(cs.map(({ id, en, mensajes: ms }) => ({ id, en, mensajes: ms }))));
      else localStorage.removeItem(HISTORIAL);
    } catch {
      /* bloqueado: no pasa nada */
    }
  };
  useEffect(() => () => control.current?.abort(), []);

  const enviar = useCallback(async (textoCrudo: string, base?: Mensaje[]) => {
    const texto = textoCrudo.trim().slice(0, 4000);
    if (!texto || control.current) return false;
    const previos = base ?? ultimos.current;
    const usuario: MensajeUsuario = { id: nuevoId(), rol: "usuario", texto };
    const asistente = turnoVacio(nuevoId(), "rapido");
    setMensajes([...previos, usuario, asistente]);
    setAviso(null);
    const ac = new AbortController();
    control.current = ac;
    const cambiar = (fn: (m: MensajeAsistente) => MensajeAsistente) =>
      setMensajes((ms) => ms.map((m) => (m.id === asistente.id && m.rol === "asistente" ? fn(m) : m)));
    const aplicar = (e: EventoChat) => cambiar((m) => aplicarEvento(m, e));
    try {
      let verificado: string | null = null;
      try {
        verificado = await token.current();
      } catch (e) {
        const mensaje = e instanceof ErrorTurnstile ? e.message : "No pudimos verificar que eres una persona. Vuelve a intentarlo.";
        setAviso({ codigo: "captcha", estado: null, texto: mensaje });
        aplicar({ tipo: "error", mensaje });
        return true;
      }
      if (ac.signal.aborted) return true;
      const r = await fetch(URL_ASISTENTE_SALUD, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", ...cabeceraTurnstile(verificado) },
        body: JSON.stringify({ mensajes: paraEnviar([...previos, usuario]) }),
        signal: ac.signal,
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: string; detail?: string } | null;
        const mensaje = j?.detail ?? PALABRAS_ESTADO[r.status] ?? "El asistente no pudo responder. Vuelve a intentarlo en un momento.";
        setAviso({ codigo: j?.error ?? String(r.status), estado: r.status, texto: mensaje });
        aplicar({ tipo: "error", mensaje });
        return true;
      }
      await leer(r, aplicar);
    } catch {
      if (!ac.signal.aborted) aplicar({ tipo: "error", mensaje: "Se perdió la conexión. Vuelve a preguntar." });
    } finally {
      if (control.current === ac) control.current = null;
      cambiar((m) => cerrarTurno(m, ac.signal.aborted));
    }
    return true;
  }, []);

  const detener = useCallback(() => control.current?.abort(), []);
  const nueva = useCallback(() => {
    control.current?.abort();
    setMensajes([]);
    setAviso(null);
    setActualId(nuevoId());
  }, []);
  /** Retoma una conversación del historial. */
  const abrir = useCallback(
    (id: string) => {
      const c = conversaciones.find((x) => x.id === id);
      if (!c) return;
      control.current?.abort();
      setAviso(null);
      setActualId(c.id);
      setMensajes(c.mensajes);
    },
    [conversaciones],
  );
  /** Borra una conversación (o todas) de este dispositivo. */
  const borrar = useCallback(
    (id: string | "todas") => {
      const quedan = id === "todas" ? [] : conversaciones.filter((c) => c.id !== id);
      setConversaciones(quedan);
      guardarHistorial(quedan);
      if (id === "todas" || id === actual.current) {
        control.current?.abort();
        setMensajes([]);
        setAviso(null);
        setActualId(nuevoId());
      }
    },
    [conversaciones],
  );
  /** Vuelve a hacer la última pregunta (la que no tuvo respuesta). */
  const reintentar = useCallback(() => {
    const ms = ultimos.current;
    const i = ms.map((m) => m.rol).lastIndexOf("usuario");
    if (i < 0) return;
    void enviar((ms[i] as MensajeUsuario).texto, ms.slice(0, i));
  }, [enviar]);

  const corriendo = mensajes.some((m) => m.rol === "asistente" && m.estado === "corriendo");
  return { mensajes, enviar, detener, nueva, reintentar, corriendo, aviso, cargado, conversaciones, actualId, abrir, borrar };
}
