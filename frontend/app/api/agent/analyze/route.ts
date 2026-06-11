/**
 * POST /api/agent/analyze
 *
 * Bridge entre el frontend y el agente ADK en GCP.
 *
 * Flow:
 *   1. Fetcheamos el OCDS desde acá (IP del runtime Next, no bloqueada por OECE).
 *   2. Fetcheamos cada `tender.documents[].url` (PDF) y lo base64-encodeamos
 *      (porque SEACE bloquea las IPs de GCP que tienen los Cloud Functions).
 *   3. POSTeamos al agent-orchestrator-adk con todo el payload.
 *   4. El ADK orchestrator corre el agent loop: llama sus FunctionTools,
 *      invoca sub-agentes como AgentTool, y produce un trace de eventos.
 *   5. Mapeamos la respuesta del ADK (events + state + final_response) a la
 *      forma que la UI ya conoce (convocatoria + compliance + dictamen).
 */

import { NextResponse } from "next/server";
import { Agent as UndiciAgent, setGlobalDispatcher } from "undici";
import { Storage } from "@google-cloud/storage";

export const dynamic = "force-dynamic";
// 25 min. Cubre runs largos donde Vertex AI hace retry/backoff por 429.
// En Cloud Run hosting, no hay cap. En Vercel free, esto se trunca a 60s
// (Hobby) o 300s (Pro) — si corre en Vercel, ajustar al plan.
export const maxDuration = 3600;  // 60 min — Cloud Run max

// El default de undici (5 min) corta el fetch al Cloud Function. Subido a 25 min
// para tolerar retries del SDK de Gemini por 429 RESOURCE_EXHAUSTED.
const LONG_TIMEOUT_DISPATCHER = new UndiciAgent({
  headersTimeout: 3_600_000,  // 60 min
  bodyTimeout: 3_600_000,
  connectTimeout: 30_000,
});

const ORCHESTRATOR_URL =
  process.env.VIGIA_AGENT_URL ||
  "https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app";

const OECE_BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1";
// Cap por PDF en el path server-side (fallback cuando el cliente no pre-fetcheó).
// Subido de 15 MB → 50 MB.
const MAX_DOC_BYTES = 50 * 1024 * 1024;
// Cap del body del POST hacia el orchestrator. Cloud Run rechaza > 32 MB.
// Usamos 22 MB como umbral seguro: si la suma de b64 supera esto, mandamos
// SOLO doc_urls al orchestrator (los PDFs ya están archivados en GCS) — eso
// evita el cap por completo.
const ORCHESTRATOR_B64_THRESHOLD = 22 * 1024 * 1024;

// Relay externo (Cloudflare Worker) que bypassa el bloqueo WAF de OECE a IPs
// de GCP. Fallback server-side cuando el cliente NO pre-cargó el OCDS/PDFs.
// El path principal es client-side (browser → Worker), porque OECE bloquea
// todo egress de datacenter pero permite IPs LATAM residenciales.
const OECE_RELAY = process.env.OECE_RELAY_URL || "";

function viaRelay(targetUrl: string): string {
  if (!OECE_RELAY) return targetUrl;
  return `${OECE_RELAY.replace(/\/$/, "")}/?url=${encodeURIComponent(targetUrl)}`;
}

// Archivo de PDFs del contrato en GCS. Sirve dos propósitos:
//   1. Persistencia / auditoría — los docs públicos del contrato quedan
//      respaldados para que el agente y el periodista los referencien después.
//   2. URLs accesibles desde GCP — el orchestrator puede descargarlos vía GCS
//      si los OECE original URLs estuvieran inaccesibles desde el Cloud Function.
const DOCS_BUCKET = process.env.DOCS_BUCKET || "vigia-peru-documentos";

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (_storage) return _storage;
  _storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "vivid-spot-480905-a4",
  });
  return _storage;
}

function safeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

interface DocMeta {
  url: string;
  filename: string;
  contentType: string;
  size_bytes: number;
}

