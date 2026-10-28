import test from "node:test";
import assert from "node:assert/strict";
import {
  alinea, armarOrganigrama, canon, claveOrgano, esSigla, expandirSigla, leyDe, nivelDe, oficinaDeCargo, palabras, partirDependencia,
  plantillaPorNombre, type DatosOrganigrama, type OficinaPlanilla,
} from "../src/lib/organigrama.js";

test("cargo de la DJI → la oficina que encabeza", () => {
  assert.equal(oficinaDeCargo("GERENTE REGIONAL DE INFRAESTRUCTURA"), "GERENCIA REGIONAL DE INFRAESTRUCTURA");
  assert.equal(oficinaDeCargo("SUB GERENTE DE SUPERVISION Y LIQUIDACION"), "SUB GERENCIA DE SUPERVISION Y LIQUIDACION");
  assert.equal(oficinaDeCargo("DIRECTOR DE LA OFICINA DE ABASTECIMIENTO Y PATRIMONIO FISCAL"), "OFICINA DE ABASTECIMIENTO Y PATRIMONIO FISCAL");
  assert.equal(oficinaDeCargo("DIRECTORA REGIONAL DE COMERCIO EXTERIOR Y TURISMO"), "DIRECCION REGIONAL DE COMERCIO EXTERIOR Y TURISMO");
  assert.equal(oficinaDeCargo("GOBERNADOR REGIONAL"), "GOBERNACION REGIONAL");
  assert.equal(oficinaDeCargo("JEFE DE LA OFICINA GENERAL DE ADMINISTRACION"), "OFICINA GENERAL DE ADMINISTRACION");
  assert.equal(oficinaDeCargo("VICEMINISTRO DE SALUD PUBLICA"), "DESPACHO VICEMINISTERIAL DE SALUD PUBLICA");
  // Sin oficina: un cargo que no es jefatura, o una jefatura de un equipo.
  assert.equal(oficinaDeCargo("COLABORADOR"), null);
  assert.equal(oficinaDeCargo("JEFE DE EQUIPO II"), null);
  assert.equal(oficinaDeCargo("RESIDENTE DE OBRA"), null);
});

test("siglas: prefijo de cada palabra, en orden; las opcionales pueden faltar", () => {
  assert.ok(alinea("GRPPAT", palabras("GERENCIA REGIONAL DE PLANEAMIENTO, PRESUPUESTO Y ACONDICIONAMIENTO TERRITORIAL")));
  assert.ok(alinea("ORADM", palabras("OFICINA REGIONAL DE ADMINISTRACION")));
  assert.ok(alinea("GG", palabras("GERENCIA GENERAL REGIONAL")));
  assert.ok(!alinea("GRI", palabras("GERENCIA REGIONAL DE DESARROLLO SOCIAL")));
  assert.ok(esSigla("GRPPAT") && esSigla("O.R.ADM.") && !esSigla("GOBERNACIÓN REGIONAL"));
});

test("abreviaturas y llaves: los nombres de una misma oficina se juntan", () => {
  assert.equal(canon("U.COMUNICACIONES").texto, "UNIDAD DE COMUNICACIONES");
  assert.ok(canon("U.COMUNICACIONES").abreviado);
  assert.equal(claveOrgano("Gobernación"), claveOrgano("GOBERNACION REGIONAL"));
  assert.equal(claveOrgano("SUBGERENCIA DE FINANZAS"), claveOrgano("SUB GERENCIA DE FINANZAS"));
  assert.equal(nivelDe("GOBERNACIÓN"), 1);
  assert.equal(nivelDe("GERENCIA REGIONAL DE INFRAESTRUCTURA"), 2);
  assert.equal(nivelDe("SUB GERENCIA DE FINANZAS"), 3);
});

