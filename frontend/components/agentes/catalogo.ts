/**
 * Catálogo de la auditoría de agentes — fuente ÚNICA de "cuántos agentes hay y qué hace cada uno".
 *
 * El producto llegó a tener cinco recuentos distintos en páginas que el mismo usuario visita
 * seguidas ("11 agentes", "10 fases", "pipeline de 7 agentes", 13 nodos, 12 claves). Ninguno se
 * escribe más a mano: el conjunto y el orden salen de `CARRILES` + `FASES` de `lib/auditoria`,
 * que son la traducción del DAG real de `backend/agent/deterministic.py`. Si el backend agrega
 * un agente, aparece acá solo.
 *
 * Lo único que este archivo agrega al dato es la descripción en castellano de cada paso, tomada
 * de las descripciones que ya existían en `components/convocatoria/constants.tsx` (TOOL_INFO) y
 * de `humanizar()` en `lib/auditoria.ts`. Si un paso nuevo no tiene descripción, se cae a su
 * etiqueta larga: el catálogo nunca inventa una.
 */

import { CARRILES, FASES, canonico, faseLabel, faseLabelCorto } from "@/lib/auditoria";

/** `agente` = corre un modelo y emite señales. `paso` = consulta de datos o verificación del driver. */
export type TipoPaso = "agente" | "paso";

export interface PasoPipeline {
  /** Clave de fase tal como la escribe el dispatcher: "market", "document_parser", … */
  clave: string;
  /** Id del agente en la traza ADK ("market_price_agent"); null en los pasos que no son agentes. */
  id: string | null;
  carril: string;
  carrilLabel: string;
  /** Índice del paso dentro de su carril: los que comparten índice corrieron en paralelo. */
  paso: number;
  nombre: string;
  titulo: string;
  tipo: TipoPaso;
  /** Qué analiza, en una línea. */
  que: string;
  /**
   * Contra qué lo coteja, una fuente por entrada. Vacío cuando el repo no lo
   * declara: no se inventa una fuente.
   *
   * Es una lista, no un string unido por puntos medios. Pegar cuatro nombres de
   * portal con " · " obliga a leer el renglón entero para sacar uno solo, y deja
   * a la UI sin forma de dibujarlos como lo que son: fuentes distintas.
   */
  fuentes: string[];
}

const QUE: Record<string, string> = {
  compliance:
    "Evalúa las reglas de contratación sobre el registro público del proceso y abre la alerta.",
  document_parser:
    "Lee los documentos del expediente, incluso los escaneados, y extrae ítems, postores y especificaciones técnicas.",
  document_legal_analyst:
    "Analiza legalmente el requerimiento y emite señales citando la norma y la opinión OECE aplicable.",
  market:
    "Tasa cada ítem contra precios de mercado reales y calcula si hay sobreprecio.",
  proveedor:
    "Perfila al proveedor adjudicado: RUC, estado, antigüedad, sanciones e historial con el Estado.",
  web_research:
    "Investiga a la empresa ganadora en fuentes oficiales: sanciones, directivos e historial de contratos.",
  news_research:
    "Busca cobertura de prensa peruana sobre el proveedor, la entidad y el objeto contratado.",
  entity_personnel:
    "Identifica a los funcionarios designados de la entidad y el acto resolutivo que los nombra.",
  person_network:
    "Mapea la red de personas: socios, representantes, firmantes del acta y autoridades.",
  compliance_extended:
    "Corre los chequeos normativos extendidos y los cruces de patrón: puerta giratoria, aportes de campaña, concentración.",
  report_writer:
    "Redacta el dictamen con la evidencia consolidada y las citas normativas.",
  self_eval:
    "Antes de publicar, jueces de IA y comprobaciones en código revisan el análisis; si una de las que pueden frenarlo falla, la alerta queda en revisión humana.",
};

const FUENTE: Record<string, string[]> = {
  compliance: ["Registro público del proceso (OECE)", "SUNAT", "Sanciones del OECE"],
  document_parser: ["Documentos publicados en el SEACE"],
  document_legal_analyst: ["Opiniones jurídicas del OECE"],
  market: ["Búsqueda de precios en vivo"],
  proveedor: ["OECE", "SUNAT"],
  web_research: ["Portales oficiales", "Web abierta"],
  news_research: ["Prensa peruana"],
  entity_personnel: ["Autoridades y actos resolutivos de la entidad"],
  person_network: ["RNP", "ONPE", "JNE", "PEPs", "Registro de visitas"],
  compliance_extended: ["Reglas fijas de cada tipo de contrato", "Opiniones del OECE"],
  report_writer: ["Todo lo que encontraron los agentes anteriores"],
  self_eval: ["El propio análisis: 4 jueces de IA y 4 comprobaciones en código"],
};

