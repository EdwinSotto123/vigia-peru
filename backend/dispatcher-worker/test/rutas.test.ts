// Port de backend/dispatcher/tests/test_routing.py: tipo de contratación → servicio de agentes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PERFIL_DE_TIPO, perfilDe, urlPara } from "../src/rutas.ts";

const ENV_COMPLETO = {
  AGENT_URL: "https://viejo.run.app/",
  AGENT_URL_BIENES: "https://bienes.run.app",
  AGENT_URL_SERVICIOS: "https://servicios.run.app/",
  AGENT_URL_OBRAS: "https://obras.run.app",
  AGENT_URL_OTROS: "https://otros.run.app",
};

test("perfil de tipo", () => {
  const casos: [string, string][] = [
    ["bienes", "bienes"], ["servicios", "servicios"], ["obras", "obras"],
    ["consultoria", "otros"], ["convenio", "otros"], ["directa", "otros"], ["otro", "otros"],
    ["OBRAS", "obras"], [" directa ", "otros"],
  ];
  for (const [tipo, perfil] of casos) assert.equal(perfilDe(tipo), perfil, tipo);
});

test("perfil desconocido o vacío", () => {
  assert.equal(perfilDe(null), null);
  assert.equal(perfilDe(""), null);
  assert.equal(perfilDe("x"), null);
  assert.deepEqual(new Set(Object.values(PERFIL_DE_TIPO)), new Set(["bienes", "servicios", "obras", "otros"]));
});

test("url por tipo con todas configuradas", () => {
  assert.deepEqual(urlPara("bienes", ENV_COMPLETO), ["https://bienes.run.app", "bienes"]);
  assert.deepEqual(urlPara("servicios", ENV_COMPLETO), ["https://servicios.run.app", "servicios"]); // sin barra final
  assert.deepEqual(urlPara("obras", ENV_COMPLETO), ["https://obras.run.app", "obras"]);
  for (const t of ["consultoria", "convenio", "directa", "otro"]) assert.deepEqual(urlPara(t, ENV_COMPLETO), ["https://otros.run.app", "otros"]);
});

test("fallback AGENT_URL solo para bienes y sin clasificación", () => {
  const env = { AGENT_URL: "https://viejo.run.app/" };
  assert.deepEqual(urlPara("bienes", env), ["https://viejo.run.app", "bienes"]);
  assert.deepEqual(urlPara(null, env), ["https://viejo.run.app", "bienes"]);
  // servicios/obras/otros NUNCA van al de bienes: quedan pendientes
  assert.deepEqual(urlPara("servicios", env), [null, "servicios"]);
  assert.deepEqual(urlPara("obras", env), [null, "obras"]);
  assert.deepEqual(urlPara("directa", env), [null, "otros"]);
});

test("tipo desconocido no enruta", () => {
  assert.deepEqual(urlPara("misterioso", ENV_COMPLETO), [null, null]);
});

test("sin ninguna url", () => {
  assert.deepEqual(urlPara("bienes", {}), [null, "bienes"]);
  assert.deepEqual(urlPara(null, {}), [null, null]);
});

test("AGENT_URL_BIENES tiene prioridad sobre AGENT_URL", () => {
  const env = { AGENT_URL: "https://viejo.run.app", AGENT_URL_BIENES: "https://bienes.run.app" };
  assert.deepEqual(urlPara("bienes", env), ["https://bienes.run.app", "bienes"]);
  // sin clasificación se usa el histórico (a demanda, acepta cualquier tipo)
  assert.deepEqual(urlPara(null, env), ["https://viejo.run.app", "bienes"]);
});
