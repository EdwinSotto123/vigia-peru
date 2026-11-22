import test from "node:test";
import assert from "node:assert/strict";
import { appDeRuta, appDelProducto, grupoDelToken, leerCognito, reclamosSinVerificar, revisarApp } from "../src/lib/cuentasApps.js";

// Cuentas separadas por app (2026-11-07): cada app de Gobserva con su grupo de Cognito.

const jwt = (payload: object) => `${btoa(JSON.stringify({ alg: "RS256" }))}.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.firma`;

const COGNITO = " empleo|us-east-2_6NbPbjwJL|44beeckthuc0fbd5kcglljsngq , licitaciones|us-east-2_crVrk38vW|3o2hsar23q2hn064eg69cqn9ic,malo,obras|us-east-2_X|abcdefghijabcdefghijab";

test("leerCognito: app, grupo, cliente y su emisor; lo raro se ignora", () => {
  const g = leerCognito(COGNITO);
  assert.deepEqual(g.map((x) => x.app), ["empleo", "licitaciones"]);
  assert.equal(g[0].emisor, "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_6NbPbjwJL");
  assert.equal(leerCognito(undefined).length, 0);
});

test("reclamosSinVerificar y grupoDelToken: el emisor elige el grupo; otro emisor (Firebase de Vigía) no es de una app", () => {
  const g = leerCognito(COGNITO);
  assert.equal(reclamosSinVerificar(jwt({ iss: "x", aud: "y" }))?.aud, "y");
  assert.equal(reclamosSinVerificar("no.es.jwt"), null);
  assert.equal(grupoDelToken(jwt({ iss: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_crVrk38vW" }), g)?.app, "licitaciones");
  assert.equal(grupoDelToken(jwt({ iss: "https://securetoken.google.com/simplia-project" }), g), null);
  assert.equal(grupoDelToken("basura", g), null);
});

test("appDelProducto y appDeRuta: Obras va con Licitaciones; líneas y Para ti son de Licitaciones", () => {
  assert.equal(appDelProducto("obras"), "licitaciones");
  assert.equal(appDelProducto("empleo"), "empleo");
  assert.equal(appDelProducto("vigia"), null);
  assert.equal(appDeRuta("/gobserva/cuenta/lineas/3"), "licitaciones");
  assert.equal(appDeRuta("/v1/gobserva/cuenta/para-ti"), "licitaciones");
  assert.equal(appDeRuta("/gobserva/cuenta/alertas"), null);
  assert.equal(appDeRuta("/v1/gobserva/cuenta/cv"), "empleo");
});

test("revisarApp: cada cuenta en su app; la de Vigía sólo en la transición o para leer sus planes", () => {
  const o = { vigia: "planes" as const, metodo: "GET", ruta: "/gobserva/cuenta/me" };
  assert.equal(revisarApp("empleo", "empleo", o), null);
  assert.equal(revisarApp("licitaciones", null, o), null);
  assert.equal(revisarApp("empleo", "licitaciones", o)?.error, "otra_app");
  assert.match(revisarApp("empleo", "licitaciones", o)!.detail, /cuenta de Gobserva Empleo.*Gobserva Licitaciones tiene su propia cuenta/);
  assert.equal(revisarApp(null, "empleo", o)?.error, "cuenta_vigia");
  assert.equal(revisarApp(null, null, { ...o, ruta: "/gobserva/cuenta/planes" }), null);
  // y su uso del MCP (mi_cupo).
  assert.equal(revisarApp(null, null, { ...o, ruta: "/gobserva/cuenta/mcp" }), null);
  assert.equal(revisarApp(null, null, { ...o, metodo: "POST", ruta: "/gobserva/cuenta/planes" })?.error, "cuenta_vigia");
  assert.equal(revisarApp(null, "empleo", { ...o, vigia: "todas" }), null);
});

test("Gobserva Salud tiene su propia cuenta (2026-11-21): su grupo se lee y su producto es suyo", () => {
  const g = leerCognito(`${COGNITO},salud|us-east-2_n5EEwMklV|2h67lbj9l2qdrntc00iefr13dd`);
  assert.deepEqual(g.map((x) => x.app), ["empleo", "licitaciones", "salud"]);
  assert.equal(grupoDelToken(jwt({ iss: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_n5EEwMklV" }), g)?.app, "salud");
  assert.equal(appDelProducto("salud"), "salud");
  const o = { vigia: "planes" as const, metodo: "GET", ruta: "/gobserva/cuenta/me" };
  assert.equal(revisarApp("salud", "empleo", o)?.error, "otra_app");
});
