"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Network, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { maskApellido, maskDnis, redactDnis } from "../../Redact";
import type { GraphNode, GraphEdge } from "../types";
import { wrapText } from "../utils";
import { NodeDetailPanel } from "./NodeDetailPanel";

export function RelationshipGraph({
  person,
  web,
  proveedor,
  ctx,
}: { person: any; web: any; proveedor: any; ctx?: any }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Posiciones override por drag — { [nodeId]: {x,y} }; vacío usa layout polar
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({});
  // ViewBox state — para zoom y pan del SVG (no de nodos individuales)
  // Default amplio (1440×940 sobre canvas base 920×600) para que entren todos
  // los clusters (entidad + postores rivales + visitas) sin necesidad de pan.
  const [viewBox, setViewBox] = useState({ x: -260, y: -170, w: 1440, h: 940 });
  const draggedRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ mx: number; my: number; nx: number; ny: number } | null>(null);
  const wasDraggedRef = useRef(false);
  // Pan refs: cuando el user arrastra el FONDO (no un nodo)
  const panningRef = useRef<{ mx: number; my: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const p = person?.persona_principal || {};
  const red = person?.red_empresarial || {};
  // Empresas vinculadas: priorizar `red_empresarial_derivada` del context
  // (datos DUROS desde RNP) sobre el array del sub-agente (que a veces
  // viene incompleto). Si no hay ctx, caer al campo del sub-agente.
  const empresasTitularCtx = (ctx?.red_empresarial_derivada?.empresas_mismo_titular || []) as any[];
  const empresasTitularAgent = (red.empresas_mismo_titular || []) as any[];
  // Merge ambos por RUC (sin duplicar)
  const _seenRucs = new Set<string>();
  const empresasTitular: any[] = [];
  for (const e of [...empresasTitularCtx, ...empresasTitularAgent]) {
    const ruc = String(e?.ruc || "");
    if (ruc && !_seenRucs.has(ruc)) {
      _seenRucs.add(ruc);
      empresasTitular.push(e);
    } else if (!ruc) {
      empresasTitular.push(e);
    }
  }
  const empresasDomicilio = (red.empresas_misma_direccion || []) as any[];
  const candidaturas = (p.candidaturas || []) as any[];
  const aportes = (p.aportes_campañas || p.aportes_campanas || []) as any[];
  const cargosPasados = (p.cargos_pasados || []) as any[];
  // Nuevos vectores: pareja/familia, autoridades, cruce firmantes con conflicto
  const familia = (person?.pareja_o_familia || []) as any[];
  const autoridades = (person?.vinculo_autoridades || []) as any[];
  const cruceFirmantes = (person?.cruce_firmantes_ganador || [])
    .filter((c: any) => (c?.severidad || "").toLowerCase() === "alta"
                       || (c?.tipo_relacion || "").toLowerCase() !== "sin_relacion") as any[];
  const otrosContratos = (web?.otros_contratos_con_estado || []) as any[];

  const personLabel = p.nombre_completo || "Persona no identificada";
  const proveedorRuc = proveedor?.ruc;
  const proveedorNombre = proveedor?.nombre || web?.empresa?.razon_social || "Proveedor";

  // Datos del cluster Entidad Contratante — hoisted para usar también en familia
  const entidadContratante = ctx?.entidad_contratante || null;
  const autoridadesEntidad = ctx?.autoridades_entidad || null;
  const funcionariosDesignados = (ctx?.funcionarios_designados || []) as any[];
  const alcaldeData = autoridadesEntidad?.alcalde_distrital_actual
                   || autoridadesEntidad?.alcalde_provincial_actual
                   || autoridadesEntidad?.gobernador_regional_actual
                   || null;
  const partidoMunicipioContratante = (
    alcaldeData?.partido || ""
  ).trim().toUpperCase();

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const idPerson = "person";
  const idCompanyMain = "co_main";
  const idEntidad = "entidad";

  nodes.push({
    id: idPerson, kind: "person", label: maskApellido(personLabel),
    sublabel: p.cargo_actual || (p.dni ? `DNI ${maskDnis(String(p.dni))}` : undefined),
    meta: { dni: p.dni, cargo: p.cargo_actual, fuente_url: p.datosperu_url || p.linkedin },
  });

  // Empresa principal (proveedor de la convocatoria actual)
  nodes.push({
    id: idCompanyMain, kind: "company_main",
    label: proveedorNombre.length > 36 ? proveedorNombre.slice(0, 33) + "…" : proveedorNombre,
    sublabel: proveedorRuc ? `RUC ${proveedorRuc}` : undefined,
    tooltip: proveedorNombre,
    meta: { ruc: proveedorRuc, razon_social: proveedorNombre, rol: "Proveedor de la convocatoria actual" },
  });
  edges.push({ from: idPerson, to: idCompanyMain, kind: "titular", label: "rep. legal" });

  // Otras empresas con mismo titular
  empresasTitular.forEach((e: any, i: number) => {
    const id = `co_t_${i}`;
    const lbl = (e.razon_social || `RUC ${e.ruc}`) as string;
    nodes.push({
      id, kind: "company_titular",
      label: lbl.length > 34 ? lbl.slice(0, 31) + "…" : lbl,
      sublabel: e.ruc ? `RUC ${e.ruc}` : undefined,
      tooltip: `${lbl}${e.rol_del_gerente ? " · " + e.rol_del_gerente : ""}`,
      meta: { ruc: e.ruc, razon_social: e.razon_social, rol: e.rol_del_gerente || "Titular o socio" },
    });
    edges.push({ from: idPerson, to: id, kind: "titular", label: e.rol_del_gerente || "titular" });
  });

  // Empresas mismo domicilio
  empresasDomicilio.forEach((e: any, i: number) => {
    const id = `co_d_${i}`;
    const lbl = (e.razon_social || `RUC ${e.ruc}`) as string;
    nodes.push({
      id, kind: "company_domicilio",
      label: lbl.length > 34 ? lbl.slice(0, 31) + "…" : lbl,
      sublabel: e.direccion ? "📍 mismo domicilio" : undefined,
      tooltip: `${lbl} — ${e.direccion || "mismo domicilio fiscal"}`,
      meta: { ruc: e.ruc, razon_social: e.razon_social, direccion: e.direccion, observacion: e.observacion, rol: "Mismo domicilio fiscal" },
    });
    edges.push({ from: idCompanyMain, to: id, kind: "domicilio", label: "mismo domicilio" });
  });

  // Partidos políticos (candidaturas + aportes)
  const partidosMap = new Map<string, { id: string; kind: "candidato" | "aporte"; monto?: number; año?: any }>();
  candidaturas.forEach((c: any, i: number) => {
    const key = (c.partido || "").trim().toUpperCase();
    if (!key) return;
    if (!partidosMap.has(key)) partidosMap.set(key, { id: `pt_${i}`, kind: "candidato", año: c.año });
  });
  aportes.forEach((a: any, i: number) => {
    const key = (a.partido || "").trim().toUpperCase();
    if (!key) return;
    const existing = partidosMap.get(key);
    if (existing) {
      existing.monto = (existing.monto || 0) + Number(a.monto || 0);
    } else {
      partidosMap.set(key, { id: `pt_a_${i}`, kind: "aporte", monto: Number(a.monto || 0), año: a.año });
    }
  });
  partidosMap.forEach((m, key) => {
    nodes.push({
      id: m.id, kind: "party",
      label: key.length > 28 ? key.slice(0, 25) + "…" : key,
      sublabel: m.monto ? `S/. ${m.monto.toLocaleString("es-PE")}` : (m.año ? `${m.año}` : undefined),
      tooltip: m.kind === "aporte" ? "Aportante a campaña" : "Candidato/a",
      meta: { partido: key, monto: m.monto, año: m.año, rol: m.kind === "aporte" ? "Aportante ONPE" : "Candidatura" },
    });
    edges.push({
      from: idPerson, to: m.id,
      kind: m.kind === "aporte" ? "aporte" : "candidato",
      label: m.kind === "aporte" ? "aporte ONPE" : `candidato ${m.año || ""}`,
    });
  });

  // Cargos públicos pasados (hasta 3 más relevantes)
  cargosPasados.slice(0, 3).forEach((c: any, i: number) => {
    const id = `cg_${i}`;
    const inst = (c.institucion || c.cargo || "Cargo público") as string;
    nodes.push({
      id, kind: "cargo_pasado",
      label: inst.length > 28 ? inst.slice(0, 25) + "…" : inst,
      sublabel: c.periodo || c.cargo,
      tooltip: `${c.cargo || ""} · ${inst}${c.periodo ? " (" + c.periodo + ")" : ""}`,
      meta: { cargo: c.cargo, institucion: inst, periodo: c.periodo, fuente_url: c.fuente_url },
    });
    edges.push({ from: idPerson, to: id, kind: "cargo", label: c.periodo || "cargo público" });
  });

  // ─── Familiares + Municipios donde trabajan + Partido compartido ───
  // Cada familiar que es funcionario público se conecta con su municipio
  // como nodo distinto (kind=municipio_familiar). Si el partido del alcalde
  // de ESE municipio coincide con el partido del alcalde del municipio que
  // CONTRATA → edge especial "mismo_partido_que" en rojo grueso.
  // (partidoMunicipioContratante ya está hoisted arriba)
  familia.slice(0, 8).forEach((f: any, i: number) => {
    const id = `fa_${i}`;
    const nombre = maskApellido((f.nombre || "Familiar") as string);
    nodes.push({
      id, kind: "pareja",
      label: nombre,
      sublabel: f.parentesco || "vínculo familiar",
      tooltip: `${nombre} · ${f.parentesco || ""} · ${f.detalles || ""}`,
      meta: { rol: f.parentesco, observacion: f.detalles, fuente_url: f.fuente_url },
    });
    edges.push({ from: idPerson, to: id, kind: "pareja", label: f.parentesco || "familiar" });

    // Cargos públicos del familiar → nodo MUNICIPIO con partido
    const cargosFam = (f.cargos_publicos || f.cargos || []) as any[];
    cargosFam.slice(0, 2).forEach((c: any, j: number) => {
      if (!c) return;
      const subId = `fa_${i}_mun_${j}`;
      const entidad = (c.entidad || c.institucion || c.municipalidad || "Entidad pública") as string;
      const partido = (c.partido_municipio || c.partido_alcalde || c.partido || "").trim();
      const partidoUpper = partido.toUpperCase();
      const esMismoMunicipio = entidadContratante?.nombre
        && entidad.toUpperCase().includes(
          (entidadContratante.nombre as string).toUpperCase().slice(0, 25)
        );
      const compartePartido =
        partidoUpper && partidoMunicipioContratante &&
        partidoUpper === partidoMunicipioContratante;

      nodes.push({
        id: subId, kind: "municipio_familiar",
        label: entidad,
        sublabel: c.cargo
          ? `${c.cargo}${c.periodo ? " · " + c.periodo : ""}`
          : (c.periodo || "cargo público"),
        tooltip: `${nombre} es ${c.cargo || "funcionario"} en ${entidad}${
          partido ? " · alcalde del partido " + partido : ""
        }${esMismoMunicipio ? " · ⚠ mismo municipio que contrata" : ""}`,
        meta: {
          cargo: c.cargo,
          institucion: entidad,
          periodo: c.periodo,
          partido,
          fuente_url: c.fuente_url,
          observacion: c.observacion
            || `${f.parentesco || "Familiar"} del titular del proveedor${
              esMismoMunicipio ? " · MISMO municipio contratante" : ""
            }${compartePartido ? " · MISMO partido del alcalde contratante" : ""}`,
          rol: esMismoMunicipio ? "⚠ Conflicto directo" : "Vínculo cruzado",
        },
      });
      edges.push({
        from: id, to: subId, kind: "trabaja_en",
        label: c.cargo ? `es ${c.cargo}` : "trabaja en",
      });

      // Si comparte partido con el municipio contratante → edge especial al alcalde
      // (el render skip-ea edges sin positions definidas, así que es seguro)
      if (compartePartido && alcaldeData) {
        edges.push({
          from: subId, to: "alcalde_actual", kind: "mismo_partido_que",
          label: `mismo partido (${partido})`,
        });
      }

      // Si el partido es distinto, lo mostramos como sub-nodo PARTIDO para
      // contextualizar la red política (el partido es propio del municipio
      // donde trabaja el familiar).
      if (partido && !compartePartido) {
        const ptId = `fa_${i}_mun_${j}_pt`;
        nodes.push({
          id: ptId, kind: "partido_compartido",
          label: partido,
          sublabel: "partido del municipio",
          tooltip: `Partido del alcalde de ${entidad}: ${partido}`,
          meta: { partido, rol: "Partido del municipio donde trabaja el familiar" },
        });
        edges.push({ from: subId, to: ptId, kind: "partido_de", label: "alcalde de" });
      }
    });
  });

  // Vínculo con autoridades públicas (NUEVO)
  autoridades.slice(0, 5).forEach((a: any, i: number) => {
    const id = `au_${i}`;
    const nombre = (a.autoridad || "Autoridad") as string;
    nodes.push({
      id, kind: "autoridad",
      label: nombre,
      sublabel: a.cargo || a.entidad,
      tooltip: `${nombre} · ${a.cargo || ""} · ${a.entidad || ""} · ${a.evidencia || ""}`,
      meta: { cargo: a.cargo, institucion: a.entidad, observacion: a.evidencia, fuente_url: a.fuente_url, rol: a.vinculo_con_gerente },
    });
    edges.push({
      from: idPerson, to: id, kind: "autoridad",
      label: a.vinculo_con_gerente || "vínculo",
    });
  });

  // Firmantes con conflicto (NUEVO) — viñetazo rojo
  cruceFirmantes.slice(0, 3).forEach((c: any, i: number) => {
    const id = `fc_${i}`;
    const nombre = maskApellido((c.firmante || "Firmante") as string);
    nodes.push({
      id, kind: "firmante_conflicto",
      label: nombre.length > 26 ? nombre.slice(0, 23) + "…" : nombre,
      sublabel: c.tipo_relacion || "relación detectada",
      tooltip: `${nombre} · ${c.cargo_firmante || ""} · ${c.entidad_firmante || ""} · ${c.evidencia || ""}`,
      meta: { cargo: c.cargo_firmante, institucion: c.entidad_firmante, observacion: c.evidencia, fuente_url: c.fuente_url, rol: c.tipo_relacion },
    });
    edges.push({
      from: idPerson, to: id, kind: "firma_conflicto",
      label: c.tipo_relacion || "conflicto",
    });
  });

  // Contratos con otras entidades (de web_research) — cuelgan de la empresa principal
  const contratosFiltrados = otrosContratos.slice(0, 5);
  contratosFiltrados.forEach((c: any, i: number) => {
    const id = `ct_${i}`;
    const ent = (c.entidad || c.entidad_contratante || "Entidad") as string;
    const monto = Number(c.monto || c.valor || 0);
    nodes.push({
      id, kind: "contract",
      label: ent.length > 30 ? ent.slice(0, 27) + "…" : ent,
      sublabel: monto ? `S/. ${monto.toLocaleString("es-PE")}` : (c.año || c.fecha || undefined),
      tooltip: `${ent}${c.objeto ? " — " + c.objeto : ""}`,
      meta: { entidad: ent, monto, año: c.año || c.fecha, objeto: c.objeto, fuente_url: c.fuente_url || c.url },
    });
    edges.push({ from: idCompanyMain, to: id, kind: "contrato", label: c.año || "contrato" });
  });

  // ─── CLUSTER ENTIDAD CONTRATANTE ───
  // Nodo central nuevo con el alcalde, autoridades electas y funcionarios designados
  // (las constantes están hoisted arriba para que el bloque familia las use)
  // Para detectar conflictos: lista de DNIs/nombres del proveedor para cross-match
  const dniProveedor = new Set<string>();
  if (p.dni) dniProveedor.add(String(p.dni));
  (proveedor?.socios || []).forEach((s: any) => {
    if (s?.numero_documento) dniProveedor.add(String(s.numero_documento));
  });

  if (entidadContratante) {
    const nombreEnt = entidadContratante.nombre || "Entidad Contratante";
    nodes.push({
      id: idEntidad, kind: "entidad",
      label: nombreEnt,
      sublabel: entidadContratante.ruc ? `RUC ${entidadContratante.ruc}` : entidadContratante.region,
      tooltip: nombreEnt,
      meta: { ruc: entidadContratante.ruc, entidad: nombreEnt, rol: "Entidad contratante" },
    });
    // F5: Edge proveedor → entidad con detalle de sobreprecio si existe.
    // Buscamos en banderas_red o banderas de mercado el % sobreprecio del lote.
    const banderasContexto: any[] = (person as any)?.banderas_red || [];
    const sobreprecioBandera = banderasContexto.find((b: any) =>
      /sobreprecio_lote|sobreprecio_muy_elevado/i.test(b?.regla || "")
    );
    let labelEdge = "adjudicación";
    if (sobreprecioBandera?.evidencia) {
      const m = String(sobreprecioBandera.evidencia).match(/\(\+([\d.]+)%\)|([\d.]+)% por encima/);
      const pct = m ? (m[1] || m[2]) : null;
      if (pct) labelEdge = `⚠ +${pct}% sobreprecio`;
    }
    edges.push({
      from: idCompanyMain, to: idEntidad, kind: "adjudicacion",
      label: labelEdge,
    });
  }

  // Alcalde / autoridad electa principal (alcaldeData ya está hoisted arriba)
  if (alcaldeData && entidadContratante) {
    const idAlc = "alcalde_actual";
    const nombre = alcaldeData.nombre || "Alcalde";
    nodes.push({
      id: idAlc, kind: "alcalde",
      label: nombre.length > 30 ? nombre.slice(0, 27) + "…" : nombre,
      sublabel: alcaldeData.partido || alcaldeData.cargo || "Alcalde electo",
      tooltip: `${nombre} · ${alcaldeData.partido || ""} · ${alcaldeData.periodo || ""}`,
      meta: {
        cargo: alcaldeData.cargo || "Alcalde distrital",
        partido: alcaldeData.partido,
        periodo: alcaldeData.periodo,
        fuente_url: alcaldeData.fuente_url,
        rol: "Autoridad electa vigente",
      },
    });
    edges.push({
      from: idEntidad, to: idAlc, kind: "preside_entidad",
      label: "preside",
    });
  }

  // Funcionarios designados (Gerente Municipal, Logística, OCI, etc.)
  // Ahora con indicador de confianza_match para distinguir matches firmes
  // (DNI verificado) de matches fuzzy débiles que pueden ser homónimos.
  const designadosMostrados = funcionariosDesignados.slice(0, 5);
  designadosMostrados.forEach((f: any, i: number) => {
    if (!entidadContratante) return;
    const id = `fd_${i}`;
    const nombre = maskApellido((f.nombre_completo || f.nombre || "Funcionario") as string);
    const cargo = (f.cargo || f.area || "Designado") as string;
    const dniFunc = String(f.dni || "");
    const isConflict = dniFunc && dniProveedor.has(dniFunc);
    // F4: confianza_match — viene del backend cruzando con batch_person_lookup
    const conf = (f.confianza_match || "sin_lookup") as string;
    const hallazgosCount = Array.isArray(f.hallazgos_summary) ? f.hallazgos_summary.length : 0;
    const sublabelExtra = hallazgosCount > 0 && (conf === "alta" || conf === "media")
      ? ` · ${hallazgosCount} hallazgos`
      : "";
    nodes.push({
      id, kind: "funcionario_designado",
      label: nombre,
      sublabel: cargo + sublabelExtra,
      tooltip: `${nombre} · ${cargo}${f.fecha_designacion ? " (desde " + f.fecha_designacion + ")" : ""}${
        conf === "muy_baja" || conf === "sin_lookup" ? " · ⚠ sin DNI verificado" : ""
      }`,
      meta: {
        cargo, institucion: f.area, dni: f.dni,
        fuente_url: f.fuente_url,
        observacion: conf === "muy_baja" || conf === "sin_lookup"
          ? "Sin DNI verificado — los hallazgos por nombre son fuzzy match"
          : (Array.isArray(f.hallazgos_summary) ? f.hallazgos_summary.join(" · ") : ""),
        rol: isConflict
          ? "⚠ Conflicto detectado"
          : (conf === "muy_baja" || conf === "sin_lookup"
              ? "Funcionario designado (sin DNI)"
              : "Funcionario designado"),
      },
    });
    edges.push({
      from: idEntidad, to: id,
      kind: isConflict ? "conflicto_funcionario" : "designado_por",
      label: isConflict ? "⚠ vinculado al proveedor" : (cargo.split(" ")[0] || "designado"),
    });
  });

  // ─── F1 · POSTORES RIVALES + SOCIOS CON CONFLICTO ───
  // Los postores no ganadores también deben graficarse. Si algún socio de un
  // postor es funcionario público o tiene cargo electo, eso es bandera ALTA.
  const sociosPostoresRivales = (ctx?.socios_postores_rivales || []) as any[];
  // También cruzamos contra autoridades electas para detectar conflicto auto.
  const autoridadesActivasNombres = new Set<string>();
  if (autoridadesEntidad?.alcalde_distrital_actual?.nombre) {
    autoridadesActivasNombres.add(
      String(autoridadesEntidad.alcalde_distrital_actual.nombre).toUpperCase()
    );
  }
  sociosPostoresRivales.slice(0, 4).forEach((pr: any, i: number) => {
    const id = `pr_${i}`;
    const razon = (pr.razon_social || "Postor rival") as string;
    nodes.push({
      id, kind: "postor_rival",
      label: razon,
      sublabel: pr.ruc_postor ? `RUC ${pr.ruc_postor}` : "postor no ganador",
      tooltip: `${razon} · postor no ganador · ${pr.n_socios || 0} socios`,
      meta: { ruc: pr.ruc_postor, razon_social: razon, rol: "Postor no ganador" },
    });
    // Edge desde la entidad: todos compitieron por el mismo contrato
    edges.push({
      from: idEntidad, to: id, kind: "compitio",
      label: "postuló",
    });

    // Socios del postor rival — máximo 2 por postor para no saturar
    (pr.socios || []).slice(0, 2).forEach((s: any, j: number) => {
      if (!s) return;
      const socId = `pr_${i}_s_${j}`;
      const nombre = (s.nombre || "Socio") as string;
      // Detectar si es funcionario público activo (cruce con autoridades)
      const esFuncionarioActivo = autoridadesActivasNombres.has(nombre.toUpperCase());
      nodes.push({
        id: socId,
        kind: esFuncionarioActivo ? "socio_postor_conflicto" : "company_titular",
        label: maskApellido(nombre),
        sublabel: s.dni ? `DNI ${maskDnis(String(s.dni))}` : (s.rol_en_postor || "socio"),
        tooltip: `${maskApellido(nombre)}${s.dni ? " · DNI " + maskDnis(String(s.dni)) : ""} · ${s.rol_en_postor || "socio"}${
          esFuncionarioActivo ? " · ⚠ FUNCIONARIO PÚBLICO ACTIVO" : ""
        }`,
        meta: {
          dni: s.dni, rol: s.rol_en_postor,
          observacion: esFuncionarioActivo
            ? "⚠ Socio de postor rival es funcionario público activo en la región"
            : `Socio de postor no ganador (${razon})`,
        },
      });
      edges.push({
        from: id, to: socId,
        kind: esFuncionarioActivo ? "conflicto_funcionario" : "socio_de",
        label: esFuncionarioActivo ? "⚠ socio + funcionario" : "socio",
      });
    });
  });

  // ─── F2 · VISITAS INTER-MUNICIPALES ───
  // Funcionario de la entidad contratante figura representando otra
  // municipalidad en visitas oficiales → doble vinculación.
  const visitasInterMun = (ctx?.visitas_inter_municipales || []) as any[];
  // Deduplicar por entidad_representada
  const entidadesSecundariasYaCreadas = new Set<string>();
  visitasInterMun.slice(0, 4).forEach((v: any, i: number) => {
    const entRep = (v.entidad_representada || "").trim();
    if (!entRep || entidadesSecundariasYaCreadas.has(entRep.toUpperCase())) return;
    entidadesSecundariasYaCreadas.add(entRep.toUpperCase());
    const id = `es_${i}`;
    nodes.push({
      id, kind: "entidad_secundaria",
      label: entRep,
      sublabel: "doble vinculación",
      tooltip: `${v.persona || "Un funcionario"} representó a ${entRep} en visita a ${
        v.entidad_visitada || "entidad pública"
      }${v.fecha ? " (" + v.fecha + ")" : ""}`,
      meta: {
        entidad: entRep,
        observacion: `${v.persona} (funcionario de ${entidadContratante?.nombre || "la entidad"}) representó a esta otra entidad`,
        rol: "Entidad secundaria · doble vinculación detectada",
      },
    });
    edges.push({
      from: idEntidad, to: id, kind: "doble_vinculacion",
      label: "doble vinculación",
    });
  });

  // No renderizar si solo hay persona + empresa principal sin nada más
  if (nodes.length <= 2) return null;

  // ─── Layout polar: persona al centro, empresas en anillo externo ───
  const W = 920, H = 600;
  const cx = W / 2, cy = H / 2;
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(idPerson, { x: cx, y: cy });

  // Radios más amplios para evitar overlap
  const R1 = 220;     // anillo 1 (empresas / partidos / cargos)
  const R2_co = 150;  // sub-anillo (contratos cuelgan de la empresa principal)
  const R2_dom = 130; // sub-anillo (domicilio cuelga de empresa principal)

  // Empresa principal: arriba-derecha
  const mainAng = -Math.PI / 4; // -45°
  positions.set(idCompanyMain, { x: cx + R1 * Math.cos(mainAng), y: cy + R1 * Math.sin(mainAng) });
  const mp = positions.get(idCompanyMain)!;

  // Otras empresas mismo titular → arco superior (de -135° a -50°), evita el slot principal
  const titularSlots = empresasTitular.length;
  empresasTitular.forEach((_e: any, i: number) => {
    const id = `co_t_${i}`;
    const t = titularSlots <= 1 ? 0.5 : i / (titularSlots - 1);
    const ang = -Math.PI + (Math.PI * 0.55) * t; // de 180° a 81°
    positions.set(id, { x: cx + R1 * Math.cos(ang), y: cy + R1 * Math.sin(ang) });
  });

  // Partidos → arco izquierdo (de 110° a 200°)
  const partidos = Array.from(partidosMap.values());
  partidos.forEach((meta, i) => {
    const t = partidos.length <= 1 ? 0.5 : i / (partidos.length - 1);
    const ang = (Math.PI * 0.6) + (Math.PI * 0.5) * t; // de 108° a 198°
    positions.set(meta.id, { x: cx + R1 * Math.cos(ang), y: cy + R1 * Math.sin(ang) });
  });

  // Cargos públicos → arco inferior izquierdo
  cargosPasados.slice(0, 3).forEach((_c: any, i: number) => {
    const id = `cg_${i}`;
    const slots = Math.min(cargosPasados.length, 3);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (Math.PI * 1.1) + (Math.PI * 0.25) * t;
    positions.set(id, { x: cx + R1 * Math.cos(ang), y: cy + R1 * Math.sin(ang) });
  });

  // Empresas mismo domicilio → cuelgan de la empresa principal hacia la derecha-abajo
  empresasDomicilio.forEach((_e: any, i: number) => {
    const id = `co_d_${i}`;
    const slots = empresasDomicilio.length;
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (Math.PI * 0.05) + (Math.PI * 0.45) * t; // de 9° a 90°
    positions.set(id, { x: mp.x + R2_dom * Math.cos(ang), y: mp.y + R2_dom * Math.sin(ang) });
  });

  // Contratos → cuelgan a la derecha de la empresa principal
  contratosFiltrados.forEach((_c: any, i: number) => {
    const id = `ct_${i}`;
    const slots = contratosFiltrados.length;
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (-Math.PI * 0.4) + (Math.PI * 0.6) * t; // arco derecho-superior
    positions.set(id, { x: mp.x + R2_co * Math.cos(ang), y: mp.y + R2_co * Math.sin(ang) });
  });

  // Pareja / familia → arco inferior (cerca de la persona). Hasta 8.
  familia.slice(0, 8).forEach((f: any, i: number) => {
    const id = `fa_${i}`;
    const slots = Math.min(familia.length, 8);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    // Arco inferior ampliado (de 30° a 150°)
    const ang = (Math.PI * 0.2) + (Math.PI * 0.6) * t;
    const radio = R1 - 10;
    const fx = cx + radio * Math.cos(ang);
    const fy = cy + radio * Math.sin(ang);
    positions.set(id, { x: fx, y: fy });
    // Sub-nodos: municipios donde trabaja el familiar (cargos públicos)
    const cargosFam = (f.cargos_publicos || f.cargos || []) as any[];
    cargosFam.slice(0, 2).forEach((_c: any, j: number) => {
      const subId = `fa_${i}_mun_${j}`;
      // Si hay 1, debajo; si hay 2, abrir en abanico
      const offsetAng = cargosFam.length === 1 ? Math.PI * 0.5 : (Math.PI * 0.3 + Math.PI * 0.4 * j);
      const subR = 110;
      const munX = fx + subR * Math.cos(offsetAng);
      const munY = fy + subR * Math.sin(offsetAng);
      positions.set(subId, { x: munX, y: munY });
      // Si tiene partido derivado, lo posicionamos al lado del municipio
      const partidoVal = (_c?.partido_municipio || _c?.partido_alcalde || _c?.partido || "").trim();
      const partidoUpper = partidoVal.toUpperCase();
      const partidoIgual = partidoUpper && partidoMunicipioContratante &&
        partidoUpper === partidoMunicipioContratante;
      if (partidoVal && !partidoIgual) {
        const ptId = `fa_${i}_mun_${j}_pt`;
        // Posicionar el nodo partido justo debajo del municipio
        positions.set(ptId, { x: munX, y: munY + 75 });
      }
    });
  });

  // Autoridades públicas → arco derecho (cerca pero por fuera del proveedor)
  autoridades.slice(0, 5).forEach((_a: any, i: number) => {
    const id = `au_${i}`;
    const slots = Math.min(autoridades.length, 5);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (-Math.PI * 0.15) + (Math.PI * 0.3) * t; // sector derecho ampliado
    positions.set(id, { x: cx + (R1 + 50) * Math.cos(ang), y: cy + (R1 + 50) * Math.sin(ang) });
  });

  // Firmantes con conflicto → arco inferior izquierdo (lugar visible y alerta)
  cruceFirmantes.slice(0, 3).forEach((_c: any, i: number) => {
    const id = `fc_${i}`;
    const slots = Math.min(cruceFirmantes.length, 3);
    const t = slots <= 1 ? 0.5 : i / (slots - 1);
    const ang = (Math.PI * 0.75) + (Math.PI * 0.2) * t;
    positions.set(id, { x: cx + (R1 + 20) * Math.cos(ang), y: cy + (R1 + 20) * Math.sin(ang) });
  });

  // ─── CLUSTER ENTIDAD CONTRATANTE: a la derecha ───
  // Entidad: arriba-derecha pero más cerca del centro para que entre en viewport
  const entAng = -Math.PI / 6; // -30°
  const entR = 260;
  if (positions.has(idCompanyMain) && entidadContratante) {
    positions.set(idEntidad, {
      x: cx + entR * Math.cos(entAng),
      y: cy + entR * Math.sin(entAng),
    });
    const ep = positions.get(idEntidad)!;
    // Alcalde: justo arriba de la entidad
    if (alcaldeData) {
      positions.set("alcalde_actual", { x: ep.x, y: ep.y - 90 });
    }
    // Funcionarios designados: alrededor de la entidad en arco derecho amplio
    designadosMostrados.forEach((_f: any, i: number) => {
      const slots = designadosMostrados.length;
      const t = slots <= 1 ? 0.5 : i / (slots - 1);
      const a = -Math.PI * 0.5 + Math.PI * 1.0 * t; // -90° a +90°
      positions.set(`fd_${i}`, { x: ep.x + 130 * Math.cos(a), y: ep.y + 130 * Math.sin(a) });
    });

    // F1: Postores rivales — arco izquierdo del cluster entidad
    sociosPostoresRivales.slice(0, 4).forEach((pr: any, i: number) => {
      const slots = Math.min(sociosPostoresRivales.length, 4);
      const t = slots <= 1 ? 0.5 : i / (slots - 1);
      const a = Math.PI * 0.8 + Math.PI * 0.4 * t; // arco a la izquierda de la entidad
      const prX = ep.x + 180 * Math.cos(a);
      const prY = ep.y + 180 * Math.sin(a);
      positions.set(`pr_${i}`, { x: prX, y: prY });
      // Socios del postor rival: cuelgan más lejos
      (pr.socios || []).slice(0, 2).forEach((_s: any, j: number) => {
        const sAng = j === 0 ? Math.PI * 0.85 : Math.PI * 1.15;
        positions.set(`pr_${i}_s_${j}`, {
          x: prX + 90 * Math.cos(sAng),
          y: prY + 90 * Math.sin(sAng),
        });
      });
    });

    // F2: Entidades secundarias por visita inter-municipal — debajo de la entidad
    visitasInterMun.slice(0, 4).forEach((_v: any, i: number) => {
      const entRep = (_v.entidad_representada || "").trim().toUpperCase();
      if (!entRep) return;
      // posición debajo-derecha
      positions.set(`es_${i}`, { x: ep.x + 30 + i * 60, y: ep.y + 200 });
    });
  }

  // ─── Spread anti-overlap: separar nodos colisionados (max 50 iter) ───
  // Radio efectivo más generoso porque los rects ahora pueden tener wrap
  // de 2-3 líneas (≈70-100 px ancho × 50 alto).
  const nodeRadius = (kind: GraphNode["kind"]): number => {
    if (kind === "person") return 60;
    if (kind === "entidad") return 60;
    if (kind === "company_main") return 55;
    if (kind === "contract") return 48;
    if (kind === "alcalde" || kind === "funcionario_designado") return 50;
    return 52;
  };
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const ni = nodes[i], nj = nodes[j];
        const a = positions.get(ni.id);
        const b = positions.get(nj.id);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = nodeRadius(ni.kind) + nodeRadius(nj.kind) + 12;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          // El nodo persona no se mueve (centro)
          if (ni.kind !== "person") { a.x -= ux * push; a.y -= uy * push; }
          if (nj.kind !== "person") { b.x += ux * push; b.y += uy * push; }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  // El viewBox base es 920×600 pero al haber zoom + pan, los nodos pueden
  // ir más allá. Solo evitamos que se solapen con la persona (centro).
  // No clampeamos — el user puede arrastrar el grafo con pan.
  // Aplicar overrides por drag (el user arrastró esos nodos)
  Object.entries(posOverride).forEach(([id, p]) => {
    if (positions.has(id)) positions.set(id, p);
  });

  // Estilos por tipo
  const styleNode = (kind: GraphNode["kind"]) => {
    switch (kind) {
      case "person":              return { fill: "#7a3b2e", stroke: "#7a3b2e", text: "#fff", r: 38 };
      case "pareja":              return { fill: "#faf5ff", stroke: "#7c3aed", text: "#4c1d95", r: 24 };
      case "company_main":        return { fill: "#fff", stroke: "#c2410c", text: "#1a1a1a", r: 30 };
      case "company_titular":     return { fill: "#fff7ed", stroke: "#d97706", text: "#92400e", r: 24 };
      case "company_domicilio":   return { fill: "#fef2f2", stroke: "#b91c1c", text: "#7f1d1d", r: 22 };
      case "party":               return { fill: "#fef2f2", stroke: "#991b1b", text: "#7f1d1d", r: 22 };
      case "cargo_pasado":        return { fill: "#f5f5f4", stroke: "#525252", text: "#262626", r: 20 };
      case "autoridad":           return { fill: "#fefce8", stroke: "#ca8a04", text: "#713f12", r: 22 };
      case "firmante_conflicto":  return { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d", r: 22 };
      case "contract":            return { fill: "#fffbeb", stroke: "#a16207", text: "#713f12", r: 18 };
      // Nuevos: cluster entidad contratante
      case "entidad":             return { fill: "#1e3a8a", stroke: "#1e3a8a", text: "#fff",    r: 34 };
      case "alcalde":             return { fill: "#dbeafe", stroke: "#1e3a8a", text: "#1e3a8a", r: 26 };
      case "funcionario_designado":return { fill: "#eff6ff", stroke: "#3b82f6", text: "#1e40af", r: 22 };
      // Cargo público de un familiar → municipio donde trabaja
      case "municipio_familiar":  return { fill: "#f3e8ff", stroke: "#6b21a8", text: "#581c87", r: 24 };
      // Partido político derivado (del municipio del familiar)
      case "partido_compartido":  return { fill: "#fef2f2", stroke: "#991b1b", text: "#7f1d1d", r: 20 };
      // Postor rival (no ganador)
      case "postor_rival":        return { fill: "#fff7ed", stroke: "#9a3412", text: "#7c2d12", r: 24 };
      // Socio del postor rival que es funcionario público — bandera ALTA
      case "socio_postor_conflicto": return { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d", r: 26 };
      // Entidad secundaria por doble vinculación de un funcionario
      case "entidad_secundaria":  return { fill: "#ecfeff", stroke: "#0e7490", text: "#155e75", r: 22 };
    }
  };
  const styleEdge = (kind: GraphEdge["kind"]) => {
    switch (kind) {
      case "titular":              return { color: "#d97706", width: 2,   dash: "" };
      case "domicilio":            return { color: "#b91c1c", width: 2,   dash: "4 4" };
      case "candidato":            return { color: "#991b1b", width: 1.5, dash: "6 3" };
      case "aporte":               return { color: "#dc2626", width: 2,   dash: "" };
      case "cargo":                return { color: "#525252", width: 1.5, dash: "2 3" };
      case "contrato":             return { color: "#a16207", width: 1.2, dash: "" };
      case "pareja":               return { color: "#7c3aed", width: 2.5, dash: "" };
      case "autoridad":            return { color: "#ca8a04", width: 2,   dash: "5 2" };
      case "firma_conflicto":      return { color: "#dc2626", width: 3,   dash: "" };
      // Nuevos
      case "adjudicacion":         return { color: "#1e3a8a", width: 3,   dash: "" };
      case "preside_entidad":      return { color: "#1e3a8a", width: 2,   dash: "" };
      case "designado_por":        return { color: "#3b82f6", width: 1.5, dash: "3 3" };
      case "conflicto_funcionario":return { color: "#dc2626", width: 3,   dash: "" };
      // Familiar trabaja en municipio
      case "trabaja_en":           return { color: "#6b21a8", width: 1.5, dash: "" };
      // Partido del municipio (cuando NO coincide con el contratante)
      case "partido_de":           return { color: "#991b1b", width: 1.2, dash: "4 4" };
      // ⚠ MISMO PARTIDO que el municipio que contrata — alerta cruzada
      case "mismo_partido_que":    return { color: "#dc2626", width: 3.5, dash: "2 4" };
      // Postor rival compitió por el contrato
      case "compitio":             return { color: "#9a3412", width: 1.2, dash: "5 3" };
      // Socio de postor rival
      case "socio_de":             return { color: "#9a3412", width: 1.5, dash: "" };
      // Funcionario visitó otra entidad
      case "visito":               return { color: "#0e7490", width: 1.2, dash: "3 3" };
      // Doble vinculación inter-municipal
      case "doble_vinculacion":    return { color: "#0e7490", width: 2,   dash: "5 2" };
    }
  };

  // ─── Convertir coord de mouse a SVG ───
  const mouseToSvg = (clientX: number, clientY: number) => {
    if (!svgRef.current) return null;
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const handleNodeMouseDown = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const pos = positions.get(id);
    if (!pos) return;
    draggedRef.current = id;
    dragStartRef.current = { mx: e.clientX, my: e.clientY, nx: pos.x, ny: pos.y };
    wasDraggedRef.current = false;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Si se está arrastrando un nodo
      if (draggedRef.current && dragStartRef.current) {
        const start = dragStartRef.current;
        const moved = Math.hypot(e.clientX - start.mx, e.clientY - start.my);
        if (moved > 4) wasDraggedRef.current = true;
        const startSvg = mouseToSvg(start.mx, start.my);
        const nowSvg = mouseToSvg(e.clientX, e.clientY);
        if (!startSvg || !nowSvg) return;
        const dx = nowSvg.x - startSvg.x;
        const dy = nowSvg.y - startSvg.y;
        const newPos = { x: start.nx + dx, y: start.ny + dy };
        setPosOverride(prev => ({ ...prev, [draggedRef.current!]: newPos }));
        return;
      }
      // Si se está paneando el fondo
      if (panningRef.current) {
        const start = panningRef.current;
        // Movimiento del mouse en px → traducir a unidades SVG según escala actual
        const scaleX = viewBox.w / (svgRef.current?.clientWidth || viewBox.w);
        const scaleY = viewBox.h / (svgRef.current?.clientHeight || viewBox.h);
        const dx = (e.clientX - start.mx) * scaleX;
        const dy = (e.clientY - start.my) * scaleY;
        setViewBox(v => ({ ...v, x: start.vx - dx, y: start.vy - dy }));
      }
    };
    const onUp = () => {
      draggedRef.current = null;
      dragStartRef.current = null;
      panningRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [viewBox.w, viewBox.h]);

  // Pan: drag del fondo del SVG (no de un nodo)
  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    panningRef.current = {
      mx: e.clientX, my: e.clientY,
      vx: viewBox.x, vy: viewBox.y,
    };
  };

  // Zoom con wheel: factor depende del scroll, centrado en el cursor
  // Base = 1440 (viewBox default amplio) → "100%" en el indicador
  const VBASE_W = 1440;
  const VBASE_H = 940;
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const minW = VBASE_W * 0.25, maxW = VBASE_W * 3;
    const newW = Math.max(minW, Math.min(maxW, viewBox.w * factor));
    const newH = newW * (VBASE_H / VBASE_W);
    const svgPt = mouseToSvg(e.clientX, e.clientY);
    if (!svgPt) return;
    const dx = (svgPt.x - viewBox.x) * (newW / viewBox.w - 1);
    const dy = (svgPt.y - viewBox.y) * (newH / viewBox.h - 1);
    setViewBox({ x: viewBox.x - dx, y: viewBox.y - dy, w: newW, h: newH });
  };

  const handleZoom = (factor: number) => {
    const minW = VBASE_W * 0.25, maxW = VBASE_W * 3;
    const newW = Math.max(minW, Math.min(maxW, viewBox.w * factor));
    const newH = newW * (VBASE_H / VBASE_W);
    const cxv = viewBox.x + viewBox.w / 2;
    const cyv = viewBox.y + viewBox.h / 2;
    setViewBox({ x: cxv - newW / 2, y: cyv - newH / 2, w: newW, h: newH });
  };

  const resetViewBox = () => setViewBox({ x: -260, y: -170, w: 1440, h: 940 });

  const handleNodeClick = (id: string) => () => {
    // Si el user arrastró el nodo, no abrir panel de detalle
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }
    setSelectedId(prev => prev === id ? null : id);
  };

  // Reset de overrides cuando cambia la data subyacente
  const dataSignature = `${nodes.length}-${edges.length}`;
  useEffect(() => {
    setPosOverride({});
  }, [dataSignature]);

  // Panel resumen: contar nodos por tipo y banderas red
  const nodesByKind = nodes.reduce((acc: Record<string, number>, n) => {
    acc[n.kind] = (acc[n.kind] || 0) + 1;
    return acc;
  }, {});
  const edgesByKind = edges.reduce((acc: Record<string, number>, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1;
    return acc;
  }, {});
  const banderasRed: any[] = person?.banderas_red || [];
  const banderasAlta = banderasRed.filter((b) => b.severidad === "alta");
  const banderasMedia = banderasRed.filter((b) => b.severidad === "media");

  const summaryCards = [
    {
      key: "personas",
      label: "Personas mapeadas",
      count: (nodesByKind.person || 0) + (nodesByKind.pareja || 0) + (nodesByKind.autoridad || 0)
           + (nodesByKind.alcalde || 0) + (nodesByKind.funcionario_designado || 0),
      hint: "proveedor + autoridades + designados",
      color: "bg-clay/10 text-clay border-clay/30",
    },
    {
      key: "empresas",
      label: "Empresas vinculadas",
      count: (nodesByKind.company_main || 0) + (nodesByKind.company_titular || 0) + (nodesByKind.company_domicilio || 0),
      hint: "con mismo titular o domicilio",
      color: "bg-amber/10 text-amber border-amber/30",
    },
    {
      key: "vinculos",
      label: "Vínculos detectados",
      count: edges.length,
      hint: edgesByKind.titular ? `${edgesByKind.titular} de titularidad` : "relaciones formales",
      color: "bg-moss/10 text-moss border-moss/30",
    },
    {
      key: "banderas_red",
      label: "Banderas de red",
      count: banderasRed.length,
      hint: banderasAlta.length > 0 ? `${banderasAlta.length} alta · ${banderasMedia.length} media` : "sin riesgo detectado",
      color: banderasAlta.length > 0 ? "bg-rust/15 text-rust border-rust/40" : "bg-paperSoft text-mute border-line",
    },
  ];

  return (
    <div className="border-t border-line bg-paperSoft px-5 py-5">
      {/* PANEL RESUMEN — primero, antes del grafo */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summaryCards.map((c) => (
          <div key={c.key} className={cn("rounded-lg border px-3 py-2", c.color)}>
            <div className="text-[9px] font-bold uppercase tracking-widest opacity-80">{c.label}</div>
            <div className="mt-0.5 font-mono text-2xl font-bold leading-none">{c.count}</div>
            <div className="mt-1 text-[10px] italic opacity-70">{c.hint}</div>
          </div>
        ))}
      </div>

      {/* HALLAZGOS DE RED — bullets clave */}
      {banderasRed.length > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-paper px-3 py-2.5">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
            ⚡ Hallazgos clave de la red empresarial
          </div>
          <ul className="space-y-1">
            {banderasRed.slice(0, 6).map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className={cn(
                  "mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                  b.severidad === "alta" ? "bg-rust text-paper" :
                  b.severidad === "media" ? "bg-amber text-paper" :
                  "bg-paperDeep text-mute",
                )}>
                  {b.severidad || "info"}
                </span>
                <div>
                  <span className="font-semibold text-ink">{b.titulo || b.tipo || "Hallazgo"}</span>
                  {b.descripcion && (
                    <span className="ml-1.5 text-inkSoft">— {redactDnis(String(b.descripcion).slice(0, 220))}{String(b.descripcion).length > 220 ? "…" : ""}</span>
                  )}
                  {b.requiere_verificacion && (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-soft px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-amber">⏳ requiere verificación</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Network size={11} className="mr-1 inline" />
          Grafo de relaciones · arrastrá los nodos para reorganizar
        </h3>
        {Object.keys(posOverride).length > 0 && (
          <button
            type="button"
            onClick={() => setPosOverride({})}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink hover:bg-paperDeep"
            title="Volver al layout automático"
          >
            <RotateCcw size={10} /> Resetear posiciones
          </button>
        )}
        <div className="flex flex-wrap gap-2 text-[9px] text-mute">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#d97706" }} />
            titular
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#b91c1c", backgroundImage: "repeating-linear-gradient(90deg,#b91c1c 0 2px,transparent 2px 4px)" }} />
            mismo domicilio
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#dc2626" }} />
            aporte ONPE
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#525252", backgroundImage: "repeating-linear-gradient(90deg,#525252 0 1px,transparent 1px 3px)" }} />
            cargo público
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#a16207" }} />
            contrato
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#7c3aed" }} />
            pareja / familia
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#ca8a04", backgroundImage: "repeating-linear-gradient(90deg,#ca8a04 0 3px,transparent 3px 5px)" }} />
            autoridad pública
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded" style={{ background: "#dc2626", height: 4 }} />
            firmante en conflicto
          </span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-line bg-paper">
        {/* Controles de zoom flotantes */}
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1 rounded-lg border border-line bg-paper/95 p-1 shadow-card backdrop-blur-sm">
          <button
            type="button"
            onClick={() => handleZoom(0.85)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Acercar"
          >
            <span className="text-base font-bold leading-none">+</span>
          </button>
          <button
            type="button"
            onClick={() => handleZoom(1.18)}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Alejar"
          >
            <span className="text-base font-bold leading-none">−</span>
          </button>
          <button
            type="button"
            onClick={resetViewBox}
            className="flex h-7 w-7 items-center justify-center rounded text-ink hover:bg-paperDeep"
            title="Resetear zoom"
          >
            <RotateCcw size={12} />
          </button>
          <div className="text-center text-[8px] font-mono text-mute">
            {Math.round(1440 / viewBox.w * 100)}%
          </div>
        </div>

        {/* Hint sutil */}
        <div className="absolute left-2 top-2 z-10 rounded-md bg-paperDeep/80 px-2 py-0.5 text-[9px] text-mute backdrop-blur-sm">
          rueda = zoom · arrastrá fondo = mover · click nodo = detalle
        </div>

        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="block h-[600px] w-full select-none"
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: panningRef.current ? "grabbing" : "default" }}
          onWheel={handleWheel}
          onMouseDown={handleBackgroundMouseDown}
        >
          {/* Fondo invisible para capturar pan en zonas sin nodos */}
          <rect
            x={viewBox.x - 1000} y={viewBox.y - 1000}
            width={viewBox.w + 2000} height={viewBox.h + 2000}
            fill="transparent"
          />

          {/* Aristas */}
          {edges.map((e, i) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            const st = styleEdge(e.kind);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            return (
              <g key={`e_${i}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={st.color} strokeWidth={st.width} strokeDasharray={st.dash}
                      opacity={0.7} />
                {e.label && (
                  <text x={mx} y={my - 4} fontSize="9" fill={st.color}
                        textAnchor="middle" style={{ paintOrder: "stroke", stroke: "#fafafa", strokeWidth: 3 }}>
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodos */}
          {nodes.map((n) => {
            const pos = positions.get(n.id);
            if (!pos) return null;
            const s = styleNode(n.kind);
            const isSelected = selectedId === n.id;
            // Wrap inteligente: dividir el label en líneas de ~16 chars
            const lines = wrapText(n.label, 16, 3);
            const longestLine = lines.reduce((m, l) => Math.max(m, l.length), 0);
            // Ancho del rect = max línea × ancho promedio de char + padding
            const wRect = Math.max(80, Math.min(220, longestLine * 6.2 + 16));
            // Alto del rect = base + extra por cada línea adicional
            const baseH = n.sublabel ? 22 : 14;
            const lineH = 12;
            const hRect = baseH + lines.length * lineH;

            if (n.kind === "person") {
              const initials = (n.label || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
              return (
                <g key={n.id} onClick={handleNodeClick(n.id)} onMouseDown={handleNodeMouseDown(n.id)} style={{ cursor: "grab" }}>
                  <title>{(n.tooltip || n.label) + " · arrastrá para mover · click para detalle"}</title>
                  {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={s.r + 6} fill="none" stroke={s.stroke} strokeWidth={2} opacity={0.4}>
                      <animate attributeName="r" values={`${s.r + 6};${s.r + 10};${s.r + 6}`} dur="1.5s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={pos.x} cy={pos.y} r={s.r} fill={s.fill} stroke={s.stroke} strokeWidth={isSelected ? 3 : 2} />
                  <text x={pos.x} y={pos.y + 5} fontSize="20" fontWeight="700" fill={s.text} textAnchor="middle" style={{ pointerEvents: "none" }}>
                    {initials || "?"}
                  </text>
                  {/* Label multilinea */}
                  <text x={pos.x} y={pos.y + s.r + 13} fontSize="11" fontWeight="700" fill="#1a1a1a" textAnchor="middle"
                        style={{ paintOrder: "stroke", stroke: "#fafafa", strokeWidth: 3, pointerEvents: "none" }}>
                    {lines.map((l, idx) => (
                      <tspan key={idx} x={pos.x} dy={idx === 0 ? 0 : 13}>{l}</tspan>
                    ))}
                  </text>
                  {n.sublabel && (
                    <text x={pos.x} y={pos.y + s.r + 13 + lines.length * 13 + 2} fontSize="9" fill="#525252" textAnchor="middle"
                          style={{ paintOrder: "stroke", stroke: "#fafafa", strokeWidth: 3, pointerEvents: "none" }}>
                      {n.sublabel}
                    </text>
                  )}
                </g>
              );
            }
            return (
              <g key={n.id} onClick={handleNodeClick(n.id)} onMouseDown={handleNodeMouseDown(n.id)} style={{ cursor: "grab" }}>
                <title>{(n.tooltip || n.label) + " · arrastrá para mover · click para detalle"}</title>
                {isSelected && (
                  <rect x={pos.x - wRect / 2 - 4} y={pos.y - hRect / 2 - 4} width={wRect + 8} height={hRect + 8} rx={10}
                        fill="none" stroke={s.stroke} strokeWidth={2} opacity={0.5}>
                    <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" repeatCount="indefinite" />
                  </rect>
                )}
                <rect x={pos.x - wRect / 2} y={pos.y - hRect / 2} width={wRect} height={hRect} rx={8}
                      fill={s.fill} stroke={s.stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
                {/* Texto principal con wrap multilinea */}
                <text
                  x={pos.x}
                  y={pos.y - hRect / 2 + 12}
                  fontSize="10"
                  fontWeight="700"
                  fill={s.text}
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {lines.map((l, idx) => (
                    <tspan key={idx} x={pos.x} dy={idx === 0 ? 0 : 11}>{l}</tspan>
                  ))}
                </text>
                {n.sublabel && (
                  <text
                    x={pos.x}
                    y={pos.y - hRect / 2 + 12 + lines.length * 11 + 4}
                    fontSize="8.5"
                    fill={s.text}
                    opacity={0.75}
                    textAnchor="middle"
                    style={{ pointerEvents: "none" }}
                  >
                    {n.sublabel.length > 28 ? n.sublabel.slice(0, 26) + "…" : n.sublabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Panel de detalle del nodo seleccionado */}
      {selectedId && (() => {
        const node = nodes.find(n => n.id === selectedId);
        if (!node) return null;
        return (
          <NodeDetailPanel
            node={node}
            onClose={() => setSelectedId(null)}
            onVigiaSearch={(ruc) => router.push(`/app/convocatoria?q=${encodeURIComponent(ruc)}`)}
          />
        );
      })()}

    </div>
  );
}
