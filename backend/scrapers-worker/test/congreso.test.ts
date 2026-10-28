import test from "node:test";
import assert from "node:assert/strict";
import { fechaCongreso, filaCongreso, horaCongreso } from "../src/fuentes/congreso_visitas.ts";

test("congreso_visitas: fechas y horas del registro", () => {
  assert.equal(fechaCongreso("27/10/26"), "2026-10-27");
  assert.equal(fechaCongreso("5/1/2021"), "2021-01-05");
  assert.equal(fechaCongreso("ayer"), null);
  assert.equal(horaCongreso("7:04"), "07:04");
  assert.equal(horaCongreso("17:35:10"), "17:35");
  assert.equal(horaCongreso(""), null);
});

test("congreso_visitas: una visita como fila, con su tipo de visitante", () => {
  const base = { entidadVisitanteNombreCompleto: "PEREZ LOPEZ, JUAN", entidadVisitanteTipoDocumento: "DNI/LE", entidadVisitanteDocumento: "12345678",
    fechaRegistro: "27/10/26", fechaVisitaRecepcion: "27/10/26", horaIngreso: "07:04", fechaVisitaTermino: "08:34", cargo: "DIPUTADO ",
    centroCostoNombre: "ADMINISTRACION EDIFICIO MARIO VARGAS LLOSA", edificio: "MARIO VARGAS LLOSA", ubicacion: "PISO 3", motivo: "REUNIÓN" };
  const f = filaCongreso({ ...base, entidad: "MINISTERIO DE SALUD" }, "2026-10-27", "2026-10-28T00:00:00Z")!;
  assert.equal(f.tipo_entidad_visitante, "publica");
  assert.equal(f.tipo_documento, "DNI");
  assert.equal(f.duracion_min, 90);
  assert.equal(f.funcionario_cargo, "DIPUTADO");
  assert.equal(f.visitante_norm, "PEREZ LOPEZ JUAN");
  assert.equal(f.periodo, "2026-10");
  assert.equal(f.lugar_especifico, "MARIO VARGAS LLOSA, PISO 3");
  assert.equal(filaCongreso({ ...base, entidad: "GRUPO ABC SAC" }, "2026-10-27", "x")!.tipo_entidad_visitante, "privada");
  assert.equal(filaCongreso({ ...base, entidad: "" }, "2026-10-27", "x")!.tipo_entidad_visitante, "persona_natural");
  assert.equal(filaCongreso({ ...base, entidadVisitanteNombreCompleto: " " }, "2026-10-27", "x"), null);
});
