import test from "node:test";
import assert from "node:assert/strict";
import { conEnie, conSerieAnual, palabrasBusqueda, taparNombrePropio } from "../src/routes/personas.js";
import { publicar } from "../src/lib/privacidad.js";
import { TAPA_NOMBRE } from "../src/lib/privacidad.js";

test("el nombre de la persona en la descripción de su orden sale con el materno tapado, en los dos órdenes", () => {
  const n = "VARGAS ROJAS LUIS FERNANDO";
  assert.equal(taparNombrePropio("SERVICIO DE ASISTENCIA DE VARGAS ROJAS LUIS FERNANDO", n), `SERVICIO DE ASISTENCIA DE VARGAS ${TAPA_NOMBRE} LUIS FERNANDO`);
  assert.equal(taparNombrePropio("PAGO A LUIS FERNANDO VARGAS ROJAS POR SERVICIOS", n), `PAGO A LUIS FERNANDO VARGAS ${TAPA_NOMBRE} POR SERVICIOS`);
  assert.equal(taparNombrePropio("SERVICIO DE LIMPIEZA", n), "SERVICIO DE LIMPIEZA");
  assert.equal(taparNombrePropio(null, n), null);
});

test("la Ñ que CONOSCE escribe «¿» se repone, y el apellido se tapa", () => {
  assert.equal(conEnie("LEON NURE¿A MANUEL"), "LEON NUREÑA MANUEL");
  assert.equal(conEnie("¿QUÉ SERVICIO?"), "¿QUÉ SERVICIO?");
  const r = publicar({ data: [{ ruc: "10439608801", nombre: conEnie("LEON NURE¿A MANUEL ALEXANDER") }] });
  assert.equal(r.data[0].nombre, `LEON ${TAPA_NOMBRE} MANUEL ALEXANDER`);
});

test("el buscador deja las palabras como mef_norm: mayúsculas, sin tildes, de 3 letras o más y sin comodines", () => {
  assert.deepEqual(palabrasBusqueda("Municipalidad de Huarochirí"), ["MUNICIPALIDAD", "HUAROCHIRI"]);
  assert.deepEqual(palabrasBusqueda("  Niño   asesor%_legal "), ["NINO", "ASESOR", "LEGAL"]);
  assert.deepEqual(palabrasBusqueda("a b"), []);
  assert.deepEqual(palabrasBusqueda(undefined), []);
  assert.equal(palabrasBusqueda("uno dos tres cuatro cinco seis siete").length, 5);
});

test("la serie de cada año (`resumen.anual`) va sólo en la lista de UNA entidad: ni en el país, ni en una región o un partido, ni con size=0", () => {
  const ent = "20131257750";
  assert.equal(conSerieAnual({ entidad: ent, size: 20 }), true);
  assert.equal(conSerieAnual({ entidad: ent, size: 0 }), false);
  assert.equal(conSerieAnual({ size: 20 }), false);
  assert.equal(conSerieAnual({ dep: "15", size: 20 }), false);
  assert.equal(conSerieAnual({ entidad: ent, dep: "15", size: 20 }), false);
  assert.equal(conSerieAnual({ entidad: ent, partido: "app", size: 20 }), false);
});

test("órdenes tras un informe de control (migración 308): el RUC 10 no sale y el informe queda con su código y su enlace", () => {
  // Datos sintéticos: RUC 10 con el DNI 00000001, nombre inventado.
  const url = "https://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=2019CPOL42000117&TIPOARCHIVO=RE";
  const r = publicar({
    persona: { codigo: "0123456789ab", ruc: "10000000011", nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO" },
    entidades: [{
      entidadRuc: "20999999993", nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO",
      senalesDetalle: [{
        tipo: "ordenes_tras_informe", severidad: "alta", fuente: "informes_control", fuenteUrl: url,
        detalle: { informe_codigo: "2019CPOL42000117", informe_numero: "1734-2019-CG/GRPI", emision: "2019-08-02",
          responsabilidades: ["administrativa_entidad", "penal"], url_resumen: url, ordenes_despues: 13, monto_despues: 369200,
          primera_orden: "2020-02-07", dias_hasta_primera: 189, primera_orden_detalle: { numero: "2000422", monto: 30000 } },
      }],
    }],
  });
  const json = JSON.stringify(r);
  assert.doesNotMatch(json, /10000000011|00000001|HUAMANCHUMO/);
  const d = r.entidades[0].senalesDetalle[0].detalle;
  // 8 cifras pegadas a letras en el código del informe: es un código, no un DNI.
  assert.equal(d.informe_codigo, "2019CPOL42000117");
  assert.equal(d.url_resumen, url);
  assert.equal(r.entidades[0].senalesDetalle[0].fuenteUrl, url);
  assert.equal(d.primera_orden_detalle.numero, "2000422");
});
