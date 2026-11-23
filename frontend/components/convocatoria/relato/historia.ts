/**
 * La lógica del relato del informe de un contrato (pedido del usuario del 2026-11-05: «veo que solo apilamos y demás sin
 * dar orden o contar una historia»). El informe ya no empieza por una tabla de señales sino por «La historia»: el
 * veredicto en una frase, qué pasó en orden (con cada señal PEGADA al paso donde se ve), por qué llama la atención, quién
 * ganó, qué dice el dictamen y de dónde sale cada dato.
 *
 * Aquí va lo que no dibuja nada: a qué paso del proceso va cada regla, en qué tema se agrupa, las señales normalizadas
 * (en orden de gravedad y sin la que repite el hecho de otra) y el resumen del dictamen sin markdown. Todo sale de los
 * DATOS del análisis, no del texto del modelo (salvo el resumen del dictamen, que se cita como lo que es).
 */

import { limpiarEvidencia, sinRepetidas } from "@/components/agentes/ListaSenales";
import { limpiarObjeto } from "@/components/contratos/recortar";
import { reglaLabel } from "@/lib/auditoria";
import { oracion } from "@/lib/formato";
import { RANGO_SEVERIDAD } from "@/lib/severidad";
import { severidadDe, type SeveridadSenal } from "../dossier";
import { evidenciaComoTexto } from "../evidenciaTexto";
import type { Bandera } from "../types";

// ─── Los pasos del proceso y a cuál va cada regla ─────────────────────────────

/**
 * Los pasos de la cronología, en orden. `antes` y `ejecucion` no tienen fecha en el registro: sólo aparecen si una señal
 * cae ahí (visitas antes de convocar, adicionales de obra). `plazo` es el fin del plazo del contrato, si se leyó el contrato.
 */
export type ClavePaso = "antes" | "convocatoria" | "ofertas" | "buena_pro" | "firma" | "ejecucion" | "plazo";
export const ORDEN_PASOS: readonly ClavePaso[] = ["antes", "convocatoria", "ofertas", "buena_pro", "firma", "ejecucion", "plazo"];

/**
 * Regla → el paso del proceso donde se VE la señal. Explícita a propósito: así una señal se entiende en su momento («Oferta
 * igual al valor referencial», en la buena pro) y no en una lista suelta. Las del proveedor (giro, concentración,
 * sanciones) van a la buena pro: es el momento en que ese proveedor gana. Lo que no está aquí cae en `PASO_POR_DEFECTO`.
 */
export const PASO_DE_REGLA: Record<string, ClavePaso> = {
  // Antes de convocar: cómo se armó la compra.
  lobby_visits_pre_convocatoria: "antes",
  fraccionamiento: "antes",
  // La convocatoria: qué procedimiento se eligió, para qué monto y con qué bases.
  tipo_proceso_vs_monto: "convocatoria",
  procedimiento_no_competitivo: "convocatoria",
  cuantia_al_limite_del_tope: "convocatoria",
  spec_restrictiva: "convocatoria",
  objeto_no_corresponde_documento: "convocatoria",
  directa_sin_fundamento: "convocatoria",
  directa_causal_imprecisa: "convocatoria",
  directa_emergencia_sin_acto_resolutivo: "convocatoria",
  directa_recurrente: "convocatoria",
  // Las ofertas: cuánto plazo hubo, quiénes se presentaron y cómo.
  plazo_convocatoria_minimo: "ofertas",
  unico_postor_alto: "ofertas",
  ofertas_agrupadas: "ofertas",
  postores_vinculados_rnp: "ofertas",
  testaferro_multi_ruc: "ofertas",
  ruc_ultra_nuevo: "ofertas",
  ganador_no_invitado: "ofertas",
  personal_clave_vinculado: "ofertas",
  // La buena pro: a quién, por cuánto, quién la firmó y qué dicen los documentos de la evaluación.
  oferta_igual_valor_referencial: "buena_pro",
  oferta_mas_barata_no_gana: "buena_pro",
  unica_oferta_valida: "buena_pro",
  fecha_buena_pro_incoherente: "buena_pro",
  firmante_vinculado_ganador: "buena_pro",
  firmante_con_empresa_rnp: "buena_pro",
  conflicto_interes_funcionario_empresa: "buena_pro",
  funcionario_con_historial_politico: "buena_pro",
  inconsistencia_doc_vs_ocds: "buena_pro",
  red_flag_documental: "buena_pro",
  // Quién ganó: lo que se sabe del proveedor, en el momento en que gana.
  ciiu_vs_objeto: "buena_pro",
  concentracion_entidad: "buena_pro",
  postor_unico_mayoritario: "buena_pro",
  ruc_ganador_muy_nuevo: "buena_pro",
  capacidad_operativa_cuestionable: "buena_pro",
  proveedor_sancionado_osce: "buena_pro",
  sancion_vigente_oece: "buena_pro",
  sancion_historica_oece: "buena_pro",
  penalidades_oece_historicas: "buena_pro",
  persona_contratada_senales: "buena_pro",
  antecedentes_proveedor: "buena_pro",
  antecedente_proveedor_web: "buena_pro",
  cobertura_prensa_adversa: "buena_pro",
  red_personas_vinculada: "buena_pro",
  vinculo_red_personas: "buena_pro",
  supervisor_vinculado_ejecutor: "buena_pro",
  // La ejecución: lo que pasó después de firmar.
  adicional_acumulado: "ejecucion",
  ampliacion_denegada_penalidad: "ejecucion",
};

