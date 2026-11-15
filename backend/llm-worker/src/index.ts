/**
 * vigia-llm — Workers AI detrás de una API tipo OpenAI, con un proveedor de respaldo.
 *
 *   POST /v1/chat/completions   { model, messages, tools?, stream?, temperature?, max_tokens? }
 *   GET  /v1/models             modelos permitidos
 *   POST /v1/embeddings         { input } → vectores de @cf/baai/bge-m3 (1 024 dimensiones)
 *   GET  /salud                 sin auth
 *   *    /nativo/v1/…           API nativa del proveedor de respaldo, de paso (ver `nativo`)
 *
 * Auth: `Authorization: Bearer <LLM_TOKEN>`. El modelo debe estar en MODELOS_PERMITIDOS; sin modelo (o
 * "default") va MODELO_DEFECTO.
 *
 * Respaldo: si Workers AI falla (error, corte 3046, respuesta vacía), la misma petición va a un proveedor con API
 * compatible con OpenAI, configurado sólo con secretos: RESPALDO_URL (…/v1/chat/completions), RESPALDO_TOKEN
 * (Bearer), RESPALDO_MODELO y, si el proveedor las pide, RESPALDO_CABECERAS (JSON). Sin esos secretos no hay respaldo y el error se devuelve como antes. La cabecera
 * `x-vigia-modelo` de la respuesta dice quién contestó (`workers-ai:<id>` o `respaldo`); `x-vigia-respaldo:
 * forzar` en la petición, o `model: "respaldo"`, salta Workers AI y usa sólo el respaldo.
 * `x-vigia-respaldo: nunca` hace lo contrario: si Workers AI falla, devuelve el error en vez de ir al respaldo.
 *
 * Sólo modelos abiertos (2026-11-10, pedido del usuario): RESPALDO_APAGADO=1 quita el respaldo (y `model: "respaldo"`
 * va al modelo por defecto de Workers AI) y NATIVO_EN_WORKERS_AI=1 sirve `/nativo/v1/messages` con Workers AI
 * (src/nativoWorkers.ts: el mismo formato, traducido), con el modelo de NATIVO_MODELOS.
 *
 * No registra el contenido de los mensajes (pueden traer datos de contratos).
 */
import { contarTokens, pedidoWorkers, respuestaNativa, type EnvNativo } from "./nativoWorkers";

interface Env extends EnvNativo {
  LLM_TOKEN?: string;
  MODELOS_PERMITIDOS: string;
  MODELO_DEFECTO?: string;
  /** Esfuerzo de razonamiento si la petición no trae `reasoning_effort` (low|medium|high). GLM razona sin parar por defecto. */
  REASONING_EFFORT_DEFECTO?: string;
  /** Tope de tokens de salida si la petición no trae `max_tokens` (evita timeouts 3046 de Workers AI). */
  MAX_TOKENS_DEFECTO?: string;
  RESPALDO_URL?: string;
  RESPALDO_TOKEN?: string;
  RESPALDO_MODELO?: string;
  /** Cabeceras extra del proveedor de respaldo, como JSON ({"nombre": "valor"}). Opcional. */
  RESPALDO_CABECERAS?: string;
  /** Base de la API NATIVA del proveedor de respaldo (sin /v1), para `/nativo/v1/*`. Sin ella no hay ruta nativa. */
  RESPALDO_NATIVO_URL?: string;
  /** Cabecera donde la API nativa espera la clave (por defecto `authorization: Bearer`). */
  RESPALDO_NATIVO_CABECERA?: string;
  /** "1": sin respaldo nunca (sólo Workers AI). */
  RESPALDO_APAGADO?: string;
  /** "1": `/nativo/v1/messages` lo responde Workers AI, traducido (src/nativoWorkers.ts). */
  NATIVO_EN_WORKERS_AI?: string;
  /** JSON id → [ids]: a quién pasar el pedido si el modelo está en su tope por minuto (correrConHermanos). */
  MODELOS_HERMANOS?: string;
}