/** Id del agente en la traza, cuando el paso es un agente del pipeline. */
const ID_POR_CLAVE: Record<string, string> = Object.fromEntries(FASES.map((f) => [f.key, f.agente]));

/** Los pasos del DAG, en el orden en que corren dentro de cada carril. Derivado, nunca escrito. */
export const PASOS: PasoPipeline[] = CARRILES.flatMap((c) =>
  c.pasos.flatMap((grupo, i) =>
    grupo.map((clave) => ({
      clave,
      id: ID_POR_CLAVE[clave] ?? null,
      carril: c.key,
      carrilLabel: c.label,
      paso: i,
      nombre: faseLabelCorto(clave),
      titulo: faseLabel(clave),
      tipo: (ID_POR_CLAVE[clave] ? "agente" : "paso") as TipoPaso,
      que: QUE[clave] ?? faseLabel(clave),
      fuentes: FUENTE[clave] ?? [],
    })),
  ),
);

export const TOTAL_PASOS = PASOS.length;
export const TOTAL_AGENTES = PASOS.filter((p) => p.tipo === "agente").length;
export const TOTAL_CARRILES = CARRILES.length;

const POR_CLAVE: Record<string, PasoPipeline> = Object.fromEntries(PASOS.map((p) => [p.clave, p]));

/** Nombre que llega del backend (clave de fase, id de agente o alias de la bitácora) → clave del catálogo. */
export function claveDePaso(nombre: string | null | undefined): string | null {
  const n = (nombre ?? "").trim();
  if (!n) return null;
  if (POR_CLAVE[n]) return n;
  for (const f of FASES) if (f.agente === n) return f.key;
  const c = canonico(n);
  if (POR_CLAVE[c]) return c;
  for (const f of FASES) if (f.agente === c || canonico(f.agente) === c) return f.key;
  return null;
}

export const pasoDeClave = (clave: string | null | undefined): PasoPipeline | null =>
  (clave && POR_CLAVE[clave]) || null;

/** Nombres con los que el driver se anuncia a sí mismo en la traza: no son agentes del DAG. */
const ORQUESTADOR = new Set(["orch", "orquestador", "pipeline", "root_agent", "vigia_orchestrator", "deterministic", "started"]);

export const esOrquestador = (nombre: string | null | undefined): boolean =>
  ORQUESTADOR.has((nombre ?? "").trim()) || ORQUESTADOR.has(canonico(nombre));

/** Nombre corto de cualquier cosa que venga del backend, resuelta contra el catálogo. */
export function nombreDeAgente(nombre: string | null | undefined): string {
  const p = pasoDeClave(claveDePaso(nombre));
  if (p) return p.nombre;
  if (esOrquestador(nombre)) return "Coordinador del análisis";
  const n = (nombre ?? "").trim();
  return n ? faseLabelCorto(canonico(n)) : "Sin agente declarado";
}

/**
 * Los pasos que APLICAN a un perfil (`ReglasPerfil.agentes`, que sale de
 * `backend/scripts/exportar_reglas.py`). Si el perfil no declara agentes, aplican todos:
 * es preferible mostrar el DAG completo a inventar un recorte.
 */
export function pasosDelPerfil(agentes: string[] | null | undefined): PasoPipeline[] {
  if (!agentes?.length) return PASOS;
  const set = new Set(agentes.map(claveDePaso).filter((k): k is string => !!k));
  if (!set.size) return PASOS;
  return PASOS.filter((p) => set.has(p.clave));
}

export interface CarrilPasos {
  key: string;
  label: string;
  pasos: PasoPipeline[];
}

/** Agrupa una lista de pasos por carril, conservando el orden del DAG y saltando carriles vacíos. */
export function porCarril(pasos: PasoPipeline[]): CarrilPasos[] {
  return CARRILES.map((c) => ({
    key: c.key,
    label: c.label,
    pasos: pasos.filter((p) => p.carril === c.key),
  })).filter((c) => c.pasos.length > 0);
}
