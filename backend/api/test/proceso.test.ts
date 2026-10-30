import test from "node:test";
import assert from "node:assert/strict";
import { TAPA_NOMBRE, publicar, refRuc10 } from "../src/lib/privacidad.js";
import {
  armarContrato, armarCronograma, armarParticipantes, cuiDeTexto, deEstaConvocatoria, fechaBuenaProDe, ganadoresDe, mesesEntre, registradosDe,
  vinculosDe, type FilaParticipante,
} from "../src/lib/proceso.js";

process.env.PRIVACIDAD_CLAVE = "clave-de-prueba-de-32-caracteres-o-mas";

// Lo que trae la ficha del 1224210 (Municipalidad Distrital de Sancos): 17 registrados, 3 ofertas, buena pro el 21 jul.
const fila = (f: Partial<FilaParticipante> & { ruc: string }): FilaParticipante => ({
  nombre: null, orden: null, registrado: true, oferto: false, desde: null, hasta: null, items: null,
  estado_sunat: "ACTIVO", condicion: "HABIDO", fecha_alta: null, actividad: null, rnp_vigente: null,
  domicilio: null, distrito: null, postulaciones: null, ganadas: null, adjudicado: null, n_alta: null, n_media: null, n_baja: null,
  antecedentes: null, integrantes: null, ...f,
});

test("registradosDe: los tenderers sin repetir ni el prefijo PE-RUC-; sin ellos, las partes", () => {
  const t = [{ id: "PE-RUC-20615038998", name: "TITANMAQ S.R.L." }, { id: "PE-RUC-20615038998", name: "otra vez" }, { id: "PE-RUC-1795782", name: "CONSORCIO VIAL" }, { id: "PE-CONSUCODE-568" }];
  assert.deepEqual(registradosDe(t, null), [{ ruc: "20615038998", nombre: "TITANMAQ S.R.L." }, { ruc: "1795782", nombre: "CONSORCIO VIAL" }]);
  assert.deepEqual(registradosDe([], [{ id: "PE-RUC-20100070031", name: "VOLVO PERU S A" }]), [{ ruc: "20100070031", nombre: "VOLVO PERU S A" }]);
  assert.deepEqual(registradosDe(null, null), []);
});

test("participantes: el ganador primero, luego quien ofertó; meses de inscrita al convocar", () => {
  const ganadores = ganadoresDe([], [{ item: 1, ruc: "20615038998", montoPen: 535900 }], new Map());
  const ps = armarParticipantes([
    fila({ ruc: "20525165958", nombre: "CORPORATION WITHMORY S.R.L.", orden: 1 }),
    fila({ ruc: "20538736695", nombre: "CHALSA CORPORATION S.A.C.", orden: 16, oferto: true, desde: "2026-07-16", hasta: "2026-07-16", items: [1] }),
    fila({ ruc: "20615038998", nombre: "TITANMAQ S.R.L.", orden: 15, oferto: true, desde: "2026-07-16", hasta: "2026-07-16", items: [1], fecha_alta: "2025-11-10" }),
  ], { fechaConvocatoria: "2026-06-10", ganadores, vinculos: [] });
  assert.deepEqual(ps.map((p) => p.ruc), ["20615038998", "20538736695", "20525165958"]);
  assert.equal(ps[0].gano, true);
  assert.deepEqual(ps[0].itemsGanados, [1]);
  assert.equal(ps[0].montoAdjudicado, 535900);
  assert.equal(ps[0].sunat?.mesesAlConvocar, 7);
  assert.equal(ps[2].oferta, null);
  assert.equal(mesesEntre("2026-07-11", "2026-06-10"), -1);
  assert.equal(mesesEntre("2026-06-15", "2026-06-10"), -1); // días después de convocar: después, no «0 meses»
  assert.equal(mesesEntre("2025-11-10", "2026-06-09"), 6);
});

test("privacidad: una persona natural sale con su ref y un apellido tapado, nunca con dirección", () => {
  // La SQL no pide la dirección de un RUC 10; aunque llegara, no sale.
  const ps = armarParticipantes([
    fila({ ruc: "10439608801", nombre: "CARPIO COBOS ABEL", oferto: true, desde: "2026-05-14", domicilio: "JR. LOS PINOS 123", distrito: "OXAPAMPA", fecha_alta: "2019-01-01" }),
    fila({ ruc: "20615038998", nombre: "TITANMAQ S.R.L.", domicilio: "AV. CAMINOS DEL INCA NRO. 370", distrito: "SANTIAGO DE SURCO" }),
  ], { fechaConvocatoria: "2026-05-05", ganadores: ganadoresDe([], [{ item: 2, ruc: "10439608801", montoPen: 52072.36 }], new Map()), vinculos: [] });
  const r = publicar({ participantes: ps, contrato: armarContrato({
    items: [{ id: "21", posicion: 2, descripcion: "ÍTEM 2", montoPen: 63521, estado: "CONTRATADO" }],
    conosce: [{ item: 2, ruc: "10439608801", proveedor: "CARPIO COBOS ABEL", cantidad: 1, montoPen: 52072.36, estado: "Contratado" }],
    adjudicaciones: [], filas: [], contratosOcds: null, nombres: new Map(),
  }) });
  const persona = r.participantes[0];
  assert.equal(persona.ruc, refRuc10("10439608801"));
  assert.equal(persona.nombre, `CARPIO ${TAPA_NOMBRE} ABEL`);
  assert.equal(persona.tipo, "persona");
  assert.ok(persona.sunat && !("domicilio" in persona.sunat) && !("distrito" in persona.sunat));
  assert.equal(r.contrato.items[0].proveedores[0].nombre, `CARPIO ${TAPA_NOMBRE} ABEL`);
  const json = JSON.stringify(r);
  assert.doesNotMatch(json, /10439608801|43960880|COBOS|LOS PINOS/);
  // Una empresa, entera y con su domicilio fiscal (público en la SUNAT).
  assert.equal(r.participantes[1].nombre, "TITANMAQ S.R.L.");
  assert.equal(r.participantes[1].sunat?.domicilio, "AV. CAMINOS DEL INCA NRO. 370");
});

