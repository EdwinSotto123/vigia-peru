/**
 * El chat de investigación del panel (frontend/app/admin/chat). Solo admin (token del panel). Lo que pregunta y cómo
 * responde está en lib/chatInvestigacion.ts; acá, las rutas.
 *
 *   POST   /admin/chat                         { mensajes: [{ rol, texto }], modelo?, conversacion? } → NDJSON en vivo.
 *          Crea el informe (admin_chat_informe, migración 261) y lo corre en su Durable Object (workers/chatInforme.ts):
 *          sigue aunque se cierre la pestaña. El evento `inicio` trae su id. Sin Durable Object (pruebas, Node) o si la
 *          base no lo acepta, corre en línea como antes (sin guardar).
 *   GET    /admin/chat/informes                ?limite, antes (fecha), q (texto de la pregunta): los últimos informes.
 *   GET    /admin/chat/informes/:id            el informe entero, con sus eventos.
 *   GET    /admin/chat/informes/:id/eventos    ?desde=N: los eventos desde el N; si sigue corriendo, en vivo (NDJSON).
 *   POST   /admin/chat/informes/:id/detener    «Detener» desde cualquier pestaña.
 *   DELETE /admin/chat/informes/:id            lo borra (no uno que está corriendo).
 */
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { correrChat, type EnvChat, type PedidoChat } from "../lib/chatInvestigacion.js";
import { poolAdmin as pool } from "../lib/db.js";

/** Lo que usa la ruta del entorno del Worker (workers/env.ts tiene el tipo completo). */
interface Env extends EnvChat {
  CHAT_INFORME?: {
    idFromName(nombre: string): unknown;
    get(id: unknown): {
      iniciar(p: PedidoChat & { informe: string }): Promise<void>;
      suscribir(desde?: number): Promise<ReadableStream<Uint8Array> | null>;
      parar(): Promise<boolean>;
    };
  };
}

export const adminChatRouter = new Hono<{ Bindings: Env }>();

const NDJSON = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };
/** Un informe que lleva tanto «corriendo» sin novedades murió sin guardarse: se muestra como cortado. */
const CORTADO_TRAS = "20 minutes";
const ESTADO = `CASE WHEN estado = 'corriendo' AND actualizado < now() - interval '${CORTADO_TRAS}' THEN 'cortado' ELSE estado END`;

const Cuerpo = z.object({
  mensajes: z.array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().trim().min(1).max(12_000) })).min(1).max(40),
  modelo: z.enum(["rapido", "fino"]).default("rapido"),
  conversacion: z.string().uuid().optional(),
});

const Uuid = z.string().uuid();

function objeto(env: Env, id: string) {
  const ns = env.CHAT_INFORME!;
  return ns.get(ns.idFromName(id));
}

adminChatRouter.post("/chat", async (c) => {
  const leido = Cuerpo.safeParse(await c.req.json().catch(() => null));
  if (!leido.success) return c.json({ error: "cuerpo_invalido", detail: "Manda { mensajes: [{ rol, texto }], modelo }." }, 400);
  const { mensajes, modelo, conversacion } = leido.data;
  if (mensajes[mensajes.length - 1].rol !== "usuario") return c.json({ error: "cuerpo_invalido", detail: "El último mensaje tiene que ser tuyo." }, 400);
  if (mensajes.reduce((n, m) => n + m.texto.length, 0) > 80_000) {
    return c.json({ error: "conversacion_larga", detail: "La conversación es muy larga: empieza una nueva." }, 413);
  }
  const env = (c.env ?? {}) as Env;
  const actor = c.req.header("x-admin-actor") ?? "admin";
  const pedido: PedidoChat = { mensajes, modelo, actor };

  if (env.CHAT_INFORME) {
    try {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO admin_chat_informe (id, conversacion, actor, modelo_pedido, pregunta, historial)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [id, conversacion ?? null, actor, modelo, mensajes[mensajes.length - 1].texto, JSON.stringify(mensajes.slice(0, -1))],
      );
      const o = objeto(env, id);
      await o.iniciar({ ...pedido, informe: id });
      const s = await o.suscribir(0);
      if (s) return new Response(s, { headers: NDJSON });
    } catch (e) {
      // Sin la tabla (migración 261) o sin el objeto: se responde igual, en línea y sin guardar.
      console.warn(JSON.stringify({ chat: "informe_no_guardado", error: String((e as Error)?.message ?? e).slice(0, 200) }));
    }
  }
  c.header("Content-Type", NDJSON["content-type"]);
  c.header("Cache-Control", "no-store");
  return stream(c, (s) => correrChat(env, pedido, (o) => s.write(`${JSON.stringify(o)}\n`)));
});

