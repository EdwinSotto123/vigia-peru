/**
 * Reduce el stream NDJSON del orquestador a lo que el público necesita ver. Port literal de
 * backend/dispatcher/events.py (misma entrada → mismo JSON de salida; lo comprueba
 * scripts/paridad_eventos.ts contra el Python con corridas reales grabadas).
 *
 * Solo cuatro tipos de evento importan para el tablero en vivo: `phase`, `warn`, `error` y `final`.
 * `FASES` es el contrato con el frontend (`frontend/lib/auditoria.ts`): diez fases canónicas en el
 * orden real de `backend/agent/deterministic.py`. En el DAG paralelo las fases llegan desordenadas:
 * `fase_index` es el máximo alcanzado y `fases` {nombre: {estado, desde, hasta, motivo}} lleva el
 * estado de cada agente; el fin de cada fase se infiere del arranque de sus sucesoras (`CIERRA`) o
 * del `dag_join`/`final`.
 */

import { compararTexto, cortar, o, str, strip, verdad } from "./py.ts";

export const FASES: readonly string[] = [
  "compliance",
  "document_parser",
  "document_legal_analyst",
  "market",
  "web_research",
  "news_research",
  "entity_personnel",
  "person_network",
  "compliance_extended",
  "report_writer",
];

// nombre emitido por deterministic.py / main.py → fase canónica
export const ALIASES: Readonly<Record<string, string>> = {
  legal: "document_legal_analyst",
  research_parallel: "web_research", // web ∥ prensa ∥ funcionarios arrancan juntas
  news: "news_research",
  compliance_rules: "compliance_extended", // perfil `otros`: las reglas corren en código
};

// Fases auxiliares que se rastrean en `fases` (chips del frontend) aunque no cuenten para el índice.
export const AUXILIARES_RASTREADAS = new Set(["ocds", "proveedor", "persist_checkpoint", "safety_net", "persist", "self_eval"]);
export const RASTREADAS = new Set([...FASES, ...AUXILIARES_RASTREADAS]);
// Auxiliares visibles en la bitácora que no son un agente: cambian `fase_actual`, no `fases`.
export const AUXILIARES_SUELTAS = new Set(["started", "deterministic", "perfil", "clasificacion", "dag", "dag_join", "final"]);

// Ramas del DAG (todo lo que corre antes del join).
export const RAMAS: readonly string[] = [
  "compliance", "document_parser", "document_legal_analyst", "market",
  "proveedor", "web_research", "news_research", "entity_personnel",
];
const RAMA_DOCUMENTOS = ["document_parser", "document_legal_analyst", "market"];
const RAMA_PROVEEDOR = ["proveedor", "web_research", "news_research", "entity_personnel"];
// nombre de rama en los `error` de _correr_dag → fases que tumba
export const RAMA_FASES: Readonly<Record<string, readonly string[]>> = {
  compliance: ["compliance"],
  documentos: RAMA_DOCUMENTOS,
  proveedor: RAMA_PROVEEDOR,
};

// Al ARRANCAR la fase clave, las fases del valor que sigan `corriendo` pasan a `hecho`.
const SINTESIS_PREVIA = [...RAMAS, "ocds", "person_network", "compliance_extended"];
export const CIERRA: Readonly<Record<string, readonly string[]>> = {
  compliance: ["ocds"],
  document_parser: ["ocds"],
  proveedor: ["ocds"],
  document_legal_analyst: ["document_parser"],
  market: ["document_parser"],
  web_research: ["proveedor"],
  news_research: ["proveedor", "web_research"], // solo en modo secuencial
  entity_personnel: ["proveedor", "news_research"], // solo en modo secuencial
  dag_join: [...RAMAS, "ocds"],
  person_network: [...RAMAS, "ocds"],
  compliance_extended: [...RAMAS, "ocds", "person_network"],
  persist_checkpoint: SINTESIS_PREVIA,
  report_writer: [...SINTESIS_PREVIA, "persist_checkpoint"],
  safety_net: [...SINTESIS_PREVIA, "persist_checkpoint", "report_writer"],
  persist: [...SINTESIS_PREVIA, "persist_checkpoint", "report_writer", "safety_net"],
  self_eval: [...SINTESIS_PREVIA, "persist_checkpoint", "report_writer", "safety_net", "persist"],
};

// Posición en el flujo SECUENCIAL (sin DAG, o tras el join): arrancar una fase cierra las
// anteriores que sigan corriendo. Dentro del DAG este orden no vale (ramas concurrentes).
const ORDEN: Readonly<Record<string, number>> = {
  ...Object.fromEntries(FASES.map((f, i) => [f, i])),
  ocds: -1, proveedor: 3.5, persist_checkpoint: 8.5, safety_net: 9.5, persist: 9.6, self_eval: 9.7,
};
const orden = (n: string): number => (Object.hasOwn(ORDEN, n) ? ORDEN[n] : 99);

