import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { ambitoPedido, fijarPlataforma, type AmbitoPedido, type Plataforma } from "../src/lib/plataforma.js";
import { cuentasRouter } from "../src/routes/cuentas.js";
import { FALTAS_PARA_BLOQUEO, TOPE_CUENTA_DIA, TOPE_CUENTA_MINUTO, TOPE_IP_DIA, TOPE_SIN_VERIFICAR_DIA } from "../src/lib/chatVigia.js";

/**
 * Los topes del asistente de Vigía (2026-11-24, el usuario: «verifica que funcionen los límites… en Vigía, que es gratis,
 * damos 10 consultas al día con IA»), de punta a punta por la ruta POST /cuentas/me/chat: la cuenta, el token, la IP y el
 * limitador. El limitador es un doble del Durable Object (workers/limitador.ts: ventana deslizante por clave, el pedido
 * rechazado no se anota) con un reloj que se adelanta a mano. Sin modelo ni MCP: la respuesta sale como evento de error,
 * pero el tope ya se contó (se cuenta antes de preguntar).
 */

let reloj = Date.UTC(2026, 10, 24, 15, 0, 0);
const adelantar = (s: number) => {
  reloj += s * 1000;
};
const marcas = new Map<string, number[]>();
const vigentes = (clave: string, ventanaS: number) => (marcas.get(clave) ?? []).filter((t) => reloj - t < ventanaS * 1000);
const limitador = {
  async contar(clave: string, tope: number, ventanaS: number) {
    const m = vigentes(clave, ventanaS);
    if (m.length >= tope) {
      marcas.set(clave, m);
      return false;
    }
    m.push(reloj);
    marcas.set(clave, m);
    return true;
  },
  async cuantas(clave: string, ventanaS: number) {
    return vigentes(clave, ventanaS).length;
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

async function preguntar(token: string, ip: string): Promise<{ status: number; error?: string; detail?: string }> {
  const ambito = { limitador: () => limitador, seguir: () => {} } as unknown as AmbitoPedido;
  return ambitoPedido.run(ambito, async () => {
    const r = await app.request("/cuentas/me/chat", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ mensajes: [{ rol: "usuario", texto: "¿Qué contratos tiene la municipalidad de Puno?" }] }),
    });
    const texto = await r.text();
    if (r.status === 200) return { status: 200 };
    const d = JSON.parse(texto) as { error?: string; detail?: string };
    return { status: r.status, error: d.error, detail: d.detail };
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
  const r = await ambitoPedido.run({ limitador: () => limitador, seguir: () => {} } as unknown as AmbitoPedido, () =>
    app.request("/cuentas/me/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  );
  assert.equal(r.status, 401);
});
