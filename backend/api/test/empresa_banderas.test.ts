import test from "node:test";
import assert from "node:assert/strict";
import { BANDERAS_CONTRATO, BANDERA_SQL } from "../src/routes/empresas.js";

// La faceta «Sanción del Tribunal» de los contratos de una empresa (2026-10-27): sus chips tienen que sumar «Todos».
// Antes «Todos 321, Sancionada antes 149, Sancionada después 172, Sin banderas 171» no sumaba.

type Valor = boolean | null;
interface Proceso { al_ganar: object | null; s_antes: number | null; s_despues: number | null }

/** Evalúa una condición de BANDERA_SQL (átomos unidos por AND) con la lógica de tres valores de SQL. */
function evaluar(sql: string, x: Proceso): Valor {
  const atomo = (a: string): Valor => {
    const t = a.trim();
    if (t === "x.al_ganar IS NOT NULL") return x.al_ganar !== null;
    if (t === "x.al_ganar IS NULL") return x.al_ganar === null;
    const mayor = /^x\.(s_antes|s_despues) > 0$/.exec(t);
    if (mayor) { const v = x[mayor[1] as "s_antes" | "s_despues"]; return v === null ? null : v > 0; }
    const coalesce = /^COALESCE\(x\.(s_antes|s_despues), 0\) = 0$/.exec(t);
    if (coalesce) return (x[coalesce[1] as "s_antes" | "s_despues"] ?? 0) === 0;
    throw new Error(`átomo desconocido: ${t}`);
  };
  const vs = sql.split(" AND ").map(atomo);
  return vs.includes(false) ? false : vs.includes(null) ? null : true;
}

test("empresa: las cuatro de la faceta de sanciones son una partición (cada proceso en una sola)", () => {
  const particion = ["inhabilitada", "sancionada_antes", "solo_despues", "sin_sancion"] as const;
  for (const p of particion) assert.ok((BANDERAS_CONTRATO as readonly string[]).includes(p), p);
  for (const al_ganar of [null, {}]) {
    for (const s_antes of [null, 0, 1]) {
      for (const s_despues of [null, 0, 2]) {
        const x = { al_ganar, s_antes, s_despues };
        const en = particion.filter((p) => evaluar(BANDERA_SQL[p], x) === true);
        assert.equal(en.length, 1, JSON.stringify({ x, en }));
      }
    }
  }
});

test("empresa: los valores de los enlaces de antes siguen filtrando", () => {
  for (const b of ["sancionada_despues", "antecedentes", "dudoso", "sin"]) assert.ok((BANDERAS_CONTRATO as readonly string[]).includes(b), b);
  assert.equal(BANDERA_SQL.dudoso, "x.dudoso IS NOT NULL");
});