export const VISIBLES = new Set(["phase", "warn", "error", "final"]);

export interface Fase {
  estado?: string;
  desde?: string | null;
  hasta?: string | null;
  motivo?: string | null;
  msg?: string | null;
}
export type Fases = Record<string, Fase>;

/** Estado reducido (el `state` de main.py: la unión de todos los cambios). */
export interface Estado {
  fase_actual?: string;
  fase_index?: number;
  fases?: Fases;
  fases_completadas?: string[];
  dag?: boolean;
  terminado?: boolean;
  abortado?: string;
  error?: string;
}

export type Evento = Record<string, unknown>;

/** Motivo del aborto en un evento `final`, o null si el análisis terminó de verdad. */
function motivoAborto(ev: Evento): string | null {
  const st = ev.state;
  if (st !== null && typeof st === "object" && !Array.isArray(st) && verdad((st as Evento)._aborted)) {
    return cortar(str((st as Evento)._aborted), 120);
  }
  if (verdad(ev.runner_error)) {
    const re = ev.runner_error;
    const esDict = re !== null && typeof re === "object" && !Array.isArray(re);
    return o(cortar(str(esDict ? (re as Evento).msg ?? null : re), 120), "runner_error");
  }
  return null;
}

/** Nombre canónico de una fase/agente: aplica ALIASES y quita el sufijo `_agent`. */
export function canonico(raw: unknown): string {
  let n = strip(str(o(raw, "")));
  if (n.endsWith("_agent")) n = n.slice(0, -"_agent".length);
  return Object.hasOwn(ALIASES, n) ? ALIASES[n] : n;
}

/** Nombres de fase listados en un msg tipo 'investigación paralela: a ∥ b ∥ c'. */
function nombresEnMsg(msg: string | null): string[] {
  if (!msg) return [];
  const i = msg.indexOf(":");
  const cola = i >= 0 ? msg.slice(i + 1) : msg;
  return cola.replaceAll(",", "∥").split("∥").filter((t) => RASTREADAS.has(canonico(t))).map(canonico);
}

/** Fases `hecho`, en el orden del pipeline (canónicas primero). */
export function completadas(fases: Fases): string[] {
  const nombres = Object.keys(fases).sort((a, b) => orden(a) - orden(b) || compararTexto(a, b));
  return nombres.filter((n) => (o(fases[n], {}) as Fase).estado === "hecho");
}

function cerrar(fases: Fases, nombres: Iterable<string>, ts: string, estado = "hecho", motivo: string | null = null): boolean {
  let cambio = false;
  for (const n of new Set(nombres)) {
    const f = Object.hasOwn(fases, n) ? fases[n] : undefined;
    if (verdad(f) && f!.estado === "corriendo") {
      f!.estado = estado;
      f!.hasta = ts;
      if (motivo) f!.motivo = motivo;
      cambio = true;
    }
  }
  return cambio;
}

function arrancar(fases: Fases, nombre: string, ts: string, msg: string | null): void {
  const prev: Fase = (Object.hasOwn(fases, nombre) ? o(fases[nombre], {}) : {}) as Fase;
  fases[nombre] = { estado: "corriendo", desde: ts, hasta: null, msg: msg ? cortar(msg, 160) : null };
  if (verdad(prev.desde) && prev.estado === "corriendo") fases[nombre].desde = prev.desde; // re-arranque: conserva el inicio
}

const tiene = (x: object, k: string) => Object.hasOwn(x, k);

/**
 * Devuelve SOLO los cambios de estado que produce `ev` (objeto vacío si es ruido). Misma semántica
 * que `reduce_event` de events.py (ver su docstring): `fase_index` nunca retrocede, las auxiliares
 * conservan el índice, "omitido: …" no mueve fase_actual, `final` cierra todo (o lo deja en error si
 * el orquestador abortó), `error` tumba la fase o rama, un `warn` de reintento la reabre.
 */