test("vínculos: el mismo domicilio que el ganador (cruce sin la lista, de antes de la 141) y el socio común en las dos puntas", () => {
  const ps = [
    { ruc: "20615038998", nombre: "TITANMAQ S.R.L.", domicilio: "AV. CAMINOS DEL INCA NRO. 370 URB. TAMBO DE MONTERRICO" },
    { ruc: "20609264021", nombre: "INVERSIONES Y NEGOCIOS GENERALES DEL PERU S.R.L.", domicilio: "AV. CAMINOS DEL INCA NRO. 370  URB. TAMBO DE MONTERRICO" },
    { ruc: "20610286632", nombre: "LEIMAR COMPANY S.A.C.", domicilio: "CAMINOS DEL INCA NRO. 2725" },
    { ruc: "20606082411", nombre: "TRACAMA MOTOR S.A.C.", domicilio: null },
  ];
  const v = vinculosDe([
    { tipo: "domicilio_compartido", ruc: "20615038998", severidad: "alta", detalle: { otros_postores: 1, empresas_en_domicilio: 2 } },
    { tipo: "socio_comun", ruc: "20606082411", severidad: "alta", detalle: { otros_postores: ["20610286632"] } },
  ], ps, new Set(["20615038998"]));
  assert.deepEqual(v.get("20609264021")?.map((x) => [x.tipo, x.conGanador, x.con.map((c) => c.ruc)]), [["domicilio_compartido", true, ["20615038998"]]]);
  assert.deepEqual(v.get("20615038998")?.map((x) => [x.tipo, x.conGanador, x.con.map((c) => c.ruc)]), [["domicilio_compartido", false, ["20609264021"]]]);
  assert.equal(v.get("20609264021")?.[0].domicilio, "AV. CAMINOS DEL INCA NRO. 370 URB. TAMBO DE MONTERRICO");
  assert.deepEqual(v.get("20610286632")?.map((x) => [x.tipo, x.con.map((c) => c.ruc)]), [["socio_comun", ["20606082411"]]]);
  assert.deepEqual(v.get("20606082411")?.map((x) => [x.tipo, x.con.map((c) => c.ruc)]), [["socio_comun", ["20610286632"]]]);
});

test("cronograma: en orden, con su fuente; la buena pro de CONOSCE y del OCDS del mismo día va junta", () => {
  const h = armarCronograma({
    convocatoria: "2026-06-10",
    consultas: { startDate: "2026-06-11T00:01:00-05:00", endDate: "2026-06-19T23:59:00-05:00" },
    documentos: [
      { tipo: "biddingDocuments", titulo: "Bases Administrativas", fecha: "2026-06-10" },
      { tipo: "awardNotice", titulo: "Documentos de Otorgamiento de Buena Pro", fecha: "2026-07-21" },
      { tipo: "contractSigned", titulo: "De otra convocatoria", fecha: "2026-03-01" },
    ],
    ofertas: { desde: "2026-07-16", hasta: "2026-07-16", n: 3 },
    conosce: [{ fechaBuenaPro: "2026-07-21", fechaConsentimiento: "2026-08-07" }],
    adjudicaciones: [{ fecha: "2026-07-21", vigente: true }, { fecha: "2026-07-01", vigente: false }],
    firmados: [],
  });
  assert.deepEqual(h.map((x) => `${x.fecha} ${x.clave}`), [
    "2026-06-10 convocatoria", "2026-06-10 documentos", "2026-06-11 consultas", "2026-07-16 ofertas",
    "2026-07-21 buena_pro", "2026-07-21 documentos", "2026-08-07 consentimiento",
  ]);
  assert.equal(h[2].hasta, "2026-06-19");
  assert.equal(h[3].n, 3);
  assert.deepEqual(h[4].fuentes, ["conosce", "ocds"]);
});

