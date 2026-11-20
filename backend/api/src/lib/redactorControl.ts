/**
 * El redactor del informe para control (lib/informeControl.ts): el texto de cada observación lo escribe un modelo
 * ABIERTO de Workers AI por vigia-llm (`/v1/chat/completions`, como la lectura de bases de lib/basesPlaza.ts), con una
 * herramienta forzada: la salida es JSON con un esquema fijo (sumilla, condición, efecto, causa, qué normas y precedentes
 * de los candidatos vienen al caso y una o dos recomendaciones). Nunca un modelo cerrado: el respaldo de
 * vigia-llm se pide apagado (`x-vigia-respaldo: nunca`).
 *
 * Una llamada por observación (pocas a la vez: Workers AI es compartido). Lo que vuelve se revisa contra la evidencia que
 * se le pasó (`revisarTexto`: cada cifra, fecha, código y RUC tiene que estar ahí; ninguna persona; ninguna palabra que
 * afirme un delito) y lo que no se sostiene se quita o se reemplaza por el texto que arma el código con los mismos datos.
 * Se registran los tokens y el costo de cada llamada con la tarifa del modelo que contestó.
 */
import { z } from "zod";
import {
  CAUSA_NO_DETERMINADA, condicionDeRespaldo, datosTema, oraciones, palabrasDe, permitidasDe, procesoParaModelo, revisarTexto, senalParaModelo, tituloNorma,
  type DatosProceso, type GrupoObservacion, type NormaCriterio, type Precedente, type RedaccionObservacion,
} from "./informeControl.js";

/** GLM 5.3 escribe mejor el registro formal; GLM 5.3 flash es el de respaldo (más rápido y barato). */
export const MODELO_REDACTOR = "@cf/zai-org/glm-5.3";
// GLM 5.3 flash lo retiró Workers AI el 2026-11-20: su reemplazo.
export const MODELO_REDACTOR_RAPIDO = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";

/**
 * USD por millón de tokens (entrada, salida), los de backend/agent/tools/costo_llm.py: GLM 5.3 flash medido el
 * 2026-10-12 en neuronas de Workers AI; GLM 5.3 estimado por la razón de neuronas. Si vigia-llm pasó el pedido a un
 * modelo hermano por estar saturado (DeepSeek, Qwen), se cobra con la tarifa más alta: el costo nunca queda corto.
 */
const TARIFAS: Record<string, [number, number]> = {
  "@cf/zai-org/glm-5.3-flash": [0.15, 0.5],
  "@cf/zai-org/glm-5.3": [1.32, 4.4],
  "@cf/deepseek-ai/deepseek-v4.1-flash-1017": [0.3, 1.2],
  "@cf/google/gemma-4-26b-a4b-it": [0.1, 0.3],
};
const TARIFA_DESCONOCIDA: [number, number] = [1.32, 4.4];
export const costoUsd = (modelo: string, entrada: number, salida: number) => {
  const [a, b] = TARIFAS[modelo] ?? TARIFA_DESCONOCIDA;
  return (entrada * a + salida * b) / 1_000_000;
};
/** «glm-5.3» (sin el prefijo de Workers AI) para el documento y la base. */
export const nombreModelo = (id: string) => id.replace(/^workers-ai:/, "").split("/").pop() ?? id;

export interface EnvLlm {
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  LLM_TOKEN?: string;
}

