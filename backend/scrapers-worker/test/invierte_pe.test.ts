/**
 * Invierte.pe: las columnas de la tabla temporal salen de la cabecera del MEF (con BOM y comillas), el SQL lee cada columna
 * de inversion_mef con el lector de la migración 223 (nunca RESPONSABLE_UEI ni ALTERNATIVA), el upsert y las retiradas son
 * los de cargar_obras.py, el resumen cuenta repetidos e iguales, y el paso de carga (con una base falsa) manda las
 * sentencias en orden: en seco termina con ROLLBACK, con los dos sha256 ya cargados no abre transacción y con un archivo
 * incompleto no marca retiradas.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entrada } from "../src/almacen.ts";
import type { Env } from "../src/config.ts";
import { cuentaCsv, normalizarCsv } from "../src/csv.ts";
import type { Copia, Db } from "../src/db.ts";
import { separarCabecera } from "../src/fuentes/conosce.ts";
import {
  ARCHIVOS, COLUMNAS, SQL_DESTINO, SQL_RETIRAR, SQL_UPSERT, armarResumen, cargarInversiones, columnasCabecera,
  columnasRequeridas, faltanColumnas, fechaDelArchivo, hayCambios, ident, isoDeHttp, sqlNormalizar, sqlSinCui, sqlTemporal,
} from "../src/fuentes/invierte_pe.ts";
import type { Bajado } from "../src/fuentes/invierte_pe.ts";

/** Las cabeceras del MEF (DETALLE_INVERSIONES.csv y CIERRE_INVERSIONES.csv del 2026-10-27). */
const CAB_DETALLE = ["NIVEL", "SECTOR", "ENTIDAD", "CODIGO_UNICO", "CODIGO_SNIP", "NOMBRE_INVERSION", "NOMBRE_OPMI", "NOMBRE_UF",
  "NOMBRE_UEI", "SEC_EJEC", "NOMBRE_UEP", "ESTADO", "SITUACION", "MONTO_VIABLE", "COSTO_ACTUALIZADO", "CTRL_CONCURR", "MONTO_LAUDO",
  "MONTO_FIANZA", "ALTERNATIVA", "FECHA_REGISTRO", "FECHA_VIABILIDAD", "FUNCION", "PROGRAMA", "SUBPROGRAMA", "MARCO",
  "TIPO_INVERSION", "DES_MODALIDAD", "REGISTRADO_PMI", "PMI_ANIO_1", "PMI_ANIO_2", "PMI_ANIO_3", "PMI_ANIO_4", "EXPEDIENTE_TECNICO",
  "INFORME_CIERRE", "TIENE_F9", "FEC_REG_F9", "ETAPA_F9", "PRIMER_DEVENGADO", "ULTIMO_DEVENGADO", "DEVEN_ACUMUL_ANIO_ANT",
  "DEV_ANIO_ACTUAL", "PIA_ANIO_ACTUAL", "PIM_ANIO_ACTUAL", "CERTIF_ANIO_ACTUAL", "COMPROM_ANUAL_ANIO_ACTUAL", "SALDO_EJECUTAR",
  "TIENE_F8", "ETAPA_F8", "TIENE_F12B", "TIENE_AVAN_FISICO", "AVANCE_FISICO", "AVANCE_EJECUCION", "ULT_FEC_DECLA_ESTIM",
  "DES_TIPOLOGIA", "IND_IOARR_EMERG", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "UBIGEO", "LATITUD", "LONGITUD", "FEC_INI_EJECUCION",
  "FEC_FIN_EJECUCION", "FEC_INI_EJEC_FISICA", "FEC_FIN_EJEC_FISICA", "NUM_HABITANTES_BENEF", "MONTO_ET_F8", "ANIO_PROCESO"];