/** Una regla que la tabla no conoce va a la buena pro: es el centro de la historia (a quién y por cuánto). */
export const PASO_POR_DEFECTO: ClavePaso = "buena_pro";

export function pasoDeRegla(regla: string): ClavePaso {
  if (PASO_DE_REGLA[regla]) return PASO_DE_REGLA[regla];
  // Familias por prefijo: el precio se juzga al adjudicar; la supervisión de obra, durante la ejecución.
  if (regla.startsWith("sobreprecio")) return "buena_pro";
  if (regla.startsWith("supervision_")) return "ejecucion";
  if (regla.startsWith("directa_")) return "convocatoria";
  return PASO_POR_DEFECTO;
}

/**
 * El paso donde se muestra una señal cuyo paso no está en la cronología (sin fecha de ofertas, sin buena pro): el más
 * cercano que sí está, primero hacia adelante (una señal de las ofertas se lee bien en la buena pro).
 */
export function pasoPresente(objetivo: ClavePaso, presentes: ReadonlySet<ClavePaso>): ClavePaso | null {
  const i = ORDEN_PASOS.indexOf(objetivo);
  for (let d = 0; d < ORDEN_PASOS.length; d++) {
    const adelante = ORDEN_PASOS[i + d];
    if (adelante && presentes.has(adelante)) return adelante;
    const atras = d > 0 ? ORDEN_PASOS[i - d] : undefined;
    if (atras && presentes.has(atras)) return atras;
  }
  return null;
}

// ─── Los temas de «Por qué llama la atención» ─────────────────────────────────

export type ClaveTema = "competencia" | "precio" | "procedimiento" | "proveedor" | "vinculos" | "documentos" | "plazos" | "ejecucion" | "otras";

export const TITULO_TEMA: Record<ClaveTema, string> = {
  competencia: "La competencia",
  precio: "El precio",
  procedimiento: "El procedimiento elegido",
  proveedor: "El proveedor que ganó",
  vinculos: "Vínculos entre personas",
  documentos: "Los documentos",
  plazos: "Plazos y fechas",
  ejecucion: "La ejecución",
  otras: "Otras señales",
};

