/**
 * `GET /senales` — el índice de señales paginado, filtrado y contado en el servidor
 * (fase 2 de la auditoría técnica, hallazgos A5 y C8).
 *
 * Antes /app/hallazgos pedía `/alertas?limit=500` (el universo con tope) y después un
 * `/contratos/:ocid` por alerta para saber el agente, el cotejo y las citas: 1 + 94
 * llamadas por render en frío, y un universo que se truncaba en silencio pasando las 500
 * alertas. Ahora: una llamada por página, con `siguiente` (cursor), `total` y `facetas`
 * contados en SQL sobre el universo filtrado.
 *
 *   GET /senales?severidad=&regla=&agente=&entidad=&q=&cotejo=&cursor=&limit=25   (máx. 50)
 *   → { data, siguiente, total, facetas }
 *
 * El adaptador acepta nombres de campo en camelCase o snake_case y objetos anidados
 * (`alerta`, `convocatoria`, `entidad`) o planos: el contrato exacto lo fija la API y
 * esto no se rompe por un nombre. Nunca inventa un dato: lo que no llega queda `null`.
 *
 * COMPAT-API-VIEJA: si `/senales` responde 404, `getSenalesPagina` lo dice
 * (`estado: "sin-endpoint"`) y la página usa la ruta vieja de lib/revision.ts.
 */

import { API_BASE } from "@/lib/api-client";
import type { CitaDocumento } from "@/lib/auditoria";
import { esAlertaDemo } from "@/lib/semillas";
import {
  SIN_AGENTE,
  agenteLabel,
  descripcionRegla,
  etiquetaReglaConApi,
  personasPrivadas,
  type CatalogoReglas,
  type NivelBandera,
  type Senal,
  type SenalesQuery,
} from "@/lib/revision";

/** Filas por página (el API acepta hasta 50). */
export const TAM_SENALES = 25;

export interface OpcionSenales {
  /** El valor tal como lo manda el API: es el que se devuelve en el filtro. */
  valor: string;
  etiqueta: string;
  n: number;
}

export interface FacetasApi {
  severidad: OpcionSenales[];
  regla: OpcionSenales[];
  agente: OpcionSenales[];
  cotejo: OpcionSenales[];
  /** Lista de entidades, si el API la manda (el contrato sólo promete su total). */
  entidad: OpcionSenales[] | null;
  /** Cuántas entidades distintas hay en el universo filtrado. */
  entidades: number | null;
  /** Cuántos contratos distintos, si el API lo manda. */
  contratos: number | null;
}

export type PaginaSenales =
  | { estado: "ok"; senales: Senal[]; siguiente: string | null; total: number; facetas: FacetasApi }
  /** COMPAT-API-VIEJA: `/senales` no existe todavía en esta API (404). */
  | { estado: "sin-endpoint" }
  | { estado: "fallo" };

// ─── Lectura tolerante ────────────────────────────────────────────────────

type Crudo = Record<string, unknown>;

const obj = (v: unknown): Crudo | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Crudo) : null);

