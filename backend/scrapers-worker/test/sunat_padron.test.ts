/**
 * Padrón reducido de la SUNAT (src/fuentes/sunat_padron.ts) con un ZIP sintético armado acá con fflate: RUC y nombres
 * inventados, en latin-1 y con el `|` final, como el archivo real. Sale sólo lo de RUC 20, bien escapado para COPY; las
 * líneas de personas naturales (RUC 10, 15, 17) sólo se cuentan y no aparecen en ninguna parte de la salida.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync } from "fflate";
import { leerCsv } from "../src/csv.ts";
import type { Copia, Db } from "../src/db.ts";
import { copiarEnTramos } from "../src/fuentes/pnda_dji.ts";
import { COLUMNAS_PADRON, PadronCsv, cuentaPadron, padronComoCsv, revisarCabecera } from "../src/fuentes/sunat_padron.ts";

/** Cada carácter, su byte (latin-1). Los \x80-\x9F pasan tal cual: así se arma un 0x96 de cp1252. */
function latin1(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => {
    const x = c.charCodeAt(0);
    if (x > 0xff) throw new Error(`no es latin-1: ${c}`);
    return x;
  });
}

const CABECERA = "RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|TIPO DE VÍA|NOMBRE DE VÍA|" +
  "CÓDIGO DE ZONA|TIPO DE ZONA|NÚMERO|INTERIOR|LOTE|DEPARTAMENTO|MANZANA|KILÓMETRO|";
const SIN_DIRECCION = "-|-|-|-|-|-|-|-|-|-|-|";

/** Un generador con semilla, para que el relleno salga igual en cada corrida. */
function azar(semilla: number): () => number {
  let x = semilla;
  return () => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    return x / 0x80000000;
  };
}

const PALABRAS = ["ANDINA", "COMERCIAL", "SERVICIOS", "GENERALES", "INVERSIONES", "TRANSPORTES", "NORTE", "SUR", "LIMA", "PRUEBA", "DEMO"];

/**
 * El padrón de prueba. Las líneas a mano cubren cada caso; el relleno (personas naturales inventadas y empresas
 * inventadas) hace que el ZIP pase de 64 KB comprimidos, para que se infle en varias partes.
 */
