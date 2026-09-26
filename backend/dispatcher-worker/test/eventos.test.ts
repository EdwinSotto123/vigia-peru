// Port de backend/dispatcher/tests/test_events.py (mismos casos, mismas aserciones).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FASES, completadas, reducirEvento } from "../src/eventos.ts";
import type { Estado, Evento } from "../src/eventos.ts";

const TS = "2026-09-15T18:00:00+00:00";
const reduce = (state: Estado, ev: Evento, ts = TS) => reducirEvento(state, ev, ts);

/** Aplica una secuencia de eventos como lo hace el dispatcher (state.update por evento). */
function corrida(eventos: Evento[]): Estado {
  const state: Estado = {};
  eventos.forEach((ev, i) => Object.assign(state, reducirEvento(state, ev, `2026-09-15T18:00:${String(i).padStart(2, "0")}+00:00`)));
  return state;
}

const ph = (name: string, msg = "x"): Evento => ({ kind: "phase", name, msg });

test("phase conocida da índice", () => {
  const st = reduce({}, { kind: "phase", name: "market", msg: "validando precios" });
  assert.equal(st.fase_actual, "market");
  assert.equal(st.fase_index, FASES.indexOf("market"));
});

test("phase desconocida no rompe", () => {
  const st = reduce({ fase_actual: "market", fase_index: 3 }, { kind: "phase", name: "safety_net", msg: "x" });
  assert.equal(st.fase_actual, "safety_net");
  assert.equal(st.fase_index, 3);
});

test("final marca terminado", () => {
  const st = reduce({}, { kind: "final", final_response: "..." });
  assert.equal(st.terminado, true);
  assert.equal(st.fase_index, FASES.length);
});

test("error guarda detalle", () => {
  assert.equal(reduce({}, { kind: "error", agent: "pipeline", detail: "boom" }).error, "boom");
});

test("eventos ruidosos se ignoran", () => {
  assert.deepEqual(reduce({}, { kind: "tool_call", name: "x" }), {});
});

test("alias del orquestador mapea a fase canónica", () => {
  let st = reduce({}, { kind: "phase", name: "legal" });
  assert.equal(st.fase_actual, "document_legal_analyst");
  assert.equal(st.fase_index, 2);
  assert.equal(reduce({}, { kind: "phase", name: "research_parallel" }).fase_index, FASES.indexOf("web_research"));
  assert.equal(reduce({}, { kind: "phase", name: "news" }).fase_actual, "news_research");
  st = reduce({}, { kind: "phase", name: "compliance_rules", msg: "reglas del perfil otros en código" });
  assert.equal(st.fase_actual, "compliance_extended");
  assert.equal(st.fase_index, FASES.indexOf("compliance_extended"));
});

test("phase sin índice previo no inventa índice", () => {
  const st = reduce({}, { kind: "phase", name: "ocds", msg: "obteniendo OCDS" });
  assert.equal(st.fase_actual, "ocds");
  assert.ok(!("fase_index" in st));
  assert.equal(st.fases!.ocds.estado, "corriendo");
});

test("auxiliares no retroceden el índice", () => {
  const st: Estado = { fase_actual: "report_writer", fase_index: 9 };
  for (const aux of ["persist_checkpoint", "safety_net", "persist", "self_eval", "dag_join", "perfil", "clasificacion", "started", "deterministic"]) {
    const out = reduce(st, ph(aux));
    assert.equal(out.fase_actual, aux, aux);
    assert.equal(out.fase_index, 9, aux);
  }
});

test("índice es el máximo alcanzado en el DAG", () => {
  const st: Estado = { fase_actual: "web_research", fase_index: 4, dag: true };
  let out = reduce(st, ph("market"));
  assert.equal(out.fase_actual, "market");
  assert.equal(out.fase_index, 4);
  out = reduce({ fase_index: 4 }, ph("person_network"));
  assert.equal(out.fase_index, 7);
});

test("final abortado no cuenta como procesado", () => {
  const st = reduce({}, { kind: "final", final_response: "OCDS no disponible — análisis abortado.", state: { _aborted: "ocds_unavailable" } });
  assert.equal(st.terminado, true);
  assert.equal(st.abortado, "ocds_unavailable");
  assert.ok(!("fase_index" in st));
  assert.ok(st.error!.includes("ocds_unavailable"));
});

test("final con runner_error es abortado", () => {
  assert.equal(reduce({}, { kind: "final", runner_error: { kind: "runner_exception", msg: "boom" } }).abortado, "boom");
});

