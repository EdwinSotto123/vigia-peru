/**
 * Contrataciones menores abiertas (prod6 → seace_cotizacion, migración 262): una fila del buscador y un detalle, con la
 * forma real que mandó prod6 el 2026-11-07 (CM-212658-2026-DRNRT). Las fechas son hora de Lima; del detalle no se guarda
 * quién aprobó cada etapa.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { conZona, deDetalle, deListado } from "../src/fuentes/seace_cotizaciones.ts";

const FILA = {
  secuencia: 1, idContrato: 109107, nroContratacion: 212658, desContratacion: "CM-212658-2026-DRNRT", idObjetoContrato: 1,
  nomObjetoContrato: "Bien", desObjetoContrato: "ADQUISICION  DE MATERIAL DE DIFUSION  INSTITUCIONAL",
  fecIniCotizacion: "06/11/2026 23:50:00", fecFinCotizacion: "07/11/2026 07:00:00", cotizar: true, idEstadoContrato: 2,
  nomEstadoContrato: "Vigente", fecPublica: "06/11/2026 23:46:39", idTipoCotizacion: 1, nomEntidad: "MINISTERIO DE TRABAJO Y PROMOCION DEL EMPLEO",
};

const DETALLE = {
  uitContratoCompletoProjection: {
    idContrato: 109107, nomAreaUsuaria: "DIRECCIÓN DE REGISTROS NACIONALES  DE RELACIONES DE TRABAJO ", nomEstadoContrato: "Vigente",
    nomTipoInvitacion: "INVITACIÓN ABIERTA", nroDescripcion: "CM-212658-2026-DRNRT", idEntidad: 23, nomEntidad: "MINISTERIO DE TRABAJO Y PROMOCION DEL EMPLEO",
  },
  uitContratoEtapaProjectionList: [
    { nomEtapaContrato: "ETAPA DE CONSULTAS", nroDniAprobador: "12345678", nomAprobador: "PERSONA APROBADORA", fecIni: "06/11/2026 23:50:00", fecFin: "07/11/2026 06:00:00" },
    { nomEtapaContrato: "ETAPA DE COTIZACIÓN", nroDniAprobador: "12345678", nomAprobador: "PERSONA APROBADORA", fecIni: "07/11/2026 06:00:00", fecFin: "07/11/2026 07:00:00" },
  ],
  uitContratoItemProjectionList: [
    { codCubso: "6014100100323787", nomCubso: "PELOTA DE GOMA DE 7 cm APROX.", nomUnidadMedida: "UNIDAD", nomDistritoExt: "LIMA/LIMA/JESUS MARIA",
      descripcionItem: "PELOTA DE POLIURETANO   1150 UNIDADES", cantidad: 1150, codRuc: null, precioTotal: null },
    { codCubso: "6014100100323787", nomCubso: "PELOTA", nomUnidadMedida: "UNIDAD", nomDistritoExt: "LIMA/LIMA/JESUS MARIA", descripcionItem: "OTRA", cantidad: "20" },
    { codCubso: "4410310300001234", nomCubso: "TÓNER", nomUnidadMedida: "UNIDAD", nomDistritoExt: "CUSCO/CUSCO/WANCHAQ", descripcionItem: "TÓNER", cantidad: 3 },
  ],
};

test("cotizaciones: la hora de Lima va con su zona", () => {
  assert.equal(conZona("07/11/2026 07:00:00"), "2026-11-07T07:00:00-05:00");
  assert.equal(conZona("7/1/2026 7:05"), "2026-01-07T07:05:00-05:00");
  assert.equal(conZona(null), null);
});

test("cotizaciones: una fila del buscador", () => {
  assert.deepEqual(deListado(FILA), {
    id_prod6: 109107, codigo: "CM-212658-2026-DRNRT", objeto: "Bien", descripcion: "ADQUISICION DE MATERIAL DE DIFUSION INSTITUCIONAL",
    entidad: "MINISTERIO DE TRABAJO Y PROMOCION DEL EMPLEO", estado: "Vigente", fec_publica: "2026-11-06T23:46:39-05:00",
    fec_ini_cotizacion: "2026-11-06T23:50:00-05:00", fec_fin_cotizacion: "2026-11-07T07:00:00-05:00",
  });
  assert.equal(deListado({ ...FILA, idContrato: null }), null);
  assert.equal(deListado({ ...FILA, desContratacion: " " }), null);
});

test("cotizaciones: el detalle, sin quién aprobó, con rubros y distritos sin repetir", () => {
  const d = deDetalle(DETALLE)!;
  assert.equal(d.id_entidad, 23);
  assert.equal(d.area_usuaria, "DIRECCIÓN DE REGISTROS NACIONALES DE RELACIONES DE TRABAJO");
  assert.equal(d.consultas_hasta, "2026-11-07T06:00:00-05:00");
  assert.equal(d.fec_fin_cotizacion, "2026-11-07T07:00:00-05:00");
  assert.deepEqual(d.cubso8, ["60141001", "44103103"]);
  assert.deepEqual(d.distritos, ["LIMA/LIMA/JESUS MARIA", "CUSCO/CUSCO/WANCHAQ"]);
  assert.equal(d.items[1].cantidad, 20);
  assert.doesNotMatch(JSON.stringify(d), /12345678|APROBADORA/);
  assert.equal(deDetalle({}), null);
});