export const SISTEMA = `Redactas observaciones con la estructura de los informes de control de la Contraloría General de la República del Perú (condición, efecto y causa) a partir de indicios que Vigía by Gobserva detectó con datos públicos sobre UN procedimiento de contratación del Estado.

Reglas obligatorias:
1. Usa SOLO los hechos de la evidencia (el JSON entre <evidencia> y </evidencia>). No agregues hechos, cifras, fechas, nombres, documentos, cargos ni normas que no estén ahí.
2. Copia cada cifra, fecha, código y RUC tal como aparece en la evidencia (montos como «S/ 1,112,981.43», fechas como «1 de junio de 2026»). No hagas cuentas ni redondees: si una diferencia, una suma o un porcentaje no está escrito en la evidencia, no lo escribas.
3. Son indicios, no hallazgos de auditoría: usa lenguaje condicional («se habría», «podría», «constituiría un indicio de») y la palabra «indicio». Nunca afirmes que hubo delito, corrupción, colusión, dolo, perjuicio cierto ni responsabilidad de nadie.
4. No nombres a ninguna persona natural ni le atribuyas responsabilidad: refiérete a órganos y cargos («la Entidad», «el comité de selección», «el área usuaria») y a las empresas por su razón social y su RUC.
5. No cites leyes, artículos, opiniones ni informes en el texto: el criterio normativo y los precedentes los agrega el sistema. Sólo elige, de las listas que se te dan, los que vienen al caso (por su id).
6. Los datos generales del proceso (entidad, objeto, valor referencial, fechas de convocatoria y de buena pro) ya están en la Información general del documento: no los repitas en la condición salvo que sean parte del hecho observado.
7. Si un dato no está en la evidencia (un RUC, un monto, una fecha), no lo menciones: nunca escribas «no consignado», «de la evidencia» ni un marcador en su lugar.
8. Registro formal de un informe de control, en tercera persona y en español del Perú. Sin viñetas, sin títulos y sin el carácter «·».

Qué devuelves con la herramienta «observacion»:
- sumilla: una oración de 12 a 30 palabras con el hecho y su riesgo, como la sumilla de una observación de la Contraloría (por ejemplo: «Factores de evaluación que coincidirían con las características de un solo fabricante habrían restringido la concurrencia de postores»).
- condicion: de 1 a 3 párrafos con los hechos en orden: qué se registró, cuándo, por cuánto y según qué registro o documento.
- efecto: un párrafo con el riesgo o el posible perjuicio para la Entidad; cuantifícalo sólo con cifras que estén escritas en la evidencia.
- causa: «${CAUSA_NO_DETERMINADA}» salvo que la evidencia diga expresamente por qué ocurrió el hecho.
- criterios: los id de las normas candidatas que regulan el hecho (de 0 a 3), en orden de pertinencia.
- precedentes: los id de las observaciones de informes de control que tratan un hecho parecido (de 0 a 3); ninguno si no se parecen.
- recomendaciones: 1 o 2 acciones concretas para el órgano de control, la primera la más concreta (qué documento requerir a la Entidad o qué verificar), sin atribuir responsabilidades.`;

const ESQUEMA = {
  type: "object",
  properties: {
    sumilla: { type: "string", description: "Una oración de 12 a 30 palabras: el hecho y su riesgo." },
    condicion: { type: "array", items: { type: "string" }, description: "De 1 a 3 párrafos con los hechos de la evidencia." },
    efecto: { type: "string", description: "Un párrafo: el riesgo o el posible perjuicio, sólo con cifras de la evidencia." },
    causa: { type: "string", description: `«${CAUSA_NO_DETERMINADA}» salvo que la evidencia la diga.` },
    criterios: { type: "array", items: { type: "string" }, description: "Ids de las normas candidatas que regulan el hecho (0 a 3)." },
    precedentes: { type: "array", items: { type: "string" }, description: "Ids de los precedentes parecidos (0 a 3)." },
    recomendaciones: { type: "array", items: { type: "string" }, description: "1 o 2 acciones para el órgano de control." },
  },
  required: ["sumilla", "condicion", "efecto", "causa", "criterios", "precedentes", "recomendaciones"],
  additionalProperties: false,
} as const;

const HERRAMIENTA = {
  type: "function",
  function: { name: "observacion", description: "La observación redactada, con este esquema.", parameters: ESQUEMA },
} as const;

const lista = z.union([z.array(z.string()), z.string()]).transform((x) => (Array.isArray(x) ? x : [x]).map((s) => s.trim()).filter(Boolean));
/** Lo que se acepta del modelo (estricto en la forma; el contenido lo revisa `aplicarRevision`). */
export const SalidaModelo = z.object({
  sumilla: z.string().trim().min(5).max(600),
  condicion: lista.pipe(z.array(z.string().max(2400)).min(1).max(6)),
  efecto: z.string().trim().max(2400).default(""),
  causa: z.string().trim().max(1200).default(CAUSA_NO_DETERMINADA),
  criterios: z.array(z.string().max(10)).max(8).default([]),
  precedentes: z.array(z.string().max(10)).max(8).default([]),
  recomendaciones: lista.pipe(z.array(z.string().max(800)).max(5)).default([]),
});
export type SalidaModeloT = z.infer<typeof SalidaModelo>;

