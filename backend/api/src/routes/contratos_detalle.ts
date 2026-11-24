/**
 * Detalle de un contrato:
 *   GET /contratos/:ocid/documento?url=<url_origen SEACE>   URL firmada (15 min) del documento guardado
 *   GET /contratos/:ocid                                    ContratoResumen & { items, documentos, alerta,
 *                                                           procesamiento, clasificacion, postoresDetalle, itemsAnalizados,
 *                                                           participantes, ofertas, cronograma, contrato, presupuesto }
 * Se monta al final de contratosRouter (las rutas fijas /resumen y /geo van antes que `/:ocid`).
 */

import { COL_GOBIERNO, gobiernoDeFila } from "../lib/gobiernoFila.js";
import { Hono } from "hono";
import { publicar } from "../lib/privacidad.js";
import { OCID_CANDIDATOS, pool } from "../lib/db.js";
import { COLS as COLS_PROCESAMIENTO, RESULTADO_SQL } from "./procesamientos.js";
import { ambitoPedido } from "../lib/plataforma.js";
import { convocatoriaNoDemo, esPublicada, redactarResultado } from "../lib/publicacion.js";
import { cachePublico } from "../lib/http.js";
import { crearCitador } from "../lib/citas.js";
import { crucesDeProceso, type Ganador } from "../lib/cruces.js";
import { enriquecerPostores, fichasDeReportes, itemsDeDocumentos, leerFichasPiezas, perfilDeBases, type FichaPieza, type PostorDetalle } from "../lib/fichasPiezas.js";
import { obraDelContrato } from "../lib/obras.js";
import { preciosDeMercado } from "../lib/laboratorioPrecios.js";
import {
  CONTRATOS_OCDS_SQL, PARTES_TENDERER_SQL, armarContrato, armarCronograma, armarParticipantes, contratosConosce, deEstaConvocatoria, fechaBuenaProDe,
  recortarContrato,
  filasParticipantes, ganadoresDe, presupuestoDe, registradosDe, vinculosDelProceso,
  type FilaContrato, type FilaParticipante, type FilaVinculo, type Presupuesto,
} from "../lib/proceso.js";
import {
  EXPEDIENTE_SQL, FROM_FILA, JOIN_RESUMEN, alcanceActivo, col, colsDisponibles, exprs, selectResumen,
} from "./contratos_sql.js";

export const contratosDetalleRouter = new Hono();

const cache = (c: { header: (k: string, v: string) => void }, s: number) => c.header("Cache-Control", cachePublico(s, { maxAge: 30, swr: 1800 }));

