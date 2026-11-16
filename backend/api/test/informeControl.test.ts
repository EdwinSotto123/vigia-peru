import test from "node:test";
import assert from "node:assert/strict";
import {
  CAUSA_NO_DETERMINADA, agrupar, armarInforme, cifrasDe, datosDelProceso, datosPublicables, huellaDe, markdownDe, oraciones,
  permitidasDe, revisarTexto, senalesDelContrato, sobreprecioSostenido, type FilaBandera, type RedaccionObservacion,
} from "../src/lib/informeControl.js";
import { aplicarRevision, argumentosDe, costoUsd, SalidaModelo } from "../src/lib/redactorControl.js";

/** Una ficha como la publica GET /contratos/:ocid (lo que usa el redactor). */
const FICHA = {
  ocid: "1250529",
  codigo: "1250529",
  nomenclatura: "LP-SM-2-2026-MPA-1",
  titulo: "ADQUISICION DE CARGADOR FRONTAL",
  descripcion: "ADQUISICION DE CARGADOR FRONTAL",
  entidad: "MUNICIPALIDAD PROVINCIAL DE ANDAHUAYLAS",
  entidadRuc: "20156959783",
  zona: "Andahuaylas",
  ubigeo: "030201",
  tipo: "bienes",
  tipoProceso: "Licitación Pública",
  etapa: "contratada",
  fecha: "2026-06-01",
  fechaBuenaPro: "2026-09-30",
  montoPen: 1182257.76,
  moneda: "PEN",
  postores: 12,
  ofertas: 2,
  adjudicaciones: [{ proveedor: "FERREYROS SOCIEDAD ANÓNIMA", proveedorRuc: "20100028698", montoPen: 1112981.43, vigente: true }],
  contratadoConosce: [{ item: 1, ruc: "20100028698", montoPen: 1112981.43 }],
  contrato: { firmados: [{ firmado: "2026-10-26", monto: 1112981.43 }], montoFirmados: 1112981.43 },
  postoresDetalle: [
    { ruc: "20100028698", razonSocial: "FERREYROS SOCIEDAD ANÓNIMA", montoOferta: 1112981.43, esGanador: true },
    { ruc: "20100000001", razonSocial: "VOLVO PERU S A", montoOferta: 1054000, esGanador: false },
  ],
  documentos: [
    { tipo: "clarifications", titulo: "Pliego de absolución de consultas y observaciones", url: "https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=b50e552e", fecha: "2026-06-22", enVigia: true },
  ],
  cronograma: [{ clave: "convocatoria", fecha: "2026-06-01" }, { clave: "contrato", fecha: "2026-10-26" }],
  cruces: [
    {
      tipo: "penalidad", etiqueta: "Penalidades en contratos anteriores", severidad: "media", rucProveedor: "20100028698",
      proveedor: "FERREYROS SOCIEDAD ANÓNIMA", fecha: "2021-06-04", montoSoles: 15904,
      detalle: { desde: "2019-06-26", hasta: "2021-06-04", entidades: 2, penalidades: 2 }, socios: [], visitas: [],
      fuente: "penalidades", fuenteUrl: "https://apps.oece.gob.pe/perfilprov-ui/ficha/20100028698",
    },
    {
      tipo: "consultas_denuncia_direccionamiento", etiqueta: "Un participante denunció bases dirigidas", severidad: "media",
      rucProveedor: "20100028698", proveedor: "FERREYROS SOCIEDAD ANÓNIMA", fecha: "2026-06-01", montoSoles: null,
      detalle: { lector: "consultas v1", modelo: "x", denuncias: [{ cita: "los parámetros coinciden con el CAT 950", explicacion: "favorecen a una marca" }], n_consultas: 42 },
      socios: [], visitas: [], fuente: "consultas_bases", fuenteUrl: "https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=b50e552e",
    },
    {
      tipo: "socio_de_inhabilitada", etiqueta: "Su socio tiene otra empresa inhabilitada", severidad: "alta", rucProveedor: "20614569337",
      proveedor: "CORPORACION X S.A.C.", fecha: "2026-04-23", montoSoles: 23199000,
      detalle: { sancionada: "CORPORACION Y S.A.C.", sancionada_ruc: "20602158056", socio_desde: "2026-04-07", persona_nombre: "PEREZ ••• JUAN" },
      socios: [{ nombre: "PEREZ ••• JUAN", rol: "socio" }], visitas: [], fuente: "osce_sancionados + rnp_conformacion_juridica", fuenteUrl: "https://www.gob.pe/oece",
    },
    { tipo: "penalidad", etiqueta: "Penalidades en otros contratos", severidad: "media", rucProveedor: "20100028698", posterior: true, detalle: {}, socios: [], visitas: [], fuente: "penalidades" },
  ],
  alerta: { id: "a", codigo: "OECE-1250529", estado: "activa", mercado: { sobreprecioPct: null, items: [{ item: "Cargador", veredicto: "no_verificable", diffPct: 40, nPrecios: 3 }] } },
};

