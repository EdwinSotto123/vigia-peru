import test from "node:test";
import assert from "node:assert/strict";
import {
  anioMes, codigoIpress, coordenadas, entero, enlaceSanciones, fecha, filasCsv, gravedadDe, leerDenuncias, leerRenipress, normalizar,
  registrosCsv, sectorDe, tipoSancion,
} from "../src/fuentes/susalud.ts";
import { filaDetalle, sinCeros } from "../src/fuentes/susalud_detalle.ts";

const bytes = (t: string) => new TextEncoder().encode(t);

test("registrosCsv: un salto de línea dentro de comillas no corta el registro; BOM y CRLF", () => {
  const r = [...registrosCsv(bytes('﻿A;B\r\n1;"dos\r\nlíneas"\r\n3;cuatro\r\n'))];
  assert.deepEqual(r, ["A;B", '1;"dos\r\nlíneas"', "3;cuatro"]);
  const f = [...filasCsv(bytes('A;B\n1;"x;y"\n'))];
  assert.deepEqual(f, [{ A: "1", B: "x;y" }]);
});

test("filasCsv: Windows-1252 cuando no es UTF-8 válido", () => {
  const datos = new Uint8Array([...bytes("NOMBRE\n"), 0x4e, 0xd1, 0x55, 0x0a]); // «NÑU» en cp1252
  assert.deepEqual([...filasCsv(datos)], [{ NOMBRE: "NÑU" }]);
});

test("coordenadas: RENIPRESS trae la latitud en NORTE pese al diccionario; al revés se da vuelta; fuera del Perú, nada", () => {
  assert.deepEqual(coordenadas("-11.7044363", "-76.266739"), [-11.7044363, -76.266739]);
  assert.deepEqual(coordenadas("-76.266739", "-11.7044363"), [-11.7044363, -76.266739]);
  assert.deepEqual(coordenadas("40.4", "-3.7"), [null, null]);
  assert.deepEqual(coordenadas("0", "0"), [null, null]);
  assert.deepEqual(coordenadas("", ""), [null, null]);
});

test("utilidades de SUSALUD", () => {
  assert.equal(codigoIpress("9123"), "00009123");
  assert.equal(codigoIpress("SIN CÓDIGO ÚNICO"), null);
  assert.equal(fecha("1900-01-01 00:00:00"), null);
  assert.equal(fecha("27/10/2026"), "2026-10-27");
  assert.equal(fecha("20260115"), "2026-01-15");
  assert.equal(fecha("31/02/2026"), null);
  assert.equal(entero("NE_0001"), null);
  assert.equal(entero("12"), 12);
  assert.equal(sectorDe("PRIVADO"), "privado");
  assert.equal(sectorDe("GOBIERNO REGIONAL"), "publico");
  assert.equal(normalizar("Clínica Angloamericana S.A.C."), "CLINICA ANGLOAMERICANA S A C");
  assert.equal(tipoSancion("Amonestación escrita"), "amonestacion");
  assert.equal(tipoSancion("MULTA"), "multa");
  assert.equal(tipoSancion("Cierre Definitivo"), "cierre_definitivo");
  assert.equal(gravedadDe("III-A-Leve-27"), "leve");
  assert.equal(gravedadDe("III-A-Grave-1"), "grave");
  assert.equal(gravedadDe("III-B-Muy Grave-3"), "muy_grave");
  assert.equal(gravedadDe("Ley N° 29571"), null);
  assert.deepEqual(anioMes({ url: "http://x/Consulta_H_Intervenciones_quirurgicas_2026_10.csv", nombre: "", formato: "csv" }), [2026, 10]);
  assert.deepEqual(anioMes({ url: "http://x/a.csv", nombre: "Consulta A - Recursos de Salud - Setiembre 2025", formato: "csv" }), [2025, 9]);
  assert.equal(enlaceSanciones('<a href="https://cdn.www.gob.pe/uploads/document/file/1097276/455207-registro-de-sanciones-2026-11-19.xlsx?v=1795128962">x</a>'),
    "https://cdn.www.gob.pe/uploads/document/file/1097276/455207-registro-de-sanciones-2026-11-19.xlsx?v=1795128962");
});

