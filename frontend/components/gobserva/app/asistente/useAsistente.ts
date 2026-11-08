"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/cuentas";
import {
  aplicarEvento, cerrarTurno, comoEvento, historial, nuevoId, turnoVacio, type EventoChat, type Mensaje, type MensajeUsuario,
} from "@/components/admin/chat/conversacion";

/**
 * El asistente de cada app (2026-11-08): la conversación, el pedido a POST /gobserva/cuenta/chat con su stream NDJSON
 * (los mismos eventos del chat del panel, más `creditos` al final) y una copia en sessionStorage (una recarga no la
 * pierde; cerrar la pestaña, sí). El servidor no guarda la conversación.
 */

export type AppAsistente = "empleo" | "licitaciones";
export type ModoAsistente = "rapido" | "fino" | "profundo";

/** Los modos de cada app y lo que cuestan (lib/chatApp.ts de la API). Empleo sólo trae el rápido. */
export const MODOS: Record<ModoAsistente, { etiqueta: string; costo: string; detalle: string }> = {
  rapido: { etiqueta: "Rápido", costo: "5 créditos", detalle: "Responde en segundos." },
  fino: { etiqueta: "Preciso", costo: "25 créditos", detalle: "Razona mejor las preguntas difíciles." },
  profundo: { etiqueta: "Profundo", costo: "de 25 a 100 créditos", detalle: "Planifica, cruza fuentes y verifica: para un informe." },
};
export const MODOS_DE: Record<AppAsistente, ModoAsistente[]> = { empleo: ["rapido"], licitaciones: ["rapido", "fino", "profundo"] };

/** Por qué no se pudo preguntar, cuando hay que ofrecer algo (un plan, el modo rápido). */
export interface AvisoAsistente {
  codigo: string;
  texto: string;
}

async function leer(r: Response, aplicar: (e: EventoChat) => void, alCobrar: (c: { usados: number; quedan: number | null }) => void) {
  const procesar = (linea: string) => {
    const t = linea.trim();
    if (!t) return;
    let crudo: unknown;
    try {
      crudo = JSON.parse(t);
    } catch {
      return;
    }
    const o = crudo as { tipo?: unknown; usados?: unknown; quedan?: unknown };
    if (o?.tipo === "creditos") {
      alCobrar({ usados: Number(o.usados) || 0, quedan: typeof o.quedan === "number" ? o.quedan : null });
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

export function useAsistente(app: AppAsistente, alTerminar?: () => void) {
  const clave = `gobserva-asistente-${app}`;
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [modo, setModo] = useState<ModoAsistente>("rapido");
  const [aviso, setAviso] = useState<AvisoAsistente | null>(null);
  const [cobro, setCobro] = useState<{ usados: number; quedan: number | null } | null>(null);
  const [cargado, setCargado] = useState(false);
  const control = useRef<AbortController | null>(null);
  const ultimos = useRef(mensajes);
  ultimos.current = mensajes;

  // La conversación de esta pestaña (lo que estaba corriendo al recargar queda cortado).
  useEffect(() => {
    try {
      const g = JSON.parse(sessionStorage.getItem(clave) ?? "null") as { mensajes?: Mensaje[]; modo?: ModoAsistente } | null;
      if (g?.mensajes) setMensajes(g.mensajes.map((m) => (m.rol === "asistente" ? cerrarTurno(m, false) : m)));
      if (g?.modo && MODOS_DE[app].includes(g.modo)) setModo(g.modo);
    } catch {
      /* sin sessionStorage: empieza vacía */
    }
    setCargado(true);
  }, [clave, app]);
  useEffect(() => {
    if (!cargado) return;
    try {
      sessionStorage.setItem(clave, JSON.stringify({ mensajes: mensajes.slice(-30), modo }));
    } catch {
      /* lleno o bloqueado: no se guarda */
    }
  }, [mensajes, modo, cargado, clave]);
  useEffect(() => () => control.current?.abort(), []);

  const enviar = useCallback(
    async (textoCrudo: string, base?: Mensaje[]) => {
      const texto = textoCrudo.trim();
      if (!texto || control.current) return false;
      const previos = base ?? ultimos.current;
      const usuario: MensajeUsuario = { id: nuevoId(), rol: "usuario", texto };
      const asistente = turnoVacio(nuevoId(), modo === "rapido" ? "rapido" : "fino");
      setMensajes([...previos, usuario, asistente]);
      setAviso(null);
      setCobro(null);
      const ac = new AbortController();
      control.current = ac;
      const cambiar = (fn: (m: Extract<Mensaje, { rol: "asistente" }>) => Extract<Mensaje, { rol: "asistente" }>) =>
        setMensajes((ms) => ms.map((m) => (m.id === asistente.id && m.rol === "asistente" ? fn(m) : m)));
      const aplicar = (e: EventoChat) => cambiar((m) => aplicarEvento(m, e));
      try {
        const r = await authFetch("/gobserva/cuenta/chat", {
          method: "POST",
          headers: { Accept: "application/x-ndjson" },
          body: JSON.stringify({ producto: app, modo, mensajes: historial([...previos, usuario]) }),
          signal: ac.signal,
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { error?: string; detail?: string } | null;
          const mensaje = j?.detail ?? (r.status === 401 ? "Tu sesión terminó. Vuelve a entrar." : "El asistente no pudo responder. Vuelve a intentarlo.");
          if (j?.error === "sin_plan" || j?.error === "sin_creditos" || j?.error === "tope_dia") setAviso({ codigo: j.error, texto: mensaje });
          aplicar({ tipo: "error", mensaje });
          return true;
        }
        await leer(r, aplicar, setCobro);
      } catch {
        if (!ac.signal.aborted) aplicar({ tipo: "error", mensaje: "Se perdió la conexión. Vuelve a preguntar." });
      } finally {
        if (control.current === ac) control.current = null;
        cambiar((m) => cerrarTurno(m, ac.signal.aborted));
        alTerminar?.();
      }
      return true;
    },
    [app, modo, alTerminar],
  );

  const detener = useCallback(() => control.current?.abort(), []);
  const nueva = useCallback(() => {
    control.current?.abort();
    setMensajes([]);
    setAviso(null);
    setCobro(null);
  }, []);
  /** Vuelve a hacer la última pregunta (la que no tuvo respuesta). */
  const reintentar = useCallback(() => {
    const ms = ultimos.current;
    const i = ms.map((m) => m.rol).lastIndexOf("usuario");
    if (i < 0) return;
    void enviar((ms[i] as MensajeUsuario).texto, ms.slice(0, i));
  }, [enviar]);

  const corriendo = mensajes.some((m) => m.rol === "asistente" && m.estado === "corriendo");
  return { mensajes, modo, setModo, enviar, detener, nueva, reintentar, corriendo, aviso, cobro };
}
