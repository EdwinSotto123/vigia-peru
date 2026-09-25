/**
 * Cada llamada de la traza en palabras: qué hizo (verbo en pasado), con qué datos y qué
 * devolvió. Puro: devuelve texto; la redacción de datos personales la hace quien lo pinta
 * (`TextoSeguro`), así ninguna línea sale sin pasar por ella.
 *
 * Sólo se dice lo que trae el evento. Si la traza no guardó la respuesta, se dice; si la
 * herramienta no tiene lectura propia acá, no se inventa un resumen: queda el dato crudo a un clic.
 */

import { reglaLabel } from "@/lib/auditoria";
import { numero, plural, soles } from "@/lib/formato";
import { TOOL_INFO } from "../constants";
import type { Paso } from "./modelo";

export interface Linea {
  texto: string;
  /** `hallazgo`: una regla disparó o algo se encontró; `error`: falló; `tenue`: dato secundario. */
  tono?: "neutro" | "hallazgo" | "error" | "tenue";
  /** Lista que se muestra plegada si es larga (búsquedas, documentos…). */
  lista?: string[];
  /** Texto largo del backend (instrucción, síntesis): va como cita. */
  cita?: boolean;
}

const esObjeto = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nro = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
/** "contrato_firmado" → "contrato firmado". */
export const legible = (v: unknown) => String(v ?? "").replace(/_/g, " ").trim();
/** "<list 6>" (el backend resume listas largas así en los argumentos) → 6. */
const tamanoLista = (v: unknown): number | null => {
  if (Array.isArray(v)) return v.length;
  const m = typeof v === "string" ? /^<list (\d+)>$/.exec(v) : null;
  return m ? Number(m[1]) : null;
};

export const ESTRATEGIA_MERCADO: Record<string, string> = {
  goods_retail: "precios de venta al público",
  historico_seace: "precios pagados antes por el Estado",
  presupuesto_obra: "presupuestos de obra",
  cotizaciones: "cotizaciones",
};

const VEREDICTO: Record<string, string> = {
  sin_dato: "sin veredicto por falta de precio comparable",
  elevado: "precios elevados frente al mercado",
  normal: "precios dentro del rango de mercado",
  razonable: "precios dentro del rango de mercado",
  bajo: "precios por debajo del mercado",
};

// ─── Qué hizo ────────────────────────────────────────────────────────────

const ACCION: Record<string, string> = {
  fetch_ocds_record: "Trajo el registro del proceso desde el OECE",
  register_convocatoria_in_db: "Guardó el proceso, sus ítems y postores en la base de Vigía",
  get_ganador: "Identificó al ganador, los postores y la entidad",
  query_oece_perfil: "Consultó el perfil del proveedor en el OECE",
  query_sunat_decolecta: "Consultó el RUC en la SUNAT",
  query_edad_ciiu_web: "Buscó en la web la antigüedad y el giro del RUC",
  read_sunat_profile: "Leyó la ficha SUNAT ya cargada",
  seleccionar_documentos: "Eligió qué documentos del expediente leer",
  parse_documentos_lote: "Leyó los documentos elegidos",
  parse_document_pdf: "Leyó un documento del expediente",
  list_documents: "Listó los documentos publicados del expediente",
  read_document_analysis: "Leyó lo extraído del expediente",
  query_legal_rag: "Buscó en las normas y criterios del OECE",
  lookup_opinion_oece: "Buscó opiniones del OECE por artículo",
  persist_doc_flags_as_banderas: "Guardó las señales del análisis legal",
  build_market_input: "Armó la lista de ítems a tasar",
  analyze_market_sharded: "Comparó cada ítem con precios de mercado",
  analizar_mercado: "Comparó cada ítem con precios de mercado",
  persist_market_flags_as_banderas: "Guardó las señales de sobreprecio",
  _detect_estado_real_persist: "Comparó la etapa del registro con la de los documentos",
  detect_estado_real: "Comparó la etapa del registro con la de los documentos",
  analyze_postores_pattern: "Buscó patrones entre los postores",
  persist_alert_from_flags: "Guardó las señales en la alerta",
  google_search: "Buscó en Google",
  batch_person_lookup: "Cruzó a las personas con las bases de Vigía (RNP, ONPE, JNE, PEP)",
  query_rnp_empresa: "Consultó socios y representantes en el RNP",
  read_person_network_context: "Leyó el contexto de la red de personas",
  detect_puerta_giratoria: "Buscó puerta giratoria entre la empresa y la entidad",
  detect_aporte_a_partido_del_alcalde: "Buscó aportes al partido que gobierna la entidad",
  evaluate_normative_compliance: "Cruzó las señales con las opiniones del OECE",
  persist_analysis_outputs: "Guardó el análisis",
  get_dictamen_context: "Reunió todo el análisis para redactar",
  add_contextual_flag: "Anotó una señal",
};