test("leerRenipress: código con 8 cifras, categoría «0» = sin categoría, ACTIVO = activo, columnas exigidas", () => {
  const cab = "INSTITUCION;COD_IPRESS;NOMBRE;CLASIFICACION;TIPO_ESTABLECIMIENTO;DEPARTAMENTO;PROVINCIA;DISTRITO;UBIGEO;DIRECCION;CO_DISA;COD_RED;COD_MICRORRED;DISA;RED;MICRORED;COD_UE;UNIDAD_EJECUTORA;CATEGORIA;TELEFONO;HORARIO;INICIO_ACTIVIDAD;ESTADO;NORTE;ESTE;IMAGEN_1;FE_ACT_IMAGEN_1;IMAGEN_2;FE_ACT_IMAGEN_2;IMAGEN_3;FE_ACT_IMAGEN_3";
  const fila1 = "PRIVADO;9123;CLINICA X;HOSPITALES;ESTABLECIMIENTO DE SALUD CON INTERNAMIENTO;LIMA;LIMA;SAN ISIDRO;150131;CALLE 1;;;;;;;;;II-2;6168900;24 HORAS;1921-05-16 00:00:00;ACTIVO;-12.1;-77.03;;;;;;";
  const fila2 = "MINSA;5969;POSTA;PUESTOS;ESTABLECIMIENTO DE SALUD SIN INTERNAMIENTO;LIMA;HUAROCHIRI;CHICLA;150705;ACTUALIZAR;;;;;;;1404.0;RED;0;NO TIENE;8-14;1900-01-01 00:00:00;CIERRE TEMPORAL DE OFICIO;;;;;;;;";
  const { filas } = leerRenipress(bytes(`${cab}\n${fila1}\n${fila2}\n`));
  assert.equal(filas.length, 2);
  const [a, b] = filas;
  assert.equal(a.codigo, "00009123");
  assert.equal(a.categoria, "II-2");
  assert.equal(a.activo, true);
  assert.equal(a.sector, "privado");
  assert.equal(b.categoria, null);
  assert.equal(b.activo, false);
  assert.equal(b.direccion, null);       // «ACTUALIZAR» no es una dirección
  assert.equal(b.telefono, null);
  assert.equal(b.inicio_actividad, null);
  assert.equal(b.cod_ue, 1404);
  assert.throws(() => leerRenipress(bytes("A;B\n1;2\n")), /sin las columnas/);
});

test("leerDenuncias: sólo cuenta por institución y año; nada personal sale", () => {
  const csv = "FE_REGISTRO;DE_TIPO_SOLICITUD;DE_SOLICITANTE_GENERO;DE_SOLICITANTE_EDAD;CO_INSTITUCION;DE_TIPO_INST;DE_INSTITUCION;DE_UBIGEO_INST;DE_NATURALEZA_INST\n"
    + "15-01-2025 19:50;Denuncia;Femenino;39;00006207;IPRESS;HOSPITAL X;LIMA;MINSA\n"
    + "16-01-2025 10:00;Consulta;Masculino;40;6207;IPRESS;HOSPITAL X;LIMA;MINSA\n"
    + "17-01-2025 10:00;Intervencion de oficio;;;6207;IPRESS;HOSPITAL X;LIMA;MINSA\n";
  const { filas } = leerDenuncias(bytes(csv), 2025);
  assert.deepEqual(filas, [{ codigo: "00006207", anio: 2025, tipo_inst: "IPRESS", nombre: "HOSPITAL X", consultas: 1, denuncias: 1, de_oficio: 1 }]);
});

