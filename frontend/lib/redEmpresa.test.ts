import test from "node:test";
import assert from "node:assert/strict";
import { idEmpresaRed, redDeEmpresa } from "./redEmpresa.ts";
import type { ClienteEmpresa, SociosEmpresa } from "./empresas.ts";

const RUC = "20600000001";
const OTRA = "20600000002";
const INHAB = "20600000003";
const E1 = "20131377224";

const socios = {
  socios: [
    { nombre: "PEREZ ••• JUAN", roles: ["SOCIO", "GERENTE"], desde: "2019-05-01", otrasEmpresas: 2, enElEstado: { locador: null, autoridad: { cargo: "REGIDOR DISTRITAL", vigente: true, desde: null, hasta: null }, candidaturas: 1, aportes: null } },
    { nombre: "GOMEZ ••• ANA", roles: ["SOCIO"], desde: "2019-05-01", salio: "2024-02-01", otrasEmpresas: 0, enElEstado: null },
  ],
  empresasSocias: [],
  sociaDe: [],
  corte: "2026-11-02",
  vinculadas: [
    { ruc: OTRA, nombre: "SERVICIOS DOS SAC", vende: true, antecedentes: 1, graves: 0, inhabilitada: null, monto: 300000, contratos: 4,
      socios: [{ nombre: "PEREZ ••• JUAN", roles: ["SOCIO"], rolesAlla: ["REPRESENTANTE"] }] },
    { ruc: INHAB, nombre: "OBRAS TRES SAC", vende: true, antecedentes: 2, graves: 1, inhabilitada: "Inhabilitación temporal", monto: 900000, contratos: 2,
      socios: [{ nombre: "PEREZ ••• JUAN", roles: ["SOCIO"], rolesAlla: ["SOCIO"] }] },
  ],
} as unknown as SociosEmpresa;

const clientes = [
  { entidadRuc: E1, entidad: "MUNICIPALIDAD A", departamento: "LIMA", contratos: 3, adjudicado: 500000, consorcio: false, ordenes: 10, ordenado: 40000, dudosas: 0, visitas: 2, primera: null, ultima: null },
  { entidadRuc: "20131376929", entidad: "MUNICIPALIDAD B", departamento: "LIMA", contratos: 0, adjudicado: 0, consorcio: false, ordenes: 0, ordenado: 0, dudosas: 0, visitas: 0, primera: null, ultima: null },
] as ClienteEmpresa[];

test("redDeEmpresa: la empresa al centro, su gente, sus empresas hermanas y sus clientes con monto", () => {
  const r = redDeEmpresa({ ruc: RUC, nombre: "CONSTRUCTORA UNO SAC" }, socios, clientes);
  const ids = new Set(r.nodos.map((n) => n.id));
  assert.ok(ids.has(idEmpresaRed(RUC)) && ids.has(idEmpresaRed(OTRA)) && ids.has(idEmpresaRed(INHAB)) && ids.has(`e:${E1}`));
  // Un cliente sin monto no se dibuja.
  assert.ok(!ids.has("e:20131376929"));
  // La autoridad electa es señal media; la inhabilitada va primero y es alta.
  const p = r.nodos.find((n) => n.nombre === "PEREZ ••• JUAN")!;
  assert.equal(p.severidad, "media");
  assert.equal(r.nodos.find((n) => n.id === idEmpresaRed(INHAB))!.severidad, "alta");
  // Quien ya no figura dice desde cuándo, y sale después de quien sigue.
  const ana = r.nodos.find((n) => n.nombre === "GOMEZ ••• ANA")!;
  assert.match(ana.rol, /ya no figura desde 2024-02-01/);
  assert.ok(r.nodos.indexOf(p) < r.nodos.indexOf(ana));
  // La persona une a la empresa con sus hermanas (no la empresa directo).
  assert.ok(r.aristas.some((a) => a.de === p.id && a.a === idEmpresaRed(OTRA) && a.tipo === "socio"));
  assert.ok(r.aristas.some((a) => a.de === idEmpresaRed(RUC) && a.a === `e:${E1}` && a.tipo === "vende" && /3 contratos/.test(a.texto)));
  // Nada suelto.
  for (const a of r.aristas) assert.ok(ids.has(a.de) && ids.has(a.a), `${a.de} → ${a.a}`);
});

test("redDeEmpresa: con topes, lo que no entra se cuenta", () => {
  const muchas = Array.from({ length: 20 }, (_, i) => ({ ...clientes[0], entidadRuc: `2050000${String(i).padStart(4, "0")}`, adjudicado: 1000 + i }));
  const r = redDeEmpresa({ ruc: RUC, nombre: "X" }, socios, muchas, { maxEntidades: 5, maxPersonas: 1 });
  assert.equal(r.nodos.filter((n) => n.tipo === "entidad").length, 5);
  assert.equal(r.fuera.entidades, 15);
  assert.equal(r.fuera.personas, 1);
});
