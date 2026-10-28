import test from "node:test";
import assert from "node:assert/strict";
import { arreglarUrl, busquedaOece, datasetVisitas, enlaceFuente, procesoOece } from "../src/lib/fuentes.js";

test("el proceso del OECE va siempre con el OCID completo (con el código solo no abre)", () => {
  assert.equal(procesoOece("84547"), "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-84547");
  assert.equal(procesoOece("OECE-84547"), "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-84547");
  assert.equal(procesoOece("ocds-dgv273-seacev3-84547"), "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-84547");
  assert.equal(procesoOece(1228396), "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-1228396");
  // El ocid que guarda Vigía no siempre es el código: 442241 es …-2018-1534-1.
  assert.equal(procesoOece("2018-1534-1"), "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-2018-1534-1");
  assert.equal(busquedaOece(442241), "https://contratacionesabiertas.oece.gob.pe/busqueda?search=442241");
});

test("las direcciones rotas que guardó la base se arreglan al leer", () => {
  assert.match(arreglarUrl("osce_sancionados", "https://www.gob.pe/tce")!, /dataset\/proveedores-sancionados-2025$/);
  assert.match(arreglarUrl("penalidades", "https://www.datosabiertos.gob.pe/dataset/penalidades-aplicadas-contratos-oece")!, /penalidades-de-contratistas/);
  assert.match(arreglarUrl("jne_autoridades", "https://www.datosabiertos.gob.pe/dataset/autoridades-vigentes-jne")!, /autoridades-vigentes-nivel-nacional/);
  assert.equal(arreglarUrl("x", "https://contratacionesabiertas.oece.gob.pe/proceso/84547"),
    "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-84547");
  assert.equal(arreglarUrl("x", "https://contratacionesabiertas.osce.gob.pe/proceso/ocds-dgv273-seacev3-1"),
    "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-1");
  assert.equal(arreglarUrl("oece_rnp", "https://apps.osce.gob.pe/perfilprov-ui/"), "https://apps.oece.gob.pe/perfilprov-ui/");
  // Portadas genéricas → la de la fuente.
  assert.equal(arreglarUrl("persona_entidad", "https://www.gob.pe/"), "https://conosce.oece.gob.pe/buscador/");
  assert.equal(arreglarUrl("conosce_ordenes", "https://www.gob.pe/oece"), "https://conosce.oece.gob.pe/buscador/");
  assert.equal(arreglarUrl("dji_contraloria", "https://www.datosabiertos.gob.pe/"), "https://appdji.contraloria.gob.pe/DJIC/");
  // Sin dirección: la portada; una que ya sirve no se toca.
  assert.equal(arreglarUrl("sunat", null), "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp");
  const infobras = "https://infobras.contraloria.gob.pe/InfobrasWeb/Mapa/Sumario?ObraId=510393";
  assert.equal(arreglarUrl("infobras", infobras), infobras);
  assert.equal(arreglarUrl("desconocida", null), null);
});

test("con lo que trae la fila, el enlace va al registro exacto", () => {
  assert.equal(enlaceFuente("conosce_adjudicaciones", "https://conosce.osce.gob.pe/buscador/", { ocid: "ocds-dgv273-seacev3-471992" }),
    "https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-471992");
  // Sin el ocid de Vigía, sólo el código de CONOSCE: la búsqueda del OECE (el OCID puede ser otro).
  assert.equal(enlaceFuente("conosce_adjudicaciones", null, { codigo: 471992 }),
    "https://contratacionesabiertas.oece.gob.pe/busqueda?search=471992");
  assert.equal(enlaceFuente("osce_sancionados", "https://www.gob.pe/tce", { ruc: "20545533406" }),
    "https://apps.oece.gob.pe/perfilprov-ui/ficha/20545533406");
  assert.equal(enlaceFuente("socio", null, {}), null);
  assert.equal(enlaceFuente("oece_rnp", "https://apps.osce.gob.pe/perfilprov-ui/", { detalle: { empresas: [{ ruc: "20605335871" }] } }),
    "https://apps.oece.gob.pe/perfilprov-ui/ficha/20605335871");
  assert.equal(enlaceFuente("dji_contraloria", "https://www.datosabiertos.gob.pe/", { entidadRuc: "20452393493" }),
    "https://appdji.contraloria.gob.pe/DJIC/ConsultaPublicaDJICRUC.aspx?ruc=20452393493");
  assert.equal(enlaceFuente("dji_contraloria", "https://appdji.contraloria.gob.pe/DJIC/",
    { entidadRuc: "20452393493", detalle: { parientes: [{ entidad_ruc: "20131368829" }] } }),
    "https://appdji.contraloria.gob.pe/DJIC/ConsultaPublicaDJICRUC.aspx?ruc=20131368829");
  assert.equal(enlaceFuente("pte_personal", "https://www.transparencia.gob.pe/", { idPte: 10202 }),
    "https://www.transparencia.gob.pe/personal/pte_transparencia_personal.aspx?id_entidad=10202&id_tema=32&ver=");
  assert.equal(enlaceFuente("visitas_entidades", "https://visitas.servicios.gob.pe/", { detalle: { visitas: [{ fecha: "2026-05-06" }] } }),
    "https://www.datosabiertos.gob.pe/dataset/reporte-de-registro-de-visitas-en-linea-mayo-2026");
});

test("un RUC 10 nunca va en un enlace (lleva el DNI)", () => {
  const u = enlaceFuente("osce_sancionados", "https://www.gob.pe/tce", { ruc: "10066665084" });
  assert.ok(u && !u.includes("10066665084"));
  const s = enlaceFuente("oece_rnp", null, { ruc: "10066665084", detalle: { empresas: [{ ruc: "10066665084" }] } });
  assert.ok(s && !s.includes("10066665084"));
});

test("el reporte de visitas de cada mes, con los nombres que usó la PNDA", () => {
  assert.equal(datasetVisitas("2025-09-14"), "https://www.datosabiertos.gob.pe/dataset/reporte-de-registro-de-visitas-septiembre");
  assert.equal(datasetVisitas("2026-02-01"), "https://www.datosabiertos.gob.pe/dataset/reporte-de-registro-de-visitas-febrero-2026");
  assert.equal(datasetVisitas("2026-03-31"), "https://www.datosabiertos.gob.pe/dataset/reporte-de-registro-de-visitas-en-linea-marzo-2026");
  // Después de mayo de 2026 la PNDA no publicó: el registro en línea.
  assert.equal(datasetVisitas("2026-08-10"), "https://visitas.servicios.gob.pe/");
  assert.equal(datasetVisitas(null), "https://visitas.servicios.gob.pe/");
});
