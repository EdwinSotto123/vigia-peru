import test from "node:test";
import assert from "node:assert/strict";
import { pareceLote, pasosVerificarMedico, registroDe, sistemaAsistenteSalud, tituloColegio, verificar, type DatosVerificacion } from "../src/lib/gobservaSalud.js";

const base: DatosVerificacion = {
  codigo: "00009123", estado: "ACTIVO", activo: true, enRegistro: true, categoria: "II-2", vistoAl: "2026-11-20",
  detalle: null,
  sanciones: { total: 0, ultima: null, cierre: false, judicializadas: 0 },
  sancionesAl: "2026-11-19",
  denuncias: { anio: null, denuncias: null, consultas: null },
};
const de = (cs: ReturnType<typeof verificar>, clave: string) => cs.find((c) => c.clave === clave);

test("sin sanciones: nunca «no tiene»; dice el registro y la fecha en que se revisó", () => {
  const s = de(verificar(base), "sanciones")!;
  assert.equal(s.estado, "ok");
  assert.equal(s.tipo, "sancion_firme");
  assert.match(s.detalle, /No figura en el Registro de Sanciones de SUSALUD revisado el 19 de noviembre de 2026/);
  assert.doesNotMatch(s.detalle, /no tiene/i);
});

test("con sanciones: cuántas, la última, el cierre y el proceso judicial; nunca «peligrosa»", () => {
  const cs = verificar({ ...base, sanciones: { total: 12, ultima: "2025-09-29", cierre: true, judicializadas: 1 } });
  const s = de(cs, "sanciones")!;
  assert.equal(s.estado, "alerta");
  assert.match(s.detalle, /12 sanciones firmes/);
  assert.match(s.detalle, /29 de setiembre de 2025/);
  assert.match(s.detalle, /cierre definitivo/);
  assert.match(s.detalle, /proceso judicial/);
  for (const c of cs) assert.doesNotMatch(c.detalle, /peligros|segur[oa]\b|confiable/i);
});

test("denuncias: se rotulan como denuncias y se dice que no son sanciones", () => {
  const d = de(verificar({ ...base, denuncias: { anio: 2025, denuncias: 40, consultas: 100 } }), "denuncias")!;
  assert.equal(d.tipo, "denuncia");
  assert.match(d.detalle, /no hechos comprobados ni sanciones/);
});

test("estado en RENIPRESS: activa, cierre temporal (revisa), baja (alerta) y fuera del registro", () => {
  assert.equal(de(verificar(base), "registro")!.estado, "ok");
  assert.equal(de(verificar({ ...base, activo: false, estado: "CIERRE TEMPORAL DE OFICIO" }), "registro")!.estado, "atencion");
  const baja = de(verificar({ ...base, activo: false, estado: "BAJA DEFINITIVA" }), "registro")!;
  assert.equal(baja.estado, "alerta");
  assert.match(baja.detalle, /no debería estar atendiendo/);
  assert.match(de(verificar({ ...base, enRegistro: false }), "registro")!.detalle, /Ya no figura/);
});

test("sin el detalle de RENIPRESS no se afirma nada de servicios, licencias ni responsable", () => {
  const cs = verificar(base);
  assert.equal(de(cs, "quirurgico"), undefined);
  assert.equal(de(cs, "licencia"), undefined);
  assert.equal(de(cs, "responsable"), undefined);
});

test("con detalle: centro quirúrgico, licencia declarada (la da la municipalidad) y responsable sin nombre", () => {
  const cs = verificar({
    ...base,
    detalle: {
      leidoAl: "2026-11-20", categoria: "II-2", categoriaDocumento: "RESOLUCIÓN 207", categoriaFecha: "2019-05-23", quirurgico: true,
      upssQuirurgicas: ["centro quirúrgico"], documentos: [{ tipo: "LICENCIA MUNICIPAL", adjunto: true }],
      responsableColegio: "COLEGIO MEDICO DEL PERU", responsableColegiatura: "12345",
    },
  });
  assert.equal(de(cs, "quirurgico")!.estado, "ok");
  assert.match(de(cs, "licencia")!.detalle, /municipalidad/);
  const r = de(cs, "responsable")!;
  assert.equal(r.estado, "externo");
  assert.match(r.detalle, /Colegio Médico del Perú con colegiatura N\.° 12345/);
  assert.match(de(cs, "categoria")!.detalle, /RESOLUCIÓN 207 del 23 de mayo de 2019/);
});

