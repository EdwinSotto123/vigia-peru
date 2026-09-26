/**
 * Detalle de un contrato:
 *   GET /contratos/:ocid/documento?url=<url_origen SEACE>   URL firmada (15 min) del documento guardado
 *   GET /contratos/:ocid                                    ContratoResumen & { items, documentos, alerta,
 *                                                           procesamiento, clasificacion, postoresDetalle, itemsAnalizados }
 * Se monta al final de contratosRouter (las rutas fijas /resumen y /geo van antes que `/:ocid`).
 */

import { Hono } from "hono";
import { OCID_CANDIDATOS, pool } from "../lib/db.js";
import { COLS as COLS_PROCESAMIENTO, RESULTADO_SQL } from "./procesamientos.js";
import { signReadUrl } from "../lib/storage.js";
import { convocatoriaNoDemo, esPublicada, redactarResultado } from "../lib/publicacion.js";
import { cachePublico } from "../lib/http.js";
import { crearCitador } from "../lib/citas.js";
import {
  EXPEDIENTE_SQL, FROM_FILA, JOIN_RESUMEN, alcanceActivo, col, colsDisponibles, exprs, selectResumen,
} from "./contratos_sql.js";

export const contratosDetalleRouter = new Hono();

const cache = (c: { header: (k: string, v: string) => void }, s: number) => c.header("Cache-Control", cachePublico(s, { maxAge: 30, swr: 30 }));

