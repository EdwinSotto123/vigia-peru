/**
 * GCS en Workers (src/workers/gcs.ts). La firma v4 se compara BYTE A BYTE con la de
 * @google-cloud/storage (el SDK que usa Cloud Run) firmando con la misma llave a la misma hora: la
 * firma RSA PKCS#1 v1.5 es determinista, así que las URLs tienen que ser idénticas.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Storage } from "@google-cloud/storage";
import { descargarObjeto, firmarUrlV4, metadatosObjeto } from "../src/workers/gcs.js";
import { SinCredencial } from "../src/workers/google.js";
import { cuentaFalsa, simularFetch } from "./ayuda.js";

const cuenta = cuentaFalsa();
const sdk = new Storage({ projectId: "proyecto-prueba", credentials: { client_email: cuenta.email, private_key: cuenta.pemPrivado } });
const AHORA = Date.UTC(2026, 8, 26, 14, 3, 27, 512);

const casos = [
  { nombre: "subida (write + content-type)", bucket: "vigia-peru-documentos", ruta: "uid123/1758900000000-foto_1.jpg", o: { action: "write" as const, expires: AHORA + 15 * 60 * 1000, contentType: "image/jpeg" } },
  { nombre: "lectura con disposition y tipo", bucket: "vigia-lotes", ruta: "lotes/2026-09/ocds 1234/Bases Integradas (v2).pdf", o: { action: "read" as const, expires: AHORA + 15 * 60 * 1000, responseDisposition: 'inline; filename="1249555-Bases_Integradas.pdf"', responseType: "application/pdf" } },
  { nombre: "lectura sin opciones, ruta con ñ y +", bucket: "b", ruta: "a/ñandú+x=y&z.bin", o: { action: "read" as const, expires: AHORA + 7 * 24 * 3600 * 1000 } },
];

for (const c of casos) {
  test(`firma v4 idéntica al SDK: ${c.nombre}`, async () => {
    process.env.GCP_SA_KEY = cuenta.json;
    const [esperada] = await sdk.bucket(c.bucket).file(c.ruta).getSignedUrl({ version: "v4", accessibleAt: new Date(AHORA), ...c.o });
    const propia = await firmarUrlV4(c.bucket, c.ruta, c.o, AHORA);
    assert.equal(propia, esperada);
  });
}

test("firma v4: vencida o de más de 7 días tira", async () => {
  process.env.GCP_SA_KEY = cuenta.json;
  await assert.rejects(firmarUrlV4("b", "x", { action: "read", expires: AHORA - 1000 }, AHORA), /ya pasó/);
  await assert.rejects(firmarUrlV4("b", "x", { action: "read", expires: AHORA + 8 * 24 * 3600 * 1000 }, AHORA), /siete días/);
});

test("firma v4 sin GCP_SA_KEY: SinCredencial", async () => {
  delete process.env.GCP_SA_KEY;
  await assert.rejects(firmarUrlV4("b", "x", { action: "read", expires: Date.now() + 60_000 }), SinCredencial);
});

test("metadatos y descarga por la API JSON con el access token", async () => {
  process.env.GCP_SA_KEY = cuentaFalsa("otra@proyecto-prueba.iam.gserviceaccount.com").json;
  const f = simularFetch(({ url }) => {
    if (url.startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "ya29.gcs", expires_in: 3600 });
    if (url.endsWith("?alt=media")) return new Response(new Uint8Array([1, 2, 3]));
    if (url.includes("/o/comprobantes%2Fno-existe.png")) return Response.json({ error: { code: 404, message: "No such object" } }, { status: 404 });
    return Response.json({ contentType: "image/png", size: "3" });
  });
  try {
    assert.deepEqual(await metadatosObjeto("vigia-peru-privado", "comprobantes/ab c.png"), { contentType: "image/png", size: "3" });
    assert.deepEqual([...await descargarObjeto("vigia-peru-privado", "comprobantes/ab c.png")], [1, 2, 3]);
    const aGcs = f.pedidos.filter((p) => p.url.startsWith("https://storage.googleapis.com/"));
    assert.equal(aGcs[0].url, "https://storage.googleapis.com/storage/v1/b/vigia-peru-privado/o/comprobantes%2Fab%20c.png");
    assert.equal((aGcs[0].init?.headers as Record<string, string>).Authorization, "Bearer ya29.gcs");
    await assert.rejects(metadatosObjeto("vigia-peru-privado", "comprobantes/no-existe.png"), (e: unknown) => (e as { code?: number }).code === 404 && /No such object/.test((e as Error).message));
  } finally {
    f.restaurar();
  }
});
