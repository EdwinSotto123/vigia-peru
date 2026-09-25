/**
 * La traza de un análisis, leída como un recorrido: qué nodos hubo, qué recibió cada uno, qué
 * hizo y qué entregó. Puro (sin React ni "use client"): lo usan el modo Grafo, el modo Texto y
 * el costo por agente.
 *
 * De dónde sale cada cosa, sin inventar nada:
 *  · Los nodos y las flechas son el DAG real de `backend/agent/deterministic.py` (el mismo que
 *    traduce `CIERRA` en lib/auditoria): tres ramas desde el registro del proceso —reglas,
 *    expediente y proveedor—, que se juntan en la red de personas; después, la síntesis.
 *  · Qué pasó en cada nodo sale de `agent_trace`, evento por evento. Cada evento trae `agent`,
 *    `kind` y, según el tipo: `name`+`args` (llamada), `name`+`result_preview` (respuesta),
 *    `to`+`msg` (delegación), `n_llm_calls`/`tokens_*`/`cost_usd` (métricas), `evaluador`…
 *    (control de calidad). La traza NO guarda marcas de tiempo ni el mensaje que el
 *    coordinador le escribe a cada agente del pipeline determinista: eso se dice, no se suple.
 *  · Los pasos que corre el propio coordinador (agent "pipeline") se asignan al nodo que
 *    preparan o cierran según `backend/agent/pipeline_phases.py` (p. ej. `query_rnp_empresa`
 *    prepara la red de personas; `persist_doc_flags_as_banderas` guarda lo del análisis legal).
 *  · Las métricas son un contador acumulado: el consumo de un agente es la diferencia con el
 *    evento de métricas anterior (el backend suma cada sub-corrida al terminar).
 */

