/**
 * Clasificación tipo × etapa de un proceso SEACE y agentes que le aplican: port de
 * backend/core/clasificacion.py (la matriz y los hechos medidos que definen las reglas están allí y en
 * docs/design/MATRIZ_TIPO_ETAPA.md). Mismas entradas → misma salida: lo prueba test/clasificacion.test.ts
 * contra vectores generados con la implementación de Python (scripts/vectores_py.py).
 */

import { contiene, dictDe, esDict, flotante, get, iterar, str, strip, sinMarcasNfkd, verdad } from "./py.ts";
import type { Dict } from "./py.ts";

export const TIPOS = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro"] as const;
export const AGENTES = ["compliance", "document_parser", "document_legal_analyst", "market", "web_research",
  "news_research", "entity_personnel", "person_network", "compliance_extended", "report_writer"] as const;

const ETAPAS_POST_ADJUDICACION = ["adjudicada", "contratada", "en_ejecucion", "finalizada"];
const ETAPAS_CON_CONTRATO = ["contratada", "en_ejecucion", "finalizada"];
const ETAPAS_NEGATIVAS = ["desierta", "cancelada", "nula"];

const MOTIVO_TIPO_NO_SOPORTADO = "tipo_no_soportado";
const MOTIVO_ETAPA_DESCONOCIDA = "etapa_desconocida";
const MOTIVO_ETAPA_PLANIFICACION = "etapa_planificacion";

const DOCS_CLAVE = new Set(["biddingDocuments", "awardNotice", "contractSigned"]);

const ITEMS_CONTRATADO = new Set(["CONTRATADO"]);
const ITEMS_ADJUDICADO = new Set(["ADJUDICADO", "CONSENTIDO", "APELADO"]);
const ITEMS_NULO = new Set(["NULO"]);
const ITEMS_CANCELADO = new Set(["CANCELADO", "NO_SUSCRIPCION_CONTRATO POR_DECISION_ENTIDAD", "NO_SUSCRIPCION_CONTRATO_POR_DECISION_ENTIDAD"]);
const ITEMS_DESIERTO = new Set(["DESIERTO"]);
const ITEMS_NEGATIVOS = new Set([...ITEMS_NULO, ...ITEMS_CANCELADO, ...ITEMS_DESIERTO]);

export interface Clasificacion {
  tipo: string;
  etapa: string;
  modalidad: string | null;
  procesable: boolean;
  motivo_no_procesable: string | null;
  agentes: string[];
  validaciones_pendientes: string[];
  proveedor_ruc: string | null;
}

// ── Matriz tipo × etapa → agentes ───────────────────────────────────────────
function ordenar(agentes: Iterable<string>): string[] {
  const s = new Set(agentes);
  return AGENTES.filter((a) => s.has(a));
}

function construirMatriz(): Map<string, string[]> {
  const base = ["compliance", "document_parser", "document_legal_analyst", "market", "entity_personnel", "report_writer"];
  const investigacion = ["web_research", "news_research", "person_network", "compliance_extended"];
  const baseConvenio = ["compliance", "document_parser", "document_legal_analyst", "market", "report_writer"];
  const negativas = ["compliance", "report_writer"];
  const m = new Map<string, string[]>();
  for (const tipo of TIPOS) {
    if (tipo === "otro") continue;
    m.set(`${tipo}|planificacion`, []);
    for (const etapa of ETAPAS_NEGATIVAS) m.set(`${tipo}|${etapa}`, [...negativas]);
    if (["bienes", "servicios", "consultoria", "obras"].includes(tipo)) {
      m.set(`${tipo}|convocada`, ordenar(base));
      for (const etapa of ETAPAS_POST_ADJUDICACION) m.set(`${tipo}|${etapa}`, ordenar([...base, ...investigacion]));
    } else {
      m.set(`${tipo}|convocada`, ordenar(baseConvenio));
      m.set(`${tipo}|adjudicada`, ordenar([...baseConvenio, "person_network", "web_research", "news_research"]));
      for (const etapa of ETAPAS_CON_CONTRATO) m.set(`${tipo}|${etapa}`, [...AGENTES]);
    }
  }
  return m;
}

const MATRIZ = construirMatriz();

// ── Lectura del OCDS ────────────────────────────────────────────────────────
/** minúsculas sin tildes ('Regímen Especial' → 'regimen especial'). */
export function normTexto(s: unknown): string {
  return strip(sinMarcasNfkd(verdad(s) ? str(s) : "").toLowerCase());
}

/** 'PE-RUC-20508320664' → '20508320664'; acepta el RUC pelado. */
function rucDeId(ident: unknown): string | null {
  const m = /(\d{11})\n?$/.exec(verdad(ident) ? str(ident) : "");
  return m ? m[1] : null;
}

const dicts = (v: unknown): Dict[] => iterar(v).filter(esDict);

function parties(rel: Dict): Dict[] {
  return dicts(get(rel, "parties"));
}

