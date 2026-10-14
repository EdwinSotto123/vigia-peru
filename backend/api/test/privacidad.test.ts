import test from "node:test";
import assert from "node:assert/strict";
import {
  TAPA_DNI, TAPA_NOMBRE, TAPA_RUC10, esRef, limpiarTexto, publicar, publicarTraza, refDocumento, refRuc10, urlPublica,
} from "../src/lib/privacidad.js";

// La clave se lee la primera vez que se calcula una ref: basta fijarla antes de los tests.
process.env.PRIVACIDAD_CLAVE = "clave-de-prueba-de-32-caracteres-o-mas";

const json = (v: unknown) => JSON.stringify(v);

test("DNI en un campo de documento → ref opaca y estable, nunca dígitos", () => {
  const r = publicar({ ganador: { dni_persona_natural: "43960880" }, socios_dni: ["43960880", 71114275], otros: { numero_documento: "01234567" } });
  assert.ok(esRef(r.ganador.dni_persona_natural));
  assert.equal(r.socios_dni[0], r.ganador.dni_persona_natural); // la misma persona, la misma ref
  assert.ok(esRef(r.socios_dni[1] as unknown as string));
  assert.equal(r.otros.numero_documento, refDocumento("01234567"));
  assert.doesNotMatch(json(r), /\d{8}/);
});

test("un DNI guardado como número sin el cero de adelante da la misma ref que el texto", () => {
  const r = publicar({ a: { dni: 1234567 }, b: { dni: "01234567" } });
  assert.equal(r.a.dni, r.b.dni);
});

test("RUC 10 como campo → 10·ref· (la ref de su DNI); RUC 20 intacto", () => {
  const r = publicar({ proveedor_ruc: "10439608801", entidad_ruc: "20131378972", parties: [{ id: "PE-RUC-10439608801", name: "PEREZ QUISPE JUAN" }] });
  assert.equal(r.proveedor_ruc, refRuc10("10439608801"));
  assert.equal(r.proveedor_ruc, `10·${refDocumento("43960880")}`);
  assert.equal(r.entidad_ruc, "20131378972");
  assert.equal(r.parties[0].id, `PE-RUC-${refRuc10("10439608801")}`);
});

test("texto libre: DNI sueltos, con etiqueta, sello de firma, RUC 10, celulares y correos", () => {
  assert.equal(limpiarTexto("El firmante (DNI 43960880) y el CE: 12345678"), `El firmante (DNI ${TAPA_DNI}) y el CE: ${TAPA_DNI}`);
  assert.equal(limpiarTexto("visitante 43960880 ingresó"), `visitante ${TAPA_DNI} ingresó`);
  assert.equal(limpiarTexto("RUC 10439608801 y RUC 20131378972"), `RUC ${refRuc10("10439608801")} y RUC 20131378972`);
  assert.equal(limpiarTexto("llamar al 987654321 o 987 654 321"), "llamar al 9•••••••• o 9••••••••");
  assert.equal(limpiarTexto("escribir a maria.lopez@ejemplo.pe"), "escribir a m***@ejemplo.pe");
  assert.equal(limpiarTexto("máscara vieja 43****80"), `máscara vieja ${TAPA_DNI}`);
});

test("no toca montos, decimales ni hashes; sí un DNI pegado a letras", () => {
  const t = "S/ 12345678 · 12345678.50 · 0.12345678 · sha 3fa12345678b9c4 · año 2026";
  assert.equal(limpiarTexto(t), t);
  assert.equal(limpiarTexto("sello Elab. 43960880m · DNI43960880"), `sello Elab. ${TAPA_DNI}m · DNI${TAPA_DNI}`);
});

test("nombre con el nombre primero: se tapa el último apellido, también en la prosa y en el otro orden", () => {
  const r = publicar({
    document_analysis: { firmantes: [{ nombre_completo: "JOSÉ MANUEL SARA QUISPE", cargo: "Gerente" }] },
    dictamen_markdown: "Firmó Jose Manuel Sara Quispe; en el RNP figura SARA QUISPE JOSE MANUEL.",
  });
  assert.equal(r.document_analysis.firmantes[0].nombre_completo, `JOSÉ MANUEL SARA ${TAPA_NOMBRE}`);
  assert.equal(r.dictamen_markdown, `Firmó Jose Manuel Sara ${TAPA_NOMBRE}; en el RNP figura SARA ${TAPA_NOMBRE} JOSE MANUEL.`);
});

