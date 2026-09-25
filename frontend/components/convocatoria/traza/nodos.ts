/**
 * Lo que se dice de cada nodo del recorrido: qué recibió, qué entregó y el resumen de una línea
 * que va en el grafo. Puro. Cada frase sale de un campo de la traza o del resultado guardado
 * (`result`); si el campo no está, la frase no se escribe.
 */

import { reglaLabel } from "@/lib/auditoria";
import { listaY, numero, plural, soles } from "@/lib/formato";
import type { ApiResult } from "../types";
import { observacionesLegibles } from "../dossier";
import { EVALS, resultadoDe } from "./evaluadores";
import { esHerramientaDeEntrada, type NodoTraza, type Paso, type Recorrido } from "./modelo";
import { accionDe, avisoDeGuardado, lecturaDeRegla, legible, lineasDeResultado, type Linea } from "./pasos";

const esObjeto = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nro = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const mayuscula = (s: string) => s.replace(/^\p{L}/u, (c) => c.toUpperCase());

/** Todos los pasos del nodo, en orden de la traza. */
export const todosLosPasos = (n: NodoTraza): Paso[] => [...n.antes, ...n.pasos, ...n.despues].sort((a, b) => a.i - b.i);

/** La última respuesta sana (sin error) de una herramienta dentro del nodo. */
function respuesta(n: NodoTraza, nombre: string): Record<string, any> | null {
  const ps = todosLosPasos(n).filter((p) => p.nombre === nombre && !p.error && esObjeto(p.resultado));
  return ps.length ? (ps[ps.length - 1].resultado as Record<string, any>) : null;
}

const reglasDe = (n: NodoTraza) =>
  n.pasos.filter((p) => /^check_\w+_rule$/.test(p.nombre) && !p.error && esObjeto(p.resultado)).map((p) => p.resultado as Record<string, any>);

function conteoReglas(n: NodoTraza): { total: number; disparadas: Record<string, any>[]; sinDato: Record<string, any>[]; noAplican: Record<string, any>[] } | null {
  const rs = reglasDe(n);
  if (!rs.length) return null;
  return {
    total: rs.length,
    disparadas: rs.filter((r) => r.triggered === true),
    sinDato: rs.filter((r) => r.triggered !== true && r.omitida !== true && r.estado === "sin_dato"),
    noAplican: rs.filter((r) => r.triggered !== true && r.omitida === true),
  };
}

const frasereglas = (c: { total: number; disparadas: unknown[] }) =>
  `${numero(c.disparadas.length)} de ${numero(c.total)} ${c.total === 1 ? "regla" : "reglas"} ${c.disparadas.length === 1 ? "disparó" : "dispararon"}`;

function palabrasDictamen(result: ApiResult): number | null {
  const md = (result.dictamen?.dictamen_markdown || "").trim();
  return md ? md.split(/\s+/).filter(Boolean).length : null;
}

/** Señales que el dictamen recibió anotadas a este agente (`agente_origen`). */
export function senalesDe(n: NodoTraza, r: Recorrido): { regla: string; severidad: string }[] | null {
  if (!r.senalesDictamen || n.tipo !== "agente") return null;
  return r.senalesDictamen.filter((s) => s.agente === n.clave);
}

// ─── El resumen de una línea (tarjeta del grafo) ────────────────────────