function rucDeParty(p: Dict): string | null {
  for (const ai of iterar(get(p, "additionalIdentifiers"))) {
    if (esDict(ai) && get(ai, "scheme") === "PE-RUC" && rucDeId(get(ai, "id"))) return rucDeId(get(ai, "id"));
  }
  const ident = dictDe(get(p, "identifier"));
  if (get(ident, "scheme") === "PE-RUC" && rucDeId(get(ident, "id"))) return rucDeId(get(ident, "id"));
  return null;
}

/** RUC de la entidad contratante (parties con rol buyer/procuringEntity). */
export function entidadRuc(rel: Dict): string | null {
  for (const p of parties(rel)) {
    const roles = get(p, "roles");
    if (contiene(roles, "buyer") || contiene(roles, "procuringEntity")) {
      const r = rucDeParty(p);
      if (r) return r;
    }
  }
  return null;
}

/** Awards no fallidos (status null = activo en los records del OECE). */
function awardsActivos(rel: Dict): Dict[] {
  return dicts(get(rel, "awards")).filter((a) => !["unsuccessful", "cancelled"].includes(normTexto(verdad(get(a, "status")) ? get(a, "status") : "active")));
}

/** RUC del proveedor adjudicado: awards[].suppliers[].id o party con rol supplier. */
export function proveedorRuc(rel: Dict): string | null {
  for (const a of awardsActivos(rel)) {
    for (const s of iterar(get(a, "suppliers"))) {
      const r = esDict(s) ? rucDeId(get(s, "id")) : null;
      if (r) return r;
    }
  }
  for (const p of parties(rel)) {
    if (contiene(get(p, "roles"), "supplier")) {
      const r = rucDeParty(p);
      if (r) return r;
    }
  }
  return null;
}

function items(rel: Dict): Dict[] {
  return dicts(get(dictDe(get(rel, "tender")), "items"));
}

function itemsStatus(rel: Dict): Set<string> {
  const out = new Set<string>();
  for (const i of items(rel)) {
    const st = strip((verdad(get(i, "statusDetails")) ? str(get(i, "statusDetails")) : "").toUpperCase());
    if (st) out.add(st);
  }
  return out;
}

function implementacionActiva(c: Dict): boolean {
  const impl = get(c, "implementation");
  if (!esDict(impl)) return false;
  return verdad(get(impl, "transactions")) || verdad(get(impl, "milestones"));
}

/** Todos los documentos publicados (tender + awards + contracts). */
export function documentos(rel: Dict): Dict[] {
  const out = dicts(get(dictDe(get(rel, "tender")), "documents"));
  for (const grupo of ["awards", "contracts"]) {
    for (const x of iterar(get(rel, grupo))) {
      if (!esDict(x)) continue;
      out.push(...dicts(get(x, "documents")));
    }
  }
  return out;
}

function hayDocumentosClave(rel: Dict): boolean {
  return documentos(rel).some((d) => {
    const tipo = get(d, "documentType");
    return typeof tipo === "string" && DOCS_CLAVE.has(tipo) && verdad(get(d, "url"));
  });
}

/**
 * Ítem comparable en mercado: cantidad > 0, unidad, y bien físico (categoría goods o clasificación
 * CUBSO/UNSPSC de producto: segmento < 70).
 */
function itemFisico(item: Dict, categoria: string): boolean {
  const q = flotante(verdad(get(item, "quantity")) ? get(item, "quantity") : 0) ?? 0;
  if (q <= 0 || !verdad(get(dictDe(get(item, "unit")), "name"))) return false;
  if (categoria === "goods") return true;
  const ids: unknown[] = [get(dictDe(get(item, "classification")), "id")];
  for (const c of iterar(get(item, "additionalClassifications"))) ids.push(get(dictDe(c), "id"));
  for (const id of ids) {
    const cid = verdad(id) ? str(id) : "";
    const seg = Array.from(cid).slice(0, 2).join("");
    if (Array.from(cid).length >= 2 && /^\d\d$/.test(seg) && Number(seg) < 70) return true;
  }
  return false;
}

// ── Tipo y etapa ────────────────────────────────────────────────────────────
/**
 * `mainProcurementCategory` + `procurementMethodDetails` → tipo. La modalidad manda cuando cambia el
 * régimen (directa, convenio) o la naturaleza (consultoría).
 */
export function derivarTipo(rel: Dict): string {
  const tender = dictDe(get(rel, "tender"));
  const cat = normTexto(get(tender, "mainProcurementCategory"));
  const mod = normTexto(get(tender, "procurementMethodDetails"));
  const titulo = get(tender, "title");
  const descripcion = get(tender, "description");
  const texto = normTexto(`${verdad(titulo) ? str(titulo) : ""} ${verdad(descripcion) ? str(descripcion) : ""}`);
  if (mod.includes("contratacion directa")) return "directa";
  if (mod.startsWith("convenio") || mod.includes("regimen especial") || mod.includes("contratacion internacional")) return "convenio";
  if (mod.includes("consultoria") || texto.includes("consultoria de obra")) return "consultoria";
  return TIPO_POR_CATEGORIA.get(cat) ?? "otro";
}

