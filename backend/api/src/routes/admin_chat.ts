/**
 * POST /admin/chat — el chat de investigación del panel (frontend/app/admin/chat). Solo admin (token del panel).
 *
 * Una pregunta en lenguaje natural («dime todo sobre el alcalde de …») la responde Claude con las MISMAS herramientas del
 * MCP de Vigía (mcp.gobserva.cloud): se listan y se llaman por service binding con la cabecera interna, así que las reglas
 * de privacidad y la forma de cada respuesta son las del MCP. El modelo va por vigia-llm (/nativo, la clave vive allá):
 * Haiku 5.5 («rapido») o Sonnet 5.5 («fino»).
 *
 * Cuerpo: { mensajes: [{ rol: "usuario"|"asistente", texto }], modelo?: "rapido"|"fino" }
 * Respuesta: application/x-ndjson, un objeto por línea: inicio, paso (llamada a una herramienta), resultado, texto (lo
 * que el modelo dice entre llamadas), respuesta (la final, en markdown), fin (tiempo, herramientas, tokens, costo) o error.
 */
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";

/** Lo que usa el chat del entorno del Worker (workers/env.ts tiene el tipo completo; acá, sin los tipos de Workers). */
interface Env {
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  MCP?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  MCP_INTERNO_URL?: string;
  LLM_TOKEN?: string;
  MCP_INTERNO_TOKEN?: string;
}

export const adminChatRouter = new Hono<{ Bindings: Env }>();

const MODELOS = {
  rapido: { id: "claude-haiku-5-5", entrada: 0.1, salida: 0.5, max: 4096, vueltas: 14 },
  /** «Profundo» en la página: planifica, verifica cada cifra con una segunda herramienta y tiene más vueltas. */
  fino: { id: "claude-sonnet-5-5", entrada: 2, salida: 10, max: 12000, vueltas: 22 },
} as const;

/** Escriben o leen la cuenta personal de quien las usa: en el chat interno no tienen sentido. */
const FUERA_DEL_CHAT = new Set(["seguir", "dejar_de_seguir", "mis_seguimientos"]);
/** Lo que se le pasa al modelo de cada resultado (las respuestas del MCP ya vienen recortadas). */
const MAX_RESULTADO = 40_000;

const Cuerpo = z.object({
  mensajes: z.array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().trim().min(1).max(12_000) })).min(1).max(40),
  modelo: z.enum(["rapido", "fino"]).default("rapido"),
});

type Herramienta = { name: string; title?: string; description?: string; inputSchema?: Record<string, unknown> };
let catalogo: { herramientas: Herramienta[]; vence: number } | null = null;

