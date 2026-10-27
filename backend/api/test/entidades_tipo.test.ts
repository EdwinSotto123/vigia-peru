import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASE_SQL, CLASES_ENTIDAD, ListQuery, NOMBRE_VALIDO, REGLAS_TIPO_ENTIDAD, filtrosEntidades, nombreValido, presupuestoDe, rucsDeClase,
  tipoDeEntidad,
} from "../src/routes/entidades.js";
// La web muestra el tipo con sus propias reglas (frontend/lib/entidad-tipo.ts): tienen que ser las mismas que filtran y
// cuentan la lista (`CLASE_SQL`). El archivo de la web no importa nada con alias, así que se puede probar desde aquí. El
// paquete de la web no es ESM: llega como CommonJS (sus exports, en `default`).
import * as moduloWeb from "../../../frontend/lib/entidad-tipo.ts";

type TipoWeb = (tipoApi: string | null | undefined, nombre: string | null | undefined) => string | null;
const web = moduloWeb as unknown as { tipoEntidad?: TipoWeb; default?: { tipoEntidad: TipoWeb } };
const tipoEnLaWeb: TipoWeb = web.tipoEntidad ?? web.default!.tipoEntidad;

// El tipo de cada entidad por su nombre oficial (auditoría de UX del 2026-10-27: Petroperú «Organismo Autónomo», el
// Instituto Vial Provincial de Chupaca también, y la mitad de las fichas «Tipo no declarado»).

const CASOS: [nombre: string, tipo: string | null][] = [
  ["PETROLEOS DEL PERU S.A.", "empresa_publica"],
  ["SERVICIO DE AGUA POTABLE Y ALCANTARILLADO DE LIMA - SEDAPAL", "empresa_publica"],
  ["EMPRESA REGIONAL DE SERVICIO PUBLICO DE ELECTRICIDAD DEL CENTRO SA ELECTROCENTRO S.A.", "empresa_publica"],
  ["ENTIDAD PRESTADORA  DE SERVICIO DE SANEAMIENTO DE CUSCO S.A.", "empresa_publica"],
  ["FONDO NACIONAL DE FINANCIAMIENTO DE LA ACTIVIDAD EMPRESARIAL - FONAFE", "empresa_publica"],
  ["BANCO DE LA NACION", "empresa_publica"],
  ["INSTITUTO VIAL PROVINCIAL CHUPACA", "organismo_publico"],
  ["SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA - SUNAT", "organismo_publico"],
  ["ZONA REGISTRAL N° IX SEDE LIMA - UNIDAD EJECUTORA Nº 002-SUNARP Sede Lima", "organismo_publico"],
  ["OFICINA NACIONAL DE PROCESOS ELECTORALES", "organismo_autonomo"],
  ["JURADO NACIONAL DE ELECCIONES", "organismo_autonomo"],
  ["REGISTRO NACIONAL DE IDENTIFICACION Y ESTADO CIVIL", "organismo_autonomo"],
  ["Contraloría General de la República", "organismo_autonomo"],
  ["DEFENSORIA DEL PUEBLO", "organismo_autonomo"],
  ["BANCO CENTRAL DE RESERVA DEL PERÚ", "organismo_autonomo"],
  ["SUPERINTENDENCIA DE BANCA, SEGUROS Y AFP", "organismo_autonomo"],
  ["TRIBUNAL CONSTITUCIONAL", "organismo_autonomo"],
  ["MINISTERIO PUBLICO - GERENCIA ADMINISTRATIVA DE AREQUIPA", "organismo_autonomo"],
  ["PODER JUDICIAL", "organismo_autonomo"],
  ["CORTE SUPERIOR DE JUSTICIA DE LIMA NORTE", "organismo_autonomo"],
  ["MINISTERIO DE SALUD", "ministerio"],
  ["Ministerio de Educación", "ministerio"],
  ["MEF-UNIDAD DE COORDINACION DE PRESTAMOS SECTORIALES", "ministerio"],
  ["UNIDAD EJECUTORA DEL PLIEGO 011 MINISTERIO DE SALUD-DIRECCION DE REDES INTEGRADAS DE SALUD LIMA SUR", "salud"],
  ["GOBIERNO REGIONAL JUNIN RED DE SALUD CHUPACA", "salud"],
  ["HOSPITAL NACIONAL DOS DE MAYO", "salud"],
  ["SEGURO SOCIAL DE  SALUD", "salud"],
  ["GOBIERNO REGIONAL DE ICA-SALUD", "salud"],
  ["INSTITUTO NACIONAL DE ENFERMEDADES NEOPLASICAS", "salud"],
  ["UNIDAD DE GESTION EDUCATIVA LOCAL UGEL 05 - SAN JUAN DE LURIGANCHO", "educacion"],
  ["UNIDAD EJECUTORA EDUCACION CHUPACA", "educacion"],
  ["GOBIERNO REGIONAL DE CALLAO - COLEGIO MILITAR LEONCIO PRADO", "educacion"],
  ["DIRECCION REGIONAL DE EDUCACION  DE  LIMA METROPOLITANA", "educacion"],
  ["UNIVERSIDAD NACIONAL AUTÓNOMA DE CHUPACA", "universidad"],
  ["UNIVERSIDAD NACIONAL DE EDUCACION ENRIQUE GUZMAN Y VALLE", "universidad"],
  ["PROGRAMA NACIONAL DE ALIMENTACION ESCOLAR QALI WARMA", "programa"],
  ["MTC-PROYECTO ESPECIAL DE INFRAESTRUCTURA DE TRANSPORTE NACIONAL (PROVIAS NACIONAL)", "programa"],
  ["SOCIEDAD DE BENEFICENCIA PUBLICA DE LIMA", "beneficencia"],
  ["EJERCITO PERUANO", "fuerzas_armadas"],
  ["JEFATURA DE LA VII RPNP-LIMA", "fuerzas_armadas"],
  ["GOBIERNO REGIONAL DE CUSCO SEDE CENTRAL", "gobierno_regional"],
  ["GOBIERNO RERGIONAL DE HUANUCO - SEDE", "gobierno_regional"],
  ["DIRECCION REGIONAL AGRARIA CAJAMARCA", "gobierno_regional"],
  ["MUNICIPALIDAD DISTRITAL DE LA VILLA DE CAYMA", "municipal_distrital"],
  ["MUNICIPALIDAD DE CENTRO POBLADO DE SANTA MARIA DE HUACHIPA", "municipal_distrital"],
  ["MUNICIPALIDAD PROVINCIAL DE AREQUIPA", "municipal_provincial"],
  ["MUNICIPALIDAD METROPOLITANA DE LIMA", "municipal_provincial"],
  ["MANCOMUNIDAD MUNICIPAL CHILLAOS - REGION AMAZONAS", null],
  ["CONGRESO DE LA REPUBLICA", null],
  ["nan", null],
];

