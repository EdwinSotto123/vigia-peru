import test from "node:test";
import assert from "node:assert/strict";
import { carreraRegex, condicionesCalce, leerCarreras, palabrasNorm, clavePuesto, conTildes, puestoDeTitulo, puestoRegex, raiz } from "../src/lib/calceEmpleo.js";

// Qué plazas calzan (2026-11-08): la carrera en la formación, los puestos en el título como palabra entera.

const calza = (re: string, texto: string) => new RegExp(re).test(texto);

test("palabrasNorm: como mef_norm, sin vacías", () => {
  assert.deepEqual(palabrasNorm("Ingeniería de Sistemas e Informática"), ["INGENIERIA", "SISTEMAS", "INFORMATICA"]);
  assert.deepEqual(palabrasNorm("Técnico en enfermería"), ["TECNICO", "ENFERMERIA"]);
});

test("carrera: la raíz al comienzo de una palabra de la formación", () => {
  assert.equal(raiz("ARQUITECTO"), "ARQUITE");
  assert.equal(raiz("ARQUITECTURA"), "ARQUITECT");
  assert.equal(raiz("CIVIL"), "CIVIL");
  const arq = carreraRegex("ARQUITECTURA");
  assert.ok(calza(arq, "TITULO PROFESIONAL EN ARQUITECTURA O INGENIERIA CIVIL"));
  assert.ok(calza(arq, "TITULO DE INGENIERO CIVIL ARQUITECTO O CARRERAS AFINES"));
  assert.ok(!calza(arq, "TITULO EN INGENIERIA DE SISTEMAS O INFORMATICA"));
  assert.ok(calza(carreraRegex("INGENIERIA"), "TITULO DE INGENIERO CIVIL"));
});

test("puesto: palabra entera con femenino y plural; ARQUITECTO nunca es ARQUITECTURA", () => {
  const arq = puestoRegex("ARQUITECTO");
  assert.ok(calza(arq, "ARQUITECTO PROYECTISTA"));
  assert.ok(calza(arq, "ESPECIALISTA ARQUITECTA"));
  assert.ok(!calza(arq, "ANALISTA EN ARQUITECTURA JAVA II"));
  const con = puestoRegex("CONTADOR");
  assert.ok(calza(con, "CONTADORA GENERAL"));
  assert.ok(calza(con, "CONTADOR"));
  assert.ok(!calza(con, "CONTADURIA"));
});

test("condicionesCalce: con carrera, la carrera manda; sin carrera, puesto en título o raíz en formación", () => {
  const vals: unknown[] = [];
  const c = condicionesCalce({ carreras: [["arquitectura", "arquitecto"]], puestos: ["residente de obra"], otros: ["supervisor"] }, vals);
  assert.equal(c.porCarrera.length, 1);
  assert.equal(c.porPuesto.length, 2);
  assert.ok(c.calza.includes("(fo ~ $1) OR (fo ~ $2)"));
  assert.ok(!c.calza.includes("ti ~"));
  assert.ok(c.puntaje.includes("THEN 2") && c.puntaje.includes("THEN 1"));
  assert.deepEqual(vals.slice(0, 2), ["(^| )ARQUITECT", "(^| )ARQUITE"]);
  const v2: unknown[] = [];
  const viejo = condicionesCalce({ carreras: [], puestos: ["arquitecto"], otros: [] }, v2);
  assert.match(viejo.calza, /ti ~ .* OR \(fo ~ /);
  assert.equal(condicionesCalce({ carreras: [], puestos: [], otros: [] }, []).calza, "false");
  // El filtro de «Para ti» (sólo un puesto que se cuenta): un parámetro por palabra y ninguno de más.
  const v3: unknown[] = [];
  const solo = condicionesCalce({ carreras: [], puestos: [], otros: ["residente de obra"] }, v3);
  assert.equal(v3.length, 2);
  assert.equal(solo.porPuesto.length, 1);
});

test("leerCarreras: grupos por «|» y variantes por «;», sin vacías", () => {
  assert.deepEqual(leerCarreras("arquitectura;arquitecto|ingeniería civil; |de"), [["arquitectura", "arquitecto"], ["ingeniería civil"]]);
  assert.deepEqual(leerCarreras(undefined), []);
});

test("puestoDeTitulo: el título de la plaza como puesto para sugerir", () => {
  assert.equal(puestoDeTitulo("TÉCNICO(A) EN ENFERMERÍA I"), "técnico en enfermería");
  assert.equal(puestoDeTitulo("Enfermero/a"), "enfermero");
  assert.equal(puestoDeTitulo("ESPECIALISTA EN INFRAESTRUCTURA FÍSICA - CAS N° 123-2026"), "especialista en infraestructura física");
  assert.equal(puestoDeTitulo("Especialista en Gestión de Riesgo de Desastres del Gobierno Regional"), "especialista en gestión de riesgo");
  assert.ok(puestoDeTitulo("Especialista en Gestión de Riesgo de Desastres del Gobierno Regional").length <= 40);
  assert.equal(puestoDeTitulo("SECRETARÍA(O)"), "secretaría");
});

test("condicionesCalce: el motivo de cada plaza y el puntaje de «Más afines»", () => {
  const vals: unknown[] = [];
  const c = condicionesCalce({ carreras: [["arquitectura"]], puestos: ["catastro"], otros: [] }, vals);
  assert.match(c.motivo, /^ARRAY\[COALESCE\(.*\)\] AS mc, ARRAY\[COALESCE\(.*\)\] AS mp$/);
  assert.ok(c.puntaje.includes("es <= 3"));
  assert.equal(condicionesCalce({ carreras: [], puestos: [], otros: ["x y z"] }, []).motivo, "ARRAY[]::boolean[] AS mc, ARRAY[]::boolean[] AS mp");
});

test("conTildes y clavePuesto: los sugeridos con tildes y sin repetir por género", () => {
  assert.equal(conTildes("tecnico en enfermeria"), "técnico en enfermería");
  assert.equal(conTildes("asistente en funcion fiscal"), "asistente en función fiscal");
  assert.equal(conTildes("personal de atencion permanente"), "personal de atención permanente");
  assert.equal(conTildes("supervision de obra"), "supervisión de obra");
  assert.equal(conTildes("especialista en administracion"), "especialista en administración");
  assert.equal(puestoDeTitulo("TECNICO EN ENFERMERIA I"), "técnico en enfermería");
  assert.equal(clavePuesto("enfermera"), clavePuesto("enfermero"));
  assert.equal(clavePuesto("técnica en enfermería"), clavePuesto("tecnico en enfermeria"));
  assert.notEqual(clavePuesto("abogado"), clavePuesto("especialista legal"));
});
