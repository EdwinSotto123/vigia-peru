import assert from "node:assert/strict";
import { test } from "node:test";
import { CRON_DOCUMENTOS, fuentesDelCron } from "../src/calendario.ts";
import { documentosDe, extension, seBajaEnLectura } from "../src/fuentes/documentos.ts";

test("documentosDe: tender, awards y contracts, sin repetir la misma URL", () => {
  const rel = {
    tender: { documents: [{ id: "1", url: "https://seace/a", documentType: "biddingDocuments", format: "pdf" }, { id: "2" }] },
    awards: [{ documents: [{ id: "3", url: "https://seace/b", documentType: "awardNotice" }, { id: "1", url: "https://seace/a" }] }],
    contracts: [{ documents: [{ id: "4", url: "https://seace/c", documentType: "contractSigned", title: "x".repeat(300) }] }],
  };
  const d = documentosDe(rel);
  assert.deepEqual(d.map((x) => [x.id, x.seccion, x.tipo]), [["1", "tender", "biddingDocuments"], ["3", "award", "awardNotice"], ["4", "contract", "contractSigned"]]);
  assert.equal(d[2].titulo?.length, 200);
});

test("extension: mime u OCDS → extensión corta", () => {
  assert.equal(extension("application/pdf"), "pdf");
  assert.equal(extension(".DOCX"), "docx");
  assert.equal(extension("application/vnd.openxmlformats"), "bin");
  assert.equal(extension(null), "bin");
});

test("el cron de documentos corre cada hora", () => {
  assert.deepEqual(fuentesDelCron(CRON_DOCUMENTOS, Date.parse("2026-10-19T05:40:00Z")), ["documentos", "seace_cotizaciones"]);
});

test("un pedido de lectura baja las bases en RAR, Word y Excel (no sólo PDF y ZIP)", () => {
  // 2026-11-24: «Bases Integradas [rar]» y «[docx]» nunca llegaban al almacén y el agente recibía 403 del OECE.
  assert.equal(seBajaEnLectura({ tipo: "biddingDocuments", formato: "rar" }), true);
  assert.equal(seBajaEnLectura({ tipo: "biddingDocuments", formato: "docx" }), true);
  assert.equal(seBajaEnLectura({ tipo: "biddingDocuments", formato: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), true);
  assert.equal(seBajaEnLectura({ tipo: "awardNotice", formato: "application/x-rar-compressed" }), true);
  assert.equal(seBajaEnLectura({ tipo: "biddingDocuments", formato: "pdf" }), true);
  assert.equal(seBajaEnLectura({ tipo: "biddingDocuments", formato: "dwg" }), false);
  assert.equal(seBajaEnLectura({ tipo: "tenderNotice", formato: "pdf" }), false);
  assert.equal(extension("application/msword"), "doc");
});
