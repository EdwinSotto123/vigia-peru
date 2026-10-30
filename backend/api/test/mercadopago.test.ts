import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DESCRIPTOR, MENSAJE_RECHAZO, corresponde, firmaValida, mensajeRechazo } from "../src/lib/mercadopago.js";

const SECRETO = "clave-de-prueba";
const firmar = (manifiesto: string, secreto = SECRETO) => createHmac("sha256", secreto).update(manifiesto).digest("hex");

test("mercadopago: firma válida con data.id, request-id y ts", async () => {
  const v1 = firmar("id:12345;request-id:abc-123;ts:1704908010;");
  assert.equal(await firmaValida(SECRETO, `ts=1704908010,v1=${v1}`, "abc-123", "12345"), true);
  assert.equal(await firmaValida(SECRETO, ` ts=1704908010 , v1=${v1.toUpperCase()}`, "abc-123", "12345"), true);
});

test("mercadopago: el data.id alfanumérico va en minúsculas; sin request-id esa parte no va", async () => {
  assert.equal(await firmaValida(SECRETO, `ts=1,v1=${firmar("id:abc12f;request-id:r1;ts:1;")}`, "r1", "ABC12F"), true);
  assert.equal(await firmaValida(SECRETO, `ts=7,v1=${firmar("id:99;ts:7;")}`, null, "99"), true);
});

test("mercadopago: otra clave, otro id, otra hora o sin cabecera no pasan", async () => {
  const v1 = firmar("id:12345;request-id:abc;ts:10;");
  assert.equal(await firmaValida(SECRETO, `ts=10,v1=${firmar("id:12345;request-id:abc;ts:10;", "otra")}`, "abc", "12345"), false);
  assert.equal(await firmaValida(SECRETO, `ts=10,v1=${v1}`, "abc", "12346"), false);
  assert.equal(await firmaValida(SECRETO, `ts=11,v1=${v1}`, "abc", "12345"), false);
  assert.equal(await firmaValida(SECRETO, null, "abc", "12345"), false);
  assert.equal(await firmaValida(undefined, `ts=10,v1=${v1}`, "abc", "12345"), false);
  assert.equal(await firmaValida(SECRETO, "v1=solo", "abc", "12345"), false);
});

test("mercadopago: un solo mensaje de rechazo, que no le dice a quien prueba tarjetas qué falló", () => {
  const motivos = ["cc_rejected_insufficient_amount", "cc_rejected_bad_filled_security_code", "cc_rejected_high_risk", "algo_nuevo", null];
  for (const m of motivos) assert.equal(mensajeRechazo(m), MENSAJE_RECHAZO);
  assert.doesNotMatch(MENSAJE_RECHAZO, /saldo|código de seguridad|vencimiento/);
});

test("mercadopago: un pago corresponde a un aporte sólo en soles, por su monto y cobrado por la cuenta de Vigía", () => {
  const pago = { transaction_amount: 20, currency_id: "PEN", collector_id: 111 };
  assert.equal(corresponde(pago, 20, 111), true);
  assert.equal(corresponde({ ...pago, transaction_amount: 20.004 }, 20, 111), true);   // redondeo de centavos
  assert.equal(corresponde({ ...pago, transaction_amount: 1 }, 20, 111), false);       // cobro de verificación
  assert.equal(corresponde({ ...pago, transaction_amount: 50_000 }, 20, 111), false);
  assert.equal(corresponde({ ...pago, currency_id: "USD" }, 20, 111), false);
  assert.equal(corresponde({ ...pago, collector_id: 222 }, 20, 111), false);           // otra cuenta
  assert.equal(corresponde(pago, 20, null), true);                                     // sin leer la cuenta: lo demás igual se mira
  assert.equal(corresponde({ transaction_amount: 20 }, 20, 111), true);                // sin moneda: soles
});

test("mercadopago: el descriptor de la tarjeta entra en los 13 caracteres de Mercado Pago", () => {
  assert.ok(DESCRIPTOR.length <= 13);
});