function txt(...vs: unknown[]): string | null {
  for (const v of vs) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function num(...vs: unknown[]): number | null {
  for (const v of vs) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const SEVERIDADES: NivelBandera[] = ["alta", "media", "baja"];
const severidadDe = (v: unknown): NivelBandera => (SEVERIDADES.includes(v as NivelBandera) ? (v as NivelBandera) : "baja");

/** El cotejo en sus tres estados, venga como booleano, como texto o dentro de `cotejo`. */
function cotejoDe(r: Crudo): boolean | null {
  for (const v of [r.verificada, r.cotejada, obj(r.cotejo)?.ok, r.cotejo, obj(r.verificacion)?.ok]) {
    if (v === true || v === false) return v;
    if (typeof v === "string") {
      const k = v.toLowerCase();
      if (["true", "cotejada", "verificada", "si", "sí", "ok"].includes(k)) return true;
      if (["false", "no_confirmada", "fallida", "no"].includes(k)) return false;
      if (["null", "sin_cotejo", "sin", "pendiente"].includes(k)) return null;
    }
  }
  return null;
}

/** La etiqueta de una opción de cotejo, con las mismas palabras que el sello de cada fila. */
export function etiquetaCotejo(valor: string): string {
  const k = valor.toLowerCase();
  if (["true", "cotejada", "verificada", "si", "sí", "ok"].includes(k)) return "Cotejada";
  if (["false", "no_confirmada", "fallida", "no"].includes(k)) return "No se pudo cotejar";
  return "Sin cotejo";
}

function citaDe(c: unknown): CitaDocumento | null {
  const o = obj(c);
  if (!o) return null;
  const cita: CitaDocumento = {
    pagina: num(o.pagina, o.page),
    cita: txt(o.cita, o.texto, o.fragmento),
    documentoUrl: txt(o.documentoUrl, o.documento_url, o.url),
    documentoTitulo: txt(o.documentoTitulo, o.documento_titulo, o.titulo),
    enVigia: o.enVigia === true || o.en_vigia === true,
    verificada: o.verificada === true || o.verificada === false ? o.verificada : null,
  };
  return cita.pagina != null || cita.documentoUrl ? cita : null;
}

/** Una fila de `/senales` como la `Senal` que ya pintan la tabla y el panel. */
function aSenal(r: Crudo, i: number, cat: CatalogoReglas): Senal {
  const alerta = obj(r.alerta);
  const conv = obj(r.convocatoria);
  const ent = obj(r.entidad);
  const prov = obj(r.proveedor);
  const regla = txt(r.regla) ?? "sin_regla";
  const citas = (Array.isArray(r.citas) ? r.citas : []).map(citaDe).filter((c): c is CitaDocumento => !!c);
  const evidencia = txt(r.evidencia);
  const proveedor = txt(typeof r.proveedor === "string" ? r.proveedor : null, prov?.nombre, r.proveedorNombre, r.razonSocial);
  const rucProveedor = txt(r.rucProveedor, r.proveedorRuc, r.proveedor_ruc, prov?.ruc);
  const agente = txt(r.agente, r.agenteOrigen, r.agente_origen);
  const alertaCodigo = txt(r.alertaCodigo, r.alerta_codigo, typeof r.alerta === "string" ? r.alerta : null, alerta?.codigo);
  const ocid =
    txt(typeof r.convocatoria === "string" ? r.convocatoria : null, conv?.codigo, conv?.ocid, r.codigoconvocatoria, r.codigoConvocatoria, r.ocid) ?? "";
  const fuente = txt(r.fuenteUrl, r.fuente_url, r.fuente);
  return {
    id: txt(r.id) ?? `${alertaCodigo ?? ocid}-${regla}-${i}`,
    regla,
    etiqueta: etiquetaReglaConApi(regla, cat, txt(r.etiqueta, r.reglaEtiqueta)),
    queMira: descripcionRegla(regla, cat) ?? txt(r.descripcion, r.queMira),
    severidad: severidadDe(r.severidad),
    evidencia,
    norma: txt(r.norma),
    opinionOece: txt(r.opinionOece, r.opinion_oece),
    fuenteUrl: fuente && /^https?:\/\//i.test(fuente) ? fuente : null,
    agente,
    agenteLabel: agenteLabel(agente),
    verificada: cotejoDe(r),
    citas,
    ocid,
    alertaCodigo,
    objeto: txt(r.objeto, conv?.objeto, alerta?.objeto) ?? "—",
    entidad: txt(typeof r.entidad === "string" ? r.entidad : null, ent?.nombre, r.entidadNombre) ?? "—",
    rucEntidad: txt(r.rucEntidad, r.entidadRuc, r.entidad_ruc, ent?.ruc) ?? "",
    proveedor: proveedor ?? "—",
    rucProveedor,
    // Los nombres privados se calculan acá, en el servidor, y cruzan como datos planos al
    // vidrio del cliente (components/alertas/Protegido.tsx): la política no cambia.
    personasPrivadas: personasPrivadas(proveedor, rucProveedor, [evidencia, ...citas.map((c) => c.cita)]),
    montoSoles: num(r.montoSoles, r.monto_soles, r.monto, conv?.monto, alerta?.montoSoles) ?? 0,
    fechaBuenaPro: txt(r.fechaBuenaPro, r.fecha_buena_pro, r.fecha, conv?.fechaBuenaPro),
    score: num(r.score, alerta?.score) ?? 0,
    senalesDelContrato: num(r.senalesDelContrato, r.nBanderas, r.n_banderas, alerta?.nBanderas, alerta?.banderas),
    region: txt(r.region, conv?.region),
  };
}

/** Una faceta en cualquiera de sus formas: arreglo de `{valor, etiqueta, n}` o `{valor: n}`. */
function opciones(v: unknown, etiquetar: (valor: string) => string, claves: string[]): OpcionSenales[] {
  const out: OpcionSenales[] = [];
  if (Array.isArray(v)) {
    for (const x of v) {
      const o = obj(x);
      if (!o) continue;
      const crudo = claves.map((k) => o[k]).find((y) => y !== undefined);
      // El cotejo puede venir como booleano o null: se guarda como texto ("true", "null"),
      // que es lo que se devuelve en `?cotejo=`.
      const valor = crudo === null ? "null" : typeof crudo === "boolean" ? String(crudo) : txt(crudo, o.valor, o.clave, o.id);
      if (valor == null) continue;
      out.push({ valor, etiqueta: txt(o.etiqueta, o.label, o.nombre) ?? etiquetar(valor), n: num(o.n, o.count, o.total) ?? 0 });
    }
  } else if (obj(v)) {
    for (const [valor, n] of Object.entries(v as Crudo)) out.push({ valor, etiqueta: etiquetar(valor), n: num(n, obj(n)?.n) ?? 0 });
  }
  return out;
}

function facetasDe(f: unknown, cat: CatalogoReglas): FacetasApi {
  const o = obj(f) ?? {};
  const orden = (a: OpcionSenales, b: OpcionSenales) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, "es");
  const sev = opciones(o.severidad, (v) => v, ["severidad", "valor"])
    .filter((x) => SEVERIDADES.includes(x.valor as NivelBandera))
    .sort((a, b) => SEVERIDADES.indexOf(a.valor as NivelBandera) - SEVERIDADES.indexOf(b.valor as NivelBandera));
  const agente = opciones(o.agente, (v) => v, ["agente", "valor"]).map((x) =>
    // El agente que no consta llega como null/"": se ofrece como su propia opción, con su conteo.
    x.valor === "null" || x.valor === "" ? { ...x, valor: SIN_AGENTE, etiqueta: "Sin agente registrado" } : { ...x, etiqueta: agenteLabel(x.valor) ?? x.etiqueta },
  );
  const entidadLista = o.entidad ?? o.entidadesLista;
  return {
    severidad: sev,
    regla: opciones(o.regla, (v) => etiquetaReglaConApi(v, cat, null), ["regla", "valor"])
      .map((x) => ({ ...x, etiqueta: etiquetaReglaConApi(x.valor, cat, x.etiqueta) }))
      .sort(orden),
    agente: agente.sort(orden),
    cotejo: opciones(o.cotejo, etiquetaCotejo, ["cotejo", "verificada", "valor"])
      .map((x) => ({ ...x, etiqueta: etiquetaCotejo(x.valor) }))
      .sort(orden),
    entidad: Array.isArray(entidadLista) ? opciones(entidadLista, (v) => v, ["ruc", "entidad", "valor"]).sort(orden) : null,
    entidades: num(o.entidades, obj(o.entidad) ? null : typeof o.entidad === "number" ? o.entidad : null, o.totalEntidades),
    contratos: num(o.contratos, o.totalContratos, o.alertas),
  };
}

// ─── Pedido ───────────────────────────────────────────────────────────────

type Dimension = "severidad" | "regla" | "agente" | "cotejo";

/** El query string que entiende `/senales` (sin `vista` ni la pila de cursores, que son de la página). */
export function senalesApiQueryString(q: SenalesQuery, opciones: { limit?: number; sin?: Dimension | "todo"; cursor?: boolean } = {}): string {
  const p = new URLSearchParams();
  const todo = opciones.sin === "todo";
  const poner = (k: Dimension | "entidad" | "q", v: string | undefined) => {
    if (!v || todo || opciones.sin === k) return;
    p.set(k, v);
  };
  poner("severidad", q.severidad);
  poner("regla", q.regla);
  poner("agente", q.agente);
  poner("cotejo", q.cotejo);
  poner("entidad", q.entidad);
  poner("q", q.q);
  if (opciones.cursor !== false && q.cursor && !todo) p.set("cursor", q.cursor);
  p.set("limit", String(opciones.limit ?? TAM_SENALES));
  return p.toString();
}

async function pedir(qs: string): Promise<{ status: number; cuerpo: Crudo | null }> {
  try {
    const res = await fetch(`${API_BASE}/senales?${qs}`, { next: { revalidate: 120 } } as RequestInit);
    if (!res.ok) return { status: res.status, cuerpo: null };
    return { status: res.status, cuerpo: obj(await res.json()) };
  } catch {
    return { status: 0, cuerpo: null };
  }
}

/** ¿La faceta de una dimensión filtrada ofrece otras opciones con conteo? Si no, vino contada con su propio filtro. */
const esCruzada = (f: OpcionSenales[], elegido: string | undefined) => !elegido || f.some((x) => x.valor !== elegido && x.n > 0);

/**
 * Una página del índice. Las facetas de las dimensiones que están filtradas deben contarse
 * sobre los OTROS filtros (ninguna opción lleva a cero); si el API las devuelve contadas con
 * su propio filtro puesto, se pide esa faceta sin él (una llamada chica, `limit=1`, por
 * dimensión filtrada). Si el API ya las cruza, no se pide nada más.
 */
export async function getSenalesPagina(q: SenalesQuery, catalogo: CatalogoReglas | Promise<CatalogoReglas>): Promise<PaginaSenales> {
  // El pedido y el catálogo de reglas (cacheado 1 h) van en paralelo: el catálogo sólo hace
  // falta para rotular.
  const [{ status, cuerpo }, cat] = await Promise.all([pedir(senalesApiQueryString(q)), catalogo]);
  if (status === 404) return { estado: "sin-endpoint" };
  if (!cuerpo || !Array.isArray(cuerpo.data)) return { estado: "fallo" };

  const filas = (cuerpo.data as unknown[]).map(obj).filter((r): r is Crudo => !!r);
  // Nunca las alertas de demo `ALT-…` (lib/semillas.ts), por si alguna volviera a la base.
  const senales = filas.map((r, i) => aSenal(r, i, cat)).filter((s) => !esAlertaDemo({ codigo: s.alertaCodigo }));
  const facetas = facetasDe(cuerpo.facetas, cat);

  const elegidos: [Dimension, string | undefined][] = [
    ["severidad", q.severidad],
    ["regla", q.regla],
    ["agente", q.agente],
    ["cotejo", q.cotejo],
  ];
  const faltan = elegidos.filter(([d, v]) => v && !esCruzada(facetas[d], v));
  if (faltan.length) {
    const extra = await Promise.all(faltan.map(([d]) => pedir(senalesApiQueryString(q, { limit: 1, sin: d, cursor: false }))));
    faltan.forEach(([d], i) => {
      const c = extra[i].cuerpo;
      if (c) facetas[d] = facetasDe(c.facetas, cat)[d];
    });
  }

  return {
    estado: "ok",
    senales,
    siguiente: typeof cuerpo.siguiente === "string" && cuerpo.siguiente ? cuerpo.siguiente : null,
    total: num(cuerpo.total) ?? senales.length,
    facetas,
  };
}

/** Las cifras del universo sin filtrar (para las Indicadores y la pestaña), en una llamada de `limit=1`. */
export async function getSenalesUniverso(cat: CatalogoReglas): Promise<{ total: number; facetas: FacetasApi } | null> {
  const { cuerpo } = await pedir(`limit=1`);
  if (!cuerpo) return null;
  return { total: num(cuerpo.total) ?? 0, facetas: facetasDe(cuerpo.facetas, cat) };
}
