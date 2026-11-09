import test from "node:test";
import assert from "node:assert/strict";
import { conEnlace, enlaceConocido } from "../src/lib/empleoEnlaces.js";

test("una entidad sin enlace (o sólo con Facebook) toma el sitio donde publica", () => {
  assert.equal(enlaceConocido({ entidad: "PROGRAMA NACIONAL CUNA MAS", detalle_url: null }), "http://extranet.cunamas.gob.pe/jobs");
  assert.equal(enlaceConocido({ entidad: "Programa Nacional Cuna Más", detalle_url: "https://www.facebook.com/cunamas" }), "http://extranet.cunamas.gob.pe/jobs");
  // Con un enlace que sirve, se queda con el suyo.
  assert.equal(enlaceConocido({ entidad: "PROGRAMA NACIONAL CUNA MAS", detalle_url: "https://www.gob.pe/cunamas" }), null);
  // Una entidad que no conocemos: nada.
  assert.equal(enlaceConocido({ entidad: "MUNICIPALIDAD QUE NO EXISTE", detalle_url: null }), null);
});

test("un nombre repetido sólo vale en su región (el Daniel A. Carrión de Huancayo)", () => {
  assert.match(enlaceConocido({ entidad: "HOSPITAL DANIEL ALCIDES CARRION", ubicacion: "JUNÍN - HUANCAYO", detalle_url: "" }) ?? "", /hdachyo/);
  assert.equal(enlaceConocido({ entidad: "HOSPITAL DANIEL ALCIDES CARRION", ubicacion: "CALLAO - CALLAO", detalle_url: "" }), null);
  const p = { aviso: 1, entidad: "JUNTA NACIONAL DE JUSTICIA", ubicacion: "LIMA", detalle_url: null as string | null };
  assert.equal(conEnlace(p).detalle_url, "https://www.gob.pe/jnj");
  assert.equal(conEnlace(p).aviso, 1);
});