function sistema(profundo: boolean): string {
  const hoy = new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "long", year: "numeric" });
  return `Eres el asistente de investigación de Vigía (Vigía by Gobserva) para su equipo. Respondes preguntas sobre la contratación pública del Perú usando SOLO las herramientas de Vigía: no inventes datos ni completes con lo que creas saber. Hoy es ${hoy}.

Cómo investigar:
- Con solo un nombre (una autoridad, entidad, empresa o contrato), usa buscar o persona_publica para obtener su código (RUC, OCID, CUI o clave). Si hay varias coincidencias razonables, elige la más probable y dilo; si de verdad no se puede saber, pregunta.
- Para una autoridad (alcalde, gobernador): persona_publica da su trayectoria electoral y el cargo que tiene hoy; ficha_entidad de su entidad da presupuesto, gobierno, señales y Contraloría; proveedores_de_entidad y ordenes muestran qué se compró y a quién; consultar_datos da cifras por año; senales y dictamen, los casos con riesgo.
- Encadena: usa los códigos que devuelve cada herramienta. Haz las llamadas necesarias, en paralelo cuando no dependan una de otra, y no repitas la misma.
- «¿Qué es lo más raro de…?», «¿qué llama la atención?» o «¿es normal que…?»: empieza por hallazgos_entidad, que compara la entidad con entidades de su tipo y tamaño y dice qué se sale de lo normal y con qué herramienta profundizar; profundiza en los dos o tres hallazgos más fuertes. Para «qué entidades gastan más en X» o «quién ejecuta menos», ranking_entidades.
- Para una entidad, según lo que pregunten:
  - gasto y presupuesto: gasto_entidad (en qué gasta este año, por genérica, partida, función, fuente, mes y proyecto), ficha_entidad (PIM y devengado por año) y consultar_datos (fuente presupuesto, para comparar años o entidades);
  - lo que compra o consume: ordenes (todas las vías, por año), compras_menores (ítems y precios), proveedores_de_entidad (a quién y cuánto) y consultar_datos (adjudicaciones, ordenes, menores);
  - estadísticas: consultar_datos; pide primero el catálogo de la fuente si no sabes qué medida o dimensión usar;
  - informes y control: informes_control (Contraloría con PDF) y senales; obras: obras_entidad; personal: planilla_entidad; visitas: visitas_entidad.
- Si piden un ZIP o los documentos de contratos: elige los procesos (hasta 10 por ZIP; si son más, arma varios) y usa documentos_zip; entrega el enlace de descarga y di qué incluye.
- «¿Cuánto gastó en X?» (parlantes, bocaditos, eventos, publicidad…): gasto_por_concepto con 6 a 15 términos alternativos y sinónimos, de lo general a lo específico. Revisa por_termino y mayores, y quita con excluir lo que no es del concepto (por ejemplo «mantenimiento» si preguntan por alquiler). Si el total te parece raro, mira las compras más grandes antes de afirmarlo.
- Si una búsqueda da cero o muy poco, NO concluyas que no existe: reintenta con palabras sueltas, singular y plural, sinónimos y gasto_por_concepto, y di qué términos usaste. Solo después puedes decir que no lo encontraste.
- No vincules cifras ni hechos porque se parecen (un monto parecido no es el mismo gasto). Si no puedes unirlos con datos, no lo menciones.
- Si citan un reportaje o una cifra de afuera, compárala con lo que sí encuentras y explica de qué puede venir la diferencia (periodo, fuentes, alcance), sin suponer.
- Lo que compra una entidad es de la entidad, no de la persona: dilo así («durante su gestión, la municipalidad compró…») y usa el periodo del cargo para filtrar los años.

Cómo responder:
- En español y con este orden: «Respuesta corta» (dos o tres frases con la cifra clave), «Hallazgos» numerados (cada uno: qué es, la cifra, la evidencia con enlace), «Lo que no pude verificar» y la fecha de los datos. Tablas cuando haya cifras. Hasta unas 500 palabras, salvo que pidan más detalle.
- Cita con los enlaces de Vigía y de la fuente oficial que traen las herramientas, y di hasta qué fecha llegan los datos cuando importe.
- Una señal es un indicio para revisar, no una acusación: no afirmes delitos.
- Si algo no está en Vigía, dilo y sugiere dónde buscarlo.
- No nombres las herramientas ni sus parámetros en la respuesta: habla de los datos y de su fuente.
- Nunca pidas ni busques un DNI. Las personas naturales salen con un apellido tapado: respétalo.${profundo ? `

Modo investigación profunda:
- Antes de la primera herramienta escribe un plan breve (de 3 a 6 pasos) con lo que vas a revisar.
- Llama en paralelo lo que no depende entre sí. Usa todas las fuentes que apliquen: gasto, compras, proveedores, señales, informes de control, obras, planilla, visitas, historia y cifras comparadas.
- Verifica cada cifra principal con una segunda herramienta cuando se pueda (por ejemplo gasto_por_concepto contra ordenes, o consultar_datos contra la ficha) y di si coinciden.
- Compara con entidades parecidas cuando digas que algo es «alto» o «raro» (consultar_datos por entidad o región).
- Antes de responder, revisa que cada afirmación tenga su cifra y su enlace; lo que no lo tenga va a «Lo que no pude verificar».` : ""}`;
}