test("tipo de entidad: el nombre oficial decide, con los tipos nuevos y los organismos autónomos de verdad", () => {
  for (const [nombre, tipo] of CASOS) assert.equal(tipoDeEntidad(nombre), tipo, nombre);
});

test("tipo de entidad: el declarado sólo vale si el nombre no dice nada, y nunca un «organismo autónomo» de la semilla", () => {
  // Petroperú venía declarado «organismo_autonomo»: el nombre gana.
  assert.equal(tipoDeEntidad("PETROLEOS DEL PERU S.A.", "organismo_autonomo"), "empresa_publica");
  assert.equal(tipoDeEntidad("CONGRESO DE LA REPUBLICA", "organismo_autonomo"), null);
  assert.equal(tipoDeEntidad("SECRETARIA DE SEGURIDAD Y DEFENSA NACIONAL", "ministerio"), "ministerio");
  // Una regla que no clasifica (mancomunidad) corta antes del declarado.
  assert.equal(tipoDeEntidad("MANCOMUNIDAD MUNICIPAL LIMA SUR", "municipal_provincial"), null);
});

test("tipo de entidad: la web clasifica igual que la base (las mismas reglas, en el mismo orden)", () => {
  const declarados = [null, "organismo_autonomo", "ministerio", "municipal_distrital"];
  for (const [nombre] of CASOS) {
    for (const d of declarados) assert.equal(tipoEnLaWeb(d, nombre), tipoDeEntidad(nombre, d), `${nombre} (${d})`);
  }
});