const Lista = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  antes: z.string().datetime({ offset: true }).optional(),
  q: z.string().trim().min(2).max(100).optional(),
});

adminChatRouter.get("/chat/informes", async (c) => {
  const f = Lista.safeParse(c.req.query());
  if (!f.success) return c.json({ error: "parametros_invalidos" }, 400);
  const { limite, antes, q } = f.data;
  const r = await pool.query(
    `SELECT id, conversacion, creado, actualizado, actor, modelo_pedido, modelo, pregunta, ${ESTADO} AS estado, error,
            (fin->>'costo_usd')::float AS costo_usd, (fin->>'ms')::int AS ms, (fin->>'herramientas')::int AS herramientas,
            CASE WHEN revision IS NULL THEN NULL ELSE jsonb_build_object(
              'enlaces', coalesce((revision->'enlaces'->>'total')::int, 0),
              'montos', coalesce((revision->'montos'->>'total')::int, 0),
              'por_revisar', jsonb_array_length(coalesce(revision->'enlaces'->'dudosos', '[]'::jsonb))
                           + jsonb_array_length(coalesce(revision->'montos'->'dudosos', '[]'::jsonb))) END AS revision
       FROM admin_chat_informe
      WHERE ($1::timestamptz IS NULL OR creado < $1) AND ($2::text IS NULL OR pregunta ILIKE '%' || $2 || '%')
      ORDER BY creado DESC LIMIT $3`,
    [antes ?? null, q ?? null, limite + 1],
  );
  return c.json({ data: r.rows.slice(0, limite), hayMas: r.rows.length > limite }, 200, { "cache-control": "no-store" });
});

adminChatRouter.get("/chat/informes/:id", async (c) => {
  const id = Uuid.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "no_encontrado" }, 404);
  const r = await pool.query(
    `SELECT id, conversacion, creado, actualizado, actor, modelo_pedido, modelo, pregunta, historial, ${ESTADO} AS estado,
            texto, eventos, revision, fin, error
       FROM admin_chat_informe WHERE id = $1`,
    [id.data],
  );
  if (!r.rows[0]) return c.json({ error: "no_encontrado" }, 404);
  return c.json(r.rows[0], 200, { "cache-control": "no-store" });
});

adminChatRouter.get("/chat/informes/:id/eventos", async (c) => {
  const id = Uuid.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "no_encontrado" }, 404);
  const desde = Math.max(0, Number.parseInt(c.req.query("desde") ?? "0", 10) || 0);
  const env = (c.env ?? {}) as Env;
  const leer = async () =>
    (await pool.query<{ estado: string; eventos: Record<string, unknown>[] }>(
      `SELECT ${ESTADO} AS estado, eventos FROM admin_chat_informe WHERE id = $1`, [id.data],
    )).rows[0];
  let fila = await leer();
  if (!fila) return c.json({ error: "no_encontrado" }, 404);
  if (fila.estado === "corriendo" && env.CHAT_INFORME) {
    const s = await objeto(env, id.data).suscribir(desde);
    if (s) return new Response(s, { headers: NDJSON });
    // Terminó entre la lectura y la suscripción: ya está en la base.
    fila = (await leer()) ?? fila;
  }
  const eventos = fila.eventos.slice(desde);
  if (fila.estado === "cortado" && !eventos.some((e) => e.tipo === "error")) {
    eventos.push({ tipo: "error", mensaje: "La respuesta se cortó en el servidor antes de terminar. Vuelve a preguntar." });
  }
  return new Response(eventos.map((e) => JSON.stringify(e)).join("\n") + (eventos.length ? "\n" : ""), { headers: NDJSON });
});

adminChatRouter.post("/chat/informes/:id/detener", async (c) => {
  const id = Uuid.safeParse(c.req.param("id"));
  const env = (c.env ?? {}) as Env;
  if (!id.success || !env.CHAT_INFORME) return c.json({ error: "no_encontrado" }, 404);
  const detenido = await objeto(env, id.data).parar();
  return c.json({ ok: true, detenido });
});

adminChatRouter.delete("/chat/informes/:id", async (c) => {
  const id = Uuid.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "no_encontrado" }, 404);
  const r = await pool.query(
    `DELETE FROM admin_chat_informe WHERE id = $1 AND (estado <> 'corriendo' OR actualizado < now() - interval '${CORTADO_TRAS}')`, [id.data]);
  if (!r.rowCount) return c.json({ error: "no_se_puede", detail: "No existe o todavía está corriendo: detenlo primero." }, 409);
  return c.json({ ok: true });
});
