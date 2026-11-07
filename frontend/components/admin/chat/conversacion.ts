/**
 * Chat de investigación (/admin/chat): la conversación, el stream de POST /api/admin/chat y lo que se
 * guarda en sessionStorage. Puro (sin React): lo usan useChat.ts y las piezas que pintan cada turno.
 *
 * El API responde `application/x-ndjson`, un objeto JSON por línea:
 *   inicio     el modelo que contesta
 *   paso       el asistente llama a una herramienta (id, herramienta, título, entrada)
 *   resultado  esa herramienta respondió (ok, caracteres, resumen de ~240 caracteres)
 *   texto      lo que el asistente dice entre una herramienta y otra (se ve apagado entre los pasos)
 *   respuesta  la respuesta final, en markdown
 *   fin        tiempo, herramientas, tokens y costo en US$
 *   error      no pudo terminar
 * Un error de validación llega antes, como JSON normal con 4xx: `{ error, detail }`.
 */

export type ModeloChat = "rapido" | "fino";

export const MODELOS: { valor: ModeloChat; etiqueta: string }[] = [
  { valor: "rapido", etiqueta: "Rápido (Haiku)" },
  { valor: "fino", etiqueta: "Profundo (Sonnet)" },
];

const esModelo = (x: unknown): x is ModeloChat => x === "rapido" || x === "fino";

/** `cortado`: el turno terminó (o se recargó la página) sin que esa herramienta respondiera. */
export type EstadoPaso = "en_curso" | "listo" | "error" | "cortado";

export interface PasoHerramienta {
  tipo: "herramienta";
  id: string;
  herramienta: string;
  titulo: string;
  entrada: Record<string, unknown> | null;
  estado: EstadoPaso;
  caracteres: number | null;
  resumen: string | null;
}

export interface PasoTexto {
  tipo: "texto";
  id: string;
  texto: string;
}

export type Paso = PasoHerramienta | PasoTexto;

export interface Totales {
  ms: number | null;
  herramientas: number | null;
  tokens: { entrada: number; salida: number; cache_leidos: number } | null;
  costo_usd: number | null;
}

/**
 * corriendo: el stream sigue abierto. listo: llegó la respuesta. error: el API dijo que no pudo.
 * detenido: lo cortó quien pregunta («Detener»). cortado: el stream se cerró sin respuesta ni error, o se recargó la
 * página a mitad de camino.
 */
export type EstadoTurno = "corriendo" | "listo" | "error" | "detenido" | "cortado";

export interface MensajeUsuario {
  id: string;
  rol: "usuario";
  texto: string;
}

export interface MensajeAsistente {
  id: string;
  rol: "asistente";
  estado: EstadoTurno;
  /** Cuándo se envió la pregunta (ms): el «Pensando… N s». */
  inicio: number;
  modeloPedido: ModeloChat;
  /** El modelo que de verdad contestó (evento `inicio`). */
  modelo: string | null;
  pasos: Paso[];
  /** La respuesta final en markdown; null mientras no llegue. */
  texto: string | null;
  fin: Totales | null;
  error: string | null;
}

export type Mensaje = MensajeUsuario | MensajeAsistente;

export type EventoChat =
  | { tipo: "inicio"; modelo: string | null }
  | { tipo: "paso"; id: string; herramienta: string; titulo: string | null; entrada: Record<string, unknown> | null }
  | { tipo: "resultado"; id: string; herramienta: string | null; ok: boolean; caracteres: number | null; resumen: string | null }
  | { tipo: "texto"; texto: string }
  | { tipo: "respuesta"; texto: string }
  | { tipo: "fin"; totales: Totales }
  | { tipo: "error"; mensaje: string };

export function nuevoId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fuera de un contexto seguro: el respaldo de abajo */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Una línea del stream ya parseada → evento, o null si no se entiende (se ignora). Un `{error, detail}` suelto es un error. */
export function comoEvento(crudo: unknown): EventoChat | null {
  const o = obj(crudo);
  if (!o) return null;
  switch (o.tipo) {
    case "inicio":
      return { tipo: "inicio", modelo: str(o.modelo) };
    case "paso": {
      const herramienta = str(o.herramienta) ?? "herramienta";
      return { tipo: "paso", id: str(o.id) ?? herramienta, herramienta, titulo: str(o.titulo), entrada: obj(o.entrada) };
    }
    case "resultado":
      return { tipo: "resultado", id: str(o.id) ?? str(o.herramienta) ?? "herramienta", herramienta: str(o.herramienta), ok: o.ok !== false, caracteres: num(o.caracteres), resumen: str(o.resumen) };
    case "texto":
      return typeof o.texto === "string" ? { tipo: "texto", texto: o.texto } : null;
    case "respuesta":
      return typeof o.texto === "string" ? { tipo: "respuesta", texto: o.texto } : null;
    case "fin": {
      const t = obj(o.tokens);
      return {
        tipo: "fin",
        totales: {
          ms: num(o.ms),
          herramientas: num(o.herramientas),
          tokens: t ? { entrada: num(t.entrada) ?? 0, salida: num(t.salida) ?? 0, cache_leidos: num(t.cache_leidos) ?? 0 } : null,
          costo_usd: num(o.costo_usd),
        },
      };
    }
    case "error":
      return { tipo: "error", mensaje: str(o.mensaje) ?? str(o.detail) ?? "El asistente no pudo terminar." };
  }
  if (o.tipo === undefined && (str(o.detail) || str(o.error))) return { tipo: "error", mensaje: str(o.detail) ?? str(o.error)! };
  return null;
}