export function accionDe(p: Paso): string {
  const r = esObjeto(p.resultado) ? p.resultado : {};
  if (/^check_\w+_rule$/.test(p.nombre)) {
    const regla = txt(r.regla);
    return regla ? `Revisó la regla «${reglaLabel(regla)}»` : "Revisó una regla de contratación";
  }
  if (p.nombre === "add_contextual_flag" && txt(p.args?.regla)) return `Anotó la señal «${reglaLabel(String(p.args!.regla))}»`;
  if (ACCION[p.nombre]) return ACCION[p.nombre];
  // Sin verbo propio: la descripción del catálogo de herramientas, o el nombre en palabras.
  return TOOL_INFO[p.nombre] ?? legible(p.nombre).replace(/^\w/, (c) => c.toUpperCase());
}

/** Agrupa pasos repetidos ("Consultó el RNP" × 4) para las vistas compactas, en orden de aparición. */
export function agruparPasos(pasos: Paso[]): { accion: string; nombre: string; veces: number; fallidas: number }[] {
  const out: { accion: string; nombre: string; veces: number; fallidas: number }[] = [];
  for (const p of pasos) {
    const accion = accionDe(p);
    const previo = out.find((g) => g.accion === accion);
    if (previo) {
      previo.veces++;
      if (p.error) previo.fallidas++;
    } else out.push({ accion, nombre: p.nombre, veces: 1, fallidas: p.error ? 1 : 0 });
  }
  return out;
}

// ─── Con qué datos ───────────────────────────────────────────────────────

export function lineasDeArgs(p: Paso): Linea[] {
  const a: Record<string, any> = p.args ?? {};
  const out: Linea[] = [];
  const queries = arr(a.queries).map(String);
  if (queries.length) out.push({ texto: plural(queries.length, "búsqueda", "búsquedas"), lista: queries });
  if (txt(a.question)) out.push({ texto: `Preguntó: «${txt(a.question)}»` });
  if (txt(a.regimen)) out.push({ texto: `Régimen: Ley ${txt(a.regimen)}`, tono: "tenue" });
  if (p.nombre === "lookup_opinion_oece") {
    const art = txt(a.articulo_ley) ?? txt(a.articulo_reglamento);
    const norma = txt(a.norma);
    if (art || norma) out.push({ texto: [art ? `Artículo ${art}` : null, norma].filter(Boolean).join(" de la ") });
  }
  const ruc = txt(a.ruc) ?? txt(a.ruc_proveedor) ?? txt(a.entidad_contratante_ruc);
  if (ruc) out.push({ texto: `RUC ${ruc}${txt(a.razon_social) ? `, ${txt(a.razon_social)}` : ""}` });
  if (txt(a.dni_gerente)) out.push({ texto: `DNI ${txt(a.dni_gerente)}` });
  const personas = tamanoLista(a.personas);
  if (personas != null) out.push({ texto: plural(personas, "persona", "personas") });
  if (p.nombre === "seleccionar_documentos") {
    const prioridad = arr(a.prioridad).map(String);
    if (nro(a.max_docs) != null) out.push({ texto: `Hasta ${numero(a.max_docs)} documentos`, lista: prioridad.length ? prioridad : undefined });
  }
  if (p.nombre === "parse_documentos_lote" && nro(a.n_docs) != null) out.push({ texto: plural(a.n_docs, "documento", "documentos") });
  if (txt(a.estrategia)) out.push({ texto: `Contra ${ESTRATEGIA_MERCADO[a.estrategia] ?? legible(a.estrategia)}` });
  if (p.nombre === "fetch_ocds_record" && txt(a.ocid)) out.push({ texto: `Código del proceso ${txt(a.ocid)}` });
  if (p.nombre === "add_contextual_flag") {
    if (txt(a.severidad)) out.push({ texto: `Severidad ${legible(a.severidad)}`, tono: "tenue" });
    if (txt(a.evidencia)) out.push({ texto: String(a.evidencia), cita: true });
  }
  return out;
}

