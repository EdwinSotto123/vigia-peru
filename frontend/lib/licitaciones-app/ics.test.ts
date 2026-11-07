import test from "node:test";
import assert from "node:assert/strict";
import { crearIcs } from "./ics.ts";

test("crearIcs: día entero, con hora en UTC, escapado, con aviso y líneas dobladas", () => {
  const t = crearIcs(
    [
      { uid: "a", titulo: "Fin de consultas; proceso 123, Lima", fecha: "2026-11-10", url: "https://x.pe/p" },
      { uid: "b", titulo: "Cierre", fecha: "2026-11-12T23:59:00-05:00", descripcion: "x".repeat(120) },
    ],
    new Date("2026-11-07T15:00:00Z"),
  );
  assert.match(t, /DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111/);
  assert.match(t, /DTSTART:20261113T045900Z/);
  assert.match(t, /SUMMARY:Fin de consultas\\; proceso 123\\, Lima/);
  assert.equal((t.match(/TRIGGER:-P1D/g) ?? []).length, 2);
  assert.ok(t.split("\r\n").every((l) => l.length <= 75));
  assert.ok(t.startsWith("BEGIN:VCALENDAR") && t.endsWith("END:VCALENDAR\r\n"));
});