/** Regla → tema. Lo que no está aquí va a «Otras señales» (con su nombre y su evidencia: nada se pierde). */
export const TEMA_DE_REGLA: Record<string, ClaveTema> = {
  unico_postor_alto: "competencia",
  unica_oferta_valida: "competencia",
  ofertas_agrupadas: "competencia",
  oferta_mas_barata_no_gana: "competencia",
  ganador_no_invitado: "competencia",
  spec_restrictiva: "competencia",
  oferta_igual_valor_referencial: "precio",
  procedimiento_no_competitivo: "procedimiento",
  tipo_proceso_vs_monto: "procedimiento",
  cuantia_al_limite_del_tope: "procedimiento",
  fraccionamiento: "procedimiento",
  directa_sin_fundamento: "procedimiento",
  directa_causal_imprecisa: "procedimiento",
  directa_emergencia_sin_acto_resolutivo: "procedimiento",
  directa_recurrente: "procedimiento",
  ciiu_vs_objeto: "proveedor",
  concentracion_entidad: "proveedor",
  postor_unico_mayoritario: "proveedor",
  ruc_ganador_muy_nuevo: "proveedor",
  ruc_ultra_nuevo: "proveedor",
  capacidad_operativa_cuestionable: "proveedor",
  proveedor_sancionado_osce: "proveedor",
  sancion_vigente_oece: "proveedor",
  sancion_historica_oece: "proveedor",
  penalidades_oece_historicas: "proveedor",
  persona_contratada_senales: "proveedor",
  antecedentes_proveedor: "proveedor",
  antecedente_proveedor_web: "proveedor",
  cobertura_prensa_adversa: "proveedor",
  firmante_vinculado_ganador: "vinculos",
  firmante_con_empresa_rnp: "vinculos",
  conflicto_interes_funcionario_empresa: "vinculos",
  funcionario_con_historial_politico: "vinculos",
  personal_clave_vinculado: "vinculos",
  red_personas_vinculada: "vinculos",
  vinculo_red_personas: "vinculos",
  lobby_visits_pre_convocatoria: "vinculos",
  postores_vinculados_rnp: "vinculos",
  testaferro_multi_ruc: "vinculos",
  supervisor_vinculado_ejecutor: "vinculos",
  red_flag_documental: "documentos",
  inconsistencia_doc_vs_ocds: "documentos",
  objeto_no_corresponde_documento: "documentos",
  extraccion_documento_fallida: "documentos",
  plazo_convocatoria_minimo: "plazos",
  fecha_buena_pro_incoherente: "plazos",
  adicional_acumulado: "ejecucion",
  ampliacion_denegada_penalidad: "ejecucion",
};

export function temaDeRegla(regla: string): ClaveTema {
  if (TEMA_DE_REGLA[regla]) return TEMA_DE_REGLA[regla];
  if (regla.startsWith("sobreprecio")) return "precio";
  if (regla.startsWith("supervision_")) return "ejecucion";
  if (regla.startsWith("directa_")) return "procedimiento";
  return "otras";
}

// ─── Las señales del relato ───────────────────────────────────────────────────

export interface SenalRelato {
  regla: string;
  etiqueta: string;
  severidad: SeveridadSenal;
  /** La evidencia sin formas de máquina (`limpiarEvidencia`); la redacción de datos personales se hace al dibujarla. */
  evidencia: string | null;
  norma: string | null;
  item: string | null;
  /** El nombre de la otra regla que marca el mismo hecho (se muestra una sola vez, la más grave). */
  tambien: string | null;
  /** El id de su tarjeta en «Por qué llama la atención»: lo lleva la primera señal de cada regla. */
  ancla: string | null;
  /** La bandera tal como llegó del análisis: con ella se arma su panel lateral (quién la encontró, el cotejo, la fuente). */
  origen: Bandera;
}

/** El id de la tarjeta de una regla: los chips de la cronología llevan aquí. */
export const anclaSenal = (regla: string) => `relato-senal-${regla.replace(/[^a-z0-9_-]/gi, "")}`;

const texto = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
};

/**
 * Las señales que cuentan (las `visibles` de `separarBanderas`), de la más grave a la más leve (a igual gravedad, en el
 * orden de la API) y sin la que repite el hecho de otra (`sinRepetidas`, como en la tabla de Señales).
 */
export function senalesDelRelato(banderas: readonly Bandera[]): SenalRelato[] {
  const base = banderas
    .map((b, i) => ({
      i,
      b,
      regla: String(b.regla || "sin_regla"),
      severidad: severidadDe(b),
      evidencia: texto(evidenciaComoTexto(b.evidencia)),
      norma: texto(b.norma),
      item: texto(b.item_afectado),
    }))
    .sort((a, b) => RANGO_SEVERIDAD[a.severidad] - RANGO_SEVERIDAD[b.severidad] || a.i - b.i);
  const vistas = new Set<string>();
  return sinRepetidas(base).map(({ s, tambien }) => {
    const ancla = vistas.has(s.regla) ? null : anclaSenal(s.regla);
    vistas.add(s.regla);
    return {
      regla: s.regla,
      etiqueta: reglaLabel(s.regla),
      severidad: s.severidad,
      evidencia: s.evidencia ? limpiarEvidencia(s.evidencia) : null,
      norma: s.norma,
      item: s.item,
      tambien: tambien ? reglaLabel(tambien.regla) : null,
      ancla,
      origen: s.b,
    };
  });
}