// ─── Qué devolvió ────────────────────────────────────────────────────────

/** Una regla (`check_*_rule`): si disparó, si no tenía datos, si no aplica. */
export function lecturaDeRegla(r: Record<string, any>): Linea {
  const motivo = txt(r.motivo);
  if (r.triggered === true) return { texto: `Disparó la señal${txt(r.evidencia) ? `: ${txt(r.evidencia)}` : ""}`, tono: "hallazgo" };
  if (r.omitida === true) return { texto: `No aplica${motivo ? `: ${motivo}` : ""}`, tono: "tenue" };
  if (r.estado === "sin_dato") return { texto: `Sin datos para evaluarla${motivo ? `: ${motivo}` : ""}`, tono: "tenue" };
  return { texto: `No disparó${motivo ? `: ${motivo}` : ""}` };
}

/** El dato que acompaña a cada regla cuando lo trae (cuántos postores, cuántos días…). */
function detalleDeRegla(nombre: string, r: Record<string, any>): string | null {
  switch (nombre) {
    case "check_unique_bidder_rule":
      if (nro(r.n_postores) == null) return null;
      return nro(r.pct_ganador_vs_referencial) != null
        ? `${plural(r.n_postores, "postor", "postores")}; el ganador ofertó el ${numero(r.pct_ganador_vs_referencial)} % del valor referencial`
        : plural(r.n_postores, "postor", "postores");
    case "check_plazo_convocatoria_rule":
      return nro(r.dias_habiles) != null && nro(r.dias_minimo_habiles) != null
        ? `${plural(r.dias_habiles, "día hábil", "días hábiles")} de plazo; el mínimo es ${numero(r.dias_minimo_habiles)}`
        : null;
    case "check_tipo_proceso_vs_monto_rule":
      return txt(r.tipo_proceso) && nro(r.cuantia_soles) != null ? `${r.tipo_proceso} por ${soles(r.cuantia_soles)}` : null;
    case "check_sanctioned_provider_rule":
      return nro(r.n_directas) != null ? `${plural(r.n_directas, "sanción directa", "sanciones directas")}, ${plural(nro(r.n_socios_sancionados) ?? 0, "socio sancionado", "socios sancionados")}` : null;
    case "check_lobby_visits_rule":
      return nro(r.n_visitas_total) != null ? plural(r.n_visitas_total, "visita registrada", "visitas registradas") : null;
    case "check_testaferro_multi_ruc_rule":
      return nro(r.n_personas_evaluadas) != null ? plural(r.n_personas_evaluadas, "persona evaluada", "personas evaluadas") : null;
    case "check_postor_unico_mayoritario_rule":
      return nro(r.n_items_un_solo_postor) != null && nro(r.n_items) != null ? `${numero(r.n_items_un_solo_postor)} de ${plural(r.n_items, "ítem", "ítems")} con un solo postor` : null;
    case "check_inconsistencia_doc_vs_ocds_rule":
      return r.coincide_objeto === true ? "El objeto de los documentos coincide con el registro" : r.coincide_objeto === false ? "El objeto de los documentos no coincide con el registro" : null;
    default:
      return null;
  }
}