// ─── GET /contratos/:ocid ────────────────────────────────────────────────────
// URL firmada (15 min) para ver/descargar un documento guardado en el almacén de Vigía.
//   GET /contratos/:ocid/documento?url=<url_origen SEACE>
//
// Los documentos viven en R2 (vigia-peru-batch, con la ruta que dice `url_gcs`). Hasta el 2026-11-06 se devolvía una URL
// firmada de GCS; GCP quedó sin facturación y esas URLs dan 403. Ahora `url` apunta a /documento/archivo, que lo sirve
// desde R2 por la API (relativa: el navegador la pide por el /v1 de la misma web). Misma forma de respuesta que antes.
const MIME_DOCUMENTO: Record<string, string> = {
  pdf: "application/pdf", zip: "application/zip", rar: "application/vnd.rar",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function documentoGuardado(ocid: string, url: string) {
  const r = await pool.query(
    `SELECT d.url_gcs AS "urlGcs", d.formato, d.titulo, d.bytes, d.expira_at AS "expiraAt"
     FROM documentos_gcs d
     WHERE ocid_corto(d.ocid) = ocid_corto($1) AND d.url_origen = $2 AND d.borrado_at IS NULL AND d.expira_at > now()
     ORDER BY d.creado_at DESC LIMIT 1`, [ocid, url]).catch(() => ({ rows: [] as any[] }));
  return r.rows[0] as { urlGcs: string; formato: string | null; titulo: string | null; bytes: number | null; expiraAt: string } | undefined;
}

const NO_DISPONIBLE = { error: "no_disponible", detail: "El documento no está en el almacén de Vigía (se descarga al financiar el análisis)." };

contratosDetalleRouter.get("/:ocid/documento", async (c) => {
  const ocid = c.req.param("ocid");
  const url = c.req.query("url") ?? "";
  if (!url) return c.json({ error: "falta url" }, 400);
  if (!/^[\w.-]{1,64}$/.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const d = await documentoGuardado(ocid, url);
  if (!d) return c.json(NO_DISPONIBLE, 404);
  const formato = String(d.formato ?? "").toLowerCase();
  const archivo = `/v1/contratos/${encodeURIComponent(ocid)}/documento/archivo?url=${encodeURIComponent(url)}`;
  c.header("Cache-Control", "private, no-store");
  return c.json({ url: archivo, formato, bytes: d.bytes, expiraAt: d.expiraAt, previsualizable: formato === "pdf", venceEnSeg: 900 });
});

// El archivo mismo, desde R2. Solo lo que está registrado en documentos_gcs para ese proceso (no es un lector de R2
// abierto): un PDF se muestra en línea; lo demás se descarga, con nosniff y sandbox.
contratosDetalleRouter.get("/:ocid/documento/archivo", async (c) => {
  const ocid = c.req.param("ocid");
  const url = c.req.query("url") ?? "";
  if (!url || !/^[\w.-]{1,64}$/.test(ocid)) return c.json({ error: "falta url" }, 400);
  const d = await documentoGuardado(ocid, url);
  const m = d ? /^gs:\/\/([^/]+)\/(.+)$/.exec(d.urlGcs) : null;
  const almacen = m ? ambitoPedido.getStore()?.almacen?.(m[1]) : undefined;
  if (!d || !m || !almacen) return c.json(NO_DISPONIBLE, 404);
  const objeto = await almacen.get(m[2]);
  if (!objeto) return c.json(NO_DISPONIBLE, 404);
  const formato = String(d.formato ?? "").toLowerCase();
  const nombre = `${ocid}-${(d.titulo ?? "documento").replace(/[^\w.-]+/g, "_").slice(0, 80)}.${formato || "bin"}`;
  const pdf = formato === "pdf";
  return new Response(objeto.body, {
    headers: {
      "Content-Type": MIME_DOCUMENTO[formato] ?? "application/octet-stream",
      "Content-Length": String(objeto.size),
      "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename="${nombre}"`,
      "X-Content-Type-Options": "nosniff",
      ...(pdf ? {} : { "Content-Security-Policy": "sandbox" }),
      "Cache-Control": "private, max-age=900",
    },
  });
});

// ─── GET /contratos/:ocid/gobierno — el partido que gobernaba la entidad cuando se convocó ────────
// Para el dossier de un contrato leído, que se arma con otra fuente (la alerta) y no trae este dato.
contratosDetalleRouter.get("/:ocid/gobierno", async (c) => {
  const ocid = c.req.param("ocid");
  if (!/^[\w.-]{1,64}$/.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const r = await pool.query(
    `SELECT ${COL_GOBIERNO} FROM convocatorias c ${gobiernoDeFila("c.ocid")}
      WHERE c.ocid = ANY(${OCID_CANDIDATOS("$1")}) AND ocid_corto(c.ocid) = ocid_corto($1) ORDER BY (c.ocid = $1) DESC LIMIT 1`,
    [ocid],
  );
  cache(c, 3600);
  return c.json({ gobierno: r.rows[0]?.gobierno ?? null });
});

// ─── GET /contratos/:ocid/precios-mercado — el laboratorio de precios, renglón por renglón ────────
// Tiendas en internet y referencias del Estado (lib/laboratorioPrecios.ts). Sin laboratorio conectado, 503; sin
// investigaciones, renglones vacíos.
contratosDetalleRouter.get("/:ocid/precios-mercado", async (c) => {
  const ocid = c.req.param("ocid");
  if (!/^[\w.-]{1,64}$/.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const lab = (c.env as { PRECIOS_LAB?: { fetch(req: Request): Promise<Response> } } | undefined)?.PRECIOS_LAB;
  const datos = await preciosDeMercado(lab, ocid);
  if (!datos) return c.json({ error: "sin_laboratorio" }, 503);
  // Con investigaciones en curso, sin «stale-while-revalidate»: si no, el borde sirve media hora la foto de «investigando».
  if (datos.renglones.some((r) => r.estado !== "listo" && r.estado !== "error")) c.header("Cache-Control", "public, max-age=30");
  else cache(c, 1800);
  return c.json(datos);
});

contratosDetalleRouter.get("/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  if (!/^[\w.-]{1,64}$/.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const emp = cols.has("proveedor_ruc")
    ? `LEFT JOIN empresas emp ON emp.ruc = c.proveedor_ruc`
    : `LEFT JOIN empresas emp ON emp.ruc = NULLIF(regexp_replace(COALESCE(c.ocds_payload->'awards', c.adjudicaciones)->0->'suppliers'->0->>'id', '^PE-RUC-', ''), '')`;
  const r = await pool.query(
    `SELECT ${selectResumen(ex)},
            to_char(c.fecha_buena_pro, 'YYYY-MM-DD') AS "fechaBuenaPro",
            c.tipo_proceso AS "tipoProceso", c.fuente_financiamiento AS "fuenteFinanciamiento",
            c.ocds_payload->'tender'->>'title' AS "nomenclatura",
            c.ocds_payload->'tender'->>'description' AS descripcion,
            (c.ocds_payload->'tender'->>'numberOfTenderers')::int AS "postores",
            COALESCE(c.ocds_payload->'tender'->'items', COALESCE(c.ocds_payload->'awards', c.adjudicaciones)->0->'items', '[]'::jsonb) AS items_raw,
            -- documentos de tender + awards + contracts (el record completo trae los tres niveles)
            (SELECT COALESCE(jsonb_agg(d || jsonb_build_object('seccion', s)), '[]'::jsonb) FROM (
               SELECT d, 'tender' AS s FROM jsonb_array_elements(COALESCE(c.ocds_payload->'tender'->'documents', '[]'::jsonb)) d
               UNION ALL SELECT d, 'award' FROM jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) a,
                                             jsonb_array_elements(COALESCE(a->'documents', '[]'::jsonb)) d
               UNION ALL SELECT d, 'contract' FROM jsonb_array_elements(COALESCE(c.ocds_payload->'contracts', '[]'::jsonb)) k,
                                                jsonb_array_elements(COALESCE(k->'documents', '[]'::jsonb)) d) x) AS docs_raw,
            -- Sin record completo, las adjudicaciones recortadas que guarda oece_ocds (migración 71).
            COALESCE(c.ocds_payload->'awards', c.adjudicaciones) AS awards_raw,
            -- Lo demás que trae el registro del proceso (lib/proceso.ts): quiénes se registraron, el plazo de consultas,
            -- el presupuesto y los contratos (estos dos, del record completo o de la ingesta desde el 2026-10-26).
            c.ocds_payload->'tender'->'tenderers' AS tenderers_raw,
            ${PARTES_TENDERER_SQL} AS partes_raw,
            c.ocds_payload->'tender'->'enquiryPeriod' AS consultas_raw,
            c.ocds_payload->'planning'->'budget' AS budget_raw,
            ${CONTRATOS_OCDS_SQL} AS contratos_raw,
            a.id AS alerta_id, a.codigo AS "alertaCodigo",
            ${ex.motivo} AS "motivoNoProcesable", ${ex.agentes} AS "agentesAplicables", ${ex.validaciones} AS "validacionesPendientes",
            ${col(cols, "clasificado_at", "timestamptz")} AS "clasificadoAt",
            -- El partido que gobernaba la entidad cuando se convocó (lib/gobiernoFila.ts).
            ${COL_GOBIERNO}
     ${FROM_FILA}
     ${emp}
     ${JOIN_RESUMEN}
     ${gobiernoDeFila("c.ocid")}
     WHERE c.ocid = ANY(${OCID_CANDIDATOS("$1")}) AND ocid_corto(c.ocid) = ocid_corto($1) AND ${convocatoriaNoDemo("c")}
     ORDER BY (c.ocid = $1) DESC LIMIT 1`,
    [ocid],
  );
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  const row = r.rows[0];
  const {
    items_raw, docs_raw, awards_raw, tenderers_raw, partes_raw, consultas_raw, budget_raw, contratos_raw,
    alerta_id, alertaCodigo, motivoNoProcesable, agentesAplicables, validacionesPendientes, clasificadoAt, ...resumen
  } = row;
  const codigo = String(row.codigo ?? row.ocid);
  const registrados = registradosDe(tenderers_raw, partes_raw);
  const itemsLista: any[] = Array.isArray(items_raw) ? items_raw : [];
  const anioConvocatoria = row.fecha ? Number(String(row.fecha).slice(0, 4)) : null;

  const [alerta, proc, docsGcs, pedido, expedienteRaw, precios, datoDudoso, conosce, filasP, filasV, filasK, presupuesto, obra] = await Promise.all([
    // Misma forma que `resultado` en /financiamiento/procesamientos/:ocid (señales + mercado + documentos).
    alerta_id ? pool.query(RESULTADO_SQL, [alerta_id]) : Promise.resolve(null),
    // Mismas columnas que el tablero (score/banderas en null si la alerta no está publicada).
    pool.query(`SELECT ${COLS_PROCESAMIENTO} FROM procesamientos_publico WHERE ocid = $1`, [row.ocid]),
    // Migración 15: documentos vigentes en GCS (retención 90 días) y pedido de descarga abierto.
    pool.query(`SELECT url_origen AS "urlOrigen", url_gcs AS "urlGcs", expira_at AS "expiraAt" FROM documentos_vigentes($1)`, [row.ocid])
      .then((q) => q.rows as { urlOrigen: string; urlGcs: string; expiraAt: string }[]).catch(() => null),
    pool.query(`SELECT estado, solicitado_at AS "solicitadoAt" FROM pedidos_descarga WHERE ocid_corto(ocid) = ocid_corto($1) AND estado IN ('pendiente','descargando') LIMIT 1`, [row.ocid])
      .then((q) => q.rows[0] ?? null).catch(() => null),
    // U5: postores con ofertas, ítems con precio contratado y citas con página (document_analysis / legal_analysis).
    alerta_id ? pool.query(EXPEDIENTE_SQL, [alerta_id]).then((q) => q.rows[0] ?? null).catch(() => null) : Promise.resolve(null),
    // Migración 84: precio unitario de cada ítem y la referencia de su CUBSO y unidad (sin la migración, sin precios).
    pool.query(PRECIOS_SQL, [row.ocid]).then((q) => q.rows as FilaPrecio[]).catch(() => [] as FilaPrecio[]),
    // Migración 102: posible error de carga del OECE (adjudicado 20 veces el referencial, referencial de S/ 1).
    pool.query(`SELECT motivo, referencial::float AS referencial, adjudicado::float AS adjudicado FROM contrato_dudoso WHERE ocid = $1`, [row.ocid])
      .then((q) => (q.rows[0] as { motivo: string; referencial: number | null; adjudicado: number | null } | undefined) ?? null).catch(() => null),
    // Lo que CONOSCE registra como adjudicado/contratado por ítem: dice cuál de las adjudicaciones del OCDS quedó.
    adjudicadoConosce(codigo),
    // Quiénes participaron, quiénes ofertaron, qué los une y el contrato firmado (lib/proceso.ts); sin tablas, vacío.
    filasParticipantes(registrados, codigo).catch(() => [] as FilaParticipante[]),
    vinculosDelProceso(row.ocid).catch(() => [] as FilaVinculo[]),
    contratosConosce(codigo).catch(() => [] as FilaContrato[]),
    // El proyecto de inversión (CUI) en el presupuesto de la entidad (MEF).
    presupuestoDe(budget_raw, [...itemsLista.map((it) => it?.description), row.titulo, resumen.descripcion], row.entidadRuc ?? null, anioConvocatoria)
      .catch(() => null as Presupuesto | null),
    // La obra de INFOBRAS que ejecuta o supervisa este contrato y la inversión de su CUI en Invierte.pe (migración 160).
    obraDelContrato(row.ocid).catch(() => ({ obras: [], inversiones: [] })),
  ]);
  // Lo que Claude leyó en el acta, el contrato y las consultas (migración 245; backend/lector). Sin la tabla, nada.
  const lecturas = await lecturasDe(row.ocid).catch(() => [] as FilaLectura[]);
  // El camino al dictamen de los agentes (backend/scripts/masivo_agentes.py): si lo están analizando ahora y si el masivo
  // corrió en las últimas 6 h. Sin las tablas (migraciones 272 y 274), null.
  const masivo = await pool.query<{ enAnalisis: boolean; activo: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM agente_masivo WHERE ocid = $1 AND estado = 'en_vuelo') AS "enAnalisis",
            EXISTS (SELECT 1 FROM agente_masivo_tanda WHERE inicio > now() - interval '6 hours') AS activo`, [row.ocid])
    .then((q) => q.rows[0] ?? null).catch(() => null);
  // Los datos de esos documentos como hechos con tipo y con su comprobación (migración 323). Sin la tabla, nada.
  const hechos = await hechosDe(row.ocid).catch(() => [] as HechoDocumento[]);
  // Lo que el Tribunal de Contrataciones resolvió sobre este proceso (migración 402). Sin la tabla, nada.
  const tribunal = await tribunalDe(row.ocid).catch(() => [] as ResolucionTribunal[]);
  // Lo que leyeron los lectores por pieza (lib/fichasPiezas.ts): las bases, el contrato, la evaluación, los reportes. Y los
  // reportes del SEACE leídos sin modelo, para la admisión, calificación y hora de cada oferta cuando no hay lectura con modelo.
  const [fichas, reportes] = await Promise.all([
    leerFichasPiezas(row.ocid).catch(() => new Map<string, FichaPieza>()),
    fichasDeReportes(row.ocid).catch((e) => { console.warn(`[contratos] reportes del SEACE: ${(e as Error).message}`); return {} as Awaited<ReturnType<typeof fichasDeReportes>>; }),
  ]);

  // Alerta no publicada (revision/descartada): sin score, señales, mercado ni reglas, y sin lo que los
  // agentes leyeron del expediente — el análisis entero está sin publicar (lib/publicacion.ts §2).
  const alertaRow: Record<string, any> | null = redactarResultado(alerta?.rows[0] ?? null);
  const expediente = alertaRow && esPublicada(alertaRow.estado) ? expedienteRaw : null;

  const preciosPorItem = new Map(precios.map((p) => [Number(p.posicion), p]));
  const items = itemsLista.map((it: any, i: number) => ({
    precio: precioDe(preciosPorItem.get(Number(it?.position ?? i + 1))),
    id: String(it?.id ?? i + 1),
    posicion: Number(it?.position ?? i + 1),
    descripcion: it?.description ?? it?.classification?.description ?? null,
    cantidad: typeof it?.quantity === "number" ? it.quantity : null,
    unidad: it?.unit?.name ?? null,
    montoPen: typeof it?.totalValue?.amount === "number" ? it.totalValue.amount : null,
    cubso: it?.classification?.scheme === "CUBSO" ? it.classification.id ?? null : null,
    estado: it?.statusDetails ?? it?.status ?? null,
  }));
  const vigentesPorUrl = new Map((docsGcs ?? []).map((v) => [v.urlOrigen, v]));
  const documentos = (Array.isArray(docs_raw) ? docs_raw : [])
    .filter((d: any) => d?.url)
    .map((d: any) => ({
      tipo: d.documentType ?? null,
      titulo: d.title ?? null,
      url: d.url,
      formato: d.format ?? null,
      fecha: d.datePublished ? String(d.datePublished).slice(0, 10) : null,
      seccion: d.seccion ?? "tender",
      // Migración 15: copia vigente en el almacén de Vigía → se puede previsualizar con URL firmada.
      enVigia: vigentesPorUrl.has(d.url),
    }));
  const docsGcsResumen = docsGcs
    ? { n: docsGcs.length, expiraAt: docsGcs.reduce<string | null>((m, v) => (!m || v.expiraAt > m ? v.expiraAt : m), null) }
    : null;
  const adjudicaciones = adjudicacionesVigentes((Array.isArray(awards_raw) ? awards_raw : []).map((aw: any) => ({
    id: aw?.id ?? null,
    fecha: aw?.date ? String(aw.date).slice(0, 10) : null,
    montoPen: typeof aw?.value?.amount === "number" ? aw.value.amount : null,
    proveedor: aw?.suppliers?.[0]?.name ?? null,
    proveedorRuc: aw?.suppliers?.[0]?.id ? String(aw.suppliers[0].id).replace(/^PE-RUC-/, "") : null,
    items: (Array.isArray(aw?.items) ? aw.items : []).map((i: any) => String(i?.id ?? "")).filter(Boolean),
  })), conosce, new Map(items.filter((it) => it.montoPen != null).map((it) => [it.id, it.montoPen as number])));

  // Migración 48: cruces del ganador con ONPE, JNE, visitas, penalidades y sanciones (lib/cruces.ts). Los ganadores
  // son los del OCDS más los que sólo registra CONOSCE: sin eso, un proceso sin buena pro en el OCDS (o un consorcio
  // que sólo figura en CONOSCE) no mostraba sus señales (1 a 4 % de las de cada tipo, medido el 2026-11-17).
  const cruces = await crucesDeProceso(row.ocid, [...adjudicaciones, ...ganadoresSoloConosce(adjudicaciones, conosce)]);

  // ── El registro del proceso (lib/proceso.ts): participantes, adjudicación y contrato, cronograma ──
  // Sólo lo de ESTA convocatoria: el record de un OCID de procedimiento trae también la buena pro y el contrato de otra.
  const adjProceso = adjudicaciones.filter((a) => deEstaConvocatoria(a.id, codigo));
  const contratosOcds = (Array.isArray(contratos_raw) ? contratos_raw : []).filter((k: any) => deEstaConvocatoria(k?.awardID, codigo));
  const ganadores = ganadoresDe(adjProceso, conosce, new Map(items.map((it) => [it.id, it.posicion])));
  const participantes = armarParticipantes(filasP, { fechaConvocatoria: row.fecha ?? null, ganadores, vinculos: filasV });
  const conOferta = participantes.filter((p) => p.oferta);
  // Cuántos presentaron oferta según CONOSCE; null si CONOSCE no trae postores del proceso (sin dato ≠ 0).
  const ofertas = conOferta.length ? conOferta.length : null;
  const nombres = new Map<string, string | null>([
    ...adjProceso.filter((a) => a.proveedorRuc).map((a) => [a.proveedorRuc!, a.proveedor] as [string, string | null]),
    ...conosce.filter((k) => k.ruc).map((k) => [k.ruc!, k.proveedor] as [string, string | null]),
    ...participantes.map((p) => [p.ruc, p.nombre] as [string, string | null]),
  ]);
  const contrato = armarContrato({ items, conosce, adjudicaciones: adjProceso, filas: filasK, contratosOcds, nombres });
  const desdeOfertas = conOferta.map((p) => p.oferta!.desde).filter((x): x is string => !!x).sort();
  const hastaOfertas = conOferta.map((p) => p.oferta!.hasta).filter((x): x is string => !!x).sort();
  const cronograma = armarCronograma({
    convocatoria: row.fecha ?? null,
    consultas: consultas_raw,
    documentos,
    ofertas: conOferta.length ? { desde: desdeOfertas[0] ?? null, hasta: hastaOfertas[hastaOfertas.length - 1] ?? null, n: conOferta.length } : null,
    conosce,
    adjudicaciones: adjProceso,
    firmados: contrato.firmados,
  });
  const buenaPro = fechaBuenaProDe(resumen.fechaBuenaPro ?? null, conosce, adjProceso);

  // ── U5: expediente leído por los agentes (postores, ítems con precio, citas con página) ──
  const enVigiaUrls = new Set(documentos.filter((d) => d.enVigia).map((d) => d.url));
  const { cita, citasDeBandera } = crearCitador(expediente, enVigiaUrls);
  // Un postor puede aparecer varias veces (acta de admisión, cuadro comparativo, buena pro): se queda la fila más completa.
  const postoresRaw = ((expediente?.postores ?? []) as any[]).map((p) => ({
    ruc: p?.ruc ?? null, razonSocial: p?.razon_social ?? null, estado: p?.estado ?? null, motivoEstado: p?.motivo_estado ?? null,
    montoOferta: typeof p?.monto_oferta === "number" ? p.monto_oferta : null, puntaje: p?.puntaje ?? null,
    esGanador: p?.es_ganador === true, ordenPrelacion: p?.orden_prelacion ?? null, item: p?.item ?? null,
    citas: (Array.isArray(p?.evidencia) ? p.evidencia : []).slice(0, 3).map(cita),
  }));
  const porClave = new Map<string, (typeof postoresRaw)[number]>();
  for (const p of postoresRaw) {
    const k = (p.ruc ?? "") || String(p.razonSocial ?? "").toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    const prev = porClave.get(k);
    const score = (x: typeof p) => (x.montoOferta != null ? 2 : 0) + (x.esGanador ? 1 : 0) + (x.citas.length ? 1 : 0) + (x.estado ? 1 : 0);
    if (!prev || score(p) > score(prev)) porClave.set(k, prev ? { ...prev, ...p, citas: p.citas.length ? p.citas : prev.citas, esGanador: prev.esGanador || p.esGanador } : p);
  }
  // Segunda pasada: filas sin RUC cuya razón social empieza igual que una con RUC ("CONSORCIO X integrado por…").
  const normRazon = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const conRuc = [...porClave.values()].filter((p) => p.ruc);
  const postoresAgentes = [...porClave.values()].filter((p) => {
    if (p.ruc) return true;
    const r = normRazon(p.razonSocial);
    const dueno = conRuc.find((q) => { const qr = normRazon(q.razonSocial); return qr.length >= 8 && r.startsWith(qr); });
    if (!dueno) return true;
    if (!dueno.citas.length && p.citas.length) dueno.citas = p.citas;
    dueno.esGanador = dueno.esGanador || p.esGanador;
    return false;
  });
  // Sin expediente de los agentes: los postores del acta leída con Claude (mismos campos; sin citas por página).
  const actaLeida = lecturas.find((l) => l.clase === "buena_pro");
  const postoresBase = postoresAgentes.length || !actaLeida ? postoresAgentes : postoresDeLectura(actaLeida.salida);
  // Con el acta o cuadro de evaluación leído por pieza: admisión, calificación y su motivo, puntajes, bonificación y la hora
  // de cada oferta (reporte de presentación). Sin esa lectura, los postores quedan como estaban.
  const fichaEvaluacion = fichas.get("evaluacion") ?? reportes.evaluacion;
  const enriquecido = enriquecerPostores(postoresBase as PostorDetalle[], fichaEvaluacion, fichas.get("reporte_presentacion") ?? reportes.presentacion,
    participantes.map((p) => ({ ruc: p.ruc, nombre: p.nombre })), enVigiaUrls);
  const postores = enriquecido.postores;
  // El resumen de la evaluación (factores, oferta más baja que perdió) sale sólo de una lectura con modelo: la plantilla
  // no trae montos ni factores, y diría «0 ofertas».
  const evaluacion = fichaEvaluacion?.modelo === "plantilla" ? null : enriquecido.evaluacion;
  const itemsAnalizados = ((expediente?.items ?? []) as any[]).map((it, i) => {
    const num = String(it?.numero ?? i + 1);
    const ocds = items.find((x) => x.id === num || String(x.posicion) === num);
    return {
      numero: num, descripcion: it?.descripcion_corta ?? it?.descripcion ?? null, unidad: it?.unidad ?? null,
      cantidad: typeof it?.cantidad === "number" ? it.cantidad : null,
      precioUnitarioOfertado: typeof it?.precio_unitario_ofertado === "number" ? it.precio_unitario_ofertado : null,
      precioUnitarioContratado: typeof it?.precio_unitario_contratado === "number" ? it.precio_unitario_contratado : null,
      // referencia = valor referencial del ítem en OCDS (total) / cantidad, cuando se puede
      referenciaTotal: ocds?.montoPen ?? null,
      referenciaUnitaria: ocds?.montoPen != null && typeof it?.cantidad === "number" && it.cantidad > 0 ? ocds.montoPen / it.cantidad : null,
      // Lo contratado según CONOSCE (monto adjudicado del ítem ÷ cantidad), y a quién: puede no ser quien ganó en el acta.
      ...contratadoDeItem(conosce, ocds?.posicion ?? Number(num)),
      marca: it?.marca_ofertada ?? null, origenPrecio: it?.origen_precio ?? null,
      citas: (Array.isArray(it?.evidencia) ? it.evidencia : []).slice(0, 2).map(cita),
    };
  });
  // Señales del análisis legal → páginas citadas (lib/citas.ts, mismo emparejamiento que GET /senales).
  if (alertaRow && Array.isArray(alertaRow.banderas)) {
    alertaRow.banderas = alertaRow.banderas.map((b: any) => ({ ...b, citas: citasDeBandera(b) }));
  }

  // El código de ficha (/app/personas/<código>) de quien ganó o participó como persona natural: la ficha del contrato lo
  // enlaza (el RUC 10 nunca sale; el código es al azar, migraciones 91 y 317). Se busca ANTES de publicar(), con el RUC.
  // Con varios ganadores, el que se nombra primero es el de mayor monto adjudicado (lo mismo que el dictamen): la
  // columna de la convocatoria guarda el primero del registro y la cabecera decía «Ganó Medifarma» mientras el dictamen
  // decía «Buena pro para AC Farma» (2026-2543-197, 8 ganadores en 11 ítems; pedido del usuario del 2026-11-24).
  const lider = ganadorPrincipal(conosce, adjudicaciones);
  if (lider && lider.ruc !== resumen.proveedorRuc) {
    resumen.proveedorRuc = lider.ruc;
    resumen.proveedor = lider.nombre ?? resumen.proveedor;
  }
  const rucsPersona = [...new Set([resumen.proveedorRuc, ...adjudicaciones.map((a) => a.proveedorRuc), ...participantes.map((p) => p.ruc)]
    .filter((r): r is string => typeof r === "string" && /^10\d{9}$/.test(r)))];
  const codigoPersona = new Map<string, string>();
  if (rucsPersona.length) {
    const pc = await pool.query<{ ruc: string; codigo: string }>(`SELECT ruc, codigo FROM persona_codigo WHERE ruc = ANY($1::text[])`, [rucsPersona]).catch(() => null);
    for (const x of pc?.rows ?? []) codigoPersona.set(x.ruc, x.codigo);
  }
  const fichaDe = (ruc: unknown) => (typeof ruc === "string" ? codigoPersona.get(ruc) ?? null : null);

  cache(c, 60);
  // Proveedor persona natural (nombre y RUC 10), postores, participantes, citas y señales: tapados (lib/privacidad.ts).
  return c.json(publicar({
    ...resumen,
    proveedorPersona: fichaDe(resumen.proveedorRuc),
    fechaBuenaPro: buenaPro.fecha,
    fechaBuenaProFuente: buenaPro.fuente,
    items,
    documentos,
    adjudicaciones: adjudicaciones.map((a) => ({ ...a, personaCodigo: fichaDe(a.proveedorRuc) })),
    contratadoConosce: conosce.length ? conosce : null,
    datoDudoso,
    cruces,
    postoresDetalle: postores,
    itemsAnalizados,
    // Cada renglón de lo que se compró según las bases y el contrato leídos por pieza (null si los dos traen uno solo).
    itemsDocumento: itemsDeDocumentos(fichas.get("bases"), fichas.get("contrato"), enVigiaUrls),
    // Lo que las bases le piden al contratista: experiencia, personal, exigencias, factores, plazos, garantías, pago.
    perfilContratista: perfilDeBases(fichas.get("bases"), enVigiaUrls),
    // El acta o cuadro de evaluación leído por pieza: factores, buena pro y si la oferta más baja perdió.
    evaluacion,
    participantes: participantes.map((p) => ({ ...p, personaCodigo: fichaDe(p.ruc) })),
    ofertas,
    cronograma,
    // En un proceso enorme, los contratos de mayor monto y los totales (recortarContrato); el cronograma usa todos.
    contrato: recortarContrato(contrato),
    presupuesto,
    // INFOBRAS e Invierte.pe (migración 160): la obra (estado, avance físico y financiero, paralización, adicionales) y la
    // inversión (monto viable y costo actualizado). Sus banderas van en `cruces`, con su evidencia.
    obras: obra.obras,
    inversiones: obra.inversiones,
    alerta: alertaRow,
    // Lo que Claude leyó en los documentos (backend/lector): de dónde salió cada cosa y, del contrato y las consultas,
    // los hechos. Sus banderas van en `cruces` (migración 246), con su evidencia.
    lecturaIA: lecturaIA(lecturas, postoresAgentes.length > 0),
    // Lo que el dictamen de los agentes necesita (el acta y las bases leídas, más el contrato o las consultas), qué ya se
    // leyó y si el masivo lo está analizando o corre estos días: la ficha decía «la lectura de contratación directa no
    // está activa» mientras el masivo ya las tomaba (pedido del usuario del 2026-11-24).
    rutaDictamen: masivo ? {
      acta: lecturas.some((l) => l.clase === "buena_pro"), bases: lecturas.some((l) => l.clase === "bases"),
      contrato: lecturas.some((l) => l.clase === "contrato"), consultas: lecturas.some((l) => l.clase === "consultas"),
      enAnalisis: masivo.enAnalisis, masivoActivo: masivo.activo,
    } : null,
    // Cada dato leído de un documento, con qué es y si se pudo comprobar sin modelo (contra un registro oficial, contra
    // su propia cita o contra una segunda lectura).
    hechosDocumentos: hechos,
    // Las apelaciones que resolvió el Tribunal de Contrataciones sobre este proceso, con su resolución oficial.
    tribunal,
    procesamiento: proc.rows[0] ?? null,
    documentosEnVigia: docsGcsResumen,
    pedidoDescarga: pedido,
    clasificacion: {
      tipo: resumen.tipo ?? null,
      etapa: resumen.etapa ?? null,
      modalidad: resumen.modalidad ?? null,
      procesable: resumen.procesable ?? null,
      motivoNoProcesable: motivoNoProcesable ?? null,
      agentesAplicables: agentesAplicables ?? null,
      validacionesPendientes: validacionesPendientes ?? null,
      clasificadoAt: clasificadoAt ?? null,
    },
  }));
});

// ─── Lo que resolvió el Tribunal de Contrataciones (migración 402) ──────────

export interface ResolucionTribunal {
  /** «Resolución N.° 9712-2026-TCP-S4» */
  titulo: string;
  fecha: string | null;
  /** fundado | fundado_en_parte | infundado | improcedente | nulidad_de_oficio | desistimiento | otro */
  resultado: string | null;
  /** revoca_buena_pro, otorga_buena_pro_al_impugnante, retrotrae, nulidad, descalifica_al_adjudicatario, confirma_buena_pro */
  efectos: string[];
  motivo: string | null;
  /** El primer punto del resolutivo, copiado de la resolución y comprobado en su texto. */
  cita: string | null;
  /** Quién apeló, sólo si es una empresa o un consorcio: a una persona natural no se la nombra. */
  impugnante: string | null;
  /** La página de la resolución en gob.pe y su PDF. */
  url: string;
  pdf: string | null;
  /** Cómo se unió al proceso: la nomenclatura escrita igual, o siglas y entidad. */
  via: string | null;
  /** Migración 424: quién tenía la buena pro cuando se apeló y contra quién ordenó el Tribunal abrir un sancionador.
   * Sólo empresas (RUC 20) con su razón social del padrón; nunca una persona natural ni el nombre leído. */
  adjudicatario: { ruc: string; nombre: string | null }[];
  sancionadorContra: { ruc: string; nombre: string | null }[];
  /** Por qué el sancionador: documentacion_falsa | informacion_inexacta | otra. */
  infraccion: string[];
}

const ES_EMPRESA = /CONSORCIO|S\.?\s?A\.?\s?C\b|E\.?\s?I\.?\s?R\.?\s?L|S\.?\s?R\.?\s?L|\bS\.?\s?A\.?(\s|$)|SOCIEDAD|EMPRESA|CORPORACI|INVERSIONES|CONSTRUCTORA|SERVICIOS/i;

async function tribunalDe(ocid: string): Promise<ResolucionTribunal[]> {
  const r = await pool.query(
    // El resultado y lo que ordenó, sólo si la lectura del modelo coincide con el primer punto resolutivo tal como está
    // escrito (migración 403); si no, queda la cita literal sin calificar.
    `SELECT r.titulo, to_char(r.fecha, 'YYYY-MM-DD') AS fecha,
            CASE WHEN r.resultado_ok THEN r.resultado END AS resultado,
            CASE WHEN r.resultado_ok THEN r.efectos ELSE '{}' END AS efectos, r.motivo,
            CASE WHEN r.cita_ok THEN r.cita END AS cita, r.impugnante, r.url, r.pdf, p.via,
            COALESCE(r.infraccion, '{}') AS infraccion,
            COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('ruc', pe.ruc, 'nombre', e.razon_social))
                        FROM tribunal_parte_empresa pe LEFT JOIN empresas e ON e.ruc = pe.ruc::bpchar
                       WHERE pe.resolucion_id = r.id AND pe.rol = 'adjudicatario'), '[]') AS adjudicatario,
            COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('ruc', pe.ruc, 'nombre', e.razon_social))
                        FROM tribunal_parte_empresa pe LEFT JOIN empresas e ON e.ruc = pe.ruc::bpchar
                       WHERE pe.resolucion_id = r.id AND pe.rol = 'sancionador'), '[]') AS "sancionadorContra"
       FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
      WHERE p.ocid = $1
      ORDER BY r.fecha DESC NULLS LAST, r.id DESC`, [ocid]).catch(async (e) => {
    // Sin la 424 (DEV atrasado): la consulta de antes, sin las partes.
    if ((e as { code?: string }).code !== "42P01" && (e as { code?: string }).code !== "42703") throw e;
    return pool.query(
      `SELECT r.titulo, to_char(r.fecha, 'YYYY-MM-DD') AS fecha, CASE WHEN r.resultado_ok THEN r.resultado END AS resultado,
              CASE WHEN r.resultado_ok THEN r.efectos ELSE '{}' END AS efectos, r.motivo, CASE WHEN r.cita_ok THEN r.cita END AS cita,
              r.impugnante, r.url, r.pdf, p.via
         FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
        WHERE p.ocid = $1 ORDER BY r.fecha DESC NULLS LAST, r.id DESC`, [ocid]);
  });
  return r.rows.map((x) => ({
    ...x, efectos: x.efectos ?? [], impugnante: x.impugnante && ES_EMPRESA.test(x.impugnante) ? x.impugnante : null,
    infraccion: x.infraccion ?? [], adjudicatario: x.adjudicatario ?? [], sancionadorContra: x.sancionadorContra ?? [],
  }));
}

// ─── Los hechos de los documentos, con su comprobación (migración 323) ──────

export interface HechoDocumento {
  /** Qué es, de una lista cerrada: valor_referencial, experiencia_exigida_monto, monto_contratado… */
  tipo: string;
  /** De qué documento salió: bases, buena_pro (el acta), contrato, consultas. */
  clase: string;
  valor: number | null;
  fecha: string | null;
  cita: string | null;
  /** registro | plantilla | dos_lecturas | cita | sin_verificar | contradice_registro */
  verificado: string;
  /** El valor del registro (o de la otra lectura) contra el que se midió. */
  contra: number | null;
  /** La página del documento de donde salió, si el lector la dio. */
  pagina: number | null;
  /** Cuántas lecturas hay de este dato (de varios documentos o lectores); aquí va la mejor comprobada. */
  fuentes: number;
  /** Alguna de las otras lecturas no coincide con el registro. */
  otraNoCoincide: boolean;
}

async function hechosDe(ocid: string): Promise<HechoDocumento[]> {
  const r = await pool.query(
    // Un dato, una fila: expediente_hechos (migraciones 327-328) elige la lectura mejor comprobada de cada tipo.
    `SELECT h.tipo, h.clase, h.valor_num::float AS valor, to_char(h.valor_fecha, 'YYYY-MM-DD') AS fecha, left(h.cita, 400) AS cita,
            h.verificado, h.contra::float AS contra, h.pagina, h.fuentes,
            (h.con_contradiccion AND h.verificado <> 'contradice_registro') AS "otraNoCoincide"
       FROM expediente_hechos h JOIN hecho_tipo t ON t.tipo = h.tipo
      WHERE h.ocid = $1
      ORDER BY array_position(ARRAY['proceso', 'requisitos', 'competencia', 'consultas', 'adjudicacion', 'contrato'], t.grupo), h.tipo`, [ocid]);
  return r.rows as HechoDocumento[];
}

// ─── Lo que Claude leyó en los documentos (migración 245) ───────────────────

export interface FilaLectura {
  clase: string; version: string; modelo: string; salida: Record<string, any>; banderas: string[]; leidoAt: string;
  url: string | null; paginas: number | null;
}

/** La lectura más nueva de cada clase (sin las segundas lecturas `-2`, que sólo confirman banderas). */
async function lecturasDe(ocid: string): Promise<FilaLectura[]> {
  const r = await pool.query(
    `SELECT DISTINCT ON (l.clase) l.clase, l.version, l.modelo, l.salida, l.banderas, l.paginas,
            to_char(l.leido_at, 'YYYY-MM-DD') AS "leidoAt", d.url_origen AS url
       FROM documento_lectura l LEFT JOIN documentos_gcs d ON d.id = l.documentos[1]
      WHERE l.ocid = $1 AND l.estado = 'ok' AND l.version NOT LIKE '%-2' AND l.clase <> 'comite'
      ORDER BY l.clase, l.leido_at DESC`, [ocid]);
  return r.rows as FilaLectura[];
}

/** Los postores del acta leída, con los campos de `postoresDetalle` (los de los agentes). */
function postoresDeLectura(salida: Record<string, any>) {
  return ((salida?.postores ?? []) as any[]).map((p) => ({
    ruc: typeof p?.ruc === "string" && /^\d{11}$/.test(p.ruc.replace(/\D/g, "")) ? p.ruc.replace(/\D/g, "") : null,
    razonSocial: typeof p?.nombre === "string" ? p.nombre : null,
    estado: p?.ganador ? "ganador" : p?.admitida === false ? "no_admitido" : p?.calificada === false ? "descalificado" : "admitido",
    motivoEstado: typeof p?.motivo_fuera === "string" ? p.motivo_fuera.slice(0, 400) : null,
    montoOferta: typeof p?.monto_ofertado === "number" ? p.monto_ofertado : null,
    puntaje: typeof p?.puntaje === "number" ? p.puntaje : null,
    esGanador: p?.ganador === true, ordenPrelacion: null, item: null, citas: [] as never[],
  }));
}

/** Qué se leyó y de dónde; del contrato y las consultas, los hechos (lo del acta ya va en postoresDetalle). */
function lecturaIA(lecturas: FilaLectura[], hayAgentes: boolean) {
  if (!lecturas.length) return null;
  const de = (clase: string) => lecturas.find((l) => l.clase === clase);
  const meta = (l: FilaLectura | undefined) => l ? { modelo: l.modelo, version: l.version, leidoAt: l.leidoAt, url: l.url, paginas: l.paginas } : null;
  const k = de("contrato")?.salida;
  const q = de("consultas")?.salida;
  return {
    buenaPro: de("buena_pro") ? { ...meta(de("buena_pro")), enPostores: !hayAgentes } : null,
    contrato: k ? {
      ...meta(de("contrato")),
      numero: k.numero_contrato || null, fechaSuscripcion: k.fecha_suscripcion ?? null, moneda: k.moneda || null,
      monto: typeof k.monto_contratado === "number" ? k.monto_contratado : null, contratista: k.contratista ?? null,
      plazoDias: k.plazo_dias ?? null, inicio: k.fecha_inicio || null, fin: k.fecha_fin || null, formaDePago: k.forma_de_pago || null,
      garantia: k.garantia_fiel_cumplimiento ?? null, adelantoDirectoPct: k.adelanto_directo_pct ?? null,
      adelantoMaterialesPct: k.adelanto_materiales_pct ?? null, penalidadMoraTopePct: k.penalidad_mora_tope_pct ?? null,
      otrasPenalidades: k.otras_penalidades ?? null, controversias: k.solucion_controversias ?? null,
      cargoFirmante: k.cargo_firmante_entidad || null,
    } : null,
    consultas: q ? {
      ...meta(de("consultas")),
      consultas: q.n_consultas ?? null, participantes: q.n_participantes ?? null,
      observaciones: Array.isArray(q.observaciones) ? q.observaciones.length : 0,
      acogidas: Array.isArray(q.observaciones) ? q.observaciones.filter((o: any) => o?.respuesta === "acogida" || o?.respuesta === "acogida_parcial").length : 0,
      sobreRequisitos: Array.isArray(q.observaciones)
        ? q.observaciones.filter((o: any) => ["requisito_calificacion", "especificacion_tecnica", "marca_o_proveedor"].includes(o?.tema)).length : 0,
    } : null,
  };
}

// ─── Adjudicaciones vigentes ─────────────────────────────────────────────────

export interface FilaConosce {
  item: number; ruc: string | null; proveedor: string | null; cantidad: number | null; montoPen: number | null; estado: string | null;
  /** El valor referencial del ítem, su buena pro y su consentimiento (la pestaña «Adjudicación y contrato» y el cronograma). */
  referencial?: number | null; fechaBuenaPro?: string | null; fechaConsentimiento?: string | null;
}

/**
 * Los proveedores que CONOSCE da por adjudicados y que el OCDS no trae, uno por código (su monto sumado y su buena pro
 * más reciente). Un consorcio con código del SEACE lo abre después `crucesDeProceso` en sus integrantes.
 */
export function ganadoresSoloConosce(aws: { proveedorRuc: string | null }[], conosce: FilaConosce[]): Ganador[] {
  const yaEstan = new Set(aws.map((a) => a.proveedorRuc).filter(Boolean));
  const porRuc = new Map<string, Ganador>();
  for (const k of conosce) {
    if (!k.ruc || yaEstan.has(k.ruc)) continue;
    const g = porRuc.get(k.ruc) ?? { proveedorRuc: k.ruc, proveedor: k.proveedor, fecha: null, montoPen: null };
    if (k.montoPen != null) g.montoPen = (g.montoPen ?? 0) + k.montoPen;
    if (k.fechaBuenaPro && (!g.fecha || k.fechaBuenaPro > g.fecha)) g.fecha = k.fechaBuenaPro;
    porRuc.set(k.ruc, g);
  }
  return [...porRuc.values()];
}

/**
 * Con dos o más ganadores, el de mayor monto adjudicado: por CONOSCE (suma de sus ítems) o, sin CONOSCE, por las
 * adjudicaciones vigentes del OCDS. null con un solo ganador (se queda el del registro).
 */
export function ganadorPrincipal(conosce: FilaConosce[], adjudicaciones: { proveedorRuc: string | null; proveedor: string | null; montoPen?: number | null }[]): { ruc: string; nombre: string | null } | null {
  const suma = new Map<string, { nombre: string | null; monto: number }>();
  const fuente = conosce.some((k) => k.ruc && k.montoPen) ? conosce.map((k) => ({ ruc: k.ruc, nombre: k.proveedor, monto: k.montoPen }))
    : adjudicaciones.map((a) => ({ ruc: a.proveedorRuc, nombre: a.proveedor, monto: a.montoPen ?? null }));
  for (const x of fuente) {
    if (!x.ruc) continue;
    const g = suma.get(x.ruc) ?? { nombre: x.nombre, monto: 0 };
    g.monto += x.monto ?? 0;
    suma.set(x.ruc, g);
  }
  if (suma.size < 2) return null;
  const [ruc, g] = [...suma.entries()].sort((a, b) => b[1].monto - a[1].monto || a[0].localeCompare(b[0]))[0];
  return { ruc, nombre: g.nombre };
}

/** Ítems adjudicados del proceso en CONOSCE (una fila por ítem y proveedor). Sin la tabla, vacío. */
async function adjudicadoConosce(codigo: string): Promise<FilaConosce[]> {
  if (!/^\d+$/.test(String(codigo))) return [];
  const r = await pool.query(
    `SELECT n_item::int AS item, ruc_proveedor AS ruc, proveedor, cantidad::float AS cantidad, monto_adjudicado::float AS "montoPen", estado_item AS estado,
            monto_referencial::float AS referencial, to_char(fecha_buenapro, 'YYYY-MM-DD') AS "fechaBuenaPro",
            to_char(fecha_consentimiento, 'YYYY-MM-DD') AS "fechaConsentimiento"
       FROM conosce_adjudicaciones WHERE codigo_convocatoria = $1 ORDER BY n_item, proveedor`, [String(codigo)]).catch(() => null);
  return (r?.rows ?? []) as FilaConosce[];
}

/**
 * Varios postores pueden ganar un mismo proceso: cada uno sus ítems, o un mismo ítem repartido en cantidades. Pero el
 * OCDS también trae varias adjudicaciones sobre LOS MISMOS ítems cuando la buena pro pasó a otro postor (el ganador no
 * firmó) o lista a todos los calificados; sumarlas daba un "adjudicado" mayor que el referencial (109 procesos).
 *   · Las que no se pisan con otra (ítems distintos): todas vigentes.
 *   · Un grupo que se pisa, con CONOSCE: vigentes las de los proveedores que CONOSCE registra (si registra a varios en
 *     el mismo ítem, es un reparto y quedan todas).
 *   · Sin CONOSCE: si juntas no pasan el referencial de sus ítems (+10 %), es un reparto y quedan todas; si lo pasan,
 *     son alternativas: queda la primera, y el grupo va `sinConfirmar`.
 * `refItem`: valor referencial de cada ítem del OCDS (id → monto).
 */
export function adjudicacionesVigentes<T extends { proveedorRuc: string | null; items: string[]; montoPen?: number | null }>(
  aws: T[], conosce: FilaConosce[], refItem: Map<string, number> = new Map(),
): (T & { vigente: boolean; sinConfirmar?: boolean })[] {
  const enConosce = new Set(conosce.map((k) => k.ruc).filter(Boolean));
  const grupo = aws.map((_, i) => i);
  const raiz = (i: number): number => (grupo[i] === i ? i : (grupo[i] = raiz(grupo[i])));
  for (let i = 0; i < aws.length; i++)
    for (let j = i + 1; j < aws.length; j++)
      if (aws[i].items.some((x) => aws[j].items.includes(x))) grupo[raiz(j)] = raiz(i);
  const miembros = new Map<number, number[]>();
  aws.forEach((_, i) => miembros.set(raiz(i), [...(miembros.get(raiz(i)) ?? []), i]));
  const out = aws.map((a) => ({ ...a, vigente: true } as T & { vigente: boolean; sinConfirmar?: boolean }));
  for (const ids of miembros.values()) {
    if (ids.length < 2) continue;
    const confirmados = ids.filter((i) => aws[i].proveedorRuc && enConosce.has(aws[i].proveedorRuc));
    if (confirmados.length) {
      for (const i of ids) out[i].vigente = confirmados.includes(i);
      continue;
    }
    const itemsGrupo = new Set(ids.flatMap((i) => aws[i].items));
    const ref = [...itemsGrupo].reduce((s, it) => s + (refItem.get(it) ?? 0), 0);
    const suma = ids.reduce((s, i) => s + (aws[i].montoPen ?? 0), 0);
    if (ref > 0 && suma <= ref * 1.1) continue;   // reparto: todas vigentes
    for (const i of ids) {
      out[i].vigente = i === ids[0];
      out[i].sinConfirmar = true;
    }
  }
  return out;
}

/** Precio unitario contratado del ítem según CONOSCE (si hay un solo proveedor para ese ítem). */
function contratadoDeItem(conosce: FilaConosce[], posicion: number) {
  const filas = conosce.filter((k) => k.item === posicion && k.montoPen != null && k.cantidad);
  if (filas.length !== 1) return { precioUnitarioConosce: null, proveedorConosce: null, rucConosce: null };
  const k = filas[0];
  return { precioUnitarioConosce: Math.round((k.montoPen! / k.cantidad!) * 10000) / 10000, proveedorConosce: k.proveedor, rucConosce: k.ruc };
}

// ─── Precios por ítem (migración 84) ─────────────────────────────────────────────────────────────

interface FilaPrecio {
  posicion: number; unidad: string | null; cantidad: string | null; adjudicado: string | null; fuente: string | null;
  unit_ref: string | null; unit_adj: string | null; anio: number | null;
  a_n: number | null; a_ent: number | null; a_p25: string | null; a_med: string | null; a_p75: string | null;
  r_n: number | null; r_ent: number | null; r_p25: string | null; r_med: string | null; r_p75: string | null;
}

/** Cada ítem con su referencia: lo adjudicado contra lo adjudicado y lo presupuestado contra lo presupuestado. */
const PRECIOS_SQL = `
  SELECT p.posicion, p.unidad, p.cantidad, p.adjudicado, p.fuente_adjudicado AS fuente, p.unit_ref, p.unit_adj, p.anio,
         ra.n AS a_n, ra.entidades AS a_ent, ra.p25 AS a_p25, ra.mediana AS a_med, ra.p75 AS a_p75,
         rr.n AS r_n, rr.entidades AS r_ent, rr.p25 AS r_p25, rr.mediana AS r_med, rr.p75 AS r_p75
    FROM precio_item p
    LEFT JOIN precio_referencia ra ON ra.cubso = p.cubso AND ra.unidad = p.unidad AND ra.anio = p.anio AND ra.base = 'adjudicado'
    LEFT JOIN precio_referencia rr ON rr.cubso = p.cubso AND rr.unidad = p.unidad AND rr.anio = p.anio AND rr.base = 'referencial'
   WHERE p.ocid = $1
   ORDER BY p.posicion`;

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));

/**
 * El precio de un ítem para la ficha: unitario adjudicado (CONOSCE, el OCDS o la única adjudicación del proceso) y
 * presupuestado, y con qué se compara. Si hay precio adjudicado y referencia de lo adjudicado, se compara eso; si no,
 * lo presupuestado contra lo que presupuestan las demás entidades. Sin referencia (menos de 5 entidades, servicios),
 * `comparacion` es null.
 */
function precioDe(p: FilaPrecio | undefined) {
  if (!p) return null;
  const adj = num(p.unit_adj), ref = num(p.unit_ref);
  const base = adj != null && p.a_med != null ? "adjudicado" : ref != null && p.r_med != null ? "referencial" : null;
  const r = base === "adjudicado"
    ? { n: p.a_n, entidades: p.a_ent, p25: num(p.a_p25), mediana: num(p.a_med), p75: num(p.a_p75), unitario: adj }
    : base === "referencial"
      ? { n: p.r_n, entidades: p.r_ent, p25: num(p.r_p25), mediana: num(p.r_med), p75: num(p.r_p75), unitario: ref }
      : null;
  return {
    unitarioAdjudicado: adj,
    unitarioReferencial: ref,
    fuenteAdjudicado: p.fuente,
    comparacion: r && r.mediana
      ? { base, anio: p.anio, entidades: r.entidades, compras: r.n, p25: r.p25, mediana: r.mediana, p75: r.p75,
          razon: r.unitario != null ? Math.round((r.unitario / r.mediana) * 100) / 100 : null }
      : null,
  };
}