test("la planilla escribe de quién depende; un lugar no es una oficina", () => {
  assert.deepEqual(partirDependencia("SUBGERENCIA DE INFRAESTRUCTURA - GERENCIA DE DESARROLLO TERRITORIAL E INFRAESTRUCTURA"),
    ["SUBGERENCIA DE INFRAESTRUCTURA", "GERENCIA DE DESARROLLO TERRITORIAL E INFRAESTRUCTURA"]);
  assert.deepEqual(partirDependencia("UNIDAD FUNCIONAL DE ECOLOGÍA -SUBGERENCIA DE SERVICIOS MUNICIPALES"),
    ["UNIDAD FUNCIONAL DE ECOLOGÍA", "SUBGERENCIA DE SERVICIOS MUNICIPALES"]);
  assert.deepEqual(partirDependencia("DIRESA - LA LIBERTAD"), ["DIRESA - LA LIBERTAD"]);
});

test("una sigla sin nombre propio: la de otras entidades; la de la región al final se quita", () => {
  const globales = [
    { nombre: "DIRECCION REGIONAL DE TRABAJO Y PROMOCION DEL EMPLEO", como: "global" as const, peso: 10 },
    { nombre: "DIRECCION REGIONAL DE TRANSPORTES Y COMUNICACIONES", como: "global" as const, peso: 10 },
    { nombre: "GERENCIA GENERAL", como: "global" as const, peso: 20 },
    { nombre: "GERENCIA GENERAL REGIONAL", como: "global" as const, peso: 12 },
  ];
  assert.equal(expandirSigla("DRTPE", globales)?.nombre, "DIRECCION REGIONAL DE TRABAJO Y PROMOCION DEL EMPLEO");
  const drtca = expandirSigla("DRTCA", globales, { region: "Ayacucho", nivelGobierno: "regional" });
  assert.equal(drtca?.nombre, "DIRECCION REGIONAL DE TRANSPORTES Y COMUNICACIONES");
  assert.equal(drtca?.como, "region");
  assert.equal(expandirSigla("DIRESA", [])?.nombre, "DIRECCION REGIONAL DE SALUD");
  assert.equal(expandirSigla("ZZZ", globales), null);
});

test("plantilla por el nombre y la ley con su texto oficial", () => {
  assert.equal(plantillaPorNombre("MUNICIPALIDAD DISTRITAL DE MAJES"), "TPL-GL");
  assert.equal(plantillaPorNombre("GOBIERNO REGIONAL AYACUCHO"), "TPL-GR");
  assert.equal(plantillaPorNombre("GOBIERNO REGIONAL DE AYACUCHO - DIRECCION REGIONAL DE SALUD"), null);
  assert.equal(plantillaPorNombre("MINISTERIO DE SALUD"), "TPL-MIN");
  assert.match(leyDe("LOGR art. 29-A")!.url!, /27902\.pdf$/);
  assert.match(leyDe("LOM arts. 26–28")!.url!, /27972\.pdf$/);
  assert.match(leyDe("Ley 32069 art. 25")!.url!, /32069-TXM\.pdf$/);
});

