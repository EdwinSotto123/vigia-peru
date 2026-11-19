import test from "node:test";
import assert from "node:assert/strict";
import { TOPE_TIPO_RARO, tipoRaro } from "../src/routes/contratos.js";

// El filtro de antecedentes elige su forma por cuántos contratos tiene el tipo: pocos → primero el conjunto; muchos → el
// recorrido por fecha (EXISTS). Elegir mal no da otro resultado, sólo lo hace lento (o un 500 en frío).
const conteos = { observado_por_contraloria: 1130, unico_postor: 9743, socio_de_inhabilitada: 2372, raro_a: 100, raro_b: 200 };

test("un tipo con pocos contratos arma el conjunto; uno frecuente, no", () => {
  assert.equal(tipoRaro({ cruce: "observado_por_contraloria" }, conteos), true);
  assert.equal(tipoRaro({ cruce: "unico_postor" }, conteos), false);
  assert.ok(conteos.observado_por_contraloria < TOPE_TIPO_RARO && conteos.unico_postor > TOPE_TIPO_RARO);
});

test("alguno de varios suma; todos a la vez toma el menor", () => {
  assert.equal(tipoRaro({ cruce: "socio_de_inhabilitada,observado_por_contraloria" }, conteos), false);   // 3 502
  assert.equal(tipoRaro({ cruce: "raro_a,raro_b" }, conteos), true);
  assert.equal(tipoRaro({ cruce: "unico_postor,observado_por_contraloria", cruce_todas: 1 } as never, conteos), true);
});

test("sin tipo concreto o sin conteos, el recorrido de siempre", () => {
  assert.equal(tipoRaro({ cruces: "con" }, conteos), false);
  assert.equal(tipoRaro({ cruces: "alta" }, conteos), false);
  assert.equal(tipoRaro({ cruce: "observado_por_contraloria" }, {}), false);
  assert.equal(tipoRaro({ cruce: "observado_por_contraloria" }, undefined), false);
});