export interface GrupoTema {
  tema: ClaveTema;
  titulo: string;
  senales: SenalRelato[];
}

/** Por tema, en el orden de su señal más grave (las señales ya vienen ordenadas: el primer tema que aparece es el peor). */
export function agruparPorTema(senales: readonly SenalRelato[]): GrupoTema[] {
  const grupos = new Map<ClaveTema, GrupoTema>();
  for (const s of senales) {
    const tema = temaDeRegla(s.regla);
    const g = grupos.get(tema) ?? { tema, titulo: TITULO_TEMA[tema], senales: [] };
    g.senales.push(s);
    grupos.set(tema, g);
  }
  return [...grupos.values()];
}

/** Una señal tal como se pega a un paso de la cronología: una vez por regla, con cuántas veces disparó. */
export interface ChipPaso {
  regla: string;
  etiqueta: string;
  severidad: SeveridadSenal;
  n: number;
  ancla: string;
  /** Las señales de esa regla (su panel las trae todas). */
  senales: SenalRelato[];
}

/**
 * Las señales de cada paso de la cronología. Una regla cuyo paso no está (sin fecha de ofertas, por ejemplo) va al paso
 * presente más cercano (`pasoPresente`); si no hay ninguno, a su paso aunque falte.
 */
export function senalesPorPaso(senales: readonly SenalRelato[], presentes: ReadonlySet<ClavePaso>): Map<ClavePaso, ChipPaso[]> {
  const out = new Map<ClavePaso, ChipPaso[]>();
  for (const s of senales) {
    const objetivo = pasoDeRegla(s.regla);
    const paso = pasoPresente(objetivo, presentes) ?? objetivo;
    const lista = out.get(paso) ?? [];
    const ya = lista.find((c) => c.regla === s.regla);
    if (ya) {
      ya.n++;
      ya.senales.push(s);
      if (RANGO_SEVERIDAD[s.severidad] < RANGO_SEVERIDAD[ya.severidad]) ya.severidad = s.severidad;
    } else {
      lista.push({ regla: s.regla, etiqueta: s.etiqueta, severidad: s.severidad, n: 1, ancla: anclaSenal(s.regla), senales: [s] });
    }
    out.set(paso, lista);
  }
  return out;
}

// ─── Las cifras del proceso ───────────────────────────────────────────────────

/**
 * Referencial, adjudicado y cuánto se aparta uno del otro: la misma lectura que tenían las cifras de la cabecera
 * (`indicadoresDossier`), para que la frase y la cronología digan lo mismo. Sin dato no se inventa un cero.
 */
export function cifrasDelProceso(conv: any, ganador: any): { referencial: number | null; adjudicado: number | null; variacion: number | null } {
  const referencial = Number(conv?.cuantia_total) > 0 ? Number(conv.cuantia_total) : null;
  const adjudicado =
    Number(conv?.monto_adjudicado) > 0 ? Number(conv.monto_adjudicado) : Number(ganador?.monto_ganado) > 0 ? Number(ganador.monto_ganado) : null;
  const variacion = adjudicado !== null && referencial !== null ? ((adjudicado - referencial) / referencial) * 100 : null;
  return { referencial, adjudicado, variacion };
}

/** Dos nombres de la misma persona o empresa, sin mirar mayúsculas, tildes ni puntuación («S.A.C.» = «SAC»). */
export function mismoNombre(a: unknown, b: unknown): boolean {
  const n = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[^\p{L}\p{N}•]+/gu, "").toUpperCase();
  return !!n(a) && n(a) === n(b);
}

// ─── Las palabras de la frase ─────────────────────────────────────────────────

/** «Único postor con oferta alta» → «único postor con oferta alta» dentro de una oración; una sigla («RUC del…») no se toca. */
export function enFrase(t: string): string {
  return /^\p{Lu}\p{Ll}/u.test(t) ? t.charAt(0).toLocaleLowerCase("es") + t.slice(1) : t;
}