async function mcp(env: Env, metodo: string, params: Record<string, unknown>): Promise<Record<string, any>> {
  if (!env.MCP || !env.MCP_INTERNO_URL || !env.MCP_INTERNO_TOKEN) throw new Error("El chat no tiene configurado el MCP.");
  const r = await env.MCP.fetch(new Request(env.MCP_INTERNO_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "x-vigia-interno": env.MCP_INTERNO_TOKEN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
  }));
  const texto = await r.text();
  if (!r.ok) throw new Error(`MCP ${r.status}: ${texto.slice(0, 200)}`);
  const d = JSON.parse(texto.startsWith("event:") ? (texto.split("\n").filter((l) => l.startsWith("data:")).pop() ?? "").slice(5) : texto);
  if (d.error) throw new Error(`MCP: ${d.error.message}`);
  return d.result;
}

async function herramientas(env: Env): Promise<Herramienta[]> {
  if (catalogo && catalogo.vence > Date.now()) return catalogo.herramientas;
  const r = await mcp(env, "tools/list", {});
  const lista = ((r.tools ?? []) as Herramienta[]).filter((h) => !FUERA_DEL_CHAT.has(h.name));
  catalogo = { herramientas: lista, vence: Date.now() + 10 * 60_000 };
  return lista;
}

