// Cálculo puro del grafo de red (nodos + aristas + layout polar) desde las props de
// RelationshipGraph — sin JSX, sin hooks, sin refs: solo depende de person/web/proveedor/ctx.
// Separado del componente (que sigue en RelationshipGraph.tsx) para que ninguno de los dos
// archivos pase de 800 líneas.
import type { GraphNode, GraphEdge } from "../types";
import { esPersonaNatural, maskApellido, maskDnis } from "../../Redact";
import { evidenciaComoTexto } from "./Evidencia";

// El grafo es SVG sin clic-para-revelar en las etiquetas: los datos personales
// se enmascaran acá, antes de llegar al dibujo. El panel de detalle (HTML) es
// el que ofrece el vidrio revelable.

/**
 * Enmascara el apellido materno de un nombre en orden SUNAT/RNP
 * (APELLIDO APELLIDO NOMBRE): la SEGUNDA palabra. `maskApellido` tapa la
 * última, que en este orden es el nombre de pila y dejaba los dos apellidos
 * a la vista.
 */
function maskApellidoSunat(name?: string | null): string {
  const n = (name || "").trim();
  if (!n) return n;
  const parts = n.split(/\s+/);
  if (parts.length < 2) return n;
  const k = parts.length >= 3 ? 1 : 0;
  parts[k] = "•".repeat(Math.min(Math.max(parts[k].length, 3), 8));
  return parts.join(" ");
}

/** Nombre de una parte (proveedor, postor): persona natural (RUC 10) → enmascarado; empresa → tal cual. */
const nombreParte = (nombre: string, ruc?: string | null) => (esPersonaNatural(ruc) ? maskApellidoSunat(nombre) : nombre);

/** "sin_vinculo" → "sin vinculo". Los enums del backend no se muestran crudos. */
const ACENTOS: Record<string, string> = { "sin vinculo": "sin vínculo", vinculo: "vínculo", "posible familiar": "posible familiar" };
const legible = (v: unknown) => {
  const t = String(v ?? "").replace(/_/g, " ").trim();
  return ACENTOS[t.toLowerCase()] ?? t;
};

/** Une partes de un tooltip con comas, sin dejar huecos. */
const unir = (...partes: unknown[]) =>
  partes.map((x) => (x == null ? "" : String(x).trim())).filter(Boolean).join(", ");