async function archiveDocsToGcs(
  ocid: string,
  docs_b64: Record<string, string>,
  metas: DocMeta[],
): Promise<Record<string, { gcs_url: string; gcs_path: string }>> {
  if (!docs_b64 || Object.keys(docs_b64).length === 0) return {};
  const out: Record<string, { gcs_url: string; gcs_path: string }> = {};
  const metaByUrl = new Map<string, DocMeta>();
  for (const m of metas) metaByUrl.set(m.url, m);

  const bucket = getStorage().bucket(DOCS_BUCKET);
  const cleanOcid = safeName(ocid);

  await Promise.all(
    Object.entries(docs_b64).map(async ([url, b64]) => {
      try {
        const meta = metaByUrl.get(url);
        const filename = safeName(meta?.filename || "doc.bin");
        const contentType = meta?.contentType || "application/octet-stream";
        const path = `convocatorias/${cleanOcid}/${filename}`;
        const buf = Buffer.from(b64, "base64");
        const blob = bucket.file(path);
        await blob.save(buf, {
          contentType,
          resumable: false,
          metadata: {
            cacheControl: "public, max-age=86400",
            metadata: { ocid, original_url: url },
          },
        });
        out[url] = {
          gcs_url: `https://storage.googleapis.com/${DOCS_BUCKET}/${path}`,
          gcs_path: `gs://${DOCS_BUCKET}/${path}`,
        };
      } catch (e) {
        console.log(`[GCS] failed to archive ${url}: ${(e as Error).message}`);
      }
    }),
  );
  return out;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
  Referer: "https://contratacionesabiertas.oece.gob.pe/",
};

function resolveOcid(input: string): string {
  const s = input.trim();
  if (s.startsWith("ocds-")) return s;
  if (/^\d+$/.test(s)) return `ocds-dgv273-seacev3-${s}`;
  return s;
}

/**
 * Resultado de fetchOcds que distingue tres estados:
 *   - cr: el compiledRelease si todo OK
 *   - reason: "ok" | "not_found" | "blocked" | "error" — para mensaje preciso
 *   - upstream_status: status HTTP que devolvió el upstream/relay (debug)
 */
type FetchOcdsResult = {
  cr: any | null;
  reason: "ok" | "not_found" | "blocked" | "error";
  upstream_status?: number;
};

const OCDS_CACHE_PREFIX = "ocds-cache";

async function readOcdsCache(ocid: string): Promise<any | null> {
  try {
    const bucket = getStorage().bucket(DOCS_BUCKET);
    const path = `${OCDS_CACHE_PREFIX}/${safeName(ocid)}.json`;
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return JSON.parse(buf.toString("utf-8"));
  } catch {
    return null;
  }
}

async function writeOcdsCache(ocid: string, cr: any): Promise<void> {
  try {
    const bucket = getStorage().bucket(DOCS_BUCKET);
    const path = `${OCDS_CACHE_PREFIX}/${safeName(ocid)}.json`;
    const blob = bucket.file(path);
    await blob.save(JSON.stringify(cr), {
      contentType: "application/json",
      resumable: false,
      metadata: { cacheControl: "public, max-age=86400" },
    });
  } catch {
    // Cache write best-effort, no abortar.
  }
}

async function fetchOcds(ocid: string): Promise<FetchOcdsResult> {
  // 1) Cache GCS — si lo bajamos antes, usarlo. Resiliencia ante bloqueos
  //    del proxy o cambios de WAF en OECE.
  const cached = await readOcdsCache(ocid);
  if (cached) {
    return { cr: cached, reason: "ok" };
  }

  // 2) Intentar via relay (Cloudflare Worker). Si Cloudflare cae en un colo
  //    que OECE bloquea, devuelve 403; lo distinguimos de un 404 real.
  const target = `${OECE_BASE}/record/${encodeURIComponent(ocid)}`;
  const url = viaRelay(target);
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
    if (r.ok) {
      const data = await r.json();
      const cr = data.records?.[0]?.compiledRelease ?? null;
      if (cr) {
        // Mejor-esfuerzo: cachear para próximos análisis
        writeOcdsCache(ocid, cr).catch(() => {});
        return { cr, reason: "ok" };
      }
      return { cr: null, reason: "not_found", upstream_status: 200 };
    }
    // Status del upstream (no-OK)
    if (r.status === 404) {
      return { cr: null, reason: "not_found", upstream_status: 404 };
    }
    // 403 / 5xx → proxy bloqueado por OECE (no es que el OCID no exista)
    return { cr: null, reason: "blocked", upstream_status: r.status };
  } catch {
    return { cr: null, reason: "error" };
  }
}

