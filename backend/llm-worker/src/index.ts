/**
 * vigia-llm — Workers AI detrás de una API tipo OpenAI, con un proveedor de respaldo.
 *
 *   POST /v1/chat/completions   { model, messages, tools?, stream?, temperature?, max_tokens? }
 *   GET  /v1/models             modelos permitidos
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
 *
 * No registra el contenido de los mensajes (pueden traer datos de contratos).
 */
interface Env {
  AI: { run(model: string, input: unknown, opts?: unknown): Promise<unknown> };
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
}

/**
 * `/nativo/v1/*` → la API nativa del proveedor de respaldo, tal cual (cuerpo y respuesta en streaming), con la
 * clave del Worker. Es para el motor de agentes por SDK (backend/agent/motores/motor_sdk), que no habla el
 * formato tipo OpenAI: así la clave del proveedor sigue viviendo solo aquí.
 */
async function nativo(req: Request, env: Env, url: URL): Promise<Response> {
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

const hayRespaldo = (env: Env) => !!(env.RESPALDO_URL && env.RESPALDO_TOKEN && env.RESPALDO_MODELO);

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
    if (url.pathname !== "/v1/chat/completions" || req.method !== "POST") return json({ error: { message: "no encontrado" } }, 404);

    const cuerpo = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!cuerpo || !Array.isArray(cuerpo.messages)) return json({ error: { message: "falta messages" } }, 400);
    let modelo = String(cuerpo.model ?? "").replace(/^openai\//, "");
    if (!modelo || modelo === "default") modelo = env.MODELO_DEFECTO ?? permitidos[0];
    // model "respaldo" = lo mismo que la cabecera de forzar, para clientes que no pueden poner cabeceras (litellm).
    if (modelo !== "respaldo" && !permitidos.includes(modelo)) return json({ error: { message: `modelo no permitido: ${modelo}` } }, 400);

    if (modelo === "respaldo" || req.headers.get("x-vigia-respaldo") === "forzar") {
      return hayRespaldo(env) ? respaldo(env, cuerpo) : json({ error: { message: "sin respaldo configurado" } }, 503);
    }

    const { model: _m, ...entrada } = cuerpo;
    // GLM razona de más: sin límite gasta todo el presupuesto pensando y Workers AI corta la petición (error 3046).
    if (entrada.reasoning_effort === undefined && env.REASONING_EFFORT_DEFECTO) entrada.reasoning_effort = env.REASONING_EFFORT_DEFECTO;
    if (entrada.max_tokens === undefined && entrada.max_completion_tokens === undefined) entrada.max_tokens = Number(env.MAX_TOKENS_DEFECTO ?? 16000);
    const quien = { "x-vigia-modelo": `workers-ai:${modelo}` };
    let falla: string;
    try {
      const salida = await env.AI.run(modelo, entrada);
      if (cuerpo.stream && salida instanceof ReadableStream) {
        return new Response(salida, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...quien } });
      }
      if (!vacia(salida)) return json(salida, 200, quien);
      falla = "respuesta vacía de Workers AI";
    } catch (e) {
      falla = (e as Error).message ?? "error de Workers AI";
    }
    if (hayRespaldo(env)) {
      console.warn(`vigia-llm: ${modelo} falló (${falla.slice(0, 160)}); va al respaldo`);
      return respaldo(env, cuerpo);
    }
    return json({ error: { message: falla } }, /3046|timeout/i.test(falla) ? 504 : 502);
  },
};