test("contrato: una fila por contrato (la base ya sumó sus modificaciones); sin CONOSCE, el contrato del OCDS", () => {
  // contratosConosce agrupa en SQL las filas de cada modificación: llegan los adicionales ya sumados (11381 + 15295 + 8031.53).
  const fila = {
    codigo: "2380174", numero: "005-2026", items: [1], total: 288450, suma_items: 288450, adicional: 34707.53, reduccion: 0, prorroga: 0,
    complementario: 0, moneda: "Soles", ruc: "20131378972", url: null, publicado: "2026-03-09", firmado: "2026-03-05", desde: "2026-03-06",
    hasta: "2026-08-31", hasta_actualizada: "2026-10-31",
  };
  const k = armarContrato({
    items: [{ id: "9", posicion: 1, descripcion: "OBRA", montoPen: 300000, estado: "CONTRATADO" }],
    conosce: [{ item: 1, ruc: "20131378972", proveedor: "CONSTRUCTORA S.A.C.", cantidad: 1, montoPen: 288450, estado: "Contratado", referencial: 300000, fechaBuenaPro: "2026-02-20" }],
    adjudicaciones: [], filas: [fila], contratosOcds: null, nombres: new Map([["20131378972", "CONSTRUCTORA S.A.C."]]),
  });
  assert.equal(k.items[0].porcentaje, 96.2);
  assert.deepEqual(k.items[0].contratos, ["2380174"]);
  assert.equal(k.firmados.length, 1);
  assert.equal(k.firmados[0].monto, 288450);
  assert.equal(k.firmados[0].adicional, 34707.53);
  assert.equal(k.firmados[0].vigenciaHasta, "2026-10-31");
  assert.equal(k.firmados[0].vigenciaOriginal, "2026-08-31");
  assert.equal(k.firmados[0].contratista?.nombre, "CONSTRUCTORA S.A.C.");
  const o = armarContrato({
    items: [{ id: "21224134", posicion: 1, descripcion: "DIESEL B5", montoPen: 450000, estado: "Contratado" }],
    conosce: [], filas: [], nombres: new Map(),
    adjudicaciones: [{ id: "1196572-20541165275", proveedorRuc: "20541165275", proveedor: "GRIFO SAQUENA S.A.C.", items: ["21224134"], montoPen: 449100, vigente: true }],
    contratosOcds: [{ id: "2390288", awardID: "1196572-20541165275", title: "002-2026-MDS", dateSigned: "2026-04-21T00:00:00-05:00", period: { startDate: "2026-04-22T00:00:00-05:00", endDate: "2027-03-31T00:00:00-05:00" }, value: { amount: 449100, currency: "PEN" } }],
  });
  assert.deepEqual([o.firmados[0].numero, o.firmados[0].firmado, o.firmados[0].vigenciaHasta, o.firmados[0].monto, o.firmados[0].fuente], ["002-2026-MDS", "2026-04-21", "2027-03-31", 449100, "ocds"]);
  // El contratista y los ítems, de la adjudicación de la que sale el contrato; los adicionales, sin dato (no 0).
  assert.deepEqual(o.firmados[0].contratista, { ruc: "20541165275", nombre: "GRIFO SAQUENA S.A.C." });
  assert.deepEqual(o.firmados[0].items, [1]);
  assert.equal(o.firmados[0].adicional, null);
});

test("buena pro: la de los agentes, si no la de CONOSCE, si no la de la adjudicación vigente", () => {
  assert.deepEqual(fechaBuenaProDe(null, [{ fechaBuenaPro: "2026-07-21" }], [{ fecha: "2026-07-20" }]), { fecha: "2026-07-21", fuente: "conosce" });
  assert.deepEqual(fechaBuenaProDe(null, [], [{ fecha: "2026-07-25", vigente: false }, { fecha: "2026-07-20" }]), { fecha: "2026-07-20", fuente: "ocds" });
  assert.deepEqual(fechaBuenaProDe("2026-07-19", [{ fechaBuenaPro: "2026-07-21" }], []), { fecha: "2026-07-19", fuente: "analisis" });
  assert.deepEqual(fechaBuenaProDe(null, [], []), { fecha: null, fuente: null });
});

test("CUI en el texto del proceso y adjudicaciones de otra convocatoria del mismo OCID", () => {
  assert.equal(cuiDeTexto("…DEPARTAMENTO AYACUCHO CON CUI Nº 2655159"), "2655159");
  assert.equal(cuiDeTexto(null, "proyecto de inversión, Código Único de Inversión Nº 2233862"), "2233862");
  assert.equal(cuiDeTexto("C¿digo ¿nico de Inversi¿n N° 2323700"), "2323700");
  assert.equal(cuiDeTexto("CUIDADO DEL PARQUE 2026, EXPEDIENTE 1234567"), null);
  assert.equal(cuiDeTexto("SNIP 123456"), null);
  assert.ok(deEstaConvocatoria("1224210-20615038998", "1224210"));
  assert.ok(!deEstaConvocatoria("1196572-20541165275", "1249080"));
  assert.ok(deEstaConvocatoria("2390288", "1249080"));
});
