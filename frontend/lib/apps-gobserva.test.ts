import test from "node:test";
import assert from "node:assert/strict";
import { appDelProducto, appDelSitio, leerToken, mensajeCognito } from "./apps-gobserva.ts";

test("appDelSitio: subdominios de PROD y DEV, ruta en DEV; Obras va con Licitaciones; Vigía no es una app", () => {
  assert.equal(appDelSitio("empleo.gobserva.cloud"), "empleo");
  assert.equal(appDelSitio("licitaciones-dev.gobserva.cloud"), "licitaciones");
  assert.equal(appDelSitio("obras.gobserva.cloud"), "licitaciones");
  assert.equal(appDelSitio("vigia-web-dev.vigiaperu.workers.dev", "/empleo/app/plazas"), "empleo");
  assert.equal(appDelSitio("localhost", "/obras"), "licitaciones");
  assert.equal(appDelSitio("vigia.gobserva.cloud", "/app/contratos"), null);
  assert.equal(appDelSitio("empleo.gobserva.cloud.evil.com"), null);
  // Gobserva Salud tiene su propia cuenta (2026-11-21).
  assert.equal(appDelSitio("salud.gobserva.cloud"), "salud");
  assert.equal(appDelSitio("localhost", "/salud/medicamentos"), "salud");
  assert.equal(appDelProducto("obras"), "licitaciones");
});

test("leerToken: quién entró y cuándo vence (con tildes en el nombre); null si no es un token", () => {
  const cuerpo = Buffer.from(JSON.stringify({ sub: "abc-123", email: "a@b.pe", email_verified: true, name: "José Ñuñez", exp: 2000000000 })).toString("base64url");
  const r = leerToken(`x.${cuerpo}.y`)!;
  assert.deepEqual(r, { sub: "abc-123", email: "a@b.pe", emailVerificado: true, nombre: "José Ñuñez", vence: 2000000000000 });
  assert.equal(leerToken("basura"), null);
  assert.equal(leerToken(`x.${Buffer.from("{}").toString("base64url")}.y`), null);
});

test("mensajeCognito: cada error con su frase, y uno general", () => {
  assert.match(mensajeCognito("UsernameExistsException"), /Ya tienes una cuenta en esta app/);
  assert.match(mensajeCognito("CodeMismatchException"), /código/);
  assert.match(mensajeCognito("Raro"), /No pudimos completar/);
});
