/**
 * Documentos de los expedientes (bases, actas, contratos) SÓLO de los contratos de la cola: lo que hacía
 * `vigia-batch` en GCP (backend/batch/descargar.py `pedidos` + ingestar.py), que quedó pausado con GCP.
 *
 * Qué se baja, en este orden y con un tope por corrida:
 *   1. `pedidos_descarga` abiertos (migración 15): contratos financiados (motivo financiado/admin/reintento) cuyos
 *      documentos no están o vencieron. TODOS sus documentos, como el batch (`--politica todo`).
 *   2. Si sobra lugar, contratos de `cola_auditoria` (la cola financiable, con su ventana de fechas: migración 69)
 *      sin documentos vigentes: se les abre un pedido con motivo `cola` y se bajan sólo los documentos CLAVE
 *      (bases, buena pro, contrato), para que queden "con documentos listos" cuando alguien los financie.
 * Nada fuera de la cola: la historia de la base (2015 en adelante) no se descarga.
 *
 * Por contrato: el record OCDS completo por el relay (actualiza `ocds_payload` y la clasificación, como la ingesta),
 * cada documento por el relay a R2 `vigia-peru-batch` con la misma ruta que el batch
 * (batch/documentos/<aa>/<ocid>/<id>.<ext>), y su fila en `documentos_gcs` (url_gcs gs://vigia-peru-batch/…: los
 * agentes la leen de R2 con ALMACEN_DOCS=r2). Vence a los 90 días, como antes; al vencer, se vuelve a pedir.
 * Al final, `cerrar_pedidos_atendidos()` pasa los pedidos a `listo` y re-encola los procesamientos que esperaban.
 *
 * El SEACE corta con 403 cuando ve ráfagas: se espera y se reintenta; con muchos 403 seguidos se corta la corrida.
 * `seco`: elige y cuenta, sin bajar ni escribir.
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { clasificar } from "../clasificacion.ts";
import { conDb } from "../db.ts";
import { dormir, obtener } from "../http.ts";
import { dictDe, esDict, get, iterar } from "../py.ts";
import type { Dict } from "../py.ts";
import { registrar } from "../registro.ts";
import { LECTURA } from "./comun.ts";
import { BASE, OCID_PREFIJO, obtenerJson, ocidCorto, partyComprador, rucComprador } from "./oece_ocds.ts";

const FUENTE = "documentos";
/** Contratos por corrida (cada uno es un paso con ~3-15 descargas; 12 tardan ~50 s). */
const MAX_CONTRATOS = 30;
/** Bytes por corrida: con el cron cada hora, ~24 GB al día como mucho. */
const MAX_BYTES = 1_000_000_000;
/** Un archivo más grande no se baja (los hay de cientos de MB: planos escaneados). */
const MAX_ARCHIVO = 300_000_000;
const RETENCION_DIAS = 90;
const TIPOS_CLAVE = new Set(["biddingDocuments", "awardNotice", "contractSigned"]);
const ESPERAS_403_S = [20, 60];
const MAX_403_SEGUIDOS = 8;
const BUCKET = "vigia-peru-batch";
const PREFIJO = "batch/documentos";

interface Pedido {
  id: number;
  ocid: string;
  completo: string | null;
  motivo: string;
}

interface Doc {
  id: string;
  url: string;
  tipo: string | null;
  titulo: string | null;
  seccion: string;
  formato: string | null;
  publicado: string | null;
}

/** Los documentos del compiledRelease (tender, awards, contracts), con su sección: `documentos_de_record` de Python. */
export function documentosDe(rel: Dict): Doc[] {
  const out: Doc[] = [];
  const agregar = (d: unknown, seccion: string) => {
    if (!esDict(d)) return;
    const url = typeof d.url === "string" ? d.url : "";
    if (!url) return;
    out.push({
      id: typeof d.id === "string" || typeof d.id === "number" ? String(d.id) : "",
      url,
      tipo: typeof d.documentType === "string" ? d.documentType : null,
      titulo: typeof d.title === "string" ? d.title.slice(0, 200) : null,
      seccion,
      formato: typeof d.format === "string" ? d.format : null,
      publicado: typeof d.datePublished === "string" ? d.datePublished : null,
    });
  };
  for (const d of iterar(get(dictDe(get(rel, "tender")), "documents"))) agregar(d, "tender");
  for (const a of iterar(get(rel, "awards"))) for (const d of iterar(get(dictDe(a), "documents"))) agregar(d, "award");
  for (const c of iterar(get(rel, "contracts"))) for (const d of iterar(get(dictDe(c), "documents"))) agregar(d, "contract");
  // Un mismo archivo publicado en dos secciones se baja una vez.
  const vistos = new Set<string>();
  return out.filter((d) => (vistos.has(d.url) ? false : (vistos.add(d.url), true)));
}

