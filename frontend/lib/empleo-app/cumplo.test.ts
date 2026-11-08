import test from "node:test";
import assert from "node:assert/strict";
import { PERFIL_EMPLEO_VACIO, type PerfilEmpleo } from "./entrevista.ts";
import { aniosQuePide, etapaDePostular, fechasDe, juzgar, nivelQuePide, norm, pideCarrera, requisitosDeServir, veredicto, type RequisitoPlaza } from "./cumplo.ts";

const contador: PerfilEmpleo = { ...PERFIL_EMPLEO_VACIO, carreras: ["Contabilidad"], tengo: "titulo", exp: 2, region: "lima" };
const sistemas: PerfilEmpleo = { ...PERFIL_EMPLEO_VACIO, carreras: ["Ingeniería de sistemas"], tengo: "posgrado", exp: null, region: "lima" };

// La plaza 822073 (MIDIS) que pegó el usuario el 2026-11-08, como la lee «Lo esencial».
const MIDIS: RequisitoPlaza[] = [
  { tipo: "formacion", que: "Título universitario en Ingeniería de Sistemas, Ingeniería Informática, Ingeniería de Computación, Estadística, Economía o Ciencias de la Computación e Informática" },
  { tipo: "formacion", que: "Maestría (egresado) en Gestión Pública, Estadística, Gerencia Social, Gerencia de Proyectos y Programas Sociales, Políticas Públicas o Investigación Social" },
  { tipo: "experiencia", que: "Experiencia general de 6 años en el sector público y/o privado" },
  { tipo: "experiencia", que: "Experiencia específica de 4 años en la función o materia" },
  { tipo: "curso", que: "Curso de Power BI, o Metodologías Ágiles (Scrum Master), o Python (mínimo 30 horas)" },
  { tipo: "conocimiento", que: "Conocimiento en políticas públicas de desarrollo e inclusión social" },
];

test("la carrera se busca por su raíz y sus variantes, como en «Para ti»", () => {
  assert.equal(pideCarrera(norm("Título de Contador Público colegiado"), "Contabilidad"), true);
  assert.equal(pideCarrera(norm("Bachiller en Ingeniería Informática"), "Ingeniería de sistemas"), true);
  assert.equal(pideCarrera(norm(MIDIS[0].que), "Contabilidad"), false);
  assert.equal(pideCarrera(norm("Título en Arquitectura"), "Arquitectura"), true);
});

test("el nivel: lo de antes de la maestría, y la maestría aparte", () => {
  assert.deepEqual(nivelQuePide(norm("Título universitario en X con maestría (egresado) en Y")), { minimo: "titulo", posgrado: "requerido" });
  assert.deepEqual(nivelQuePide(norm("Maestría (egresado) en Gestión Pública")), { minimo: "posgrado", posgrado: "requerido" });
  assert.deepEqual(nivelQuePide(norm("Bachiller o título en Derecho; maestría deseable")), { minimo: "bachiller", posgrado: "deseable" });
  assert.deepEqual(nivelQuePide(norm("Secundaria completa")), { minimo: "secundaria", posgrado: null });
});

test("los años: con dígitos, con palabras, en meses o sin experiencia", () => {
  assert.equal(aniosQuePide("Experiencia general: seis (06) años en el sector público"), 6);
  assert.equal(aniosQuePide("Experiencia general de 6 años"), 6);
  assert.equal(aniosQuePide("un (01) año en la función"), 1);
  assert.equal(aniosQuePide("dos años"), 2);
  assert.equal(aniosQuePide("Seis (06) meses"), 0.5);
  assert.equal(aniosQuePide("No requiere experiencia"), 0);
  assert.equal(aniosQuePide("Experiencia en el sector público"), null);
});

test("un contador con título y 2 años en la plaza del MIDIS: no cumple carrera, maestría ni años", () => {
  const j = juzgar(MIDIS, contador, { expGeneral: 6 });
  assert.deepEqual(j.map((x) => x.estado), ["no", "no", "no", "no", "confirma", "confirma"]);
  assert.match(j[0].porque ?? "", /Tu carrera \(Contabilidad\) no está/);
  assert.match(j[1].porque ?? "", /Pide maestría; tienes título profesional/);
  assert.match(j[2].porque ?? "", /Pide 6 años de experiencia; tienes 2 años/);
  assert.equal(veredicto(j, new Set()).estado, "no");
  assert.equal(veredicto(j, new Set()).no, 4);
});

test("un ingeniero de sistemas con maestría y 5 años o más: cumple estudios, confirma lo demás", () => {
  const j = juzgar(MIDIS, sistemas, { expGeneral: 6 });
  assert.equal(j[0].estado, "cumples");
  assert.match(j[0].porque ?? "", /Pide Ingeniería de sistemas, tu carrera/);
  assert.equal(j[1].estado, "confirma"); // que la maestría sea en una de esas
  assert.equal(j[2].estado, "confirma"); // 6 años, y tiene «5 o más»
  assert.equal(j[3].estado, "confirma"); // la específica
  const v = veredicto(j, new Set());
  assert.equal(v.estado, "confirma");
  assert.equal(veredicto(j, new Set(j.filter((x) => x.estado === "confirma").map((x) => x.clave))).estado, "cumples");
});

