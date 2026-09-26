// Decisión de cierre tras el stream (segunda mitad de procesar() en main.py), camino por camino.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirCierre } from "../src/cierre.ts";
import type { Dependencias } from "../src/cierre.ts";
import { ABORT, FAIL, OK } from "../src/sql.ts";
import type { Resultado } from "../src/sql.ts";
import type { Checkpoint } from "../src/stream.ts";
import type { Estado } from "../src/eventos.ts";

const cp = (etapa: Checkpoint["etapa"], resultado: Resultado, state: Estado = {}, excepcion: string | null = null): Checkpoint =>
  ({ etapa, resultado, err: null, state, manija: null, excepcion, motivo: null, eventos: 0 });

function deps(alerta: boolean | Error, gracia: (boolean | Error)[]): Dependencias & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    async alertaPersistida() {
      llamadas.push("alerta");
      if (alerta instanceof Error) throw alerta;
      return alerta;
    },
    async esperarAlerta() {
      llamadas.push("gracia");
      const r = gracia.shift() ?? false;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test("final con alerta en DB → procesado", async () => {
  const d = deps(true, []);
  assert.deepEqual(await decidirCierre(cp("fin", OK), "x", d), { resultado: OK, err: null, aviso: null });
  assert.deepEqual(d.llamadas, ["alerta"]);
});

test("final sin alerta en DB → falla (reintenta)", async () => {
  const r = await decidirCierre(cp("fin", OK), "x", deps(false, []));
  assert.equal(r.resultado, FAIL);
  assert.equal(r.err, "el orquestador terminó sin persistir la alerta");
});

test("sin final y con error en el stream → falla con ese error, sin espera de gracia", async () => {
  const d = deps(true, [true]);
  const r = await decidirCierre(cp("fin", FAIL, { error: "rama documentos: boom" }), "x", d);
  assert.deepEqual(r, { resultado: FAIL, err: "rama documentos: boom", aviso: null });
  assert.deepEqual(d.llamadas, []);
});

test("sin final: la espera de gracia encuentra la alerta → procesado", async () => {
  const r = await decidirCierre(cp("fin", FAIL), "x", deps(false, [true]));
  assert.equal(r.resultado, OK);
  assert.equal(r.err, null);
  assert.ok(r.aviso!.includes("alerta quedó persistida"));
});

test("sin final y sin alerta tras la gracia → falla", async () => {
  const r = await decidirCierre(cp("fin", FAIL), "x", deps(false, [false]));
  assert.deepEqual(r, { resultado: FAIL, err: "stream terminó sin evento final y sin alerta persistida", aviso: null });
});

test("aborto del orquestador → error del estado, sin consultar la DB", async () => {
  const d = deps(true, []);
  const r = await decidirCierre(cp("fin", ABORT, { error: "análisis abortado por el orquestador: ocds_unavailable" }), "x", d);
  assert.deepEqual(r, { resultado: ABORT, err: "análisis abortado por el orquestador: ocds_unavailable", aviso: null });
  assert.deepEqual(d.llamadas, []);
});

test("excepción del stream: gracia; si aparece la alerta → procesado", async () => {
  const r = await decidirCierre(cp("excepcion", FAIL, {}, "x.run.app: Read timed out. (read timeout=1200)"), "x", deps(false, [true]));
  assert.deepEqual(r.resultado, OK);
  assert.equal(r.err, null);
});

test("excepción del stream sin alerta → falla con el texto de la excepción", async () => {
  const r = await decidirCierre(cp("excepcion", FAIL, {}, "conexión reiniciada"), "x", deps(false, [false]));
  assert.deepEqual(r, { resultado: FAIL, err: "conexión reiniciada", aviso: null });
});

test("excepción después del `final`: el resultado OK se conserva aunque la gracia no encuentre nada", async () => {
  const r = await decidirCierre(cp("excepcion", OK, {}, "reset tras final"), "x", deps(false, [false]));
  assert.deepEqual(r, { resultado: OK, err: "reset tras final", aviso: null });
});

test("la comprobación de la alerta falla → camino de excepción (gracia)", async () => {
  const d = deps(new Error("db caída"), [true]);
  const r = await decidirCierre(cp("fin", OK), "x", d);
  assert.equal(r.resultado, OK);
  assert.deepEqual(d.llamadas, ["alerta", "gracia"]);
});

test("la gracia falla dos veces → falla con el error de la primera", async () => {
  const r = await decidirCierre(cp("fin", FAIL), "x", deps(false, [new Error("db caída"), new Error("otra vez")]));
  assert.deepEqual(r, { resultado: FAIL, err: "db caída", aviso: null });
});