/** Los argumentos de la herramienta en una respuesta de chat/completions (o un JSON suelto en el texto). */
export function argumentosDe(j: unknown): unknown {
  const m = (j as { choices?: { message?: { content?: unknown; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } }[] })?.choices?.[0]?.message;
  const llamada = (m?.tool_calls ?? []).find((t) => t.function?.name === "observacion") ?? m?.tool_calls?.[0];
  const args = llamada?.function?.arguments;
  if (args && typeof args === "object") return args;
  const crudo = typeof args === "string" ? args : typeof m?.content === "string" ? m.content : "";
  const i = crudo.indexOf("{");
  const k = crudo.lastIndexOf("}");
  if (i < 0 || k <= i) return null;
  try {
    return JSON.parse(crudo.slice(i, k + 1));
  } catch {
    return null;
  }
}

/** Lo que recibe el modelo para UNA observación: la evidencia (proceso y hechos), las normas y los precedentes candidatos. */
export function entradaObservacion(p: DatosProceso, g: GrupoObservacion, normas: NormaCriterio[], precedentes: Precedente[]): { usuario: string; evidencia: string } {
  const evidencia = JSON.stringify({
    proceso: procesoParaModelo(p),
    observacion: { tema: g.titulo, hechos: g.senales.map(senalParaModelo) },
  });
  const normasModelo = normas.map((n) => ({
    id: n.id,
    norma: tituloNorma(n),
    tema: n.epigrafe ?? undefined,
    texto: n.extracto.slice(0, 450),
  }));
  const precedentesModelo = precedentes.map((q) => ({
    id: q.id,
    informe: q.numero ?? q.codigo,
    entidad: q.entidad ?? undefined,
    anio: q.anio ?? undefined,
    observacion: (q.observacion ?? q.titulo ?? "").slice(0, 450),
  }));
  const usuario = [
    `<evidencia>${evidencia}</evidencia>`,
    `<normas_candidatas>${JSON.stringify(normasModelo)}</normas_candidatas>`,
    `<precedentes_candidatos>${JSON.stringify(precedentesModelo)}</precedentes_candidatos>`,
    "Redacta la observación con la herramienta «observacion».",
  ].join("\n\n");
  return { usuario, evidencia };
}

export interface Llamada {
  args: unknown;
  entrada: number;
  salida: number;
  /** El modelo que contestó (vigia-llm lo dice en `x-vigia-modelo`; puede ser un hermano si el pedido estaba saturado). */
  modelo: string;
  ms: number;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un pedido al modelo con la herramienta forzada. Un 429 o un 5xx se reintenta una vez. Tira "sin_modelo" o "modelo_<status>". */
export async function pedirModelo(env: EnvLlm, modelo: string, usuario: string, opciones: { plazoMs?: number; reintentar?: boolean } = {}): Promise<Llamada> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("sin_modelo");
  const t0 = Date.now();
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), opciones.plazoMs ?? 120_000);
  try {
    for (let intento = 0; ; intento++) {
      const r = await env.LLM.fetch(
        new Request("https://vigia-llm.interno/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_TOKEN}`, "x-vigia-respaldo": "nunca" },
          body: JSON.stringify({
            model: modelo,
            messages: [{ role: "system", content: SISTEMA }, { role: "user", content: usuario }],
            tools: [HERRAMIENTA],
            tool_choice: { type: "function", function: { name: "observacion" } },
            reasoning_effort: "low",
            temperature: 0.2,
            max_tokens: 3000,
          }),
          signal: control.signal,
        }),
      );
      if (!r.ok) {
        if (intento === 0 && opciones.reintentar !== false && (r.status === 429 || r.status >= 500)) {
          await espera(r.status === 429 ? 15_000 : 3_000);
          continue;
        }
        throw new Error(`modelo_${r.status}`);
      }
      const j = (await r.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const quien = (r.headers.get("x-vigia-modelo") ?? "").replace(/^workers-ai:/, "") || modelo;
      return { args: argumentosDe(j), entrada: j.usage?.prompt_tokens ?? 0, salida: j.usage?.completion_tokens ?? 0, modelo: quien, ms: Date.now() - t0 };
    }
  } finally {
    clearTimeout(reloj);
  }
}