test("filaDetalle: lista blanca. Nunca nombres, DNI, correos ni teléfonos de personas; RUC 10 nunca", () => {
  const d = {
    datos: {
      p_crCURSOR_DATOS: [{
        PROPIETARIO_RUC: "10456789012", PROPIETARIO_RAZON_SOCIAL: "JUAN PEREZ GARCIA", PROPIETARIO_CORREO: "juan@x.pe", PROPIETARIO_TELEFONO: "987654321",
        REPLEGAL_DATOS: "JUAN PEREZ GARCIA N,NDNIN,N12345678", REPLEGAL_CORREO: "juan@x.pe",
        MEDICO_DATOS: "ANA LOPEZ RUIZ N,NDNIN,N87654321", MEDICO_COLEGIO: "COLEGIO MEDICO DEL PERU", MEDICO_NUM_COLEGIATURA: "012345", MEDICO_RNE: "0",
        ADICIONAL_CATEGORIA: "I-3", ADICIONAL_CATEGORIA_TIPO: "RESOLUCIÓN", ADICIONAL_CATEGORIA_NUMERO: "RD N° 049-2022", ADICIONAL_DOC_FECHA: "31/01/2022",
        ESTABLECIMIENTO_REGISTRO: "12/12/2008", ADICIONAL_NUM_AMBESTAB: "11", SITUACION_ESTADO: "ACTIVO", ESTABLECIMIENTO_TEL_EMER: "(511) 616-8902",
      }],
      p_crCURSOR_UPSS: [{ NOMBRE: '<a onclick="x">UPSS - CENTRO QUIRÚRGICO</a>', CODIGO: "<a>230000</a>", ESTADO: "ACTIVO", CO_CODUPSS: "230000", DE_NOMBRE: "UPSS - CENTRO QUIRÚRGICO" }],
      p_crCURSOR_ESPECIALIDES: [{ NOMBRE: "CIRUGÍA PLÁSTICA", CODIGO: "1-0019" }, { NOMBRE: "NO APLICA", CODIGO: "99-0092" }],
      p_crCURSOR_DOCUMENTO: [{ DOCUMENTO: "LICENCIA MUNICIPAL", FECHA: " ", DESCARGAR: "6719898", ADJUNTADO: "SI", NUMERO: " ", NUM: "2" }],
    },
  };
  const f = filaDetalle("00010370", d)!;
  const texto = JSON.stringify(f);
  for (const prohibido of ["JUAN", "PEREZ", "ANA", "LOPEZ", "12345678", "87654321", "juan@x.pe", "987654321", "10456789012"]) {
    assert.ok(!texto.includes(prohibido), `se coló «${prohibido}»`);
  }
  assert.equal(f.ruc, null);
  assert.equal(f.razon_social, null);
  assert.equal(f.propietario_natural, true);
  assert.equal(f.responsable_colegiatura, "12345");
  assert.equal(f.responsable_rne, null);
  assert.equal(f.categoria_documento, "RESOLUCIÓN RD N° 049-2022");
  assert.equal(f.categoria_fecha, "2022-01-31");
  assert.deepEqual(f.upss, [{ codigo: "230000", nombre: "UPSS - CENTRO QUIRÚRGICO", estado: "ACTIVO" }]);
  assert.deepEqual(f.especialidades.map((e) => e.nombre), ["CIRUGÍA PLÁSTICA"]);
  assert.deepEqual(f.documentos, [{ tipo: "LICENCIA MUNICIPAL", numero: null, fecha: null, adjunto: true, id: "6719898" }]);
  assert.equal(filaDetalle("00000000", { mensaje: "no-ok; La IPRESS no existe." }), null);
});

test("filaDetalle: RUC 20 del propietario sí, con su razón social", () => {
  const f = filaDetalle("00009123", { datos: { p_crCURSOR_DATOS: [{ PROPIETARIO_RUC: "20107695584", PROPIETARIO_RAZON_SOCIAL: "BRITISH AMERICAN HOSPITAL S.A." }] } })!;
  assert.equal(f.ruc, "20107695584");
  assert.equal(f.razon_social, "BRITISH AMERICAN HOSPITAL S.A.");
  assert.equal(f.propietario_natural, false);
});

test("sinCeros: colegiaturas y RNE sin ceros a la izquierda; «0» es vacío", () => {
  assert.equal(sinCeros("094339"), "94339");
  assert.equal(sinCeros("8549/16605"), "8549/16605");
  assert.equal(sinCeros("0"), null);
  assert.equal(sinCeros(""), null);
});