/** `/nativo/v1/messages` (y count_tokens) con Workers AI, en el mismo formato. */
async function nativoEnWorkersAI(req: Request, env: Env, url: URL): Promise<Response> {
  const ruta = url.pathname.slice("/nativo".length);
  if (req.method !== "POST" || !/^\/v1\/messages(\/count_tokens)?$/.test(ruta)) {
    return json({ type: "error", error: { type: "not_found_error", message: `sin equivalente en Workers AI: ${ruta}` } }, 404);
  }
  const cuerpo = (await req.json().catch(() => null)) as Record<string, any> | null;
  if (!cuerpo || !Array.isArray(cuerpo.messages)) return json({ type: "error", error: { type: "invalid_request_error", message: "falta messages" } }, 400);
  if (ruta.endsWith("/count_tokens")) return json({ input_tokens: await contarTokens(env, cuerpo) });
  if (cuerpo.stream) return json({ type: "error", error: { type: "invalid_request_error", message: "sin streaming en Workers AI" } }, 400);
  const { modelo, entrada, salidaJson } = await pedidoWorkers(env, cuerpo);
  const r = await correrConHermanos(env, modelo, entrada);
  const quien = { "x-vigia-modelo": `workers-ai:${r.quien}` };
  if (r.falla) {
    return json({ type: "error", error: { type: SATURADO.test(r.falla) ? "rate_limit_error" : "api_error", message: r.falla.slice(0, 300) } },
      SATURADO.test(r.falla) ? 429 : /3046|timeout/i.test(r.falla) ? 504 : 502, quien);
  }
  return json(respuestaNativa(r.salida, String(cuerpo.model ?? modelo), salidaJson), 200, quien);
}

/**
 * `/nativo/v1/*` → la API nativa del proveedor de respaldo, tal cual (cuerpo y respuesta en streaming), con la
 * clave del Worker. Es para el motor de agentes por SDK (backend/agent/motores/motor_sdk), que no habla el
 * formato tipo OpenAI: así la clave del proveedor sigue viviendo solo aquí.
 */
async function nativo(req: Request, env: Env, url: URL): Promise<Response> {
  // `x-vigia-nativo: workers` lo pide para una sola petición (para probar antes de encenderlo para todos).
  if (env.NATIVO_EN_WORKERS_AI === "1" || req.headers.get("x-vigia-nativo") === "workers") return nativoEnWorkersAI(req, env, url);
  if (env.RESPALDO_APAGADO === "1") return json({ error: { message: "respaldo apagado: sólo Workers AI" } }, 503);
  if (!env.RESPALDO_NATIVO_URL || !env.RESPALDO_TOKEN) return json({ error: { message: "sin API nativa configurada" } }, 503);
  const destino = env.RESPALDO_NATIVO_URL.replace(/\/+$/, "") + url.pathname.slice("/nativo".length) + url.search;
  const h = new Headers();
  for (const [k, v] of req.headers) {
    const kl = k.toLowerCase();
    if (kl === "authorization" || kl === "x-api-key" || kl === "host" || kl.startsWith("cf-") || kl.startsWith("x-forwarded")) continue;
    h.set(k, v);
  }
  for (const [k, v] of Object.entries(extras(env))) h.set(k, v);
  const cab = (env.RESPALDO_NATIVO_CABECERA ?? "authorization").toLowerCase();
  h.set(cab, cab === "authorization" ? `Bearer ${env.RESPALDO_TOKEN}` : env.RESPALDO_TOKEN);
  const r = await fetch(destino, { method: req.method, headers: h, body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body });
  const out = new Headers(r.headers);
  out.set("x-vigia-modelo", "respaldo-nativo");
  return new Response(r.body, { status: r.status, headers: out });
}

/**
 * Los modelos «hermanos» de cada uno (MODELOS_HERMANOS, JSON id → [ids]): si el pedido choca con el tope por minuto
 * del modelo (3021) o su capacidad (3040), se prueba el siguiente hermano antes de fallar. Medido 2026-11-10: los
 * agentes y los lectores en paralelo pasaban el tope de GLM 5.3 flash y el 10 % de los pedidos fallaba. Con imágenes,
 * sólo los hermanos que las leen.
 */
const VISION_HERMANOS = /glm-5\.3-flash|deepseek-v4\.1-flash|kimi-k2\.6|qwen3\.8|llama-4-scout|mistral-small-3\.1/;
const SATURADO = /3021|3040|rate limit|capacity|too many requests/i;

