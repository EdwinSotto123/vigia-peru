import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { firmaValida, mensajeRechazo } from "../src/lib/mercadopago.js";

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

test("mercadopago: el motivo del rechazo, dicho para quien paga", () => {
  assert.match(mensajeRechazo("cc_rejected_insufficient_amount"), /saldo/);
  assert.match(mensajeRechazo("cc_rejected_bad_filled_security_code"), /código de seguridad/);
  assert.match(mensajeRechazo("algo_nuevo"), /Yape o Plin/);
  assert.match(mensajeRechazo(null), /no se aprobó/);
});