import { claveDePaso, pasoDeClave, TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { humanizar } from "@/lib/auditoria";
import type { AgentTraceEvent, ApiResult } from "../types";

// ─── Tipos ───────────────────────────────────────────────────────────────

/** `agente` corre un modelo de IA; `codigo` es un paso del coordinador (sin IA); `control` son los evaluadores. */
export type TipoNodo = "agente" | "codigo" | "control";
export type EstadoNodo = "corrio" | "fallo" | "omitido" | "sin_rastro";
export type Rama = "inicio" | "reglas" | "expediente" | "proveedor" | "sintesis" | "control";

/** Una llamada a una herramienta con su respuesta emparejada. */
export interface Paso {
  /** Índice del `tool_call` en la traza. */
  i: number;
  nombre: string;
  args: Record<string, unknown> | null;
  /** `result_preview` tal cual; `undefined` si la traza no guardó respuesta. */
  resultado: unknown;
  hayResultado: boolean;
  /** Lo corrió el coordinador (código), no el agente. */
  porCoordinador: boolean;
  /** El texto de `resultado.error`, si la herramienta falló. */
  error: string | null;
}

export interface Consumo {
  llamadas: number;
  tokens: number;
  entrada: number;
  salida: number;
  costo: number;
}

export interface Aviso {
  tipo: "info" | "aviso" | "error" | "omitido" | "razonamiento";
  texto: string;
  /** El texto crudo del backend, para quien quiera verlo (plegado). */
  detalle?: string | null;
}

export interface Delegacion {
  i: number;
  /** "en paralelo", "lote determinista", según el `msg` del evento. */
  nota: string | null;
  /** Claves de los nodos delegados en el mismo instante (eventos `transfer` contiguos). */
  junto: string[];
  /** Orquestador viejo: la instrucción que le escribió (`args.request`). */
  instruccion: string | null;
  /** Orquestador viejo: lo que respondió el agente (`result_preview`). */
  respuesta: unknown;
}

export interface NodoTraza {
  clave: string;
  nombre: string;
  titulo: string;
  que: string;
  tipo: TipoNodo;
  rama: Rama;
  estado: EstadoNodo;
  delegacion: Delegacion | null;
  /** Lo que el coordinador preparó antes de llamarlo. */
  antes: Paso[];
  /** Lo que hizo el nodo (sus herramientas; en un nodo de código, las del coordinador). */
  pasos: Paso[];
  /** Lo que el coordinador hizo con su resultado, después. */
  despues: Paso[];
  consumo: Consumo | null;
  avisos: Aviso[];
  /** Nodos de los que depende (DAG). */
  entra: string[];
  /** Nodos que dependen de él. */
  sale: string[];
  /** Primer evento suyo en la traza: da el orden real. */
  primerIndice: number | null;
}

export interface EvaluacionTraza {
  evaluador: string;
  pregunta: string | null;
  metodo: string | null;
  objetivo: string | null;
  n: number | null;
  ok: number | null;
  pct: number | null;
  label: string | null;
  reason: string | null;
  faltantes: string[];
  porItem: Record<string, unknown>[];
}

export interface Recorrido {
  nodos: NodoTraza[];
  porClave: Record<string, NodoTraza>;
  evaluaciones: EvaluacionTraza[];
  /** Cuántos agentes de IA dejaron rastro, de cuántos tiene el pipeline. */
  agentesCorrieron: number;
  totalAgentes: number;
  /** Llamadas a herramientas (sin contar las delegaciones del orquestador viejo). */
  consultas: number;
  /** Llamadas cuya respuesta trae un error. */
  consultasFallidas: number;
  eventos: number;
  /** Señales tal como las recibió el dictamen (con el agente que las anotó), si la traza las guarda. */
  senalesDictamen: { regla: string; severidad: string; agente: string | null }[] | null;
  /**
   * Qué corrió en paralelo según la traza (delegaciones en el mismo instante o marcadas
   * "paralelo"). Un análisis viejo, o uno con el DAG apagado, corrió en secuencia: ahí no se
   * dice "a la vez".
   */
  paralelo: { ramas: boolean; expediente: boolean; proveedor: boolean };
}

// ─── Estructura: el DAG ──────────────────────────────────────────────────

interface Estructura {
  clave: string;
  tipo: TipoNodo;
  rama: Rama;
  /** Sólo para los nodos del coordinador, que no están en el catálogo de agentes. */
  nombre?: string;
  titulo?: string;
  que?: string;
}

/** Los nodos en el orden del DAG. Los del catálogo toman nombre y descripción de ahí. */
export const ESTRUCTURA: Estructura[] = [
  {
    clave: "ocds",
    tipo: "codigo",
    rama: "inicio",
    nombre: "Registro del proceso",
    titulo: "Registro público del proceso",
    que: "El coordinador trae el registro oficial del proceso desde el OECE y lo guarda para todos los pasos que siguen.",
  },
  { clave: "compliance", tipo: "agente", rama: "reglas" },
  { clave: "document_parser", tipo: "agente", rama: "expediente" },
  { clave: "document_legal_analyst", tipo: "agente", rama: "expediente" },
  { clave: "market", tipo: "agente", rama: "expediente" },
  { clave: "proveedor", tipo: "codigo", rama: "proveedor", nombre: "Perfil del proveedor" },
  { clave: "web_research", tipo: "agente", rama: "proveedor" },
  { clave: "news_research", tipo: "agente", rama: "proveedor" },
  { clave: "entity_personnel", tipo: "agente", rama: "proveedor" },
  { clave: "person_network", tipo: "agente", rama: "sintesis" },
  { clave: "compliance_extended", tipo: "agente", rama: "sintesis" },
  {
    clave: "senales",
    tipo: "codigo",
    rama: "sintesis",
    nombre: "Guardado de señales",
    titulo: "Cruce normativo y guardado de señales",
    que: "El coordinador cruza las señales acumuladas con las opiniones del OECE, las guarda en la alerta y guarda el avance.",
  },
  { clave: "report_writer", tipo: "agente", rama: "sintesis" },
  {
    clave: "cierre",
    tipo: "codigo",
    rama: "sintesis",
    nombre: "Guardado final",
    titulo: "Guardado del análisis",
    que: "El coordinador guarda el análisis completo, con el dictamen, antes del control de calidad.",
  },
  { clave: "self_eval", tipo: "control", rama: "control" },
];

/** De qué nodos depende cada uno (backend/agent/deterministic.py, `CIERRA` en lib/auditoria). */
export const ENTRA: Record<string, string[]> = {
  compliance: ["ocds"],
  document_parser: ["ocds"],
  proveedor: ["ocds"],
  document_legal_analyst: ["document_parser"],
  market: ["document_parser"],
  web_research: ["proveedor"],
  news_research: ["proveedor"],
  entity_personnel: ["proveedor"],
  person_network: ["compliance", "document_legal_analyst", "market", "web_research", "news_research", "entity_personnel"],
  compliance_extended: ["person_network"],
  senales: ["compliance_extended"],
  report_writer: ["senales"],
  cierre: ["report_writer"],
  self_eval: ["cierre"],
};

/** Los grupos que corren a la vez dentro de una rama (mismo paso del DAG). */
export type GrupoParalelo = "expediente" | "proveedor";
export const GRUPOS_PARALELOS: Record<GrupoParalelo, string[]> = {
  expediente: ["document_legal_analyst", "market"],
  proveedor: ["web_research", "news_research", "entity_personnel"],
};

/** La cadena de la síntesis, en orden. */
export const SINTESIS = ["person_network", "compliance_extended", "senales", "report_writer", "cierre", "self_eval"];

// ─── Qué paso del coordinador va a qué nodo (backend/agent/pipeline_phases.py) ──

const HERRAMIENTA_A_NODO: Record<string, string> = {
  fetch_ocds_record: "ocds",
  register_convocatoria_in_db: "ocds",
  get_ganador: "proveedor",
  query_oece_perfil: "proveedor",
  query_sunat_decolecta: "proveedor",
  query_edad_ciiu_web: "proveedor",
  read_sunat_profile: "proveedor",
  list_documents: "document_parser",
  parse_document_pdf: "document_parser",
  persist_doc_flags_as_banderas: "document_legal_analyst",
  build_market_input: "market",
  list_items_for_pricing: "market",
  read_market_input: "market",
  analyze_market_sharded: "market",
  analizar_mercado: "market",
  persist_market_flags_as_banderas: "market",
  query_rnp_empresa: "person_network",
  query_rnp_persona: "person_network",
  detect_puerta_giratoria: "person_network",
  detect_aporte_a_partido_del_alcalde: "person_network",
  read_person_network_context: "person_network",
  evaluate_normative_compliance: "senales",
  persist_alert_from_flags: "senales",
};

/** Herramientas que LEEN lo que dejaron otros pasos: son la entrada del agente, no su trabajo. */
export const esHerramientaDeEntrada = (nombre: string) =>
  /^read_/.test(nombre) || /^get_\w*context$/.test(nombre) || nombre === "get_alerta_full_context";

// ─── Construcción ────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function nodoVacio(e: Estructura): NodoTraza {
  const paso = pasoDeClave(e.clave);
  return {
    clave: e.clave,
    nombre: e.nombre ?? paso?.nombre ?? e.clave,
    titulo: e.titulo ?? paso?.titulo ?? e.nombre ?? e.clave,
    que: e.que ?? paso?.que ?? "",
    tipo: e.tipo,
    rama: e.rama,
    estado: "sin_rastro",
    delegacion: null,
    antes: [],
    pasos: [],
    despues: [],
    consumo: null,
    avisos: [],
    entra: ENTRA[e.clave] ?? [],
    sale: Object.entries(ENTRA)
      .filter(([, de]) => de.includes(e.clave))
      .map(([k]) => k),
    primerIndice: null,
  };
}