export function reducirEvento(state: Estado, ev: Evento, ts: string): Estado {
  const kind = ev.kind;
  if (typeof kind !== "string" || !VISIBLES.has(kind)) return {};
  const out: Estado = {};
  const fases: Fases = {};
  for (const [k, v] of Object.entries((o(state.fases, {}) as Fases))) fases[k] = { ...v };
  let fasesCambiaron = false;

  if (kind === "phase") {
    const raw = str(o(ev.name, ""));
    const name = canonico(raw);
    const msg = str(o(ev.msg, ""));
    if (msg.startsWith("omitido")) {
      if (RASTREADAS.has(name)) {
        const i = msg.indexOf(":");
        const motivo = i >= 0 ? strip(msg.slice(i + 1)) : "no aplica";
        fases[name] = { estado: "omitido", desde: ts, hasta: ts, motivo: cortar(motivo, 160) };
        fasesCambiaron = true;
      }
      if (state.fase_index !== undefined && state.fase_index !== null) out.fase_index = state.fase_index;
    } else {
      out.fase_actual = name;
      if (FASES.includes(name)) {
        out.fase_index = Math.max(Math.trunc(Number(o(state.fase_index, 0))), FASES.indexOf(name));
      } else if (state.fase_index !== undefined && state.fase_index !== null) {
        out.fase_index = state.fase_index; // fase auxiliar: el progreso se mantiene
      }
      if (name === "dag") out.dag = true;
      else if (name === "dag_join") out.dag = false;
      const enDag = tiene(out, "dag") ? out.dag : tiene(state, "dag") ? state.dag : false;
      // cierre de las predecesoras
      if (tiene(CIERRA, name)) fasesCambiaron = cerrar(fases, CIERRA[name], ts) || fasesCambiaron;
      if (!verdad(enDag) && tiene(ORDEN, name)) {
        const previas = Object.keys(fases).filter((n) => orden(n) < ORDEN[name]);
        fasesCambiaron = cerrar(fases, previas, ts) || fasesCambiaron;
      }
      // arranque
      if (RASTREADAS.has(name)) {
        arrancar(fases, name, ts, msg);
        fasesCambiaron = true;
      }
      if (raw === "research_parallel" || (RASTREADAS.has(name) && msg.includes("∥"))) {
        // "investigación paralela: web_research ∥ news_research ∥ entity_personnel": arrancan juntas
        // (también al re-reducir eventos ya guardados, donde el nombre viene canónico).
        const extras = nombresEnMsg(msg);
        for (const extra of extras.length ? extras : ["news_research", "entity_personnel"]) {
          if (extra !== name && RASTREADAS.has(extra)) {
            arrancar(fases, extra, ts, null);
            fasesCambiaron = true;
          }
        }
      }
    }
  } else if (kind === "final") {
    out.terminado = true;
    const abortado = motivoAborto(ev);
    if (abortado) {
      // El orquestador cerró el stream pero NO analizó (p. ej. fuente OECE caída): el dispatcher
      // lo re-encola sin gastar intento.
      out.abortado = abortado;
      out.error = cortar(`análisis abortado por el orquestador: ${abortado}`, 500);
      fasesCambiaron = cerrar(fases, Object.keys(fases), ts, "error", cortar(`abortado: ${abortado}`, 160)) || fasesCambiaron;
    } else {
      out.fase_actual = "final";
      out.fase_index = FASES.length;
      fasesCambiaron = cerrar(fases, Object.keys(fases), ts) || fasesCambiaron;
    }
  } else if (kind === "error") {
    const detalle = cortar(str(o(o(ev.detail, ev.msg), "error")), 500);
    out.error = detalle;
    const objetivo = verdad(ev.name) ? canonico(ev.name) : "";
    const agente = canonico(ev.agent ?? null);
    let afectadas: readonly string[] = [];
    if (tiene(RAMA_FASES, objetivo) && agente === "pipeline") afectadas = RAMA_FASES[objetivo];
    else if (RASTREADAS.has(objetivo)) afectadas = [objetivo];
    else if (RASTREADAS.has(agente)) afectadas = [agente];
    if (afectadas.length) fasesCambiaron = cerrar(fases, afectadas, ts, "error", cortar(detalle, 160)) || fasesCambiaron;
  } else if (kind === "warn") {
    const name = canonico(o(ev.name, ev.agent ?? null));
    const msg = str(o(ev.msg, ""));
    if (RASTREADAS.has(name) && msg.toLowerCase().includes("reintento")) {
      const f = tiene(fases, name) ? fases[name] : undefined;
      if (msg.toLowerCase().includes("tras reintento")) {
        // segunda pasada también vacía: la fase termina con un default tipado (sin datos)
        fasesCambiaron = cerrar(fases, [name], ts, "hecho", "sin resultados (default tipado)") || fasesCambiaron;
      } else if (verdad(f) && f!.estado !== "corriendo") {
        Object.assign(f!, { estado: "corriendo", hasta: null, motivo: null });
        fasesCambiaron = true;
      }
    }
  }

  if (fasesCambiaron) {
    out.fases = fases;
    out.fases_completadas = completadas(fases);
  }
  return out;
}

/**
 * Entrada de la bitácora `procesamientos.eventos` (`_evento` de main.py): nombre canónico, o el
 * `fase_actual` resultante para un `phase` que no fue omitido; msg recortado a 200.
 */
export function entradaBitacora(ev: Evento, cambios: Estado, ts: string): Record<string, unknown> {
  const vivo = ev.kind === "phase" && !str(o(ev.msg, "")).startsWith("omitido");
  return {
    ts,
    kind: ev.kind ?? null,
    name: o(o(vivo ? cambios.fase_actual ?? null : null, canonico(o(ev.name, ev.agent ?? null))), null),
    msg: o(cortar(str(o(o(ev.msg, ev.detail), "")), 200), null),
  };
}