const TIPO_POR_CATEGORIA = new Map([["goods", "bienes"], ["services", "servicios"], ["works", "obras"]]);

const interseca = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

/**
 * Etapa a partir de objetos del record (contracts/awards), tags del release y
 * `tender.items[].statusDetails`, en ese orden de confianza.
 */
export function derivarEtapa(rel: Dict, nulo = false): string {
  if (nulo) return "nula";
  const tender = dictDe(get(rel, "tender"));
  const tags = new Set(iterar(get(rel, "tag")).map((t) => str(t)));
  const contracts = dicts(get(rel, "contracts"));
  const awards = dicts(get(rel, "awards"));
  const status = normTexto(get(tender, "status"));
  const its = itemsStatus(rel);

  if (contracts.some((c) => normTexto(get(c, "status")) === "terminated")) return "finalizada";
  if (tags.has("implementation") || contracts.some(implementacionActiva)) return "en_ejecucion";
  if (contracts.length || tags.has("contract") || interseca(its, ITEMS_CONTRATADO)) return "contratada";
  if (awardsActivos(rel).length || tags.has("award") || interseca(its, ITEMS_ADJUDICADO)) return "adjudicada";
  if (status === "cancelled") return "cancelada";
  if (status === "unsuccessful" || (awards.length && !awardsActivos(rel).length)) return "desierta";
  if (its.size && [...its].every((x) => ITEMS_NEGATIVOS.has(x))) {
    // Todos los ítems terminaron sin adjudicar: nula > cancelada > desierta.
    if (interseca(its, ITEMS_NULO)) return "nula";
    if (interseca(its, ITEMS_CANCELADO)) return "cancelada";
    return "desierta";
  }
  if (tags.has("tender") || verdad(get(tender, "items")) || verdad(get(tender, "tenderPeriod")) || verdad(get(tender, "datePublished"))) {
    return "convocada";
  }
  if (tags.has("planning") || verdad(get(rel, "planning"))) return "planificacion";
  return "desconocida";
}

// ── Clasificación completa ──────────────────────────────────────────────────
/**
 * Release recortado o record completo → Clasificacion. `entidadRucHint`: RUC ya conocido de la
 * entidad (el release recortado no guarda `parties`). Nunca inventa: si a un agente le faltan datos,
 * se omite y queda en `validaciones_pendientes`.
 */
export function clasificar(releaseORecord: unknown, entidadRucHint: string | null = null, nulo = false): Clasificacion {
  const rel = esDict(releaseORecord) ? releaseORecord : {};
  const tender = dictDe(get(rel, "tender"));
  const tipo = derivarTipo(rel);
  const etapa = derivarEtapa(rel, nulo);
  const pmd = get(tender, "procurementMethodDetails");
  const modalidad = verdad(pmd) ? strip(str(pmd)) || null : null;
  const rucProv = proveedorRuc(rel);
  const rucEnt = entidadRuc(rel) || entidadRucHint;
  const sinProceso = (motivo: string): Clasificacion => ({
    tipo, etapa, modalidad, procesable: false, motivo_no_procesable: motivo, agentes: [], validaciones_pendientes: [], proveedor_ruc: rucProv,
  });

  if (tipo === "otro") return sinProceso(MOTIVO_TIPO_NO_SOPORTADO);
  if (etapa === "desconocida") return sinProceso(MOTIVO_ETAPA_DESCONOCIDA);
  if (etapa === "planificacion") return sinProceso(MOTIVO_ETAPA_PLANIFICACION);

  const agentes = [...(MATRIZ.get(`${tipo}|${etapa}`) ?? [])];
  const pendientes: string[] = [];
  const omitir = (agente: string, codigo: string) => {
    const i = agentes.indexOf(agente);
    if (i >= 0) {
      agentes.splice(i, 1);
      if (!pendientes.includes(codigo)) pendientes.push(codigo);
    }
  };

  if (agentes.includes("market") && tipo === "bienes") {
    const cat = normTexto(get(tender, "mainProcurementCategory"));
    if (!items(rel).some((i) => itemFisico(i, cat))) omitir("market", "market_sin_items_fisicos");
  }
  if (agentes.includes("document_parser") && !hayDocumentosClave(rel)) {
    omitir("document_parser", "sin_documentos_descargables");
    omitir("document_legal_analyst", "sin_documentos_descargables");
  }
  // El RUC del proveedor solo es verificable con el record completo (`awards` presente).
  if (Object.hasOwn(rel, "awards") && !rucProv) {
    for (const a of ["web_research", "news_research", "person_network", "compliance_extended"]) omitir(a, "proveedor_sin_ruc");
  }
  if (agentes.includes("entity_personnel") && !rucEnt) omitir("entity_personnel", "entidad_sin_ruc");
  if (tipo === "obras" && ETAPAS_CON_CONTRATO.includes(etapa)) pendientes.push("infobras_avance");

  return {
    tipo, etapa, modalidad, procesable: true, motivo_no_procesable: null, agentes: ordenar(agentes),
    validaciones_pendientes: pendientes, proveedor_ruc: rucProv,
  };
}