/** Clave del nodo de un agente de la traza ("market_price_agent" → "market"); null si es el coordinador u otro. */
function claveDeAgente(nombre: unknown): string | null {
  if (typeof nombre !== "string" || !nombre) return null;
  const k = claveDePaso(nombre);
  return k && ESTRUCTURA.some((e) => e.clave === k) ? k : null;
}

/** ¿Una llamada del orquestador viejo a un sub-agente como herramienta? (`name` = "compliance_agent"). */
function delegacionComoHerramienta(ev: AgentTraceEvent): string | null {
  if (ev.kind !== "tool_call" || typeof ev.name !== "string" || !/_agent$/.test(ev.name)) return null;
  const k = claveDeAgente(ev.name);
  return k && pasoDeClave(k)?.tipo === "agente" ? k : null;
}

function notaDeDelegacion(msg: unknown): string | null {
  const m = typeof msg === "string" ? msg : "";
  if (/paralelo/i.test(m)) return "en paralelo";
  if (/lote determinista/i.test(m)) return "lote determinista";
  return null;
}

export function construirRecorrido(result: ApiResult): Recorrido {
  const trace = (result.agent_trace || []) as (AgentTraceEvent & Record<string, any>)[];
  const nodos = ESTRUCTURA.map(nodoVacio);
  const porClave: Record<string, NodoTraza> = Object.fromEntries(nodos.map((n) => [n.clave, n]));
  const tocar = (n: NodoTraza, i: number) => {
    if (n.primerIndice == null || i < n.primerIndice) n.primerIndice = i;
    if (n.estado === "sin_rastro") n.estado = "corrio";
  };

  // 1. Emparejar cada respuesta con su llamada (FIFO por agente + herramienta: las ramas en
  //    paralelo intercalan eventos, pero cada rama responde en orden).
  const pendientes = new Map<string, number[]>();
  const respuestaDe = new Map<number, number>();
  trace.forEach((ev, i) => {
    const k = `${ev.agent ?? ""}|${ev.name ?? ""}`;
    if (ev.kind === "tool_call") {
      const cola = pendientes.get(k) ?? [];
      cola.push(i);
      pendientes.set(k, cola);
    } else if (ev.kind === "tool_result") {
      const cola = pendientes.get(k);
      const llamada = cola?.shift();
      if (llamada != null) respuestaDe.set(llamada, i);
    }
  });

  // 2. Delegaciones primero: definen qué es "antes" y qué es "después" de cada agente.
  trace.forEach((ev, i) => {
    let clave: string | null = null;
    let instruccion: string | null = null;
    let respuesta: unknown;
    if (ev.kind === "transfer") clave = claveDeAgente(ev.to);
    else {
      clave = delegacionComoHerramienta(ev);
      if (clave) {
        instruccion = texto((ev.args as any)?.request);
        const r = respuestaDe.get(i);
        respuesta = r != null ? trace[r]?.result_preview : undefined;
      }
    }
    if (!clave || porClave[clave].delegacion) return;
    porClave[clave].delegacion = { i, nota: notaDeDelegacion(ev.msg), junto: [], instruccion, respuesta };
    tocar(porClave[clave], i);
  });
  // "Junto con": transfers contiguos (sin otro evento entre ellos) salieron en el mismo instante.
  const transfers = trace.map((ev, i) => (ev.kind === "transfer" ? i : -1)).filter((i) => i >= 0);
  let bloque: number[] = [];
  const cerrarBloque = () => {
    const claves = bloque.map((i) => claveDeAgente(trace[i].to)).filter((k): k is string => !!k);
    if (claves.length > 1) for (const k of claves) if (porClave[k].delegacion) porClave[k].delegacion!.junto = claves.filter((x) => x !== k);
    bloque = [];
  };
  for (const i of transfers) {
    if (bloque.length && i !== bloque[bloque.length - 1] + 1) cerrarBloque();
    bloque.push(i);
  }
  cerrarBloque();

  // 3. Llamadas a herramientas.
  let despuesDelDictamen = false;
  let ultimoNodo = "ocds";
  let consultas = 0;
  let consultasFallidas = 0;
  trace.forEach((ev, i) => {
    if (ev.kind === "transfer" && claveDeAgente(ev.to) === "report_writer") despuesDelDictamen = true;
    if (ev.kind !== "tool_call" || typeof ev.name !== "string") return;
    if (delegacionComoHerramienta(ev)) {
      if (delegacionComoHerramienta(ev) === "report_writer") despuesDelDictamen = true;
      return;
    }
    const r = respuestaDe.get(i);
    const resultado = r != null ? trace[r]?.result_preview : undefined;
    const error = esObjeto(resultado) ? texto(resultado.error) : null;
    consultas++;
    if (error) consultasFallidas++;

    const deAgente = claveDeAgente(ev.agent);
    const porCoordinador = !deAgente;
    let destino: string;
    if (deAgente) destino = deAgente;
    else if (ev.name === "persist_analysis_outputs") destino = despuesDelDictamen ? "cierre" : "senales";
    else if (ev.name === "batch_person_lookup") {
      const resumen = esObjeto(resultado) && Array.isArray(resultado.resumen) ? (resultado.resumen as any[]) : [];
      destino = resumen.length > 0 && resumen.every((p) => /^func_/.test(String(p?.id ?? ""))) ? "entity_personnel" : "person_network";
    } else destino = HERRAMIENTA_A_NODO[ev.name] ?? (despuesDelDictamen ? "cierre" : ultimoNodo);

    const n = porClave[destino];
    const paso: Paso = {
      i,
      nombre: ev.name,
      args: esObjeto(ev.args) ? (ev.args as Record<string, unknown>) : null,
      resultado,
      hayResultado: r != null,
      porCoordinador,
      error,
    };
    if (!porCoordinador || n.tipo !== "agente") n.pasos.push(paso);
    else if (!n.delegacion || i < n.delegacion.i) n.antes.push(paso);
    else n.despues.push(paso);
    tocar(n, i);
    ultimoNodo = destino;
  });

  // 4. Consumo: diferencia con el evento de métricas anterior.
  let previo = { llamadas: 0, tokens: 0, entrada: 0, salida: 0, costo: 0 };
  trace.forEach((ev) => {
    if (ev.kind !== ("metrics" as any)) return;
    const actual = {
      llamadas: num(ev.n_llm_calls),
      tokens: num(ev.tokens_total),
      entrada: num(ev.tokens_prompt),
      salida: num(ev.tokens_output),
      costo: num(ev.cost_usd),
    };
    const k = claveDeAgente(ev.agent);
    if (k) {
      const n = porClave[k];
      const c = n.consumo ?? { llamadas: 0, tokens: 0, entrada: 0, salida: 0, costo: 0 };
      c.llamadas += Math.max(0, actual.llamadas - previo.llamadas);
      c.tokens += Math.max(0, actual.tokens - previo.tokens);
      c.entrada += Math.max(0, actual.entrada - previo.entrada);
      c.salida += Math.max(0, actual.salida - previo.salida);
      c.costo += Math.max(0, actual.costo - previo.costo);
      n.consumo = c;
      if (n.estado === "sin_rastro") n.estado = "corrio";
    }
    previo = actual;
  });

  // 5. Avisos, errores, pasos omitidos y razonamientos.
  trace.forEach((ev, i) => {
    const kind = ev.kind as string;
    if (!["info", "warn", "error", "phase", "thought"].includes(kind)) return;
    // Los avisos del coordinador sin nodo propio (p. ej. "rama proveedor: …") no se pierden: van
    // al nodo que nombran; si no nombran ninguno, no hay dónde ponerlos con certeza.
    const k = claveDeAgente(ev.agent) ?? claveDeAgente(ev.name);
    if (!k) return;
    const n = porClave[k];
    const msg = texto(ev.msg) ?? texto(ev.detail);
    if (kind === "phase") {
      if (!msg || !/^omitido/i.test(msg)) return;
      n.estado = "omitido";
      n.avisos.push({ tipo: "omitido", texto: humanizar({ kind: "phase", name: k, msg }), detalle: msg });
      return;
    }
    if (kind === "thought") {
      if (texto(ev.text)) n.avisos.push({ tipo: "razonamiento", texto: String(ev.text) });
      tocar(n, i);
      return;
    }
    if (kind === "info") {
      if (msg) n.avisos.push({ tipo: "info", texto: infoHumana(msg), detalle: msg });
      tocar(n, i);
      return;
    }
    n.avisos.push({
      tipo: kind === "error" ? "error" : "aviso",
      texto: humanizar({ kind: kind === "error" ? "error" : "warn", name: k, msg: msg ?? "" }),
      detalle: msg,
    });
    tocar(n, i);
    if (kind === "error") n.estado = "fallo";
  });

  // 6. Control de calidad.
  const evaluaciones: EvaluacionTraza[] = trace
    .filter((ev) => (ev.kind as string) === "eval" && typeof ev.evaluador === "string")
    .map((ev) => ({
      evaluador: String(ev.evaluador),
      pregunta: texto(ev.pregunta),
      metodo: texto(ev.metodo),
      objetivo: texto(ev.objetivo),
      n: typeof ev.n === "number" ? ev.n : null,
      ok: typeof ev.ok === "number" ? ev.ok : null,
      pct: typeof ev.pct === "number" ? ev.pct : null,
      label: texto(ev.label),
      reason: texto(ev.reason),
      faltantes: Array.isArray(ev.faltantes) ? ev.faltantes.map(String) : [],
      porItem: Array.isArray(ev.per_item) ? ev.per_item.filter(esObjeto) : [],
    }));
  if (evaluaciones.length) {
    const n = porClave.self_eval;
    n.estado = "corrio";
    n.primerIndice = trace.findIndex((ev) => (ev.kind as string) === "eval");
  }

  // Las señales con el agente que las anotó, tal como las recibió el dictamen.
  let senalesDictamen: Recorrido["senalesDictamen"] = null;
  const escritor = porClave.report_writer;
  for (const p of [...escritor.antes, ...escritor.pasos]) {
    const b = esObjeto(p.resultado) ? p.resultado.banderas : null;
    if (!Array.isArray(b)) continue;
    senalesDictamen = b.filter(esObjeto).map((x) => ({
      regla: String(x.regla ?? "sin_regla"),
      severidad: String(x.severidad ?? "baja"),
      agente: claveDeAgente(x.agente_origen),
    }));
  }

  const junto = (a: string, b: string) => !!porClave[a].delegacion?.junto.includes(b);
  const paralelo = {
    ramas: junto("compliance", "document_parser"),
    expediente: junto("document_legal_analyst", "market"),
    proveedor: porClave.web_research.delegacion?.nota === "en paralelo" || junto("web_research", "news_research"),
  };

  const agentesCorrieron = nodos.filter((n) => n.tipo === "agente" && (n.estado === "corrio" || n.estado === "fallo")).length;
  return {
    nodos,
    porClave,
    evaluaciones,
    agentesCorrieron,
    totalAgentes: TOTAL_AGENTES,
    consultas,
    consultasFallidas,
    eventos: trace.length,
    senalesDictamen,
    paralelo,
  };
}

/** Los avisos informativos del driver que tienen lectura propia; el resto va tal cual. */
function infoHumana(msg: string): string {
  const m = /lote determinista:\s*(\d+) documento\(s\) con texto,\s*(\d+) ítem\(s\);\s*sin agente LLM/i.exec(msg);
  if (m) {
    const docs = Number(m[1]);
    const items = Number(m[2]);
    return `Lo resolvió el código, sin agente de IA: ${docs} ${docs === 1 ? "documento" : "documentos"} con texto y ${items} ${items === 1 ? "ítem" : "ítems"}`;
  }
  return msg;
}

/** Los nodos que no son la cabeza de su rama: aparecen dentro de un grupo paralelo. */
export const EN_GRUPO = new Set(Object.values(GRUPOS_PARALELOS).flat());