test("orden SUNAT (persona natural por su RUC 10): se tapa el segundo apellido, no el nombre de pila", () => {
  const r = publicar({ rucProveedor: "10439608801", proveedor: "CARPIO COBOS ABEL", evidencia: "Adjudicado a ABEL CARPIO COBOS sin otros postores" });
  assert.equal(r.proveedor, `CARPIO ${TAPA_NOMBRE} ABEL`);
  assert.equal(r.evidencia, `Adjudicado a ABEL CARPIO ${TAPA_NOMBRE} sin otros postores`);
});

test("palabras completas: un nombre no se tapa dentro de otro", () => {
  const r = publicar({ socios: [{ nombre: "ANA PEÑA" }], nota: "SUSANA PEÑAFIEL no es socia; ANA PEÑA sí" });
  assert.equal(r.nota, `SUSANA PEÑAFIEL no es socia; ANA ${TAPA_NOMBRE} sí`);
});

test("autoridades electas y empresas, completas", () => {
  const r = publicar({
    person_network_context: { autoridades_entidad: { alcalde_distrital_actual: { nombre: "QUISPE MAMANI ROSA" } } },
    document_analysis: { firmantes: [{ nombre_completo: "ROSA QUISPE MAMANI" }, { nombre_completo: "CONSTRUCTORA SANTA ROSA S.A.C." }] },
  });
  assert.equal(r.document_analysis.firmantes[0].nombre_completo, "ROSA QUISPE MAMANI");
  assert.equal(r.document_analysis.firmantes[1].nombre_completo, "CONSTRUCTORA SANTA ROSA S.A.C.");
  assert.equal(r.person_network_context.autoridades_entidad.alcalde_distrital_actual.nombre, "QUISPE MAMANI ROSA");
});

test("electo por su cargo (alcalde que firma); un gerente en vinculo_autoridades, no", () => {
  const r = publicar({
    document_analysis: { firmantes: [{ nombre_completo: "CARLOS ALBERTO RAMOS TELLO", cargo: "Alcalde provincial" }] },
    person_network: { vinculo_autoridades: [{ autoridad: "Luis Miguel Pardo Vega", cargo: "Gerente Municipal" }] },
    nota: "El alcalde Carlos Alberto Ramos Tello y el gerente Luis Miguel Pardo Vega fueron denunciados",
  });
  assert.equal(r.document_analysis.firmantes[0].nombre_completo, "CARLOS ALBERTO RAMOS TELLO");
  assert.equal(r.person_network.vinculo_autoridades[0].autoridad, `Luis Miguel Pardo ${TAPA_NOMBRE}`);
  assert.equal(r.nota, `El alcalde Carlos Alberto Ramos Tello y el gerente Luis Miguel Pardo ${TAPA_NOMBRE} fueron denunciados`);
});

test("haber postulado (candidatura del JNE) no vuelve pública a una persona", () => {
  const r = publicar({
    document_analysis: { firmantes: [{ nombre_completo: "MARCO ANTONIO SALAS RIVERA", cargo: "Jefe de la Oficina de Logística" }] },
    person_network_context: { datos_peru_por_persona: { "MARCO ANTONIO SALAS RIVERA": { jne: { candidaturas: [{ nombre: "SALAS RIVERA MARCO ANTONIO", cargo: "REGIDOR DISTRITAL" }] } } } },
  }) as any;
  assert.equal(r.document_analysis.firmantes[0].nombre_completo, `MARCO ANTONIO SALAS ${TAPA_NOMBRE}`);
});

