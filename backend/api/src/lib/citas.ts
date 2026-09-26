/**
 * Citas con página y documento de una señal: lo que los agentes leyeron del expediente
 * (analisis_full.document_analysis / legal_analysis) emparejado con cada bandera por el texto de su
 * evidencia. Lo usan el detalle de un contrato (GET /contratos/:ocid) y el índice de señales
 * (GET /senales, sólo para las alertas de la página).
 */

import { pool } from "./db.js";

export interface CitaPublica {
  pagina: number | null;
  cita: string | null;
  documentoUrl: string | null;
  documentoTitulo: string | null;
  enVigia: boolean;
  verificada: boolean | null;
}

/** Lo que hace falta del expediente para citar: documentos (sha → url), red flags y evidencia legal. */
export interface ExpedienteCitas { documentos?: unknown[] | null; redFlags?: unknown[] | null; legalEvidencia?: unknown[] | null }

/** Lo mismo que EXPEDIENTE_SQL (contratos_sql.ts) sin postores ni ítems, para varias alertas a la vez. */
export const EXPEDIENTE_CITAS_SQL = `SELECT a.id::text AS id,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('sha256', d->>'sha256', 'url', d->>'url', 'titulo', d->>'titulo')), '[]'::jsonb)
     FROM jsonb_array_elements(COALESCE(a.analisis_full->'document_analysis'->'documentos', '[]'::jsonb)) d) AS documentos,
  COALESCE(a.analisis_full->'legal_analysis'->'red_flags_documentales', '[]'::jsonb) AS "redFlags",
  COALESCE(a.analisis_full->'legal_analysis'->'evidencia', '[]'::jsonb) AS "legalEvidencia"
  FROM alertas a WHERE a.id = ANY($1::uuid[])`;

const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);

/**
 * `cita(e)`: una evidencia del expediente como cita pública. `citasDeBandera(b)`: las citas de una
 * señal — la red flag documental cuya descripción empieza igual que su evidencia, o para
 * `objeto_no_corresponde_documento` las dos primeras evidencias legales — sólo las que tienen
 * página o documento. `enVigia` = el documento citado tiene copia vigente en el almacén de Vigía.
 */
export function crearCitador(expediente: ExpedienteCitas | null | undefined, enVigiaUrls: Set<string>) {
  const shaUrl = new Map<string, { url: string; titulo: string | null }>();
  for (const d of (expediente?.documentos ?? []) as any[]) {
    if (d?.sha256 && d?.url) shaUrl.set(String(d.sha256), { url: String(d.url), titulo: d.titulo ?? null });
  }
  const cita = (e: any): CitaPublica => {
    const doc = e?.documento_sha256 ?? e?.documento ?? null;
    const ref = doc ? shaUrl.get(String(doc)) : null;
    return { pagina: typeof e?.pagina === "number" ? e.pagina : null, cita: e?.cita ?? null, documentoUrl: ref?.url ?? null,
             documentoTitulo: ref?.titulo ?? null, enVigia: ref ? enVigiaUrls.has(ref.url) : false, verificada: e?.verificada ?? null };
  };
  // Señales del análisis legal → páginas citadas (se emparejan por el texto de la evidencia/descripción).
  const redFlags = ((expediente?.redFlags ?? []) as any[]).map((f) => ({ desc: norm(f?.descripcion), citas: (Array.isArray(f?.evidencia) ? f.evidencia : []).map(cita) }));
  const legalEvid = ((expediente?.legalEvidencia ?? []) as any[]).map(cita);
  const citasDeBandera = (b: { evidencia?: unknown; regla?: unknown }): CitaPublica[] => {
    const ev = norm(b?.evidencia);
    const rf = ev ? redFlags.find((f) => f.desc && (ev.startsWith(f.desc.slice(0, 60)) || f.desc.startsWith(ev.slice(0, 60)))) : null;
    const citas = rf?.citas?.length ? rf.citas : (b?.regla === "objeto_no_corresponde_documento" ? legalEvid.slice(0, 2) : []);
    return citas.filter((x: CitaPublica) => x.pagina != null || !!x.documentoUrl);
  };
  return { cita, citasDeBandera };
}

/**
 * Citadores de varias alertas (uuid → citador) en dos consultas: el expediente de cada una y las
 * URLs de origen de sus documentos vigentes en el almacén.
 */
export async function citadoresDeAlertas(alertaIds: string[]): Promise<Map<string, ReturnType<typeof crearCitador>>> {
  const out = new Map<string, ReturnType<typeof crearCitador>>();
  const ids = Array.from(new Set(alertaIds));
  if (!ids.length) return out;
  const [exp, vig] = await Promise.all([
    pool.query<{ id: string } & ExpedienteCitas>(EXPEDIENTE_CITAS_SQL, [ids]),
    pool.query<{ id: string; url: string }>(
      `SELECT a.id::text AS id, d.url_origen AS url
         FROM alertas a JOIN documentos_gcs d ON ocid_corto(d.ocid) = ocid_corto(a.ocid)
        WHERE a.id = ANY($1::uuid[]) AND d.borrado_at IS NULL AND d.expira_at > now()`, [ids]),
  ]);
  const vigentes = new Map<string, Set<string>>();
  for (const v of vig.rows) {
    if (!vigentes.has(v.id)) vigentes.set(v.id, new Set());
    vigentes.get(v.id)!.add(v.url);
  }
  for (const e of exp.rows) out.set(e.id, crearCitador(e, vigentes.get(e.id) ?? new Set()));
  return out;
}