test("sin perfil: nada se descarta, todo se confirma", () => {
  const j = juzgar(MIDIS, null, { expGeneral: 6 });
  assert.ok(j.every((x) => x.estado === "confirma"));
});

test("la experiencia general del aviso cuando el texto no dice años", () => {
  const j = juzgar([{ tipo: "experiencia", que: "Experiencia laboral en general" }], { ...contador, exp: 4 }, { expGeneral: 1 });
  assert.equal(j[0].estado, "cumples");
  assert.match(j[0].porque ?? "", /Pide 1 año de experiencia; tienes 3 a 4 años/);
});

test("la experiencia en un puesto o en el sector público es específica: se confirma", () => {
  const p2 = { ...contador, exp: 4 };
  const j = juzgar(
    [
      { tipo: "experiencia", que: "Cuatro (04) años de experiencia laboral general en el sector público y/o privado" },
      { tipo: "experiencia", que: "Dos (02) años de experiencia en puesto o cargos de especialista, coordinador o similares" },
      { tipo: "experiencia", que: "Tres (03) años de experiencia en el sector público" },
    ],
    p2,
    { expGeneral: 4 },
  );
  assert.deepEqual(j.map((x) => x.estado), ["confirma", "confirma", "confirma"]);
  assert.equal(juzgar([{ tipo: "experiencia", que: "Dos años en el sector público o privado" }], p2, { expGeneral: null })[0].estado, "cumples");
});

test("carreras afines y colegiatura quedan para confirmar", () => {
  const j = juzgar(
    [
      { tipo: "formacion", que: "Título profesional en Administración, Economía o carreras afines" },
      { tipo: "formacion", que: "Colegiado y habilitado" },
    ],
    contador,
    { expGeneral: null },
  );
  assert.deepEqual(j.map((x) => x.estado), ["confirma", "confirma"]);
});

test("los requisitos del aviso de SERVIR, parte por parte", () => {
  const r = requisitosDeServir({
    formacion:
      "- título universitario en ingeniería de sistemas,o, ingeniería informática, o estadística. - con maestría (egresado) en gestión pública, o, estadística.",
    experiencia: "Experiencia general: seis (06) años en el sector público y/o privado. experiencia específica :- cuatro (04) años en la función o materia.",
    especializacion: "- PROGRAMA DE ESPECIALIZACIÓN EN ESTADÍSTICA APLICADA (MÍNIMO 90 HORAS). - CURSO POWER BI (MÍNIMO 30 HORAS).",
    conocimiento: "Conocimiento en políticas públicas. Conocimiento en sistema nacional de desarrollo.",
  });
  assert.deepEqual(r.map((x) => x.tipo), ["formacion", "formacion", "experiencia", "curso", "curso", "conocimiento", "conocimiento"]);
  assert.match(r[0].que, /^Título universitario/);
  assert.match(r[3].que, /^Programa de especialización en estadística/);
  // La experiencia entera: general (6 años) y la específica para confirmar.
  const j = juzgar(r, { ...sistemas, exp: null }, { expGeneral: 6 });
  assert.equal(j[2].estado, "confirma");
  assert.equal(juzgar(r, contador, { expGeneral: 6 })[2].estado, "no");
});

test("las fechas del cronograma", () => {
  assert.deepEqual(fechasDe("19 de noviembre del 2026, de 00:00 hasta 23:59", 2026), { desde: "2026-11-19", hasta: "2026-11-19" });
  assert.deepEqual(fechasDe("Del 05 de noviembre al 18 de noviembre del 2026", 2026), { desde: "2026-11-05", hasta: "2026-11-18" });
  assert.deepEqual(fechasDe("Del 20 al 23 de noviembre del 2026", 2026), { desde: "2026-11-20", hasta: "2026-11-23" });
  assert.deepEqual(fechasDe("Del 30 de noviembre al 04 de diciembre del 2026", 2026), { desde: "2026-11-30", hasta: "2026-12-04" });
  assert.deepEqual(fechasDe("10/11/2026", 2026), { desde: "2026-11-10", hasta: "2026-11-10" });
  assert.deepEqual(fechasDe("12 de setiembre", 2026), { desde: "2026-09-12", hasta: "2026-09-12" });
  assert.equal(fechasDe("Según cronograma de la entidad", 2026), null);
});

test("la etapa en que se postula", () => {
  const c = [
    { etapa: "Convocatoria (publicación y difusión)", fecha: "x" },
    { etapa: "Presentación del expediente virtual en MINEDU en línea", fecha: "x" },
    { etapa: "Evaluación del currículum vitae", fecha: "x" },
  ];
  assert.equal(etapaDePostular(c), 1);
  assert.equal(etapaDePostular([{ etapa: "Evaluación", postulas: false }, { etapa: "Envío", postulas: true }]), 1);
  assert.equal(etapaDePostular([{ etapa: "Entrevista" }]), -1);
});