// ─── fases {nombre: {estado, desde, hasta}} ───────────────────────────────────

const CORRIDA_BIENES: Evento[] = [
  ph("perfil", "bienes"), ph("started", "despachando"), ph("deterministic", "pipeline determinista"),
  ph("ocds", "obteniendo OCDS de 1225030"), ph("clasificacion", "matriz bienes/adjudicada"),
  ph("dag", "ramas en paralelo: compliance ∥ documentos ∥ proveedor"),
  ph("compliance", "evaluando reglas duras"), ph("document_parser", "procesando documentos SEACE"),
  ph("proveedor", "perfilando al proveedor adjudicado"),
  ph("research_parallel", "investigación paralela: web_research ∥ news_research ∥ entity_personnel"),
  { kind: "warn", name: "document_parser", msg: "ítems canónicos tras sanitización por LLM: 1 (de 2 crudos)" },
  ph("legal", "análisis legal del requerimiento"), ph("market", "validando precios de mercado (goods_retail)"),
  ph("dag_join", "ramas terminadas: compliance, documentos, proveedor"),
  ph("person_network", "mapeando la red de personas"), ph("compliance_extended", "cumplimiento normativo extendido"),
  ph("persist_checkpoint", "checkpoint"), ph("report_writer", "escribiendo dictamen"),
  ph("safety_net", "verificando"), ph("persist", "persistiendo"), ph("self_eval", "auto-evaluando"),
  { kind: "final", final_response: "ok" },
];

test("corrida DAG completa deja todas hechas", () => {
  const st = corrida(CORRIDA_BIENES);
  assert.ok(st.terminado);
  assert.equal(st.fase_index, 10);
  assert.equal(st.fase_actual, "final");
  const fases = st.fases!;
  for (const f of [...FASES, "ocds", "proveedor", "persist_checkpoint", "safety_net", "persist", "self_eval"]) {
    assert.equal(fases[f].estado, "hecho", f);
    assert.ok(fases[f].desde && fases[f].hasta, f);
  }
  assert.deepEqual(st.fases_completadas!.slice(0, 3), ["ocds", "compliance", "document_parser"]);
  assert.deepEqual(new Set(st.fases_completadas), new Set(Object.keys(fases)));
});

test("en el DAG las ramas corren a la vez", () => {
  const st = corrida(CORRIDA_BIENES.slice(0, 10));
  const f = st.fases!;
  assert.equal(f.compliance.estado, "corriendo");
  assert.equal(f.document_parser.estado, "corriendo");
  assert.equal(f.proveedor.estado, "hecho");
  for (const k of ["web_research", "news_research", "entity_personnel"]) assert.equal(f[k].estado, "corriendo", k);
  assert.equal(f.ocds.estado, "hecho");
  assert.equal(st.fase_index, 4);
  assert.equal(st.dag, true);
  assert.ok(!("person_network" in f));
});

test("legal y market cierran al parser pero no a compliance", () => {
  const st = corrida(CORRIDA_BIENES.slice(0, 13));
  const f = st.fases!;
  assert.equal(f.document_parser.estado, "hecho");
  assert.equal(f.document_legal_analyst.estado, "corriendo");
  assert.equal(f.market.estado, "corriendo");
  assert.equal(f.compliance.estado, "corriendo");
  assert.equal(f.web_research.estado, "corriendo");
  assert.equal(st.fase_index, 4);
});

test("dag_join cierra todas las ramas", () => {
  const st = corrida(CORRIDA_BIENES.slice(0, 14));
  for (const k of ["compliance", "document_parser", "document_legal_analyst", "market", "proveedor", "web_research", "news_research", "entity_personnel"]) {
    assert.equal(st.fases![k].estado, "hecho", k);
  }
  assert.equal(st.dag, false);
});

test("síntesis secuencial cierra la anterior", () => {
  let f = corrida(CORRIDA_BIENES.slice(0, 16)).fases!;
  assert.equal(f.person_network.estado, "hecho");
  assert.equal(f.compliance_extended.estado, "corriendo");
  f = corrida(CORRIDA_BIENES.slice(0, 18)).fases!;
  assert.equal(f.compliance_extended.estado, "hecho");
  assert.equal(f.persist_checkpoint.estado, "hecho");
  assert.equal(f.report_writer.estado, "corriendo");
});