async function fetchPdfAsB64(originalUrl: string): Promise<string | null> {
  const url = viaRelay(originalUrl);
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    const cl = Number(r.headers.get("content-length") ?? 0);
    if (cl > MAX_DOC_BYTES) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_DOC_BYTES) return null;
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/** Extrae info estructurada del OCDS payload (entidad, postores, items, docs). */
function extractOcdsRich(ocds: any) {
  const tender = ocds?.tender ?? {};
  const parties: any[] = ocds?.parties ?? [];

  // Buyer
  let buyer_ruc: string | null = null;
  let buyer_address: any = null;
  for (const p of parties) {
    const roles = p?.roles ?? [];
    if (roles.includes("buyer") || roles.includes("procuringEntity")) {
      buyer_address = p?.address ?? null;
      for (const ai of p?.additionalIdentifiers ?? []) {
        if (ai?.scheme === "PE-RUC" && (ai?.id ?? "").length === 11) {
          buyer_ruc = ai.id;
          break;
        }
      }
      break;
    }
  }

  // Postores (suppliers + tenderers)
  const winners_map: Record<string, number> = {};
  for (const a of ocds?.awards ?? []) {
    const amt = a?.value?.amount ?? 0;
    for (const s of a?.suppliers ?? []) {
      const r = (s?.id ?? "").replace("PE-RUC-", "");
      winners_map[r] = (winners_map[r] ?? 0) + amt;
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
        es_ganador: ruc ? winners_map[ruc] != null : false,
        monto_ganado: ruc ? winners_map[ruc] ?? null : null,
        es_consorcio: p?.roles?.includes("supplier") && p?.name?.toUpperCase()?.includes("CONSORCIO"),
      };
    });

  // Items con detalle
  const items = (tender?.items ?? []).map((it: any) => ({
    numero: Number(it?.position ?? 0),
    descripcion: it?.description ?? "",
    descripcion_corta: (it?.description ?? "").slice(0, 100),
    cantidad: Number(it?.quantity ?? 0),
    unidad: it?.unit?.name ?? "UND",
    cuantia_referencial: Number(it?.totalValue?.amount ?? 0),
    cubso: it?.classification?.id ?? null,
    cubso_descripcion: it?.classification?.description ?? null,
  }));

  // Documentos
  const documentos = (tender?.documents ?? []).map((d: any) => ({
    id: d?.id,
    titulo: d?.title,
    tipo_ocds: d?.documentType,
    url: d?.url,
    formato: d?.format,
    fecha: (d?.datePublished ?? "")?.slice(0, 10) || null,
  }));

  return {
    buyer_ruc,
    region: buyer_address?.region ?? null,
    departamento: buyer_address?.department ?? null,
    localidad: buyer_address?.locality ?? null,
    direccion: buyer_address?.streetAddress ?? null,
    objeto_completo: tender?.description ?? tender?.title ?? "",
    tipo_proceso: tender?.procurementMethodDetails ?? null,
    categoria_principal: tender?.mainProcurementCategory ?? null,
    cuantia_total: Number(tender?.value?.amount ?? 0),
    fecha_publicacion: (tender?.datePublished ?? "")?.slice(0, 10) || null,
    fecha_inicio: (tender?.tenderPeriod?.startDate ?? "")?.slice(0, 10) || null,
    fecha_fin: (tender?.tenderPeriod?.endDate ?? "")?.slice(0, 10) || null,
    postores,
    items,
    documentos,
  };
}

