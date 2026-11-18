import test from "node:test";
import assert from "node:assert/strict";
import { enriquecerPostores, itemsDeDocumentos, otrosDe, perfilDeBases, type FichaPieza, type PostorDetalle } from "../src/lib/fichasPiezas.js";
import { publicar } from "../src/lib/privacidad.js";

// Forma real del proceso 1225937 (lubricantes): las bases piden diez productos y el contrato los trae con marca y precio.
const ficha = (lector: string, salida: Record<string, any>, tipo = lector): FichaPieza =>
  ({ lector, version: "m1", modelo: "glm", salida, tipo, documento: `Doc ${lector}`, url: `https://seace/${lector}`, leido: "2026-11-17" });
const enVigia = new Set(["https://seace/contrato"]);

test("ítems: cada renglón de las bases con lo que se firmó en el contrato, emparejados por número", () => {
  const bases = ficha("bases", { items: [
    { numero: "01", descripcion: "Aceite de motor 15W40", unidad: "galones", cantidad: 260, pagina: 26, cita: "Aceite de motor 15W40" },
    { numero: "02", descripcion: "Aceite de motor 25W50", unidad: "galones", cantidad: 202, pagina: 26, cita: "Aceite de motor 25W50" },
  ] }, "bases_integradas");
  const contrato = ficha("contrato", {
    numero: { valor: "068-2026" }, monto_total: { valor: 128556 }, aritmetica: { renglones: 2, renglones_ok: 2, suma_cuadra: true },
    items: [
      { numero: "2", descripcion: "ACEITE 25W50", marca: "MARCA B", cantidad: 202, precio_unitario: 258, precio_total: 52116, cuadra: true, pagina: 1, cita: "S/ 258.00" },
      { numero: "1", descripcion: "ACEITE 15W40", marca: "MARCA A", cantidad: 260, precio_unitario: 294, precio_total: 76440, cuadra: true, pagina: 1, cita: "S/ 294.00" },
    ] });
  const r = itemsDeDocumentos(bases, contrato, enVigia)!;
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0].numero, "1");
  assert.equal(r.filas[0].contratado?.marca, "MARCA A");
  assert.equal(r.filas[1].contratado?.precioUnitario, 258);
  assert.equal(r.contrato?.sumaCuadra, true);
  assert.equal(r.filas[1].contratado?.cita?.enVigia, true);
  assert.equal(r.filas[0].cita?.pagina, 26);
});

test("ítems: con un solo renglón en las bases y en el contrato no hay nada que desglosar", () => {
  assert.equal(itemsDeDocumentos(ficha("bases", { items: [{ numero: "1" }] }), ficha("contrato", { items: [{ numero: "1" }] }), enVigia), null);
});

test("postores: la evaluación del acta completa admisión, puntajes y bonificación; la oferta más baja que perdió se dice", () => {
  const base: PostorDetalle[] = [
    { ruc: "20000000001", razonSocial: "ACEITES DEL SUR S.A.", estado: "admitido", motivoEstado: null, montoOferta: 317873.1, puntaje: 100, esGanador: false, ordenPrelacion: 1, item: null, citas: [] },
    { ruc: "20000000002", razonSocial: "LUBRICANTES NORTE S.R.L.", estado: "admitido", motivoEstado: null, montoOferta: 360550, puntaje: 100.02, esGanador: true, ordenPrelacion: 2, item: null, citas: [] },
  ];
  const evaluacion = ficha("evaluacion", {
    factores: [{ factor: "A. Precio", puntaje_maximo: 40 }],
    postores: [
      { nombre: "ACEITES DEL SUR SOCIEDAD ANONIMA", ruc: null, monto_oferta: 317873.1, admitida: true, calificada: true, puntaje_precio: 40, puntaje_total: 100, bonificacion: null, puntaje_final: 100, orden_prelacion: 1, ganador: false, pagina: 3, cita: "S/ 317,873.10" },
      { nombre: "LUBRICANTES NORTE S.R.L.", ruc: "20000000002", monto_oferta: 360550, admitida: true, calificada: true, puntaje_precio: 35.26, puntaje_total: 95.26, bonificacion: 4.76, puntaje_final: 100.02, orden_prelacion: 2, ganador: true, pagina: 3, cita: "100.02 puntos" },
      { nombre: "PEREZ GOMEZ JUAN", ruc: null, monto_oferta: 468500, admitida: true, calificada: false, motivo_no_calificada: "No acreditó la experiencia", puntaje_final: null, ganador: false, pagina: 3, cita: "no acreditó" },
    ] }, "acta_buena_pro");
  const presentacion = ficha("reporte_presentacion", { items: [{ item: 1, ofertas: [{ ruc: "20000000002", nombre: "LUBRICANTES NORTE S.R.L.", fecha: "2026-07-02", hora: "21:38:38" }] }] });
  const { postores, evaluacion: ev } = enriquecerPostores(base, evaluacion, presentacion, [{ ruc: "10123456789", nombre: "PEREZ GOMEZ JUAN" }], enVigia);
  assert.equal(postores.length, 3);
  assert.equal(postores[1].bonificacion, 4.76);
  assert.equal(postores[1].horaOferta, "21:38:38");
  assert.equal(postores[0].puntajePrecio, 40);
  // El postor que sólo estaba en el acta entra con el RUC de su participante y su motivo.
  assert.equal(postores[2].ruc, "10123456789");
  assert.equal(postores[2].estado, "descalificado");
  assert.equal(postores[2].motivoEstado, "No acreditó la experiencia");
  const m = (ev as any).masBajaPerdio;
  assert.equal(m.masBaja.monto, 317873.1);
  assert.equal(m.ganador.bonificacion, 4.76);
  assert.ok(Math.abs(m.diferenciaPct - 13.425) < 0.01);
  // Publicado: la persona natural sale tapada y su RUC 10 nunca.
  const json = JSON.stringify(publicar({ postoresDetalle: postores, evaluacion: ev }));
  assert.ok(!json.includes("10123456789"));
  assert.ok(!json.includes("PEREZ GOMEZ JUAN"));
});

