import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { ambitoPedido, fijarPlataforma, type AmbitoPedido, type Plataforma } from "../src/lib/plataforma.js";
import { cuentasRouter } from "../src/routes/cuentas.js";
import { saludRouter, TOPES_ASISTENTE_SALUD } from "../src/routes/gobservaSalud.js";
import {
  COSTO_MODO, FALTAS_PARA_BLOQUEO, TOPE_CUENTA_DIA, TOPE_CUENTA_MINUTO, TOPE_IP_DIA, TOPE_PROFUNDO_TOTAL_DIA, TOPE_SIN_VERIFICAR_DIA,
} from "../src/lib/chatVigia.js";

/**
 * Los topes del asistente de Vigía (2026-11-24, el usuario: «verifica que funcionen los límites… en Vigía, que es gratis,
 * damos 10 consultas al día con IA»), de punta a punta por la ruta POST /cuentas/me/chat: la cuenta, el token, la IP y el
 * limitador. El limitador es un doble del Durable Object (workers/limitador.ts: ventana deslizante por clave, el pedido
 * rechazado no se anota) con un reloj que se adelanta a mano. El modelo y el MCP son dobles: el modelo contesta un texto
 * fijo (o falla, con `modeloFalla`: entonces la pregunta se devuelve) y el MCP no tiene herramientas.
 *
 * 2026-11-25: los modos (Rápido gasta 1, Profundo 3), el cupo que ve quien pregunta (GET /cuentas/me/chat/cupo y el
 * evento `cupo` del stream) y la devolución de la pregunta que el modelo no llegó a responder.
 */

let reloj = Date.UTC(2026, 10, 24, 15, 0, 0);
const adelantar = (s: number) => {
  reloj += s * 1000;
};
const marcas = new Map<string, number[]>();
const vigentes = (clave: string, ventanaS: number) => (marcas.get(clave) ?? []).filter((t) => reloj - t < ventanaS * 1000);
const limitador = {
  async contar(clave: string, tope: number, ventanaS: number, _persistente = false, n = 1) {
    const m = vigentes(clave, ventanaS);
    if (m.length + n > tope) {
      marcas.set(clave, m);
      return false;
    }
    for (let i = 0; i < n; i++) m.push(reloj);
    marcas.set(clave, m);
    return true;
  },
  async cuantas(clave: string, ventanaS: number) {
    return vigentes(clave, ventanaS).length;
  },
  async marcas(clave: string, ventanaS: number) {
    return [...vigentes(clave, ventanaS)];
  },
  async devolver(clave: string, n: number, ventanaS: number) {
    const m = vigentes(clave, ventanaS);
    m.splice(Math.max(0, m.length - n), n);
    marcas.set(clave, m);
    return m.length;
  },
};

// El modelo y el MCP de mentira: el modelo contesta sin herramientas; con `modeloFalla`, responde 500.
let modeloFalla = false;
const ENV = {
  LLM_TOKEN: "x",
  MCP_INTERNO_TOKEN: "x",
  MCP_INTERNO_URL: "https://mcp.interno/mcp",
  LLM: {
    async fetch() {
      if (modeloFalla) return new Response("caído", { status: 500 });
      return Response.json({ content: [{ type: "text", text: "Según Vigía, la entidad tiene 3 contratos." }], stop_reason: "end_turn", usage: {} });
    },
  },
  MCP: {
    async fetch() {
      return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    },
  },
};

// El token de prueba: «uid|verificado|correo».
fijarPlataforma({
  async verificarIdToken(token: string) {
    const [uid, verificado, email] = token.split("|");
    if (!uid) throw new Error("token inválido");
    return { uid, email, email_verified: verificado === "1" };
  },
} as unknown as Plataforma);

const app = new Hono();
app.route("/cuentas", cuentasRouter);
app.route("/salud", saludRouter);

type Evento = { tipo: string; [k: string]: unknown };
const ambito = () => ({ limitador: () => limitador, seguir: () => {} }) as unknown as AmbitoPedido;

async function preguntar(
  token: string,
  ip: string,
  modo?: "rapido" | "profundo",
): Promise<{ status: number; error?: string; detail?: string; eventos?: Evento[] }> {
  return ambitoPedido.run(ambito(), async () => {
    const r = await app.request(
      "/cuentas/me/chat",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ mensajes: [{ rol: "usuario", texto: "¿Qué contratos tiene la municipalidad de Puno?" }], ...(modo ? { modo } : {}) }),
      },
      ENV,
    );
    const texto = await r.text();
    if (r.status === 200) return { status: 200, eventos: texto.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Evento) };
    const d = JSON.parse(texto) as { error?: string; detail?: string };
    return { status: r.status, error: d.error, detail: d.detail };
  });
}

async function cupo(token: string): Promise<{ tope: number; usadas: number; quedan: number; proxima: string | null; verificado: boolean }> {
  return ambitoPedido.run(ambito(), async () => {
    const r = await app.request("/cuentas/me/chat/cupo", { headers: { authorization: `Bearer ${token}` } }, ENV);
    assert.equal(r.status, 200);
    return r.json();
  });
}