export function lineasDeResultado(p: Paso): Linea[] {
  if (!p.hayResultado) return [{ texto: "La traza no guardó la respuesta de esta llamada.", tono: "tenue" }];
  if (p.error) return [{ texto: `Falló: ${p.error}`, tono: "error" }];
  const r = p.resultado;
  if (!esObjeto(r)) return typeof r === "string" && r.trim() ? [{ texto: r, cita: true }] : [];
  const out: Linea[] = [];
  const add = (texto: string | null | false | undefined, tono?: Linea["tono"], extra?: Partial<Linea>) => {
    if (texto) out.push({ texto, tono, ...extra });
  };

  if (/^check_\w+_rule$/.test(p.nombre)) {
    out.push(lecturaDeRegla(r));
    add(detalleDeRegla(p.nombre, r), "tenue");
    return out;
  }

  switch (p.nombre) {
    case "fetch_ocds_record":
      add(txt(r.objeto));
      add([nro(r.cuantia) != null ? `Valor ${soles(r.cuantia)}` : null, nro(r.n_items) != null ? plural(r.n_items, "ítem", "ítems") : null, nro(r.n_postores) != null ? plural(r.n_postores, "postor", "postores") : null, nro(r.n_documentos) != null ? plural(r.n_documentos, "documento", "documentos") : null].filter(Boolean).join(", "));
      add(txt(r.buyer_nombre) && `Entidad: ${r.buyer_nombre}`, "tenue");
      break;
    case "register_convocatoria_in_db":
      add(r.ok === true && `Quedaron ${[nro(r.n_docs) != null ? plural(r.n_docs, "documento", "documentos") : null, nro(r.n_items) != null ? plural(r.n_items, "ítem", "ítems") : null, nro(r.n_postores) != null ? plural(r.n_postores, "postor", "postores") : null].filter(Boolean).join(", ")}`);
      break;
    case "get_ganador": {
      const g = esObjeto(r.ganador) ? r.ganador : {};
      add(txt(g.razon_social) && `Ganó ${g.razon_social}${txt(g.ruc) ? `, RUC ${g.ruc}` : ""}`);
      add(esObjeto(r.entidad) && txt(r.entidad.nombre) && `Entidad: ${r.entidad.nombre}`, "tenue");
      add(nro(r.n_postores) != null && plural(r.n_postores, "postor en total", "postores en total"), "tenue");
      break;
    }
    case "query_oece_perfil": {
      const partes = [txt(r.estado) && legible(r.estado).toLowerCase(), txt(r.condicion) && legible(r.condicion).toLowerCase()].filter(Boolean);
      add(partes.length > 0 && `Estado: ${partes.join(", ")}`);
      const ns = nro(r.n_sanciones) ?? (Array.isArray(r.sanciones) ? r.sanciones.length : null);
      add(ns != null && (ns === 0 ? "Sin sanciones en el OECE" : `${plural(ns, "sanción", "sanciones")} en el OECE`), ns ? "hallazgo" : undefined);
      if (r.es_apto_contratar === false) add("No apto para contratar con el Estado", "hallazgo");
      const senales = arr(r.senales);
      add(senales.length > 0 && `${plural(senales.length, "señal", "señales")} del perfil OECE`, "hallazgo");
      break;
    }
    case "query_sunat_decolecta":
    case "read_sunat_profile": {
      const partes = [txt(r.estado) && legible(r.estado).toLowerCase(), txt(r.condicion) && legible(r.condicion).toLowerCase()].filter(Boolean);
      add(partes.length > 0 && `Estado: ${partes.join(", ")}`);
      add(nro(r.edad_dias) != null && `RUC con ${plural(Math.floor(r.edad_dias / 365), "año", "años")} de antigüedad`);
      add(txt(r.ciiu_principal) && `Giro: ${r.ciiu_principal}`, "tenue");
      break;
    }
    case "query_edad_ciiu_web":
      add(r.found === false ? `No encontró la ficha${txt(r.razon) ? `: ${r.razon}` : ""}` : r.found === true ? "Encontró la ficha del RUC" : null, r.found === false ? "tenue" : undefined);
      break;
    case "seleccionar_documentos": {
      const elegidos = arr(r.elegidos);
      add(`Eligió ${plural(elegidos.length, "documento", "documentos")}${nro(r.n_omitidos) ? ` y dejó ${numero(r.n_omitidos)} fuera` : ""}`, undefined, {
        lista: elegidos.map((d) => txt(d?.titulo) ?? "Sin título").filter(Boolean),
      });
      break;
    }
    case "parse_documentos_lote":
      add(nro(r.n_docs) != null && `Leyó ${numero(r.n_ok)} de ${plural(r.n_docs, "documento", "documentos")}${nro(r.n_error) ? `; ${numero(r.n_error)} con error` : ""}`);
      add([nro(r.n_paginas_total) != null ? plural(r.n_paginas_total, "página", "páginas") : null, nro(r.n_items_consolidados) != null ? plural(r.n_items_consolidados, "ítem", "ítems") : null, nro(r.n_firmantes) != null ? plural(r.n_firmantes, "firmante", "firmantes") : null, nro(r.n_postores) != null ? plural(r.n_postores, "postor", "postores") : null].filter(Boolean).join(", "));
      add(esObjeto(r.evidencia) && nro(r.evidencia.total) != null && `${numero(r.evidencia.verificadas)} de ${plural(r.evidencia.total, "citas verificadas contra el texto", "citas verificadas contra el texto")}`, "tenue");
      add(nro(r.segundos) != null && `Tardó ${numero(r.segundos)} s`, "tenue");
      break;
    case "parse_document_pdf":
      add([nro(r.n_pdfs_procesados) != null ? `${plural(r.n_pdfs_procesados, "PDF procesado", "PDF procesados")}` : null, nro(r.n_items_consolidados) != null ? plural(r.n_items_consolidados, "ítem", "ítems") : null, nro(r.n_firmantes) != null ? plural(r.n_firmantes, "firmante", "firmantes") : null].filter(Boolean).join(", "));
      break;
    case "list_documents":
      add(nro(r.n_documents) != null && plural(r.n_documents, "documento publicado", "documentos publicados"));
      break;
    case "query_legal_rag": {
      const n = nro(r.n_matches) ?? arr(r.matches).length;
      add(`${plural(n, "fragmento encontrado", "fragmentos encontrados")}${arr(r.corpus).length ? ` en ${arr(r.corpus).map(legible).join(" y ")}` : ""}`);
      break;
    }
    case "lookup_opinion_oece": {
      const ops = arr(r.opiniones);
      add(ops.length === 0 ? "Ninguna opinión del OECE para ese artículo" : plural(ops.length, "opinión del OECE", "opiniones del OECE"), undefined, {
        lista: ops.map((o) => [txt(o?.num_opinion) && `Opinión ${o.num_opinion}`, txt(o?.norma)].filter(Boolean).join(", ")).filter(Boolean),
      });
      break;
    }
    case "persist_doc_flags_as_banderas":
    case "persist_market_flags_as_banderas":
      if (r.skipped) add("Quedaron pendientes: la alerta todavía no existía", "tenue");
      else add(nro(r.persistidas) != null && (r.persistidas === 0 ? "Sin señales que guardar" : `Guardó ${plural(r.persistidas, "señal", "señales")}`), r.persistidas ? "hallazgo" : undefined);
      break;
    case "analizar_mercado":
    case "analyze_market_sharded":
      add(nro(r.n_items) != null && `${numero(r.n_con_mediana)} de ${plural(r.n_items, "ítem", "ítems")} con precio de mercado`);
      add(txt(r.veredicto_global) && `Veredicto: ${VEREDICTO[r.veredicto_global] ?? legible(r.veredicto_global)}`);
      add("sobreprecio_pct" in r && (r.sobreprecio_pct == null ? "No se midió un sobreprecio" : `Sobreprecio medido: ${numero(r.sobreprecio_pct)} %`), r.sobreprecio_pct ? "hallazgo" : "tenue");
      add(nro(r.n_grounding_urls) != null && `${plural(r.n_grounding_urls, "fuente web citada", "fuentes web citadas")}`, "tenue");
      add(nro(r.segundos) != null && `Tardó ${numero(r.segundos)} s`, "tenue");
      break;
    case "build_market_input":
      add(nro(r.n_items) != null && plural(r.n_items, "ítem a tasar", "ítems a tasar"));
      break;
    case "_detect_estado_real_persist":
    case "detect_estado_real":
      add(txt(r.estado_ocds) && `Registro: ${legible(r.estado_ocds)}${txt(r.estado_documentos) ? `; documentos: ${legible(r.estado_documentos)}` : ""}`);
      add(r.estado_inconsistente === true ? "No coinciden" : r.estado_inconsistente === false ? "Coinciden" : null, r.estado_inconsistente ? "hallazgo" : "tenue");
      break;
    case "analyze_postores_pattern": {
      const ps = arr(r.postores);
      const conSospecha = ps.filter((x) => arr(x?.sospechas).length > 0).length;
      add(`${plural(ps.length, "postor revisado", "postores revisados")}; ${conSospecha === 0 ? "ninguno con patrón sospechoso" : `${numero(conSospecha)} con patrón sospechoso`}`, conSospecha ? "hallazgo" : undefined);
      break;
    }
    case "persist_alert_from_flags":
      if (nro(r.banderas_persistidas) === 0 && !txt(r.alerta_codigo)) add("Sin señales en ese momento: no creó la alerta");
      else add(nro(r.banderas_persistidas) != null && `Guardó ${plural(r.banderas_persistidas, "señal", "señales")}${nro(r.score) != null ? `; puntaje ${numero(r.score)} de 100` : ""}`, r.banderas_persistidas ? "hallazgo" : undefined);
      add(nro(r.banderas_descartadas) ? `Descartó ${plural(r.banderas_descartadas, "señal", "señales")}` : null, "tenue");
      break;
    case "google_search":
      add(`${plural(nro(r.n_queries) ?? arr(r.queries).length, "búsqueda hecha", "búsquedas hechas")}. Lo que encontró cada búsqueda no queda en la traza: está en el resultado del agente.`, "tenue");
      break;
    case "batch_person_lookup": {
      const res = arr(r.resumen);
      const con = res.filter((x) => arr(x?.hallazgos).length > 0);
      add(`${plural(res.length || (nro(r.n_personas) ?? 0), "persona cruzada", "personas cruzadas")}; ${con.length === 0 ? "ninguna con hallazgos" : `${numero(con.length)} con hallazgos`}`, con.length ? "hallazgo" : undefined, {
        lista: con.map((x) => {
          // La advertencia trae, además del dato, una instrucción para el modelo ("NO emitir…"): va sólo el dato.
          const adv = txt(x?.advertencia)?.replace(/\s*NO emitir[^.]*\.?/gi, "").trim();
          return `${txt(x?.nombre) ?? "Sin nombre"}${txt(x?.rol) ? ` (${legible(x.rol)})` : ""}: ${arr(x?.hallazgos).join(", ")}${adv ? `. ${adv}` : ""}`;
        }),
      });
      break;
    }
    case "query_rnp_empresa": {
      const n = arr(r.socios).length + arr(r.representantes_legales).length + arr(r.organos_administracion).length;
      if (r.found === false) add(`Sin ficha en el RNP${txt(r.razon) ? `: ${r.razon}` : ""}`, "tenue");
      else add(`${txt(r.forma_societaria) ? `${legible(r.forma_societaria).toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}; ` : ""}${plural(nro(r.n_personas) ?? n, "persona registrada", "personas registradas")}`);
      break;
    }
    case "read_person_network_context":
      add(nro(r.n_personas_investigadas) != null && plural(r.n_personas_investigadas, "persona investigada", "personas investigadas"));
      break;
    case "detect_puerta_giratoria":
      add(nro(r.n_indicios) != null && (r.n_indicios === 0 ? "Sin indicios" : plural(r.n_indicios, "indicio", "indicios")), r.n_indicios ? "hallazgo" : undefined);
      break;
    case "evaluate_normative_compliance":
      add(nro(r.n_hallazgos_evaluados) != null && `${plural(r.n_hallazgos_evaluados, "hallazgo cruzado", "hallazgos cruzados")} con las opiniones del OECE`);
      break;
    case "persist_analysis_outputs":
      add(r.persisted === true ? (nro(r.dictamen_chars) ? `Guardado, con un dictamen de ${numero(r.dictamen_chars)} caracteres` : "Guardado, todavía sin dictamen") : r.persisted === false ? "No se pudo guardar" : null, r.persisted === false ? "error" : undefined);
      add(nro(r.doc_flags_diferidas_inserted) ? `Sumó ${plural(r.doc_flags_diferidas_inserted, "señal documental pendiente", "señales documentales pendientes")}` : null, "hallazgo");
      add(nro(r.banderas_investigacion_inserted) ? `Sumó ${plural(r.banderas_investigacion_inserted, "señal de la investigación", "señales de la investigación")}` : null, "hallazgo");
      for (const w of arr(r.warns)) add(avisoDeGuardado(String(w)), "tenue");
      break;
    case "add_contextual_flag":
      add(r.ok === true ? "Quedó anotada para guardarse con la alerta" : null, "tenue");
      break;
    default:
      break;
  }
  return out;
}