// El Gobierno Regional de Ayacucho (20452393493) el 2026-10-27: su planilla sólo trae siglas; la DJI, las jefaturas.
const of = (dependencia: string, personas = 1): OficinaPlanilla => ({ dependencia, personas, planilla: 3000 * personas, cas: 0, conSenales: 0, altas: 0, conFamilia: 0, jefes: [] });
const ayacucho: DatosOrganigrama = {
  entidad: { ruc: "20452393493", nombre: "GOBIERNO REGIONAL AYACUCHO", region: "Ayacucho", nivelGobierno: "regional" },
  plantilla: "TPL-GR",
  nodoGrafo: null,
  oficinas: ["GOBERNACIÓN", "DRTPE", "GG", "GRI", "GRPPAT", "OAPF", "ORADM", "SGSL", "U.COMUNICACIONES", "DRTCA", "VICEGOBERNACIÓN"].map((d) => of(d)),
  cargos: [
    "GOBERNADOR REGIONAL", "GERENTE REGIONAL DE INFRAESTRUCTURA", "GERENTE REGIONAL DE PLANEAMIENTO PRESUPUESTO Y ACONDICIONAMIENTO TERRITORIAL",
    "GERENTE REGIONAL DE DESARROLLO ECONOMICO", "GERENTE REGIONAL DE DESARROLLO SOCIAL", "SUB GERENTE DE SUPERVISION Y LIQUIDACION",
    "SUB GERENTE DE DEFENSA CIVIL", "SUB GERENTE DE PROGRAMACION E INVERSIONES", "DIRECTOR DE LA OFICINA DE ABASTECIMIENTO Y PATRIMONIO FISCAL",
    "DIRECTORA DE TESORERIA", "DIRECTOR REGIONAL DE ENERGIA Y MINAS", "DIRECTOR DE LA UNIDAD DE COMUNICACIONES",
  ].map((cargo, i) => ({ cargo, nombre: `PERSONA${i} ••• NOMBRE`, ficha: null, desde: "2023-01-03" })),
  globales: [
    { texto: "DIRECCION REGIONAL DE TRABAJO Y PROMOCION DEL EMPLEO", fuente: "planilla", entidades: 10 },
    { texto: "DIRECCION REGIONAL DE TRANSPORTES Y COMUNICACIONES", fuente: "planilla", entidades: 12 },
    { texto: "OFICINA REGIONAL DE ADMINISTRACION", fuente: "planilla", entidades: 5 },
    { texto: "GERENCIA GENERAL", fuente: "planilla", entidades: 246 },
    { texto: "GERENTE GENERAL REGIONAL", fuente: "dji", entidades: 27 },
  ],
  visitas: [{ area: "GERENCIA REGIONAL DE INFRAESTRUCTURA", n: 4, ultima: "2026-05-06" }, { area: "MESA DE PARTES", n: 2, ultima: null }],
  mesPlanilla: "2026-09",
  enlaces: { planilla: "https://www.transparencia.gob.pe/personal/x", dji: "https://appdji.contraloria.gob.pe/DJIC/ConsultaPublicaDJICRUC.aspx?ruc=20452393493" },
};

test("Ayacucho: las siglas de su planilla se leen con la DJI, la ley y otras entidades", () => {
  const o = armarOrganigrama(ayacucho);
  const por = (sigla: string) => o.nodos.find((n) => n.sigla === sigla);
  assert.match(por("GRPPAT")!.nombre, /PLANEAMIENTO,? PRESUPUESTO,? Y ACONDICIONAMIENTO TERRITORIAL/i);
  assert.equal(por("GRPPAT")!.expansion?.como, "dji");
  assert.match(por("ORADM")!.nombre, /OFICINA REGIONAL DE ADMINISTRACION/);
  assert.match(por("DRTPE")!.nombre, /TRABAJO Y PROMOCION DEL EMPLEO/);
  assert.equal(por("DRTCA")!.expansion?.como, "region");
  assert.match(por("GG")!.nombre, /Gerencia General Regional/i);
  assert.match(por("U.COMUNICACIONES")!.nombre, /UNIDAD DE COMUNICACIONES/);
  assert.equal(o.resumen.siglas, o.resumen.siglasExpandidas);
});

test("Ayacucho: dependencias con su evidencia (ley, función) y quién decide", () => {
  const o = armarOrganigrama(ayacucho);
  const id = (re: RegExp) => o.nodos.find((n) => re.test(n.nombre))!;
  const ggr = id(/^Gerencia General Regional$/);
  const gri = id(/INFRAESTRUCTURA$/i);
  // La ley: la gerencia de infraestructura depende de la Gerencia General Regional (LOGR art. 29-A, que agregó la Ley 27902).
  assert.equal(gri.padre, ggr.id);
  assert.equal(gri.arista?.tipo, "ley");
  assert.match(gri.arista!.url!, /27902\.pdf$/);
  // La ley: la Gerencia General Regional depende de la Gobernación (que es la titular).
  const gob = id(/^Gobernación Regional$/);
  assert.equal(ggr.padre, gob.id);
  assert.equal(gob.rol, "titular");
  assert.equal(ggr.rol, "aga");
  // Inferido por la LOGR 29-A: defensa civil, en la gerencia de recursos naturales (que sólo trae la ley).
  const dc = id(/DEFENSA CIVIL/i);
  assert.equal(dc.arista?.tipo, "funcion");
  assert.match(dc.padre!, /RECURSOS NATURALES/);
  // Inferido por su función: la tesorería, en la oficina regional de administración.
  const tes = id(/TESORERIA/i);
  assert.match(tes.padre!, /OFICINA ADMINISTRACION/);
  // La supervisión de obras, en la de infraestructura.
  assert.equal(id(/SUPERVISION Y LIQUIDACION/i).padre, gri.id);
  // Jefe de la DJI y las visitas por área (las que no calzan, aparte).
  assert.equal(gri.jefes[0]?.fuente, "dji");
  assert.equal(gri.visitas, 4);
  assert.equal(o.resumen.visitasSinOficina, 2);
  // La de recursos naturales no aparece en sus datos: sólo la trae la ley.
  assert.equal(id(/RECURSOS NATURALES/i).enDatos, false);
});