/** `n` preguntas de a TOPE_CUENTA_MINUTO por minuto (sin chocar con el tope por minuto). */
async function preguntarVarias(token: string, ip: string, n: number) {
  const r = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % TOPE_CUENTA_MINUTO === 0) adelantar(61);
    r.push(await preguntar(token, ip));
  }
  adelantar(61);
  return r;
}

test("una cuenta con el correo confirmado: 10 preguntas en 24 horas, la 11.ª no", async () => {
  assert.equal(TOPE_CUENTA_DIA, 10);
  const token = "ana|1|ana@correo.pe";
  const r = await preguntarVarias(token, "190.1.1.1", TOPE_CUENTA_DIA);
  assert.deepEqual(r.map((x) => x.status), Array(TOPE_CUENTA_DIA).fill(200));
  const once = await preguntar(token, "190.1.1.1");
  assert.equal(once.status, 429);
  assert.equal(once.error, "tope_dia");
  assert.match(once.detail ?? "", /Ya hiciste las 10 preguntas de este día/);
  // Desde otra conexión, tampoco: el tope es de la cuenta.
  adelantar(61);
  assert.equal((await preguntar(token, "200.2.2.2")).error, "tope_dia");
});

test("a las 24 horas de la primera, vuelve a tener preguntas (ventana deslizante)", async () => {
  const token = "ana|1|ana@correo.pe";
  adelantar(24 * 60 * 60);
  assert.equal((await preguntar(token, "190.1.1.1")).status, 200);
});

test("insistir contra el tope del día no bloquea la cuenta", async () => {
  const token = "beto|1|beto@correo.pe";
  await preguntarVarias(token, "190.3.3.3", TOPE_CUENTA_DIA);
  for (let i = 0; i < FALTAS_PARA_BLOQUEO + 3; i++) assert.equal((await preguntar(token, "190.3.3.3")).error, "tope_dia");
  adelantar(24 * 60 * 60);
  assert.equal((await preguntar(token, "190.3.3.3")).status, 200);
});

test("una cuenta con el correo sin confirmar: 3 preguntas, y el mensaje pide confirmarlo", async () => {
  const token = "caro|0|caro@correo.pe";
  const r = await preguntarVarias(token, "190.4.4.4", TOPE_SIN_VERIFICAR_DIA);
  assert.deepEqual(r.map((x) => x.status), [200, 200, 200]);
  const cuarta = await preguntar(token, "190.4.4.4");
  assert.equal(cuarta.error, "tope_dia");
  assert.match(cuarta.detail ?? "", /Verifica tu correo/);
});

test("la cuenta de usuario y contraseña (@vigia.local) tiene las 10", async () => {
  const token = "dani|0|dani@vigia.local";
  const r = await preguntarVarias(token, "190.5.5.5", TOPE_CUENTA_DIA);
  assert.equal(r.filter((x) => x.status === 200).length, TOPE_CUENTA_DIA);
  assert.equal((await preguntar(token, "190.5.5.5")).error, "tope_dia");
});

test("más de 3 por minuto: «espera un minuto», sin gastar las del día", async () => {
  const token = "eli|1|eli@correo.pe";
  for (let i = 0; i < TOPE_CUENTA_MINUTO; i++) assert.equal((await preguntar(token, "190.6.6.6")).status, 200);
  const r = await preguntar(token, "190.6.6.6");
  assert.equal(r.status, 429);
  assert.equal(r.error, "muy_seguido");
  adelantar(61);
  // Le quedan las otras 7 del día.
  const resto = await preguntarVarias(token, "190.6.6.6", TOPE_CUENTA_DIA - TOPE_CUENTA_MINUTO);
  assert.equal(resto.filter((x) => x.status === 200).length, TOPE_CUENTA_DIA - TOPE_CUENTA_MINUTO);
  assert.equal((await preguntar(token, "190.6.6.6")).error, "tope_dia");
});

test("cuentas desechables desde una misma conexión: 40 preguntas al día entre todas", async () => {
  const ip = "181.7.7.7";
  let bien = 0;
  for (let k = 0; k < 5; k++) {
    const r = await preguntarVarias(`desechable${k}|1|d${k}@correo.pe`, ip, TOPE_CUENTA_DIA);
    bien += r.filter((x) => x.status === 200).length;
  }
  assert.equal(bien, TOPE_IP_DIA);
  const r = await preguntar("desechable9|1|d9@correo.pe", ip);
  assert.equal(r.error, "tope_ip");
  // El rechazo de la conexión no le gastó ninguna de las suyas: desde su casa tiene las 10.
  adelantar(61);
  const enCasa = await preguntarVarias("desechable9|1|d9@correo.pe", "190.8.8.8", TOPE_CUENTA_DIA);
  assert.equal(enCasa.filter((x) => x.status === 200).length, TOPE_CUENTA_DIA);
});

