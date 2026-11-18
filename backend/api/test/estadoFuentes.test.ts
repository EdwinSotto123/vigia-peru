/**
 * El catálogo de fuentes (lib/catalogoFuentes.ts) y lo que ve el público en GET /estado/datos (routes/estado.ts) tienen
 * que decir lo mismo: el 2026-11-17 el público veía 17 filas y el catálogo tenía 31 fuentes, sin la que cada hora trae
 * las compras menores abiertas ni Perú Compras, y una fuente caída salía «al día».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CATALOGO } from "../src/lib/catalogoFuentes.js";
import { ESTADO_DE_SITUACION, FUENTES, INTERNAS, estadoPublico, situacionDe } from "../src/routes/estado.js";

const DIA = 86_400_000;
const HOY = Date.parse("2026-11-17T12:00:00Z");
const hace = (dias: number) => new Date(HOY - dias * DIA).toISOString().slice(0, 10);

const claves = new Set(CATALOGO.map((f) => f.fuente));
const hijas = new Set(CATALOGO.flatMap((f) => f.lanza ?? []));
const publicas = FUENTES.flatMap((f) => f.claves);

test("cada fila pública sale de claves que existen en el catálogo, y ninguna se repite", () => {
  for (const f of FUENTES) {
    assert.ok(f.claves.length > 0, `${f.clave}: sin claves del catálogo`);
    for (const k of f.claves) assert.ok(claves.has(k), `${f.clave}: «${k}» no está en el catálogo`);
  }
  assert.equal(new Set(FUENTES.map((f) => f.clave)).size, FUENTES.length, "hay dos filas con la misma clave");
  assert.equal(new Set(publicas).size, publicas.length, "una clave del catálogo está en dos filas");
});

test("cada fuente del catálogo se muestra al público o está en la lista de internas", () => {
  for (const k of INTERNAS) {
    assert.ok(claves.has(k), `interna «${k}» no está en el catálogo`);
    assert.ok(!publicas.includes(k), `«${k}» está como interna y en una fila pública`);
  }
  const sinLugar = [...claves].filter((k) => !publicas.includes(k) && !INTERNAS.includes(k));
  assert.deepEqual(sinLugar, [], "fuentes del catálogo que el público no ve: van en una fila de routes/estado.ts o en INTERNAS");
});

test("toda fuente que corre en el Worker de scrapers está en el catálogo", (t) => {
  const ruta = new URL("../../scrapers-worker/src/workflow.ts", import.meta.url);
  if (!existsSync(ruta)) return t.skip("sin backend/scrapers-worker en esta copia");
  const bloque = /export const FUENTES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(readFileSync(ruta, "utf8"));
  assert.ok(bloque, "no se encontró FUENTES en workflow.ts");
  const delWorker = [...bloque[1].matchAll(/^\s*([a-z_0-9]+):/gm)].map((m) => m[1]);
  assert.ok(delWorker.length >= 25, `sólo se leyeron ${delWorker.length} fuentes de workflow.ts`);
  assert.deepEqual(delWorker.filter((k) => !claves.has(k) && !hijas.has(k)), []);
});

test("lo rota, lo parado, lo que no trae archivo nuevo y las fotos están declarados y no salen «al día»", () => {
  const tipo = (clave: string) => situacionDe(FUENTES.find((f) => f.clave === clave)!)?.tipo ?? null;
  assert.equal(tipo("procuraduria"), "rota");
  assert.equal(tipo("dji_familiares"), "parada");
  for (const k of ["visitas_pnda", "jne"]) assert.equal(tipo(k), "sin_novedad", k);
  assert.equal(tipo("jne_candidaturas"), "foto");
  // Desde el 2026-11-18 ya no son foto ni «sin novedad»: las declaraciones juradas toman el CSV más reciente del dataset
  // y los socios del RNP se cargan cada mes de la wiki del OECE.
  for (const k of ["dji", "rnp"]) assert.equal(tipo(k), null, k);
  assert.equal(tipo("oece_ocds"), null);
  assert.ok(!Object.values(ESTADO_DE_SITUACION).includes("al_dia"));
  // La nota es de UNA fuente: una fila que junta varias claves no puede heredar la de una sola.
  for (const f of FUENTES) if (situacionDe(f)) assert.equal(f.claves.length, 1, `${f.clave}: tiene situación y más de una clave`);
});

test("los textos para el público no llevan «·» ni quedan vacíos", () => {
  const textos = [
    ...FUENTES.flatMap((f) => [f.nombre, f.que, f.cadencia]),
    ...CATALOGO.flatMap((f) => (f.situacion ? [f.situacion.nota] : [])),
  ];
  for (const s of textos) {
    assert.ok(s.trim().length > 0);
    assert.ok(!/[·•]/.test(s), s);
  }
  for (const f of FUENTES) if (f.enlace) assert.match(f.enlace, /^https:\/\//, f.clave);
});

test("el estado calculado: a mano, al día, atrasada, con error y fuente que dejó de publicar", () => {
  const ok = { estado: "ok", inicio: hace(1) };
  assert.equal(estadoPublico({ cada: null, ultima: null, ultimaOk: hace(400), hasta: hace(400), hoy: HOY }), "manual");
  assert.equal(estadoPublico({ cada: 10, ultima: ok, ultimaOk: hace(1), hasta: hace(2), hoy: HOY }), "al_dia");
  assert.equal(estadoPublico({ cada: 10, ultima: ok, ultimaOk: hace(11), hasta: hace(12), hoy: HOY }), "atrasada");
  // Nunca cargó (una fuente de PC sin fila en su bitácora): atrasada, no «al día».
  assert.equal(estadoPublico({ cada: 40, ultima: null, ultimaOk: null, hasta: hace(5), hoy: HOY }), "atrasada");
  // Falló la última y no hubo una buena después.
  assert.equal(estadoPublico({ cada: 10, ultima: { estado: "error", inicio: hace(1) }, ultimaOk: hace(8), hasta: hace(9), hoy: HOY }), "error");
  assert.equal(estadoPublico({ cada: 10, ultima: { estado: "error", inicio: hace(1) }, ultimaOk: null, hasta: null, hoy: HOY }), "error");
  // Carga bien cada semana, pero lo que trae es de hace más de tres meses.
  assert.equal(estadoPublico({ cada: 10, ultima: ok, ultimaOk: hace(1), hasta: hace(120), hoy: HOY }), "fuente_vieja");
  assert.equal(estadoPublico({ cada: 10, ultima: ok, ultimaOk: hace(1), hasta: null, hoy: HOY }), "al_dia");
});