test("una municipalidad: la cadena de su planilla y la Gerencia Municipal por la LOM", () => {
  const o = armarOrganigrama({
    entidad: { ruc: "20175975234", nombre: "MUNICIPALIDAD PROVINCIAL DE LAMBAYEQUE", region: "Lambayeque", nivelGobierno: "provincial" },
    plantilla: null, nodoGrafo: null,
    oficinas: [
      of("UNIDAD FUNCIONAL DE ASEO URBANO Y TRATAMIENTO DE LOS RESIDUOS SÓLIDOS -SUBGERENCIA DE SERVICIOS MUNICIPALES", 135),
      of("SUBGERENCIA DE SERVICIOS MUNICIPALES - GERENCIA DE SERVICIOS MUNICIPALES Y GESTIÓN AMBIENTAL", 3),
      of("OFICINA GENERAL DE ADMINISTRACIÓN", 2),
      of("OFICINA DE TESORERÍA - OFICINA GENERAL DE ADMINISTRACIÓN", 2),
      of("GERENCIA MUNICIPAL", 1),
    ],
    cargos: [], globales: [], visitas: [], mesPlanilla: "2026-09", enlaces: { planilla: null, dji: null },
  });
  const id = (re: RegExp) => o.nodos.find((n) => re.test(n.nombre))!;
  const aseo = id(/ASEO URBANO/);
  const sub = id(/^SUB GERENCIA DE SERVICIOS MUNICIPALES$/);
  assert.equal(aseo.padre, sub.id);
  assert.equal(aseo.arista?.tipo, "planilla");
  assert.equal(aseo.personas, 135);
  assert.equal(id(/TESORERIA/).padre, id(/^OFICINA GENERAL DE ADMINISTRACION$/).id);
  const gm = id(/^Gerencia Municipal$/i);
  assert.equal(gm.padre, id(/^Alcaldía$/).id);
  assert.equal(gm.arista?.tipo, "ley");
  assert.equal(gm.rol, "aga");
});