const CAB_CIERRE = ["NIVEL", "SECTOR", "ENTIDAD", "CODIGO_UNICO", "CODIGO_SNIP", "NOMBRE_INVERSION", "ESTADO", "SITUACION",
  "MONTO_VIABLE", "COSTO_ACTUALIZADO", "CONTROL_CONCURR", "MONTO_LAUDO", "MONTO_FIANZA", "FECHA_REGISTRO", "FECHA_VIABILIDAD",
  "FUNCION", "PROGRAMA", "SUBPROGRAMA", "MARCO", "TIPO_INVERSION", "NOM_OPMI", "NOM_UF", "NOM_UEI", "RESPONSABLE_UEI", "SEC_EJEC",
  "NOM_UEP", "EXPEDIENTE_TECNICO", "INFORME_CIERRE", "FEC_CIERRE", "DES_CIERRE", "TIENE_F9", "FEC_REG_F9", "CULMINADA",
  "INICIO_EJEC_FISICA", "CULMINA_EJEC_FISICA", "ETAPA_F9", "FEC_INI_OPER", "PRIMER_DEVENGADO", "ULTIMO_DEVENGADO", "DEVEN_ACUMULADO",
  "TIENE_F8", "TIENE_F12B", "DES_TIPOLOGIA", "DES_MODALIDAD", "TOTAL_LIQUIDACION", "FEC_LIQUIDACION", "UNIDAD_OPE_MANT",
  "FUENTE_FINANCIAMIENTO", "FEC_TRANSFERENCIA", "BENEFICIARIO", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "UBIGEO", "LATITUD",
  "LONGITUD", "ANIO_PROCESO"];
const minusculas = (cab: string[]) => cab.map((c) => c.toLowerCase());
const BOM = String.fromCharCode(0xfeff);

/** Un CSV como los del MEF: BOM, todo entre comillas y \r\n. `filas`: valores por nombre de columna (lo demás, vacío). */
function csvMef(cab: string[], filas: Record<string, string>[]): Uint8Array {
  const linea = (vals: string[]) => vals.map((v) => `"${v.replaceAll('"', '""')}"`).join(",");
  return new TextEncoder().encode(BOM + [linea(cab), ...filas.map((f) => linea(cab.map((c) => f[c] ?? "")))].join("\r\n") + "\r\n");
}

/** Los bytes en trozos de `tam`, como el cuerpo de un objeto de R2 (los cortes caen en cualquier lado). */
function enTrozos(bytes: Uint8Array, tam: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, (i += tam)));
    },
  });
}

test("columnas de la temporal: la cabecera del MEF (BOM y comillas) en minúsculas, leída como en la carga", async () => {
  const bytes = csvMef(["NIVEL", "CODIGO_UNICO", "NOMBRE_INVERSION"], [{ NIVEL: "GL", CODIGO_UNICO: "2716769", NOMBRE_INVERSION: 'OBRA "EL PARQUE", FASE 1' }]);
  const cuenta = cuentaCsv();
  const { cabecera, flujo } = await separarCabecera(normalizarCsv(enTrozos(bytes, 7), cuenta));
  assert.deepEqual(columnasCabecera(cabecera), ["nivel", "codigo_unico", "nombre_inversion"]);
  // El flujo vuelve a traer la cabecera (COPY la salta con HEADER) y la fila entera.
  const texto = await new Response(flujo).text();
  assert.equal(texto, '"NIVEL","CODIGO_UNICO","NOMBRE_INVERSION"\n"GL","2716769","OBRA ""EL PARQUE"", FASE 1"\n');
  assert.equal(cuenta.registros, 1);
  assert.deepEqual(columnasCabecera(CAB_DETALLE), minusculas(CAB_DETALLE));
});

