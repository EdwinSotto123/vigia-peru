/**
 * El dictamen trae siempre una sección "Recortes y datos no verificables" (la pide el prompt del
 * agente que lo redacta): lo que no se pudo comprobar y lo que la lectura dejó fuera (recortes,
 * descartes, validaciones pendientes). Tiene que estar, porque dice hasta dónde llega el análisis,
 * pero está escrita para quien opera el sistema: nombres de límites, claves internas, restos de JSON.
 *
 * Acá se separa del cuerpo para mostrarla plegada bajo un título llano ("Límites de esta revisión"),
 * con ese vocabulario suavizado. No se toca el resto del dictamen ni se inventa nada: lo que no se
 * puede decir en palabras se marca como detalle técnico omitido.
 */

export interface DictamenPartido {
  /** Todo lo anterior a la sección. */
  antes: string;
  /** Nivel del título de la sección (2 = "##"), para rearmar el texto al copiarlo. */
  nivel: number;
  /** La sección, ya suavizada y sin su título; null si el dictamen no la trae. */
  limites: string | null;
  /** Lo que sigue (próximos pasos, fuentes citadas). */
  despues: string;
}

/**
 * Los títulos que escribe el agente del dictamen (backend/agent/agents/report_writer/prompt.py):
 * "## Recortes y datos no verificables", "### Recortes y descartes de esta corrida" y, en dictámenes
 * viejos, "### Topes aplicados por el pipeline y descartes de auditoría"; con o sin número o negrita
 * delante. Sólo esas frases: un título propio del análisis como "## Recortes al presupuesto" no se toca.
 */
const TITULO_LIMITES = /(?:\d+[.)][ \t]*)?(?:\*\*)?(?:Recortes y (?:datos no verificables|descartes)|Topes aplicados por el pipeline)\b.*$/.source;
const RX_SECCION = new RegExp(`^(#{2,4})[ \\t]*${TITULO_LIMITES}`, "im");
const RX_SUBTITULO = new RegExp(`^(#{2,6})[ \\t]*${TITULO_LIMITES}`, "gim");

export function separarLimites(md: string): DictamenPartido {
  const m = RX_SECCION.exec(md);
  if (!m) return { antes: md, nivel: 2, limites: null, despues: "" };
  const nivel = m[1].length;
  const desde = m.index + m[0].length;
  // Termina en el próximo título del mismo nivel o de uno más alto.
  const fin = new RegExp(`^#{1,${nivel}}[ \\t]`, "m").exec(md.slice(desde));
  const hasta = fin ? desde + fin.index : md.length;
  const limites = suavizar(md.slice(desde, hasta)).trim();
  return { antes: md.slice(0, m.index), nivel, limites: limites || null, despues: md.slice(hasta) };
}

/** Título con que la página muestra la sección (y con el que se copia). */
export const TITULO_LLANO_LIMITES = "Límites de esta revisión";

/**
 * El dictamen como se lee en pantalla, para copiarlo: la sección de recortes ya suavizada, bajo su
 * título llano y en su lugar. Nunca el bloque crudo con claves internas que la página no muestra.
 */
export function dictamenLimpio(p: DictamenPartido): string {
  if (!p.limites) return p.antes + p.despues;
  const antes = p.antes.trimEnd();
  const despues = p.despues.trim();
  return [antes, `${"#".repeat(p.nivel)} ${TITULO_LLANO_LIMITES}`, p.limites, despues].filter(Boolean).join("\n\n") + "\n";
}

/** Claves internas que aparecen entre backticks → cómo se llaman para una persona. */
const CLAVES: [RegExp, string][] = [
  [/duplicado_sha256/i, "documento duplicado"],
  [/^market\b/i, "comparación de precios"],
  [/^person_network\b/i, "red de personas"],
  [/^web_research\b/i, "investigación del proveedor"],
  [/^news_research\b/i, "búsqueda de prensa"],
  [/^entity_personnel\b/i, "funcionarios de la entidad"],
  [/^(document|parser|docai|consolidacion_items)/i, "lectura de documentos"],
  [/^persist/i, "guardado de resultados"],
  [/^compliance/i, "evaluación de reglas"],
  [/^(report_writer|dictamen)/i, "redacción del dictamen"],
];

const OMITIDO = "(detalle técnico omitido)";

function codigoLlano(codigo: string): string {
  // Un texto citado entre comillas se lee sin ellas ("Apikey Required" → Apikey Required).
  const t = codigo.trim().replace(/^"([^"]*)"$/, "$1");
  // JSON, hashes o textos largos: no hay forma llana de decirlo.
  if (t.length > 60 || /^[[{]/.test(t) || /[0-9a-f]{32,}/i.test(t)) return OMITIDO;
  // Un nombre con espacios (una carpeta de documentos, un mensaje) queda tal cual, sin formato de código.
  if (!/^[\w.[\]/-]+$/.test(t)) return t;
  const clave = CLAVES.find(([rx]) => rx.test(t));
  if (clave) return clave[1];
  // Un identificador (snake_case, con puntos o índices) se lee con espacios.
  return /[_.]/.test(t) ? t.replace(/\[\d+\]/g, "").replace(/[_.]+/g, " ").trim() : t;
}

const RX_URL = /(https?:\/\/[^\s)\]]+)/g;

/** Lo mismo fuera de los backticks: JSON pegado y claves sueltas. Las URLs no se tocan. */
function prosaLlana(texto: string): string {
  return texto
    .split(RX_URL)
    .map((parte, i) =>
      i % 2
        ? parte
        : parte
            .replace(/\[\{[^\n]*?\}\]/g, OMITIDO)
            .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?:\.[a-z0-9_]+|\[\d+\])*/gi, (id) => codigoLlano(id)),
    )
    .join("");
}

function suavizar(md: string): string {
  const texto = md
    .split("\n")
    // Viñetas que no dicen nada ("* **Descarte en `persist_analysis_outputs`:** None.").
    .filter((l) => !/^\s*[-*+]\s.*:\s*(?:\*\*)?\s*`?(?:None|null)`?\.?\s*$/i.test(l))
    .join("\n")
    .replace(RX_SUBTITULO, "$1 Lo que quedó fuera de la lectura")
    .replace(/\*\*Recortes y descartes[^*]*\*\*/gi, "**Lo que quedó fuera de la lectura**")
    .replace(/\s*\(\s*sha-?256:[^)]*\)/gi, "")
    .replace(/`([^`\n]+)`/g, (_, c: string) => codigoLlano(c));
  return prosaLlana(texto)
    .replace(/\(\(detalle técnico omitido\)\)/g, OMITIDO)
    .replace(/\b[0-9a-f]{64}\b/gi, "");
}