test("tipo de entidad: la SQL lleva cada regla en su orden y el declarado al final, sin «organismo_autonomo»", () => {
  const sql = CLASE_SQL("es", "es.nombre_norm");
  let desde = 0;
  for (const [, patron] of REGLAS_TIPO_ENTIDAD) {
    const i = sql.indexOf(`es.nombre_norm ~ '${patron}'`, desde);
    assert.ok(i >= desde, patron);
    desde = i;
  }
  assert.match(sql, /WHEN es\.tipo IN \('municipal_distrital', 'municipal_provincial', 'gobierno_regional', 'ministerio', 'empresa_publica'\) THEN es\.tipo\s+END$/);
  assert.match(sql, /'\^mancomunidad\\M' THEN NULL/);
  // Ningún patrón trae una comilla que rompa el literal de la SQL.
  for (const [, patron] of REGLAS_TIPO_ENTIDAD) assert.doesNotMatch(patron, /'/);
});

test("tipo de entidad: cada tipo nuevo es una opción del filtro; lo desconocido, no", () => {
  for (const c of ["universidad", "salud", "educacion", "programa", "beneficencia", "fuerzas", "publico", "organismo", "sin"]) {
    assert.ok(CLASES_ENTIDAD.includes(c), c);
    assert.ok(ListQuery.safeParse({ clase: c }).success, c);
  }
  assert.equal(ListQuery.safeParse({ clase: "club" }).success, false);
});

test("tipo de entidad: con los RUC ya clasificados, el filtro por tipo va por la llave (y «municipal» junta las dos)", () => {
  const porTipo = { municipal_distrital: ["20121103754"], municipal_provincial: ["20154440373"], salud: ["20131257750"], sin: ["20131370998"] };
  assert.deepEqual(rucsDeClase(porTipo, "municipal"), ["20154440373", "20121103754"]);
  assert.deepEqual(rucsDeClase(porTipo, "sin"), ["20131370998"]);
  assert.deepEqual(rucsDeClase(porTipo, "universidad"), []);
  const { conds, vals } = filtrosEntidades(ListQuery.parse({ clase: "salud" }), "es", "es.nombre_norm", [], null, porTipo);
  assert.equal(conds[0], "es.ruc = ANY ($1::bpchar[])");
  assert.deepEqual(vals, [["20131257750"]]);
  // Sin la lista (no se pudo calcular), con CLASE_SQL.
  assert.match(filtrosEntidades(ListQuery.parse({ clase: "sin" }), "es", "es.nombre_norm").conds[0], /END\) IS NULL$/);
});

test("entidades: un nombre que no es un nombre («nan») no se lista; la ficha no lo muestra", () => {
  for (const n of ["nan", "NaN", " none ", "", "-", "n/a"]) assert.equal(nombreValido(n), false, JSON.stringify(n));
  for (const n of ["MUNICIPALIDAD DISTRITAL DE NANCHOC", "Ñaña", "Banco de la Nación"]) assert.equal(nombreValido(n), true, n);
  assert.equal(NOMBRE_VALIDO("es.nombre_norm"), "es.nombre_norm !~ '^\\s*(nan|none|null|n/?a|-+)?\\s*$'");
});

test("entidades: el presupuesto es el PIM del último año del MEF, como en su ficha", () => {
  const anio = (year: number, pim: number, devengado = pim / 2) => ({ year, pia: pim, pim, devengado, girado: devengado });
  assert.deepEqual(presupuestoDe([anio(2025, 100), anio(2026, 120, 30)], "ubigeo 040103", "ok"), { anio: 2026, pim: 120, devengado: 30, deTodoElGobierno: false });
  // El último año repite tal cual al anterior: el archivo del año nuevo todavía no llegó.
  assert.equal(presupuestoDe([anio(2026, 100), anio(2025, 100)], null, "ok")?.anio, 2025);
  assert.equal(presupuestoDe([anio(2026, 80)], "pliego REGION PUNO", "ok")?.deTodoElGobierno, true);
  assert.equal(presupuestoDe([anio(2026, 0)], null, "ok"), null);
  assert.equal(presupuestoDe([anio(2026, 80)], null, "sin_match"), null);
  assert.equal(presupuestoDe(null, null, "ok"), null);
});

test("entidades: por defecto la lista va por contratos (todas los tienen), no por dictamen", () => {
  assert.equal(ListQuery.parse({}).orden, "contratos");
  assert.equal(ListQuery.parse({ orden: "dictamen" }).orden, "dictamen");
});
