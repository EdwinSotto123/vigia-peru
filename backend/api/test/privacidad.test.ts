import test from "node:test";
import assert from "node:assert/strict";
import {
  TAPA_DNI, TAPA_NOMBRE, TAPA_RUC10, apellidoFuncionario, esRef, limpiarTexto, publicar, publicarTraza, refDocumento, refRuc10, urlPublica,
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

test("personas contratadas (migración 91): RUC 10 → ref, un apellido tapado en la fila, sus candidaturas y su orden; quien comparte sus dos apellidos, tapado igual", () => {
  const r = publicar({
    persona: { ruc: "10439608801", nombre: "VARGAS ROJAS LUIS FERNANDO" },
    entidades: [{
      ruc: "10439608801", nombre: "VARGAS ROJAS LUIS FERNANDO", entidadRuc: "20131373237",
      senalesDetalle: [
        { tipo: "candidato", detalle: { candidaturas: [{ nombre: "VARGAS ROJAS LUIS FERNANDO", cargo: "REGIDOR DISTRITAL", partido: "X" }] } },
        { tipo: "apellidos_autoridad", detalle: { autoridades: [{ nombre: "VARGAS ROJAS PEDRO", cargo: "ALCALDE DISTRITAL" }] } },
      ],
    }],
    data: [{ descripcion: "SERVICIO DE ASISTENCIA ADMINISTRATIVA DNI 43960880" }],
  });
  const t = json(r);
  assert.doesNotMatch(t, /10439608801|43960880/);
  assert.equal(r.persona.ruc, refRuc10("10439608801"));
  assert.doesNotMatch(t, /VARGAS ROJAS LUIS/);
  assert.match(r.persona.nombre, new RegExp(`VARGAS ${TAPA_NOMBRE} LUIS FERNANDO`));
  // La autoridad tiene sus MISMOS dos apellidos (es la señal): completa, destaparía el de la persona. Va tapada igual.
  assert.doesNotMatch(t, /ROJAS/);
  assert.match(t, new RegExp(`VARGAS ${TAPA_NOMBRE} PEDRO`));
});

test("autoridad por nombre (sin DNI): no destapa a la persona; confirmada por DNI, la autoridad sale completa", () => {
  const senal = (por: string) => [{ tipo: "autoridad_contratada", detalle: { por, autoridades: [{ nombre: "LLATANCE SILVA ALDO JARVIN", cargo: "REGIDOR PROVINCIAL" }] } }];
  const porNombre = publicar({ persona: { ruc: "10439608801", nombre: "LLATANCE SILVA ALDO JARVIN" }, senales: senal("nombre") });
  assert.doesNotMatch(json(porNombre), /SILVA/);
  assert.match(porNombre.persona.nombre, new RegExp(`LLATANCE ${TAPA_NOMBRE} ALDO JARVIN`));
  const porDni = publicar({ persona: { ruc: "10439608801", nombre: "LLATANCE SILVA ALDO JARVIN" }, senales: senal("dni") });
  assert.equal(porDni.persona.nombre, "LLATANCE SILVA ALDO JARVIN");
});

test("planilla (sin DNI): la autoridad, el directivo y la propia persona como autoridad, con el mismo apellido tapado", () => {
  const r = publicar({
    persona: {
      nombre: `QUISPE ${TAPA_NOMBRE} OVIDIO AMADIO`,
      senales: [
        { tipo: "apellidos_autoridad", detalle: { autoridades: [{ nombre: "QUISPE ROJAS LISSETT MONICA", cargo: "REGIDOR DISTRITAL", partido: "X" }] } },
        { tipo: "apellidos_directivo", detalle: { funcionarios_designados: [{ nombre: "QUISPE ROJAS MARCO ANTONIO", cargo: "GERENTE MUNICIPAL" }] } },
        { tipo: "es_autoridad", detalle: { autoridades: [{ nombre: "QUISPE ROJAS OVIDIO AMADIO", cargo: "REGIDOR DISTRITAL" }] } },
      ],
    },
    // La misma autoridad, fuera de la señal (la lista de autoridades de la entidad): en esta respuesta también va tapada.
    autoridades_entidad: { regidores: [{ nombre: "QUISPE ROJAS LISSETT MONICA" }] },
  });
  const t = json(r);
  assert.doesNotMatch(t, /ROJAS/);
  assert.match(t, new RegExp(`QUISPE ${TAPA_NOMBRE} LISSETT MONICA`));
  assert.match(t, new RegExp(`QUISPE ${TAPA_NOMBRE} MARCO ANTONIO`));
});

test("fuera de una señal de apellidos, la autoridad electa sigue completa", () => {
  const r = publicar({ autoridades_entidad: { alcalde: { nombre: "QUISPE ROJAS LISSETT MONICA" } }, senales: [{ tipo: "aporte", detalle: { partido: "X" } }] });
  assert.equal(r.autoridades_entidad.alcalde.nombre, "QUISPE ROJAS LISSETT MONICA");
});

test("orden de servicio: el locador (RUC 10) va con un apellido tapado; la empresa (RUC 20) de una orden de compra queda completa", () => {
  const servicio = publicar({ contratista: "CARPIO COBOS ABEL", rucContratista: "10439608801", descripcion: "Pago a ABEL CARPIO COBOS por asesoría" });
  assert.equal(servicio.contratista, `CARPIO ${TAPA_NOMBRE} ABEL`);
  assert.doesNotMatch(json(servicio), /10439608801/);
  assert.match(servicio.descripcion, new RegExp(`ABEL CARPIO ${TAPA_NOMBRE}`));
  const compra = publicar({ contratista: "CONSTRUCTORA SANTA ROSA S.A.C.", rucContratista: "20131378972" });
  assert.equal(compra.contratista, "CONSTRUCTORA SANTA ROSA S.A.C.");
  assert.equal(compra.rucContratista, "20131378972");
});

test("la Ñ escrita «¿» por el SEACE (NURE¿A) se repone y el apellido se tapa; el «¿» de una pregunta no se toca", () => {
  const r = publicar({ ganador: { ruc: "10439608801", razon_social: "LEON NURE¿A MANUEL ALEXANDER" }, nota: "¿QUÉ PASÓ? LEON NURE¿A MANUEL ALEXANDER" });
  assert.equal(r.ganador.razon_social, `LEON ${TAPA_NOMBRE} MANUEL ALEXANDER`);
  assert.match(r.nota, /^¿QUÉ PASÓ\?/);
  assert.doesNotMatch(json(r), /NURE/);
});

test("nepotismo: el primer apellido del funcionario sólo si el parentesco no puede destapar el del pariente", () => {
  // Seguros: no comparte con el pariente el apellido que a éste se le tapa (el segundo).
  assert.equal(apellidoFuncionario("HERMANO(A) DEL DECLARANTE", "rojas perez juan"), "rojas");
  assert.equal(apellidoFuncionario("CONYUGE", "rojas perez juan"), "rojas");
  assert.equal(apellidoFuncionario("CÓNYUGE", "rojas perez juan"), "rojas"); // con tilde
  assert.equal(apellidoFuncionario("TÍO (A)", "rojas perez juan"), "rojas");
  assert.equal(apellidoFuncionario("MADRE DEL DECLARANTE", "rojas perez juan"), "rojas");
  assert.equal(apellidoFuncionario("CUÑADO(A)", "rojas perez juan"), "rojas");
  // Con riesgo: el segundo apellido del pariente puede ser el primero del funcionario (la madre, una tía, una hija).
  for (const p of ["HIJO(A)", "SOBRINO(A)", "PRIMO(A)", "NIETO(A)", "OTRO", ""]) assert.equal(apellidoFuncionario(p, "rojas perez maria"), null, p);
  assert.equal(apellidoFuncionario(null, "rojas perez maria"), null);
});

test("autoridad electa marcada por la ruta (electo: true): su nombre completo en toda la respuesta; el resto, tapado", () => {
  const r = publicar({
    socios: [{ nombre: "PEREZ QUISPE JUAN", electo: true }, { nombre: "ROJAS PAZ ELENA" }],
    visitas: [{ visitante: "PEREZ QUISPE JUAN" }, { visitante: "TORRES LIMA ANA", electo: true }],
    nota: "Su representante legal, PEREZ QUISPE JUAN, y la socia ROJAS PAZ ELENA",
  });
  assert.equal(r.socios[0].nombre, "PEREZ QUISPE JUAN");
  assert.equal(r.socios[1].nombre, "ROJAS ••• ELENA");
  assert.equal(r.visitas[0].visitante, "PEREZ QUISPE JUAN");
  assert.equal(r.visitas[1].visitante, "TORRES LIMA ANA");
  assert.equal(r.nota, "Su representante legal, PEREZ QUISPE JUAN, y la socia ROJAS ••• ELENA");
  // Una marca falsa o con otro valor no destapa a nadie.
  const s = publicar({ socios: [{ nombre: "ROJAS PAZ ELENA", electo: "si" }] });
  assert.equal(s.socios[0].nombre, "ROJAS ••• ELENA");
});

test("lo que Claude leyó del acta y el contrato: postores, descartados y contratista persona natural, con un apellido tapado", () => {
  const out = publicar({
    postoresDetalle: [{ razonSocial: "QUISPE MAMANI JUAN CARLOS", ruc: null }, { razonSocial: "CONSORCIO VIAL SUR", ruc: null }],
    cruces: [{ detalle: { fuera: [{ nombre: "ROJAS PAZ MARIA ELENA", ruc: null, motivo: "No presentó la carta de ROJAS PAZ MARIA ELENA" }] } }],
    lecturaIA: { contrato: { contratista: { nombre: "HUAMAN TORRES PEDRO", ruc: "10456789012" } } },
  });
  const texto = JSON.stringify(out);
  assert.ok(!texto.includes("MAMANI"), texto);
  assert.ok(texto.includes("CONSORCIO VIAL SUR"));
  assert.ok(!texto.includes("PAZ MARIA") && !texto.includes("ROJAS PAZ MARIA ELENA"), texto);
  assert.ok(!texto.includes("TORRES") && !texto.includes("10456789012"), texto);
});

test("el expediente del proveedor: el RNP ya tapado no se vuelve a tapar; uno en claro se tapa", () => {
  const exp = publicar({
    expediente_proveedor: {
      ruc: "20109161609",
      rnp: [
        { rol: "REPRESENTANTE_LEGAL", nombre: `TRUJILLO ${TAPA_NOMBRE} RUBEN MARCOS` },
        { rol: "SOCIO_ACCIONISTA_TITULAR", nombre: "QUISPE MAMANI ROSA ELENA" },
      ],
    },
  });
  assert.equal(exp.expediente_proveedor.rnp[0].nombre, `TRUJILLO ${TAPA_NOMBRE} RUBEN MARCOS`);
  assert.equal(exp.expediente_proveedor.rnp[1].nombre, `QUISPE ${TAPA_NOMBRE} ROSA ELENA`);
  assert.equal(exp.expediente_proveedor.ruc, "20109161609");
});

test("el expediente de un consorcio: el RNP de cada integrante pasa tapado", () => {
  const exp = publicar({
    expediente_proveedor: {
      ruc: "1816604", consorcio: true,
      integrantes: [{ ruc: "20568595948", rnp: [{ rol: "SOCIO_ACCIONISTA_TITULAR", nombre: "QUISPE MAMANI ROSA ELENA" }] }],
    },
  });
  assert.equal(exp.expediente_proveedor.integrantes[0].rnp[0].nombre, `QUISPE ${TAPA_NOMBRE} ROSA ELENA`);
});

// Auditoría 2026-11-13: papeles que el agente guarda y la API no conocía, y DNI pegados por una coma.
test("un postor persona natural sin RUC en el acta sale con un apellido tapado", () => {
  const r = publicar({
    lecturas_documentos: { acta: { salida: { postores: [
      { nombre: "QUISPE MAMANI JUAN CARLOS", ruc: null, motivo_fuera: "QUISPE MAMANI JUAN CARLOS no presentó la garantía" },
      { nombre: "CONSTRUCTORA LOS ANDES S.A.C.", ruc: "20131378972", motivo_fuera: null },
    ] } } },
  }) as any;
  const [persona, empresa] = r.lecturas_documentos.acta.salida.postores;
  assert.ok(!JSON.stringify(persona).includes("MAMANI"), JSON.stringify(persona));
  assert.ok(persona.nombre.includes("QUISPE") && persona.nombre.includes("JUAN"));
  assert.equal(empresa.nombre, "CONSTRUCTORA LOS ANDES S.A.C.");
});

test("el comité permanente de adquisiciones se tapa igual que los funcionarios designados", () => {
  const r = publicar({ entity_personnel: { comite_permanente_adquisiciones: [{ nombre_completo: "Pedro Luis Ccori Apaza", cargo: "Presidente del comité" }] } }) as any;
  assert.ok(!JSON.stringify(r).includes("Apaza"), JSON.stringify(r));
});

test("dos DNI pegados por una coma se tapan los dos; una cifra con decimales no", () => {
  const r = publicar({ a: "Socios con documentos 43960880,41234567 y 40111222, 40333444.", b: "Monto 12,34567890 y S/ 12345678.50 y 1,234,567" }) as any;
  for (const d of ["43960880", "41234567", "40111222", "40333444"]) assert.ok(!r.a.includes(d), r.a);
  assert.equal(r.b, "Monto 12,34567890 y S/ 12345678.50 y 1,234,567");
});

test("un nombre acortado en un texto libre no destapa el apellido escondido", () => {
  // Auditoría 2026-11-13: la cita del requerimiento («contratar al Sr. Juan Perez Quispe») salía entera junto a «PEREZ ••• JUAN CARLOS».
  const s = json(publicar({
    menor: { proveedor: "PEREZ QUISPE JUAN CARLOS", proveedorRuc: "10439608801" },
    senales: [{ tipo: "tdr_proveedor_nombrado", detalle: { cita: "Se requiere contratar al Sr. Juan Perez Quispe por tres meses; el señor Pérez Quispe ya prestó el servicio. Carlos Perez Quispe." } }],
  }));
  assert.ok(!/quispe/i.test(s), s);
  assert.ok(s.includes("por tres meses"));
});

test("una sucesión registrada como socio no publica sus nombres", async () => {
  const { nombrePublicable } = await import("../src/lib/cruces.js");
  assert.equal(nombrePublicable("SUCESION PEREZ GOMEZ JUAN REPRESENTADA POR MARIA LOPEZ DIAZ VIUDA DE PEREZ"), "Sucesión (nombre reservado)");
  assert.equal(nombrePublicable("ROJAS QUISPE ELENA"), "ROJAS QUISPE ELENA");
});

test("políticos de un partido (migración 299): quien no ganó y el aportante, con un apellido tapado aunque hayan postulado a alcalde; quien ganó, completo; la empresa que aporta, intacta; ningún documento", async () => {
  const { filaPolitico } = await import("../src/routes/partidosPoliticos.js");
  const base = {
    publico: false, ruc: null, gano: false, candidato: true, aportante: false, nCandidaturas: 1, elecciones: [2022], cargo: "ALCALDE DISTRITAL",
    lugar: "QUELLOUNO, LA CONVENCION, CUSCO", aportesN: 0, aportesMonto: 0, aporteDesde: null, aporteHasta: null, conDocumento: true, personaCodigo: null,
    empN: 1, empMonto: 1000, empInhab: 0, empGobN: 0, empGobMonto: 0, ordEntidades: 0, ordMonto: 0, ordGobEntidades: 0, ordGobMonto: 0, familiaN: 0,
    sancionesN: 0, senales: ["empresas_estado", "no_es_una_senal"], sev: 2,
  };
  const filas = [
    { ...base, codigo: "a1b2c3d4e5f6", tipo: "persona" as const, nombre: "ROJAS PAZ ELENA" },
    { ...base, codigo: "0123456789ab", tipo: "persona" as const, nombre: "PEREZ QUISPE JUAN", publico: true, gano: true },
    { ...base, codigo: "b1b2c3d4e5f6", tipo: "persona" as const, nombre: "TORRES LIMA ANA", candidato: false, aportante: true, cargo: null, lugar: null },
    { ...base, codigo: "c1b2c3d4e5f6", tipo: "empresa" as const, nombre: "RAY OF LIGHT", ruc: "20479548782", candidato: false, aportante: true, cargo: null, lugar: null },
  ].map(filaPolitico);
  // La fila no lleva el cargo junto al nombre (publicar() lo leería como el de una autoridad y dejaría el nombre completo).
  assert.ok(!("cargo" in filas[0]) && !("rol" in filas[0]) && !("doc" in filas[0]) && !("dni" in filas[0]));
  const r = publicar({ total: 4, politicos: filas });
  assert.equal(r.politicos[0].nombre, `ROJAS ${TAPA_NOMBRE} ELENA`);
  assert.equal(r.politicos[0].ultimaCandidatura?.puesto, "ALCALDE DISTRITAL");
  assert.equal(r.politicos[1].nombre, "PEREZ QUISPE JUAN");
  assert.equal(r.politicos[2].nombre, `TORRES ${TAPA_NOMBRE} ANA`);
  assert.equal(r.politicos[3].nombre, null);
  assert.equal(r.politicos[3].razonSocial, "RAY OF LIGHT");
  assert.equal(r.politicos[3].ruc, "20479548782");
  // El código de la ficha queda como está (también uno hecho sólo de cifras) y una señal desconocida no sale.
  assert.equal(r.politicos[1].codigo, "0123456789ab");
  assert.deepEqual(r.politicos[0].senales, [{ tipo: "empresas_estado", severidad: "media" }]);
  const s = json(r);
  assert.ok(!/ROJAS PAZ|TORRES LIMA/.test(s), s);
  assert.doesNotMatch(s, /(?<!\d)\d{8}(?!\d)/);
});

test("detalle de un político: su nombre en un texto libre se tapa (va en `extra`); el del que ganó, no; del funcionario que lo declaró, sólo el primer apellido si no destapa nada", () => {
  const detalle = {
    procesos: { total: 1, filas: [{ codigo: "987654", descripcion: "SERVICIO DE ASESORIA A CARGO DE ROJAS PAZ ELENA", entidad: "MUNICIPALIDAD DISTRITAL DE QUELLOUNO" }] },
    familia: [{ entidad: "MINISTERIO PUBLICO", puesto: "FISCAL", parentesco: "HERMANO(A) DEL DECLARANTE", funcionarioApellido: apellidoFuncionario("HERMANO(A) DEL DECLARANTE", "ROJAS PAZ LUIS") }],
    sanciones: [{ tipo: "temporal", resolucion: "1234-2021-TCE-S1", infraccion: "Presentar información inexacta" }],
  };
  const tapado = publicar(detalle, { extra: { politicos: [{ nombre: "ROJAS PAZ ELENA" }] } });
  assert.equal(tapado.procesos.filas[0].descripcion, `SERVICIO DE ASESORIA A CARGO DE ROJAS ${TAPA_NOMBRE} ELENA`);
  assert.equal(tapado.familia[0].funcionarioApellido, "ROJAS");
  assert.ok(!("politicos" in tapado));
  const electo = publicar(detalle, { extra: { politicos: [{ nombre: "ROJAS PAZ ELENA", electo: true }] } });
  assert.equal(electo.procesos.filas[0].descripcion, "SERVICIO DE ASESORIA A CARGO DE ROJAS PAZ ELENA");
  // Con hijo(a), el primer apellido del funcionario ES el tapado de la persona: no sale.
  assert.equal(apellidoFuncionario("HIJO(A)", "PAZ ROJAS LUIS"), null);
});

test("apellidos compuestos: las partículas van con su apellido y se tapa el SEGUNDO apellido entero (apellidos y nombres)", () => {
  const casos: [string, string][] = [
    ["DE LA CRUZ ESPINOZA ROSA", `DE LA CRUZ ${TAPA_NOMBRE} ROSA`],
    ["QUISPE DE LA TORRE JUAN", `QUISPE ${TAPA_NOMBRE} JUAN`],
    ["DEL AGUILA RIOS ANA MARIA", `DEL AGUILA ${TAPA_NOMBRE} ANA MARIA`],
    ["ROJAS PEREZ ELENA", `ROJAS ${TAPA_NOMBRE} ELENA`],
    ["DE LA CRUZ DE LOS SANTOS LUIS", `DE LA CRUZ ${TAPA_NOMBRE} LUIS`],
    ["SAN MARTIN VDA DE QUISPE NELLY", `SAN MARTIN ${TAPA_NOMBRE} NELLY`],
    ["PEREZ VDA DE QUISPE MARIA", `PEREZ ${TAPA_NOMBRE} MARIA`],
    ["ORTEGA Y GASSET MAMANI JOSE", `ORTEGA Y GASSET ${TAPA_NOMBRE} JOSE`],
    // Un solo apellido compuesto y un nombre: nunca queda una partícula tapada y el resto a la vista.
    ["DEL AGUILA ANA", `DEL AGUILA ${TAPA_NOMBRE}`],
  ];
  for (const [nombre, tapado] of casos) {
    // En la lista de políticos (orden fijo del JNE y la ONPE) y en una lista general en orden SUNAT (socios del RNP).
    assert.equal(publicar({ politicos: [{ nombre }] }).politicos[0].nombre, tapado, nombre);
    assert.equal(publicar({ socios: [{ nombre }] }).socios[0].nombre, tapado, nombre);
    // Y con su RUC 10 al lado (un proveedor persona natural).
    assert.equal(publicar({ ganador: { ruc: "10439608801", nombre } }).ganador.nombre, tapado, nombre);
  }
  // El orden del padrón no se adivina: un apellido que también es nombre de pila no deja los dos apellidos a la vista.
  assert.equal(publicar({ politicos: [{ nombre: "SANTOS QUISPE YHON" }] }).politicos[0].nombre, `SANTOS ${TAPA_NOMBRE} YHON`);
});

test("apellidos compuestos con el nombre primero y en texto libre: tampoco queda el materno a la vista", () => {
  const r = publicar({
    firmantes: [{ nombre_completo: "JUAN CARLOS PEREZ DE LA CRUZ" }, { nombre_completo: "MARIA DEL CARMEN QUISPE ROJAS" }, { nombre_completo: "LUIS DE LA CRUZ ESPINOZA" }],
    politicos: [{ nombre: "DE LA CRUZ ESPINOZA ROSA" }],
    nota: "Firmó la señora Rosa De La Cruz Espinoza; antes, DE LA CRUZ ESPINOZA ROSA.",
  });
  assert.equal(r.firmantes[0].nombre_completo, `JUAN CARLOS PEREZ ${TAPA_NOMBRE}`);
  assert.equal(r.firmantes[1].nombre_completo, `MARIA DEL CARMEN QUISPE ${TAPA_NOMBRE}`);
  assert.equal(r.firmantes[2].nombre_completo, `LUIS DE LA CRUZ ${TAPA_NOMBRE}`);
  assert.equal(r.nota, `Firmó la señora Rosa De La Cruz ${TAPA_NOMBRE}; antes, DE LA CRUZ ${TAPA_NOMBRE} ROSA.`);
  assert.ok(!/espinoza/i.test(json(r)));
});

test("taparNombrePropio (órdenes de una persona): el segundo apellido entero, con partículas, en los dos órdenes", async () => {
  const { taparNombrePropio } = await import("../src/routes/personas.js");
  const t = (nombre: string) => taparNombrePropio(`SERVICIO DE ${nombre} PARA LA OFICINA`, nombre);
  assert.equal(t("DE LA CRUZ ESPINOZA ROSA"), `SERVICIO DE DE LA CRUZ ${TAPA_NOMBRE} ROSA PARA LA OFICINA`);
  assert.equal(t("QUISPE DE LA TORRE JUAN"), `SERVICIO DE QUISPE ${TAPA_NOMBRE} JUAN PARA LA OFICINA`);
  assert.equal(t("DEL AGUILA RIOS ANA MARIA"), `SERVICIO DE DEL AGUILA ${TAPA_NOMBRE} ANA MARIA PARA LA OFICINA`);
  assert.equal(t("ROJAS PEREZ ELENA"), `SERVICIO DE ROJAS ${TAPA_NOMBRE} ELENA PARA LA OFICINA`);
  assert.equal(taparNombrePropio("contratar a JUAN QUISPE DE LA TORRE por tres meses", "QUISPE DE LA TORRE JUAN"), `contratar a JUAN QUISPE ${TAPA_NOMBRE} por tres meses`);
});

test("DJI del político (migración 301): sus familiares sin nombre ni documento, sólo el parentesco y lo que obtuvieron; los informes de control con su número y la responsabilidad presunta", async () => {
  const { filaPolitico } = await import("../src/routes/partidosPoliticos.js");
  const entrada = {
    codigo: "a1b2c3d4e5f6", tipo: "persona" as const, nombre: "PEREZ QUISPE JUAN", publico: true, ruc: null, gano: true, candidato: true, aportante: false,
    nCandidaturas: 1, elecciones: [2022], cargo: "ALCALDE DISTRITAL", lugar: "QUELLOUNO, LA CONVENCION, CUSCO", aportesN: 0, aportesMonto: 0,
    aporteDesde: null, aporteHasta: null, conDocumento: true, personaCodigo: null, empN: 0, empMonto: 0, empInhab: 0, empGobN: 0, empGobMonto: 0,
    ordEntidades: 0, ordMonto: 0, ordGobEntidades: 0, ordGobMonto: 0, familiaN: 0, sancionesN: 0,
    senales: ["familia_su_entidad", "control_penal", "familia_estado", "dji_inventada"], sev: 3,
    djiEstado: "leida", famN: 7, famOrdenesN: 2, famOrdenesMonto: 48000, famEmpresasN: 1, famSuEntidadN: 1, famSuEntidadMonto: 24000,
    famPartidoN: 1, famPartidoMonto: 24000, controlN: 2, controlPenal: 1,
  };
  const fila = filaPolitico(entrada);
  assert.equal(fila.dji, "leida");
  assert.deepEqual(fila.senales.map((s) => [s.tipo, s.severidad]), [["familia_su_entidad", "alta"], ["control_penal", "alta"], ["familia_estado", "baja"]]);
  assert.deepEqual(fila.cruces.familiares.suEntidad, { n: 1, monto: null });
  assert.deepEqual(fila.cruces.control, { informes: 2, penal: 1 });
  // Un estado que no es de la lista no sale; sin la migración 301, ceros y sin estado.
  assert.equal(filaPolitico({ ...entrada, djiEstado: "otra" }).dji, null);
  const sin301 = filaPolitico({ ...entrada, djiEstado: undefined, famN: undefined, famSuEntidadN: undefined, controlN: undefined });
  assert.equal(sin301.dji, null);
  assert.equal(sin301.cruces.familiares.declarados, 0);

  // Lo que la lista dice de los familiares de un electo: cuántos, nunca montos (restados del detalle darían el de uno solo).
  assert.deepEqual(fila.cruces.familiares, {
    declarados: 7, conOrdenes: 2, ordenesMonto: null, conEmpresas: 1, suEntidad: { n: 1, monto: null }, partido: { n: 1, monto: null },
  });
  // De un político tapado, los montos quedan.
  assert.equal(filaPolitico({ ...entrada, publico: false }).cruces.familiares.suEntidad.monto, 24000);

  // Los informes de control: su número (no es un DNI) y la responsabilidad, presunta, intactos.
  const informes = publicar({
    informes: [{ informe: "2023CSI038600012", numero: "015-2023-2-0386-SCE", titulo: "Servicio de control específico a la Municipalidad Distrital de Quellouno",
                 entidad: "MUNICIPALIDAD DISTRITAL DE QUELLOUNO", fecha: "2023-08-14", responsabilidades: ["penal", "administrativa_pas"] }],
  }, { extra: { politicos: [{ nombre: "PEREZ QUISPE JUAN", electo: true }] } });
  assert.equal(informes.informes[0].numero, "015-2023-2-0386-SCE");
  assert.deepEqual(informes.informes[0].responsabilidades, ["penal", "administrativa_pas"]);
});

test("parentescos de la DJI de un electo: sólo los que no destapan el apellido tapado del familiar salen con su etiqueta; lo desconocido, no", async () => {
  const { parentescoPublicable } = await import("../src/lib/privacidad.js");
  for (const p of ["HERMANO(A) DEL DECLARANTE", "HIJO(A)", "SOBRINO(A)", "PRIMO(A)", "NIETO(A)", "(HIJO)", "", null, "PALOMINO HERMANO", "A MI HIJO GUTARRA", "CONYUGUE: CORTEZ"]) {
    assert.equal(parentescoPublicable(p), null, String(p));
  }
  assert.equal(parentescoPublicable("CONYUGE"), "Cónyuge");
  assert.equal(parentescoPublicable("CÓNYUGE"), "Cónyuge");
  assert.equal(parentescoPublicable("TÍO (A)"), "Tío o tía");
  assert.equal(parentescoPublicable("CUÑADO(A)"), "Cuñado o cuñada");
  assert.equal(parentescoPublicable("MADRE DEL DECLARANTE"), "Madre");
  assert.equal(parentescoPublicable("HERMANO(A) DEL CONVIVIENTE"), "Familiar de su conviviente");
  assert.equal(parentescoPublicable("PADRE DEL EXCÓNYUGE"), "Familiar de su excónyuge");
});

test("familiares de un electo (nombre completo): un hermano y un sobrino no exponen parentesco, monto, empresa ni años; un cónyuge sí; con dos que destapan, sólo el total", async () => {
  const { reservarFamiliares } = await import("../src/routes/partidosPoliticos.js");
  const fila = (x: Record<string, unknown>) => ({
    pariente: 1, parentesco: null, grado: null, tipo: "orden", entidadRuc: null, entidad: null, empresaRuc: null, empresa: null, rol: null,
    ordenes: null, procesos: null, monto: null, desde: null, hasta: null, suEntidad: false, suEntidadProcesos: null, suEntidadMonto: null,
    nepotismo: false, delPartido: false, ...x,
  }) as Parameters<typeof reservarFamiliares>[0][number];
  const hermano = fila({ pariente: 1, parentesco: "HERMANO(A) DEL DECLARANTE", grado: "hermano", entidadRuc: "20159377777", entidad: "MUNICIPALIDAD DISTRITAL DE QUELLOUNO",
                         ordenes: 4, monto: 26417, desde: 2023, hasta: 2024, suEntidad: true, nepotismo: true, delPartido: true });
  const sobrino = fila({ pariente: 2, parentesco: "SOBRINO(A)", grado: "otro", tipo: "empresa", empresaRuc: "20600000001", empresa: "CONSTRUCTORA ANDINA DEL SUR E.I.R.L.",
                         rol: "SOCIO_ACCIONISTA_TITULAR", procesos: 3, monto: 1500003 });
  const conyuge = fila({ pariente: 3, parentesco: "CONYUGE", grado: "conyuge", entidadRuc: "20131370645", entidad: "MINISTERIO PUBLICO", ordenes: 2, monto: 9013, desde: 2024, hasta: 2024 });

  const r = publicar(reservarFamiliares([hermano, sobrino, conyuge], true));
  const s = json(r);
  // El cónyuge, entero: parentesco, entidad y monto.
  assert.equal(r.lista.length, 1);
  assert.equal(r.lista[0].parentesco, "Cónyuge");
  assert.equal(r.lista[0].ordenes[0].monto, 9013);
  // El hermano y el sobrino, sólo contados: ni el parentesco, ni el monto, ni la empresa (nombre ni RUC), ni los años.
  assert.doesNotMatch(s, /HERMANO|SOBRINO|hermano|sobrino/);
  assert.doesNotMatch(s, /26417|1500003|CONSTRUCTORA|20600000001|2023/);
  assert.equal(r.conAlgo, 3);
  assert.deepEqual(r.reservados, { n: 2, suEntidad: { n: 1, monto: null }, partido: { n: 1 }, ordenes: { n: 1, monto: null }, empresas: { n: 1 } });

  // Dos que destapan en el mismo cruce: sólo la suma, nunca lo de cada uno.
  const primo = fila({ pariente: 4, parentesco: "PRIMO(A)", grado: "otro", entidadRuc: "20159377777", entidad: "MUNICIPALIDAD DISTRITAL DE QUELLOUNO",
                       ordenes: 2, monto: 12011, desde: 2024, hasta: 2025, suEntidad: true, nepotismo: true });
  const dos = publicar(reservarFamiliares([hermano, primo], true));
  assert.deepEqual(dos.lista, []);
  assert.deepEqual(dos.reservados, { n: 2, suEntidad: { n: 2, monto: 38428 }, partido: { n: 1 }, ordenes: { n: 2, monto: 38428 }, empresas: { n: 0 } });
  assert.doesNotMatch(json(dos), /26417|12011|PRIMO|HERMANO/);

  // De un político tapado, todos de a uno con la etiqueta de su parentesco; el texto suelto de la DJI, nunca.
  const tapado = reservarFamiliares([hermano, fila({ ...conyuge, pariente: 5, parentesco: "PALOMINO HERMANO" })], false);
  assert.equal(tapado.reservados, null);
  assert.deepEqual(tapado.lista.map((x) => x.parentesco), ["Hermano o hermana", "Otro familiar"]);
  assert.doesNotMatch(json(tapado), /PALOMINO/);
});

test("nepotismo de una entidad: el caso de una autoridad electa con un parentesco que destapa sale reservado; con cónyuge, visible; un gerente con un hermano, como siempre", async () => {
  const { nepotismoPublico } = await import("../src/lib/nepotismo.js");
  const fila = (x: Record<string, unknown>) => ({
    declarante: null, cargo: null, declaranteFicha: null, grado: "otro", parentesco: null, electo: false, proveedorRuc: "10439608801",
    proveedorNombre: "PEREZ QUISPE JUAN", proveedorCodigo: "0123456789ab", ordenes: 1, monto: 1000, ...x,
  }) as Parameters<typeof nepotismoPublico>[0][number];
  const alcaldeHermano = fila({ declarante: "PEREZ QUISPE PEDRO", cargo: "ALCALDE", grado: "hermano", parentesco: "HERMANO(A) DEL DECLARANTE", electo: true,
                                proveedorRuc: "10439608801", proveedorNombre: "PEREZ QUISPE JUAN", proveedorCodigo: "a1b2c3d4e5f6", ordenes: 7, monto: 31417 });
  const alcaldeConyuge = fila({ declarante: "PEREZ QUISPE PEDRO", cargo: "ALCALDE", grado: "conyuge", parentesco: "CONYUGE", electo: true,
                                proveedorRuc: "10411112222", proveedorNombre: "ROJAS PAZ ELENA", proveedorCodigo: "b1b2c3d4e5f6", ordenes: 2, monto: 9013 });
  const gerenteHermano = fila({ declarante: "TORRES LIMA LUIS", cargo: "GERENTE MUNICIPAL", declaranteFicha: "f1", grado: "hermano", parentesco: "HERMANO(A) DEL DECLARANTE",
                                electo: false, proveedorRuc: "10422223333", proveedorNombre: "TORRES LIMA ANA", proveedorCodigo: "c1b2c3d4e5f6", ordenes: 3, monto: 12011 });
  const filas = [alcaldeHermano, gerenteHermano, alcaldeConyuge];
  const grupos = filas.map((f) => ({ grado: f.grado, parentesco: f.parentesco, electo: f.electo, n: 1, monto: f.monto }));
  const r = nepotismoPublico(filas, grupos, 3, 31417 + 12011 + 9013);
  const s = json(r);
  // El del alcalde y su hermano: «un familiar de una autoridad electa», al final, sin parentesco, sin el familiar, sin monto.
  assert.deepEqual(r.detalle.at(-1), { reservado: true });
  assert.equal(r.detalle.filter((d) => "reservado" in d).length, 1);
  assert.doesNotMatch(s, /31417|a1b2c3d4e5f6/);
  // El del alcalde y su cónyuge: visible, con su monto y la ficha del familiar.
  const conyuge = r.detalle.find((d) => d.parentesco === "CONYUGE")!;
  assert.equal(conyuge.monto, 9013);
  assert.equal(conyuge.proveedorCodigo, "b1b2c3d4e5f6");
  // El del gerente (no electo) y su hermano: como hoy, con el primer apellido del funcionario y su ficha.
  const gerente = r.detalle.find((d) => d.cargo === "GERENTE MUNICIPAL")!;
  assert.equal(gerente.monto, 12011);
  assert.equal(gerente.funcionarioApellido, "TORRES");
  assert.equal(gerente.declaranteFicha, "f1");
  // Ningún nombre completo de funcionario ni RUC 10 sin tapar.
  assert.doesNotMatch(s, /PEREZ QUISPE PEDRO|TORRES LIMA LUIS|10439608801|10422223333/);
  // Los totales suman todo; el grado «hermano» tiene un solo caso reservado: sin su monto aparte. Y como la lista trae los
  // tres casos, el total general menos lo listado daría el del reservado: tampoco va.
  assert.equal(r.total, 3);
  assert.equal(r.monto, null);
  assert.deepEqual(r.porGrado.find((g) => g.grado === "hermano"), { grado: "hermano", n: 2, monto: null });
  assert.deepEqual(r.porGrado.find((g) => g.grado === "conyuge"), { grado: "conyuge", n: 1, monto: 9013 });
  // Con dos reservados en el grado, su suma sí.
  const otroHermano = fila({ ...alcaldeHermano, proveedorCodigo: "d1b2c3d4e5f6", monto: 5009 });
  const dos = nepotismoPublico([alcaldeHermano, otroHermano], [{ grado: "hermano", parentesco: "HERMANO(A) DEL DECLARANTE", electo: true, n: 2, monto: 36426 }], 2, 36426);
  assert.deepEqual(dos.porGrado, [{ grado: "hermano", n: 2, monto: 36426 }]);
  assert.equal(dos.monto, 36426);
  assert.deepEqual(dos.detalle, [{ reservado: true }, { reservado: true }]);
});

test("quién se reserva al declarar un familiar: el cargo de elección, el parentesco en las dos direcciones", async () => {
  const { esCargoDeEleccion } = await import("../src/lib/electos.js");
  const { parentescoInversoPublicable, reservarParentesco } = await import("../src/lib/privacidad.js");
  for (const c of ["ALCALDE", "ALCALDÍA", "REGIDOR 4", "REGIGOR", "TENIENTE ALCALDE", "VICE GOBERNADOR REGIONAL", "CONSEJERA REGIONAL POR LA PROVINCIA", "CONGRESISTA", "CONCEJO MUNICIPAL"]) {
    assert.ok(esCargoDeEleccion(c), c);
  }
  for (const c of ["GERENTE MUNICIPAL", "COLABORADOR", "OTRO CARGO FUNCION O LABOR", "JEFE DE ABASTECIMIENTO", null]) assert.ok(!esCargoDeEleccion(c), String(c));
  // Declarante electo: se reserva con hermano, hijo, sobrino, primo, nieto o desconocido; no con cónyuge, padres o tíos.
  assert.ok(reservarParentesco({ parentesco: "HERMANO(A) DEL DECLARANTE", declaranteElecto: true, familiarPublico: false }));
  assert.ok(reservarParentesco({ parentesco: "PALOMINO HERMANO", declaranteElecto: true, familiarPublico: false }));
  assert.ok(!reservarParentesco({ parentesco: "CONYUGE", declaranteElecto: true, familiarPublico: false }));
  assert.ok(!reservarParentesco({ parentesco: "TÍO (A)", declaranteElecto: true, familiarPublico: false }));
  assert.ok(!reservarParentesco({ parentesco: "HERMANO(A) DEL DECLARANTE", declaranteElecto: false, familiarPublico: false }));
  // Familiar con nombre completo (un electo declarado por un funcionario): se reserva con lo que destapa al funcionario.
  for (const p of ["HERMANO(A) DEL DECLARANTE", "MADRE DEL DECLARANTE", "TÍO (A)", "PRIMO(A)", "ABUELO MATERNO DEL DECLARANTE", "TÍO(A) ABUELO(A)", "BISABUELO(A)", ""]) {
    assert.equal(parentescoInversoPublicable(p), null, p);
    assert.ok(reservarParentesco({ parentesco: p, declaranteElecto: false, familiarPublico: true }), p);
  }
  for (const p of ["CONYUGE", "PADRE DEL DECLARANTE", "HIJO(A)", "SOBRINO(A)", "NIETO(A)", "ABUELA MATERNA DEL DECLARANTE", "CUÑADO(A)", "MADRE DEL CÓNYUGE"]) {
    assert.ok(parentescoInversoPublicable(p), p);
    assert.ok(!reservarParentesco({ parentesco: p, declaranteElecto: false, familiarPublico: true }), p);
  }
});

test("la ficha de un locador: el caso reservado de una autoridad electa no le deja la señal, ni como «reservada»; con otro familiar, sólo ése", async () => {
  const { podarParientes, casoReservado, SENALES_CON_PARIENTES } = await import("../src/lib/nepotismo.js");
  // Quién es electo lo dice la base (declaranteElectoSql); aquí, el alcalde y la regidora de la prueba.
  const electos = new Set(["PEREZ QUISPE PEDRO", "SALAS VEGA ROSA"]);
  const reservado = (pr: Record<string, unknown>) =>
    casoReservado({ electo: electos.has(String(pr.declarante)), parentesco: typeof pr.parentesco === "string" ? pr.parentesco : null });
  const alcaldeHermano = { declarante: "PEREZ QUISPE PEDRO", cargo: "ALCALDE", grado: "hermano", parentesco: "HERMANO(A) DEL DECLARANTE" };
  const alcaldeConyuge = { declarante: "PEREZ QUISPE PEDRO", cargo: "ALCALDE", grado: "conyuge", parentesco: "CONYUGE" };
  const gerenteHijo = { declarante: "TORRES LIMA LUIS", cargo: "GERENTE MUNICIPAL", grado: "hijo", parentesco: "HIJO(A)" };

  // Sólo el del alcalde con su hermano: la señal no sale (la lista ya no le pone la etiqueta y la ficha no la contradice).
  assert.equal(podarParientes("nepotismo", { parientes: [alcaldeHermano], ordenes: 7, monto: 31417 }, reservado), null);
  // Un parentesco desconocido o ilegible de un electo destapa igual.
  assert.equal(podarParientes("nepotismo", { parientes: [{ ...alcaldeHermano, parentesco: "PALOMINO HERMANO" }] }, reservado), null);
  // Con el de un gerente (no electo) al lado: queda la señal, con ése solo, y sus órdenes de la entidad como estaban.
  const mixta = podarParientes("nepotismo", { parientes: [alcaldeHermano, gerenteHijo], ordenes: 9, monto: 40000 }, reservado)!;
  assert.deepEqual(mixta.parientes, [gerenteHijo]);
  assert.equal(mixta.ordenes, 9);
  assert.doesNotMatch(json(mixta), /PEREZ QUISPE|HERMANO/);
  // El alcalde con su cónyuge no destapa: nada cambia (el mismo objeto).
  const conyuge = { parientes: [alcaldeConyuge], ordenes: 2, monto: 9013 };
  assert.equal(podarParientes("nepotismo", conyuge, reservado), conyuge);

  // Familia en el Estado: «entidades» cuenta las de los que quedan; en el mismo gobierno, igual que el nepotismo.
  const familia = podarParientes("familia_estado", {
    entidades: 2,
    parientes: [
      { ...alcaldeHermano, entidad_ruc: "20100000001", entidad: "MUNICIPALIDAD A" },
      { declarante: "SALAS VEGA ROSA", cargo: "REGIDORA", grado: "otro", parentesco: "SOBRINO(A)", entidad_ruc: "20100000002", entidad: "MUNICIPALIDAD B" },
      { ...gerenteHijo, entidad_ruc: "20100000003", entidad: "MUNICIPALIDAD C" },
    ],
  }, reservado)!;
  assert.equal(familia.entidades, 1);
  assert.deepEqual((familia.parientes as Record<string, unknown>[]).map((p) => p.entidad_ruc), ["20100000003"]);
  assert.equal(podarParientes("nepotismo_gobierno", { parientes: [{ ...alcaldeHermano, entidad_ruc: "20100000001" }], nivel: "provincial" }, reservado), null);

  // Las demás señales, y una sin la lista de familiares, pasan tal cual.
  const otra = { parientes: [alcaldeHermano], en_el_borde: 3 };
  assert.equal(podarParientes("al_borde_del_tope", otra, reservado), otra);
  const sinLista = { ordenes: 1 };
  assert.equal(podarParientes("nepotismo", sinLista, reservado), sinLista);
  assert.deepEqual([...SENALES_CON_PARIENTES].sort(), ["familia_estado", "nepotismo", "nepotismo_gobierno"]);
});

test("la base reserva con la misma regla que la API (migración 311) y la corre en cada cadena tras las señales y antes del resumen", async () => {
  const { readFileSync } = await import("node:fs");
  const { PARENTESCOS_PUBLICABLES, FAMILIA_POLITICA_FUENTE, parentescoPublicable } = await import("../src/lib/privacidad.js");
  const { CARGO_DE_ELECCION } = await import("../src/lib/electos.js");
  const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
  const sql = leer("../../db/migrations/311_reserva_parientes_electos.sql");

  // La lista cerrada de parentesco_publicable: la misma, ni uno más ni uno menos.
  const funcion = sql.slice(sql.indexOf("FUNCTION parentesco_publicable"), sql.indexOf("FUNCTION cargo_de_eleccion"));
  const lista = /x\.n IN \(([\s\S]*?)\)\s+OR x\.n ~/.exec(funcion)?.[1] ?? "";
  const enSql = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(enSql.length >= 20);
  assert.deepEqual([...enSql].sort(), [...PARENTESCOS_PUBLICABLES].sort());
  for (const p of enSql) assert.ok(parentescoPublicable(p), p);
  // La familia del cónyuge, con la misma expresión; el cargo de elección, también.
  assert.ok(funcion.includes(`'${FAMILIA_POLITICA_FUENTE}'`));
  assert.ok(sql.includes(`'${CARGO_DE_ELECCION}'`));
  // Normaliza como la API: sin tildes, en mayúsculas, los espacios juntos.
  assert.ok(funcion.includes("btrim(regexp_replace(upper(immutable_unaccent(COALESCE(p, ''))), '\\s+', ' ', 'g'))"));

  // Cada cadena que rehace una señal que nombra a un familiar corre la reserva después de ella y antes del resumen.
  const despues = (texto: string, antes: string[], luego: string | null, archivo: string) => {
    const i = texto.indexOf("refrescar_reserva_parientes");
    assert.ok(i > 0, `${archivo}: no corre refrescar_reserva_parientes`);
    for (const a of antes) assert.ok(texto.indexOf(a) >= 0 && texto.indexOf(a) < i, `${archivo}: ${a} va antes`);
    if (luego) assert.ok(texto.indexOf(luego, i) > i, `${archivo}: ${luego} va después`);
  };
  const cadena = (texto: string, desde: string) => texto.slice(texto.indexOf(desde));
  const ordenes = leer("../../scrapers-worker/src/fuentes/conosce_ordenes.ts");
  despues(cadena(ordenes, "refrescar(env, step, id, ["), ['opcional("refrescar_nepotismo_senal")', 'opcional("refrescar_senales_extra")',
    'opcional("refrescar_familia_estado")'], 'f("refrescar_personas_resumen")', "conosce_ordenes.ts");
  const pte = leer("../../scrapers-worker/src/fuentes/pte_personal.ts");
  despues(cadena(pte, 'for (const f of ["refrescar_nepotismo_senal"'), ['"refrescar_nepotismo_senal"', '"refrescar_senales_extra"', '"refrescar_familia_estado"',
    '"refrescar_planilla_extra"'], '"refrescar_personas_resumen"', "pte_personal.ts");
  despues(cadena(leer("../../scripts/orquestar_dji.py"), "PASOS_SENAL = ("), ['"refrescar_nepotismo_senal"', '"refrescar_senales_extra"',
    '"refrescar_familia_estado"', '"refrescar_planilla_extra"'], '"refrescar_personas_resumen"', "orquestar_dji.py");
  despues(cadena(leer("../../scripts/cadena_planilla.py"), "PASOS = ["), ['"refrescar_nepotismo_senal()"', '"refrescar_senales_extra()"',
    '"refrescar_familia_estado()"', '"refrescar_planilla_extra()"'], '"refrescar_personas_resumen()"', "cadena_planilla.py");
  despues(cadena(leer("../../scripts/cargar_visitas_nacional.py"), "REFRESCOS = ["), ['"refrescar_planilla_extra"'], null, "cargar_visitas_nacional.py");
  despues(cadena(leer("../../scripts/cargar_visitas_congreso.py"), 'for fn in ("refrescar_visita_pariente"'), ['"refrescar_planilla_extra"'], null,
    "cargar_visitas_congreso.py");
});

test("el caso inverso en la entidad: el locador es el electo y el parentesco destapa al funcionario → «lo declaró un funcionario de la entidad», sólo en los totales", async () => {
  const { nepotismoPublico } = await import("../src/lib/nepotismo.js");
  const fila = (x: Record<string, unknown>) => ({
    declarante: null, cargo: null, declaranteFicha: null, grado: "otro", parentesco: null, electo: false, locadorElecto: false,
    proveedorRuc: "10439608801", proveedorNombre: "PEREZ QUISPE JUAN", proveedorCodigo: "0123456789ab", ordenes: 1, monto: 1000, ...x,
  }) as Parameters<typeof nepotismoPublico>[0][number];
  // Un jefe (no electo) declaró a su hermano, que es regidor (electo) y locador de la entidad.
  const jefeHermanoRegidor = fila({ declarante: "SALAS VEGA LUIS", cargo: "JEFE DE LOGISTICA", declaranteFicha: "f9", grado: "hermano",
                                    parentesco: "HERMANO(A) DEL DECLARANTE", locadorElecto: true, proveedorRuc: "10411112222",
                                    proveedorNombre: "SALAS VEGA PEDRO", proveedorCodigo: "e1e2e3e4e5e6", ordenes: 4, monto: 15020 });
  // Su hijo electo no destapa al funcionario (el materno del hijo no es el del padre): se ve, como siempre.
  const gerenteHijoElecto = fila({ declarante: "TORRES LIMA ANA", cargo: "GERENTE MUNICIPAL", grado: "hijo", parentesco: "HIJO(A)", locadorElecto: true,
                                   proveedorRuc: "10422223333", proveedorNombre: "QUISPE TORRES RAUL", proveedorCodigo: "f1f2f3f4f5f6", ordenes: 2, monto: 7000 });
  const comun = fila({ declarante: "ROJAS PAZ ELENA", cargo: "ASISTENTE", grado: "conyuge", parentesco: "CONYUGE", proveedorCodigo: "a9a9a9a9a9a9", ordenes: 3, monto: 9000 });
  const filas = [jefeHermanoRegidor, comun, gerenteHijoElecto];
  const grupos = filas.map((f) => ({ grado: f.grado, parentesco: f.parentesco, electo: f.electo, locadorElecto: f.locadorElecto, n: 1, monto: f.monto }));
  const r = nepotismoPublico(filas, grupos, 3, 15020 + 9000 + 7000);
  const s = json(r);
  // El caso inverso: al final, como «lo declaró un funcionario de la entidad»; ni su cargo, su apellido, su ficha ni el
  // parentesco; ni el locador ni el monto.
  assert.deepEqual(r.detalle.at(-1), { reservado: true, declarante: "funcionario" });
  assert.doesNotMatch(s, /JEFE DE LOGISTICA|SALAS|"f9"|e1e2e3e4e5e6|15020/);
  // Los demás, como siempre (sin la marca de quién es electo).
  assert.equal(r.detalle.length, 3);
  assert.ok(r.detalle.some((d) => (d as Record<string, unknown>).proveedorCodigo === "f1f2f3f4f5f6"));
  assert.doesNotMatch(s, /locadorElecto/);
  // Sólo suma en los totales: con un solo caso reservado, ni el monto general (la lista los trae todos) ni el de su grado.
  assert.equal(r.total, 3);
  assert.equal(r.monto, null);
  assert.deepEqual(r.porGrado.find((g) => g.grado === "hermano"), { grado: "hermano", n: 1, monto: null });

  // Con uno de cada lado, cada uno con su leyenda, y el monto general ya no destapa a ninguno.
  const alcaldeHermano = fila({ declarante: "PEREZ QUISPE PEDRO", cargo: "ALCALDE", grado: "hermano", parentesco: "HERMANO(A) DEL DECLARANTE", electo: true,
                                proveedorCodigo: "b1b2b3b4b5b6", ordenes: 5, monto: 20000 });
  const dos = [jefeHermanoRegidor, alcaldeHermano];
  const r2 = nepotismoPublico(dos, dos.map((f) => ({ grado: f.grado, parentesco: f.parentesco, electo: f.electo, locadorElecto: f.locadorElecto, n: 1, monto: f.monto })), 2, 35020);
  assert.deepEqual(r2.detalle, [{ reservado: true }, { reservado: true, declarante: "funcionario" }]);
  assert.equal(r2.monto, 35020);
  assert.deepEqual(r2.porGrado, [{ grado: "hermano", n: 2, monto: 35020 }]);
});

test("el caso inverso en lo del funcionario: su ficha de planilla no lo muestra (va tapado); si él también es electo, reservado", async () => {
  const { casoDelDeclarante, podarParientes, casoReservado } = await import("../src/lib/nepotismo.js");
  const { reservarParentesco } = await import("../src/lib/privacidad.js");
  // Un funcionario sin cargo de elección declaró a su hermano, que es autoridad electa: en su ficha, el caso no sale.
  assert.equal(casoDelDeclarante({ parentesco: "HERMANO(A) DEL DECLARANTE", declaranteElecto: false, familiarElecto: true }), "fuera");
  assert.equal(casoDelDeclarante({ parentesco: "MADRE DEL DECLARANTE", declaranteElecto: false, familiarElecto: true }), "fuera");
  assert.equal(casoDelDeclarante({ parentesco: "PALOMINO HERMANO", declaranteElecto: false, familiarElecto: true }), "fuera");
  // Con un parentesco que no lo destapa (su hijo, su cónyuge), se ve.
  assert.equal(casoDelDeclarante({ parentesco: "HIJO(A)", declaranteElecto: false, familiarElecto: true }), "ver");
  assert.equal(casoDelDeclarante({ parentesco: "CONYUGE", declaranteElecto: true, familiarElecto: true }), "ver");
  // Si él es electo (va completo), reservado: el de la 311 y el de los dos electos.
  assert.equal(casoDelDeclarante({ parentesco: "HERMANO(A) DEL DECLARANTE", declaranteElecto: true, familiarElecto: false }), "reservado");
  assert.equal(casoDelDeclarante({ parentesco: "HERMANO(A) DEL DECLARANTE", declaranteElecto: true, familiarElecto: true }), "reservado");
  assert.equal(casoDelDeclarante({ parentesco: "HERMANO(A) DEL DECLARANTE", declaranteElecto: false, familiarElecto: false }), "ver");

  // En la ficha del electo (la señal de /personas/:codigo), el caso inverso sigue: reservado, no podado (es lo suyo).
  const det = { parientes: [{ declarante: "SALAS VEGA LUIS", cargo: "JEFE DE LOGISTICA", grado: "hermano", parentesco: "HERMANO(A) DEL DECLARANTE" }] };
  assert.equal(podarParientes("nepotismo", det, (pr) => casoReservado({ electo: false, parentesco: String(pr.parentesco) })), det);
  assert.ok(reservarParentesco({ parentesco: "HERMANO(A) DEL DECLARANTE", declaranteElecto: false, familiarPublico: true }));
});

test("la base reserva el caso inverso con la misma lista que la API (migración 312)", async () => {
  const { readFileSync } = await import("node:fs");
  const { PARENTESCOS_INVERSO_PUBLICABLES, FAMILIA_POLITICA_FUENTE, parentescoInversoPublicable } = await import("../src/lib/privacidad.js");
  const sql = readFileSync(new URL("../../db/migrations/312_reserva_parientes_inversa.sql", import.meta.url), "utf8");
  const funcion = sql.slice(sql.indexOf("FUNCTION parentesco_inverso_publicable"), sql.indexOf("1. Los pares del filtro"));
  const lista = /x\.n IN \(([\s\S]*?)\)\s+OR x\.n ~/.exec(funcion)?.[1] ?? "";
  const enSql = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(enSql.length >= 17);
  assert.deepEqual([...enSql].sort(), [...PARENTESCOS_INVERSO_PUBLICABLES].sort());
  for (const p of enSql) assert.ok(parentescoInversoPublicable(p), p);
  assert.ok(funcion.includes(`'${FAMILIA_POLITICA_FUENTE}'`));
  assert.ok(funcion.includes("btrim(regexp_replace(upper(immutable_unaccent(COALESCE(p, ''))), '\\s+', ' ', 'g'))"));
  // Los pares del filtro de la planilla y la función fila por fila usan la misma regla; y la reserva de la 311 sigue entera.
  assert.match(sql, /FUNCTION public\.refrescar_dji_nepotismo_pares[\s\S]*?parentesco_inverso_publicable/);
  assert.match(sql, /FUNCTION public\.dji_declarante_con_nepotismo[\s\S]*?parentesco_inverso_publicable/);
  assert.match(sql, /FUNCTION refrescar_reserva_parientes[\s\S]*?CASE WHEN parentesco_publicable\(x\.p->>'parentesco'\) THEN false/);
});

test("implicados de un informe de control (migraciones 302 y 304): un apellido tapado, también en la lista de la entidad", () => {
  const r = publicar({
    informes: { pagina: { filas: [{ codigo: "2018CPOL44600002", titulo: "Proceso de contratacion de la obra", ficha: {
      objetivo: "Determinar si el proceso se realizó conforme a la normativa.",
      implicados: [{ nombre: "VELASQUEZ BAUTISTA LUCE", responsabilidades: ["penal", "administrativa_pas"] },
                   { nombre: "DE LA CRUZ ESPINOZA ROSA", responsabilidades: ["civil"] }],
    } }] } },
  });
  const imp = r.informes.pagina.filas[0].ficha.implicados;
  assert.equal(imp[0].nombre, `VELASQUEZ ${TAPA_NOMBRE} LUCE`);
  assert.equal(imp[1].nombre, `DE LA CRUZ ${TAPA_NOMBRE} ROSA`);
  assert.doesNotMatch(json(r), /BAUTISTA|ESPINOZA/);
  assert.deepEqual(imp[0].responsabilidades, ["penal", "administrativa_pas"]);
});

test("orden del nombre por pesos (pesosNombre.ts): un apellido paterno que también es nombre de pila no se lee al revés", () => {
  const tapado = (n: string) => (publicar({ socios: [{ nombre: n }] }) as { socios: { nombre: string }[] }).socios[0].nombre;
  // Apellidos primero: antes «MARTIN PEREZ KEVIN» se leía con el nombre primero y quedaban los dos apellidos a la vista.
  assert.equal(tapado("SANTOS QUISPE JUAN CARLOS"), `SANTOS ${TAPA_NOMBRE} JUAN CARLOS`);
  assert.equal(tapado("MARTIN PEREZ KEVIN"), `MARTIN ${TAPA_NOMBRE} KEVIN`);
  assert.equal(tapado("PASCUAL MAMANI ROSA"), `PASCUAL ${TAPA_NOMBRE} ROSA`);
  assert.equal(tapado("REYNA LEON JESUS ANGEL"), `REYNA ${TAPA_NOMBRE} JESUS ANGEL`);
  // Nombre primero, aunque el campo sea de un padrón que suele ir al revés: se tapa el último apellido.
  assert.equal(tapado("JUAN CARLOS PEREZ QUISPE"), `JUAN CARLOS PEREZ ${TAPA_NOMBRE}`);
  assert.equal(tapado("ROSA QUISPE MAMANI"), `ROSA QUISPE ${TAPA_NOMBRE}`);
  assert.equal(tapado("MARIA DEL CARMEN PEREZ QUISPE"), `MARIA DEL CARMEN PEREZ ${TAPA_NOMBRE}`);
  // Y los apellidos compuestos siguen enteros.
  assert.equal(tapado("DE LA CRUZ ESPINOZA ROSA"), `DE LA CRUZ ${TAPA_NOMBRE} ROSA`);
  assert.equal(tapado("QUISPE DE LA TORRE JUAN"), `QUISPE ${TAPA_NOMBRE} JUAN`);
});

test("el anfitrión de una visita con su dependencia pegada se tapa (visitas relevantes y visitas de cada persona)", () => {
  // Datos sintéticos. El registro de visitas escribe «APELLIDOS NOMBRES - DEPENDENCIA»: con la dependencia, el nombre
  // pasaba de 8 palabras, no se tomaba por persona y salía entero.
  const anfitrion = "QUISPEMAYTA HUAMANCHUMO ROBERTINO ELIAS - OFICINA DESCONCENTRADA DE LORETO";
  const d = publicar({
    person_network_context: {
      visitas_relevantes: [{ persona: "CCAHUANA TICONA FILOMENO", entidad_visitada: "ORGANISMO INVENTADO", funcionario_anfitrion: anfitrion, motivo: "Reunión de trabajo." }],
      datos_peru_por_persona: { "FILOMENO CCAHUANA TICONA": { visitas: { visitas: [{ visitante: "CCAHUANA TICONA FILOMENO", funcionario: anfitrion }] } } },
    },
  });
  const t = JSON.stringify(d);
  assert.doesNotMatch(t, /HUAMANCHUMO/, "el segundo apellido del anfitrión no sale");
  assert.doesNotMatch(t, /TICONA/, "ni el de quien visitó");
  const v = d.person_network_context.visitas_relevantes[0];
  assert.match(v.funcionario_anfitrion, /^QUISPEMAYTA .* ROBERTINO ELIAS - OFICINA DESCONCENTRADA DE LORETO$/);
  assert.match(v.persona, /^CCAHUANA .* FILOMENO$/);
  // Un apellido compuesto con guion (sin espacios) no se parte.
  const c = publicar({ socios: [{ nombre: "PEREZ-GODOY HUAMANCHUMO ROBERTINO" }] });
  assert.doesNotMatch(JSON.stringify(c), /HUAMANCHUMO/);
});

test("Gobserva Salud: el código de IPRESS (8 cifras) no se tapa; un DNI suelto en otra clave sí", () => {
  const r = publicar({ filas: [{ ipressCodigo: "00009123", codigo: "00006207", nota: "43960880" }] });
  assert.equal(r.filas[0].ipressCodigo, "00009123");
  assert.equal(r.filas[0].codigo, "00006207");
  assert.notEqual(r.filas[0].nota, "43960880");
});
