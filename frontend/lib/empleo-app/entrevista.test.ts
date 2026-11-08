import test from "node:test";
import assert from "node:assert/strict";
import {
  PERFIL_EMPLEO_VACIO, PUESTOS, aAlertaEmpleo, aQueryPerfil, agregarPalabrasEmpleo, candidatasEmpleo, dePerfilQuery, paramsCalce, perfilDesdePuesto,
  perfilDesdeTextoEmpleo, puestoDesdeTexto, siguienteEmpleo, textoRespuestaEmpleo, type PreguntaEmpleo,
} from "./entrevista.ts";

const region = (s: string) => ({ lima: "Lima", "la-libertad": "La Libertad" })[s] ?? s;

test("puestoDesdeTexto: sin «Busco trabajo de…», hasta el punto y con mayúscula", () => {
  assert.equal(puestoDesdeTexto("Busco trabajo de asistente de archivo. Tengo 2 años."), "Asistente de archivo");
  assert.equal(puestoDesdeTexto("soy enfermera técnica"), "Enfermera técnica");
  assert.equal(puestoDesdeTexto("quiero una plaza como chofer, mecánico y"), "Chofer, mecánico");
});

test("perfilDesdePuesto y perfilDesdeTextoEmpleo: nombre y primeras palabras, sin tocar lo demás", () => {
  const p = perfilDesdePuesto({ ...PERFIL_EMPLEO_VACIO, region: "lima" }, PUESTOS[0]);
  assert.equal(p.puesto, "Administración");
  assert.deepEqual(p.palabras, ["asistente administrativo", "administrativo", "secretaria", "archivo"]);
  assert.equal(p.region, "lima");
  const t = perfilDesdeTextoEmpleo(PERFIL_EMPLEO_VACIO, "Busco trabajo de nutricionista en hospitales o comedores");
  assert.equal(t.puesto, "Nutricionista en hospitales o comedores");
  assert.deepEqual(t.palabras, ["nutricionista", "hospitales", "comedores"]);
});

test("candidatasEmpleo y agregarPalabrasEmpleo: elegidas primero, sin repetir (sin tildes) y con tope", () => {
  const p = { ...perfilDesdePuesto(PERFIL_EMPLEO_VACIO, PUESTOS[3]), palabras: ["médico", "pediatra"] };
  assert.deepEqual(candidatasEmpleo(p, PUESTOS[3]), ["médico", "pediatra", "enfermera", "obstetra", "técnico en enfermería"]);
  assert.deepEqual(agregarPalabrasEmpleo(["médico"], " Medico, Archivo,x"), ["médico", "archivo"]);
  assert.equal(agregarPalabrasEmpleo([], Array.from({ length: 14 }, (_, i) => `p${i}x`).join(",")).length, 10);
});

test("perfil ↔ búsqueda «Mi perfil»: ida y vuelta, y lo raro se descarta", () => {
  const p = { ...perfilDesdePuesto(PERFIL_EMPLEO_VACIO, PUESTOS[1]), tengo: "titulo" as const, exp: 2, region: "la-libertad", sueldo: 2500 };
  const q = aQueryPerfil(p);
  assert.equal(q, "palabras=contador%7Ccontabilidad%7Ctesorer%C3%ADa%7Cpresupuesto&region=la-libertad&tengo=titulo&sueldo=2500&exp=2&puesto=Contabilidad+y+finanzas");
  const v = dePerfilQuery(q);
  assert.deepEqual({ ...v, alerta: p.alerta, frecuencia: p.frecuencia }, p);
  assert.deepEqual(dePerfilQuery("tengo=rey&region=LIMA!&exp=x&palabras=a||b"), { ...PERFIL_EMPLEO_VACIO, palabras: ["a", "b"] });
});

test("paramsCalce y aAlertaEmpleo: el calce lleva las sugeridas aparte; la alerta, la palabra principal", () => {
  const p = { ...perfilDesdePuesto(PERFIL_EMPLEO_VACIO, PUESTOS[2]), exp: 0 };
  assert.equal(paramsCalce(p, ["notario"], { size: 3 }).toString(), "palabras=abogado%7Clegal%7Cjur%C3%ADdico&otras=notario&exp=0&size=3");
  assert.deepEqual(aAlertaEmpleo(p), { nombre: "Derecho (mi perfil)", filtros: { q: "abogado", exp: 0 } });
});

test("textoRespuestaEmpleo y siguienteEmpleo", () => {
  const p = { ...perfilDesdePuesto(PERFIL_EMPLEO_VACIO, PUESTOS[0]), tengo: "bachiller" as const, exp: 1, region: "lima", sueldo: null };
  assert.equal(textoRespuestaEmpleo("puesto", p, region, PUESTOS[0], ""), "Administración");
  assert.equal(textoRespuestaEmpleo("puesto", p, region, null, "Busco algo en archivo"), "Busco algo en archivo");
  assert.equal(textoRespuestaEmpleo("estudios", p, region, null, ""), "Bachiller");
  assert.equal(textoRespuestaEmpleo("experiencia", p, region, null, ""), "1 año");
  assert.equal(textoRespuestaEmpleo("experiencia", { ...p, exp: null }, region, null, ""), "5 años o más");
  assert.equal(textoRespuestaEmpleo("lugar", p, region, null, ""), "Lima");
  assert.equal(textoRespuestaEmpleo("sueldo", p, region, null, ""), "Cualquier sueldo");
  assert.equal(siguienteEmpleo(new Set<PreguntaEmpleo>(["puesto", "palabras", "estudios", "experiencia", "lugar", "sueldo"]), "palabras"), "avisos");
  assert.equal(siguienteEmpleo(new Set()), "puesto");
});