/** Aplica un evento del stream al turno del asistente (puro: lo usa un setState funcional). */
export function aplicarEvento(m: MensajeAsistente, e: EventoChat): MensajeAsistente {
  switch (e.tipo) {
    case "inicio":
      return { ...m, modelo: e.modelo ?? m.modelo };
    case "paso": {
      if (m.pasos.some((p) => p.tipo === "herramienta" && p.id === e.id)) return m;
      const paso: PasoHerramienta = { tipo: "herramienta", id: e.id, herramienta: e.herramienta, titulo: e.titulo ?? e.herramienta, entrada: e.entrada, estado: "en_curso", caracteres: null, resumen: null };
      return { ...m, pasos: [...m.pasos, paso] };
    }
    case "resultado": {
      const estado: EstadoPaso = e.ok ? "listo" : "error";
      const i = m.pasos.findIndex((p) => p.tipo === "herramienta" && p.id === e.id);
      if (i < 0) {
        // Llegó el resultado de un paso que no se vio empezar: se agrega igual, para que no se pierda.
        const herramienta = e.herramienta ?? "herramienta";
        return { ...m, pasos: [...m.pasos, { tipo: "herramienta", id: e.id, herramienta, titulo: herramienta, entrada: null, estado, caracteres: e.caracteres, resumen: e.resumen }] };
      }
      const pasos = m.pasos.slice();
      pasos[i] = { ...(pasos[i] as PasoHerramienta), estado, caracteres: e.caracteres, resumen: e.resumen };
      return { ...m, pasos };
    }
    case "texto": {
      if (!e.texto.trim()) return m;
      const ultimo = m.pasos[m.pasos.length - 1];
      // Dos textos seguidos sin herramienta en medio son el mismo momento: una sola línea.
      if (ultimo?.tipo === "texto") return { ...m, pasos: [...m.pasos.slice(0, -1), { ...ultimo, texto: `${ultimo.texto}\n\n${e.texto}` }] };
      return { ...m, pasos: [...m.pasos, { tipo: "texto", id: `texto-${m.pasos.length}`, texto: e.texto }] };
    }
    case "respuesta":
      return { ...m, texto: e.texto };
    case "fin":
      return { ...m, fin: e.totales };
    case "error":
      return { ...m, error: e.mensaje };
  }
}

/** Cierra el turno al terminar el stream (bien, con error o detenido): lo que seguía «en curso» queda sin terminar. */
export function cerrarTurno(m: MensajeAsistente, detenido: boolean): MensajeAsistente {
  if (m.estado !== "corriendo") return m;
  const estado: EstadoTurno = m.texto != null ? "listo" : detenido ? "detenido" : m.error ? "error" : "cortado";
  const pasos = m.pasos.map((p) => (p.tipo === "herramienta" && p.estado === "en_curso" ? { ...p, estado: "cortado" as const } : p));
  return { ...m, estado, pasos };
}

/**
 * Lo que se manda al API: las preguntas y las respuestas finales, sólo el texto. Un turno sin respuesta (detenido, con
 * error) no va; si eso deja dos preguntas seguidas, se juntan en una, así los roles siempre se alternan.
 */
export function historial(mensajes: Mensaje[]): { rol: "usuario" | "asistente"; texto: string }[] {
  const out: { rol: "usuario" | "asistente"; texto: string }[] = [];
  for (const m of mensajes) {
    const texto = (m.rol === "usuario" ? m.texto : m.texto ?? "").trim();
    if (!texto) continue;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.rol === m.rol) ultimo.texto = `${ultimo.texto}\n\n${texto}`;
    else out.push({ rol: m.rol, texto });
  }
  while (out.length && out[0].rol !== "usuario") out.shift();
  return out;
}

