import test from "node:test";
import assert from "node:assert/strict";
import { ID_PERSONA, redDePersona } from "./redPersona.ts";
import type { FichaFuncionario } from "./funcionarios.ts";

const E1 = "20131377224";
const E2 = "20131376929";
const M1 = "20600000001";
const M2 = "20600000002";

function ficha(extra: Partial<FichaFuncionario> = {}): FichaFuncionario {
  return {
    codigo: "abc123abc123",
    persona: {
      nombre: "PEREZ G. JUAN", cargo: "GERENTE", entidad: "MUNICIPALIDAD A", entidadRuc: E1, cargoDe: "planilla", declaraciones: 1, entidades: 1,
      primera: null, ultima: null, planillaHoy: true, planillaEntidades: 1, planillaHasta: null,
    },
    parecidos: 0,
    cargos: [{ entidad: "MUNICIPALIDAD A", entidadRuc: E1, cargo: "GERENTE", declaraciones: 1, inicio: "2023-01-02", cese: null, sinCese: true, primera: null, ultima: null }],
    visitas: { total: 3, entidades: 1, primera: "2024-01-01", ultima: "2024-03-01", filas: [{ entidad: "MUNICIPALIDAD B", entidad_ruc: E2, visitas: 3, primera: "2024-01-01", ultima: "2024-03-01", en_nombre_de: [], a_quien: null }] },
    empresas: [{ ruc: M1, empresa: "CONSTRUCTORA UNO SAC", rol: "SOCIO", desde: "2019-05-01" }],
    planilla: [{ situacion: "hoy", ficha: null, entidad: "MUNICIPALIDAD A", entidadRuc: E1, cargo: "GERENTE", dependencia: null, regimen: 276, base: 9000, meses: 20, primerMes: "2023-01", ultimoMes: "2026-09", ultimoMesEntidad: "2026-09" }],
    ordenes: [],
    informes: [],
    aportes: [],
    expuesta: [],
    sinRespuesta: [],
    cruces: {
      visitoYSuEmpresaGano: [{
        entidad: "MUNICIPALIDAD B", entidad_ruc: E2, empresa: "CONSTRUCTORA UNO SAC", empresa_ruc: M1, rol_en_la_empresa: "SOCIO", visitas: 3,
        primera_visita: "2024-01-01", ultima_visita: "2024-03-01", procesos_ganados: 2, monto_soles: 500000, primera_buena_pro: "2024-04-01", ultima_buena_pro: "2024-06-01",
        visito_antes_de_ganar: true,
      }],
      salioYSuEmpresaGano: [], variasEmpresasEnUnaEntidad: [], empresaInhabilitadaYOtraGano: [], enInformeYDespuesCobro: [],
    },
    familia: {
      declarados: 2, conOrdenes: 1, montoOrdenes: 30000, conEmpresas: 1, enSuEntidad: 1, montoSuEntidad: 30000, cercanosEnSuEntidad: 1, masParientes: 0,
      parientes: [
        { n: 1, parentesco: "Primo", cercano: false, items: [] },
        {
          n: 1, parentesco: "Hermano", cercano: true, items: [
            { tipo: "orden", entidadRuc: E1, entidad: "MUNICIPALIDAD A", empresaRuc: null, empresa: null, rol: null, ordenes: 4, procesos: null, monto: 30000, desde: 2024, hasta: 2025, suEntidad: true, suEntidadOrdenes: 4, suEntidadMonto: 30000 },
            { tipo: "empresa", entidadRuc: E1, entidad: "MUNICIPALIDAD A", empresaRuc: M2, empresa: "SERVICIOS DOS EIRL", rol: "GERENTE", ordenes: 2, procesos: null, monto: 15000, desde: 2025, hasta: 2025, suEntidad: true, suEntidadOrdenes: 2, suEntidadMonto: 15000 },
          ],
        },
      ],
    },
    ...extra,
  } as unknown as FichaFuncionario;
}

