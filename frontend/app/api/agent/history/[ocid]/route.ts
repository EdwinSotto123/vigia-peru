/**
 * GET /api/agent/history/[ocid]
 *
 * Carga un análisis ya cacheado (sin reanalizar) por OCID/codigo_convocatoria/codigo de alerta.
 * Devuelve la misma forma que /api/agent/analyze para que la UI lo renderice
 * sin cambios.
 */
import { NextResponse } from "next/server";
import { gzipSync } from "zlib";

export const dynamic = "force-dynamic";

// La LECTURA de un dossier cacheado va a la API de datos liviana
// (vigia-peru-api, 512Mi, pool de conexiones caliente), NO al orquestador ADK
// (8Gi, maxScale=1) que solo debe ANALIZAR. El dato vive en el mismo Cloud SQL.
const API_BASE =
  process.env.VIGIA_API_URL ||
  process.env.NEXT_PUBLIC_VIGIA_API_URL ||
  "https://vigia-peru-api-36169102688.us-central1.run.app";

/** Adapta la respuesta del Cloud Function (load) al shape que usa la UI. */
function adaptLoadedToUi(loaded: any) {
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

  return {
    ocid: loaded.ocid,
    convocatoria: {
      codigo: (loaded.ocid || "").split("-").pop(),
      ocid: loaded.ocid,
      entidad: loaded.entidad,
      buyer_ruc,
      objeto: loaded.objeto,
      region: loaded.region,
      cuantia_total: loaded.monto,
      fecha_fin: loaded.fecha_buena_pro,
      tipo_proceso: tender?.procurementMethodDetails,
      n_items: items.length,
      n_postores: postores.length,
      n_docs: documentos.length,
    },
    postores,
    items,
    documentos,
    compliance: {
      alerta_codigo: loaded.alerta_codigo,
      score: loaded.score,
      banderas: loaded.banderas || [],
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
      gen_meta: { model: "gemini-2.5-pro (cacheado)" },
    },
    agent_trace: loaded.agent_trace || [],
    llm_metrics: loaded.llm_metrics,
    self_evals: loaded.self_evals,
    timing: { total_s: 0 },
    _bridge_meta: { cached: true, analizado_en: loaded.analizado_en },
  };
}

export async function GET(req: Request, { params }: { params: { ocid: string } }) {
  try {
    const ocid = decodeURIComponent(params.ocid);
    // OJO: NO usar Next data cache (revalidate) acá. Cachearía también los 404
    // del lag de persist (~1-3s post-análisis) por 1h y dejaría el dossier
    // "no analizado" aunque ya esté listo. La velocidad la dan el Cache-Control
    // de la respuesta (solo 200s, en el browser/edge) + el cache de cliente.
    const r = await fetch(`${API_BASE}/alertas/${encodeURIComponent(ocid)}/full`, {
      cache: "no-store",
    });
    if (r.status === 404) {
      return NextResponse.json({ error: "not_found", query: ocid }, { status: 404 });
    }
    if (!r.ok) {
      return NextResponse.json(
        { error: "upstream_failed", status: r.status, detail: (await r.text()).slice(0, 300) },
        { status: 502 },
      );
    }
    const loaded = await r.json();
    if (loaded?.error) return NextResponse.json(loaded, { status: 404 });

    // El dossier pesa ~480 KB sin comprimir y Next no gzipea las route handlers
    // en Cloud Run → lo comprimimos a mano (zlib). gzip baja JSON ~8-10x.
    const json = JSON.stringify(adaptLoadedToUi(loaded));
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      // Inmutable → el browser puede cachear; revisitar no re-pega ni a Next.
      "Cache-Control": "private, max-age=300, stale-while-revalidate=3600",
    };
    const accepts = req.headers.get("accept-encoding") || "";
    if (accepts.includes("gzip")) {
      const gz = gzipSync(Buffer.from(json));
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      return new Response(gz, { status: 200, headers });
    }
    return new Response(json, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
