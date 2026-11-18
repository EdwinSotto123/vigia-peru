import { test } from "node:test";
import assert from "node:assert/strict";
import { CRON_DATOS, CRON_DOCUMENTOS, esSegundaVuelta } from "../src/calendario.ts";

test("la segunda vuelta corre con el cron de cada hora, a las 15:40 de Lima, y sólo entonces", () => {
  assert.equal(esSegundaVuelta(CRON_DOCUMENTOS, Date.parse("2026-11-18T20:40:00Z")), true);    // 15:40 Lima
  assert.equal(esSegundaVuelta(CRON_DOCUMENTOS, Date.parse("2026-11-18T19:40:00Z")), false);   // 14:40 Lima
  assert.equal(esSegundaVuelta(CRON_DATOS, Date.parse("2026-11-18T20:40:00Z")), false);        // otro cron
});