/** Adapta respuesta ADK + OCDS rich para el frontend. */
function adaptAdkResponse(adk: any, ocds: any, ocid: string) {
  const state = adk?.state || {};
  const events = adk?.events || [];

  // Index tool_results by name
  const toolResults: Record<string, any> = {};
  for (const ev of events) {
    if (ev?.kind === "tool_result" && ev?.name) {
      toolResults[ev.name] = ev.result_preview;
    }
  }

  const ocdsRich = extractOcdsRich(ocds);
  const fr = toolResults.fetch_ocds_record;
  const dbr = toolResults.register_convocatoria_in_db;
  const cr = toolResults.run_compliance_rules || {};

  // Convocatoria — combinación de OCDS + tool fr
  const convocatoria = {
    codigo: ocid.split("-").pop(),
    ocid,
    entidad: fr?.buyer_nombre ?? ocds?.buyer?.name,
    buyer_ruc: fr?.buyer_ruc ?? ocdsRich.buyer_ruc,
    objeto: ocdsRich.objeto_completo,
    region: ocdsRich.region,
    departamento: ocdsRich.departamento,
    localidad: ocdsRich.localidad,
    direccion: ocdsRich.direccion,
    tipo_proceso: ocdsRich.tipo_proceso,
    categoria: ocdsRich.categoria_principal,
    cuantia_total: ocdsRich.cuantia_total,
    fecha_publicacion: ocdsRich.fecha_publicacion,
    fecha_inicio: ocdsRich.fecha_inicio,
    fecha_fin: ocdsRich.fecha_fin,
    n_items: dbr?.n_items ?? ocdsRich.items.length,
    n_postores: dbr?.n_postores ?? ocdsRich.postores.length,
    n_docs: dbr?.n_docs ?? ocdsRich.documentos.length,
  };

  const compliance = {
    alerta_codigo: cr.alerta_codigo ?? state.alerta_codigo,
    alerta_id: cr.alerta_id,
    score: cr.score ?? state.score ?? 0,
    banderas: cr.banderas ?? state.banderas ?? [],
  };

  // Sub-agentes ahora devuelven JSON estricto. Parseamos defensivamente.
  const tryParseJSON = (s: string | undefined): any => {
    if (!s || typeof s !== "string") return null;
    const trimmed = s.trim();
    // Try direct JSON
    try { return JSON.parse(trimmed); } catch {}
    // Strip ```json fences if present
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch {}
    }
    // Find first { ... last }
    const brace = trimmed.match(/\{[\s\S]+\}/);
    if (brace) {
      try { return JSON.parse(brace[0]); } catch {}
    }
    return null;
  };

  const document_analysis = tryParseJSON(state.document_analysis);
  const market_analysis = tryParseJSON(state.market_analysis);
  const web_research = tryParseJSON(state.web_research);
  const news_research = tryParseJSON(state.news_research);
  const person_network = tryParseJSON(state.person_network);
  const normative_compliance =
    typeof state.normative_compliance === "object"
      ? state.normative_compliance
      : tryParseJSON(state.normative_compliance);
  // Fase 1+2 — estado_real y análisis de postores
  const estado_real = state.estado_real || null;
  const analisis_postores = state.analisis_postores || null;

  // Fallback raw text para mostrar si parseo fallara
  const doc_parser_raw = state.document_analysis || "";
  const market_analysis_raw = state.market_analysis || "";
  const web_research_raw = state.web_research || "";
  const news_research_raw = state.news_research || "";
  const person_network_raw = state.person_network || "";

  // Dictamen
  const dictamenText = state.final_dictamen || adk?.final_response || "";
  const dictamen = {
    dictamen_markdown: dictamenText,
    gen_meta: { model: "gemini-2.5-pro" },
  };

  return {
    ocid,
    convocatoria,
    postores: ocdsRich.postores,
    items: ocdsRich.items,
    documentos: ocdsRich.documentos,
    compliance,
    document_analysis,         // JSON estructurado del doc_parser_agent
    market_analysis,           // JSON estructurado del market_price_agent
    web_research,              // JSON estructurado del web_research_agent
    news_research,             // JSON estructurado del news_research_agent
    person_network,            // JSON estructurado del person_network_agent
    normative_compliance,      // JSON de evaluate_normative_compliance (RAG cruzado)
    estado_real,               // detect_estado_real (inconsistencia OCDS vs docs)
    analisis_postores,         // analyze_postores_pattern (cartel / sin historial)
    doc_parser_raw,            // fallback texto crudo
    market_analysis_raw,
    web_research_raw,
    news_research_raw,
    person_network_raw,
    dictamen,
    agent_trace: events,
    agent_session: adk?.session_id,
    agent_final_response: adk?.final_response,
    llm_metrics: state.llm_metrics,
    self_evals: state.self_evals,
  };
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const input = (body.input ?? "").toString().trim();
  if (!input) {
    return NextResponse.json({ error: "missing 'input'" }, { status: 400 });
  }
  const ocid = resolveOcid(input);

  // 1. OCDS. Camino preferido: cliente envía el OCDS pre-fetched desde su
  //    browser vía Cloudflare Worker (única manera de bypassar el WAF de OECE
  //    que bloquea egress de cloud datacenters). Fallback: intentar server-
  //    side vía relay si está configurado (puede fallar).
  let cr: any = body.ocds ?? null;
  let ocdsSource: "client" | "server" = "client";
  let ocdsFetchReason: FetchOcdsResult["reason"] = "ok";
  let ocdsUpstreamStatus: number | undefined;
  if (!cr) {
    const res = await fetchOcds(ocid);
    cr = res.cr;
    ocdsFetchReason = res.reason;
    ocdsUpstreamStatus = res.upstream_status;
    ocdsSource = "server";
  }
  if (!cr) {
    const isBlocked = ocdsFetchReason === "blocked" || ocdsFetchReason === "error";
    const hint = isBlocked
      ? `El proxy OECE (Cloudflare Worker) está siendo bloqueado por el WAF de OECE (upstream HTTP ${ocdsUpstreamStatus ?? "?"}). La convocatoria ${ocid} probablemente SÍ existe — verifica manualmente en https://contratacionesabiertas.oece.gob.pe/proceso/${ocid}. Reintenta el análisis en unos minutos; el routing de Cloudflare puede cambiar de colo.`
      : `OECE devolvió HTTP ${ocdsUpstreamStatus ?? "404"} para esta convocatoria. La convocatoria ${ocid} no existe o ya no es accesible. Verifica en https://contratacionesabiertas.oece.gob.pe/proceso/${ocid}`;
    return NextResponse.json(
      {
        error: isBlocked ? "ocid_blocked_by_waf" : "ocid_not_found",
        ocid,
        fetch_reason: ocdsFetchReason,
        upstream_status: ocdsUpstreamStatus,
        hint,
      },
      { status: isBlocked ? 503 : 404 },
    );
  }
  const t_ocds = Date.now() - t0;

  // 2. PDFs base64. Camino preferido: cliente los envía pre-cargados. Fallback:
  //    server-side vía relay.
  const t1 = Date.now();
  let docs_b64: Record<string, string> = (body.docs_b64 ?? {}) as Record<string, string>;
  const docs_meta: DocMeta[] = Array.isArray(body.docs_meta) ? body.docs_meta : [];
  let pdfsSource: "client" | "server" = "client";

  if (Object.keys(docs_b64).length === 0) {
    pdfsSource = "server";
    const docs = (cr?.tender?.documents ?? []).slice(0, 4) as any[];
    const pdfResults = await Promise.all(
      docs.map(async (d) => {
        if (!d?.url) return [d?.url, null] as const;
        const b64 = await fetchPdfAsB64(d.url);
        return [d.url, b64] as const;
      }),
    );
    let totalBytes = 0;
    // Cap del fetch server-side. Si pasa esto, paramos de bajar y dejamos el
    // resto sin pre-cargar (el orchestrator igual los leerá desde GCS si
    // están archivados).
    const MAX_BODY = 100 * 1024 * 1024;
    for (const [url, b64] of pdfResults) {
      if (!url || !b64) continue;
      if (totalBytes + b64.length > MAX_BODY) {
        console.log(`Skipping ${url} — would exceed body cap`);
        continue;
      }
      docs_b64[url] = b64;
      totalBytes += b64.length;
    }
  }
  const nDescargados = Object.keys(docs_b64).length;
  const t_pdfs = Date.now() - t1;
  console.log(
    `Bridge: OCDS source=${ocdsSource} (${JSON.stringify(cr).length}B), PDFs source=${pdfsSource} (${nDescargados} docs)`,
  );

  // 2b. Archivar PDFs al bucket GCS. Sirve para auditoría/citación posterior
  //     y deja URLs accesibles desde GCP por si el orchestrator las necesita.
  const t1b = Date.now();
  let gcsArchive: Record<string, { gcs_url: string; gcs_path: string }> = {};
  try {
    gcsArchive = await archiveDocsToGcs(ocid, docs_b64, docs_meta);
  } catch (e) {
    console.log(`[GCS] archive batch failed: ${(e as Error).message}`);
  }
  const t_gcs = Date.now() - t1b;
  const nArchivados = Object.keys(gcsArchive).length;

  // 3. POST al agente ADK.
  //    Estrategia anti-cap: Cloud Run rechaza bodies > 32 MB. Si la suma de
  //    los b64 supera el umbral seguro, mandamos SOLO doc_urls (apuntando al
  //    bucket GCS donde el bridge ya archivó los PDFs). El orchestrator está
  //    preparado para leer desde GCS via google-cloud-storage sin restricción
  //    de IP.
  const t2 = Date.now();
  const doc_urls = Object.fromEntries(
    Object.entries(gcsArchive).map(([orig, g]) => [orig, g.gcs_url]),
  );
  let docs_b64_sum = 0;
  for (const v of Object.values(docs_b64)) docs_b64_sum += (v?.length || 0);

  let body_docs_b64: Record<string, string> = docs_b64;
  let body_mode: "b64_inline" | "gcs_only" = "b64_inline";
  if (docs_b64_sum > ORCHESTRATOR_B64_THRESHOLD && Object.keys(doc_urls).length > 0) {
    body_docs_b64 = {};
    body_mode = "gcs_only";
    console.log(
      `Body mode=gcs_only: docs_b64 sum=${(docs_b64_sum / 1e6).toFixed(1)}MB ` +
      `excede umbral ${(ORCHESTRATOR_B64_THRESHOLD / 1e6).toFixed(0)}MB, ` +
      `usando ${Object.keys(doc_urls).length} URLs de GCS en su lugar`,
    );
  }

  try {
    const r = await fetch(ORCHESTRATOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, ocds: cr, docs_b64: body_docs_b64, doc_urls }),
      // @ts-expect-error undici dispatcher is supported by Node fetch
      dispatcher: LONG_TIMEOUT_DISPATCHER,
    });
    if (!r.ok) {
      return NextResponse.json(
        {
          error: "agent_failed",
          status: r.status,
          detail: (await r.text()).slice(0, 500),
        },
        { status: 502 },
      );
    }
    const adk = await r.json();
    const adapted = adaptAdkResponse(adk, cr, ocid);
    const total_s = (Date.now() - t0) / 1000;

    return NextResponse.json({
      ...adapted,
      timing: {
        next_fetch_ocds_s: +(t_ocds / 1000).toFixed(2),
        next_fetch_pdfs_s: +(t_pdfs / 1000).toFixed(2),
        gcs_archive_s: +(t_gcs / 1000).toFixed(2),
        agent_loop_s: +((Date.now() - t2) / 1000).toFixed(2),
        total_s: +total_s.toFixed(2),
      },
      _bridge_meta: {
        ocds_source: ocdsSource,
        pdfs_source: pdfsSource,
        n_pdfs_descargados: nDescargados,
        n_pdfs_archivados_gcs: nArchivados,
        bucket: DOCS_BUCKET,
        agent_events: (adk?.events || []).length,
        body_mode,
        docs_b64_sum_mb: +(docs_b64_sum / 1e6).toFixed(2),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "agent_exception", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