const BANDERAS: FilaBandera[] = [
  { id: 1, regla: "penalidades_oece_historicas", severidad: "baja", evidencia: "El OECE registra 2 penalidad(es) aplicada(s) al RUC 20100028698 por S/ 15,904.00 entre 2019-06-26 y 2021-06-04.", norma: "Reglamento — penalidades", fuente_url: null, agente_origen: "compliance_agent", puntua: true, verificada: true },
  { id: 2, regla: "testaferro_multi_ruc", severidad: "baja", evidencia: "Corrección: no aplica.", norma: null, fuente_url: null, agente_origen: "compliance_agent", puntua: false, verificada: true },
  { id: 3, regla: "sobreprecio_elevado", severidad: "alta", evidencia: "Ítem 'Cargador': +40 %.", norma: null, fuente_url: null, agente_origen: "market_price_agent", puntua: true, verificada: true },
  { id: 4, regla: "oferta_mas_barata_no_gana", severidad: "media", evidencia: "La oferta más baja fue de VOLVO PERU S A (S/ 1,054,000.00). Puntajes: ganador None (económico None).", norma: "Art. 5", fuente_url: null, agente_origen: "compliance_agent", puntua: true, verificada: true },
  { id: 5, regla: "red_flag_documental", severidad: "alta", evidencia: "No se sostuvo.", norma: null, fuente_url: null, agente_origen: "document_legal_analyst_agent", puntua: true, verificada: false },
];

test("las cifras: montos en los dos estilos, fechas largas y cortas, códigos y RUC", () => {
  const c = cifrasDe("Se adjudicó por S/ 1,112,981.43 (o 1.112.981,43) el 30 de setiembre de 2026, el 01/06/2026, Resolución N.° 1717-2026-TCP-S3, RUC 20100028698, a las 12:42.");
  assert.ok(c.numeros.some((n) => Math.abs(n - 1112981.43) < 0.001));
  assert.ok(c.fechas.has("2026-09-30") && c.fechas.has("2026-06-01"));
  assert.ok(c.codigos.has("1717-2026-TCP-S3"));
  assert.ok(c.rucs.has("20100028698"));
  assert.ok(c.horas.has("12:42"));
  // Las tablas de la evidencia escriben «18 abr. 2023»: el texto puede decir «18 de abril de 2023».
  const p = permitidasDe(JSON.stringify({ periodo: "18 abr. 2023 a 4 set. 2025" }));
  assert.equal(revisarTexto("Cobró entre el 18 de abril de 2023 y el 4 de setiembre de 2025.", p).quitadas.length, 0);
});

test("revisarTexto quita la oración con una cifra, una fecha o un RUC que no están en la evidencia", () => {
  const p = permitidasDe(JSON.stringify({ monto: "S/ 1,112,981.43", fecha: "30 de setiembre de 2026", ruc: "20100028698", entidades: 2, penalidades: 7 }));
  const r = revisarTexto(
    "Se adjudicó por S/ 1,112,981.43 el 30 de setiembre de 2026. El sobrecosto sería de S/ 70,000.00. El contrato se firmó el 2 de enero de 2027. Registra 7 penalidades en 2 entidades. La empresa (RUC 20999999999) participó.",
    p,
  );
  assert.equal(r.texto, "Se adjudicó por S/ 1,112,981.43 el 30 de setiembre de 2026. Registra 7 penalidades en 2 entidades.");
  assert.equal(r.quitadas.length, 3);
});

