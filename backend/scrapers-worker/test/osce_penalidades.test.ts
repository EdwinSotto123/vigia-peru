import { test } from "node:test";
import assert from "node:assert/strict";
import { fechaPenalidad, normalizarPenalidades } from "../src/fuentes/osce_penalidades.ts";

test("fecha de penalidad DD/MM/AA y DD/MM/AAAA", () => {
  assert.equal(fechaPenalidad("15/02/25"), "2025-02-15");
  assert.equal(fechaPenalidad("1/3/2026"), "2026-03-01");
  assert.equal(fechaPenalidad("31/13/25"), null);
  assert.equal(fechaPenalidad(""), null);
});

test("el CSV de la wiki del OSCE a filas de penalidades", () => {
  const csv = [
    "ID CONTRATO|RUC CONTRATISTA|TIPO PENALIDAD|OBJETO CONTRATO|ENTIDAD CONTRATANTE|FECHA PENALIDAD|DESCRIPCION/MOTIVO|MONTO",
    "2234695|20100000001|Otra Penalidad|Consultoría de Obra|MUNICIPALIDAD DISTRITAL DE MEGANTONI|15/02/25|APLICACION DE PENALIDAD |2575",
    "2234696|123|Por mora|Bien|GORE X|01/10/26||12,5",
    "",
  ].join("\r\n");
  const f = normalizarPenalidades(csv);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], {
    contrato_id: "2234695", empresa_ruc: "20100000001", tipo_penalidad: "Otra Penalidad", objeto_contrato: "Consultoría de Obra",
    entidad_contratante: "MUNICIPALIDAD DISTRITAL DE MEGANTONI", fecha: "2025-02-15", descripcion: "APLICACION DE PENALIDAD", monto: 2575,
  });
  assert.equal(f[1].empresa_ruc, null);
  assert.equal(f[1].monto, 12.5);
});

test("una cabecera distinta no se carga a ciegas", () => {
  assert.throws(() => normalizarPenalidades("A|B|C\n1|2|3"));
});
