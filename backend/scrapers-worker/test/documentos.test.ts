import assert from "node:assert/strict";
import { test } from "node:test";
import { CRON_DOCUMENTOS, fuentesDelCron } from "../src/calendario.ts";
import { documentosDe, extension } from "../src/fuentes/documentos.ts";

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
  assert.deepEqual(fuentesDelCron(CRON_DOCUMENTOS, Date.parse("2026-10-19T05:40:00Z")), ["documentos"]);
});
