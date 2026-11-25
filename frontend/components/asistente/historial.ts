/**
 * El historial y los ajustes del asistente de Vigía (2026-11-25, el usuario: «selección de modelo, créditos restantes por
 * día, historial de chat»). Las conversaciones se guardan SÓLO en este navegador (localStorage), por cuenta: no se suben
 * a Vigía, así que el servidor sigue sin guardar lo que se pregunta. Un índice corto para la lista y cada conversación en
 * su propia clave, para no reescribir todo en cada respuesta. Si el navegador se queda sin espacio, se borran las más
 * viejas. Puro (sin React).
 */
import { leerMensaje, type Mensaje } from "@/components/admin/chat/conversacion";

export type ModoVigia = "rapido" | "profundo";

/** Lo que manda GET /cuentas/me/chat/cupo y el evento `cupo` del stream. */
export interface CupoChat {
  tope: number;
  usadas: number;
  quedan: number;
  /** Cuándo se libera la próxima pregunta (ISO), o null si no usó ninguna. */
  proxima: string | null;
  verificado: boolean;
  modos: { id: ModoVigia; costo: number }[];
}

export interface ResumenConversacion {
  id: string;
  titulo: string;
  creada: number;
  actualizada: number;
  preguntas: number;
  /** Si alguna respuesta fue en modo profundo. */
  profunda: boolean;
}

export interface Ajustes {
  modo: ModoVigia;
  guardar: boolean;
}

const PREFIJO = "vigia-asistente-v1";
const AJUSTES = "vigia-asistente-ajustes";
/** Las conversaciones que se guardan por cuenta. */
export const MAX_CONVERSACIONES = 30;

const claveIndice = (uid: string) => `${PREFIJO}:${uid}:indice`;
const claveConversacion = (uid: string, id: string) => `${PREFIJO}:${uid}:c:${id}`;

function leer(clave: string): unknown {
  try {
    const t = localStorage.getItem(clave);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function escribir(clave: string, valor: unknown): boolean {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

function quitar(clave: string) {
  try {
    localStorage.removeItem(clave);
  } catch {
    /* sin almacenamiento: nada que borrar */
  }
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function leerIndice(uid: string): ResumenConversacion[] {
  const crudo = leer(claveIndice(uid));
  if (!Array.isArray(crudo)) return [];
  return crudo
    .flatMap((x): ResumenConversacion[] => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.titulo !== "string") return [];
      const creada = num(o.creada, 0);
      return [{ id: o.id, titulo: o.titulo, creada, actualizada: num(o.actualizada, creada), preguntas: num(o.preguntas, 1), profunda: o.profunda === true }];
    })
    .sort((a, b) => b.actualizada - a.actualizada);
}

export function leerConversacion(uid: string, id: string): Mensaje[] | null {
  const crudo = leer(claveConversacion(uid, id));
  if (!Array.isArray(crudo)) return null;
  return crudo.map(leerMensaje).filter((m): m is Mensaje => !!m);
}

/** El título de una conversación: su primera pregunta, en una línea. */
export function tituloDe(mensajes: Mensaje[]): string {
  const primera = mensajes.find((m) => m.rol === "usuario");
  const t = (primera?.texto ?? "Conversación").replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 89)}…` : t;
}

/**
 * Guarda una conversación y devuelve el índice nuevo. Sólo con turnos terminados (quien llama no guarda mientras corre).
 * Sin espacio: borra la más vieja (nunca la que se guarda) y reintenta.
 */
export function guardarConversacion(uid: string, id: string, creada: number, mensajes: Mensaje[]): ResumenConversacion[] {
  const resumen: ResumenConversacion = {
    id,
    titulo: tituloDe(mensajes),
    creada,
    actualizada: Date.now(),
    preguntas: mensajes.filter((m) => m.rol === "usuario").length,
    profunda: mensajes.some((m) => m.rol === "asistente" && m.modeloPedido === "fino"),
  };
  let indice = [resumen, ...leerIndice(uid).filter((r) => r.id !== id)];
  for (const sobra of indice.slice(MAX_CONVERSACIONES)) quitar(claveConversacion(uid, sobra.id));
  indice = indice.slice(0, MAX_CONVERSACIONES);
  for (let intento = 0; intento < 8; intento++) {
    if (escribir(claveConversacion(uid, id), mensajes) && escribir(claveIndice(uid), indice)) return indice;
    const vieja = indice.length > 1 ? indice[indice.length - 1] : null;
    if (!vieja) break;
    quitar(claveConversacion(uid, vieja.id));
    indice = indice.slice(0, -1);
  }
  return leerIndice(uid);
}

export function borrarConversacion(uid: string, id: string): ResumenConversacion[] {
  quitar(claveConversacion(uid, id));
  const indice = leerIndice(uid).filter((r) => r.id !== id);
  escribir(claveIndice(uid), indice);
  return indice;
}

export function borrarTodas(uid: string) {
  for (const r of leerIndice(uid)) quitar(claveConversacion(uid, r.id));
  quitar(claveIndice(uid));
}

export function leerAjustes(): Ajustes {
  const o = leer(AJUSTES) as Record<string, unknown> | null;
  return { modo: o?.modo === "profundo" ? "profundo" : "rapido", guardar: o?.guardar !== false };
}

export function guardarAjustes(a: Ajustes) {
  escribir(AJUSTES, a);
}

/** «Hoy», «Ayer», «Esta semana» o «Antes»: los grupos de la lista. */
export function grupoDe(ms: number, ahora = new Date()): string {
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  if (ms >= inicioHoy) return "Hoy";
  if (ms >= inicioHoy - 86_400_000) return "Ayer";
  if (ms >= inicioHoy - 6 * 86_400_000) return "Esta semana";
  return "Antes";
}

// En 24 horas: «18:40» (el formato de 12 horas de es-PE termina en «p. m.» y chocaba con el punto final de la frase).
const HORA = new Intl.DateTimeFormat("es-PE", { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
const FECHA = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short" });

/** «14:32» si es de hoy o ayer; «23 nov» si es más vieja. */
export function cuandoCorto(ms: number, ahora = new Date()): string {
  const g = grupoDe(ms, ahora);
  return g === "Hoy" || g === "Ayer" ? HORA.format(ms) : FECHA.format(ms).replace(/\.$/, "");
}

/** Cuándo se libera la próxima pregunta: «a las 18:40» o «mañana a las 9:05». */
export function cuandoSeLibera(iso: string, ahora = new Date()): string {
  const t = new Date(iso);
  const manana = t.getDate() !== ahora.getDate() || t.getTime() - ahora.getTime() > 86_400_000;
  return `${manana ? "mañana " : ""}a las ${HORA.format(t)}`;
}
