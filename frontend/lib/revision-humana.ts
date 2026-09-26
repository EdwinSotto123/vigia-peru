/**
 * "En revisión humana": los análisis financiados que terminaron y la autoevaluación frenó.
 * Salió de lib/revision.ts (que lo reexporta) cuando ese módulo pasó las 800 líneas.
 *
 * Fuente: `GET /financiamiento/procesamientos?alerta=revision` y los motivos públicos de
 * cada alerta (en la fila, por lote o, con la API vieja, uno por uno).
 */

import { API_BASE } from "@/lib/api-client";
import { TOPE_LISTA_PROCESAMIENTOS, type Procesamiento, type RevisionMotivo } from "@/lib/auditoria";
import { enParalelo } from "@/lib/concurrencia";

export interface RevisionPublica {
  codigo: string;
  estado: string;
  analizadoEn: string | null;
  enRevision: boolean;
  motivos: RevisionMotivo[];
  queSignifica: string;
}

/**
 * `GET /alertas/:codigo/revision` — implementado en el backend desde la
 * autoevaluación y sin una sola llamada desde el frontend hasta ahora. Devuelve, en
 * lenguaje público y sin el texto de los jueces, por qué un análisis terminado no
 * se publicó.
 */
export async function getRevisionPublica(codigo: string): Promise<RevisionPublica | null> {
  try {
    const res = await fetch(`${API_BASE}/alertas/${encodeURIComponent(codigo)}/revision`, { next: { revalidate: 120 } } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<RevisionPublica>;
    return {
      codigo: j.codigo ?? codigo,
      estado: j.estado ?? "revision",
      analizadoEn: j.analizadoEn ?? null,
      enRevision: !!j.enRevision,
      motivos: Array.isArray(j.motivos) ? j.motivos : [],
      queSignifica: j.queSignifica ?? "",
    };
  } catch {
    return null;
  }
}

export interface AnalisisEnRevision {
  procesamiento: Procesamiento;
  revision: RevisionPublica | null;
}

/** Una fila de procesamiento con sus motivos (API nueva, `?alerta=revision`). */
type ProcesamientoConMotivos = Procesamiento & { motivos?: unknown };

/**
 * Los procesados cuya alerta quedó en revisión. `alerta=revision` es el filtro nuevo; la API
 * vieja lo ignora y devuelve los procesados (con tope): el filtro por `alertaEstado` de
 * `getAnalisisEnRevision` cubre los dos casos. `estado=procesado` va en ambos.
 */
async function getProcesamientosEnRevision(): Promise<ProcesamientoConMotivos[] | null> {
  try {
    const qs = new URLSearchParams({ alerta: "revision", estado: "procesado", limit: String(TOPE_LISTA_PROCESAMIENTOS) });
    const res = await fetch(`${API_BASE}/financiamiento/procesamientos?${qs}`, { next: { revalidate: 30 } } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: ProcesamientoConMotivos[] };
    return Array.isArray(j.data) ? j.data : null;
  } catch {
    return null;
  }
}

const esMotivo = (m: unknown): m is RevisionMotivo =>
  !!m && typeof m === "object" && typeof (m as RevisionMotivo).clave === "string" && typeof (m as RevisionMotivo).titulo === "string";

/** Lo que el API devuelve por alerta en el lote: la revisión completa o sólo sus motivos. */
function revisionDe(codigo: string, v: unknown): RevisionPublica | null {
  if (Array.isArray(v)) return { codigo, estado: "revision", analizadoEn: null, enRevision: true, motivos: v.filter(esMotivo), queSignifica: "" };
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<RevisionPublica>;
  return {
    codigo: typeof o.codigo === "string" ? o.codigo : codigo,
    estado: typeof o.estado === "string" ? o.estado : "revision",
    analizadoEn: typeof o.analizadoEn === "string" ? o.analizadoEn : null,
    enRevision: o.enRevision !== false,
    motivos: Array.isArray(o.motivos) ? o.motivos.filter(esMotivo) : [],
    queSignifica: typeof o.queSignifica === "string" ? o.queSignifica : "",
  };
}

/**
 * `GET /alertas/revision?codigos=a,b,c`: los motivos de varias alertas en una llamada.
 * Acepta `{data: [...]}`, un arreglo, o un objeto por código (`{data: {codigo: …}}`).
 * `null` si el endpoint no existe (COMPAT-API-VIEJA: 404) o no responde.
 */
async function getRevisionesPorLote(codigos: string[]): Promise<Map<string, RevisionPublica> | null> {
  const out = new Map<string, RevisionPublica>();
  if (codigos.length === 0) return out;
  try {
    const res = await fetch(`${API_BASE}/alertas/revision?codigos=${codigos.map(encodeURIComponent).join(",")}`, {
      next: { revalidate: 120 },
    } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as unknown;
    const cuerpo = j && typeof j === "object" && !Array.isArray(j) && "data" in j ? (j as { data: unknown }).data : j;
    if (Array.isArray(cuerpo)) {
      for (const x of cuerpo) {
        const codigo = x && typeof x === "object" && typeof (x as { codigo?: unknown }).codigo === "string" ? (x as { codigo: string }).codigo : null;
        const r = codigo ? revisionDe(codigo, x) : null;
        if (codigo && r) out.set(codigo, r);
      }
    } else if (cuerpo && typeof cuerpo === "object") {
      for (const [codigo, v] of Object.entries(cuerpo as Record<string, unknown>)) {
        const r = revisionDe(codigo, v);
        if (r) out.set(codigo, r);
      }
    } else {
      return null;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Los análisis que terminaron y NO se publicaron.
 *
 * No salen de `GET /alertas`: esa lista excluye `estado = 'revision'` en SQL. La única
 * puerta pública es el tablero de procesamientos, donde la columna `alertaEstado` marca
 * cuáles quedaron bloqueados. Los motivos, en este orden:
 *  1. en cada fila (`motivos`), si la API nueva eligió esa forma;
 *  2. por lote, `GET /alertas/revision?codigos=` (una llamada para todas);
 *  3. COMPAT-API-VIEJA: una llamada por alerta a `/alertas/:codigo/revision`, como antes.
 */
export async function getAnalisisEnRevision(): Promise<AnalisisEnRevision[]> {
  const procs = await getProcesamientosEnRevision();
  const enRevision = (procs ?? []).filter((p) => p.alertaEstado === "revision");
  let revisiones: (RevisionPublica | null)[];
  if (enRevision.length > 0 && enRevision.every((p) => Array.isArray(p.motivos))) {
    revisiones = enRevision.map((p) => revisionDe(p.alertaCodigo ?? p.ocid, { analizadoEn: p.finalizadoAt, motivos: p.motivos }));
  } else {
    const codigos = enRevision.map((p) => p.alertaCodigo).filter((c): c is string => !!c);
    const lote = await getRevisionesPorLote(codigos);
    revisiones = lote
      ? enRevision.map((p) => (p.alertaCodigo ? lote.get(p.alertaCodigo) ?? null : null))
      : // COMPAT-API-VIEJA: sin lote, una llamada por alerta (concurrencia 6).
        await enParalelo(enRevision, 6, (p) => (p.alertaCodigo ? getRevisionPublica(p.alertaCodigo) : Promise.resolve(null)));
  }
  return enRevision
    .map((p, i) => {
      // `motivos` sólo servía para armar la revisión: no viaja con la fila al componente.
      const { motivos: _motivos, ...procesamiento } = p;
      return { procesamiento: procesamiento as Procesamiento, revision: revisiones[i] };
    })
    .sort((a, b) => (b.procesamiento.finalizadoAt ?? "").localeCompare(a.procesamiento.finalizadoAt ?? ""));
}
