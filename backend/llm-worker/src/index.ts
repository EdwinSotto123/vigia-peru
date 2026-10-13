/**
 * vigia-llm — Workers AI detrás de una API tipo OpenAI.
 *
 *   POST /v1/chat/completions   { model, messages, tools?, stream?, temperature?, max_tokens? }
 *   GET  /v1/models             modelos permitidos
 *   GET  /salud                 sin auth
 *
 * Auth: `Authorization: Bearer <LLM_TOKEN>`. El modelo debe estar en MODELOS_PERMITIDOS.
 * No registra el contenido de los mensajes (pueden traer datos de contratos).
 */
interface Env {
  AI: { run(model: string, input: unknown, opts?: unknown): Promise<unknown> };
  LLM_TOKEN?: string;
  MODELOS_PERMITIDOS: string;
  /** Esfuerzo de razonamiento si la petición no trae `reasoning_effort` (low|medium|high). GLM razona sin parar por defecto. */
  REASONING_EFFORT_DEFECTO?: string;
  /** Tope de tokens de salida si la petición no trae `max_tokens` (evita timeouts 3046 de Workers AI). */
  MAX_TOKENS_DEFECTO?: string;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

function igualesConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/salud") return json({ ok: true });

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!env.LLM_TOKEN || !igualesConstante(token, env.LLM_TOKEN)) return json({ error: { message: "no autorizado" } }, 401);

    const permitidos = env.MODELOS_PERMITIDOS.split(",").map((s) => s.trim()).filter(Boolean);
    if (url.pathname === "/v1/models") {
      return json({ object: "list", data: permitidos.map((id) => ({ id, object: "model", owned_by: "cloudflare" })) });
    }
    if (url.pathname !== "/v1/chat/completions" || req.method !== "POST") return json({ error: { message: "no encontrado" } }, 404);

    const cuerpo = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!cuerpo || !Array.isArray(cuerpo.messages)) return json({ error: { message: "falta messages" } }, 400);
    const modelo = String(cuerpo.model ?? "").replace(/^openai\//, "");
    if (!permitidos.includes(modelo)) return json({ error: { message: `modelo no permitido: ${modelo}` } }, 400);

    const { model: _m, ...entrada } = cuerpo;
    // GLM razona de más: sin límite gasta todo el presupuesto pensando y Workers AI corta la petición (error 3046).
    if (entrada.reasoning_effort === undefined && env.REASONING_EFFORT_DEFECTO) entrada.reasoning_effort = env.REASONING_EFFORT_DEFECTO;
    if (entrada.max_tokens === undefined && entrada.max_completion_tokens === undefined) entrada.max_tokens = Number(env.MAX_TOKENS_DEFECTO ?? 16000);
    try {
      const salida = await env.AI.run(modelo, entrada);
      if (cuerpo.stream && salida instanceof ReadableStream) {
        return new Response(salida, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
      }
      return json(salida);
    } catch (e) {
      const msg = (e as Error).message ?? "error de Workers AI";
      return json({ error: { message: msg } }, /3046|timeout/i.test(msg) ? 504 : 502);
    }
  },
};