function hermanos(env: Env, modelo: string, conImagenes: boolean): string[] {
  let mapa: Record<string, string[]> = {};
  try {
    mapa = JSON.parse(env.MODELOS_HERMANOS ?? "{}");
  } catch {
    /* sin hermanos */
  }
  return (mapa[modelo] ?? []).filter((m) => m !== modelo && (!conImagenes || VISION_HERMANOS.test(m)));
}

const tieneImagenes = (entrada: Record<string, any>) =>
  JSON.stringify(entrada.messages ?? []).includes('"image_url"');

/** Corre el pedido en el modelo y, si está saturado, en sus hermanos. Devuelve quién contestó o el último error. */
export async function correrConHermanos(env: Env, modelo: string, entrada: Record<string, any>): Promise<{ salida?: unknown; quien: string; falla?: string }> {
  const lista = [modelo, ...hermanos(env, modelo, tieneImagenes(entrada))];
  let falla = "";
  for (const m of lista) {
    try {
      const salida = await env.AI.run(m, entrada);
      if (!vacia(salida) || (entrada.stream && salida instanceof ReadableStream)) return { salida, quien: m };
      falla = "respuesta vacía de Workers AI";
      return { quien: m, falla };
    } catch (e) {
      falla = (e as Error).message ?? "error de Workers AI";
      if (!SATURADO.test(falla)) return { quien: m, falla };
      console.warn(`vigia-llm: ${m} saturado (${falla.slice(0, 80)}); pruebo el siguiente hermano`);
    }
  }
  return { quien: lista[lista.length - 1], falla };
}

const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...extra } });

function igualesConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Una respuesta de chat/completions sin texto ni llamadas a herramientas (GLM a veces gasta todo en razonar). */
export function vacia(salida: unknown): boolean {
  const o = salida as { choices?: { message?: { content?: unknown; tool_calls?: unknown[] } }[]; response?: unknown };
  if (!o || typeof o !== "object") return true;
  if (!Array.isArray(o.choices)) return o.response == null || o.response === "";
  const m = o.choices[0]?.message;
  const texto = typeof m?.content === "string" ? m.content.trim() : m?.content;
  return !texto && !(Array.isArray(m?.tool_calls) && m!.tool_calls!.length);
}

const hayRespaldo = (env: Env) => env.RESPALDO_APAGADO !== "1" && !!(env.RESPALDO_URL && env.RESPALDO_TOKEN && env.RESPALDO_MODELO);

function extras(env: Env): Record<string, string> {
  try {
    const o = JSON.parse(env.RESPALDO_CABECERAS ?? "{}");
    return o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) : {};
  } catch {
    return {};
  }
}