test("un número chico tiene que estar junto a lo que cuenta («2 integrantes» no se sostiene con «2 entidades»)", () => {
  const p = permitidasDe(JSON.stringify({ hecho: "registra penalidades en 2 entidades", integrante: "MEGA S.A.C." }));
  const r = revisarTexto("Registra penalidades en 2 entidades. Se identificaron 2 integrantes con otro giro.", p);
  assert.equal(r.texto, "Registra penalidades en 2 entidades.");
  assert.match(r.quitadas[0].motivo, /2 integrantes/);
  // Con un rótulo en prosa que sí lo cuenta («Otros integrantes con giro distinto: 2»), se queda.
  const p2 = permitidasDe(JSON.stringify({ hecho: "declara otra actividad. Otros integrantes con giro distinto: 2." }));
  assert.equal(revisarTexto("Se registran otros 2 integrantes con giro distinto.", p2).quitadas.length, 0);
  // En una fila de tabla, la columna dice qué cuenta la cifra.
  const p4 = permitidasDe(JSON.stringify({ filas: [{ "Servicio": "Otros", "Órdenes": "10", "Le pagaron": "S/ 227,435.00" }] }));
  assert.equal(revisarTexto("Cobró 10 órdenes por S/ 227,435.00.", p4).quitadas.length, 0);
  // Un número pegado a letras es un código («el requisito M03 de las especificaciones»), no un conteo.
  const p3 = permitidasDe(JSON.stringify({ hecho: "Requisito M03 (Sistema de Monitoreo) exige hardware de la misma marca." }));
  assert.equal(revisarTexto("El requisito M03 de las especificaciones técnicas exigiría la misma marca.", p3).quitadas.length, 0);
});

test("revisarTexto quita a las personas, los delitos y los RUC sin número", () => {
  const p = permitidasDe("{}");
  const r = revisarTexto("El socio PEREZ ••• JUAN firmó. Habría colusión entre postores. Se verificó al postor (RUC de la evidencia). La Entidad habría restringido la competencia.", p);
  assert.equal(r.texto, "La Entidad habría restringido la competencia.");
  assert.equal(r.quitadas.length, 3);
});

test("oraciones no corta montos, siglas ni abreviaturas", () => {
  assert.deepEqual(oraciones("Ganó FERREYROS S.A.C. con S/ 1,112,981.43. La Entidad no lo explicó. Ver Art. 30 de la Ley."), [
    "Ganó FERREYROS S.A.C. con S/ 1,112,981.43.", "La Entidad no lo explicó.", "Ver Art. 30 de la Ley.",
  ]);
});

test("las señales: sin los cruces posteriores, sin las banderas que no suman, no verificadas o de sobreprecio sin mercado", () => {
  const s = senalesDelContrato(FICHA, BANDERAS);
  const tipos = s.map((x) => `${x.origen}:${x.tipo}`).sort();
  assert.deepEqual(tipos, [
    "cruce:consultas_denuncia_direccionamiento", "cruce:penalidad", "cruce:socio_de_inhabilitada", "dictamen:oferta_mas_barata_no_gana", "dictamen:penalidades_oece_historicas",
  ]);
  // Sin personas: ni el socio tapado ni su nombre en los datos que van al modelo.
  const socio = s.find((x) => x.tipo === "socio_de_inhabilitada")!;
  assert.doesNotMatch(JSON.stringify(socio.datos), /PEREZ|•/);
  assert.ok(socio.enlaces.some((e) => e.url.endsWith("/20602158056")), "la ficha de la inhabilitada en el RNP");
  // La fecha de un cruce leído de un documento no es la del documento: va el documento con su fecha.
  const consultas = s.find((x) => x.tipo === "consultas_denuncia_direccionamiento")!;
  assert.equal(consultas.fecha, null);
  assert.match(String(consultas.datos.documento), /22 de junio de 2026/);
  assert.equal(consultas.enlaces[0].copia?.startsWith("https://vigia.gobserva.cloud/v1/documentos/copia?u="), true);
  // Los restos «None» del dictamen se quitan; las fechas ISO, en largo.
  const oferta = s.find((x) => x.tipo === "oferta_mas_barata_no_gana")!;
  assert.doesNotMatch(oferta.texto, /None/);
  const pen = s.find((x) => x.tipo === "penalidades_oece_historicas")!;
  assert.match(pen.texto, /26 de junio de 2019/);
});

