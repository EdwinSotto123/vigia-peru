/**
 * MEF, OPD y ETES (migración 152): el agregado por unidad y las ocho miradas del gasto salen con los mismos códigos que
 * el SIAF; en las ETE la ejecución va donde el devengado y lo que no publican queda vacío (NULL), y las filas de OPD que
 * trae el archivo de ETES hasta 2018 se saltan.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync } from "fflate";
import { agregarEnte, agregarZipEnte, archivoEnte, csvEnte, partirLinea } from "../src/mef_agregado_opds_etes.ts";

// Las cabeceras de los archivos de 2026 (58 y 51 columnas), tal cual.
const CAB_OPDS = ["ANO_EJE", "MES_EJE", "GRUPO_ENTIDAD", "GRUPO_ENTIDAD_NOMBRE", "SEC_EJEC", "EJECUTORA", "EJECUTORA_NOMBRE",
  "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE", "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE", "DISTRITO_EJECUTORA",
  "DISTRITO_EJECUTORA_NOMBRE", "SEC_FUNC", "PROGRAMA_PPTO", "PROGRAMA_PPTO_NOMBRE", "TIPO_ACT_PROY", "PRODUCTO_PROYECTO",
  "PRODUCTO_PROYECTO_NOMBRE", "ACTIVIDAD_ACCION_OBRA", "ACTIVIDAD_ACCION_OBRA_NOMBRE", "FUNCION", "FUNCION_NOMBRE", "DIVISION_FUNCIONAL",
  "DIVISION_FUNCIONAL_NOMBRE", "GRUPO_FUNCIONAL", "GRUPO_FUNCIONAL_NOMBRE", "META", "FINALIDAD", "META_NOMBRE", "DEPARTAMENTO_META",
  "DEPARTAMENTO_META_NOMBRE", "FUENTE_FINANCIAMIENTO", "FUENTE_FINANCIAMIENTO_NOMBRE", "RUBRO", "RUBRO_NOMBRE", "TIPO_RECURSO",
  "TIPO_RECURSO_NOMBRE", "CATEGORIA_GASTO", "CATEGORIA_GASTO_NOMBRE", "TIPO_TRANSACCION", "GENERICA", "GENERICA_NOMBRE", "SUBGENERICA",
  "SUBGENERICA_NOMBRE", "SUBGENERICA_DET", "SUBGENERICA_DET_NOMBRE", "ESPECIFICA", "ESPECIFICA_NOMBRE", "ESPECIFICA_DET",
  "ESPECIFICA_DET_NOMBRE", "MONTO_PIA", "MONTO_PIM", "MONTO_COMPROMETIDO", "MONTO_DEVENGADO", "MONTO_GIRADO", "MONTO_COMPROMETIDO_ANUAL",
  "MONTO_CERTIFICADO"];
const CAB_ETES = ["ANO_EJE", "MES_EJE", "GRUPO_ENTIDAD", "GRUPO_ENTIDAD_NOMBRE", "SEC_EJEC", "EJECUTORA", "EJECUTORA_NOMBRE",
  "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE", "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE", "DISTRITO_EJECUTORA",
  "DISTRITO_EJECUTORA_NOMBRE", "SEC_FUNC", "PROGRAMA_PPTO", "PROGRAMA_PPTO_NOMBRE", "TIPO_ACT_PROY", "TIPO_ACT_PROY_NOMBRE",
  "PRODUCTO_PROYECTO", "PRODUCTO_PROYECTO_NOMBRE", "ACTIVIDAD_ACCION_OBRA", "ACTIVIDAD_ACCION_OBRA_NOMBRE", "FUNCION", "FUNCION_NOMBRE",
  "DIVISION_FUNCIONAL", "DIVISION_FUNCIONAL_NOMBRE", "GRUPO_FUNCIONAL", "GRUPO_FUNCIONAL_NOMBRE", "META", "FINALIDAD", "META_NOMBRE",
  "FUENTE_FINANCIAMIENTO", "FUENTE_FINANCIAMIENTO_NOMBRE", "RUBRO", "RUBRO_NOMBRE", "CATEGORIA_GASTO", "CATEGORIA_GASTO_NOMBRE",
  "TIPO_TRANSACCION", "GENERICA", "GENERICA_NOMBRE", "SUBGENERICA", "SUBGENERICA_NOMBRE", "SUBGENERICA_DET", "SUBGENERICA_DET_NOMBRE",
  "ESPECIFICA", "ESPECIFICA_NOMBRE", "ESPECIFICA_DET", "ESPECIFICA_DET_NOMBRE", "MONTO_PIA", "MONTO_PIM", "MONTO_EJECUCION"];

const csv = (cab: string[], filas: Record<string, string>[]) =>
  [cab.map((c) => `"${c}"`).join(","), ...filas.map((v) => cab.map((c) => `"${(v[c] ?? "X").replaceAll('"', '""')}"`).join(","))].join("\r\n") + "\r\n";
const texto = (s: string) => new Blob([s]).stream().pipeThrough(new TextDecoderStream());

const BASE = {
  ANO_EJE: "2026", GENERICA: "2", GENERICA_NOMBRE: "BIENES Y SERVICIOS", SUBGENERICA: "3", SUBGENERICA_DET: "1",
  SUBGENERICA_DET_NOMBRE: "COMPRA DE BIENES", ESPECIFICA: "1", ESPECIFICA_DET: "2", ESPECIFICA_DET_NOMBRE: "PAPELERIA EN GENERAL",
  FUNCION: "03", FUNCION_NOMBRE: "PLANEAMIENTO, GESTION Y RESERVA DE CONTINGENCIA", FUENTE_FINANCIAMIENTO_NOMBRE: "RECURSOS DIRECTAMENTE RECAUDADOS",
  RUBRO: "09", RUBRO_NOMBRE: "RECURSOS DIRECTAMENTE RECAUDADOS", PROGRAMA_PPTO: "9001", PROGRAMA_PPTO_NOMBRE: "ACCIONES CENTRALES",
  TIPO_ACT_PROY: "3", PRODUCTO_PROYECTO: "3999999", PRODUCTO_PROYECTO_NOMBRE: "SIN PRODUCTO", DEPARTAMENTO_EJECUTORA: "15",
  DEPARTAMENTO_EJECUTORA_NOMBRE: "LIMA", PROVINCIA_EJECUTORA: "01", PROVINCIA_EJECUTORA_NOMBRE: "LIMA", DISTRITO_EJECUTORA: "01",
  DISTRITO_EJECUTORA_NOMBRE: "LIMA", EJECUTORA: "000",
};
const CERO_OPDS = { MONTO_PIA: "0", MONTO_PIM: "0", MONTO_CERTIFICADO: "0", MONTO_COMPROMETIDO_ANUAL: "0", MONTO_COMPROMETIDO: "0", MONTO_DEVENGADO: "0", MONTO_GIRADO: "0" };
const CERO_ETES = { MONTO_PIA: "0", MONTO_PIM: "0", MONTO_EJECUCION: "0" };

test("partirLinea: comillas dobladas, campos vacíos y sueltos", () => {
  assert.deepEqual(partirLinea('"a","b ""c"" d","",e,"f"'), ["a", 'b "c" d', "", "e", "f"]);
  assert.deepEqual(partirLinea('"a",'), ["a", ""]);
  assert.deepEqual(partirLinea("1,2,3"), ["1", "2", "3"]);
});

test("OPDS: los 7 montos por unidad y las ocho miradas, con los códigos del SIAF", async () => {
  const sat = { ...BASE, GRUPO_ENTIDAD: "14", GRUPO_ENTIDAD_NOMBRE: "ORGANISMOS PUBLICOS DESCENTRALIZADOS MUNICIPALES", SEC_EJEC: "500231",
    EJECUTORA_NOMBRE: 'SERVICIO DE ADMINISTRACION TRIBUTARIA "SAT"' };
  const a = await agregarEnte(texto(csv(CAB_OPDS, [
    { ...sat, ...CERO_OPDS, MES_EJE: "0", MONTO_PIA: "100", MONTO_PIM: "120" },
    { ...sat, ...CERO_OPDS, MES_EJE: "3", MONTO_CERTIFICADO: "50", MONTO_COMPROMETIDO_ANUAL: "45", MONTO_COMPROMETIDO: "40", MONTO_DEVENGADO: "30", MONTO_GIRADO: "25" },
    // Un proyecto de inversión.
    { ...sat, ...CERO_OPDS, MES_EJE: "0", GENERICA: "6", GENERICA_NOMBRE: "ADQUISICION DE ACTIVOS NO FINANCIEROS", SUBGENERICA: "2",
      SUBGENERICA_DET: "2", SUBGENERICA_DET_NOMBRE: "CONSTRUCCION DE EDIFICIOS Y ESTRUCTURAS", TIPO_ACT_PROY: "2", PRODUCTO_PROYECTO: "2512345",
      PRODUCTO_PROYECTO_NOMBRE: "MEJORAMIENTO DEL LOCAL", MONTO_PIM: "500" },
    // Toda en cero: cuenta como fila, no crea claves de gasto.
    { ...sat, ...CERO_OPDS, MES_EJE: "5", FUNCION: "24", FUNCION_NOMBRE: "PREVISION SOCIAL" },
  ])), "opds");
  assert.equal(a.anio, 2026);
  assert.equal(a.filas, 4);
  const u = a.unidades.get("500231")!;
  assert.deepEqual([...u.montos], [100, 620, 50, 45, 40, 30, 25]);
  assert.equal(u.atributos[2], 'SERVICIO DE ADMINISTRACION TRIBUTARIA "SAT"');
  const g = (k: string) => [...(a.gasto.get(k) ?? [])];
  assert.deepEqual(g("500231\tpartida\t2.3.1"), [100, 120, 30]);
  assert.deepEqual(g("500231\tespecifica\t2.3.1.1.2"), [100, 120, 30]);
  assert.deepEqual(g("500231\tfuncion\t03"), [100, 620, 30]);
  assert.deepEqual(g("500231\tproyecto\t2512345"), [0, 500, 0]);
  assert.deepEqual(g("500231\tmes\t3"), [0, 0, 30]);
  assert.deepEqual(g("500231\tprograma\t9001"), [100, 620, 30]);
  assert.deepEqual(g("500231\tproducto\t9001.3999999"), [100, 120, 30]);
  assert.deepEqual(g("500231\trubro\t09"), [100, 620, 30]);
  assert.equal(a.gasto.has("500231\tfuncion\t24"), false, "una fila en cero no crea clave");
  assert.deepEqual(a.nombres.get("partida\t2.3.1"), ["COMPRA DE BIENES", "BIENES Y SERVICIOS"]);
  assert.deepEqual(a.nombres.get("especifica\t2.3.1.1.2"), ["PAPELERIA EN GENERAL", "2.3.1"]);
  const { anual, gasto } = csvEnte(a, "2026-10-26T15:11:00.000Z");
  assert.equal(anual.trim(), '"opds","2026","500231","000","SERVICIO DE ADMINISTRACION TRIBUTARIA ""SAT""","14",' +
    '"ORGANISMOS PUBLICOS DESCENTRALIZADOS MUNICIPALES","15","LIMA","01","LIMA","01","LIMA","100.00","620.00","50.00","45.00","40.00",' +
    '"30.00","25.00","4","2026-10-26T15:11:00.000Z"');
  assert.match(gasto, /^"opds","2026","500231","proyecto","2512345","MEJORAMIENTO DEL LOCAL",,"0.00","500.00","0.00"$/m, "sin grupo: NULL");
});

test("ETES: la ejecución va donde el devengado, lo que no publican queda NULL y las OPD se saltan", async () => {
  const eps = { ...BASE, GRUPO_ENTIDAD: "05", GRUPO_ENTIDAD_NOMBRE: "EMPRESAS MUNICIPALES DE AGUA POTABLE Y ALCANTARILLADO", SEC_EJEC: "500136",
    EJECUTORA_NOMBRE: "EPS LORETO", TIPO_ACT_PROY_NOMBRE: "ACTIVIDAD" };
  const opd = { ...eps, GRUPO_ENTIDAD: "14", GRUPO_ENTIDAD_NOMBRE: "ORGANISMOS PUBLICOS DESCENTRALIZADOS MUNICIPALES", SEC_EJEC: "500231" };
  const cuerpo = csv(CAB_ETES, [
    { ...eps, ...CERO_ETES, MES_EJE: "0", MONTO_PIA: "80", MONTO_PIM: "90" },
    { ...eps, ...CERO_ETES, MES_EJE: "2", MONTO_EJECUCION: "12.5" },
    { ...eps, ...CERO_ETES, MES_EJE: "3", MONTO_EJECUCION: "7.5" },
    // Una OPD en el archivo de ETES (así venía hasta 2018): fuera.
    { ...opd, ...CERO_ETES, MES_EJE: "4", MONTO_PIM: "999", MONTO_EJECUCION: "455" },
  ]);
  // Desde el ZIP (una entrada deflate, como los del MEF), en trozos chicos.
  const zip = zipSync({ [archivoEnte("etes", 2026).replace(".zip", ".csv")]: new TextEncoder().encode(cuerpo) }, { level: 6 });
  let i = 0;
  const flujo = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= zip.length) return c.close();
      c.enqueue(zip.slice(i, i + 37));
      i += 37;
    },
  });
  const a = await agregarZipEnte(flujo, "etes");
  assert.equal(a.filas, 3);
  assert.equal(a.saltadas, 1);
  assert.equal(a.unidades.has("500231"), false);
  assert.deepEqual([...a.unidades.get("500136")!.montos], [80, 90, 0, 0, 0, 20, 0]);
  assert.deepEqual([...(a.gasto.get("500136\tmes\t2") ?? [])], [0, 0, 12.5]);
  const { anual } = csvEnte(a, null);
  // certificado, comprometido anual, comprometido y girado: vacíos (NULL); el devengado es la ejecución; sin corte.
  assert.match(anual, /"80\.00","90\.00",,,,"20\.00",,"3",\n$/);
});

test("ETES y OPDS: el formato cambiado no se carga", async () => {
  await assert.rejects(agregarEnte(texto('"ANO_EJE","SEC_EJEC"\r\n"2026","500136"\r\n'), "etes"), /el CSV de ETES del MEF cambió: faltan/);
  const ok = { ...BASE, ...CERO_ETES, GRUPO_ENTIDAD: "05", SEC_EJEC: "500136", MES_EJE: "0" };
  const malo = csv(CAB_ETES, [ok]) + '"2026","1","05"\r\n';
  await assert.rejects(agregarEnte(texto(malo), "etes"), /no tienen el número de campos de la cabecera/);
});
