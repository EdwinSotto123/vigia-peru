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
import { signReadUrl } from "../lib/storage.js";
import { convocatoriaNoDemo, esPublicada, redactarResultado } from "../lib/publicacion.js";
import { cachePublico } from "../lib/http.js";
import { crearCitador } from "../lib/citas.js";
import { crucesDeProceso } from "../lib/cruces.js";
import { obraDelContrato } from "../lib/obras.js";
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

  // Migración 48: cruces del ganador con ONPE, JNE, visitas, penalidades y sanciones (lib/cruces.ts).
  const cruces = await crucesDeProceso(row.ocid, adjudicaciones);

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

  cache(c, 60);
  // Proveedor persona natural (nombre y RUC 10), postores, participantes, citas y señales: tapados (lib/privacidad.ts).
  return c.json(publicar({
    ...resumen,
    fechaBuenaPro: buenaPro.fecha,
    fechaBuenaProFuente: buenaPro.fuente,
    items,
    documentos,
    adjudicaciones,
    contratadoConosce: conosce.length ? conosce : null,
    datoDudoso,
    cruces,
    postoresDetalle: postores,
    itemsAnalizados,
    participantes,
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

// ─── Adjudicaciones vigentes ─────────────────────────────────────────────────

export interface FilaConosce {
  item: number; ruc: string | null; proveedor: string | null; cantidad: number | null; montoPen: number | null; estado: string | null;
  /** El valor referencial del ítem, su buena pro y su consentimiento (la pestaña «Adjudicación y contrato» y el cronograma). */
  referencial?: number | null; fechaBuenaPro?: string | null; fechaConsentimiento?: string | null;
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