// ─── sessionStorage ─────────────────────────────────────────────────────────

export const CLAVE_GUARDADO = "vigia-admin-chat-v1";

export interface Guardado {
  modelo: ModeloChat;
  mensajes: Mensaje[];
}

function leerPaso(x: unknown): Paso | null {
  const p = obj(x);
  if (!p || typeof p.id !== "string") return null;
  if (p.tipo === "texto") return typeof p.texto === "string" ? { tipo: "texto", id: p.id, texto: p.texto } : null;
  if (p.tipo !== "herramienta") return null;
  const estado: EstadoPaso = p.estado === "listo" || p.estado === "error" ? p.estado : "cortado";
  const herramienta = str(p.herramienta) ?? "herramienta";
  return { tipo: "herramienta", id: p.id, herramienta, titulo: str(p.titulo) ?? herramienta, entrada: obj(p.entrada), estado, caracteres: num(p.caracteres), resumen: str(p.resumen) };
}

function leerMensaje(x: unknown): Mensaje | null {
  const m = obj(x);
  if (!m || typeof m.id !== "string") return null;
  if (m.rol === "usuario") return typeof m.texto === "string" ? { id: m.id, rol: "usuario", texto: m.texto } : null;
  if (m.rol !== "asistente") return null;
  const pasos = Array.isArray(m.pasos) ? m.pasos.map(leerPaso).filter((p): p is Paso => !!p) : [];
  const texto = typeof m.texto === "string" ? m.texto : null;
  const fin = obj(m.fin);
  const tokens = fin ? obj(fin.tokens) : null;
  // Un turno que corría cuando se recargó la página ya no tiene stream: queda cortado.
  const estado: EstadoTurno = m.estado === "listo" || m.estado === "error" || m.estado === "detenido" ? m.estado : texto != null ? "listo" : "cortado";
  return {
    id: m.id,
    rol: "asistente",
    estado,
    inicio: num(m.inicio) ?? Date.now(),
    modeloPedido: esModelo(m.modeloPedido) ? m.modeloPedido : "rapido",
    modelo: str(m.modelo),
    pasos,
    texto,
    fin: fin
      ? {
          ms: num(fin.ms),
          herramientas: num(fin.herramientas),
          tokens: tokens ? { entrada: num(tokens.entrada) ?? 0, salida: num(tokens.salida) ?? 0, cache_leidos: num(tokens.cache_leidos) ?? 0 } : null,
          costo_usd: num(fin.costo_usd),
        }
      : null,
    error: str(m.error),
  };
}

/** Lo guardado en sessionStorage, validado; null si no hay nada o no se entiende. */
export function leerGuardado(crudo: string | null): Guardado | null {
  if (!crudo) return null;
  try {
    const g = obj(JSON.parse(crudo));
    if (!g) return null;
    const mensajes = Array.isArray(g.mensajes) ? g.mensajes.map(leerMensaje).filter((m): m is Mensaje => !!m) : [];
    return { modelo: esModelo(g.modelo) ? g.modelo : "fino", mensajes };
  } catch {
    return null;
  }
}

// ─── Formatos ───────────────────────────────────────────────────────────────

const ENTERO = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });
const UN_DECIMAL = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });

export const entero = (n: number) => ENTERO.format(Math.round(n));

/** 12345 → «12.3 s»; 65000 → «1 min 5 s». */
export function duracion(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${UN_DECIMAL.format(s)} s`;
  const min = Math.floor(s / 60);
  const resto = Math.round(s - min * 60);
  return resto ? `${min} min ${resto} s` : `${min} min`;
}

/** 0.0123 → «US$ 0.0123»; 1.5 → «US$ 1.50». */
export function usd(n: number): string {
  const f = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 });
  return `US$ ${f.format(n)}`;
}

/** La entrada de una herramienta en pares «clave: valor» cortos, sin vacíos. */
export function entradaCompacta(entrada: Record<string, unknown> | null, tope = 90): { clave: string; valor: string }[] {
  if (!entrada) return [];
  const out: { clave: string; valor: string }[] = [];
  for (const [clave, v] of Object.entries(entrada)) {
    if (v === null || v === undefined || v === "") continue;
    let valor: string;
    if (typeof v === "string") valor = v;
    else if (typeof v === "number" || typeof v === "boolean") valor = String(v);
    else if (Array.isArray(v)) valor = v.map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : JSON.stringify(x))).join(", ");
    else valor = JSON.stringify(v);
    if (!valor) continue;
    out.push({ clave, valor: valor.length > tope ? `${valor.slice(0, tope - 1)}…` : valor });
  }
  return out;
}