// ─── GET /contratos/:ocid ────────────────────────────────────────────────────
// URL firmada (15 min) para ver/descargar un documento guardado en el almacén de Vigía.
//   GET /contratos/:ocid/documento?url=<url_origen SEACE>
contratosDetalleRouter.get("/:ocid/documento", async (c) => {
  const ocid = c.req.param("ocid");
  const url = c.req.query("url") ?? "";
  if (!url) return c.json({ error: "falta url" }, 400);
  const r = await pool.query(
    `SELECT d.url_gcs AS "urlGcs", d.formato, d.titulo, d.bytes, d.expira_at AS "expiraAt"
     FROM documentos_gcs d
     WHERE ocid_corto(d.ocid) = ocid_corto($1) AND d.url_origen = $2 AND d.borrado_at IS NULL AND d.expira_at > now()
     ORDER BY d.creado_at DESC LIMIT 1`, [ocid, url]).catch(() => ({ rows: [] as any[] }));
  const d = r.rows[0];
  if (!d) return c.json({ error: "no_disponible", detail: "El documento no está en el almacén de Vigía (se descarga al financiar el análisis)." }, 404);
  const mime: Record<string, string> = { pdf: "application/pdf", zip: "application/zip", rar: "application/vnd.rar", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const formato = String(d.formato ?? "").toLowerCase();
  const nombre = `${ocid}-${(d.titulo ?? "documento").replace(/[^\w.-]+/g, "_").slice(0, 80)}.${formato || "bin"}`;
  const firmada = await signReadUrl(d.urlGcs, { filename: nombre, contentType: mime[formato] });
  c.header("Cache-Control", "private, no-store");
  return c.json({ url: firmada, formato, bytes: d.bytes, expiraAt: d.expiraAt, previsualizable: formato === "pdf", venceEnSeg: 900 });
});

contratosDetalleRouter.get("/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  if (!/^[\w.-]{1,64}$/.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const cols = await colsDisponibles();
  const ex = exprs(cols, await alcanceActivo());
  const emp = cols.has("proveedor_ruc")
    ? `LEFT JOIN empresas emp ON emp.ruc = c.proveedor_ruc`
    : `LEFT JOIN empresas emp ON emp.ruc = NULLIF(regexp_replace(c.ocds_payload->'awards'->0->'suppliers'->0->>'id', '^PE-RUC-', ''), '')`;
  const r = await pool.query(
    `SELECT ${selectResumen(ex)},
            to_char(c.fecha_buena_pro, 'YYYY-MM-DD') AS "fechaBuenaPro",
            c.tipo_proceso AS "tipoProceso", c.fuente_financiamiento AS "fuenteFinanciamiento",
            c.ocds_payload->'tender'->>'title' AS "nomenclatura",
            c.ocds_payload->'tender'->>'description' AS descripcion,
            (c.ocds_payload->'tender'->>'numberOfTenderers')::int AS "postores",
            COALESCE(c.ocds_payload->'tender'->'items', c.ocds_payload->'awards'->0->'items', '[]'::jsonb) AS items_raw,
            -- documentos de tender + awards + contracts (el record completo trae los tres niveles)
            (SELECT COALESCE(jsonb_agg(d || jsonb_build_object('seccion', s)), '[]'::jsonb) FROM (
               SELECT d, 'tender' AS s FROM jsonb_array_elements(COALESCE(c.ocds_payload->'tender'->'documents', '[]'::jsonb)) d
               UNION ALL SELECT d, 'award' FROM jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) a,
                                             jsonb_array_elements(COALESCE(a->'documents', '[]'::jsonb)) d
               UNION ALL SELECT d, 'contract' FROM jsonb_array_elements(COALESCE(c.ocds_payload->'contracts', '[]'::jsonb)) k,
                                                jsonb_array_elements(COALESCE(k->'documents', '[]'::jsonb)) d) x) AS docs_raw,
            c.ocds_payload->'awards' AS awards_raw,
            a.id AS alerta_id, a.codigo AS "alertaCodigo",
            ${ex.motivo} AS "motivoNoProcesable", ${ex.agentes} AS "agentesAplicables", ${ex.validaciones} AS "validacionesPendientes",
            ${col(cols, "clasificado_at", "timestamptz")} AS "clasificadoAt"
     ${FROM_FILA}
     ${emp}
     ${JOIN_RESUMEN}
     WHERE c.ocid = ANY(${OCID_CANDIDATOS("$1")}) AND ocid_corto(c.ocid) = ocid_corto($1) AND ${convocatoriaNoDemo("c")}
     ORDER BY (c.ocid = $1) DESC LIMIT 1`,
    [ocid],
  );
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  const row = r.rows[0];
  const { items_raw, docs_raw, awards_raw, alerta_id, alertaCodigo, motivoNoProcesable, agentesAplicables, validacionesPendientes, clasificadoAt, ...resumen } = row;

  const [alerta, proc, docsGcs, pedido, expedienteRaw] = await Promise.all([
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
  ]);

  // Alerta no publicada (revision/descartada): sin score, señales, mercado ni reglas, y sin lo que los
  // agentes leyeron del expediente — el análisis entero está sin publicar (lib/publicacion.ts §2).
  const alertaRow: Record<string, any> | null = redactarResultado(alerta?.rows[0] ?? null);
  const expediente = alertaRow && esPublicada(alertaRow.estado) ? expedienteRaw : null;

  const items = (Array.isArray(items_raw) ? items_raw : []).map((it: any, i: number) => ({
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
  const adjudicaciones = (Array.isArray(awards_raw) ? awards_raw : []).map((aw: any) => ({
    id: aw?.id ?? null,
    fecha: aw?.date ? String(aw.date).slice(0, 10) : null,
    montoPen: typeof aw?.value?.amount === "number" ? aw.value.amount : null,
    proveedor: aw?.suppliers?.[0]?.name ?? null,
    proveedorRuc: aw?.suppliers?.[0]?.id ? String(aw.suppliers[0].id).replace(/^PE-RUC-/, "") : null,
  }));

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
  const postores = [...porClave.values()].filter((p) => {
    if (p.ruc) return true;
    const r = normRazon(p.razonSocial);
    const dueno = conRuc.find((q) => { const qr = normRazon(q.razonSocial); return qr.length >= 8 && r.startsWith(qr); });
    if (!dueno) return true;
    if (!dueno.citas.length && p.citas.length) dueno.citas = p.citas;
    dueno.esGanador = dueno.esGanador || p.esGanador;
    return false;
  });
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
      marca: it?.marca_ofertada ?? null, origenPrecio: it?.origen_precio ?? null,
      citas: (Array.isArray(it?.evidencia) ? it.evidencia : []).slice(0, 2).map(cita),
    };
  });
  // Señales del análisis legal → páginas citadas (lib/citas.ts, mismo emparejamiento que GET /senales).
  if (alertaRow && Array.isArray(alertaRow.banderas)) {
    alertaRow.banderas = alertaRow.banderas.map((b: any) => ({ ...b, citas: citasDeBandera(b) }));
  }

  cache(c, 60);
  return c.json({
    ...resumen,
    items,
    documentos,
    adjudicaciones,
    postoresDetalle: postores,
    itemsAnalizados,
    alerta: alertaRow,
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
  });
});