test("lo que ya observó la Contraloría (migración 313) es contexto: no se desarrolla y su etiqueta dice el informe", () => {
  const ficha = { ...FICHA, cruces: [...FICHA.cruces, {
    tipo: "observado_por_contraloria", etiqueta: "La Contraloría observó este proceso en un informe de control", severidad: "alta",
    rucProveedor: "20100028698", proveedor: "FERREYROS SOCIEDAD ANÓNIMA", fecha: "2026-09-30", montoSoles: 1112981.43,
    detalle: { informe_codigo: "2027CPOL44600007", informe_numero: "007-2027-2-4460", emision: "2027-03-15", observacion_n: 2,
      tema: "seleccion_contratacion", perjuicio: 250000, moneda: "PEN", responsabilidades: ["penal", "administrativa_entidad"], via: "sigla",
      n_observaciones: 2, n_informes: 1 },
    socios: [], visitas: [], fuente: "informes_control", fuenteUrl: "https://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=2027CPOL44600007&TIPOARCHIVO=RE",
  }] };
  const s = senalesDelContrato(ficha, BANDERAS);
  const obs = s.find((x) => x.tipo === "observado_por_contraloria")!;
  assert.equal(obs.tema, "control_previo");
  assert.equal(obs.etiqueta, "La Contraloría observó este procedimiento en el Informe N.° 007-2027-2-4460");
  assert.match(obs.texto, /Informe N\.° 007-2027-2-4460, emitido el 15 de marzo de 2027 \(observación 2, sobre la selección y la contratación\)/);
  assert.match(obs.texto, /perjuicio de S\/ 250,000\.00/);
  assert.match(obs.texto, /presunta responsabilidad penal, administrativa de funcionarios y servidores/);
  assert.match(obs.texto, /2 observaciones de 1 informe\(s\) nombran este contrato/);
  const { grupos, resto } = agrupar(s);
  assert.equal(grupos.some((g) => g.tema === "control_previo"), false, "no es una observación de Vigía");
  assert.equal(resto.some((x) => x.tipo === "observado_por_contraloria"), true, "va con las otras señales, sin desarrollar");
});

test("agrupar: el mismo hecho en una observación, por gravedad", () => {
  const { grupos } = agrupar(senalesDelContrato(FICHA, BANDERAS));
  assert.deepEqual(grupos.map((g) => g.tema), ["vinculo_inhabilitada", "bases", "evaluacion", "penalidades"]);
  assert.deepEqual(grupos.map((g) => g.id), ["O1", "O2", "O3", "O4"]);
  assert.equal(grupos[3].senales.length, 2, "la penalidad del cruce y la del dictamen, juntas");
});

test("sobreprecioSostenido: el lote con su % o un ítem con 3 precios; nunca uno no verificable", () => {
  assert.equal(sobreprecioSostenido("Ítem 'Cargador': +40 %", { sobreprecioPct: 12 }), true);
  assert.equal(sobreprecioSostenido("Ítem 'Cargador': +40 %", { items: [{ item: "Cargador", veredicto: "elevado", nPrecios: 3, diffPct: 40 }] }), true);
  assert.equal(sobreprecioSostenido("Ítem 'Cargador': +40 %", { items: [{ item: "Cargador", veredicto: "no_verificable", nPrecios: 3 }] }), false);
});

test("datosPublicables: sin nombres de personas, documentos ni direcciones web; las razones sociales de las listas se quedan", () => {
  const d = datosPublicables({ persona_nombre: "X", funcionario: "Y", url_contrato: "https://a", postores: [{ ruc: "20111111111", nombre: "EMPRESA SAC" }, { nombre: "PEREZ ••• JUAN" }], monto: 5 }) as Record<string, unknown>;
  assert.deepEqual(d, { postores: [{ ruc: "20111111111", nombre: "EMPRESA SAC" }], monto: 5 });
});

