/**
 * El asistente de un proceso (Gobserva Licitaciones, 2026-11-07): responde las preguntas de un proveedor sobre UNA
 * convocatoria con los datos de su ficha (fichaOportunidad: objeto, ítems, cronograma publicado, el comprador en 12
 * meses, procesos parecidos con precio, precios de referencia, documentos y enlaces). No lee el PDF de las bases: de
 * las convocatorias abiertas todavía no hay texto de documentos indexado, así que lo que está sólo en las bases (los
 * requisitos, la fecha de presentación de ofertas) lo dice y manda al SEACE. Nunca inventa cifras ni fechas.
 *
 * El modelo va por vigia-llm (/nativo, la clave vive allá), Haiku 5.5: rápido y barato para una pregunta corta.
 */

export const MODELO_ASISTENTE = "claude-haiku-5-5";
export const LARGO_PREGUNTA = 500;
export const MAX_HISTORIAL = 6;

export interface MensajeAsistente {
  rol: "usuario" | "asistente";
  texto: string;
}

const SISTEMA = `Eres el asistente de Gobserva Licitaciones. Un proveedor te pregunta por UN proceso de contratación del Estado peruano.
Respondes SOLO con los datos de la ficha que te damos (JSON entre <ficha> y </ficha>).
Reglas:
- Si la respuesta no está en la ficha (por ejemplo, los requisitos de calificación, la experiencia exigida, la fecha de presentación de ofertas o las garantías, que están en las bases), dilo con claridad y sugiere leer las bases del proceso en el SEACE (el enlace está en "enlaces.oece").
- No inventes cifras, fechas, nombres ni requisitos. Si das una cifra o una fecha, que sea la de la ficha.
- Compara cada plazo con la fecha de hoy ("hoy" en la ficha, hora de Lima): si ya pasó, dilo («las consultas cerraron el …») y no lo sugieras como algo por hacer.
- Las señales de riesgo y el historial del comprador son señales para decidir, nunca acusaciones.
- Los precios de procesos parecidos y de referencia sirven para estimar una oferta: di de dónde salen (cuántas compras, qué año).
- Español peruano, de tú, claro y breve: hasta 150 palabras. Usa viñetas con «- » cuando ayuden. Sin títulos ni tablas.`;

/** La ficha, recortada a lo que sirve para responder (sin URLs largas de documentos ni campos vacíos). */
export function contextoFicha(f: Record<string, unknown>, ahora: Date = new Date()): string {
  const items = Array.isArray(f.items) ? (f.items as Record<string, unknown>[]).slice(0, 40) : [];
  const documentos = Array.isArray(f.documentos) ? (f.documentos as Record<string, unknown>[]).map((d) => ({ titulo: d.titulo, tipo: d.tipo, fecha: d.fecha })) : [];
  const parecidos = Array.isArray(f.parecidos) ? (f.parecidos as Record<string, unknown>[]).slice(0, 8) : [];
  const limpio = {
    hoy: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(ahora),
    codigo: f.codigo,
    objeto: f.objeto,
    descripcion: f.descripcion,
    tipo: f.tipo,
    procedimiento: f.procedimiento,
    etapa: f.etapa,
    valorReferencial: f.valor,
    fechaConvocatoria: f.fecha,
    consultasYObservaciones: f.consultas,
    entidad: f.entidad,
    entidadRuc: f.entidadRuc,
    lugar: [f.entidadProvincia, f.entidadRegion].filter(Boolean).join(", ") || null,
    items,
    documentosPublicados: documentos,
    compradorUltimos12Meses: f.inteligencia,
    procesosParecidosAdjudicados: parecidos,
    preciosDeReferencia: f.precios,
    enlaces: f.enlaces,
  };
  return JSON.stringify(limpio, (_k, v) => (v === null || v === "" || (Array.isArray(v) && v.length === 0) ? undefined : v));
}

/** La conversación para el modelo: la ficha va en el primer mensaje del usuario (y a la caché), luego el historial. */
export function mensajesAsistente(ficha: Record<string, unknown>, historial: MensajeAsistente[], pregunta: string) {
  const previos = historial.slice(-MAX_HISTORIAL).map((m) => ({ role: m.rol === "usuario" ? "user" : "assistant", content: m.texto.slice(0, 1500) }));
  // El historial alterna usuario/asistente y empieza por el usuario.
  while (previos.length && previos[0].role !== "user") previos.shift();
  return {
    system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: `<ficha>${contextoFicha(ficha)}</ficha>`, cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: "Tengo la ficha. ¿Qué quieres saber?" },
      ...previos,
      { role: "user", content: pregunta.slice(0, LARGO_PREGUNTA) },
    ],
  };
}

interface EnvLlm {
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  LLM_TOKEN?: string;
}

/** Pregunta al modelo; devuelve el texto de la respuesta. Lanza si el modelo no está configurado o falla. */
export async function preguntarAsistente(env: EnvLlm, ficha: Record<string, unknown>, historial: MensajeAsistente[], pregunta: string): Promise<{ texto: string; entrada: number; salida: number }> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("sin_modelo");
  const { system, messages } = mensajesAsistente(ficha, historial, pregunta);
  const r = await env.LLM.fetch(
    new Request("https://vigia-llm.interno/nativo/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.LLM_TOKEN, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODELO_ASISTENTE, max_tokens: 700, system, messages }),
    }),
  );
  if (!r.ok) throw new Error(`modelo_${r.status}`);
  const j = (await r.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const texto = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  return { texto, entrada: j.usage?.input_tokens ?? 0, salida: j.usage?.output_tokens ?? 0 };
}
