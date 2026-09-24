/**
 * Dossier guardado (GET /alertas/:id/full, o GET /admin/revision/:id/informe para el panel) →
 * la forma que renderiza <ResultadoView>, la misma que devuelve /api/agent/analyze.
 *
 * Módulo puro, sin nada de servidor: lo usan la ruta /api/agent/history/[ocid] (servidor) y la
 * vista previa del informe en /admin/revision/[id] (cliente). Una sola adaptación para las dos
 * superficies: el panel ve exactamente lo que verá el público al publicar.
 */

/** Perfil del pipeline registrado en la traza (`result_preview.perfil.nombre`), si quedó. */
export function perfilDeTraza(trace: unknown): string | null {
  if (!Array.isArray(trace)) return null;
  for (const ev of trace) {
    const p = (ev as any)?.result_preview?.perfil;
    const nombre = typeof p === "string" ? p : p?.nombre;
    if (typeof nombre === "string" && /^[a-z_]{3,30}$/.test(nombre)) return nombre;
  }
  return null;
}

/** Adapta la respuesta del Cloud Function (load) al shape que usa la UI. */
export function adaptLoadedToUi(loaded: any) {
  const ocds = loaded?.ocds_payload || {};
  const tender = ocds?.tender || {};
  const parties: any[] = ocds?.parties || [];

  // Postores (mismo helper que /analyze)
  const winners: Record<string, number> = {};
  for (const a of ocds?.awards ?? []) {
    for (const s of a?.suppliers ?? []) {
      const r = (s?.id ?? "").replace("PE-RUC-", "");
      winners[r] = (winners[r] ?? 0) + (a?.value?.amount ?? 0);
    }
  }
  const postores = parties
    .filter((p) => p?.roles?.some((r: string) => r === "supplier" || r === "tenderer"))
    .map((p) => {
      const ident = p?.identifier ?? {};
      const ruc = ident?.scheme === "PE-RUC" ? ident?.id : null;
      return {
        ruc,
        nombre: p?.name ?? ident?.legalName,
        roles: p?.roles ?? [],
        es_ganador: ruc ? winners[ruc] != null : false,
        monto_ganado: ruc ? winners[ruc] ?? null : null,
        es_consorcio: p?.name?.toUpperCase()?.includes("CONSORCIO") ?? false,
      };
    });

  const items = (tender?.items ?? []).map((it: any) => ({
    numero: Number(it?.position ?? 0),
    descripcion: it?.description ?? "",
    cantidad: Number(it?.quantity ?? 0),
    unidad: it?.unit?.name ?? "UND",
    cuantia_referencial: Number(it?.totalValue?.amount ?? 0),
    cubso: it?.classification?.id ?? null,
    cubso_descripcion: it?.classification?.description ?? null,
  }));

  const documentos = (tender?.documents ?? []).map((d: any) => ({
    id: d?.id, titulo: d?.title, tipo_ocds: d?.documentType,
    url: d?.url, formato: d?.format,
    fecha: (d?.datePublished ?? "")?.slice(0, 10) || null,
  }));

  let buyer_ruc: string | null = null;
  for (const p of parties) {
    if (p?.roles?.includes("buyer")) {
      for (const ai of p?.additionalIdentifiers ?? []) {
        if (ai?.scheme === "PE-RUC") { buyer_ruc = ai.id; break; }
      }
      break;
    }
  }

  // `loaded.monto` es el monto ADJUDICADO, no el presupuesto: usarlo como
  // cuantía hacía que 41 dossiers dijeran "igual al presupuesto" cuando la
  // adjudicación lo superaba (1190803: 84,172 contra 77,995 de referencia).
  // El presupuesto es el valor referencial del OCDS; si no vino, no se inventa.
  const referencial = Number(tender?.value?.amount);
  const dia = (s: unknown) => (typeof s === "string" && s.length >= 10 ? s.slice(0, 10) : null);
  const award0 = (ocds?.awards ?? [])[0] ?? {};
  const contract0 = (ocds?.contracts ?? [])[0] ?? {};

  return {
    ocid: loaded.ocid,
    convocatoria: {
      codigo: (loaded.ocid || "").split("-").pop(),
      ocid: loaded.ocid,
      entidad: loaded.entidad,
      buyer_ruc: buyer_ruc ?? loaded.entidad_ruc ?? null,
      objeto: loaded.objeto,
      region: loaded.region,
      cuantia_total: Number.isFinite(referencial) && referencial > 0 ? referencial : null,
      monto_adjudicado: loaded.monto ?? null,
      // Fechas reales del registro OCDS. `fecha_fin` es el cierre de la
      // presentación de ofertas, no la buena pro (antes se rotulaba al revés).
      fecha_publicacion: dia(tender?.datePublished),
      fecha_inicio: dia(tender?.tenderPeriod?.startDate),
      fecha_fin: dia(tender?.tenderPeriod?.endDate),
      fecha_buena_pro: dia(loaded.fecha_buena_pro) ?? dia(award0?.date),
      fecha_contrato: dia(contract0?.dateSigned),
      tipo_proceso: tender?.procurementMethodDetails,
      n_items: items.length,
      n_postores: postores.length,
      n_docs: documentos.length,
    },
    entidad: loaded.entidad ?? null,
    entidad_ruc: loaded.entidad_ruc ?? buyer_ruc ?? null,
    proveedor_ruc: loaded.proveedor_ruc ?? null,
    postores,
    items,
    documentos,
    compliance: {
      alerta_codigo: loaded.alerta_codigo,
      score: loaded.score,
      banderas: loaded.banderas || [],
      // El perfil del pipeline (bienes, servicios…) viaja dentro de la traza, en
      // el contexto que recibe el dictamen. Con él la UI carga el catálogo de
      // reglas y nombra cada señal con su etiqueta, no con su id.
      perfil: perfilDeTraza(loaded.agent_trace),
      reglas_disparadas: Array.from(
        new Set(((loaded.banderas || []) as any[]).map((b) => b?.regla).filter((r) => typeof r === "string" && r)),
      ),
    },
    document_analysis:    loaded.document_analysis,
    market_analysis:      loaded.market_analysis,
    web_research:         loaded.web_research,
    news_research:        loaded.news_research,
    person_network:       loaded.person_network,
    person_network_context: loaded.person_network_context,
    entity_personnel:     loaded.entity_personnel,
    causal_directa_invocada: loaded.causal_directa_invocada,
    acto_resolutivo_directa: loaded.acto_resolutivo_directa,
    normative_compliance: loaded.normative_compliance,
    estado_real:          loaded.estado_real,
    analisis_postores:    loaded.analisis_postores,
    doc_parser_raw: "",
    market_analysis_raw: "",
    web_research_raw: "",
    news_research_raw: "",
    person_network_raw: "",
    dictamen: {
      dictamen_markdown: loaded.dictamen_markdown || "",
      // El modelo se nombra solo si la API lo trae; antes se escribía uno a mano.
      gen_meta: loaded.dictamen_model || loaded.model ? { model: loaded.dictamen_model || loaded.model } : {},
    },
    agent_trace: loaded.agent_trace || [],
    llm_metrics: loaded.llm_metrics,
    self_evals: loaded.self_evals,
    // Sin duración real persistida: no se manda un 0 que parezca una medición.
    timing: {},
    _bridge_meta: { cached: true, analizado_en: loaded.analizado_en },
  };
}
