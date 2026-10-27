/**
 * Paridad con Python: clasificar(), normalize_release(), slug_region(), short_ocid(), norm() y
 * resolve_ubigeo() sobre los vectores sintéticos de scripts/vectores_py.py (test/vectores_py.json).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clasificar } from "../src/clasificacion.ts";
import {
  normalizarRelease, payloadDe, recortarAdjudicaciones, recortarContratos, recortarPartes, recortarPresupuesto, ocidCorto, sinEscapes, slugRegion,
} from "../src/fuentes/oece_ocds.ts";
import type { Dict } from "../src/py.ts";
import { ZonaIndex, norm, resolverUbigeo } from "../src/ubigeo.ts";
import { zonasSemilla } from "./zonas.ts";

interface Vectores {
  ocds: { release: Dict; nulo: boolean; hint: string | null; clasificacion: { ok?: unknown; error?: string }; fila: { ok?: unknown; error?: string } }[];
  texto: { slug_region: [string, string | null][]; norm: [string, string][]; short_ocid: [string, string][] };
  ubigeo: [[unknown, unknown, unknown], string | null][];
}

const V = JSON.parse(readFileSync(new URL("./vectores_py.json", import.meta.url), "utf-8")) as Vectores;

const IX = ZonaIndex.desdeFilas(zonasSemilla());

test("clasificar da lo mismo que Python en 500 releases sintéticos", () => {
  let n = 0;
  const etapas = new Set<string>();
  for (const v of V.ocds) {
    if (v.clasificacion.error) continue;
    const c = clasificar(v.release, v.hint, v.nulo);
    assert.deepEqual(c, v.clasificacion.ok, JSON.stringify(v.release).slice(0, 400));
    etapas.add(`${c.tipo}|${c.etapa}`);
    n++;
  }
  assert.ok(n > 450 && etapas.size > 30, `${n} releases, ${etapas.size} combinaciones tipo×etapa`);
});

test("normalize_release da la misma fila que Python (ubigeo, región, payload, clasificación)", () => {
  let n = 0;
  let nulas = 0;
  for (const v of V.ocds) {
    if (v.fila.error) continue;
    const fila = normalizarRelease(v.release, IX);
    // `adjudicaciones` (migración 71) y `extra` (planning, contracts, partes) no existen en Python: se compara el resto
    // y se prueban aparte.
    const sinAdj = fila && (({ adjudicaciones: _a, extra: _e, ...resto }) => resto)(fila);
    assert.deepEqual(sinAdj, v.fila.ok, JSON.stringify(v.release).slice(0, 400));
    n++;
    if (fila === null) nulas++;
  }
  assert.ok(n > 450 && nulas > 20 && nulas < n - 200, `${n} filas, ${nulas} sin ocid/RUC`);
});

test("recortarAdjudicaciones: id, fecha, monto, proveedores e ids de ítems; null sin awards", () => {
  const rel = {
    awards: [{ id: "304014-20479929077", date: "2016-10-18T00:00:00-05:00", value: { amount: 2006088, currency: "PEN", currencyName: "Nuevos Soles" },
      suppliers: [{ id: "PE-RUC-20479929077", name: "SG&COURIER S.R.L.", extra: 1 }], items: [{ id: "689904", description: "x" }], documents: [{ url: "u" }] }],
  };
  assert.deepEqual(recortarAdjudicaciones(rel), [{
    id: "304014-20479929077", date: "2016-10-18T00:00:00-05:00", status: null, value: { amount: 2006088, currency: "PEN", amount_PEN: null },
    suppliers: [{ id: "PE-RUC-20479929077", name: "SG&COURIER S.R.L." }], items: [{ id: "689904" }],
  }]);
  assert.equal(recortarAdjudicaciones({ tender: {} }), null);
});

test("extra: el presupuesto, los contratos sin ítems y las partes sin datos de contacto; el payload de siempre aparte", () => {
  const rel = {
    ocid: "ocds-dgv273-seacev3-1224210", date: "2026-09-05T13:36:17-05:00", tender: { id: "1224210" },
    planning: { budget: { description: "Fondos Públicos", project: "COMPACTADORA", projectID: "2655159", id: "x" }, rationale: "y" },
    contracts: [{ id: "2390288", awardID: "1-2", title: "002-2026-MDS", dateSigned: "2026-04-21T00:00:00-05:00", items: [{ id: "1" }],
      period: { startDate: "2026-04-22T00:00:00-05:00", endDate: "2027-03-31T00:00:00-05:00", durationInDays: 343 },
      value: { amount: 449100, currency: "PEN", currencyName: "Soles" },
      documents: [{ id: "9", url: "https://prod4.seace.gob.pe/d/9", title: "Archivos del contrato", format: "application/pdf", documentType: "contractSigned", datePublished: "2026-05-05T10:10:07-05:00", language: "es" }] }],
    parties: [{ id: "PE-RUC-20615038998", name: "TITANMAQ S.R.L.", roles: ["tenderer", "supplier"],
      address: { streetAddress: "AV. X 123" }, contactPoint: { name: "JUAN PEREZ", email: "j@x.pe", telephone: "999999999" }, identifier: { id: "20615038998" } }],
  };
  assert.deepEqual(recortarPresupuesto(rel), { budget: { description: "Fondos Públicos", project: "COMPACTADORA", projectID: "2655159" } });
  assert.deepEqual(recortarContratos(rel), [{
    id: "2390288", awardID: "1-2", title: "002-2026-MDS", status: null, dateSigned: "2026-04-21T00:00:00-05:00",
    period: { startDate: "2026-04-22T00:00:00-05:00", endDate: "2027-03-31T00:00:00-05:00", durationInDays: 343 },
    value: { amount: 449100, currency: "PEN" },
    documents: [{ id: "9", url: "https://prod4.seace.gob.pe/d/9", title: "Archivos del contrato", format: "application/pdf", documentType: "contractSigned", datePublished: "2026-05-05T10:10:07-05:00" }],
  }]);
  const partes = recortarPartes(rel);
  assert.deepEqual(partes, [{ id: "PE-RUC-20615038998", name: "TITANMAQ S.R.L.", roles: ["tenderer", "supplier"] }]);
  assert.doesNotMatch(JSON.stringify(partes), /JUAN|999999999|AV\. X/);
  for (const f of [recortarPresupuesto, recortarContratos, recortarPartes]) assert.equal(f({ tender: {} }), null);
  // `partes`, nunca `parties`: un payload con `parties` es un record completo para el dispatcher y la cobertura.
  const guardado = payloadDe({ payload: { ocid: rel.ocid, tender: rel.tender }, extra: { partes } });
  assert.ok(!Object.hasOwn(guardado, "parties") && Array.isArray(guardado.partes));
  assert.deepEqual(payloadDe({ payload: { ocid: "1" }, extra: null }), { ocid: "1" });
});

test("slug_region, norm y short_ocid", () => {
  for (const [t, esperado] of V.texto.slug_region) assert.equal(slugRegion(t), esperado, t);
  for (const [t, esperado] of V.texto.norm) assert.equal(norm(t), esperado, t);
  for (const [t, esperado] of V.texto.short_ocid) assert.equal(ocidCorto(t), esperado, t);
});

test("resolve_ubigeo con nombres deformados como los del OCDS", () => {
  const niveles = new Map<number, number>();
  for (const [[d, p, l], esperado] of V.ubigeo) {
    const u = resolverUbigeo(IX, d, p, l);
    assert.equal(u, esperado, JSON.stringify([d, p, l]));
    niveles.set(u?.length ?? 0, (niveles.get(u?.length ?? 0) ?? 0) + 1);
  }
  assert.ok((niveles.get(6) ?? 0) > 400 && (niveles.get(4) ?? 0) > 20, JSON.stringify([...niveles]));
});

test("objeto: los saltos escritos como texto por el SEACE se vuelven espacios", () => {
  const conEscapes = String.raw`ADQUISICIÓN E IMPLEMENTACIÓN DE PANEL LED \nPARA LA UNIVERSIDAD\t  NACIONAL`;
  assert.equal(sinEscapes(conEscapes), "ADQUISICIÓN E IMPLEMENTACIÓN DE PANEL LED PARA LA UNIVERSIDAD NACIONAL");
  assert.equal(sinEscapes("SIN NADA RARO"), "SIN NADA RARO");
});
