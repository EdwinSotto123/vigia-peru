/**
 * `/nativo/v1/messages` servido por Workers AI (con NATIVO_EN_WORKERS_AI=1): recibe el formato de mensajes del
 * proveedor de respaldo y lo traduce al de chat/completions de Workers AI, y la respuesta de vuelta. Así todo lo que
 * hoy pide ese formato (el resumen y el asistente de la plaza, la lectura del CV, el chat de investigación, la lectura
 * de bases escaneadas, los lectores de contratos) pasa a modelos abiertos sin tocar a quien llama.
 *
 * Lo que se traduce:
 *   system (texto o bloques)            → un mensaje "system"
 *   bloques text / image (base64)       → text / image_url (data:)
 *   document (PDF en base64)            → su texto (AI.toMarkdown); si es un escaneo, sus páginas JPEG como imágenes
 *   tool_use (assistant) / tool_result  → tool_calls / mensajes "tool"
 *   tools (input_schema) y tool_choice  → tools (parameters) y tool_choice
 *   output_config.format json_schema    → una herramienta forzada «salida» cuya llamada vuelve como texto JSON
 * El modelo sale de NATIVO_MODELOS (JSON: nombre pedido → id @cf, «*» para el resto); con imágenes y un modelo sin
 * visión, el de NATIVO_MODELO_VISION. Sin streaming.
 */

export interface EnvNativo {
  AI: {
    run(model: string, input: unknown, opts?: unknown): Promise<unknown>;
    toMarkdown?(docs: { name: string; blob: Blob }[]): Promise<{ name?: string; format?: string; data?: string }[] | { data?: string }>;
  };
  MODELO_DEFECTO?: string;
  MODELOS_RETIRADOS?: string;
  NATIVO_MODELOS?: string;
  NATIVO_MODELO_VISION?: string;
  REASONING_EFFORT_DEFECTO?: string;
}

type Bloque = Record<string, any>;
type MensajeOpenAI = Record<string, any>;

const VISION = /deepseek-v4\.1-flash|gemma-4|inkling|qwen3\.8|llama-4-scout|llama-3\.2-11b-vision|mistral-small-3\.1/;
const MAX_IMAGENES = 8;

/** El id de Workers AI para el modelo pedido (p. ej. «claude-haiku-5-5» → GLM 5.3 flash). */
export function modeloPara(env: EnvNativo, pedido: string): string {
  let mapa: Record<string, string> = {};
  try {
    mapa = JSON.parse(env.NATIVO_MODELOS ?? "{}");
  } catch {
    /* mapa vacío */
  }
  return mapa[pedido] ?? mapa["*"] ?? env.MODELO_DEFECTO ?? "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
}

const textoDe = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b: Bloque) => (b?.type === "text" ? b.text ?? "" : "")).join("\n") : "";