test("sin token, no hay asistente", async () => {
  const r = await ambitoPedido.run(ambito(), () =>
    app.request("/cuentas/me/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  );
  assert.equal(r.status, 401);
});

test("Profundo gasta 3 preguntas: tres profundas, y la cuarta pide Rápido sin gastar nada", async () => {
  assert.equal(COSTO_MODO.profundo, 3);
  const token = "fio|1|fio@correo.pe";
  const ip = "190.10.10.10";
  for (let i = 0; i < 3; i++) assert.equal((await preguntar(token, ip, "profundo")).status, 200);
  adelantar(61);
  const cuarta = await preguntar(token, ip, "profundo");
  assert.equal(cuarta.status, 429);
  assert.equal(cuarta.error, "tope_modo");
  assert.match(cuarta.detail ?? "", /te queda 1\. Pregunta en modo Rápido/);
  assert.equal((await cupo(token)).quedan, 1);
  assert.equal((await preguntar(token, ip, "rapido")).status, 200);
  assert.equal((await preguntar(token, ip)).error, "tope_dia");
});

test("el cupo: cuántas quedan y cuándo se libera la próxima; el stream lo trae al empezar", async () => {
  const token = "gus|1|gus@correo.pe";
  const antes = await cupo(token);
  assert.deepEqual([antes.tope, antes.usadas, antes.quedan, antes.proxima, antes.verificado], [10, 0, 10, null, true]);
  const t0 = reloj;
  const r = await preguntar(token, "190.11.11.11");
  const primero = r.eventos?.[0];
  assert.equal(primero?.tipo, "cupo");
  assert.equal(primero?.quedan, 9);
  assert.ok(r.eventos?.some((e) => e.tipo === "respuesta"));
  adelantar(60 * 60);
  await preguntar(token, "190.11.11.11", "profundo");
  const despues = await cupo(token);
  assert.equal(despues.usadas, 4);
  assert.equal(despues.quedan, 6);
  assert.equal(despues.proxima, new Date(t0 + 24 * 60 * 60 * 1000).toISOString());
  // Sin correo confirmado: 3 al día, y así lo dice.
  const sin = await cupo("hugo|0|hugo@correo.pe");
  assert.deepEqual([sin.tope, sin.quedan, sin.verificado], [TOPE_SIN_VERIFICAR_DIA, TOPE_SIN_VERIFICAR_DIA, false]);
});

test("si el modelo no llega a responder, la pregunta no se cobra", async () => {
  const token = "ines|1|ines@correo.pe";
  adelantar(61);
  modeloFalla = true;
  try {
    const r = await preguntar(token, "190.12.12.12", "profundo");
    assert.equal(r.status, 200);
    assert.ok(r.eventos?.some((e) => e.tipo === "error"));
    const ultimo = [...(r.eventos ?? [])].reverse().find((e) => e.tipo === "cupo");
    assert.equal(ultimo?.quedan, 10);
  } finally {
    modeloFalla = false;
  }
  assert.equal((await cupo(token)).usadas, 0);
  assert.equal((await preguntar(token, "190.12.12.12")).status, 200);
  assert.equal((await cupo(token)).usadas, 1);
});

test("Profundo tiene su techo para todos; al llegar, Rápido sigue y el rechazo no gasta", async () => {
  adelantar(24 * 60 * 60);
  for (let k = 0; k < TOPE_PROFUNDO_TOTAL_DIA; k++) {
    assert.equal((await preguntar(`p${k}|1|p${k}@correo.pe`, `200.20.${k >> 8}.${k & 255}`, "profundo")).status, 200);
  }
  const token = "zoe|1|zoe@correo.pe";
  const r = await preguntar(token, "200.30.0.1", "profundo");
  assert.equal(r.error, "tope_profundo");
  assert.equal((await cupo(token)).usadas, 0);
  assert.equal((await preguntar(token, "200.30.0.1", "rapido")).status, 200);
});

// El asistente de Gobserva Salud no pide cuenta: sus topes son por conexión (sin Turnstile en la prueba: sin secreto).
async function preguntarSalud(ip: string): Promise<{ status: number; error?: string }> {
  return ambitoPedido.run(ambito(), async () => {
    const r = await app.request("/salud/asistente", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ mensajes: [{ rol: "usuario", texto: "¿El Hospital Loayza tiene sanciones?" }] }),
    });
    const texto = await r.text();
    return r.status === 200 ? { status: 200 } : { status: r.status, error: (JSON.parse(texto) as { error?: string }).error };
  });
}

test("Salud: 25 preguntas al día por conexión; insistir después no bloquea", async () => {
  adelantar(24 * 60 * 60);
  const T = TOPES_ASISTENTE_SALUD;
  const ip = "179.9.9.9";
  let bien = 0;
  for (let i = 0; i < T.ipDia; i++) {
    if (i > 0 && i % T.ipMinuto === 0) adelantar(61);
    if ((await preguntarSalud(ip)).status === 200) bien++;
  }
  assert.equal(bien, T.ipDia);
  adelantar(61);
  for (let i = 0; i < T.faltasBloqueo + 5; i++) assert.equal((await preguntarSalud(ip)).error, "tope_dia");
  adelantar(24 * 60 * 60);
  assert.equal((await preguntarSalud(ip)).status, 200);
});