test("columnas de la temporal: vacías, repetidas, la del número de fila y comillas en el nombre", () => {
  assert.deepEqual(columnasCabecera([`${BOM} NIVEL `, "", "Nivel", "_fila", 'A"B']), ["nivel", "columna_2", "nivel_2", "_fila_2", 'a"b']);
  assert.equal(ident('a"b'), '"a""b"');
  assert.equal(sqlTemporal("_t", ["nivel", 'a"b']),
    'CREATE TEMP TABLE _t (_fila bigint GENERATED ALWAYS AS IDENTITY, "nivel" text, "a""b" text) ON COMMIT DROP');
  // Un nombre armado para cortar el identificador queda entero entre comillas.
  const malo = columnasCabecera(['X" text); DROP TABLE inversion_mef; --'])[0];
  assert.equal(sqlTemporal("_t", [malo]),
    'CREATE TEMP TABLE _t (_fila bigint GENERATED ALWAYS AS IDENTITY, "x"" text); drop table inversion_mef; --" text) ON COMMIT DROP');
});

test("columnas que se leen: las de COLUMNAS_MEF y DEVEN_ACUMUL_ANIO_ANT; nunca RESPONSABLE_UEI ni ALTERNATIVA", () => {
  assert.deepEqual(faltanColumnas(minusculas(CAB_DETALLE), "activa"), []);
  assert.deepEqual(faltanColumnas(minusculas(CAB_CIERRE), "cerrada"), []);
  assert.deepEqual(faltanColumnas(minusculas(CAB_DETALLE).filter((c) => c !== "deven_acumul_anio_ant" && c !== "latitud"), "activa"),
    ["latitud", "deven_acumul_anio_ant"]);
  // Las cerradas no traen lo del año ni el expediente; las activas no traen el cierre ni la liquidación.
  assert.ok(!columnasRequeridas("cerrada").includes("dev_anio_actual"));
  assert.ok(!columnasRequeridas("activa").includes("fec_cierre"));
  for (const o of ["activa", "cerrada"] as const) {
    const r = columnasRequeridas(o);
    assert.ok(!r.includes("responsable_uei") && !r.includes("alternativa"), o);
    assert.ok(!sqlNormalizar(ARCHIVOS.find((a) => a.origen === o)!).match(/responsable|alternativa/i), o);
  }
});

test("el INSERT de cada archivo: cada columna de inversion_mef con su lector, sin CUI fuera y la primera fila de cada CUI", () => {
  const [activa, cerrada] = ARCHIVOS.map(sqlNormalizar);
  const destinos = COLUMNAS.map(([d]) => d);
  for (const sql of [activa, cerrada]) {
    assert.ok(sql.startsWith(`INSERT INTO _inversion_mef (${destinos.join(", ")}, origen, huella, dataset_fecha)\n`));
    assert.ok(sql.includes(`md5(ROW(${destinos.map((d) => `x.${d}`).join(", ")}, x.origen)::text), $1::date`));
    // Una expresión por columna, con la barrera OFFSET 0 (cada celda se normaliza una vez).
    for (const d of destinos) assert.equal(sql.split(` AS ${d},\n`).length + sql.split(` AS ${d}\n`).length - 2, 1, d);
    assert.match(sql, /\n {10}FROM _invierte_(activa|cerrada) s\n {8}OFFSET 0\) x\n WHERE x\.cui IS NOT NULL\n ORDER BY x\.cui, x\.fila\nON CONFLICT \(cui\) DO NOTHING$/);
  }
  for (const e of ['norm_cui(s."codigo_unico") AS cui', 'norm_snip(s."codigo_snip") AS snip', 'norm_entero(s."sec_ejec") AS sec_ejec',
    'norm_texto(s."nombre_uei") AS uei', 'norm_monto(s."ctrl_concurr") AS control_concurrente', 'norm_si(s."expediente_tecnico") AS expediente_tecnico',
    'norm_fecha_iso(s."fecha_viabilidad") AS fecha_viabilidad', 'norm_ubigeo(s."ubigeo") AS ubigeo', 'norm_coordenada(s."latitud") AS lat',
    'norm_suma_montos(s."deven_acumul_anio_ant", s."dev_anio_actual") AS devengado_acumulado', 'norm_monto(s."dev_anio_actual") AS devengado_anio',
    'norm_entero(s."num_habitantes_benef") AS beneficiarios', "NULL::date AS fecha_cierre", "NULL::numeric AS liquidacion",
    "'activa'::text AS origen", "FROM _invierte_activa s"]) {
    assert.ok(activa.includes(e), e);
  }
  for (const e of ['norm_texto(s."nom_uei") AS uei', 'norm_monto(s."control_concurr") AS control_concurrente',
    'norm_monto(s."deven_acumulado") AS devengado_acumulado', "NULL::numeric AS devengado_anio", "NULL::date AS inicio_ejecucion",
    'norm_fecha_iso(s."inicio_ejec_fisica") AS inicio_fisica', 'norm_entero(s."beneficiario") AS beneficiarios',
    'norm_fecha_iso(s."fec_cierre") AS fecha_cierre', "'cerrada'::text AS origen", "FROM _invierte_cerrada s"]) {
    assert.ok(cerrada.includes(e), e);
  }
  assert.equal(sqlSinCui(ARCHIVOS[0]), 'SELECT count(*)::int AS n FROM _invierte_activa s WHERE norm_cui(s."codigo_unico") IS NULL');
  assert.equal(SQL_DESTINO, "CREATE TEMP TABLE _inversion_mef (LIKE inversion_mef INCLUDING DEFAULTS, PRIMARY KEY (cui)) ON COMMIT DROP");
  // Las activas van antes: de un CUI que está en los dos archivos queda el de las activas.
  assert.deepEqual(ARCHIVOS.map((a) => a.origen), ["activa", "cerrada"]);
});