/** format OCDS (mime o extensión) → extensión corta: application/pdf → pdf (extension_de de Python). */
export function extension(formato: string | null): string {
  const f = (formato ?? "").toLowerCase().trim().replace(/^\./, "");
  const e = ({ "application/pdf": "pdf", "application/zip": "zip" } as Record<string, string>)[f] ?? f;
  return /^[a-z0-9]{1,6}$/.test(e) ? e : "bin";
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function sha1Corto(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s))).slice(0, 12);
}

class Corte403 extends Error {}

/** Baja un documento por el relay a R2 mientras calcula su sha256. Devuelve null si no se pudo (y por qué). */
async function bajar(env: Env, d: Doc, clave: string, estado: { seguidos403: number }): Promise<{ sha256: string; bytes: number } | { error: string }> {
  for (let i = 0; ; i++) {
    const r = await obtener(env, d.url, { relay: true, timeoutMs: null, sinReintentos: false });
    if (r.status === 403) {
      await r.body?.cancel();
      estado.seguidos403++;
      if (estado.seguidos403 >= MAX_403_SEGUIDOS) throw new Corte403(`${MAX_403_SEGUIDOS} HTTP 403 seguidos del SEACE`);
      const espera = ESPERAS_403_S[i];
      if (espera === undefined) return { error: "HTTP 403" };
      await dormir(espera * 1000);
      continue;
    }
    if (!r.ok || !r.body) {
      await r.body?.cancel();
      return { error: `HTTP ${r.status}` };
    }
    estado.seguidos403 = 0;
    const largo = Number(r.headers.get("content-length") ?? "");
    if (largo > MAX_ARCHIVO) {
      await r.body.cancel();
      return { error: `muy grande (${Math.round(largo / 1e6)} MB)` };
    }
    const [a, b] = r.body.tee();
    const digest = new crypto.DigestStream("SHA-256");
    const hash = a.pipeTo(digest);
    let bytes: number;
    if (Number.isFinite(largo) && largo > 0) {
      // Con largo conocido, directo a R2 sin juntarlo en memoria.
      const fijo = new FixedLengthStream(largo);
      const copia = b.pipeTo(fijo.writable);
      await Promise.all([env.DOCUMENTOS.put(clave, fijo.readable), copia]);
      bytes = largo;
    } else {
      // Sin content-length: se junta (con tope) y se sube de una vez.
      const partes: Uint8Array[] = [];
      let n = 0;
      for await (const p of b as unknown as AsyncIterable<Uint8Array>) {
        n += p.byteLength;
        if (n > MAX_ARCHIVO) return { error: "muy grande (sin content-length)" };
        partes.push(p);
      }
      const todo = new Uint8Array(n);
      let o = 0;
      for (const p of partes) (todo.set(p, o), (o += p.byteLength));
      await env.DOCUMENTOS.put(clave, todo);
      bytes = n;
    }
    await hash;
    return { sha256: hex(await digest.digest), bytes };
  }
}

