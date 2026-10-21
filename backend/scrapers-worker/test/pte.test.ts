/**
 * Portal de Transparencia Estándar (planilla): el CSV del rubro Personal sale como filas sin pensionistas, el id de la
 * entidad se elige sólo si el nombre coincide, y los meses por defecto son los dos anteriores.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { elegirId, mesesPte, parsearPlanilla, terminosDe } from "../src/fuentes/pte_personal.ts";

const CSV = `PK_ID_PERSONAL,VC_PERSONAL_RUC_ENTIDAD,IN_PERSONAL_ANNO,IN_PERSONAL_MES,VC_PERSONAL_REGIMEN_LABORAL,VC_PERSONAL_PATERNO,VC_PERSONAL_MATERNO,VC_PERSONAL_NOMBRES,VC_PERSONAL_CARGO,VC_PERSONAL_DEPENDENCIA,MO_PERSONAL_REMUNERACIONES,MO_PERSONAL_HONORARIOS,MO_PERSONAL_INCENTIVO,MO_PERSONAL_GRATIFICACION,MO_PERSONAL_OTROS_BENEFICIOS,MO_PERSONAL_TOTAL,VC_PERSONAL_OBSERVACIONES,FEC_REG
88696040,20131373237,2025,12,1,CALDERON,CAYLLAHUA,MAURO ROGER,ASIST. ADMINISTRATIVO/A,SECRETARIA GENERAL,4041.7100,0.0000,0.0000,0.0000,0.0000,4041.7100,,1/20/2026 11:10:09 AM
88696041,20131373237,2025,12,1,CALDERON,ZEÑA,JESSICA SUSAN,ANL. DE INSPECCIONES Y CERTIFI,"DIRECCIÓN GENERAL DE MEDICAMENTOS, INSUMOS Y",5264.19,0,0,300,0,5564.19,,1/20/2026 11:10:09 AM
88696042,20131373237,2025,12,8,PEREZ,QUISPE,JUAN,PENSIONISTA,,1000,0,0,0,0,1000,,1/20/2026 11:10:09 AM
`;

test("pte_personal: el CSV del rubro Personal, sin pensionistas", () => {
  const f = parsearPlanilla(CSV);
  assert.equal(f.length, 2);
  assert.deepEqual(
    { ...f[1] },
    {
      id_pte_personal: 88696041, entidad_ruc: "20131373237", anio: 2025, mes: 12, regimen: 1, paterno: "CALDERON", materno: "ZEÑA",
      nombres: "JESSICA SUSAN", cargo: "ANL. DE INSPECCIONES Y CERTIFI", dependencia: "DIRECCIÓN GENERAL DE MEDICAMENTOS, INSUMOS Y",
      remuneraciones: 5264.19, honorarios: 0, incentivo: 0, gratificacion: 300, otros: 0, total: 5564.19, observaciones: null,
    },
  );
});

test("pte_personal: el id de la entidad sólo con el mismo nombre (o uno solo muy parecido)", () => {
  assert.deepEqual(elegirId("MUNICIPALIDAD PROVINCIAL DE CHEPEN", [{ id: 12099, nombre: "MUNICIPALIDAD PROVINCIAL DE CHEPÉN" }]), { id: 12099, nombre: "MUNICIPALIDAD PROVINCIAL DE CHEPÉN" });
  assert.equal(elegirId("MUNICIPALIDAD DISTRITAL DE SAN JUAN", [{ id: 1, nombre: "MUNICIPALIDAD DISTRITAL DE SAN JUAN DE LURIGANCHO" }, { id: 2, nombre: "MUNICIPALIDAD DISTRITAL DE SAN JUAN DE MIRAFLORES" }]), null);
  assert.equal(elegirId("MINISTERIO DE SALUD", []), null);
  assert.deepEqual(terminosDe("GOBIERNO REGIONAL DE LA LIBERTAD - HOSPITAL REGIONAL DOCENTE DE TRUJILLO"),
    ["GOBIERNO REGIONAL DE LA LIBERTAD HOSPITAL REGIONAL DOCENTE DE TRUJILLO", "HOSPITAL REGIONAL DOCENTE DE TRUJILLO"]);
  assert.deepEqual(terminosDe("GOBIERNO REGIONAL DE ICA SEDE CENTRAL"), ["GOBIERNO REGIONAL DE ICA"]);
  assert.deepEqual(terminosDe("MUNICIPALIDAD PROVINCIAL DE PADRE ABAD - AGUAYTIA"),
    ["MUNICIPALIDAD PROVINCIAL DE PADRE ABAD AGUAYTIA", "AGUAYTIA", "MUNICIPALIDAD PROVINCIAL DE PADRE ABAD"]);
  assert.deepEqual(terminosDe("GOBIERNO REGIONAL DE PUNO-SALUD PUNO"), ["GOBIERNO REGIONAL DE PUNO SALUD PUNO", "SALUD PUNO"]);
});

test("pte_personal: por defecto los dos meses anteriores; con desde/hasta, ese rango", () => {
  assert.deepEqual(mesesPte({}, "2026-10-20"), [[2026, 8], [2026, 9]]);
  assert.deepEqual(mesesPte({}, "2026-01-20"), [[2025, 11], [2025, 12]]);
  assert.deepEqual(mesesPte({ desde: "2025-11", hasta: "2026-01" }, "2026-10-20"), [[2025, 11], [2025, 12], [2026, 1]]);
});

test("pte_personal: sin caracteres de control (un NUL rompía el JSON de la carga)", () => {
  const csv = CSV.replace("SECRETARIA GENERAL", "SECRETARIA\u0000 GENERAL");
  const f = parsearPlanilla(csv);
  assert.equal(f[0].dependencia, "SECRETARIA GENERAL");
  assert.doesNotMatch(JSON.stringify(f), /\\u0000/);
});