test("upsert y retiradas: los de cargar_obras.py", () => {
  for (const [d] of COLUMNAS.slice(1)) assert.ok(SQL_UPSERT.includes(` ${d} = EXCLUDED.${d},`), d);
  for (const c of ["origen", "huella", "dataset_fecha"]) assert.ok(SQL_UPSERT.includes(` ${c} = EXCLUDED.${c}`), c);
  assert.ok(!SQL_UPSERT.includes("cui = EXCLUDED.cui"));
  assert.match(SQL_UPSERT, /SELECT DISTINCT ON \(cui\) cui, snip, .*, false, now\(\), now\(\) FROM _inversion_mef ORDER BY cui\n/);
  assert.match(SQL_UPSERT, /retirada = false, cambiado_at = now\(\)\n  WHERE t\.huella IS DISTINCT FROM EXCLUDED\.huella OR t\.retirada\n  RETURNING \(xmax = 0\) AS nueva\)/);
  assert.match(SQL_RETIRAR, /SET retirada = true, cambiado_at = now\(\)\n WHERE NOT t\.retirada AND NOT EXISTS \(SELECT 1 FROM _inversion_mef x WHERE x\.cui = t\.cui\)/);
});

test("el resumen: CUI repetidos, iguales y totales (con los números de la carga del 2026-10-27)", () => {
  const r = armarResumen({
    detalle_inversiones: { filas: 150359, sin_cui: 67, quedan: 150291 },
    cierre_inversiones: { filas: 120340, sin_cui: 3447, quedan: 116893 },
  }, { nuevas: 12, cambiadas: 300 }, 5, 41);
  assert.deepEqual(r, {
    archivos: { detalle_inversiones: { filas: 150359, sin_cui: 67, cui_repetidos: 1 }, cierre_inversiones: { filas: 120340, sin_cui: 3447, cui_repetidos: 0 } },
    copiadas: 267184, nuevas: 12, cambiadas: 300, iguales: 266872, retiradas: 5, sin_cui: 3514, cui_repetidos: 1, segundos: 41,
  });
  assert.ok(hayCambios(r));
  assert.ok(hayCambios({ nuevas: 0, cambiadas: 0, retiradas: 1 }));
  assert.ok(!hayCambios({ nuevas: 0, cambiadas: 0, retiradas: 0 }));
});