export function resumenCorto(n: NodoTraza, r: Recorrido, result: ApiResult): string {
  if (n.estado === "omitido") return "No aplicó a este contrato";
  if (n.estado === "sin_rastro") return "Sin registro en la traza";
  const c = conteoReglas(n);
  switch (n.clave) {
    case "ocds": {
      const f = respuesta(n, "fetch_ocds_record");
      if (f && nro(f.cuantia) != null) return `${soles(f.cuantia)}${nro(f.n_items) != null ? `, ${plural(f.n_items, "ítem", "ítems")}` : ""}`;
      break;
    }
    case "compliance":
    case "compliance_extended":
      if (c) return frasereglas(c);
      break;
    case "document_parser": {
      const l = respuesta(n, "parse_documentos_lote");
      if (l && nro(l.n_docs) != null) return `${numero(l.n_ok)} de ${plural(l.n_docs, "documento leído", "documentos leídos")}`;
      const docs = arr(result.document_analysis?.documentos).length;
      if (docs) return plural(docs, "documento leído", "documentos leídos");
      break;
    }
    case "document_legal_analyst": {
      const s = senalesDe(n, r);
      if (s) return s.length ? plural(s.length, "señal anotada", "señales anotadas") : "Sin señales anotadas";
      break;
    }
    case "market": {
      const m = respuesta(n, "analizar_mercado") ?? respuesta(n, "analyze_market_sharded") ?? result.market_analysis;
      if (m && nro(m.n_items) != null) return `${numero(m.n_con_mediana)} de ${plural(m.n_items, "ítem", "ítems")} con precio de mercado`;
      break;
    }
    case "proveedor": {
      const o = respuesta(n, "query_oece_perfil");
      if (o) {
        const ns = nro(o.n_sanciones) ?? arr(o.sanciones).length;
        return `${txt(o.estado) ? `${mayuscula(legible(o.estado).toLowerCase())}, ` : ""}${ns === 0 ? "sin sanciones" : plural(ns, "sanción", "sanciones")}`;
      }
      const g = respuesta(n, "get_ganador");
      if (txt(g?.ganador?.razon_social)) return g!.ganador.razon_social;
      break;
    }
    case "web_research": {
      const otros = arr(result.web_research?.otros_contratos_con_estado).length;
      if (otros) return plural(otros, "contrato más con el Estado", "contratos más con el Estado");
      break;
    }
    case "news_research": {
      const nr = result.news_research;
      if (nr?.sin_menciones_relevantes === true) return "Sin menciones en prensa";
      const k = nro(nr?.n_noticias_totales) ?? (Array.isArray(nr?.noticias) ? nr.noticias.length : null);
      if (k != null) return k === 0 ? "Sin noticias" : plural(k, "noticia", "noticias");
      break;
    }
    case "entity_personnel": {
      const ep = (result as any).entity_personnel;
      const k = nro(ep?.n_funcionarios) ?? (Array.isArray(ep?.funcionarios_designados) ? ep.funcionarios_designados.length : null);
      if (k != null) return k === 0 ? "Sin funcionarios hallados" : plural(k, "funcionario", "funcionarios");
      break;
    }
    case "person_network": {
      const pn = result.person_network;
      const lazos = arr(pn?.lazos_entre_postores).length;
      if (lazos) return plural(lazos, "lazo entre postores", "lazos entre postores");
      const br = arr(pn?.banderas_red).length;
      if (pn && br) return plural(br, "señal de red", "señales de red");
      if (pn) return "Sin vínculos detectados";
      break;
    }
    case "senales": {
      const a = respuesta(n, "persist_alert_from_flags");
      if (a && nro(a.banderas_persistidas) != null) return `${plural(a.banderas_persistidas, "señal guardada", "señales guardadas")}${nro(a.score) != null ? `, puntaje ${numero(a.score)}` : ""}`;
      break;
    }
    case "report_writer": {
      const w = palabrasDictamen(result);
      if (w) return `Dictamen de ${numero(w)} palabras`;
      break;
    }
    case "cierre": {
      const g = respuesta(n, "persist_analysis_outputs");
      if (g?.persisted === true) return "Análisis guardado";
      break;
    }
    case "self_eval": {
      if (r.evaluaciones.length) {
        const ok = EVALS.filter((e) => resultadoDe(r.evaluaciones.find((x) => x.evaluador === e.n)) === "aprobado").length;
        return `${numero(ok)} de ${numero(EVALS.length)} controles aprobados`;
      }
      break;
    }
  }
  const consultas = n.pasos.length + n.antes.length;
  if (n.delegacion?.respuesta != null) return "Su instrucción y su respuesta quedaron en la traza";
  if (n.consumo?.llamadas) return plural(n.consumo.llamadas, "llamada al modelo", "llamadas al modelo");
  if (consultas) return plural(consultas, "consulta", "consultas");
  return "Corrió, sin más detalle en la traza";
}

