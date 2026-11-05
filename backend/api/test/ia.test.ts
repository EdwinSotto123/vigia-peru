import test from "node:test";
import assert from "node:assert/strict";
import { TAPA_NOMBRE } from "../src/lib/privacidad.js";
import { CLASES_MENOR, CLASES_PROCESO, TIPOS_MENOR, TIPOS_PROCESO, armarResumen, type FilasResumen } from "../src/routes/ia.js";

// Lo que leyó la IA (GET /ia/resumen, página /app/ia, 2026-11-05).

const filas = (extra: Partial<FilasResumen> = {}): FilasResumen => ({
  conteo: {
    procesos: [
      { clase: "buena_pro", documentos: 10, lecturas: 15, costoUsd: 1.5, ultima: "2026-11-04" },
      { clase: "contrato", documentos: 4, lecturas: 4, costoUsd: 0.25, ultima: "2026-11-03" },
    ],
    procesosContratos: 12,
    menores: [{ clase: "menor_tdr", documentos: 20, lecturas: 26, costoUsd: 0.5, ultima: "2026-11-05" }],
    menoresContratos: 20,
    modelos: ["claude-haiku-5-5"],
  },
  dictamenes: { publicados: 3, enRevision: 2, fuertes: 1, alto: 1, medio: 1, bajo: 0, sinSenales: 1, ultima: "2026-11-01" },
  dictamenesEjemplos: [],
  procesosHallazgos: [
    { clave: "acta_solo_queda_el_ganador", n: 3 },
    { clave: "acta_oferta_mas_baja_descartada", n: 1 },
    { clave: "clase:acta", n: 3 },
    { clave: "total", n: 3 },
  ],
  procesosEjemplos: [],
  menoresHallazgos: { tipos: [{ tipo: "tdr_proveedor_nombrado", severidad: "alta", contratos: 2 }], tdr: 2, contrato: 0, total: 2 },
  menoresEjemplos: [],
  ...extra,
});

test("ia: los totales suman los dos lados y la última lectura es la más reciente", () => {
  const r = armarResumen(filas(), "2026-11-05T12:00:00Z");
  assert.deepEqual(r.totales, { documentos: 34, contratos: 32, lecturas: 45, costoUsd: 2.25 });
  assert.equal(r.ultimaLectura, "2026-11-05");
  assert.equal(r.dictamenes.publicados, 3);
  assert.deepEqual(r.dictamenes.tramos, { alto: 1, medio: 1, bajo: 0, sinSenales: 1 });
});

test("ia: cada clase en su orden, con ceros si falta, y el contrato firmado sin hallazgos propios", () => {
  const r = armarResumen(filas());
  assert.deepEqual(r.procesos.clases.map((c) => c.clase), [...CLASES_PROCESO]);
  assert.deepEqual(r.menores.clases.map((c) => c.clase), [...CLASES_MENOR]);
  const de = (c: string) => r.procesos.clases.find((x) => x.clase === c)!;
  assert.equal(de("buena_pro").conHallazgo, 3);
  assert.equal(de("bases").documentos, 0);
  assert.equal(de("bases").conHallazgo, 0);
  assert.equal(de("contrato").conHallazgo, null);
  assert.equal(r.menores.clases[0].conHallazgo, 2);
});

test("ia: los hallazgos de los procesos van del más común al menos, sólo los que existen", () => {
  const r = armarResumen(filas());
  assert.deepEqual(r.procesos.hallazgos.map((h) => [h.tipo, h.procesos]), [["acta_solo_queda_el_ganador", 3], ["acta_oferta_mas_baja_descartada", 1]]);
  assert.ok(r.procesos.hallazgos.every((h) => h.tipo in TIPOS_PROCESO && h.etiqueta && h.severidad));
  assert.ok(TIPOS_MENOR.every((t) => t.startsWith("tdr_") || t.startsWith("contrato_")));
});

test("ia: los ejemplos no traen al proveedor y su nombre queda tapado en la descripción", () => {
  const r = armarResumen(filas({
    menoresEjemplos: [{
      id: 7, codigo: "CM-1-2026", descripcion: "SERVICIO DE APOYO ADMINISTRATIVO DE ABEL CARPIO COBOS", entidad: "MUNICIPALIDAD X",
      entidadRuc: "20131365722", monto: 7000, moneda: "PEN", fecha: "2026-10-30", proveedor: "CARPIO COBOS ABEL",
      proveedorRuc: "10439608801", tipo: "tdr_proveedor_nombrado", severidad: "alta", tipos: ["tdr_proveedor_nombrado"],
    }],
    procesosEjemplos: [{
      ocid: "1257798", codigo: "1257798", objeto: "OBRA", entidad: "GOBIERNO REGIONAL", entidadRuc: "20484004421", monto: 1,
      fecha: "2026-10-20", proveedor: "EMPRESA S.A.C.", proveedorRuc: "20600000001", tipos: ["acta_solo_queda_el_ganador", "aporte"],
    }],
  }));
  const menor = r.menores.ejemplos[0] as Record<string, unknown>;
  assert.equal("proveedor" in menor, false);
  assert.equal("proveedorRuc" in menor, false);
  assert.equal(menor.descripcion, `SERVICIO DE APOYO ADMINISTRATIVO DE ABEL CARPIO ${TAPA_NOMBRE}`);
  assert.doesNotMatch(JSON.stringify(r), /10439608801|COBOS/);
  const proceso = r.procesos.ejemplos[0] as Record<string, unknown>;
  assert.equal("proveedor" in proceso, false);
  assert.equal("tipos" in proceso, false);
  // Sólo los hallazgos de los documentos, no los demás cruces del ganador.
  assert.deepEqual((proceso.hallazgos as { tipo: string }[]).map((h) => h.tipo), ["acta_solo_queda_el_ganador"]);
});