test("dataset_fecha: el día del Last-Modified (en UTC, como Python) o, sin él, el de la descarga", () => {
  assert.equal(isoDeHttp("Thu, 29 Oct 2026 18:33:00 GMT"), "2026-10-29T18:33:00.000Z");
  assert.equal(isoDeHttp(null), null);
  assert.equal(isoDeHttp("ayer"), null);
  assert.equal(fechaDelArchivo({ modified: "2026-10-29T23:33:00.000Z", downloaded_at: "2026-10-31T16:00:00+00:00" }), "2026-10-29");
  assert.equal(fechaDelArchivo({ modified: null, downloaded_at: "2026-10-31T16:00:00+00:00" }), "2026-10-31");
});

// ─── El paso de carga con una base falsa ───────────────────────────────────────────────────────────────────────────

const DETALLE = csvMef(CAB_DETALLE, [
  { CODIGO_UNICO: "2716769", NOMBRE_INVERSION: "RIEGO", ALTERNATIVA: "texto libre" },
  { CODIGO_UNICO: "", NOMBRE_INVERSION: "SIN CUI" },
  { CODIGO_UNICO: "2716769", NOMBRE_INVERSION: "REPETIDA" },
]);
const CIERRE = csvMef(CAB_CIERRE, [{ CODIGO_UNICO: "2511436", RESPONSABLE_UEI: "UNA PERSONA" }]);

function bajado(clave: string, nombre: string, bytes: Uint8Array, modified: string | null): Bajado {
  const entrada: Entrada = { url: `https://fs.datosabiertos.mef.gob.pe/datastorefiles/${nombre}`, file: `invierte_pe/${clave}/${nombre}`,
    sha256: `sha-${clave}`, bytes: bytes.length, downloaded_at: "2026-10-31T13:00:00+00:00", modified };
  return { clave, entrada };
}

function envFalso(archivos: Record<string, Uint8Array>): Env {
  return { CRUDOS: { async get(key: string) {
    const b = archivos[key];
    return b ? { size: b.length, body: enTrozos(b, 113) } : null;
  } } } as unknown as Env;
}

interface Op { cargados?: boolean; vivas?: number; quedan?: [number, number] }

/** Anota cada sentencia y responde lo mínimo. COPY cuenta los registros (sin la cabecera si lleva HEADER). */
function baseFalsa(op: Op = {}) {
  const sentencias: { sql: string; params?: unknown[] }[] = [];
  const copiado: Record<string, string> = {};
  const db = {
    async filas(sql: string, params?: unknown[]) {
      sentencias.push({ sql, params });
      if (sql.includes("FROM datasets_cargas")) return op.cargados ? [{ "?column?": 1 }] : [];
      if (sql.startsWith("SELECT count(*)::int AS n FROM _invierte_activa")) return [{ n: 1 }];
      if (sql.startsWith("SELECT count(*)::int AS n FROM _invierte_cerrada")) return [{ n: 0 }];
      if (sql.startsWith("WITH up AS")) return [{ nuevas: 1, cambiadas: 1 }];
      if (sql.includes("AS vivas")) return [{ vivas: op.vivas ?? 2 }];
      throw new Error(`consulta inesperada: ${sql}`);
    },
    async ejecutar(sql: string, params?: unknown[]) {
      sentencias.push({ sql, params });
      if (sql.startsWith("INSERT INTO _inversion_mef")) return sql.includes("_invierte_activa") ? (op.quedan ?? [1, 1])[0] : (op.quedan ?? [1, 1])[1];
      if (sql.startsWith("UPDATE inversion_mef")) return 3;
      return 0;
    },
    async abrirCopia(sql: string): Promise<Copia> {
      sentencias.push({ sql });
      const tabla = sql.split(" ")[1];
      copiado[tabla] = "";
      return {
        async escribir(d: Uint8Array) {
          copiado[tabla] += new TextDecoder().decode(d);
        },
        async cerrar() {
          const n = copiado[tabla].split("\n").length - 1;
          return sql.includes("HEADER") ? n - 1 : n;
        },
      };
    },
  } as unknown as Db;
  return { db, sentencias, copiado };
}