// ─── Qué entregó ─────────────────────────────────────────────────────────

export interface Entrega {
  lineas: Linea[];
  /** Señales anotadas a este agente, tal como las recibió el dictamen. `null`: la traza no lo dice. */
  senales: { regla: string; severidad: string }[] | null;
}

export function entregaDe(n: NodoTraza, r: Recorrido, result: ApiResult): Entrega {
  const out: Linea[] = [];
  const add = (texto: string | null | false | undefined, tono?: Linea["tono"], extra?: Partial<Linea>) => {
    if (texto) out.push({ texto, tono, ...extra });
  };
  const c = conteoReglas(n);
  if (c) {
    add(frasereglas(c), c.disparadas.length ? "hallazgo" : undefined, {
      lista: c.disparadas.length ? c.disparadas.map((x) => reglaLabel(String(x.regla ?? ""))) : undefined,
    });
    if (c.sinDato.length) add(`Sin datos para evaluar: ${c.sinDato.map((x) => reglaLabel(String(x.regla ?? ""))).join(", ")}`, "tenue");
    if (c.noAplican.length) add(`No aplican a este contrato: ${c.noAplican.map((x) => reglaLabel(String(x.regla ?? ""))).join(", ")}`, "tenue");
  }

  switch (n.clave) {
    case "ocds":
    case "proveedor":
      for (const p of n.pasos) if (["fetch_ocds_record", "get_ganador", "query_oece_perfil"].includes(p.nombre)) out.push(...lineasDeResultado(p));
      for (const p of n.pasos) if (p.error) add(`${p.nombre === "query_sunat_decolecta" || p.nombre === "read_sunat_profile" ? "La SUNAT no respondió" : "Una consulta falló"}: ${p.error}`, "error");
      break;
    case "compliance": {
      const p = [...n.pasos].reverse().find((x) => x.nombre === "persist_alert_from_flags");
      if (p) out.push(...lineasDeResultado(p));
      break;
    }
    case "document_parser": {
      const da = result.document_analysis;
      if (da) {
        const cuenta = (xs: unknown, uno: string, varios: string) => (arr(xs).length ? plural(arr(xs).length, uno, varios) : null);
        const partes = [
          cuenta(da.documentos, "documento", "documentos"),
          cuenta(da.items_consolidados, "ítem", "ítems"),
          cuenta(da.firmantes, "firmante", "firmantes"),
          cuenta(da.postores_consolidados || da.postores_extraidos, "postor", "postores"),
        ].filter(Boolean);
        add(partes.length > 0 && `Extrajo ${listaY(partes as string[])}`);
        if (arr(da.comite_evaluacion).length) add(`Comité de evaluación de ${plural(arr(da.comite_evaluacion).length, "persona", "personas")}`, "tenue");
        if (txt(da.modalidad)) add(`Modalidad: ${legible(da.modalidad)}`, "tenue");
      }
      break;
    }
    case "market": {
      const m = result.market_analysis;
      const p = n.pasos.find((x) => x.nombre === "analizar_mercado" || x.nombre === "analyze_market_sharded");
      if (p) out.push(...lineasDeResultado(p).filter((l) => !/^Tardó/.test(l.texto)));
      for (const o of observacionesLegibles(m?.observaciones_clave).slice(0, 2)) add(o, undefined, { cita: true });
      break;
    }
    case "web_research": {
      const w = result.web_research;
      if (w) {
        add(txt(w.sintesis), undefined, { cita: true });
        add(arr(w.otros_contratos_con_estado).length > 0 && plural(arr(w.otros_contratos_con_estado).length, "contrato más del proveedor con el Estado", "contratos más del proveedor con el Estado"));
        add(arr(w.hallazgos_por_fuente).length > 0 && plural(arr(w.hallazgos_por_fuente).length, "fuente revisada", "fuentes revisadas"), "tenue");
        add(arr(w.banderas_sugeridas).length > 0 && plural(arr(w.banderas_sugeridas).length, "señal sugerida", "señales sugeridas"), "hallazgo");
      } else if (result.web_research_raw) add("Respondió, pero su resultado no se pudo leer", "error");
      break;
    }
    case "news_research": {
      const nr = result.news_research;
      if (nr) {
        add(txt(nr.resumen_ejecutivo), undefined, { cita: true });
        add(nr.sin_menciones_relevantes === true ? "Sin menciones relevantes en la prensa" : nro(nr.n_noticias_totales) != null ? plural(nr.n_noticias_totales, "noticia encontrada", "noticias encontradas") : null);
      } else if (result.news_research_raw) add("Respondió, pero su resultado no se pudo leer", "error");
      break;
    }
    case "entity_personnel": {
      const ep = (result as any).entity_personnel;
      if (ep) {
        add(nro(ep.n_funcionarios) != null && plural(ep.n_funcionarios, "funcionario designado", "funcionarios designados"));
        add(arr(ep.resoluciones_designacion).length > 0 && plural(arr(ep.resoluciones_designacion).length, "resolución de designación", "resoluciones de designación"), "tenue");
        add(txt(ep.observaciones), undefined, { cita: true });
        if (ep.sin_data_publica === true) add("La entidad no publica esos datos", "tenue");
      }
      break;
    }
    case "person_network": {
      const pn = result.person_network;
      if (pn) {
        add(txt(pn.sintesis), undefined, { cita: true });
        add(arr(pn.lazos_entre_postores).length > 0 && plural(arr(pn.lazos_entre_postores).length, "lazo entre postores", "lazos entre postores"), "hallazgo");
        add(arr(pn.cruce_firmantes_ganador).length > 0 && plural(arr(pn.cruce_firmantes_ganador).length, "firmante cruzado con el ganador", "firmantes cruzados con el ganador"), "hallazgo");
        add(arr(pn.vinculo_autoridades).length > 0 && plural(arr(pn.vinculo_autoridades).length, "vínculo con autoridades", "vínculos con autoridades"), "hallazgo");
        add(arr(pn.banderas_red).length > 0 && plural(arr(pn.banderas_red).length, "señal de red", "señales de red"), "hallazgo");
      } else if (result.person_network_raw) add("Respondió, pero su resultado no se pudo leer", "error");
      break;
    }
    case "senales":
    case "cierre":
      for (const p of n.pasos) {
        if (p.error) add(`Falló el paso «${accionDe(p)}»: ${p.error}`, "error");
        else out.push(...lineasDeResultado(p).filter((l) => l.tono !== "tenue" || /Descartó/.test(l.texto)));
      }
      break;
    case "report_writer": {
      const w = palabrasDictamen(result);
      const md = result.dictamen?.dictamen_markdown || "";
      const secciones = (md.match(/^#{2,3}\s+\S/gm) || []).length;
      add(w ? `Dictamen de ${numero(w)} palabras${secciones ? ` en ${plural(secciones, "sección", "secciones")}` : ""}` : null);
      add(txt(result.dictamen?.gen_meta?.model) && `Modelo: ${result.dictamen!.gen_meta.model}`, "tenue");
      if (!w) add("El dictamen no quedó guardado", "error");
      break;
    }
    case "self_eval":
      add(resumenCorto(n, r, result));
      break;
  }

  // Orquestador viejo: la respuesta final del agente quedó en la traza, tal cual.
  const respuestaAgente = n.delegacion?.respuesta;
  const textoRespuesta = esObjeto(respuestaAgente) ? txt(respuestaAgente.result) : txt(respuestaAgente);
  if (textoRespuesta) add(textoRespuesta.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""), undefined, { cita: true });

  // Lo que dejó el guardado sobre este nodo ("su resultado llegó sin formato…"), una vez.
  const avisos = new Set<string>();
  for (const m of r.nodos)
    for (const p of todosLosPasos(m))
      if (p.nombre === "persist_analysis_outputs" && esObjeto(p.resultado))
        for (const w of arr(p.resultado.warns)) if (String(w).startsWith(`${n.clave}:`)) avisos.add(avisoDeGuardado(String(w)));
  for (const a of avisos) add(a, "error");

  // Una misma línea no se repite (dos consultas a la SUNAT que fallan igual dicen lo mismo).
  const vistas = new Set<string>();
  const lineas = out.filter((l) => !vistas.has(l.texto) && !!vistas.add(l.texto));
  return { lineas, senales: senalesDe(n, r) };
}

// ─── Qué recibió ─────────────────────────────────────────────────────────

export interface Recepcion {
  /** Quién lo llamó y con quién. `null` en los nodos del propio coordinador. */
  delegacion: string | null;
  /** La instrucción que le escribió el orquestador (sólo el orquestador viejo la guardaba). */
  instruccion: string | null;
  /** Agente llamado sin instrucción guardada: se dice que la traza no la tiene. */
  sinInstruccion: boolean;
  /** Los pasos de los que depende, con lo que dejó cada uno. */
  previos: { clave: string; nombre: string; resumen: string; estado: NodoTraza["estado"] }[];
  /** Herramientas con las que leyó lo que dejaron otros (read_*, get_*_context). */
  lecturas: Paso[];
  /** Lo que el coordinador preparó para él antes de llamarlo. */
  preparado: Paso[];
}

export function recepcionDe(n: NodoTraza, r: Recorrido, result: ApiResult): Recepcion {
  const nombre = (k: string) => r.porClave[k]?.nombre ?? k;
  let delegacion: string | null = null;
  if (n.tipo === "agente") {
    if (n.delegacion) {
      const junto = n.delegacion.junto.map(nombre);
      delegacion = junto.length ? `Lo llamó el coordinador, a la vez que a ${listaY(junto)}` : "Lo llamó el coordinador";
    } else if (n.pasos.length && n.pasos.every((p) => p.porCoordinador)) delegacion = "Este trabajo lo hizo el propio coordinador, con herramientas";
    else if (n.estado !== "sin_rastro") delegacion = "La traza no registra la llamada del coordinador";
  }
  const instruccion = n.delegacion?.instruccion ?? null;
  return {
    delegacion,
    instruccion,
    sinInstruccion: n.tipo === "agente" && !!n.delegacion && !instruccion,
    previos: n.entra.map((k) => ({ clave: k, nombre: nombre(k), resumen: resumenCorto(r.porClave[k], r, result), estado: r.porClave[k].estado })),
    lecturas: [...n.antes, ...n.pasos].filter((p) => esHerramientaDeEntrada(p.nombre)),
    preparado: n.antes.filter((p) => !esHerramientaDeEntrada(p.nombre)),
  };
}

/** Lo que hizo el nodo, sin las lecturas (esas van en "Recibió"). */
export const trabajoDe = (n: NodoTraza): Paso[] => n.pasos.filter((p) => !esHerramientaDeEntrada(p.nombre));

/** Etiqueta del tipo de nodo, en palabras. */
export const TIPO_NODO: Record<NodoTraza["tipo"], string> = {
  agente: "Agente de IA",
  codigo: "Código del coordinador, sin IA",
  control: "Control de calidad",
};

export const ESTADO_NODO: Record<NodoTraza["estado"], string> = {
  corrio: "Corrió",
  fallo: "Falló",
  omitido: "No aplicó",
  sin_rastro: "Sin registro",
};

/** Una regla, en una línea: su nombre y si disparó. Para listas compactas. */
export const reglaEnUnaLinea = (res: Record<string, any>) => `${reglaLabel(String(res.regla ?? ""))}: ${lecturaDeRegla(res).texto}`;