test("redDePersona: entidades, empresas, visitas y familia, sin nombres de familiares", () => {
  const r = redDePersona(ficha());
  const ids = r.nodos.map((n) => n.id).sort();
  assert.deepEqual(ids, [`e:${E1}`, `e:${E2}`, "f:0", `m:${M1}`, `m:${M2}`, ID_PERSONA].sort());
  // Una sola entidad por RUC, aunque llegue por planilla, cargo declarado y familia.
  assert.equal(r.nodos.filter((n) => n.id === `e:${E1}`).length, 1);
  // El familiar: sólo su parentesco (sin su número: es el único hermano), y grave porque es cercano y obtuvo algo de su
  // entidad. El primo sin nada no se dibuja.
  const fam = r.nodos.find((n) => n.tipo === "pariente")!;
  assert.equal(fam.nombre, "Hermano");
  assert.equal(fam.severidad, "alta");
  assert.ok(!r.nodos.some((n) => n.nombre === "Primo"));
  // La empresa suya que ganó tras la visita: alta, con lo que vendió.
  const m1 = r.nodos.find((n) => n.id === `m:${M1}`)!;
  assert.equal(m1.severidad, "alta");
  assert.equal(m1.monto, 500000);
  const tipos = new Set(r.aristas.map((a) => a.tipo));
  for (const t of ["trabajo", "visita", "socio", "vende", "cobra", "pariente"]) assert.ok(tipos.has(t as never), t);
  // Planilla y cargo declarado son dos líneas a la misma entidad (dicen cosas distintas); ninguna repetida.
  assert.equal(r.aristas.filter((a) => a.de === ID_PERSONA && a.a === `e:${E1}` && a.tipo === "trabajo").length, 2);
  assert.equal(new Set(r.aristas.map((a) => `${a.de}|${a.a}|${a.tipo}|${a.texto}`)).size, r.aristas.length);
});

test("redDePersona: con tope, lo que no entra se cuenta y nada queda suelto", () => {
  const visitas = Array.from({ length: 30 }, (_, i) => ({
    entidad: `ENTIDAD ${i}`, entidad_ruc: `2050000${String(i).padStart(4, "0")}`, visitas: i + 1, primera: null, ultima: null, en_nombre_de: [], a_quien: null,
  }));
  const r = redDePersona(ficha({ visitas: { total: 465, entidades: 30, primera: null, ultima: null, filas: visitas } }), { maxEntidades: 10 });
  assert.equal(r.nodos.filter((n) => n.tipo === "entidad").length, 10);
  assert.equal(r.fuera.entidades, 32 - 10);
  const ids = new Set(r.nodos.map((n) => n.id));
  for (const a of r.aristas) assert.ok(ids.has(a.de) && ids.has(a.a), `${a.de} → ${a.a}`);
  // Las entidades con señal alta entran primero (la de la empresa que ganó tras la visita).
  assert.ok(ids.has(`e:${E2}`) || r.nodos.some((n) => n.severidad === "alta"));
});

test("redDePersona: dos familiares con el mismo parentesco se distinguen por su número en la declaración", () => {
  const item = { tipo: "orden", entidadRuc: E2, entidad: "MUNICIPALIDAD B", empresaRuc: null, empresa: null, rol: null, ordenes: 1, procesos: null, monto: 5000, desde: 2024, hasta: 2024, suEntidad: false, suEntidadOrdenes: null, suEntidadMonto: null };
  const r = redDePersona(ficha({
    familia: {
      declarados: 2, conOrdenes: 2, montoOrdenes: 10000, conEmpresas: 0, enSuEntidad: 0, montoSuEntidad: 0, masParientes: 0,
      parientes: [{ n: 2, parentesco: "Hijo o hija", cercano: true, items: [item] }, { n: 3, parentesco: "Hijo o hija", cercano: true, items: [item] }],
    },
  } as never));
  assert.deepEqual(r.nodos.filter((n) => n.tipo === "pariente").map((n) => n.nombre).sort(), ["Hijo o hija (familiar 2)", "Hijo o hija (familiar 3)"]);
});

test("redDePersona: sin nada que unir, sólo la persona", () => {
  const r = redDePersona(ficha({
    cargos: [], planilla: [], empresas: [], familia: null,
    visitas: { total: 0, entidades: 0, primera: null, ultima: null, filas: [] },
    cruces: { visitoYSuEmpresaGano: [], salioYSuEmpresaGano: [], variasEmpresasEnUnaEntidad: [], empresaInhabilitadaYOtraGano: [], enInformeYDespuesCobro: [] },
  }));
  assert.deepEqual(r.nodos.map((n) => n.id), [ID_PERSONA]);
  assert.equal(r.aristas.length, 0);
});