/** La misma petición al proveedor de respaldo, sin los campos propios de Workers AI. */
async function respaldo(env: Env, cuerpo: Record<string, any>): Promise<Response> {
  const { model: _m, reasoning_effort: _r, ...resto } = cuerpo;
  const r = await fetch(env.RESPALDO_URL!, {
    method: "POST",
    headers: { ...extras(env), "content-type": "application/json", authorization: `Bearer ${env.RESPALDO_TOKEN}` },
    body: JSON.stringify({ ...resto, model: env.RESPALDO_MODELO }),
  });
  const h = new Headers(r.headers);
  h.set("x-vigia-modelo", "respaldo");
  return new Response(r.body, { status: r.status, headers: h });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/salud") return json({ ok: true, respaldo: hayRespaldo(env) });

    // Bearer, o x-api-key para los clientes de la API nativa (el SDK de agentes manda la clave así).
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || (req.headers.get("x-api-key") ?? "");
    if (!env.LLM_TOKEN || !igualesConstante(token, env.LLM_TOKEN)) return json({ error: { message: "no autorizado" } }, 401);
    if (url.pathname.startsWith("/nativo/")) return nativo(req, env, url);

    const permitidos = env.MODELOS_PERMITIDOS.split(",").map((s) => s.trim()).filter(Boolean);
    if (url.pathname === "/v1/models") {
      return json({ object: "list", data: permitidos.map((id) => ({ id, object: "model", owned_by: "cloudflare" })) });
    }
    // POST /v1/embeddings { input: string | string[] } → vectores de bge-m3 (1 024), los mismos con que la API indexa
    // rag_fragmento y norma_fragmento: el agente embebe su pregunta y busca en la base (RAG normativo, migración 284).
    if (url.pathname === "/v1/embeddings" && req.method === "POST") {
      const c = (await req.json().catch(() => null)) as { input?: unknown } | null;
      const textos = (Array.isArray(c?.input) ? c!.input : [c?.input]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 64);
      if (!textos.length) return json({ error: { message: "falta input" } }, 400);
      try {
        const r = (await (env as unknown as { AI: { run: (m: string, e: unknown) => Promise<{ data?: number[][] }> } }).AI.run(
          "@cf/baai/bge-m3", { text: textos.map((x) => x.slice(0, 8000)) })) as { data?: number[][] };
        const data = (r.data ?? []).map((embedding, index) => ({ object: "embedding", index, embedding }));
        if (data.length !== textos.length) return json({ error: { message: "el modelo de embeddings no respondió completo" } }, 502);
        return json({ object: "list", model: "@cf/baai/bge-m3", data });
      } catch (e) {
        return json({ error: { message: `embeddings: ${String((e as Error).message ?? e).slice(0, 200)}` } }, 502);
      }
    }
    if (url.pathname !== "/v1/chat/completions" || req.method !== "POST") return json({ error: { message: "no encontrado" } }, 404);

    const cuerpo = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!cuerpo || !Array.isArray(cuerpo.messages)) return json({ error: { message: "falta messages" } }, 400);
    let modelo = String(cuerpo.model ?? "").replace(/^openai\//, "");
    if (!modelo || modelo === "default") modelo = env.MODELO_DEFECTO ?? permitidos[0];
    // Sin respaldo, quien pide «respaldo» (p. ej. la Lambda de agentes con WORKERS_AI_MODEL=respaldo) va al de defecto.
    if (modelo === "respaldo" && env.RESPALDO_APAGADO === "1") modelo = env.MODELO_DEFECTO ?? permitidos[0];
    // model "respaldo" = lo mismo que la cabecera de forzar, para clientes que no pueden poner cabeceras (litellm).
    if (modelo !== "respaldo" && !permitidos.includes(modelo)) return json({ error: { message: `modelo no permitido: ${modelo}` } }, 400);

    if (modelo === "respaldo" || req.headers.get("x-vigia-respaldo") === "forzar") {
      return hayRespaldo(env) ? respaldo(env, cuerpo) : json({ error: { message: "sin respaldo configurado" } }, 503);
    }

    const { model: _m, ...entrada } = cuerpo;
    // GLM razona de más: sin límite gasta todo el presupuesto pensando y Workers AI corta la petición (error 3046).
    if (entrada.reasoning_effort === undefined && env.REASONING_EFFORT_DEFECTO) entrada.reasoning_effort = env.REASONING_EFFORT_DEFECTO;
    if (entrada.max_tokens === undefined && entrada.max_completion_tokens === undefined) entrada.max_tokens = Number(env.MAX_TOKENS_DEFECTO ?? 16000);
    const r = await correrConHermanos(env, modelo, entrada);
    const quien = { "x-vigia-modelo": `workers-ai:${r.quien}` };
    if (!r.falla) {
      if (cuerpo.stream && r.salida instanceof ReadableStream) {
        return new Response(r.salida, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...quien } });
      }
      return json(r.salida, 200, quien);
    }
    const falla = r.falla;
    // `x-vigia-respaldo: nunca`: el que llama prefiere el error (los lectores en lote de Workers AI: el respaldo cobra aparte).
    if (hayRespaldo(env) && req.headers.get("x-vigia-respaldo") !== "nunca") {
      console.warn(`vigia-llm: ${modelo} falló (${falla.slice(0, 160)}); va al respaldo`);
      return respaldo(env, cuerpo);
    }
    // Saturado (todos los hermanos en su tope): 429, para que el cliente espere y reintente.
    return json({ error: { message: falla } }, SATURADO.test(falla) ? 429 : /3046|timeout/i.test(falla) ? 504 : 502, quien);
  },
};