function padron() {
  const r = azar(7);
  const palabra = () => PALABRAS[Math.floor(r() * PALABRAS.length)];
  const lineas: string[] = [CABECERA];
  const empresas: string[][] = [];   // lo que debe salir, en orden: [ruc, razón social, estado, condición, ubigeo, domicilio]
  const fila = (linea: string, esperado?: string[]) => {
    lineas.push(linea);
    if (esperado) empresas.push(esperado);
  };
  fila(`20100000011|COMERCIAL "LOS ANDES" S.A.C.|ACTIVO|HABIDO|150101|AV.|LOS PROCERES|URB.|SANTA ROSA|123|-|-|-|-|-|`,
    ["20100000011", 'COMERCIAL "LOS ANDES" S.A.C.', "ACTIVO", "HABIDO", "150101", "AV. LOS PROCERES NRO. 123 URB. SANTA ROSA"]);
  fila(`10000000011|PERSONA INVENTADA UNO|ACTIVO|HABIDO|${SIN_DIRECCION}`);
  fila(`15000000021|PERSONA INVENTADA DOS|BAJA DE OFICIO|NO HABIDO|${SIN_DIRECCION}`);
  fila(`17000000031|PERSONA INVENTADA TRES|ACTIVO|HABIDO|${SIN_DIRECCION}`);
  // Latin-1 (Í = 0xCD, Ñ = 0xD1) y estado y condición cortados a 20, como vienen.
  fila(`20100000022|PANADERÍA LA ÑUSTA E.I.R.L.|BAJA MULT.INSCR. Y O|NO HALLADO SE MUDO D|040101|JR.|ÑAÑA|-|-|S/N|-|5|-|B|-|`,
    ["20100000022", "PANADERÍA LA ÑUSTA E.I.R.L.", "BAJA MULT.INSCR. Y O", "NO HALLADO SE MUDO D", "040101", "JR. ÑAÑA NRO. S/N MZA. B LOTE. 5"]);
  // Sin el `|` final, con \r\n, comas en el nombre, espacios de más y todas las partes de la dirección.
  fila(`20100000033| CONSTRUCTORA NORTE, SUR Y CENTRO S.A.  |SUSPENSION TEMPORAL|NO HABIDO|130101|CAR.|PANAMERICANA NORTE|-|-|-|2|-|301|-|18.5\r`,
    ["20100000033", "CONSTRUCTORA NORTE, SUR Y CENTRO S.A.", "SUSPENSION TEMPORAL", "NO HABIDO", "130101", "CAR. PANAMERICANA NORTE KM. 18.5 DPTO. 301 INT. 2"]);
  // 0x96 (guion largo de cp1252) y sin dirección ni ubigeo: NULL.
  fila(`20100000044|ACEROS \x96 PERU S.A.C.|ACTIVO|HABIDO|${SIN_DIRECCION}`,
    ["20100000044", "ACEROS – PERU S.A.C.", "ACTIVO", "HABIDO", "", ""]);
  // Zona sin vía; el tipo de vía sin nombre no va.
  fila(`20100000055|AGRO SAN JUAN S.R.L.|ACTIVO|HABIDO|200101|AV.|-|A.H.|LOS JARDINES|-|-|-|-|-|-|`,
    ["20100000055", "AGRO SAN JUAN S.R.L.", "ACTIVO", "HABIDO", "200101", "A.H. LOS JARDINES"]);
  fila(`20100000011|COMERCIAL REPETIDA S.A.C.|ACTIVO|HABIDO|${SIN_DIRECCION}`);    // repetida: queda la primera
  fila(`20ABC000066|RUC MALO S.A.C.|ACTIVO|HABIDO|${SIN_DIRECCION}`);               // malformada: el RUC
  fila(`20100000077|DE MENOS COLUMNAS S.A.|ACTIVO|HABIDO|`);                         // malformada: columnas
  fila(`20100000088|CON | EN EL NOMBRE S.A.C.|ACTIVO|HABIDO|${SIN_DIRECCION}`);     // malformada: un `|` de más
  fila("");                                                                         // en blanco
  const naturales = ["10000000011", "15000000021", "17000000031"];
  const natural = (prefijo: string) => {
    const ruc = `${prefijo}${String(Math.floor(r() * 1e9)).padStart(9, "0")}`;
    naturales.push(ruc);
    return ruc;
  };
  for (let k = 0; k < 8000; k++) {
    const x = r();
    if (x < 0.85) {
      fila(`${natural("10")}|${palabra()} ${palabra()} ${palabra()}|ACTIVO|HABIDO|${SIN_DIRECCION}`);
    } else if (x < 0.88) {
      fila(`${natural("15")}|${palabra()} ${palabra()}|BAJA DE OFICIO|HABIDO|${SIN_DIRECCION}`);
    } else if (x < 0.9) {
      fila(`${natural("17")}|${palabra()} ${palabra()}|ACTIVO|NO HABIDO|${SIN_DIRECCION}`);
    } else {
      const ruc = `206${String(k).padStart(7, "0")}${k % 10}`;
      const nombre = `${palabra()} ${palabra()} S.A.C.`;
      const via = palabra();
      fila(`${ruc}|${nombre}|ACTIVO|HABIDO|150122|AV.|${via}|-|-|${k}|-|-|-|-|-|`, [ruc, nombre, "ACTIVO", "HABIDO", "150122", `AV. ${via} NRO. ${k}`]);
    }
  }
  // La última línea sin \n.
  fila(`20999999991|ULTIMA SIN SALTO S.A.|ACTIVO|HABIDO|${SIN_DIRECCION}`, ["20999999991", "ULTIMA SIN SALTO S.A.", "ACTIVO", "HABIDO", "", ""]);
  const texto = latin1(lineas.join("\n"));
  const descartados: Record<string, number> = {};
  for (const ruc of naturales) descartados[ruc.slice(0, 2)] = (descartados[ruc.slice(0, 2)] ?? 0) + 1;
  return { texto, empresas, naturales, lineas: lineas.length - 1, descartados };
}

const P = padron();
const ZIP = zipSync({ "padron_reducido_ruc.txt": P.texto }, { level: 6 });

/** Los bytes en trozos de tamaño `tam` (como llegan de R2, cortados en cualquier parte). */
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

/** El CSV de salida como registros (sin la cabecera), con NULL ('' sin comillas) como "". */
const registros = (csv: string) => leerCsv(csv).slice(1);

test("padronComoCsv: sólo RUC 20, latin-1 bien leído, escapado para COPY y el domicilio armado", async () => {
  assert.ok(ZIP.length > 64 << 10, `el ZIP de prueba debería pasar de 64 KB (${ZIP.length})`);
  let referencia: string | null = null;
  for (const tam of [7, 1000, (64 << 10) + 3, ZIP.length]) {
    const cuenta = cuentaPadron();
    const csv = await new Response(padronComoCsv(flujo(ZIP, tam), cuenta, 4096)).text();
    if (referencia === null) referencia = csv;
    else assert.equal(csv, referencia, `trozos de ${tam}: otra salida`);
    assert.equal(csv.split("\n")[0], COLUMNAS_PADRON.join(","));
    assert.deepEqual(registros(csv), P.empresas, `trozos de ${tam}`);
    assert.deepEqual(cuenta.descartados, P.descartados);
    assert.equal(cuenta.copiados, P.empresas.length);
    assert.equal(cuenta.duplicados, 1);
    assert.equal(cuenta.malformadas, 3);
    assert.equal(cuenta.vacias, 1);
    assert.equal(cuenta.bytesC1, 1);
    assert.equal(cuenta.lineas, P.lineas);
    assert.equal(cuenta.lineas, cuenta.copiados + cuenta.duplicados + cuenta.malformadas + cuenta.vacias +
      Object.values(cuenta.descartados).reduce((a, b) => a + b, 0));
    assert.equal(cuenta.bytesInflados, P.texto.length);
  }
  const csv = referencia!;
  // Nada de las personas naturales: ni su RUC ni su nombre, en ninguna parte.
  for (const l of csv.split("\n").slice(1)) if (l) assert.match(l, /^20\d{9},/);
  for (const x of [...P.naturales, "PERSONA INVENTADA"]) assert.ok(!csv.includes(x), x);
  // Las comillas dobladas, NULL sin comillas, y el texto en UTF-8.
  assert.match(csv, /^20100000011,"COMERCIAL ""LOS ANDES"" S\.A\.C\.","ACTIVO","HABIDO","150101","AV\. LOS PROCERES NRO\. 123 URB\. SANTA ROSA"$/m);
  assert.match(csv, /^20100000044,"ACEROS – PERU S\.A\.C\.","ACTIVO","HABIDO",,$/m);
  assert.ok(csv.includes("PANADERÍA LA ÑUSTA"));
});