/** Una etiqueta corta por sentencia, para comparar el orden. */
function etiqueta(sql: string): string {
  const reglas: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
    [/^SELECT 1 FROM datasets_cargas/, "¿ya cargado?"],
    [/^(BEGIN|COMMIT|ROLLBACK)$/, (m) => m[1]],
    [/^SET LOCAL (\w+)/, (m) => `SET ${m[1]}`],
    [/^CREATE TEMP TABLE (\w+)/, (m) => `temporal ${m[1]}`],
    [/^COPY (\w+)/, (m) => `COPY ${m[1]}`],
    [/^SELECT count\(\*\)::int AS n FROM (\w+)/, (m) => `sin CUI ${m[1]}`],
    [/^INSERT INTO _inversion_mef[\s\S]*FROM (\w+) s/, (m) => `normalizar ${m[1]}`],
    [/^WITH up AS/, "upsert"],
    [/AS vivas/, "vivas"],
    [/^UPDATE inversion_mef/, "retirar"],
    [/^INSERT INTO datasets_cargas/, "registrar"],
  ];
  for (const [re, nombre] of reglas) {
    const m = sql.match(re);
    if (m) return typeof nombre === "string" ? nombre : nombre(m);
  }
  return sql.slice(0, 40);
}

const ORDEN = ["BEGIN", "SET lock_timeout", "SET statement_timeout", "SET work_mem",
  "temporal _invierte_activa", "COPY _invierte_activa", "sin CUI _invierte_activa",
  "temporal _invierte_cerrada", "COPY _invierte_cerrada", "sin CUI _invierte_cerrada",
  "temporal _inversion_mef", "normalizar _invierte_activa", "normalizar _invierte_cerrada", "upsert", "vivas"];

const archivos = {
  "raw/invierte_pe/detalle_inversiones/DETALLE_INVERSIONES.csv": DETALLE,
  "raw/invierte_pe/cierre_inversiones/CIERRE_INVERSIONES.csv": CIERRE,
};
const bajados = [
  bajado("detalle_inversiones", "DETALLE_INVERSIONES.csv", DETALLE, "2026-10-29T18:33:00.000Z"),
  bajado("cierre_inversiones", "CIERRE_INVERSIONES.csv", CIERRE, null),
];

test("carga: las sentencias en orden, el resumen y los dos archivos en datasets_cargas", async () => {
  const { db, sentencias, copiado } = baseFalsa();
  const r = await cargarInversiones(envFalso(archivos), db, bajados, {}, "prueba");
  assert.deepEqual(sentencias.map((s) => etiqueta(s.sql)), ["¿ya cargado?", "¿ya cargado?", ...ORDEN, "retirar", "registrar", "registrar", "COMMIT"]);
  // COPY recibe el CSV tal como viene (sin BOM y con \n), con las columnas de la cabecera y HEADER.
  const copy = sentencias.find((s) => s.sql.startsWith("COPY _invierte_cerrada"))!.sql;
  assert.equal(copy, `COPY _invierte_cerrada (${CAB_CIERRE.map((c) => `"${c.toLowerCase()}"`).join(", ")}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')`);
  assert.ok(copiado._invierte_activa.startsWith('"NIVEL","SECTOR"') && copiado._invierte_activa.endsWith('""\n'));
  // dataset_fecha: el Last-Modified de las activas; las cerradas no lo trajeron, el día de la descarga.
  assert.deepEqual(sentencias.filter((s) => s.sql.startsWith("INSERT INTO _inversion_mef")).map((s) => s.params), [["2026-10-29"], ["2026-10-31"]]);
  const registros = sentencias.filter((s) => s.sql.startsWith("INSERT INTO datasets_cargas")).map((s) => s.params!);
  assert.deepEqual(registros.map((p) => [p[0], p[1], p[2], p[3], p[5], p[7], p[9]]), [
    ["invierte_pe", "detalle_inversiones", "inversion_mef", "DETALLE_INVERSIONES.csv", "sha-detalle_inversiones", 3, "2026-10-29T18:33:00.000Z"],
    ["invierte_pe", "cierre_inversiones", "inversion_mef", "CIERRE_INVERSIONES.csv", "sha-cierre_inversiones", 1, "2026-10-31T13:00:00+00:00"],
  ]);
  assert.deepEqual({ ...r, segundos: 0 }, {
    archivos: { detalle_inversiones: { filas: 3, sin_cui: 1, cui_repetidos: 1 }, cierre_inversiones: { filas: 1, sin_cui: 0, cui_repetidos: 0 } },
    copiadas: 2, nuevas: 1, cambiadas: 1, iguales: 0, retiradas: 3, sin_cui: 1, cui_repetidos: 1, segundos: 0,
  });
});