test("familiar que deduce la IA: el nombre entero; si además es socio, sólo el apellido", () => {
  const solo = publicar({ person_network: { pareja_o_familia: [{ nombre: "MARIA LOPEZ DIAZ", relacion: "cónyuge" }] }, nota: "su esposa MARIA LOPEZ DIAZ" });
  assert.equal(solo.person_network.pareja_o_familia[0].nombre, TAPA_NOMBRE);
  assert.equal(solo.nota, `su esposa ${TAPA_NOMBRE}`);
  const socia = publicar({ person_network: { pareja_o_familia: [{ nombre: "MARIA LOPEZ DIAZ" }] }, rnp_proveedor: { socios: [{ nombre: "LOPEZ DIAZ MARIA" }] } });
  assert.equal(socia.person_network.pareja_o_familia[0].nombre, `MARIA LOPEZ ${TAPA_NOMBRE}`);
});

test("un familiar que además aparece en consultas (ONPE, datos por persona) sigue tapado entero", () => {
  const r = publicar({
    person_network: { pareja_o_familia: [{ nombre: "MARIA LOPEZ DIAZ", relacion: "cónyuge" }] },
    person_network_context: { datos_peru_por_persona: { "MARIA LOPEZ DIAZ": { onpe: { aportes: [{ nombre: "LOPEZ DIAZ MARIA" }] } } } },
  }) as any;
  assert.equal(r.person_network.pareja_o_familia[0].nombre, TAPA_NOMBRE);
  assert.deepEqual(Object.keys(r.person_network_context.datos_peru_por_persona), [TAPA_NOMBRE]);
});

test("traza pública: las claves de un resultado que son datos (DNI, RUC, nombre) también se tapan", () => {
  const t = publicarTraza({
    agent_trace: [{
      kind: "tool_result", name: "batch_person_lookup", agent: "x",
      result_preview: { datos_peru_por_persona: { "43960880": { n: 1 }, "JUAN PEREZ QUISPE": { n: 2 }, "OTRA PERSONA DESCONOCIDA": { n: 3 } }, oece_perfil: { "10439608801": { n: 4 } } },
    }],
  }, { socios: [{ nombre: "JUAN PEREZ QUISPE" }] });
  const rp = (t.agent_trace as any[])[0].result_preview;
  assert.doesNotMatch(json(rp), /43960880|10439608801|QUISPE|DESCONOCIDA/);
  assert.equal(Object.keys(rp.datos_peru_por_persona).length, 3);
});

test("nombres pegados a un DNI en la prosa se reconocen sin estar en ningún campo", () => {
  const r = publicar({ evidencia: "Socio SALAS RIVERA DIEGO (DNI 00000000) también firmó como SALAS RIVERA DIEGO" });
  assert.equal(r.evidencia, `Socio SALAS ${TAPA_NOMBRE} DIEGO (DNI ${TAPA_DNI}) también firmó como SALAS ${TAPA_NOMBRE} DIEGO`);
});

test("sello de firma digital: apellidos primero", () => {
  const r = publicar({ cita: "Firmado digitalmente por: CHAVEZ RIOS Maria Elena FIR 41234567 hard. Revisó CHAVEZ RIOS" });
  assert.match(r.cita, new RegExp(`CHAVEZ ${TAPA_NOMBRE} Maria Elena FIR ${TAPA_DNI}`));
});

test("un DNI conocido dentro de la prosa lleva la misma ref que en su campo", () => {
  const r = publicar({ socios: [{ nombre: "JUAN PEREZ QUISPE", dni: "43960880" }], nota: "el socio 43960880 firmó" });
  assert.equal(r.nota, `el socio ${r.socios[0].dni} firmó`);
});

test("títulos, iniciales con punto y nombres con coma", () => {
  const r = publicar({
    document_analysis: { comite_evaluacion: [{ nombre_completo: "Lic.Adm. MARIA R.MENDOZA TORRES" }, { nombre_completo: "C.P.C. JUAN ALBERTO FLORES PEÑA" }] },
    person_network_context: { rnp_proveedor: { socios: [{ nombre: "PEREZ QUISPE, JUAN" }] } },
  });
  assert.equal(r.document_analysis.comite_evaluacion[0].nombre_completo, `Lic.Adm. MARIA R.MENDOZA ${TAPA_NOMBRE}`);
  assert.equal(r.document_analysis.comite_evaluacion[1].nombre_completo, `C.P.C. JUAN ALBERTO FLORES ${TAPA_NOMBRE}`);
  assert.equal(r.person_network_context.rnp_proveedor.socios[0].nombre, `PEREZ ${TAPA_NOMBRE}, JUAN`);
});