test("PadronCsv: una línea partida entre dos trozos en cualquier punto da lo mismo", () => {
  const texto = latin1([CABECERA,
    `20100000011|ÑANDÚ "UNO" S.A.|ACTIVO|HABIDO|150101|AV.|LIMA|-|-|1|-|-|-|-|-|`,
    `10000000011|PERSONA INVENTADA|ACTIVO|HABIDO|${SIN_DIRECCION}`,
    `20100000022|DOS S.A.|BAJA DE OFICIO|NO HABIDO|${SIN_DIRECCION}`].join("\r\n") + "\r\n");
  const correr = (partes: Uint8Array[]) => {
    const p = new PadronCsv();
    for (const x of partes) p.agregar(x);
    p.terminar();
    return { csv: new TextDecoder().decode(p.sacar()!), cuenta: p.cuenta };
  };
  const entero = correr([texto]);
  assert.deepEqual(registros(entero.csv), [
    ["20100000011", 'ÑANDÚ "UNO" S.A.', "ACTIVO", "HABIDO", "150101", "AV. LIMA NRO. 1"],
    ["20100000022", "DOS S.A.", "BAJA DE OFICIO", "NO HABIDO", "", ""],
  ]);
  assert.deepEqual(entero.cuenta.descartados, { "10": 1 });
  for (let corte = 1; corte < texto.length; corte++) {
    const r = correr([texto.subarray(0, corte), texto.subarray(corte)]);
    assert.equal(r.csv, entero.csv, `cortado en ${corte}`);
    assert.deepEqual(r.cuenta, entero.cuenta, `cortado en ${corte}`);
  }
});

test("revisarCabecera: la del padrón pasa; otra columna, otra codificación o un BOM no", () => {
  revisarCabecera(latin1(CABECERA));
  revisarCabecera(latin1(CABECERA.slice(0, -1)));   // sin el `|` final
  assert.throws(() => revisarCabecera(latin1(CABECERA.replace("KILÓMETRO", "REFERENCIA"))), /cambió de formato/);
  assert.throws(() => revisarCabecera(new TextEncoder().encode(CABECERA)), /cambió de formato/);   // UTF-8
  assert.throws(() => revisarCabecera(Uint8Array.of(0xef, 0xbb, 0xbf, ...latin1(CABECERA))), /cambió de formato/);
});

test("padronComoCsv: un ZIP cortado o con otra cabecera falla (y no da un CSV a medias)", async () => {
  await assert.rejects(new Response(padronComoCsv(flujo(ZIP.subarray(0, ZIP.length >> 1), 4096))).text());
  const otro = zipSync({ "padron_reducido_ruc.txt": latin1(`RUC|NOMBRE|ESTADO|\n20100000011|X|ACTIVO|\n`) });
  await assert.rejects(new Response(padronComoCsv(flujo(otro, 100))).text(), /cambió de formato/);
});

/** Una base falsa que guarda lo que recibe cada sentencia COPY (como test/copia.test.ts). */
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
          const filas = leerCsv(new TextDecoder().decode(Buffer.concat(s.datos))).filter((f) => f.length);
          return sql.includes("HEADER") ? filas.length - 1 : filas.length;
        },
      };
    },
  };
  return { db: db as unknown as Db, sentencias };
}

test("copiarEnTramos con el CSV del padrón: HEADER sólo en la primera sentencia y todas las filas", async () => {
  const { db, sentencias } = baseFalsa();
  const cuenta = cuentaPadron();
  // maxMs = -1: una sentencia por tramo, el máximo de cortes posible.
  const r = await copiarEnTramos(db, "sunat_padron", COLUMNAS_PADRON, padronComoCsv(flujo(ZIP, 5000), cuenta, 2048), -1);
  assert.ok(sentencias.length > 5, `${sentencias.length} sentencias`);
  assert.match(sentencias[0].sql, /^COPY sunat_padron \(ruc, razon_social, estado, condicion, ubigeo, domicilio\) FROM STDIN WITH \(FORMAT csv, HEADER true, NULL ''\)$/);
  assert.ok(sentencias.slice(1).every((s) => !s.sql.includes("HEADER")));
  assert.equal(r.filas, cuenta.copiados);
  assert.deepEqual(registros(new TextDecoder().decode(Buffer.concat(sentencias.flatMap((s) => s.datos)))), P.empresas);
});
