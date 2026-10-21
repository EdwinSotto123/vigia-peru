/**
 * Contraloría (informes de control): una fila del buscador con la forma real (campos verificados el 2026-10-21) y datos
 * inventados. Lo importante: lo que trae DNI y nombres (`Text`, `Funcionarios`) no pasa a lo que se guarda.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CRON_DATOS, fuentesDelCron } from "../src/calendario.ts";
import { aInforme, fechaCgr, parsearPagina, responsabilidades, urlPagina } from "../src/fuentes/contraloria_informes.ts";

const FILA = {
  id: null, CodigoInforme: "2026CPO999900001", Responsabilidad: " CIVIL ,PENAL , ADMINISTRATIVO PAS",
  Departamento: "LIMA", Provincia: "LIMA", Distrito: "PUEBLO LIBRE(MAGDALENA VIEJA)",
  Descripcion: "Ejecución de la obra de prueba", Entidad: "MUNICIPALIDAD DISTRITAL DE PRUEBA",
  FechaEmision: "2026/09/24", FechaPublicacion: "2026/10/20", FechaFinEjecucion: "2026/02/30",
  ModalidadServicio: "SERVICIO DE CONTROL ESPECÍFICO A HECHOS CON PRESUNTA IRREGULARIDAD", ServicioControl: "SERVICIO CONTROL POSTERIOR",
  NumeroInforme: "001-2026-2-9999", Sector: "GOBIERNOS LOCALES", NivelGobierno: "GOBIERNO LOCAL",
  RutaCloudInforme: "http://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=2026CPO999900001&TIPOARCHIVO=ADJUNTO",
  RutaCloudResumen: "http://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=2026CPO999900001&TIPOARCHIVO=RE",
  TotalFuncionarios: "2", Funcionarios: "DNI : 00000001 FULANO DE TAL",
  Text: "2026CPO999900001 … DNI : 00000001 FULANO DE TAL RESPONSABILIDAD : PENAL DNI : 00000002 MENGANO RESPONSABILIDAD : CIVIL",
  TotalRows: "1", TotalPages: "1", Evento: "No se asocia a ningún evento" + " ".repeat(300),
};

test("una fila → informe sin datos de personas", () => {
  const i = aInforme(FILA);
  assert.ok(i);
  assert.equal(i.codigo, "2026CPO999900001");
  assert.deepEqual(i.responsabilidades, ["administrativa_pas", "civil", "penal"]);
  assert.equal(i.funcionarios, 2);
  assert.equal(i.fecha_emision, "2026-09-24");
  assert.equal(i.fecha_fin_ejecucion, null);   // 30 de febrero: inválida
  assert.ok(i.url_pdf?.startsWith("https://") && i.url_pdf.endsWith("TIPOARCHIVO=ADJUNTO"));
  const todo = JSON.stringify(i);
  for (const prohibido of ["DNI", "00000001", "FULANO", "MENGANO"]) assert.ok(!todo.includes(prohibido), prohibido);
});

test("página: total de páginas y filas sin código fuera", () => {
  const r = parsearPagina(JSON.stringify([FILA, { ...FILA, CodigoInforme: "" }]));
  assert.equal(r.informes.length, 1);
  assert.equal(r.paginas, 1);
  assert.equal(parsearPagina("[]").paginas, 0);
});

test("responsabilidades, fechas y consulta", () => {
  assert.deepEqual(responsabilidades("  PENAL ,ADMINISTRATIVO ENTIDAD , "), ["administrativa_entidad", "penal"]);
  assert.deepEqual(responsabilidades(null), []);
  assert.equal(fechaCgr("2026/13/01"), null);
  const u = new URL(urlPagina(3));
  assert.equal(u.searchParams.get("PageNumber"), "3");
  assert.equal(u.searchParams.get("pResponsabilidad"), '"PENAL" OR "CIVIL" OR "ADMINISTRATIVO ENTIDAD" OR "ADMINISTRATIVO PAS"');
});

test("contraloria_informes no tiene cron (la Contraloría no responde fuera del Perú: se carga con el script)", () => {
  for (let d = 1; d <= 30; d++) {
    const ms = Date.parse(`2026-11-${String(d).padStart(2, "0")}T13:00:00Z`);
    assert.ok(!fuentesDelCron(CRON_DATOS, ms).includes("contraloria_informes"), `día ${d}`);
  }
});