/** Los avisos que deja el guardado ("compliance_extended: output del agente no parseable…") en palabras. */
export function avisoDeGuardado(w: string): string {
  const m = /^(\w+):\s*output del agente no parseable/i.exec(w);
  if (m) return `El resultado de ${NOMBRE_TECNICO[m[1]] ?? legible(m[1])} llegó sin formato y no se usó`;
  return "Aviso técnico al guardar";
}

const NOMBRE_TECNICO: Record<string, string> = {
  compliance_extended: "Cumplimiento extendido",
  web_research: "la investigación de la empresa",
  news_research: "la búsqueda de prensa",
  person_network: "la red de personas",
  entity_personnel: "la búsqueda de funcionarios",
  market: "la comparación de precios",
};

// ─── Qué leyó (herramientas de entrada) ─────────────────────────────────

/** Las secciones del análisis con su nombre llano, para decir qué recibió un agente. */
const SECCION: Record<string, string> = {
  ocds: "registro del proceso",
  web_research: "investigación de la empresa",
  news_research: "prensa",
  contrato_final: "contrato firmado",
  legal_analysis: "análisis legal",
  person_network: "red de personas",
  estudio_mercado: "estudio de mercado",
  market_analysis: "precios de mercado",
  compliance_result: "reglas de contratación",
  document_analysis: "lectura del expediente",
  normative_compliance: "cruce con opiniones del OECE",
  banderas: "señales",
  estado_real: "etapa real del proceso",
  oece_perfil: "perfil OECE del proveedor",
  sunat_decolecta: "ficha SUNAT",
  entity_personnel: "funcionarios de la entidad",
  reglas_evaluadas: "reglas evaluadas",
  analisis_postores: "análisis de postores",
  acto_resolutivo_directa: "acto resolutivo de la directa",
  causal_directa_invocada: "causal de la directa",
  rnp_firmantes_resultados: "firmantes en el RNP",
  perfil: "tipo de contrato",
  recortes: "documentos o datos recortados",
  descartes: "datos descartados por formato",
  salidas_no_verificables: "salidas no verificables",
  validaciones_pendientes: "validaciones pendientes",
  ganador: "ganador",
  rnp_proveedor: "RNP del proveedor",
  todos_postores: "postores",
  comite_evaluacion: "comité de evaluación",
  autoridades_entidad: "autoridades de la entidad",
  entidad_contratante: "entidad",
  datos_peru_por_persona: "datos por persona",
  firmantes_consolidados: "firmantes",
  funcionarios_designados: "funcionarios designados",
  socios_postores_rivales: "socios de los postores rivales",
  red_empresarial_derivada: "red empresarial",
  visitas_inter_municipales: "visitas entre municipios",
  firmantes: "firmantes",
  documentos: "documentos",
  items: "ítems",
  items_consolidados: "ítems",
  postores_extraidos: "postores",
  motivos_adjudicacion: "motivos de la adjudicación",
  fundamento_legal: "fundamento legal",
  resumen_ejecutivo: "resumen ejecutivo",
  lugar_fecha_acta: "lugar y fecha del acta",
  modalidad: "modalidad",
  cuantia_total: "cuantía",
  fuente_financiamiento: "fuente de financiamiento",
};