function paraElModelo(lista: Herramienta[]) {
  return lista.map((h, i) => {
    const { $schema: _omitido, ...esquema } = (h.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
    return {
      name: h.name,
      description: h.description ?? h.title ?? h.name,
      input_schema: { type: "object", ...esquema },
      // El catálogo y el sistema se repiten en cada vuelta: van a la caché del modelo.
      ...(i === lista.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
    };
  });
}

async function llm(env: Env, cuerpo: Record<string, unknown>): Promise<Record<string, any>> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("El chat no tiene configurado el modelo.");
  const r = await env.LLM.fetch(new Request("https://vigia-llm.interno/nativo/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.LLM_TOKEN, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(cuerpo),
  }));
  if (!r.ok) throw new Error(`El modelo respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const resumen = (t: string) => t.replace(/\s+/g, " ").slice(0, 240);

adminChatRouter.post("/chat", async (c) => {
  const leido = Cuerpo.safeParse(await c.req.json().catch(() => null));
  if (!leido.success) return c.json({ error: "cuerpo_invalido", detail: "Manda { mensajes: [{ rol, texto }], modelo }." }, 400);
  const { mensajes, modelo } = leido.data;
  if (mensajes[mensajes.length - 1].rol !== "usuario") return c.json({ error: "cuerpo_invalido", detail: "El último mensaje tiene que ser tuyo." }, 400);
  if (mensajes.reduce((n, m) => n + m.texto.length, 0) > 80_000) {
    return c.json({ error: "conversacion_larga", detail: "La conversación es muy larga: empieza una nueva." }, 413);
  }
  const env = (c.env ?? {}) as Env;
  const m = MODELOS[modelo];
  const actor = c.req.header("x-admin-actor") ?? "admin";
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-store");

  return stream(c, async (s) => {
    const emitir = (o: Record<string, unknown>) => s.write(`${JSON.stringify(o)}\n`);
    const inicio = Date.now();
    const tokens = { entrada: 0, salida: 0, cache_leidos: 0, cache_escritos: 0 };
    let usadas = 0;
    try {
      const lista = await herramientas(env);
      const titulos = new Map(lista.map((h) => [h.name, h.title ?? h.name]));
      const tools = paraElModelo(lista);
      // El historial alterna usuario/asistente; dos seguidos del mismo rol se juntan.
      const conversacion: { role: "user" | "assistant"; content: unknown }[] = [];
      for (const x of mensajes) {
        const role = x.rol === "usuario" ? "user" : "assistant";
        const ultimo = conversacion[conversacion.length - 1];
        if (ultimo?.role === role) ultimo.content = `${ultimo.content as string}\n\n${x.texto}`;
        else conversacion.push({ role, content: x.texto });
      }
      if (conversacion[0]?.role !== "user") conversacion.shift();
      await emitir({ tipo: "inicio", modelo: m.id });
      console.log(JSON.stringify({ chat: "pregunta", actor, modelo: m.id, mensajes: mensajes.length }));

      for (let vuelta = 0; vuelta < m.vueltas; vuelta++) {
        const ultima = vuelta === m.vueltas - 1;
        const r = await llm(env, {
          model: m.id,
          max_tokens: m.max,
          system: [{ type: "text", text: sistema(modelo === "fino"), cache_control: { type: "ephemeral" } }],
          tools,
          ...(ultima ? { tool_choice: { type: "none" } } : {}),
          messages: conversacion,
        });
        const u = r.usage ?? {};
        tokens.entrada += u.input_tokens ?? 0;
        tokens.salida += u.output_tokens ?? 0;
        tokens.cache_leidos += u.cache_read_input_tokens ?? 0;
        tokens.cache_escritos += u.cache_creation_input_tokens ?? 0;
        const bloques = (r.content ?? []) as Record<string, any>[];
        const texto = bloques.filter((b) => b.type === "text").map((b) => b.text as string).join("\n").trim();
        const llamadas = bloques.filter((b) => b.type === "tool_use");
        // Lo que devolvió el modelo vuelve tal cual (con su razonamiento, si lo hubo): así lo piden las llamadas encadenadas.
        conversacion.push({ role: "assistant", content: bloques });
        if (r.stop_reason !== "tool_use" || !llamadas.length) {
          await emitir({ tipo: "respuesta", texto: texto || "No encontré una respuesta con los datos de Vigía." });
          break;
        }
        if (texto) await emitir({ tipo: "texto", texto });
        for (const l of llamadas) await emitir({ tipo: "paso", id: l.id, herramienta: l.name, titulo: titulos.get(l.name) ?? l.name, entrada: l.input });
        const resultados = await Promise.all(
          llamadas.map(async (l) => {
            usadas++;
            let contenido = "";
            let ok = true;
            try {
              const res = await mcp(env, "tools/call", { name: l.name, arguments: l.input ?? {} });
              contenido = ((res.content ?? []) as { type: string; text?: string }[]).map((b) => b.text ?? "").join("\n");
              ok = !res.isError;
            } catch (e) {
              ok = false;
              contenido = `No se pudo usar ${l.name}: ${(e as Error).message}`;
            }
            await emitir({ tipo: "resultado", id: l.id, herramienta: l.name, ok, caracteres: contenido.length, resumen: resumen(contenido) });
            return { type: "tool_result", tool_use_id: l.id, content: contenido.slice(0, MAX_RESULTADO), ...(ok ? {} : { is_error: true }) };
          }),
        );
        conversacion.push({ role: "user", content: resultados });
      }
      const costo =
        ((tokens.entrada + tokens.cache_escritos * 1.25 + tokens.cache_leidos * 0.1) * m.entrada + tokens.salida * m.salida) / 1_000_000;
      await emitir({ tipo: "fin", ms: Date.now() - inicio, herramientas: usadas, tokens, costo_usd: Math.round(costo * 10_000) / 10_000 });
      console.log(JSON.stringify({ chat: "fin", actor, modelo: m.id, herramientas: usadas, ms: Date.now() - inicio, costo_usd: costo }));
    } catch (e) {
      console.error(JSON.stringify({ chat: "error", actor, error: String((e as Error)?.message ?? e).slice(0, 300) }));
      await emitir({ tipo: "error", mensaje: (e as Error)?.message ?? "Falló el chat." });
    }
  });
});
