import test from "node:test";
import assert from "node:assert/strict";
import {
  PERFIL_EMPLEO_VACIO, aAlertaEmpleo, aQueryPerfil, agregarCarrera, agregarPalabrasEmpleo, carreraDe, dePerfilQuery, experienciaDe, nombreDeVariante, paramsCalce, textosMotivo,
  perfilDesdeCv, puestosSugeridos, respondidasPorCv, siguienteEmpleo, textoRespuestaEmpleo, type PreguntaEmpleo,
} from "./entrevista.ts";

const region = (s: string) => ({ lima: "Lima", "la-libertad": "La Libertad" })[s] ?? s;

test("carreraDe y agregarCarrera: el nombre del catálogo por cualquiera de sus formas; una escrita, con mayúscula", () => {
  assert.equal(carreraDe("arquitecto")?.nombre, "Arquitectura");
  assert.equal(carreraDe("Contador")?.nombre, "Contabilidad");
  assert.equal(carreraDe("ingeniería pesquera"), null);
  assert.deepEqual(agregarCarrera([], "abogado"), ["Derecho"]);
  assert.deepEqual(agregarCarrera(["Derecho"], "derecho"), ["Derecho"]);
  assert.deepEqual(agregarCarrera([], "ingeniería pesquera"), ["Ingeniería pesquera"]);
  assert.deepEqual(agregarCarrera(["A", "B", "C"], "Derecho"), ["A", "B", "C"]);
});

test("puestosSugeridos: los tuyos, los reales de las plazas y los del catálogo, sin repetir", () => {
  const r = puestosSugeridos(["Arquitectura"], ["residente de obra"], ["especialista en infraestructura", "Arquitecto"]);
  assert.deepEqual(r.slice(0, 3), ["residente de obra", "especialista en infraestructura", "Arquitecto"]);
  assert.equal(r.filter((x) => x.toLowerCase() === "arquitecto").length, 1);
  assert.equal(nombreDeVariante("arquitectura", ["Arquitectura"]), "Arquitectura");
  assert.equal(nombreDeVariante("ingeniería pesquera", []), "Ingeniería pesquera");
  assert.deepEqual(textosMotivo({ carreras: ["arquitectura"], puestos: ["catastro"] }, ["Arquitectura"]), ["Pide Arquitectura", "Tu puesto: catastro"]);
  assert.deepEqual(textosMotivo(undefined, []), []);
  assert.deepEqual(puestosSugeridos(["Arquitectura"]).slice(0, 2), ["arquitecto", "proyectista"]);
  assert.ok(puestosSugeridos([]).includes("chofer"));
  assert.equal(puestosSugeridos(["Arquitectura", "Ingeniería civil"]).filter((x) => x === "supervisor de obra").length, 1);
});

test("paramsCalce: las carreras con sus variantes; los puestos aparte", () => {
  const p = { ...PERFIL_EMPLEO_VACIO, carreras: ["Arquitectura", "Ingeniería pesquera"], palabras: ["residente de obra"], region: "lima", exp: 4 };
  const q = paramsCalce(p, ["proyectista"], { size: 3 });
  assert.equal(q.get("carreras"), "arquitectura;arquitecto|Ingeniería pesquera");
  assert.equal(q.get("palabras"), "residente de obra");
  assert.equal(q.get("otras"), "proyectista");
  assert.equal(q.get("exp"), "4");
});

test("perfil ↔ «Mi perfil»: ida y vuelta, con carreras", () => {
  const p = { ...PERFIL_EMPLEO_VACIO, puesto: "Arquitectura", carreras: ["Arquitectura"], palabras: ["proyectista"], tengo: "posgrado" as const, exp: null, region: "lima", sueldo: 5000 };
  const v = dePerfilQuery(aQueryPerfil(p));
  assert.deepEqual({ ...v, alerta: p.alerta, frecuencia: p.frecuencia }, p);
  // Un perfil de antes (sin carreras) se sigue leyendo.
  assert.deepEqual(dePerfilQuery("palabras=ingeniero%7Cobras&region=lima").carreras, []);
});

test("perfilDesdeCv y respondidasPorCv: lo que el CV ya dice se responde solo", () => {
  const cv = { carreras: ["arquitecto"], estudios: "posgrado" as const, anosExperiencia: 7, anosSectorPublico: 3, puestos: ["Residente de obra", "proyectista"], region: "lima" };
  const p = perfilDesdeCv(PERFIL_EMPLEO_VACIO, cv);
  assert.deepEqual(p.carreras, ["Arquitectura"]);
  assert.deepEqual(p.palabras, ["residente de obra", "proyectista"]);
  assert.equal(p.puesto, "Arquitectura");
  assert.equal(p.tengo, "posgrado");
  assert.equal(p.exp, null);
  assert.equal(experienciaDe(3), 4);
  assert.deepEqual(respondidasPorCv(cv), ["cv", "carrera", "estudios", "experiencia"]);
  assert.deepEqual(respondidasPorCv({ ...cv, carreras: [], estudios: null, anosExperiencia: null, puestos: [] }), ["cv"]);
});

test("aAlertaEmpleo, textoRespuestaEmpleo y siguienteEmpleo", () => {
  const p = { ...PERFIL_EMPLEO_VACIO, puesto: "Arquitectura", carreras: ["Arquitectura"], palabras: [], region: "lima" };
  assert.deepEqual(aAlertaEmpleo(p), { nombre: "Arquitectura (mi perfil)", filtros: { q: "arquitectura", region: "lima" } });
  assert.equal(textoRespuestaEmpleo("carrera", p, region, false), "Arquitectura");
  assert.equal(textoRespuestaEmpleo("puestos", p, region, false), "Cualquiera de mi carrera");
  assert.equal(textoRespuestaEmpleo("cv", p, region, true), "Te paso mi CV");
  assert.equal(siguienteEmpleo(new Set<PreguntaEmpleo>(["cv", "carrera", "estudios", "experiencia", "puestos"]), "cv"), "lugar");
  assert.deepEqual(agregarPalabrasEmpleo(["médico"], " Medico, Archivo,x"), ["médico", "archivo"]);
});