// ─── Lo que vuelve del modelo, revisado ──────────────────────────────────────────────────────────────────────────────

/**
 * ¿Una oración de la condición se apoya en la evidencia? La mayoría de sus palabras con contenido (de 5 letras o más y
 * que no son del vocabulario del informe) tiene que estar en ella: una condición inventada sin cifras no pasa.
 */
export function apoyadaEnEvidencia(oracion: string, palabrasEvidencia: Set<string>): boolean {
  const ws = palabrasDe(oracion);
  if (ws.length < 5) return true;
  const raiz = (w: string) => w.slice(0, 6);
  const dentro = ws.filter((w) => palabrasEvidencia.has(raiz(w))).length;
  return dentro / ws.length >= 0.5;
}

/** Una causa sólo va si la evidencia la dice: todas sus palabras con contenido están en ella (y dice algo: dos o más). */
export function causaEnEvidencia(causa: string, palabrasEvidencia: Set<string>): boolean {
  const ws = palabrasDe(causa);
  return ws.length >= 2 && ws.every((w) => palabrasEvidencia.has(w.slice(0, 6)));
}

/**
 * La salida del modelo, revisada: cada texto sin las oraciones que no se sostienen; la condición, además, apoyada en la
 * evidencia (si se cae más de la mitad, va la de respaldo); los ids de normas y precedentes, sólo los que se le dieron.
 */
export function aplicarRevision(
  salida: SalidaModeloT | null,
  g: GrupoObservacion,
  evidencia: string,
  normas: NormaCriterio[],
  precedentes: Precedente[],
): RedaccionObservacion {
  const tema = datosTema(g.tema);
  const respaldo: RedaccionObservacion = {
    sumilla: g.titulo,
    condicion: condicionDeRespaldo(g),
    efecto: tema.efecto,
    causa: CAUSA_NO_DETERMINADA,
    criterios: [],
    precedentes: [],
    recomendaciones: [],
    redaccion: "datos",
    quitadas: [],
    cifras: 0,
  };
  if (!salida) return respaldo;
  const permitidas = permitidasDe(evidencia);
  const palabras = new Set(palabrasDe(evidencia).map((w) => w.slice(0, 6)));
  const quitadas: RedaccionObservacion["quitadas"] = [];
  let cifras = 0;
  const revisar = (t: string) => {
    const r = revisarTexto(t, permitidas);
    quitadas.push(...r.quitadas);
    cifras += r.cifras;
    return r.texto;
  };

  const sumilla = revisar(salida.sumilla).replace(/[.\s]+$/, "");
  let totalOraciones = 0;
  let quitadasCondicion = 0;
  const condicion = salida.condicion.slice(0, 3).map((parrafo) => {
    const r = revisarTexto(parrafo, permitidas);
    cifras += r.cifras;
    quitadas.push(...r.quitadas);
    const partes = oraciones(r.texto);
    totalOraciones += partes.length + r.quitadas.length;
    quitadasCondicion += r.quitadas.length;
    const apoyadas = partes.filter((o) => {
      if (apoyadaEnEvidencia(o, palabras)) return true;
      quitadas.push({ oracion: o, motivo: "no se apoya en la evidencia" });
      quitadasCondicion++;
      return false;
    });
    return apoyadas.join(" ").trim();
  }).filter(Boolean);
  const condicionSostenida = condicion.length > 0 && quitadasCondicion * 2 <= totalOraciones;

  const efecto = revisar(salida.efecto);
  let causa = CAUSA_NO_DETERMINADA;
  const causaModelo = salida.causa.trim();
  if (causaModelo && !/^no (se )?(ha )?determinad/i.test(causaModelo) && !/no determinada/i.test(causaModelo)) {
    const r = revisarTexto(causaModelo, permitidas);
    // Una causa que no está en la evidencia es una suposición: no va.
    if (r.texto && r.quitadas.length === 0 && causaEnEvidencia(r.texto, palabras)) causa = r.texto;
    else quitadas.push(...(r.quitadas.length ? r.quitadas : [{ oracion: causaModelo, motivo: "causa que la evidencia no dice" }]));
  }
  const idsNormas = new Set(normas.map((n) => n.id));
  const idsPrecedentes = new Set(precedentes.map((q) => q.id));
  const recomendaciones = salida.recomendaciones.slice(0, 2).map((x) => revisar(x)).filter((x) => x.length >= 20).map((x) => x.slice(0, 500));

  return {
    sumilla: sumilla.length >= 20 ? sumilla.slice(0, 300) : respaldo.sumilla,
    condicion: condicionSostenida ? condicion : respaldo.condicion,
    efecto: efecto.length >= 30 ? efecto : respaldo.efecto,
    causa,
    criterios: [...new Set(salida.criterios.map((x) => x.trim().toUpperCase()).filter((x) => idsNormas.has(x)))].slice(0, 3),
    precedentes: [...new Set(salida.precedentes.map((x) => x.trim().toUpperCase()).filter((x) => idsPrecedentes.has(x)))].slice(0, 3),
    recomendaciones,
    redaccion: condicionSostenida ? "modelo" : "datos",
    quitadas,
    cifras,
  };
}