test("colegios y pasos para verificar a un médico", () => {
  assert.equal(tituloColegio("COLEGIO MEDICO DEL PERU"), "Colegio Médico del Perú");
  assert.equal(tituloColegio("COLEGIO DE ENFERMEROS DEL PERU"), "Colegio de Enfermeros del Perú");
  assert.equal(tituloColegio("COLEGIO TECNOLOGO MEDICO DEL PERU"), "Colegio Tecnólogo Médico del Perú");
  const pasos = pasosVerificarMedico("12345");
  assert.equal(pasos.length, 4);
  assert.match(pasos[0].detalle, /12345/);
  assert.match(pasos[0].url, /conoceatumedico\.cmp\.org\.pe/);
});

test("las instrucciones del asistente traen las reglas que no se rompen", () => {
  const s = sistemaAsistenteSalud("2026-11-20");
  assert.match(s, /SANCIÓN FIRME/);
  assert.match(s, /DENUNCIA/);
  assert.match(s, /Nunca digas «no tiene sanciones»/);
  assert.match(s, /106/);
});

test("condiciones: la relevancia no agrega parámetros (la comparten la lista, el conteo y las facetas)", async () => {
  const { condiciones } = await import("../src/routes/gobservaSalud.js");
  const { sql, vals, relevancia } = condiciones({ q: "Clínica Angloamericana", estado: "activos" });
  const usados = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(usados.size, vals.length);
  assert.ok(relevancia && !/\$\d/.test(relevancia));
  assert.match(relevancia!, /'CLINICA ANGLOAMERICANA'/);
});

test("cerca: la ubicación se redondea a ~110 m y fuera del Perú no se consulta la base", async () => {
  const { redondearCoordenada, saludRouter } = await import("../src/routes/gobservaSalud.js");
  assert.equal(redondearCoordenada(-12.0912345), -12.091);
  assert.equal(redondearCoordenada(-77.0287651), -77.029);
  const pedir = (cuerpo: unknown) => saludRouter.request("/cerca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const fuera = await pedir({ lat: 40.4, lon: -3.7 });
  assert.equal(fuera.status, 400);
  assert.equal((await fuera.json()).error, "fuera_del_peru");
  assert.equal(fuera.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await pedir({ lat: "-12" })).status, 400);
});

test("cerca: los términos de una necesidad son sólo letras y espacios en mayúsculas (nada llega crudo al SQL)", async () => {
  const { saludRouter } = await import("../src/routes/gobservaSalud.js");
  const pedir = (cuerpo: unknown) => saludRouter.request("/cerca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  assert.equal((await pedir({ lat: -12.05, lon: -77.04, terminos: ["ODONTOLOG'; DROP TABLE x"] })).status, 400);
  assert.equal((await pedir({ lat: -12.05, lon: -77.04, terminos: ["odontolog"] })).status, 400);
  assert.equal((await pedir({ lat: -12.05, lon: -77.04, terminos: [] })).status, 400);
  assert.equal((await pedir({ lat: -12.05, lon: -77.04, terminos: Array(17).fill("ODONTOLOG") })).status, 400);
});

test("medicamentos: registro sanitario y lote de lo que se escribe", () => {
  assert.equal(registroDe("EE-01234"), "EE01234");
  assert.equal(registroDe("r.s. ee 01234"), "EE01234");
  assert.equal(registroDe("N25885"), "N25885");
  assert.equal(registroDe("panadol"), null);
  assert.equal(registroDe("paracetamol 500"), null);
  assert.equal(pareceLote("20250502QX"), "20250502QX");
  assert.equal(pareceLote("L-2345"), "L2345");
  assert.equal(pareceLote("panadol"), null);
  assert.equal(pareceLote("paracetamol 500"), null);
  assert.equal(pareceLote("123"), null);
});

test("marca de un medicamento: todas sus palabras, sin forma ni principio activo; un genérico no tiene marca", async () => {
  const { palabrasMarca } = await import("../src/routes/gobservaSalud.js");
  assert.deepEqual(palabrasMarca("DOLO NEUROPRESS FORTE TABLETA", "DICLOFENACO"), ["DOLO", "NEUROPRESS"]);
  assert.deepEqual(palabrasMarca("APRONAX 550 MG TABLETA", "NAPROXENO"), ["APRONAX"]);
  assert.deepEqual(palabrasMarca("PARACETAMOL 500 MG TABLETA", "PARACETAMOL"), []);
  assert.deepEqual(palabrasMarca("GENTAMICINA", "GENTAMICINA"), []);
});