test("omitido no cambia fase_actual ni índice", () => {
  const out = reduce({ fase_actual: "market", fase_index: 3 }, ph("person_network", "omitido: no aplica a bienes/desierta"));
  assert.ok(!("fase_actual" in out));
  assert.equal(out.fase_index, 3);
  const pn = out.fases!.person_network;
  assert.deepEqual(pn, { estado: "omitido", desde: pn.desde, hasta: pn.hasta, motivo: "no aplica a bienes/desierta" });
  assert.deepEqual(out.fases_completadas, []);
});

test("compliance_rules reabre al extendido omitido", () => {
  const st = corrida([ph("compliance_extended", "omitido: no aplica al perfil otros"),
                      ph("compliance_rules", "reglas del perfil otros en código (sin LLM): split_contract")]);
  assert.equal(st.fases!.compliance_extended.estado, "corriendo");
  assert.equal(st.fase_actual, "compliance_extended");
});

test("error de agente marca la fase y el reintento la reabre", () => {
  let st = corrida([...CORRIDA_BIENES.slice(0, 10),
    { kind: "error", agent: "entity_personnel_agent", detail: "run: Tool 'google:google_search' not found." }]);
  assert.equal(st.fases!.entity_personnel.estado, "error");
  assert.ok(st.fases!.entity_personnel.motivo!.includes("google_search"));
  assert.ok(st.error!.startsWith("run: Tool"));
  st = corrida([...CORRIDA_BIENES.slice(0, 10),
    { kind: "error", agent: "entity_personnel_agent", detail: "run: boom" },
    { kind: "warn", name: "entity_personnel", msg: "entity_personnel vacío — reintento" }]);
  assert.equal(st.fases!.entity_personnel.estado, "corriendo");
  st = corrida([...CORRIDA_BIENES.slice(0, 10),
    { kind: "warn", name: "entity_personnel", msg: "entity_personnel vacío — reintento" },
    { kind: "warn", name: "entity_personnel", msg: "entity_personnel vacío tras reintento — default tipado" }]);
  assert.equal(st.fases!.entity_personnel.estado, "hecho");
  assert.ok(st.fases!.entity_personnel.motivo!.includes("sin resultados"));
});

test("error de rama tumba sus fases", () => {
  const st = corrida([...CORRIDA_BIENES.slice(0, 10),
    { kind: "error", agent: "pipeline", name: "documentos", detail: "rama documentos: RuntimeError: x" }]);
  assert.equal(st.fases!.document_parser.estado, "error");
  assert.equal(st.fases!.compliance.estado, "corriendo");
  assert.equal(st.fases!.web_research.estado, "corriendo");
});

test("final abortado deja lo corriendo en error", () => {
  const st = corrida([...CORRIDA_BIENES.slice(0, 4), { kind: "final", state: { _aborted: "ocds_unavailable" } }]);
  assert.equal(st.fases!.ocds.estado, "error");
  assert.ok(st.fases!.ocds.motivo!.includes("abortado"));
});

test("flujo secuencial sin DAG cierra por orden", () => {
  const st = corrida([ph("ocds"), ph("compliance"), ph("document_parser"), ph("legal"), ph("market"),
                      ph("proveedor"), ph("web_research"), ph("news"), ph("entity_personnel"), ph("person_network")]);
  const f = st.fases!;
  for (const k of ["ocds", "compliance", "document_parser", "document_legal_analyst", "market", "proveedor", "web_research", "news_research", "entity_personnel"]) {
    assert.equal(f[k].estado, "hecho", k);
  }
  assert.equal(f.person_network.estado, "corriendo");
  assert.deepEqual(completadas(f), ["ocds", "compliance", "document_parser", "document_legal_analyst", "market", "proveedor",
                                    "web_research", "news_research", "entity_personnel"]);
});

test("eventos guardados con nombre canónico también expanden la investigación", () => {
  const st = corrida([ph("web_research", "investigación paralela: web_research ∥ news_research ∥ entity_personnel")]);
  const corriendo = Object.entries(st.fases!).filter(([, v]) => v.estado === "corriendo").map(([k]) => k);
  assert.deepEqual(new Set(corriendo), new Set(["web_research", "news_research", "entity_personnel"]));
});

test("warn sin reintento no cambia nada", () => {
  assert.deepEqual(reduce({ fases: { market: { estado: "corriendo" } } }, { kind: "warn", name: "market", msg: "sin ítems comparables" }), {});
});