const vacio = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || (esObjeto(v) && Object.keys(v).length === 0);

/** Qué trajo una herramienta de entrada: las secciones con datos (y con cuántos, si es una lista) y las vacías. */
export function lineasDeEntrada(p: Paso): Linea[] {
  if (!p.hayResultado) return [{ texto: "La traza no guardó lo que leyó.", tono: "tenue" }];
  if (p.error) return [{ texto: `Falló: ${p.error}`, tono: "error" }];
  const r = p.resultado;
  if (!esObjeto(r)) return [];
  const claves = Object.keys(r).filter((k) => !k.startsWith("_") && k !== "hint" && k !== "alerta_codigo" && !/^n_/.test(k));
  const conDatos = claves.filter((k) => !vacio(r[k]));
  const vacias = claves.filter((k) => vacio(r[k]) && SECCION[k]);
  const nombre = (k: string) => {
    const base = SECCION[k] ?? legible(k);
    return Array.isArray(r[k]) ? `${base} (${numero(r[k].length)})` : base;
  };
  const out: Linea[] = [];
  if (conDatos.length) out.push({ texto: plural(conDatos.length, "parte con datos", "partes con datos"), lista: conDatos.map(nombre) });
  if (vacias.length) out.push({ texto: `Llegaron vacías: ${vacias.map((k) => SECCION[k]).join(", ")}`, tono: "tenue" });
  return out;
}