test("nombres cortados por el portal y erratas: se juntan con el bien escrito", () => {
  const o = armarOrganigrama({
    entidad: { ruc: "20131373237", nombre: "MINISTERIO DE SALUD", region: null, nivelGobierno: "nacional" },
    plantilla: "TPL-MIN", nodoGrafo: null,
    oficinas: [
      // Como las publica el portal: cortadas a 45 caracteres, a media palabra o justo entre dos.
      of("DIRECCION GENERAL DE MEDICAMENTOS INSUMOS Y", 226),
      of("DIRECCION GENERAL DE MEDICAMENTOS INSUMOS Y DROGAS", 9),
      of("OFICINA GENERAL DE GESTION DE RECURSOS HUMANO", 22),
      of("OFICINA GENERAL DE GESTION DE RECURSOS HUMANOS", 3),
      of("DESPACHO VICEMINISTERIAL DE PRESTACIONES Y AS", 11),
      of("DESPACHO VICEMINISTERIAL DE PRESTACIONES Y ASEGURAMIENTO EN SALUD", 2),
      of("OFICINA GENERAL DE COOPERACION TECNICA INTERN", 14),
      of("OFICINA GENERAL DE COOPERACION TECNICA INTERNACIONAL", 1),
      of("DIRECCION GENERAL DE INTERVENCIONES ESTRATEGI", 90),
      of("OFICINA GENERAL DE ADMINISTRACION", 54),
      of("OFICINA GERENERAL DE ADMINISTRACION", 1),
      of("UNIDAD DE GESTION EDUCATIVA LOCAL 01", 3),
      of("UNIDAD DE GESTION EDUCATIVA LOCAL 02", 4),
      of("DIRECCION DE PRODUCTOS FARMACEUTICOS", 130),
    ],
    cargos: [], globales: [], visitas: [], mesPlanilla: "2026-09", enlaces: { planilla: null, dji: null },
  });
  const digemid = o.nodos.filter((n) => /MEDICAMENTOS/.test(n.nombre));
  assert.equal(digemid.length, 1);
  assert.equal(digemid[0].personas, 235);
  assert.match(digemid[0].nombre, /DROGAS$/);
  assert.equal(o.nodos.filter((n) => /^OFICINA GENERAL DE ADMINISTRACION$/.test(n.nombre)).length, 1);
  assert.equal(o.nodos.filter((n) => /RECURSOS HUMANO/.test(n.nombre)).length, 1);
  // Sin nombre entero en ninguna fuente: queda cortado y marcado.
  assert.ok(o.nodos.find((n) => /ESTRATEGI$/.test(n.nombre))!.cortado);
  // Los números distinguen: dos UGEL son dos oficinas.
  assert.equal(o.nodos.filter((n) => /EDUCATIVA LOCAL/.test(n.nombre)).length, 2);
  // Lo que ningún dato ubica va en su agrupador, no colgado de cualquiera.
  const sin = o.nodos.find((n) => /PRODUCTOS FARMACEUTICOS/.test(n.nombre))!;
  assert.equal(sin.padre, "SIN DEPENDENCIA EN LOS DATOS");
  assert.ok(o.nodos.some((n) => n.id === "SIN DEPENDENCIA EN LOS DATOS" && n.grupo));
});

test("el gobierno entero: las unidades del gobierno regional, bajo la gerencia que tiene su tema", () => {
  const o = armarOrganigrama({
    ...ayacucho,
    unidades: [
      { ruc: "20181079968", nombre: "GOBIERNO REGIONAL DE AYACUCHO-SALUD", personas: 900, tipo: "regional" },
      { ruc: "20495097073", nombre: "GOBIERNO REGIONAL DE AYACUCHO - UNIDAD DE GESTION EDUCATIVA LOCAL DE HUAMANGA", personas: 300, tipo: "regional" },
      { ruc: "20365228109", nombre: "GOBIERNO REGIONAL DE AYACUCHO-TRANSPORTES", personas: 40, tipo: "regional" },
      { ruc: "20494642078", nombre: "GOBIERNO REGIONAL DE AYACUCHO - PROGRAMA REGIONAL DE IRRIGACION Y DESARROLLO RURAL INTEGRADO", personas: 20, tipo: "regional" },
      { ruc: "20999999999", nombre: "GOBIERNO REGIONAL DE AYACUCHO - ALDEA INFANTIL", personas: 5, tipo: "regional" },
    ],
  });
  const u = (ruc: string) => o.nodos.find((n) => n.ruc === ruc)!;
  assert.match(u("20181079968").padre!, /DESARROLLO SOCIAL/);
  assert.match(u("20495097073").padre!, /DESARROLLO SOCIAL/);
  assert.match(u("20365228109").padre!, /INFRAESTRUCTURA/);
  assert.match(u("20494642078").padre!, /DESARROLLO ECONOMICO/);
  assert.equal(u("20181079968").arista?.tipo, "funcion");
  assert.equal(u("20181079968").personas, 900);
  // La que no calza con ningún tema, en su agrupador.
  assert.equal(u("20999999999").padre, "UNIDADES DEL GOBIERNO REGIONAL");
  assert.equal(o.resumen.unidades, 5);
});