test("la misma persona en otro orden en otro campo: se tapa el mismo apellido", () => {
  const r = publicar({
    document_analysis: { firmantes: [{ nombre_completo: "JUAN CARLOS PEREZ QUISPE" }] },
    person_network_context: { datos_peru_por_persona: { x: { visitas: { visitas: [{ visitante: "PEREZ JUAN CARLOS QUISPE" }] } } } },
  }) as any;
  assert.equal(r.person_network_context.datos_peru_por_persona.x.visitas.visitas[0].visitante, `PEREZ JUAN CARLOS ${TAPA_NOMBRE}`);
});

test("RUC 10 dentro de una clave (pares de postores) lleva la misma ref que el campo", () => {
  const r = publicar({ postores: [{ ruc: "10439608801" }], pares: { "20131378972↔10439608801": 2 } }) as any;
  assert.deepEqual(Object.keys(r.pares), [`20131378972↔${r.postores[0].ruc}`]);
});

test("claves con DNI o con nombre también se tapan, sin perder entradas", () => {
  const r = publicar({ person_network_context: { datos_peru_por_persona: { "43960880": { n: 1 }, "JUAN PEREZ QUISPE": { n: 2 }, "JUAN PEREZ QUINTO": { n: 3 } } } }) as any;
  const claves = Object.keys(r.person_network_context.datos_peru_por_persona);
  assert.equal(claves.length, 3);
  assert.ok(claves.includes(refDocumento("43960880")));
  assert.ok(claves.every((k) => !/QUISPE|QUINTO/.test(k)));
});

test("URLs: fuera las que llevan RUC 10, perfiles y agregadores con el nombre; quedan las oficiales", () => {
  const r = publicar({
    socios: [{ nombre: "JUAN PEREZ QUISPE" }],
    a: "https://apps.oece.gob.pe/perfilprov-ui/ficha/10439608801",
    b: "https://www.linkedin.com/in/juan-perez",
    c: "https://www.datosperu.org/empresa-juan-perez-quispe-123.php",
    d: "https://www.gob.pe/institucion/muni/normas-legales/123-designan-a-juan-perez-quispe",
    fuentes: ["https://www.datosperu.org/juan-perez-quispe.php", "https://www.elperuano.pe/noticia/1"],
  });
  assert.equal(r.a, null);
  assert.equal(r.b, null);
  assert.equal(r.c, null);
  assert.equal(r.d, "https://www.gob.pe/institucion/muni/normas-legales/123-designan-a-juan-perez-quispe");
  assert.deepEqual(r.fuentes, ["https://www.elperuano.pe/noticia/1"]);
  assert.equal(urlPublica("https://www.tottus.com.pe/arroz/p/12345678"), "https://www.tottus.com.pe/arroz/p/12345678");
});

test("una URL dentro de la prosa que no puede salir queda en la raíz del sitio", () => {
  assert.equal(limpiarTexto("ver https://postor.pe/empresa/pe-ruc-10439608801 y listo"), "ver https://postor.pe/ y listo");
});

test("identificadores técnicos de 8 dígitos (ítems OCDS) quedan", () => {
  const r = publicar({ tender: { items: [{ id: "12345678", classification: { id: "42131606" } }] }, query: "43960880" });
  assert.equal(r.tender.items[0].id, "12345678");
  assert.equal(r.tender.items[0].classification.id, "42131606");
  assert.equal(r.query, TAPA_DNI);
});

