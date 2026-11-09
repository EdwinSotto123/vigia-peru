import test from "node:test";
import assert from "node:assert/strict";
import { REMITENTE, RESPONDER_A, cuerpoResend, estadoCorreo } from "../src/lib/correo.js";

test("el envío por Resend: remitente, respuesta a hello@ y la baja de un clic", () => {
  const c = cuerpoResend({ para: "alguien@ejemplo.pe", asunto: "3 plazas nuevas", html: "<p>x</p>", texto: "x", baja: "https://gobserva.cloud/baja?t=abc" });
  assert.equal(c.from, REMITENTE);
  assert.deepEqual(c.to, ["alguien@ejemplo.pe"]);
  assert.equal(c.reply_to, RESPONDER_A);
  assert.deepEqual(c.headers, { "List-Unsubscribe": "<https://gobserva.cloud/baja?t=abc>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  assert.equal("headers" in cuerpoResend({ para: "a@b.pe", asunto: "x", html: "", texto: "" }), false);
});

test("con la llave de Resend el correo llega a cualquiera", async () => {
  const antes = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_prueba";
  try {
    assert.deepEqual(await estadoCorreo(), { configurado: true, produccion: true, revision: "resend" });
  } finally {
    if (antes === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = antes;
  }
});
