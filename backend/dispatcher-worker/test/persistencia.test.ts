// Port de backend/dispatcher/tests/test_persistencia.py: qué escribe el dispatcher en
// `procesamientos` por cada evento visible (sin DB: se captura el SQL).
import { test } from "node:test";
import assert from "node:assert/strict";
import { entradaBitacora } from "../src/eventos.ts";
import { plazoDeReclamo } from "../src/config.ts";
import { FAIL, OK, ABORT, actualizar, dejarPendiente, refrescarVistas, terminar } from "../src/sql.ts";
import type { Consultor } from "../src/sql.ts";

const MAX_EVENTOS = 400;

function capturador(falla?: (sql: string) => Error | null): { db: Consultor; sql: [string, unknown[]][] } {
  const sql: [string, unknown[]][] = [];
  return {
    sql,
    db: {
      async query(s, params) {
        sql.push([s, params]);
        const e = falla?.(s);
        if (e) throw e;
        return [];
      },
    },
  };
}

test("evento usa el nombre canónico", () => {
  const ts = "2026-09-15T18:00:00+00:00";
  assert.deepEqual(entradaBitacora({ kind: "phase", name: "legal", msg: "análisis legal" }, { fase_actual: "document_legal_analyst" }, ts),
                   { ts, kind: "phase", name: "document_legal_analyst", msg: "análisis legal" });
  // omitido: la bitácora conserva la fase omitida (cambios no trae fase_actual)
  assert.equal(entradaBitacora({ kind: "phase", name: "person_network", msg: "omitido: no aplica" }, { fase_index: 3 }, ts).name, "person_network");
  // warn/error de un sub-agente: sin sufijo _agent
  const ev = entradaBitacora({ kind: "error", agent: "entity_personnel_agent", detail: "boom" }, { error: "boom" }, ts);
  assert.equal(ev.name, "entity_personnel");
  assert.equal(ev.msg, "boom");
});

test("actualizar persiste fases enteras", async () => {
  const { db, sql } = capturador();
  const fases = { market: { estado: "corriendo", desde: "t", hasta: null } };
  await actualizar(db, "1225030", { fase_actual: "market", fase_index: 4, fases, fases_completadas: [] },
                   { ts: "t", kind: "phase", name: "market", msg: "x" }, MAX_EVENTOS);
  const [s, params] = sql[0];
  assert.ok(s.includes("fase_actual = $1") && s.includes("fase_index = $2") && s.includes("fases = $3::jsonb"));
  // Anexa el evento con tope: pasado MAX_EVENTOS descarta el más viejo antes de agregar.
  assert.ok(s.includes("jsonb_array_length(eventos) >= $4 THEN eventos - 0") && s.includes("|| $5::jsonb"));
  assert.equal(params[0], "market");
  assert.equal(params[1], 4);
  assert.deepEqual(JSON.parse(params[2] as string), fases);
  assert.equal(params[3], MAX_EVENTOS);
  assert.deepEqual(JSON.parse(params[4] as string), [{ ts: "t", kind: "phase", name: "market", msg: "x" }]);
  assert.equal(params[params.length - 1], "1225030");
  assert.ok(s.endsWith("WHERE ocid = $6"));
});

test("plazo de reclamo deja terminar el peor análisis", () => {
  // Tarea de 2 h, análisis de hasta 1 h, gracia de 20 min y margen de 5 min: se reclama hasta el minuto 25
  // (la ventana MAX_MIN manda). Con una tarea de 1 h no alcanza: el plazo queda antes del inicio.
  const cfg = { taskTimeoutS: 7200, analisisMaxS: 3600, graceMin: 20, maxMin: 25 };
  assert.equal(plazoDeReclamo(0, cfg), 25 * 60 * 1000);
  assert.equal(plazoDeReclamo(0, { ...cfg, maxMin: 55 }), (7200 - 3600 - 1200 - 300) * 1000);
  assert.ok(plazoDeReclamo(0, { ...cfg, maxMin: 55, taskTimeoutS: 3600 }) < 0);
});

test("refrescar zonas usa el refresco condicional", async () => {
  const { db, sql } = capturador();
  assert.equal(await refrescarVistas(db, true), true);
  assert.deepEqual(sql.map(([s]) => s), ["SELECT refresh_financiamiento_si_hace_falta()"]);
});

test("refrescar zonas sin la migración 32 usa el refresco de siempre", async () => {
  const falta = Object.assign(new Error("function refresh_financiamiento_si_hace_falta() does not exist"), { code: "42883" });
  const { db, sql } = capturador((s) => (s.includes("si_hace_falta") ? falta : null));
  assert.equal(await refrescarVistas(db, true), true);
  assert.deepEqual(sql.map(([s]) => s), ["SELECT refresh_financiamiento_si_hace_falta()", "SELECT refresh_financiamiento()"]);
});

test("actualizar sin fases no toca la columna", async () => {
  const { db, sql } = capturador();
  await actualizar(db, "x", { error: "boom" }, null, MAX_EVENTOS);
  const [s, params] = sql[0];
  assert.ok(!s.includes("fases") && !s.includes("eventos"));
  assert.deepEqual(params, ["boom", "x"]);
});

test("terminar OK cierra con hora real", async () => {
  const { db, sql } = capturador();
  await terminar(db, "x", OK, null);
  const [s] = sql[0];
  assert.ok(s.includes("WHEN estado = 'procesando' THEN now()") && s.includes("estado = 'procesado'") && s.includes("fase_index = 10"));
});

test("terminar OK refresca el ranking", async () => {
  const { db, sql } = capturador();
  await terminar(db, "x", OK, null);
  assert.ok(sql.some(([s]) => s.includes("refresh_ranking()")));
  // zona_estado (2 s) no se refresca por contrato: solo al final de la corrida
  assert.ok(!sql.some(([s]) => s.includes("refresh_financiamiento()")));
});

test("terminar FAIL no refresca y respeta los 3 intentos", async () => {
  const { db, sql } = capturador();
  await terminar(db, "x", FAIL, "boom");
  assert.ok(!sql.some(([s]) => s.includes("refresh")));
  assert.ok(sql[0][0].includes("CASE WHEN intentos >= $1 THEN 'error' ELSE 'encolado' END"));
  assert.deepEqual(sql[0][1], [3, "boom", "x"]);
});

test("terminar ABORT devuelve el intento", async () => {
  const { db, sql } = capturador();
  await terminar(db, "x", ABORT, "fuente caída");
  assert.ok(sql[0][0].includes("intentos = greatest(intentos - 1, 0)") && sql[0][0].includes("estado = 'encolado'"));
  assert.deepEqual(sql[0][1], ["fuente caída", "x"]);
});

test("dejar pendiente recorta el motivo como Python", async () => {
  const { db, sql } = capturador();
  await dejarPendiente(db, "x", null);
  assert.equal(sql[0][1][0], "pendiente de procesamiento: no procesable");
  await dejarPendiente(db, "x", "ñ".repeat(600));
  assert.equal(Array.from(sql[1][1][0] as string).length, 500);
});

test("refrescar vistas no tumba si la DB falla", async () => {
  const { db } = capturador(() => new Error("db caída"));
  assert.equal(await refrescarVistas(db, true), false);
});