/** Corta un texto en un final de palabra, con «…», si pasa de `max` caracteres. */
export function cortar(t: string, max: number): string {
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const esp = corte.lastIndexOf(" ");
  return `${(esp > max * 0.6 ? corte.slice(0, esp) : corte).replace(/[\s,;:.(-]+$/, "")}…`;
}

/**
 * Qué se contrató, para la frase: el objeto sin la palabra que lo abre («Adquisición de dos reservorios…» → «dos
 * reservorios…»), en minúsculas si el SEACE lo escribió en mayúsculas (`oracion`) y corto (el objeto entero es el título
 * de la página, justo arriba). El verbo sale del perfil del análisis: los bienes se compran; lo demás se contrata.
 */
export function queSeContrato(objeto: unknown, perfil: unknown): { verbo: "compró" | "contrató"; que: string } {
  // Sin los «¿» que el SEACE dejó donde iban comillas (limpiarObjeto, como el título de la página).
  const crudo = String(objeto ?? "").trim();
  const limpio = crudo ? oracion(limpiarObjeto(crudo)).replace(/[\s.;:,]+$/, "") : "";
  const esCompra = perfil === "bienes" || (perfil !== "servicios" && perfil !== "obras" && /^(?:adquisici[oó]n|compra|suministro)\b/i.test(limpio));
  const sinApertura = limpio.replace(/^(?:la\s+)?(?:adquisici[oó]n|compra|suministro|contrataci[oó]n)\s+(?:de\s+(?:las?\s+|los\s+)?|del\s+)/i, "");
  // Vacío si no hay objeto registrado: quien lo usa no escribe comillas vacías.
  return { verbo: esCompra ? "compró" : "contrató", que: limpio ? cortar(enFrase(sinApertura || limpio), 72) : "" };
}

/**
 * El artículo de una entidad en la frase («El Ejército Peruano», «La Municipalidad…»). Una sigla o un nombre propio
 * («Essalud», «SUNAT») va sin artículo. Por la primera palabra: lo femenino por su terminación, con sus excepciones.
 */
const MASCULINAS_EN_A = new Set(["programa", "sistema", "consorcio"]);
const FEMENINAS_SIN_A = new Set(["red", "sede", "unidad", "universidad", "municipalidad", "dirección", "direccion", "gerencia", "intendencia",
  "superintendencia", "procuraduría", "defensoría", "contraloría", "comisión", "institución", "región", "mancomunidad", "beneficencia",
  "presidencia", "oficina", "autoridad", "agencia", "corte", "junta", "zona", "caja", "empresa", "escuela", "sociedad", "fuerza", "policía",
  "marina", "aviación", "agrupación", "secretaría", "vicepresidencia", "biblioteca", "central"]);
const MASCULINAS = new Set(["ministerio", "gobierno", "ejército", "ejercito", "hospital", "instituto", "seguro", "proyecto", "servicio",
  "organismo", "poder", "congreso", "jurado", "banco", "fondo", "centro", "consejo", "tribunal", "comando", "registro", "archivo", "despacho",
  "cuerpo", "hogar", "colegio", "museo", "fuero", "comité", "patronato", "parque", "puerto", "aeropuerto", "teatro"]);

export function conArticulo(entidad: string): string {
  const primera = entidad.split(/\s+/)[0] ?? "";
  // Una sigla (todo en mayúsculas) o un nombre propio sin palabra común delante: sin artículo.
  if (!primera || (primera === primera.toLocaleUpperCase("es") && primera.length > 1)) return entidad;
  const p = primera.toLocaleLowerCase("es");
  if (MASCULINAS.has(p) || MASCULINAS_EN_A.has(p)) return `el ${entidad}`;
  if (FEMENINAS_SIN_A.has(p) || /(?:dad|ción|sión|ía|ura|a)$/.test(p)) return `la ${entidad}`;
  if (/o$/.test(p)) return `el ${entidad}`;
  return entidad;
}

/** La primera letra en mayúscula (el comienzo de la frase). */
export const mayusculaInicial = (t: string) => t.charAt(0).toLocaleUpperCase("es") + t.slice(1);

// ─── El resumen del dictamen ──────────────────────────────────────────────────

/** Lo que el capítulo «Lo que dice el análisis» muestra antes de «Leer el dictamen completo». */
const MAX_RESUMEN = 900;