// ─── Todas las observaciones ─────────────────────────────────────────────────────────────────────────────────────────

export interface ResultadoRedaccion {
  redacciones: Map<string, RedaccionObservacion>;
  entrada: number;
  salida: number;
  costo: number;
  /** Los modelos que contestaron (normalmente uno). */
  modelos: string[];
  llamadas: number;
  fallas: string[];
}

/**
 * Redacta cada observación (de a `concurrencia`): con `modelo` y, si falla o su salida no tiene la forma, una vez más con
 * el rápido. Lo que no se pudo redactar queda con el texto de respaldo. `plazoTotalMs`: pasado ese tiempo, las que
 * faltan van con el texto de respaldo (el pedido no puede quedar colgado).
 */
export async function redactarObservaciones(
  env: EnvLlm,
  p: DatosProceso,
  grupos: GrupoObservacion[],
  normas: Map<string, NormaCriterio[]>,
  precedentes: Map<string, Precedente[]>,
  opciones: { modelo?: string; concurrencia?: number; plazoTotalMs?: number; registrar?: (e: Record<string, unknown>) => void } = {},
): Promise<ResultadoRedaccion> {
  const modelo = opciones.modelo ?? MODELO_REDACTOR;
  const fin = Date.now() + (opciones.plazoTotalMs ?? 170_000);
  const out: ResultadoRedaccion = { redacciones: new Map(), entrada: 0, salida: 0, costo: 0, modelos: [], llamadas: 0, fallas: [] };
  const cola = [...grupos];
  const trabajar = async () => {
    for (let g = cola.shift(); g; g = cola.shift()) {
      const ns = normas.get(g.id) ?? [];
      const ps = precedentes.get(g.id) ?? [];
      const { usuario, evidencia } = entradaObservacion(p, g, ns, ps);
      let salida: SalidaModeloT | null = null;
      for (const m of [modelo, ...(modelo === MODELO_REDACTOR_RAPIDO ? [] : [MODELO_REDACTOR_RAPIDO])]) {
        const queda = fin - Date.now();
        if (queda < 15_000) {
          out.fallas.push(`${g.id}: sin tiempo`);
          break;
        }
        try {
          const ll = await pedirModelo(env, m, usuario, { plazoMs: Math.min(120_000, queda) });
          out.llamadas++;
          out.entrada += ll.entrada;
          out.salida += ll.salida;
          out.costo += costoUsd(ll.modelo, ll.entrada, ll.salida);
          if (!out.modelos.includes(ll.modelo)) out.modelos.push(ll.modelo);
          const leido = SalidaModelo.safeParse(ll.args);
          opciones.registrar?.({ observacion: g.id, modelo: ll.modelo, ms: ll.ms, entrada: ll.entrada, salida: ll.salida, forma: leido.success });
          if (leido.success) {
            salida = leido.data;
            break;
          }
          out.fallas.push(`${g.id}: salida sin la forma (${m})`);
        } catch (e) {
          out.fallas.push(`${g.id}: ${String((e as Error)?.message ?? e).slice(0, 80)} (${m})`);
        }
      }
      out.redacciones.set(g.id, aplicarRevision(salida, g, evidencia, ns, ps));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opciones.concurrencia ?? 2, grupos.length)) }, trabajar));
  return out;
}