export async function correrDocumentos(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  // 1. Pedidos abiertos (financiados primero) y, si sobra lugar, contratos de la cola sin documentos.
  const pedidos = await step.do("tomar pedidos", LECTURA, () =>
    conDb(env.HYPERDRIVE, async (db) => {
      if (p.seco) {
        return db.filas<Pedido>(
          `SELECT id::int, ocid, NULL AS completo, motivo FROM pedidos_descarga
            WHERE estado = 'pendiente' ORDER BY (motivo = 'cola'), solicitado_at LIMIT $1`, [MAX_CONTRATOS]);
      }
      // La corrida es un lote, como los del batch (documentos_gcs.lote_id → lotes_ingesta).
      await db.ejecutar(
        `INSERT INTO lotes_ingesta (id, tipo, manifest_uri, estado, iniciado_at) VALUES ($1, 'documentos', $2, 'procesando', now())
         ON CONFLICT (id) DO NOTHING`, [`cf-${id}`, `r2://${BUCKET}/${PREFIJO}/`]);
      // Tres intentos sin lograrlo → fallido; el procesamiento que esperaba queda en error (se ve en /admin).
      const fallidos = await db.filas<{ ocid: string }>(
        `UPDATE pedidos_descarga SET estado = 'fallido', error = COALESCE(error, 'sin documentos tras 3 intentos')
          WHERE estado = 'descargando' AND intentos >= 3 AND tomado_at < now() - interval '2 hours' RETURNING ocid`);
      if (fallidos.length) {
        await db.ejecutar(
          `UPDATE procesamientos SET estado = 'error', error = 'documentos no descargables tras 3 intentos'
            WHERE estado = 'esperando_documentos' AND ocid = ANY($1::text[])`, [fallidos.map((f) => f.ocid)]);
      }
      const abiertos = await db.filas<{ n: number }>(
        "SELECT count(*)::int AS n FROM pedidos_descarga WHERE estado = 'pendiente' AND motivo <> 'cola'");
      const lugar = MAX_CONTRATOS - (abiertos[0]?.n ?? 0);
      if (lugar > 0) {
        // Lo más reciente de la cola primero; sin los que ya tuvieron un pedido en los últimos 30 días.
        await db.ejecutar(
          `SELECT pedir_descarga(q.ocid, 'cola')
             FROM (SELECT q.ocid FROM cola_auditoria q
                    WHERE NOT EXISTS (SELECT 1 FROM documentos_vigentes(q.ocid))
                      AND NOT EXISTS (SELECT 1 FROM pedidos_descarga pd
                                       WHERE ocid_corto(pd.ocid) = ocid_corto(q.ocid) AND pd.solicitado_at > now() - interval '30 days')
                    ORDER BY q.fecha_convocatoria DESC NULLS LAST, q.ocid LIMIT $1) q`, [lugar]);
      }
      return db.filas<Pedido>(
        `UPDATE pedidos_descarga p SET estado = 'descargando', tomado_at = now(), intentos = intentos + 1, lote_id = $2
           FROM (SELECT id FROM pedidos_descarga
                  WHERE estado = 'pendiente' OR (estado = 'descargando' AND tomado_at < now() - interval '2 hours')
                  ORDER BY (motivo = 'cola'), solicitado_at LIMIT $1 FOR UPDATE SKIP LOCKED) t
          WHERE p.id = t.id
          RETURNING p.id::int, p.ocid, p.motivo,
            (SELECT c.ocds_payload->>'ocid' FROM convocatorias c WHERE ocid_corto(c.ocid) = ocid_corto(p.ocid) LIMIT 1) AS completo`,
        [MAX_CONTRATOS, `cf-${id}`]);
    }));
  registrar("INFO", `   ${pedidos.length} contratos: ${pedidos.filter((x) => x.motivo !== "cola").length} financiados, ` +
    `${pedidos.filter((x) => x.motivo === "cola").length} de la cola`, { fuente: FUENTE, instancia: id });
  if (p.seco) return { pedidos };

  // 2. Un paso por contrato: record, documentos a R2, filas en documentos_gcs.
  let bytes = 0;
  let archivos = 0;
  const resumen: { ocid: string; motivo: string; documentos: number; bajados: number; errores: number }[] = [];
  let corte: string | null = null;
  for (const ped of pedidos) {
    if (bytes >= MAX_BYTES || corte) break;
    const r = await step.do(`contrato ${ped.ocid}`, { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" }, async () => {
      const corto = ocidCorto(ped.ocid);
      const completo = ped.completo?.startsWith("ocds-") ? ped.completo : OCID_PREFIJO + corto;
      const datos = await obtenerJson(env, `${BASE}/record/${completo}`);
      const rec = dictDe(iterar(get(datos, "records"))[0]);
      const rel = dictDe(get(rec, "compiledRelease"));
      if (!Object.keys(rel).length) return { documentos: 0, bajados: 0, errores: 0, bytes: 0, error: "sin record", corte: null as string | null };
      const todos = documentosDe(rel);
      const docs = ped.motivo === "cola" ? todos.filter((d) => d.tipo && TIPOS_CLAVE.has(d.tipo)) : todos;
      const aa = corto.slice(-2).padStart(2, "0");
      const estado = { seguidos403: 0 };
      const filas: unknown[][] = [];
      let errores = 0;
      let suma = 0;
      let cortado: string | null = null;
      for (const d of docs) {
        const nombre = (d.id && /^[\w-]{1,40}$/.test(d.id) ? d.id : await sha1Corto(d.url)) + "." + extension(d.formato);
        const clave = `${PREFIJO}/${aa}/${corto}/${nombre}`;
        try {
          const b = await bajar(env, d, clave, estado);
          if ("error" in b) {
            errores++;
            registrar("WARNING", `   ${corto} ${d.tipo ?? "?"} → ${b.error}`, { fuente: FUENTE, instancia: id });
            continue;
          }
          suma += b.bytes;
          filas.push([corto, d.tipo, d.titulo, d.seccion, `gs://${BUCKET}/${clave}`, b.sha256, b.bytes, d.url, extension(d.formato), d.publicado]);
        } catch (e) {
          if (e instanceof Corte403) { cortado = e.message; break; }
          errores++;
          registrar("WARNING", `   ${corto} ${d.tipo ?? "?"} → ${(e as Error).message?.slice(0, 160)}`, { fuente: FUENTE, instancia: id });
        }
      }
      await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
        // El record completo (parties, awards, contracts) y la clasificación al día, como la ingesta del batch.
        const ruc = rucComprador(partyComprador(rel));
        const c = clasificar(rel, ruc);
        await db.ejecutar(
          `UPDATE convocatorias SET ocds_payload = $2::jsonb, tipo_contratacion = $3, etapa = $4, modalidad = $5, procesable = $6,
                  motivo_no_procesable = $7, agentes_aplicables = $8::text[], validaciones_pendientes = $9::text[],
                  proveedor_ruc = COALESCE($10, proveedor_ruc), clasificado_at = now(), updated_at = now()
            WHERE ocid_corto(ocid) = $1`,
          [corto, JSON.stringify(rel), c.tipo, c.etapa, c.modalidad, c.procesable, c.motivo_no_procesable, c.agentes,
            c.validaciones_pendientes, c.proveedor_ruc]);
        for (const f of filas) {
          await db.ejecutar(
            `INSERT INTO documentos_gcs (ocid, tipo, titulo, seccion, url_gcs, sha256, bytes, url_origen, formato, publicado_at, lote_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11)
             ON CONFLICT (ocid, sha256) DO UPDATE SET
               url_gcs = EXCLUDED.url_gcs, tipo = COALESCE(EXCLUDED.tipo, documentos_gcs.tipo),
               titulo = COALESCE(EXCLUDED.titulo, documentos_gcs.titulo), bytes = COALESCE(EXCLUDED.bytes, documentos_gcs.bytes),
               formato = COALESCE(EXCLUDED.formato, documentos_gcs.formato), lote_id = EXCLUDED.lote_id,
               creado_at = now(), borrado_at = NULL, expira_at = now() + make_interval(days => ${RETENCION_DIAS})`,
            [...f, `cf-${id}`]);
        }
        // Sin documentos que bajar (el record no trae, o ninguno clave): el pedido queda atendido igual y el
        // procesamiento que esperaba vuelve a la cola (el agente lee lo que haya), como cerrar_pedidos_atendidos().
        if (!docs.length) {
          await db.ejecutar(
            `UPDATE pedidos_descarga SET estado = 'listo', atendido_at = now(), error = 'el record no trae documentos para bajar' WHERE id = $1`, [ped.id]);
          await db.ejecutar(
            `UPDATE procesamientos SET estado = 'encolado', error = NULL, encolado_at = now()
              WHERE ocid_corto(ocid) = $1 AND estado = 'esperando_documentos'`, [corto]);
        } else if (!filas.length && !cortado) {
          await db.ejecutar(`UPDATE pedidos_descarga SET error = $2 WHERE id = $1`, [ped.id, `${errores} documentos sin bajar`]);
        }
      }));
      return { documentos: docs.length, bajados: filas.length, errores, bytes: suma, error: null as string | null, corte: cortado };
    });
    bytes += r.bytes;
    archivos += r.bajados;
    resumen.push({ ocid: ped.ocid, motivo: ped.motivo, documentos: r.documentos, bajados: r.bajados, errores: r.errores });
    registrar("INFO", `   ${ped.ocid} (${ped.motivo}) · ${r.bajados}/${r.documentos} documentos · ${(r.bytes / 1e6).toFixed(1)} MB` +
      (r.error ? ` · ${r.error}` : ""), { fuente: FUENTE, instancia: id });
    if (r.corte) corte = r.corte;
  }

  // 3. Pedidos con documentos nuevos → listo; sus procesamientos vuelven a la cola. Lo que no se alcanzó a tomar
  //    (tope de bytes o corte por 403) vuelve a pendiente para la próxima corrida.
  const cierre = await step.do("cerrar pedidos", LECTURA, () =>
    conDb(env.HYPERDRIVE, async (db) => {
      const reencolados = (await db.filas<{ n: number }>("SELECT cerrar_pedidos_atendidos() AS n"))[0]?.n ?? 0;
      const hechos = resumen.map((x) => x.ocid);
      const devueltos = await db.filas<{ id: number }>(
        `UPDATE pedidos_descarga SET estado = 'pendiente', intentos = greatest(intentos - 1, 0)
          WHERE lote_id = $1 AND estado = 'descargando' AND NOT (ocid = ANY($2::text[])) RETURNING id::int`, [`cf-${id}`, hechos]);
      const ok = resumen.filter((x) => x.bajados > 0 || x.documentos === 0).length;
      await db.ejecutar(
        `UPDATE lotes_ingesta SET estado = $2, total = $3::int, ok = $4::int, fallidos = $3::int - $4::int, finalizado_at = now(), error = $5 WHERE id = $1`,
        [`cf-${id}`, corte ? "error" : "ok", resumen.length, ok, corte]);
      return { reencolados, devueltos: devueltos.length };
    }));
  return { contratos: resumen.length, archivos, mb: Math.round(bytes / 1e6), corte, ...cierre, detalle: resumen };
}