test("traza pública: sin entradas ni salidas de herramientas ni pensamientos; mensajes tapados", () => {
  const t = publicarTraza({
    codigo: "OECE-1",
    agent_trace: [
      { kind: "tool_call", name: "buscar_persona", agent: "person_network_agent", args: { query: "43960880" } },
      { kind: "tool_result", name: "buscar_persona", agent: "person_network_agent", result_preview: { visitas: [{ visitante: "PEREZ QUISPE JUAN" }], n: 1 } },
      { kind: "thought", agent: "person_network_agent", text: "JUAN PEREZ QUISPE parece socio" },
      { kind: "transfer", agent: "x", from: "a", to: "b", msg: "pasa a revisar a JUAN PEREZ QUISPE" },
      { kind: "metrics", agent: "x", cost_usd: 0.01, tokens_total: 10 },
    ],
    self_evals: { firmantes: { detalle: "JUAN PEREZ QUISPE (DNI 43960880)" } },
  }, { rnp_proveedor: { socios: [{ nombre: "PEREZ QUISPE JUAN" }] } });
  const ev = t.agent_trace as any[];
  assert.deepEqual(ev[0], { kind: "tool_call", name: "buscar_persona", agent: "person_network_agent", args: {} });
  // Las cifras quedan (y el largo de las listas, para los conteos); los nombres no.
  assert.deepEqual(ev[1], { kind: "tool_result", name: "buscar_persona", agent: "person_network_agent", result_preview: { visitas: [{}], n: 1 } });
  assert.deepEqual(ev[2], { kind: "thought", agent: "person_network_agent" });
  assert.equal(ev[3].msg, `pasa a revisar a JUAN PEREZ ${TAPA_NOMBRE}`);
  assert.equal(ev[4].cost_usd, 0.01);
  assert.doesNotMatch(json(t), /QUISPE|43960880/);
});

test("traza pública: lo que usa la pestaña (reglas, cifras, estado, ganador, error) sigue ahí", () => {
  const t = publicarTraza({
    agent_trace: [
      { kind: "tool_call", name: "check_unico_postor_rule", agent: "compliance_agent", args: { ocid: "ocds-1", regla: "unico_postor", queries: ["JUAN PEREZ QUISPE"] } },
      { kind: "tool_result", name: "check_unico_postor_rule", agent: "compliance_agent", result_preview: { regla: "unico_postor", triggered: true, evidencia: "JUAN PEREZ QUISPE (DNI 43960880)" } },
      { kind: "tool_result", name: "get_ganador", agent: "x", result_preview: { ganador: { razon_social: "CARPIO COBOS ABEL", ruc: "10439608801" } } },
      { kind: "tool_result", name: "fetch_ocds_record", agent: "x", result_preview: { cuantia: 120000, n_items: 3 } },
      { kind: "tool_result", name: "batch_person_lookup", agent: "x", result_preview: { resumen: [{ id: "func_1", nombre: "JUAN PEREZ QUISPE" }], error: "timeout de la SUNAT" } },
    ],
  }, { postores: [{ ruc: "10439608801", razon_social: "CARPIO COBOS ABEL" }] });
  const ev = t.agent_trace as any[];
  assert.deepEqual(ev[0].args, { ocid: "ocds-1", regla: "unico_postor" });
  assert.deepEqual(ev[1].result_preview, { regla: "unico_postor", triggered: true });
  assert.deepEqual(ev[2].result_preview, { ganador: { razon_social: `CARPIO ${TAPA_NOMBRE} ABEL` } });
  assert.deepEqual(ev[3].result_preview, { cuantia: 120000, n_items: 3 });
  assert.deepEqual(ev[4].result_preview, { resumen: [{ id: "func_1" }], error: "timeout de la SUNAT" });
});

test("las fechas de pg (Date) salen como fechas, no como objetos vacíos", () => {
  const f = new Date("2026-10-13T17:54:48Z");
  const entrada = { clasificadoAt: f, documentosEnVigia: { n: 2, expiraAt: f }, fechas: [f] };
  assert.equal(json(publicar(entrada)), json(entrada));
  assert.match(json(publicar(entrada)), /"clasificadoAt":"2026-10-13T17:54:48\.000Z"/);
});

test("no muta la entrada", () => {
  const entrada = { dni: "43960880", firmantes: [{ nombre_completo: "JUAN PEREZ QUISPE" }] };
  publicar(entrada);
  assert.equal(entrada.dni, "43960880");
  assert.equal(entrada.firmantes[0].nombre_completo, "JUAN PEREZ QUISPE");
});
