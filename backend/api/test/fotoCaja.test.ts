import test from "node:test";
import assert from "node:assert/strict";
import { esJpeg, leerCaja, limpiarCaja } from "../src/lib/fotoCaja.js";

test("la lectura de una caja: el registro y el lote con la forma del buscador, sin las palabras de la etiqueta", () => {
  const l = limpiarCaja({
    es_medicamento: true,
    nombre: "PANADOL Antigripal NF",
    principio_activo: "Paracetamol",
    concentracion: "500 mg",
    registro_sanitario: "Reg. San. N° EE-08059",
    lote: "Lote: 2405123",
    vencimiento: "Venc. 05/2027",
    titular: "GlaxoSmithKline Perú S.A.",
  });
  assert.equal(l.esMedicamento, true);
  assert.equal(l.registro, "EE08059");
  assert.equal(l.lote, "2405123");
  assert.equal(l.vencimiento, "05/2027");
  assert.equal(l.nombre, "PANADOL Antigripal NF");
});

test("lo que no tiene forma se descarta: un registro inventado, un lote sin números, un nombre con un DNI", () => {
  const l = limpiarCaja({ es_medicamento: true, nombre: "Juan Pérez 41234567", registro_sanitario: "no se lee", lote: "ABCDEF", vencimiento: "pronto" });
  assert.equal(l.registro, null);
  assert.equal(l.lote, null);
  assert.equal(l.vencimiento, null);
  assert.equal(l.nombre, null);
});

test("una «L» pegada al lote se queda (puede ser parte de él); «L.» o «L:» es la etiqueta", () => {
  assert.equal(limpiarCaja({ lote: "L2345" }).lote, "L2345");
  assert.equal(limpiarCaja({ lote: "L. 20250502QX" }).lote, "20250502QX");
});

test("una foto que no es de un medicamento", () => {
  assert.equal(limpiarCaja({ es_medicamento: false }).esMedicamento, false);
});

test("JPEG por su firma", () => {
  assert.equal(esJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), true);
  assert.equal(esJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
});

test("leerCaja manda la imagen al modelo con la herramienta forzada y valida lo que vuelve", async () => {
  let cuerpo: Record<string, any> = {};
  const l = await leerCaja(async (c) => {
    cuerpo = c;
    return new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ function: { name: "caja", arguments: JSON.stringify({ es_medicamento: true, registro_sanitario: "N-12345", lote: "Lot 7788A" }) } }] } }],
      usage: { prompt_tokens: 900, completion_tokens: 60 },
    }), { status: 200 });
  }, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  assert.equal(cuerpo.tool_choice.function.name, "caja");
  assert.match(cuerpo.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(l.lectura.registro, "N12345");
  assert.equal(l.lectura.lote, "7788A");
  assert.equal(l.entrada, 900);
  await assert.rejects(leerCaja(async () => new Response("", { status: 502 }), new Uint8Array([0xff, 0xd8, 0xff])), /modelo_502/);
});
