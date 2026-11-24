/**
 * oece_directas: una contratación directa (sin tenderPeriod, sólo datePublished) sale del /record del OECE como la misma
 * fila que la carga diaria, con su fecha, su código y su tipo «directa». Registro sintético con la forma del real
 * (ocds-dgv273-seacev3-922222, 2026-11-23), sin datos de personas.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SQL_PENDIENTES, conPlazo, releaseDeRecord } from "../src/fuentes/oece_directas.ts";
import { normalizarRelease } from "../src/fuentes/oece_ocds.ts";
import type { Dict } from "../src/py.ts";
import { ZonaIndex } from "../src/ubigeo.ts";
import { zonasSemilla } from "./zonas.ts";

const IX = ZonaIndex.desdeFilas(zonasSemilla());

const RECORD: Dict = {
  records: [
    {
      ocid: "ocds-dgv273-seacev3-922222",
      compiledRelease: {
        ocid: "ocds-dgv273-seacev3-922222",
        id: "ocds-dgv273-seacev3-922222-1",
        date: "2026-08-11T00:00:00-05:00",
        tag: ["compiled"],
        buyer: { id: "PE-RUC-20131380951", name: "MUNICIPALIDAD METROPOLITANA DE LIMA" },
        parties: [
          {
            id: "PE-RUC-20131380951",
            name: "MUNICIPALIDAD METROPOLITANA DE LIMA",
            roles: ["buyer"],
            identifier: { scheme: "PE-RUC", id: "20131380951" },
            address: { department: "LIMA", region: "LIMA", locality: "LIMA" },
          },
        ],
        tender: {
          id: "922222",
          title: "DIRECTA-PROC-3-2023-MML-OGA-OL-1",
          description: "SERVICIO DE ARRENDAMIENTO DE INMUEBLE PARA EL FUNCIONAMIENTO DE OFICINAS",
          procurementMethod: "direct",
          procurementMethodDetails: "Contratación Directa",
          mainProcurementCategory: "services",
          datePublished: "2023-07-14T00:00:00-05:00",
          value: { amount: 5760000, currency: "PEN" },
          documents: [{ id: "1", title: "Bases Administrativas", url: "https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=x" }],
        },
        contracts: [{ id: "c1", documents: [{ id: "d1", title: "Archivos del contrato", url: "https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/1" }] }],
      },
    },
  ],
};

test("releaseDeRecord saca el compiledRelease; sin records, null", () => {
  assert.equal(releaseDeRecord(RECORD)?.ocid, "ocds-dgv273-seacev3-922222");
  assert.equal(releaseDeRecord({ records: [] }), null);
  assert.equal(releaseDeRecord(null), null);
});

test("una directa sin tenderPeriod sale con su fecha de publicación, su código y su payload con documentos", () => {
  const rel = releaseDeRecord(RECORD)!;
  const f = normalizarRelease(rel, IX);
  assert.ok(f, "la fila existe");
  assert.equal(f!.ocid, "922222");
  assert.equal(f!.codigo, "922222");
  assert.equal(f!.entidad_ruc, "20131380951");
  assert.equal(f!.fecha, "2023-07-14");
  assert.equal(f!.cuantia, 5760000);
  // La clasificación la reconoce como directa (lo que decide sus agentes y si entra a la cola).
  assert.equal(f!.clasificacion.tipo, "directa");
  // El payload guarda el tender con sus documentos: la ficha los muestra y documentos.ts los baja.
  const tender = (f!.payload as Dict).tender as Dict;
  assert.equal((tender.documents as unknown[]).length, 1);
});

test("los pendientes son directas de CONOSCE con código del SEACE v3 que no están en convocatorias", () => {
  assert.match(SQL_PENDIENTES, /mef_norm\(a\.tipo_proceso\) LIKE 'CONTRATACION DIRECTA%'/);
  assert.match(SQL_PENDIENTES, /NOT EXISTS \(SELECT 1 FROM convocatorias c WHERE c\.codigo = a\.codigo_convocatoria OR c\.ocid = a\.codigo_convocatoria\)/);
  assert.match(SQL_PENDIENTES, /LIMIT \$3/);
});

test("conPlazo: lo que termina a tiempo pasa; lo que no termina nunca da null y no cuelga el lote", async () => {
  assert.equal(await conPlazo(Promise.resolve(7), 1000), 7);
  assert.equal(await conPlazo(new Promise<number>(() => {}), 20), null);
});