export function buildRelationshipGraphData(
  person: any,
  web: any,
  proveedor: any,
  ctx: any,
): { nodes: GraphNode[]; edges: GraphEdge[]; positions: Map<string, { x: number; y: number }> } | null {
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

  const personaEsProveedorNatural =
    esPersonaNatural(proveedorRuc) &&
    String(p.nombre_completo || "").trim().toUpperCase() === String(proveedor?.nombre || "").trim().toUpperCase();
  nodes.push({
    id: idPerson, kind: "person",
    // "Persona no identificada" no es un nombre: no se enmascara.
    label: !p.nombre_completo
      ? personLabel
      : personaEsProveedorNatural ? maskApellidoSunat(personLabel) : maskApellido(personLabel),
    sublabel: p.cargo_actual || (p.dni ? `DNI ${maskDnis(String(p.dni))}` : undefined),
    meta: { dni: p.dni, cargo: p.cargo_actual, fuente_url: p.datosperu_url || p.linkedin },
  });

  // Empresa principal (proveedor de la convocatoria actual)
  const proveedorEtiqueta = nombreParte(proveedorNombre, proveedorRuc);
  nodes.push({
    id: idCompanyMain, kind: "company_main",
    label: proveedorEtiqueta.length > 36 ? proveedorEtiqueta.slice(0, 33) + "…" : proveedorEtiqueta,
    sublabel: proveedorRuc ? `RUC ${maskDnis(String(proveedorRuc))}` : undefined,
    tooltip: proveedorEtiqueta,
    meta: { ruc: proveedorRuc, razon_social: proveedorNombre, rol: "Proveedor de la convocatoria actual" },
  });
  edges.push({ from: idPerson, to: idCompanyMain, kind: "titular", label: "rep. legal" });

  // Otras empresas con mismo titular
  empresasTitular.forEach((e: any, i: number) => {
    const id = `co_t_${i}`;
    const lbl = (e.razon_social ? nombreParte(e.razon_social, e.ruc) : `RUC ${maskDnis(String(e.ruc ?? ""))}`) as string;
    nodes.push({
      id, kind: "company_titular",
      label: lbl.length > 34 ? lbl.slice(0, 31) + "…" : lbl,
      sublabel: e.ruc ? `RUC ${maskDnis(String(e.ruc))}` : undefined,
      tooltip: unir(lbl, legible(e.rol_del_gerente)),
      meta: { ruc: e.ruc, razon_social: e.razon_social, rol: legible(e.rol_del_gerente) || "Titular o socio" },
    });
    edges.push({ from: idPerson, to: id, kind: "titular", label: legible(e.rol_del_gerente) || "titular" });
  });

  // Empresas mismo domicilio
  empresasDomicilio.forEach((e: any, i: number) => {
    const id = `co_d_${i}`;
    const lbl = (e.razon_social ? nombreParte(e.razon_social, e.ruc) : `RUC ${maskDnis(String(e.ruc ?? ""))}`) as string;
    nodes.push({
      id, kind: "company_domicilio",
      label: lbl.length > 34 ? lbl.slice(0, 31) + "…" : lbl,
      sublabel: e.direccion ? "mismo domicilio" : undefined,
      tooltip: unir(lbl, e.direccion || "mismo domicilio fiscal"),
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
      tooltip: unir(c.cargo, `${inst}${c.periodo ? " (" + c.periodo + ")" : ""}`),
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
    const parentesco = legible(f.parentesco);
    nodes.push({
      id, kind: "pareja",
      label: nombre,
      sublabel: parentesco || "vínculo familiar",
      tooltip: unir(nombre, parentesco, maskDnis(f.detalles)),
      meta: { rol: parentesco, observacion: f.detalles || evidenciaComoTexto(f.evidencia) || undefined, fuente_url: f.fuente_url },
    });
    edges.push({ from: idPerson, to: id, kind: "pareja", label: parentesco || "familiar" });

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
          ? unir(c.cargo, c.periodo)
          : (c.periodo || "cargo público"),
        tooltip: `${nombre} es ${c.cargo || "funcionario"} en ${entidad}${
          partido ? ", con alcalde del partido " + partido : ""
        }${esMismoMunicipio ? ". ⚠ Es el mismo municipio que contrata" : ""}`,
        meta: {
          cargo: c.cargo,
          institucion: entidad,
          periodo: c.periodo,
          partido,
          fuente_url: c.fuente_url,
          observacion: c.observacion
            || `${parentesco || "Familiar"} del titular del proveedor${
              esMismoMunicipio ? ". Trabaja en el MISMO municipio que contrata" : ""
            }${compartePartido ? ". Mismo partido que el alcalde que contrata" : ""}`,
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
    // `evidencia` llega como string o como lista de citas: se aplana a texto.
    const obs = a.descripcion || evidenciaComoTexto(a.evidencia) || undefined;
    const fuente = /^https?:\/\//i.test(String(a.fuente_url || "")) ? a.fuente_url : undefined;
    nodes.push({
      id, kind: "autoridad",
      label: nombre,
      sublabel: a.cargo || a.entidad,
      tooltip: unir(nombre, a.cargo, a.entidad),
      meta: { cargo: a.cargo, institucion: a.entidad, observacion: obs, fuente_url: fuente, rol: legible(a.vinculo_con_gerente) },
    });
    edges.push({
      from: idPerson, to: id, kind: "autoridad",
      label: legible(a.vinculo_con_gerente) || "vínculo",
    });
  });

  // Firmantes con conflicto (NUEVO) — viñetazo rojo
  cruceFirmantes.slice(0, 3).forEach((c: any, i: number) => {
    const id = `fc_${i}`;
    const nombre = maskApellido((c.firmante || "Firmante") as string);
    const relacion = legible(c.tipo_relacion);
    nodes.push({
      id, kind: "firmante_conflicto",
      label: nombre.length > 26 ? nombre.slice(0, 23) + "…" : nombre,
      sublabel: relacion || "relación detectada",
      tooltip: unir(nombre, c.cargo_firmante, c.entidad_firmante),
      meta: {
        cargo: c.cargo_firmante, institucion: c.entidad_firmante,
        observacion: c.descripcion || evidenciaComoTexto(c.evidencia) || undefined,
        fuente_url: /^https?:\/\//i.test(String(c.fuente_url || "")) ? c.fuente_url : undefined,
        rol: relacion,
      },
    });
    edges.push({
      from: idPerson, to: id, kind: "firma_conflicto",
      label: relacion || "conflicto",
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
      tooltip: `${ent}${c.objeto ? ": " + c.objeto : ""}`,
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
      tooltip: unir(nombre, alcaldeData.partido, alcaldeData.periodo),
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
      ? `, ${hallazgosCount} hallazgo${hallazgosCount === 1 ? "" : "s"}`
      : "";
    nodes.push({
      id, kind: "funcionario_designado",
      label: nombre,
      sublabel: cargo + sublabelExtra,
      tooltip: unir(
        nombre,
        `${cargo}${f.fecha_designacion ? " (desde " + f.fecha_designacion + ")" : ""}`,
        conf === "muy_baja" || conf === "sin_lookup" ? "⚠ sin DNI verificado" : "",
      ),
      meta: {
        cargo, institucion: f.area, dni: f.dni,
        fuente_url: f.fuente_url,
        observacion: conf === "muy_baja" || conf === "sin_lookup"
          ? "Sin DNI verificado: los hallazgos por nombre son coincidencias aproximadas y pueden ser homónimos."
          : (Array.isArray(f.hallazgos_summary) ? f.hallazgos_summary.join("; ") : ""),
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
    const razonEtiqueta = nombreParte(razon, pr.ruc_postor);
    nodes.push({
      id, kind: "postor_rival",
      label: razonEtiqueta,
      sublabel: pr.ruc_postor ? `RUC ${maskDnis(String(pr.ruc_postor))}` : "postor no ganador",
      tooltip: unir(razonEtiqueta, "postor no ganador", pr.n_socios ? `${pr.n_socios} socio${pr.n_socios === 1 ? "" : "s"}` : ""),
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
      // Los socios salen del RNP, que publica APELLIDO APELLIDO NOMBRE.
      const socioEtiqueta = maskApellidoSunat(nombre);
      const rol = legible(s.rol_en_postor) || "socio";
      nodes.push({
        id: socId,
        kind: esFuncionarioActivo ? "socio_postor_conflicto" : "company_titular",
        label: socioEtiqueta,
        sublabel: s.dni ? `DNI ${maskDnis(String(s.dni))}` : rol,
        tooltip: unir(
          socioEtiqueta,
          s.dni ? "DNI " + maskDnis(String(s.dni)) : "",
          rol,
          esFuncionarioActivo ? "⚠ FUNCIONARIO PÚBLICO ACTIVO" : "",
        ),
        meta: {
          dni: s.dni, rol,
          observacion: esFuncionarioActivo
            ? "⚠ Socio de postor rival es funcionario público activo en la región"
            : `Socio de postor no ganador (${razonEtiqueta})`,
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
      tooltip: `${v.persona ? maskApellido(v.persona) : "Un funcionario"} representó a ${entRep} en visita a ${
        v.entidad_visitada || "entidad pública"
      }${v.fecha ? " (" + v.fecha + ")" : ""}`,
      meta: {
        entidad: entRep,
        observacion: `${v.persona ? maskApellido(v.persona) : "Un funcionario"} (funcionario de ${entidadContratante?.nombre || "la entidad"}) representó a esta otra entidad`,
        rol: "Entidad secundaria, doble vinculación detectada",
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

  return { nodes, edges, positions };
}
