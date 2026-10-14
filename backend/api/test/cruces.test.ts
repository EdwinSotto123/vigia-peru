import test from "node:test";
import assert from "node:assert/strict";
import { aCruce } from "../src/lib/cruces.js";
import { TAPA_NOMBRE, publicar } from "../src/lib/privacidad.js";

process.env.PRIVACIDAD_CLAVE = "clave-de-prueba-de-32-caracteres-o-mas";

const json = (v: unknown) => JSON.stringify(v);

// Datos sintéticos (DNI 00000001 / 00000789, nombres inventados).
const base = { ruc_empresa: "20999999991", ocid: null, fecha: "2025-03-01", monto: "1500.00", fuente: "x", fuente_url: null };

test("aporte de un socio: el DNI no sale y el nombre (orden SUNAT) lleva un apellido tapado", () => {
  const fila = { ...base, tipo: "aporte", severidad: "media", persona_doc: "00000001", persona_nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO",
    persona_rol: "REPRESENTANTE_LEGAL, SOCIO_ACCIONISTA_TITULAR", detalle: { partido: "PARTIDO INVENTADO", aportes: 2 } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.doesNotMatch(json(c), /00000001/);
  assert.equal(c.socios[0].rol, "representante legal, socio");
  assert.match(c.socios[0].nombre, new RegExp(TAPA_NOMBRE.replace(/[•]/g, "\\u2022")));
  assert.doesNotMatch(json(c), /HUAMANCHUMO/);
  assert.equal(c.detalle.partido, "PARTIDO INVENTADO");
  assert.equal(c.montoSoles, 1500);
});

test("visita previa: visitante y funcionario van bajo `visitas` y se tapan; el detalle no los repite", () => {
  const fila = { ...base, tipo: "visita_previa", severidad: "alta", persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "SOCIO_ACCIONISTA_TITULAR", ocid: "ocds-dgv273-seacev3-1",
    detalle: { entidad_visitada: "GOBIERNO REGIONAL X", misma_entidad: true, funcionario: "MAMANI APAZA EUSTAQUIO",
      cargo_funcionario: "GERENTE", motivo: "REUNION", dias_antes: 12 } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.socios.length, 0);
  assert.equal(c.visitas.length, 1);
  assert.equal(c.detalle.funcionario, undefined);
  assert.equal(c.detalle.dias_antes, 12);
  assert.doesNotMatch(json(c), /TICONA|APAZA|00000789/);
});

test("penalidad de empresa: sin personas, montos numéricos", () => {
  const c = aCruce({ ...base, tipo: "penalidad", severidad: "media", persona_doc: null, persona_nombre: null, persona_rol: null,
    detalle: { penalidades: 3 } });
  assert.deepEqual(c.socios, []);
  assert.equal(c.etiqueta, "Penalidades en contratos anteriores");
});
