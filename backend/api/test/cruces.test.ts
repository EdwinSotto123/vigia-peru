import test from "node:test";
import assert from "node:assert/strict";
import { aCruce, claseDeMotivo, motivoPublicable } from "../src/lib/cruces.js";
import { TAPA_NOMBRE, publicar } from "../src/lib/privacidad.js";

process.env.PRIVACIDAD_CLAVE = "clave-de-prueba-de-32-caracteres-o-mas";

const json = (v: unknown) => JSON.stringify(v);

// Datos sintéticos (DNI 00000001 / 00000789, nombres inventados).
const base = { ruc_empresa: "20999999991", ocid: null, fecha: "2025-03-01", monto: "1500.00", fuente: "x", fuente_url: null };

test("aporte de un socio: el DNI no sale y el nombre (orden SUNAT) lleva un apellido tapado", () => {
  const fila = { ...base, tipo: "aporte", severidad: "media", persona_doc: "00000001", persona_nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO",
    persona_rol: "REPRESENTANTE_LEGAL, SOCIO_ACCIONISTA_TITULAR", detalle: { partido: "PARTIDO INVENTADO", aportes: 2 } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.doesNotMatch(json(c), /00000001/);
  assert.equal(c.socios[0].rol, "representante legal, socio");
  assert.match(c.socios[0].nombre, new RegExp(TAPA_NOMBRE.replace(/[•]/g, "\\u2022")));
  assert.doesNotMatch(json(c), /HUAMANCHUMO/);
  assert.equal(c.detalle.partido, "PARTIDO INVENTADO");
  assert.equal(c.montoSoles, 1500);
});

test("visita previa: visitante y funcionario van bajo `visitas` y se tapan; el detalle no los repite", () => {
  const fila = { ...base, tipo: "visita_previa", severidad: "alta", persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "SOCIO_ACCIONISTA_TITULAR", ocid: "ocds-dgv273-seacev3-1",
    detalle: { entidad_visitada: "GOBIERNO REGIONAL X", misma_entidad: true, funcionario: "MAMANI APAZA EUSTAQUIO",
      cargo_funcionario: "GERENTE", motivo: "REUNION", dias_antes: 12 } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.socios.length, 0);
  assert.equal(c.visitas.length, 1);
  assert.equal(c.detalle.funcionario, undefined);
  assert.equal(c.detalle.dias_antes, 12);
  assert.doesNotMatch(json(c), /TICONA|APAZA|00000789/);
});

test("patrones de visitas: cada visita bajo `visitas`, sin el nombre de quien recibió ni el DNI del visitante", () => {
  const fila = { ...base, tipo: "visita_repetida", severidad: "alta", fuente: "visitas_entidades", fuente_url: "https://visitas.servicios.gob.pe/consultas",
    persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "GERENTE_GENERAL", ocid: "ocds-dgv273-seacev3-2",
    detalle: { entidad_visitada: "GOBIERNO REGIONAL X", misma_entidad: true, cargo_funcionario: "SUB GERENTE", area_funcionario: "LOGISTICA",
      decisor: true, dias: 3, visitas_n: 4, dias_antes: 9, fuente_visita: "portal_visitas_nacional",
      visitas: [{ fecha: "2025-08-01", hora: "09:10", minutos: 40 }, { fecha: "2025-08-12", hora: "16:05", minutos: 20 }, { fecha: "2025-09-02", hora: "10:00", minutos: 90 }] } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.socios.length, 0);
  assert.equal(c.visitas.length, 3);
  assert.equal(c.visitas[0].cargoFuncionario, "SUB GERENTE");
  assert.equal(c.visitas[0].decisor, true);
  assert.equal(c.detalle.visitas, undefined);
  assert.equal(c.fuenteUrl, "https://visitas.servicios.gob.pe/");
  assert.doesNotMatch(json(c), /TICONA|00000789/);
});

test("penalidad de empresa: sin personas, montos numéricos", () => {
  const c = aCruce({ ...base, tipo: "penalidad", severidad: "media", persona_doc: null, persona_nombre: null, persona_rol: null,
    detalle: { penalidades: 3 } });
  assert.deepEqual(c.socios, []);
  assert.equal(c.etiqueta, "Penalidades en contratos anteriores");
});

test("contexto del ganador: la razón social de un RUC 10 y los otros postores RUC 10 salen tapados", () => {
  const c = {
    ...aCruce({ ...base, tipo: "socio_comun", severidad: "alta", ruc_empresa: "10000000011", persona_doc: "00000001",
      persona_nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO", persona_rol: "TITULAR", detalle: { otros_postores: ["10000007891", "20999999992"] } }),
    proveedor: "QUISPEMAYTA HUAMANCHUMO ROBERTINO", buenaPro: { fecha: "2026-08-01", montoSoles: 1000 },
    otrosPostores: [{ ruc: "10000007891", nombre: "CCAHUANA TICONA FILOMENO" }, { ruc: "20999999992", nombre: "EMPRESA INVENTADA SAC" }],
  };
  const p = publicar({ cruces: [c] }).cruces[0];
  assert.doesNotMatch(json(p), /HUAMANCHUMO|TICONA|00000001|00000789|10000000011|10000007891/);
  assert.equal(p.otrosPostores[1].nombre, "EMPRESA INVENTADA SAC");
  assert.equal(p.buenaPro.montoSoles, 1000);
});

test("visita previa: el rol del visitante en la empresa sale legible", () => {
  const c = aCruce({ ...base, tipo: "visita_previa", severidad: "alta", persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "REPRESENTANTE_LEGAL, SOCIO_ACCIONISTA_TITULAR", detalle: { entidad_visitada: "X", dias_antes: 5 } });
  assert.equal(c.visitas[0].rol, "representante legal, socio");
});

test("socio con informe de control (migración 303): sin DNI, el socio tapado y el informe con su código y enlace intactos", () => {
  const url = "https://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=2018CPOL44600002&TIPOARCHIVO=RE";
  const fila = { ...base, tipo: "socio_con_informe_control", severidad: "alta", ocid: "ocds-dgv273-seacev3-3", persona_doc: "00000001",
    persona_nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO", persona_rol: "REPRESENTANTE_LEGAL, SOCIO_ACCIONISTA_TITULAR",
    fuente: "informes_control", fuente_url: url,
    detalle: { informe_codigo: "2018CPOL44600002", informe_numero: "011-2018-2-4460", informe_entidad: "MUNICIPALIDAD DISTRITAL INVENTADA",
      informe_entidad_ruc: "20999999993", emision: "2018-05-02", responsabilidades: ["administrativa_pas", "penal"], misma_entidad: true,
      url_resumen: url, n_informes: 2, n_personas: 1 } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.doesNotMatch(json(c), /00000001|HUAMANCHUMO/);
  assert.equal(c.socios[0].rol, "representante legal, socio");
  assert.equal(c.etiqueta, "Un socio o representante figura con presunta responsabilidad en un informe de control");
  // El código del informe trae 8 cifras pegadas a letras: es un código, no un DNI.
  assert.equal(c.detalle.informe_codigo, "2018CPOL44600002");
  assert.equal(c.detalle.informe_numero, "011-2018-2-4460");
  assert.equal(c.detalle.url_resumen, url);
  assert.equal(c.fuenteUrl, url);
});

test("observado por la Contraloría (migración 313): el informe, el tema y el perjuicio intactos; sin personas", () => {
  const url = "https://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=2022CPOL44600007&TIPOARCHIVO=RE";
  const fila = { ...base, tipo: "observado_por_contraloria", severidad: "alta", ocid: "ocds-dgv273-seacev3-712744", persona_doc: null,
    persona_nombre: null, persona_rol: null, fuente: "informes_control", fuente_url: url,
    detalle: { informe_codigo: "2022CPOL44600007", informe_numero: "007-2022-2-4460", informe_titulo: "ADQUISICIÓN DE MAQUINARIA INVENTADA",
      informe_entidad: "MUNICIPALIDAD DISTRITAL INVENTADA", informe_entidad_ruc: "20999999993", emision: "2022-11-30",
      responsabilidades: ["penal", "administrativa_entidad"], url_resumen: url, observacion_n: 2, tema: "seleccion_contratacion",
      // Un perjuicio de 8 cifras es un monto, no un DNI: llega como número y no se toca.
      perjuicio: 12345678.5, moneda: "PEN", via: "sigla", nomenclatura: "AS-SM-3-2021-MDI-1", cui: null,
      n_observaciones: 2, n_informes: 1, perjuicio_total: 12345678.5,
      otras: [{ codigo: "2022CPOL44600007", numero: "007-2022-2-4460", n: 3, tema: "pagos_adelantos", perjuicio: null, via: "sigla" }] } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.etiqueta, "La Contraloría observó este proceso en un informe de control");
  assert.equal(c.severidad, "alta");
  assert.equal(c.socios.length, 0);
  assert.equal(c.detalle.informe_codigo, "2022CPOL44600007");
  assert.equal(c.detalle.informe_numero, "007-2022-2-4460");
  assert.equal(c.detalle.perjuicio, 12345678.5);
  assert.equal(c.detalle.tema, "seleccion_contratacion");
  assert.equal(c.detalle.nomenclatura, "AS-SM-3-2021-MDI-1");
  assert.equal(c.detalle.otras[0].n, 3);
  assert.equal(c.fuenteUrl, url);
  // Atada por el CUI, la observación es de la obra del contrato, no del procedimiento.
  const porCui = aCruce({ ...fila, severidad: "media", detalle: { ...fila.detalle, via: "cui", cui: "2475416", nomenclatura: null } });
  assert.equal(porCui.etiqueta, "La Contraloría observó la obra de este contrato en un informe de control");
});

test("ganó tras una observación (migración 315): el informe y el proceso observado intactos; sin personas", () => {
  const url = "https://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=2022CPOL44600007&TIPOARCHIVO=RE";
  const fila = { ...base, tipo: "gano_tras_observacion", severidad: "alta", ocid: "ocds-dgv273-seacev3-912744", persona_doc: null,
    persona_nombre: null, persona_rol: null, fuente: "informes_control", fuente_url: url,
    detalle: { informe_codigo: "2022CPOL44600007", informe_numero: "007-2022-2-4460", emision: "2022-11-30", responsabilidades: ["penal"],
      url_resumen: url, observacion_n: 2, tema: "seleccion_contratacion", perjuicio: 250000, moneda: "PEN",
      proceso_observado: "ocds-dgv273-seacev3-712744", proceso_observado_nomenclatura: "AS-SM-3-2021-MDI-1", via_observado: "sigla",
      dias_despues: 412, n_procesos_observados: 2, consorcio: null } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.etiqueta, "La Contraloría ya había observado otro proceso suyo en esta entidad");
  assert.equal(c.detalle.proceso_observado, "ocds-dgv273-seacev3-712744");
  assert.equal(c.detalle.proceso_observado_nomenclatura, "AS-SM-3-2021-MDI-1");
  assert.equal(c.detalle.dias_despues, 412);
  assert.equal(c.detalle.informe_numero, "007-2022-2-4460");
  assert.equal(c.socios.length, 0);
});

// ── Indicadores en observación y motivo de la visita (migración 329) ──

test("el motivo de una visita: la categoría del registro sale tal cual; el texto libre, sólo su clase", () => {
  assert.equal(motivoPublicable("Reunión de trabajo."), "Reunión de trabajo");
  assert.equal(motivoPublicable("OTROS MOTIVOS - VISITA PERSONAL."), "OTROS MOTIVOS - VISITA PERSONAL");
  // Texto libre con el nombre de un tercero (inventado): no sale ni una palabra de él.
  const libre = "- ACONDICIONAMIENTO DE OFICINA INGRESA CON EL ING ROBERTINO QUISPEMAYTA";
  assert.equal(motivoPublicable(libre), "Provisión de un servicio, mantenimiento o entrega");
  assert.doesNotMatch(String(motivoPublicable(libre)), /QUISPEMAYTA|ROBERTINO/);
  assert.equal(motivoPublicable("NORMAL - INGRESA CON CCAHUANA TICONA"), "Otro motivo");
  assert.equal(motivoPublicable(""), null);
  assert.equal(motivoPublicable(null), null);
});

test("la clase del motivo: lo operativo antes que la reunión, y «personal» sólo es la visita personal", () => {
  assert.equal(claseDeMotivo("Reunión de trabajo."), "reunion");
  assert.equal(claseDeMotivo("Otros motivos - Visita personal."), "personal");
  assert.equal(claseDeMotivo("PERSONAL DEL CONCESIONARIO"), "operativa");
  assert.equal(claseDeMotivo("OTROS MOTIVOS-REUNION CON PERSONAL DE LIMPIEZA"), "reunion");
  assert.equal(claseDeMotivo("Gestión de intereses."), "gestion_intereses");
  assert.equal(claseDeMotivo("Otros motivos - Procedimiento de selección."), "seleccion");
  assert.equal(claseDeMotivo("Mantenimiento programado"), "operativa");
  assert.equal(claseDeMotivo("Otros motivos - Acto público / protocolar."), "protocolar");
  assert.equal(claseDeMotivo("NORMAL"), "otra");
});

test("visita previa: lleva la etapa del procedimiento y el motivo saneado", () => {
  const fila = { ...base, tipo: "visita_previa", severidad: "alta", persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "SOCIO_ACCIONISTA_TITULAR", ocid: "ocds-dgv273-seacev3-1",
    detalle: { entidad_visitada: "GOBIERNO REGIONAL X", misma_entidad: true, cargo_funcionario: "GERENTE", decisor: true,
      motivo: "NORMAL - AUTORIZA MAMANI APAZA EUSTAQUIO", clase_motivo: "otra", etapa: "evaluacion", dias_antes: 3 } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.visitas[0].etapa, "evaluacion");
  assert.equal(c.visitas[0].motivo, "Otro motivo");
  assert.doesNotMatch(json(c), /EUSTAQUIO|APAZA|00000789/);
  assert.equal(c.detalle.etapa, "evaluacion");
});

test("reunión durante la evaluación: las visitas van bajo `visitas` con cargo, área y la clase del motivo; sin DNI", () => {
  const fila = { ...base, tipo: "reunion_en_evaluacion", severidad: "media", persona_doc: "00000789", persona_nombre: "CCAHUANA TICONA FILOMENO",
    persona_rol: "REPRESENTANTE_LEGAL", ocid: "ocds-dgv273-seacev3-1",
    detalle: { entidad_visitada: "GOBIERNO REGIONAL X", misma_entidad: true, decisor: true, visitas_n: 2, oferta: "2025-02-20",
      buena_pro: "2025-03-04", dias_evaluacion: 12, ya_proveedor: false, en_observacion: true,
      visitas: [{ fecha: "2025-02-24", hora: "10:15", minutos: 40, cargo: "JEFE DE LOGISTICA", area: "OFICINA DE ABASTECIMIENTO", decisor: true, clase: "reunion" },
                { fecha: "2025-02-27", hora: "16:02", minutos: 25, cargo: "JEFE DE LOGISTICA", area: "OFICINA DE ABASTECIMIENTO", decisor: true, clase: "personal" }] } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.etiqueta, "Se reunió con quien decide las compras mientras se evaluaban las ofertas");
  assert.equal(c.visitas.length, 2);
  assert.equal(c.visitas[0].cargoFuncionario, "JEFE DE LOGISTICA");
  assert.equal(c.visitas[0].motivo, "Reunión de trabajo");
  assert.equal(c.visitas[1].motivo, "Visita personal");
  assert.equal(c.visitas[0].decisor, true);
  assert.equal(c.socios.length, 0);
  assert.equal(c.detalle.ya_proveedor, false);
  assert.equal(c.detalle.visitas, undefined);
  assert.doesNotMatch(json(c), /00000789/);
  assert.doesNotMatch(json(c), /TICONA/);
});

test("ofertas casi a la vez: la persona común va bajo `socios` tapada y el otro postor por su RUC", () => {
  const fila = { ...base, tipo: "ofertas_a_la_vez", severidad: "media", persona_doc: "00000001", persona_nombre: "QUISPEMAYTA HUAMANCHUMO ROBERTINO",
    persona_rol: "SOCIO_ACCIONISTA_TITULAR", ocid: "ocds-dgv273-seacev3-1", fuente: "seace_reporte_presentacion",
    detalle: { otros_postores: ["20999999992"], rol_en_otros: ["REPRESENTANTE_LEGAL"], minutos: 4.5, hora_ganador: "17:41", hora_otro: "17:46",
      item: 1, en_observacion: true } };
  const c = publicar({ cruces: [aCruce(fila)] }).cruces[0];
  assert.equal(c.etiqueta, "Presentó su oferta casi a la vez que un rival con el que comparte socio");
  assert.equal(c.socios.length, 1);
  assert.doesNotMatch(json(c), /00000001|HUAMANCHUMO/);
  assert.deepEqual(c.detalle.otros_postores, ["20999999992"]);
  assert.equal(c.detalle.minutos, 4.5);
});
