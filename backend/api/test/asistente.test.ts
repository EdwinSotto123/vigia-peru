import test from "node:test";
import assert from "node:assert/strict";
import { MAX_HISTORIAL, contextoFicha, mensajesAsistente } from "../src/lib/asistente.js";

// El asistente de un proceso: el contexto que ve el modelo y la conversación que se le manda.

const ficha = {
  codigo: "1263897",
  objeto: "Adquisición de tóner",
  valor: null,
  documentos: [{ titulo: "Bases", url: "https://prod1.seace.gob.pe/x?fileCode=abc", tipo: "biddingDocuments", fecha: "2026-11-05" }],
  items: [],
  enlaces: { oece: "https://contratacionesabiertas.oece.gob.pe/proceso/x" },
};

test("contextoFicha: sin vacíos ni URLs de documentos, con los enlaces oficiales", () => {
  const c = JSON.parse(contextoFicha(ficha));
  assert.equal(c.codigo, "1263897");
  assert.equal(c.valorReferencial, undefined);
  assert.equal(c.items, undefined);
  assert.deepEqual(c.documentosPublicados, [{ titulo: "Bases", tipo: "biddingDocuments", fecha: "2026-11-05" }]);
  assert.equal(c.enlaces.oece, "https://contratacionesabiertas.oece.gob.pe/proceso/x");
});

test("mensajesAsistente: la ficha primero (a la caché), el historial recortado y alternado, la pregunta al final", () => {
  const historial = [
    { rol: "asistente" as const, texto: "hola" },
    ...Array.from({ length: 10 }, (_, i) => ({ rol: (i % 2 === 0 ? "usuario" : "asistente") as "usuario" | "asistente", texto: `m${i}` })),
  ];
  const { system, messages } = mensajesAsistente(ficha, historial, "¿Cuándo vencen las consultas?");
  assert.equal(system[0].cache_control.type, "ephemeral");
  assert.match(String((messages[0].content as { text: string }[])[0].text), /^<ficha>/);
  assert.equal(messages.at(-1)!.content, "¿Cuándo vencen las consultas?");
  const previos = messages.slice(2, -1);
  assert.ok(previos.length <= MAX_HISTORIAL);
  assert.equal(previos[0].role, "user");
});