test("perfil: las bases dicen qué se le pide al contratista, con su página y su cita", () => {
  const p = perfilDeBases(ficha("bases", {
    resumen: "Lubricantes en diez ítems", sistema_contratacion: "SUMA ALZADA",
    cuantia: { estado: "reservada", valor: null, moneda: null, pagina: 20, cita: "NO DAR A CONOCER LA CUANTIA" },
    requisitos_calificacion: [{ tipo: "experiencia_postor", requisito: "Monto facturado", para: "general", cantidad: 500000, unidad: "soles", anios: 10, pagina: 31, cita: "S/ 500 000.00" }],
    exigencias_particulares: [{ exigencia: "Certificación API", pagina: 27, cita: "Certificación API" }],
    factores_evaluacion: [{ factor: "Oferta económica", puntaje_maximo: 40, pagina: 33, cita: "precio ofertado" }],
    marcas: [{ marca: "MARCA X", admite_equivalente: false, pagina: 5, cita: "marca X" }],
    adelantos: { directo_pct: null, materiales_pct: null, pagina: null, cita: "" },
  }, "bases_integradas"), enVigia)!;
  assert.equal(p.integradas, true);
  assert.equal(p.cuantia?.estado, "reservada");
  assert.equal(p.experiencia[0].cantidad, 500000);
  assert.equal(p.experiencia[0].cita?.pagina, 31);
  assert.equal(p.marcas[0].admiteEquivalente, false);
  assert.equal(p.adelantos, null);
});

test("puntaje de los demás factores: si precio + otros no da el total, se calcula del total", () => {
  assert.equal(otrosDe({ puntaje_precio: 35.26, puntaje_otros: 50, puntaje_total: 95.26 }), 60);
  assert.equal(otrosDe({ puntaje_precio: 40, puntaje_otros: 60, puntaje_total: 100 }), 60);
  assert.equal(otrosDe({ puntaje_precio: null, puntaje_otros: 12, puntaje_total: 80 }), 12);
});

test("postores: un RUC mal leído por el modelo no duplica al postor; vale el del registro (proceso 1224107)", () => {
  const base: PostorDetalle[] = [
    { ruc: "20608909958", razonSocial: "ENERSAFE S.A.C.", estado: "no_admitido", motivoEstado: null, montoOferta: null, puntaje: null,
      esGanador: false, ordenPrelacion: null, item: 1, citas: [] },
  ];
  // El reporte de evaluación del SEACE leído sin modelo (proceso_postor): el RUC bueno, el de CONOSCE y la SUNAT.
  const evaluacion: FichaPieza = { lector: "reporte_evaluacion", version: "p1", modelo: "plantilla", tipo: "reporte_evaluacion",
    documento: null, url: null, leido: null,
    salida: { postores: [
      { nombre: "ENERSAFE S.A.C.", ruc: "20609809958", item: 1, admitida: false, calificada: null, ganador: false },
      { nombre: "AREM PERU S.A.C.", ruc: "20532371342", item: 1, admitida: true, calificada: true, ganador: true },
    ] } };
  const participantes = [{ ruc: "20609809958", nombre: "ENERSAFE S.A.C." }, { ruc: "20532371342", nombre: "AREM PERU S.A.C." }];
  const { postores } = enriquecerPostores(base, evaluacion, undefined, participantes, new Set());
  assert.equal(postores.length, 2);
  const enersafe = postores.find((p) => p.razonSocial === "ENERSAFE S.A.C.")!;
  assert.equal(enersafe.ruc, "20609809958");
  assert.equal(enersafe.admitida, false);
  // Dos empresas distintas con RUC distinto siguen separadas.
  assert.ok(postores.some((p) => p.ruc === "20532371342" && p.esGanador));
});

test("postores: el puntaje TÉCNICO del reporte del SEACE no reemplaza al final del acta (1224107: 60 frente a 105)", () => {
  const base: PostorDetalle[] = [
    { ruc: "20532371342", razonSocial: "AREM PERU S.A.C.", estado: "ganador", motivoEstado: null, montoOferta: 770000, puntaje: 105,
      esGanador: true, ordenPrelacion: null, item: 1, citas: [] },
  ];
  const evaluacion: FichaPieza = { lector: "reporte_evaluacion", version: "p1", modelo: "plantilla", tipo: "reporte_evaluacion",
    documento: null, url: null, leido: null,
    salida: { postores: [{ nombre: "AREM PERU S.A.C.", ruc: "20532371342", item: 1, admitida: true, calificada: true, ganador: true,
                           puntaje_tecnico: 60, puntaje_total: null }] } };
  const [p] = enriquecerPostores(base, evaluacion, undefined, [], new Set()).postores;
  assert.equal(p.puntaje, 105);
  assert.equal(p.puntajeTotal, null);
  assert.equal(p.puntajeTecnico, 60);
  assert.equal(p.admitida, true);
});