test("aplicarRevision: lo que no se sostiene se quita; sin condición sostenida, la de los datos", () => {
  const { grupos } = agrupar(senalesDelContrato(FICHA, BANDERAS));
  const g = grupos[3];
  const evidencia = JSON.stringify({ hechos: g.senales.map((s) => s.texto) });
  const normas = [{ id: "N1", documento: "Reglamento", articulo: "120", epigrafe: "Penalidad", extracto: "…", url: null, version: null, clase: "norma" as const }];
  const buena = SalidaModelo.parse({
    sumilla: "El contratista registra penalidades en contratos anteriores, lo que constituiría un indicio de riesgo en la ejecución",
    condicion: ["El OECE registra 2 penalidades aplicadas a FERREYROS SOCIEDAD ANÓNIMA (RUC 20100028698) por S/ 15,904.00."],
    efecto: "Los antecedentes elevarían el riesgo de demoras en la ejecución del contrato.",
    causa: "Por falta de control de la Entidad.",
    criterios: ["N1", "N9"],
    precedentes: [],
    recomendaciones: ["Verificar el cumplimiento de los plazos de entrega y la aplicación de penalidades."],
  });
  const r = aplicarRevision(buena, g, evidencia, normas, []);
  assert.equal(r.redaccion, "modelo");
  assert.deepEqual(r.criterios, ["N1"]);
  assert.equal(r.causa, CAUSA_NO_DETERMINADA, "una causa que la evidencia no dice no va");
  const mala = SalidaModelo.parse({ ...buena, condicion: ["La Entidad pagó S/ 99,999.00 de más el 3 de marzo de 2025."] });
  const r2 = aplicarRevision(mala, g, evidencia, normas, []);
  assert.equal(r2.redaccion, "datos");
  assert.match(r2.condicion[0], /penalidad/);
});

test("argumentosDe lee la herramienta o un JSON suelto; costoUsd por modelo", () => {
  assert.deepEqual(argumentosDe({ choices: [{ message: { tool_calls: [{ function: { name: "observacion", arguments: "{\"a\":1}" } }] } }] }), { a: 1 });
  assert.deepEqual(argumentosDe({ choices: [{ message: { content: "texto {\"b\":2} fin" } }] }), { b: 2 });
  assert.equal(costoUsd("@cf/zai-org/glm-5.3-flash", 1_000_000, 1_000_000), 0.65);
});

test("el documento entero: secciones, sin «·», enlaces y la huella estable", async () => {
  const senales = senalesDelContrato(FICHA, BANDERAS);
  const { grupos, resto } = agrupar(senales);
  const redacciones = new Map<string, RedaccionObservacion>(grupos.map((g) => [g.id, aplicarRevision(null, g, "{}", [], [])]));
  const informe = armarInforme({
    proceso: datosDelProceso(FICHA), grupos, resto, redacciones, normas: new Map(), precedentes: new Map(), antecedentes: [], hoy: "2026-11-16", version: 1,
  });
  assert.equal(informe.numero, "VIG-1250529-01");
  assert.equal(informe.general.montos.adjudicado, 1112981.43);
  assert.match(informe.general.objetivo, /Evaluar si el procedimiento de selección LP-SM-2-2026-MPA-1/);
  assert.match(informe.general.elaboradoPor, /no es un informe de la Contraloría/);
  const md = markdownDe(informe);
  for (const s of ["## I. Información general", "## II. Alcance y fuentes", "## III. Resultados", "## IV. Conclusión", "## V. Recomendaciones", "## Anexo: fuentes"]) assert.ok(md.includes(s), s);
  assert.doesNotMatch(md, /·/);
  assert.doesNotMatch(md, /PEREZ|•/);
  assert.equal(await huellaDe({ b: 1, a: [2, { d: 1, c: 2 }] }), await huellaDe({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

test("un número ambiguo («1,568») vale si cualquiera de sus lecturas está en la evidencia", () => {
  const p = permitidasDe(JSON.stringify({ procesos_entidad: 1568, participacion: "0.2 %" }));
  assert.equal(revisarTexto("Equivale al 0.2 % de los 1,568 procesos de la Entidad.", p).quitadas.length, 0);
  assert.equal(revisarTexto("Equivale al 0.2 % de los 1,569 procesos de la Entidad.", p).quitadas.length, 1);
});