test("carga en seco: todo igual y ROLLBACK, sin datasets_cargas; con los dos sha256 ya cargados, nada", async () => {
  const seco = baseFalsa({ cargados: true });
  const r = await cargarInversiones(envFalso(archivos), seco.db, bajados, { seco: true }, "prueba");
  assert.deepEqual(seco.sentencias.map((s) => etiqueta(s.sql)), [...ORDEN, "retirar", "ROLLBACK"]);
  assert.equal((r as { seco?: boolean }).seco, true);

  const ya = baseFalsa({ cargados: true });
  assert.deepEqual(await cargarInversiones(envFalso(archivos), ya.db, bajados, {}, "prueba"),
    { ya_cargado: true, sha256: { detalle_inversiones: "sha-detalle_inversiones", cierre_inversiones: "sha-cierre_inversiones" } });
  assert.deepEqual(ya.sentencias.map((s) => etiqueta(s.sql)), ["¿ya cargado?", "¿ya cargado?"]);

  // forzar: aunque estén cargados, se carga.
  const forzado = baseFalsa({ cargados: true });
  await cargarInversiones(envFalso(archivos), forzado.db, bajados, { forzar: true }, "prueba");
  assert.equal(etiqueta(forzado.sentencias.at(-1)!.sql), "COMMIT");
});

test("carga: con menos del 90 % de lo vivo no marca retiradas; sin una columna, ROLLBACK", async () => {
  const { db, sentencias } = baseFalsa({ vivas: 100, quedan: [50, 30] });
  const r = await cargarInversiones(envFalso(archivos), db, bajados, {}, "prueba");
  assert.ok(!sentencias.some((s) => etiqueta(s.sql) === "retirar"));
  assert.equal((r as { retiradas: number }).retiradas, 0);
  assert.match((r as { sin_retirar?: string }).sin_retirar ?? "", /traen 80 de 100 inversiones vivas/);
  assert.equal(etiqueta(sentencias.at(-1)!.sql), "COMMIT");

  const sinColumna = csvMef(CAB_CIERRE.filter((c) => c !== "DEVEN_ACUMULADO"), [{ CODIGO_UNICO: "2511436" }]);
  const roto = baseFalsa();
  await assert.rejects(
    cargarInversiones(envFalso({ ...archivos, "raw/invierte_pe/cierre_inversiones/CIERRE_INVERSIONES.csv": sinColumna }), roto.db,
      [bajados[0], bajado("cierre_inversiones", "CIERRE_INVERSIONES.csv", sinColumna, null)], {}, "prueba"),
    /CIERRE_INVERSIONES\.csv: faltan columnas DEVEN_ACUMULADO/);
  assert.equal(etiqueta(roto.sentencias.at(-1)!.sql), "ROLLBACK");

  // Si R2 tiene otro tamaño que el que anotó la descarga, no se carga.
  const otro = baseFalsa();
  await assert.rejects(cargarInversiones(envFalso(archivos), otro.db, [{ ...bajados[0], entrada: { ...bajados[0].entrada, bytes: 5 } }, bajados[1]], {}, "prueba"),
    /en R2 hay \d+ bytes y la descarga anotó 5/);
  assert.equal(etiqueta(otro.sentencias.at(-1)!.sql), "ROLLBACK");
});
