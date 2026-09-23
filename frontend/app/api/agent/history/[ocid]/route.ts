/**
 * GET /api/agent/history/[ocid]
 *
 * Carga un análisis ya cacheado (sin reanalizar) por OCID/codigo_convocatoria/codigo de alerta.
 * Devuelve la misma forma que /api/agent/analyze para que la UI lo renderice
 * sin cambios.
 */
import { NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { esAlertaDemo } from "@/lib/semillas";

export const dynamic = "force-dynamic";

// La LECTURA de un dossier cacheado va a la API de datos liviana
// (vigia-peru-api, 512Mi, pool de conexiones caliente), NO al orquestador ADK
// (8Gi, maxScale=1) que solo debe ANALIZAR. El dato vive en el mismo Cloud SQL.
const API_BASE =
  process.env.VIGIA_API_URL ||
  process.env.NEXT_PUBLIC_VIGIA_API_URL ||
  "https://vigia-peru-api-36169102688.us-central1.run.app";

/** Perfil del pipeline registrado en la traza (`result_preview.perfil.nombre`), si quedó. */
function perfilDeTraza(trace: unknown): string | null {
  if (!Array.isArray(trace)) return null;
  for (const ev of trace) {
    const p = (ev as any)?.result_preview?.perfil;
    const nombre = typeof p === "string" ? p : p?.nombre;
    if (typeof nombre === "string" && /^[a-z_]{3,30}$/.test(nombre)) return nombre;
  }
  return null;
}

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
    // Las 10 alertas de demo `ALT-2026-00xx` viven en la base de producción
    // (ver lib/semillas.ts): sin registro OCDS ni fecha de análisis. No son un
    // dossier; para la interfaz no existen.
    if (esAlertaDemo({ codigo: loaded?.alerta_codigo }) || (!loaded?.ocds_payload && !loaded?.analizado_en)) {
      return NextResponse.json({ error: "not_found", query: ocid }, { status: 404 });
    }

    // El dossier pesa ~480 KB sin comprimir y Next no gzipea las route handlers
    // en Cloud Run → lo comprimimos a mano (zlib). gzip baja JSON ~8-10x.
    const json = JSON.stringify(adaptLoadedToUi(loaded));
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      // Un dossier se puede reprocesar (lib/dossier-cache.ts promete que una
      // recarga trae la última corrida): cache corto, no de una hora.
      "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
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
