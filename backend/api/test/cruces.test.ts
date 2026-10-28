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

test("patrones de visitas: cada visita bajo `visitas`, sin el nombre de quien recibió ni el DNI del visitante", () => {
  const fila = { ...base, tipo: "visita_repetida", severidad: "alta", fuente: "visitas_entidades", fuente_url: "https://visitas.servicios.gob.pe/consultas",
    persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "GERENTE_GENERAL", ocid: "ocds-dgv273-seacev3-2",
    detalle: { entidad_visitada: "GOBIERNO REGIONAL X", misma_entidad: true, cargo_funcionario: "SUB GERENTE", area_funcionario: "LOGISTICA",
      decisor: true, dias: 3, visitas_n: 4, dias_antes: 9, fuente_visita: "portal_visitas_nacional",
      visitas: [{ fecha: "2025-08-01", hora: "09:10", minutos: 40 }, { fecha: "2025-08-12", hora: "16:05", minutos: 20 }, { fecha: "2025-09-02", hora: "10:00", minutos: 90 }] } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.socios.length, 0);
  assert.equal(c.visitas.length, 3);
  assert.equal(c.visitas[0].cargoFuncionario, "SUB GERENTE");
  assert.equal(c.visitas[0].decisor, true);
  assert.equal(c.detalle.visitas, undefined);
  assert.equal(c.fuenteUrl, "https://visitas.servicios.gob.pe/");
  assert.doesNotMatch(json(c), /TICONA|00000789/);
});

test("penalidad de empresa: sin personas, montos numéricos", () => {
  const c = aCruce({ ...base, tipo: "penalidad", severidad: "media", persona_doc: null, persona_nombre: null, persona_rol: null,
    detalle: { penalidades: 3 } });
  assert.deepEqual(c.socios, []);
  assert.equal(c.etiqueta, "Penalidades en contratos anteriores");
});

test("contexto del ganador: la razón social de un RUC 10 y los otros postores RUC 10 salen tapados", () => {
  const c = {
    ...aCruce({ ...base, tipo: "socio_comun", severidad: "alta", ruc_empresa: "10000000011", persona_doc: "00000001",
      persona_nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO", persona_rol: "TITULAR", detalle: { otros_postores: ["10000007891", "20999999992"] } }),
    proveedor: "QUISPEMAYTA HUAMANCHUMO ROBERTINO", buenaPro: { fecha: "2026-08-01", montoSoles: 1000 },
    otrosPostores: [{ ruc: "10000007891", nombre: "CCAHUANA TICONA FILOMENO" }, { ruc: "20999999992", nombre: "EMPRESA INVENTADA SAC" }],
  };
  const p = publicar({ cruces: [c] }).cruces[0];
  assert.doesNotMatch(json(p), /HUAMANCHUMO|TICONA|00000001|00000789|10000000011|10000007891/);
  assert.equal(p.otrosPostores[1].nombre, "EMPRESA INVENTADA SAC");
  assert.equal(p.buenaPro.montoSoles, 1000);
});

test("visita previa: el rol del visitante en la empresa sale legible", () => {
  const c = aCruce({ ...base, tipo: "visita_previa", severidad: "alta", persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "REPRESENTANTE_LEGAL, SOCIO_ACCIONISTA_TITULAR", detalle: { entidad_visitada: "X", dias_antes: 5 } });
  assert.equal(c.visitas[0].rol, "representante legal, socio");
});