function bytesDe(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function base64De(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function buscar(b: Uint8Array, patron: Uint8Array, desde: number): number {
  outer: for (let i = desde; i <= b.length - patron.length; i++) {
    for (let j = 0; j < patron.length; j++) if (b[i + j] !== patron[j]) continue outer;
    return i;
  }
  return -1;
}

async function inflar(b: Uint8Array): Promise<Uint8Array | null> {
  try {
    const r = new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate")));
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Las páginas JPEG de un PDF escaneado (también las guardadas con Flate encima), hasta `max`. */
export async function jpegsDe(pdf: Uint8Array, max = MAX_IMAGENES): Promise<Uint8Array[]> {
  const enc = new TextEncoder();
  const DCT = enc.encode("/DCTDecode"), STREAM = enc.encode("stream"), FIN = enc.encode("endstream");
  const out: Uint8Array[] = [];
  let desde = 0;
  while (out.length < max) {
    const m = buscar(pdf, DCT, desde);
    if (m < 0) break;
    const antes = new TextDecoder("latin1").decode(pdf.subarray(Math.max(0, m - 40), m));
    let i = buscar(pdf, STREAM, m);
    if (i < 0) break;
    i += STREAM.length;
    while (pdf[i] === 0x0d || pdf[i] === 0x0a) i++;
    const j = buscar(pdf, FIN, i);
    if (j < 0) break;
    let k = j;
    while (k > i && (pdf[k - 1] === 0x0d || pdf[k - 1] === 0x0a)) k--;
    const datos = /\/FlateDecode\s*$/.test(antes) ? await inflar(pdf.subarray(i, k)) : pdf.slice(i, k);
    if (datos && datos[0] === 0xff && datos[1] === 0xd8 && datos.byteLength >= 12_000) out.push(datos);
    desde = j + FIN.length;
  }
  return out;
}

/** Un bloque `document` (PDF en base64): su texto o, si es un escaneo, sus páginas como imágenes. */
async function documento(env: EnvNativo, b: Bloque, n: number): Promise<Bloque[]> {
  const src = b.source ?? {};
  if (src.type === "text" && typeof src.data === "string") return [{ type: "text", text: src.data }];
  if (src.type !== "base64" || typeof src.data !== "string") return [];
  const titulo = b.title ? `=== Documento: ${b.title} ===` : `=== Documento ${n} ===`;
  const pdf = bytesDe(src.data);
  let texto = "";
  if (env.AI.toMarkdown) {
    try {
      const r = await env.AI.toMarkdown([{ name: `documento-${n}.pdf`, blob: new Blob([pdf], { type: "application/pdf" }) }]);
      const x = Array.isArray(r) ? r[0] : r;
      texto = typeof x?.data === "string" ? x.data.replace(/^---[\s\S]*?---\s*/, "") : "";
    } catch {
      texto = "";
    }
  }
  if ((texto.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) ?? []).length >= 300) return [{ type: "text", text: `${titulo}\n${texto.slice(0, 120_000)}` }];
  const paginas = await jpegsDe(pdf);
  if (!paginas.length) return [{ type: "text", text: `${titulo}\n${texto || "(documento sin texto legible)"}` }];
  return [
    { type: "text", text: `${titulo} (escaneado: ${paginas.length} páginas como imagen)` },
    ...paginas.map((p) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64De(p)}` } })),
  ];
}

/** Los mensajes del formato nativo como mensajes de chat/completions. */
export async function traducirMensajes(env: EnvNativo, cuerpo: Record<string, any>): Promise<{ mensajes: MensajeOpenAI[]; imagenes: number }> {
  const mensajes: MensajeOpenAI[] = [];
  const sistema = textoDe(cuerpo.system);
  if (sistema) mensajes.push({ role: "system", content: sistema });
  let imagenes = 0;
  let docs = 0;
  for (const m of cuerpo.messages ?? []) {
    if (typeof m.content === "string") {
      mensajes.push({ role: m.role, content: m.content });
      continue;
    }
    const partes: Bloque[] = [];
    const llamadas: Bloque[] = [];
    const resultados: MensajeOpenAI[] = [];
    for (const b of (m.content ?? []) as Bloque[]) {
      if (b.type === "text") partes.push({ type: "text", text: b.text ?? "" });
      else if (b.type === "image" && b.source?.type === "base64") {
        if (imagenes < MAX_IMAGENES) partes.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
        imagenes++;
      } else if (b.type === "document") {
        const d = await documento(env, b, ++docs);
        imagenes += d.filter((x) => x.type === "image_url").length;
        partes.push(...d);
      } else if (b.type === "tool_use") {
        llamadas.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
      } else if (b.type === "tool_result") {
        const c = typeof b.content === "string" ? b.content : textoDe(b.content) || JSON.stringify(b.content ?? "");
        resultados.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `ERROR: ${c}` : c });
      }
    }
    if (m.role === "assistant") {
      const texto = partes.filter((x) => x.type === "text").map((x) => x.text).join("\n");
      mensajes.push({ role: "assistant", content: texto, ...(llamadas.length ? { tool_calls: llamadas } : {}) });
    } else {
      mensajes.push(...resultados);
      if (partes.length) {
        const soloTexto = partes.every((x) => x.type === "text");
        mensajes.push({ role: "user", content: soloTexto ? partes.map((x) => x.text).join("\n") : partes });
      }
    }
  }
  return { mensajes, imagenes };
}

/** El cuerpo para Workers AI (chat/completions) y si la salida estructurada va por una herramienta forzada. */
export async function pedidoWorkers(env: EnvNativo, cuerpo: Record<string, any>): Promise<{ modelo: string; entrada: Record<string, any>; salidaJson: boolean }> {
  const { mensajes, imagenes } = await traducirMensajes(env, cuerpo);
  let modelo = modeloPara(env, String(cuerpo.model ?? ""));
  if (imagenes && !VISION.test(modelo)) modelo = env.NATIVO_MODELO_VISION ?? "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
  const entrada: Record<string, any> = {
    messages: mensajes,
    max_tokens: Math.max(Number(cuerpo.max_tokens) || 4000, 2000),
    reasoning_effort: env.REASONING_EFFORT_DEFECTO ?? "low",
  };
  if (typeof cuerpo.temperature === "number") entrada.temperature = cuerpo.temperature;
  const tools = (cuerpo.tools ?? []).filter((t: Bloque) => t.name && t.input_schema)
    .map((t: Bloque) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));
  let salidaJson = false;
  const esquema = cuerpo.output_config?.format?.type === "json_schema" ? cuerpo.output_config.format.schema : null;
  if (esquema && !tools.length) {
    tools.push({ type: "function", function: { name: "salida", description: "La respuesta, con este esquema.", parameters: esquema } });
    entrada.tool_choice = { type: "function", function: { name: "salida" } };
    salidaJson = true;
  } else if (cuerpo.tool_choice?.type === "tool" && cuerpo.tool_choice.name) {
    entrada.tool_choice = { type: "function", function: { name: cuerpo.tool_choice.name } };
  } else if (cuerpo.tool_choice?.type === "any") {
    entrada.tool_choice = "required";
  } else if (cuerpo.tool_choice?.type === "none") {
    entrada.tool_choice = "none";
  }
  if (tools.length) entrada.tools = tools;
  return { modelo, entrada, salidaJson };
}

/** La respuesta de Workers AI en el formato nativo. */
export function respuestaNativa(salida: any, pedido: string, salidaJson: boolean): Record<string, any> {
  const c = salida?.choices?.[0] ?? {};
  const m = c.message ?? {};
  const contenido: Bloque[] = [];
  const llamadas = (m.tool_calls ?? []) as Bloque[];
  if (salidaJson && llamadas.length) {
    const a = llamadas[0].function?.arguments;
    contenido.push({ type: "text", text: typeof a === "string" ? a : JSON.stringify(a ?? {}) });
  } else {
    const texto = typeof m.content === "string" ? m.content : "";
    if (texto.trim()) contenido.push({ type: "text", text: texto });
    llamadas.forEach((l, i) => {
      let input: unknown = {};
      try {
        input = typeof l.function?.arguments === "string" ? JSON.parse(l.function.arguments) : l.function?.arguments ?? {};
      } catch {
        input = { _crudo: String(l.function?.arguments ?? "").slice(0, 2000) };
      }
      contenido.push({ type: "tool_use", id: l.id || `llamada_${i + 1}`, name: l.function?.name ?? "", input });
    });
  }
  const fin = c.finish_reason;
  const stop = llamadas.length && !salidaJson ? "tool_use" : fin === "length" ? "max_tokens" : "end_turn";
  return {
    id: salida?.id ?? `msg_wai_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: pedido,
    content: contenido,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: salida?.usage?.prompt_tokens ?? 0, output_tokens: salida?.usage?.completion_tokens ?? 0 },
  };
}

/** Tokens de entrada estimados (Workers AI no los cuenta antes): ~3,5 caracteres por token y un fijo por imagen. */
export async function contarTokens(env: EnvNativo, cuerpo: Record<string, any>): Promise<number> {
  const { mensajes, imagenes } = await traducirMensajes(env, cuerpo);
  const chars = JSON.stringify(mensajes.map((m) => (typeof m.content === "string" ? m.content : textoDe(m.content)))).length;
  return Math.ceil(chars / 3.5 + imagenes * 1600 + JSON.stringify(cuerpo.tools ?? []).length / 4);
}