/** Un título del markdown sin marcas de énfasis. */
const tituloLimpio = (x: string) => x.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/** «# Dictamen de investigación — Alerta OECE-…»: el título genérico que el agente pone arriba, que no dice nada. */
export const esTituloGenerico = (x: string) => /^dictamen\b.*\balerta\b/i.test(tituloLimpio(x));

/**
 * El titular del dictamen: lo que pasó, en una línea («Licitación abreviada de CENARES adjudicó… con visita previa del
 * ganador»). El agente lo escribe de varias formas: un «## » sin cuerpo pegado bajo «# Dictamen de investigación — Alerta
 * …», un «## » sin cuerpo seguido de «### Resumen ejecutivo», o un «# » propio. Es el primer título (sin contar el
 * genérico) si es un «# » o si no tiene texto debajo. Antes se pintaba como un capítulo plegable vacío y el «# » genérico
 * hacía de título.
 */
export function titularDelDictamen(md: string): string | null {
  const lineas = md.replace(/\r\n?/g, "\n").split("\n");
  const RX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  const siguiente = (desde: number) => {
    for (let k = desde; k < lineas.length; k++) if (RX.test(lineas[k])) return k;
    return -1;
  };
  for (let k = siguiente(0); k >= 0; k = siguiente(k + 1)) {
    const m = RX.exec(lineas[k])!;
    const texto = tituloLimpio(m[2]);
    if (m[1].length === 1 && esTituloGenerico(texto)) continue;
    if (/^resumen ejecutivo$/i.test(texto)) return null;
    const fin = siguiente(k + 1);
    const cuerpo = lineas.slice(k + 1, fin < 0 ? undefined : fin).join("\n").trim();
    // Sin la nomenclatura del proceso delante («COMPRE-COMPRE-13-2026-HMA-1: Adquisición de…»): ya está en la cabecera.
    return m[1].length === 1 || !cuerpo ? texto.replace(/^[A-Z][A-Z0-9/.]*(?:-[A-Z0-9/.]+)*-\d+[A-Z0-9/.-]*:\s+/, "") : null;
  }
  return null;
}

/**
 * El dictamen plegado a su resumen ejecutivo, en texto plano (el markdown entero, con react-markdown, sólo baja al abrir
 * su pestaña): el título que le puso el análisis y los párrafos de «Resumen ejecutivo», sin marcas ni nombres de campo
 * entre comillas invertidas («(`ocds.buyer.ruc`)»), cortado en un final de oración.
 */
export function resumenDelDictamen(md: string): { titulo: string | null; parrafos: string[]; cortado: boolean } {
  const t = md.replace(/\r\n?/g, "\n");
  const titulo = titularDelDictamen(t);
  const seccion = t.match(/#{2,3}\s*Resumen ejecutivo\s*\n+([\s\S]*?)(?:\n#{1,3}\s|$)/i)?.[1];
  // Sin la sección: lo que va del título al primer subtítulo (o el comienzo del texto).
  const cuerpo = seccion ?? t.replace(/^\s*#\s+.+$/m, "").split(/\n#{1,3}\s/)[0] ?? "";
  const limpiar = (p: string) =>
    p
      .replace(/\s*\(`[^`]*`\)/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Las marcas de énfasis; el guion bajo suelto no (un nombre_de_campo quedaría pegado).
      .replace(/\*+|__/g, "")
      .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  // Sin las rayas horizontales del markdown («---», «***»): quedaban como un párrafo suelto al final del resumen.
  const todos = cuerpo.split(/\n\s*\n/).map(limpiar).filter((p) => p && !/^[-*_\s]{3,}$/.test(p));
  const parrafos: string[] = [];
  let largo = 0;
  let cortado = false;
  for (const p of todos) {
    if (largo + p.length <= MAX_RESUMEN) {
      parrafos.push(p);
      largo += p.length;
      continue;
    }
    cortado = true;
    const resto = MAX_RESUMEN - largo;
    if (resto > 160) {
      const corte = p.slice(0, resto);
      const fin = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
      parrafos.push(fin > resto * 0.4 ? corte.slice(0, fin + 1) : cortar(p, resto));
    }
    break;
  }
  return { titulo, parrafos, cortado: cortado || todos.length > parrafos.length };
}
