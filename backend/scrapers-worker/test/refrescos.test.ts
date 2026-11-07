/**
 * La cola de refrescos (migración 260): la cadena de cruces trae cada refresco una vez (el nombre es la llave del lote en
 * refresco_cola), en el orden en que se leen unos a otros, y lo que devuelve la cola se lee igual que antes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { cadenaCruces, crucesDe, numeroDe, type Refrescado } from "../src/fuentes/comun.ts";

const nombres = cadenaCruces().map((r) => r.nombre);

test("cadena de cruces: cada refresco una vez y con su sentencia", () => {
  assert.equal(new Set(nombres).size, nombres.length);
  for (const r of cadenaCruces()) {
    assert.match(r.sql, /^SELECT /);
    if (r.requiere) assert.match(r.requiere, /^\w+\(.*\)$/);
  }
});

test("cadena de cruces: cada uno después de lo que lee", () => {
  const antes = (a: string, b: string) => assert.ok(nombres.indexOf(a) < nombres.indexOf(b), `${a} antes de ${b}`);
  assert.equal(nombres[0], "refrescar_cruces");
  antes("refrescar_cruces", "refrescar_precio_item");            // precio_item rehace el sobreprecio que cruces borra
  antes("dedup_cruces_proveedor", "refrescar_casos_cruce_base");
  antes("refrescar_casos_cruce_base", "refrescar_entidad_antecedentes");
  antes("refrescar_empresa_ordenes", "refrescar_borde_empresas");  // el denominador de la franja
  antes("refrescar_borde_empresas", "refrescar_empresas");
  antes("refrescar_empresas", "refrescar_visita_empresa 1/6");
  assert.equal(nombres.at(-1), "refrescar_poder");
});

test("lo que devuelve la cola: números y cruces", () => {
  const r: Record<string, Refrescado> = {
    refrescar_cruces: { nombre: "refrescar_cruces", estado: "ok", resultado: '[{"tipo":"aporte","filas":1906}]', error: null, segundos: 514 },
    refrescar_empresas: { nombre: "refrescar_empresas", estado: "ok", resultado: "4120", error: null, segundos: 190 },
    refrescar_cruce_acta: { nombre: "refrescar_cruce_acta", estado: "saltado", resultado: null, error: "no existe", segundos: null },
  };
  assert.deepEqual(crucesDe(r), [{ tipo: "aporte", filas: 1906 }]);
  assert.equal(numeroDe(r, "refrescar_empresas"), 4120);
  assert.equal(numeroDe(r, "refrescar_cruce_acta"), null);
  assert.equal(numeroDe(r, "no_estaba"), null);
  assert.deepEqual(crucesDe({}), []);
});
