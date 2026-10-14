/**
 * copiarEnTramos (pnda_dji): varias sentencias COPY que juntas reciben el CSV entero, tal como lo lee
 * Python, cortadas en fin de registro y con HEADER solo en la primera. Con una base falsa.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Copia, Db } from "../src/db.ts";
import { copiarEnTramos } from "../src/fuentes/pnda_dji.ts";

function baseFalsa() {
  const sentencias: { sql: string; datos: Uint8Array[] }[] = [];
  const db = {
    async abrirCopia(sql: string): Promise<Copia> {
      const s = { sql, datos: [] as Uint8Array[] };
      sentencias.push(s);
      return {
        async escribir(d: Uint8Array) {
          s.datos.push(d);
        },
        async cerrar() {
          // filas = registros sin la cabecera (las líneas que no están dentro de comillas)
          const texto = new TextDecoder().decode(Buffer.concat(s.datos));
          let n = 0;
          let comillas = false;
          for (const c of texto) {
            if (c === '"') comillas = !comillas;
            else if (c === "\n" && !comillas) n++;
          }
          return sql.includes("HEADER") ? n - 1 : n;
        },
      };
    },
  };
  return { db: db as unknown as Db, sentencias };
}

function flujo(bytes: Uint8Array, tam: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + tam));
      i += tam;
    },
  });
}

test("copiarEnTramos: corta en fin de registro, HEADER solo en la primera, mismo texto que Python", async () => {
  const lineas = ["CODIGO_DDJJ,RUC,NOMBRE"];
  for (let i = 1; i <= 3000; i++) lineas.push(i % 9 === 0 ? `${i},"RUC:2010021103${i % 10}","con, coma y\r\nsalto"` : `${i},RUC:20100211034,ÑANDÚ ${i}`);
  const crudo = new TextEncoder().encode(lineas.join("\r\n") + "\r\n");
  const { db, sentencias } = baseFalsa();
  // maxMs = -1: cierra la sentencia después de cada tramo (el máximo de sentencias posible).
  const r = await copiarEnTramos(db, "dji_empleos", ["codigo_ddjj", "ruc_entidad_raw", "nombre_entidad"], flujo(crudo, 997), -1);
  assert.ok(sentencias.length > 10, `${sentencias.length} sentencias`);
  assert.equal(r.sentencias, sentencias.length);
  assert.match(sentencias[0].sql, /HEADER true/);
  assert.ok(sentencias.slice(1).every((s) => !s.sql.includes("HEADER")));
  const recibido = new TextDecoder().decode(Buffer.concat(sentencias.flatMap((s) => s.datos)));
  // open() en modo texto de Python convierte todo \r\n en \n, también dentro de comillas.
  assert.equal(recibido, (lineas.join("\r\n") + "\r\n").replaceAll("\r\n", "\n"));
  assert.equal(r.filas, 3000);
});
