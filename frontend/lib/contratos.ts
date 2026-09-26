/**
 * Cliente y tipos de "Contratos" (todo el SEACE ingerido, contrato por contrato).
 * Backend: backend/api/src/routes/contratos.ts
 * Plan:    docs/superpowers/plans/2026-09-15-seace-escala.md · Workstream F
 *
 * Mismo contrato que lib/auditoria.ts: los GET devuelven `null` si el API no responde.
 * Funcionan en server components (fetch cacheado) y en el cliente (NEXT_PUBLIC_VIGIA_API_URL).
 */

import { API_BASE } from "./api-client";
import { fechaCorta, numero, soles } from "./formato";
import { nivelDeScore } from "./severidad";
import type { CitaDocumento, Estimado, FasesMap, Procesamiento, ResultadoAnalisis } from "./auditoria";
export type { CitaDocumento };

export type TipoContrato = "bienes" | "servicios" | "consultoria" | "obras" | "convenio" | "directa" | "otro";
export type EtapaContrato =
  | "planificacion" | "convocada" | "adjudicada" | "contratada" | "en_ejecucion"
  | "finalizada" | "desierta" | "cancelada" | "nula" | "desconocida";
/**
 * Tramos del filtro "Peso del riesgo" (DESIGN_SYSTEM.md §10.1). OJO con `bajo`: el backend
 * lo arma como score < 40 entre las alertas publicadas, así que incluye también a las de
 * score 0, que no tienen ninguna señal. Por eso su etiqueta dice "bajo o sin señales".
 */
export type RiesgoContrato = "alto" | "medio" | "bajo" | "sin_analizar";

/**
 * Los grupos del resumen. `en_revision` y `descartado` los agrega la API cuando el
 * análisis existe pero no se publicó (lo frenó la autoevaluación, o una persona lo
 * descartó): cuentan como leídos, nunca como señal.
 */
export type GrupoResumen = RiesgoContrato | "en_revision" | "descartado";
export type EstadoContrato = "sin_analizar" | "pendiente_de_procesamiento" | "esperando_documentos" | "encolado" | "procesando" | "procesado" | "error";
export type OrdenContratos = "fecha" | "monto" | "score";

export interface ContratoResumen {
  ocid: string;
  codigo: string;
  titulo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  tipo: TipoContrato | null;
  etapa: EtapaContrato | null;
  modalidad: string | null;
  montoPen: number | null;
  moneda: string | null;
  fecha: string | null;                // YYYY-MM-DD (convocatoria)
  ubigeo: string | null;
  zona: string | null;
  lat: number | null;
  lon: number | null;
  procesable: boolean | null;
  estadoProcesamiento: EstadoContrato;
  /** Migración 19: en_cola (tipo/etapa con análisis activo) · documentos_listos (docs en GCS, análisis aún no activo) · sin_documentos. */
  estadoOperativo?: EstadoOperativo | null;
  score: number | null;
  /** Señales publicadas. El API manda `null` si la alerta no está publicada (en revisión o descartada). */
  banderas: number;
  /** La alerta está en revisión humana: leído, sin score ni señales públicas (§10.4: se dice "En revisión" y nada más). */
  enRevision?: boolean;
  proveedor: string | null;
  proveedorRuc: string | null;
}

export interface ContratoItem {
  id: string;
  posicion: number;
  descripcion: string | null;
  cantidad: number | null;
  unidad: string | null;
  montoPen: number | null;
  cubso: string | null;
  estado: string | null;
}

export interface ContratoDocumento {
  tipo: string | null;                 // biddingDocuments · awardNotice · contractSigned · …
  titulo: string | null;
  url: string;
  formato: string | null;
  fecha: string | null;
  /** tender · award · contract (de qué parte del expediente sale). */
  seccion?: "tender" | "award" | "contract";
  /** Copia vigente en el almacén de Vigía (retención 90 días): se puede previsualizar con URL firmada. */
  enVigia?: boolean;
}


/** Postor leído del expediente (actas, cuadro comparativo) con su oferta. */
export interface PostorContrato {
  ruc: string | null;
  razonSocial: string | null;
  estado: string | null;            // admitido · descalificado · ganador · …
  motivoEstado: string | null;
  montoOferta: number | null;
  puntaje: number | null;
  esGanador: boolean;
  ordenPrelacion: number | null;
  item: string | null;
  citas: CitaDocumento[];
}

/** Ítem tal como lo leyeron los agentes: precio ofertado/contratado vs. referencia OCDS. */
export interface ItemAnalizado {
  numero: string;
  descripcion: string | null;
  unidad: string | null;
  cantidad: number | null;
  precioUnitarioOfertado: number | null;
  precioUnitarioContratado: number | null;
  referenciaTotal: number | null;
  referenciaUnitaria: number | null;
  marca: string | null;
  origenPrecio: string | null;
  citas: CitaDocumento[];
}

export interface BanderaResumen {
  regla: string;
  severidad: "alta" | "media" | "baja";
  evidencia: string | null;
  norma: string | null;
}

export interface Clasificacion {
  tipo: TipoContrato | null;
  etapa: EtapaContrato | null;
  modalidad: string | null;
  procesable: boolean | null;
  motivoNoProcesable: string | null;
  agentesAplicables: string[] | null;
  validacionesPendientes: string[] | null;
  clasificadoAt: string | null;
}

export interface ContratoDetalle extends ContratoResumen {
  fechaBuenaPro: string | null;
  tipoProceso: string | null;
  fuenteFinanciamiento: string | null;
  nomenclatura: string | null;
  descripcion: string | null;
  postores: number | null;
  items: ContratoItem[];
  documentos: ContratoDocumento[];
  adjudicaciones: { id: string | null; fecha: string | null; montoPen: number | null; proveedor: string | null; proveedorRuc: string | null }[];
  /** Misma forma que `resultado` en auditoría (señales, mercado, documentos leídos); `estado` = 'revision' si la autoevaluación la bloqueó.
   *  Cada bandera trae `citas` (página del PDF citada) cuando el análisis legal la respalda. */
  alerta: (ResultadoAnalisis & { id: string }) | null;
  /** U5: postores con ofertas e ítems con precio contratado, leídos del expediente por los agentes. */
  postoresDetalle?: PostorContrato[];
  itemsAnalizados?: ItemAnalizado[];
  procesamiento: Procesamiento | null;
  clasificacion: Clasificacion;
  /** Documentos vigentes en el almacén de Vigía (retención 90 días). null si la migración 15 no está. */
  documentosEnVigia: { n: number; expiraAt: string | null } | null;
  /** Pedido de descarga abierto (el batch nocturno lo atiende). */
  pedidoDescarga: { estado: "pendiente" | "descargando"; solicitadoAt: string } | null;
}

export interface ContratoZona {
  ubigeo: string;
  nombre: string;
  nivel: "departamento" | "provincia" | "distrito";
  lat: number;
  lon: number;
  total: number;
  sinAnalizar: number;
  pendientes: number;
  enProceso: number;
  procesados: number;
  /**
   * OJO: publicados con score ≥ 40 (peso del riesgo medio o alto), NO "con señales"
   * (§10.1: con señales = al menos una señal publicada, de cualquier peso). En pantalla
   * se rotula "de riesgo medio o alto".
   */
  conSenales: number;
  /** Estado operativo (migración 19) sobre lo aún sin analizar: financiable hoy vs. documentos listos (análisis en preparación). */
  enCola: number;
  documentosListos: number;
  /** Procesados cuya alerta quedó en revisión humana (no publicada). */
  enRevision: number;
  montoPen: number;
}

export interface ContratosPagina {
  data: ContratoResumen[];
  total: number;
  page: number;
  size: number;
  /**
   * Paginación por cursor (keyset): el token opaco para pedir la página siguiente
   * (`?cursor=`) y la anterior (`?antes=`); `null` en el borde de la lista.
   * COMPAT-API-VIEJA: la API de prod todavía no los manda. Sin la clave `siguiente` en la
   * respuesta, la lista pagina como antes, por número de página (`?page=`).
   */
  siguiente?: string | null;
  anterior?: string | null;
  /**
   * `false` = el total es un conteo acotado (la API deja de contar en 10.001): se muestra
   * "10,000+". Sin la clave (API vieja) el total es exacto.
   */
  totalExacto?: boolean;
}

/**
 * Hasta dónde cuenta la API cuando el total no sale del agregado (`totalExacto: false`):
 * el conteo se corta en TOPE + 1. Un total por encima del tope se dice "10,000+"; uno por
 * debajo es exacto aunque venga del conteo acotado (no llegó al corte).
 */
export const TOPE_CONTEO_CONTRATOS = 10_000;

/** "18,393" o "10,000+" (conteo acotado que llegó al tope). Nunca un total que la API no dio. */
export function totalContratosTexto(p: Pick<ContratosPagina, "total" | "totalExacto">): string {
  if (p.totalExacto === false && p.total > TOPE_CONTEO_CONTRATOS) return `${numero(TOPE_CONTEO_CONTRATOS)}+`;
  return numero(p.total);
}

/** Los tokens de cursor son base64url opacos: sólo se valida la forma, nunca se decodifican. */
const CURSOR_RX = /^[A-Za-z0-9_-]{1,512}={0,2}$/;

export type EstadoOperativo = "en_cola" | "documentos_listos" | "sin_documentos";
export const OPERATIVOS: { value: EstadoOperativo; label: string }[] = [
  { value: "en_cola", label: "En cola (análisis activo)" },
  { value: "documentos_listos", label: "Documentos listos, análisis en preparación" },
  { value: "sin_documentos", label: "Sin documentos aún" },
];

export interface ContratosQuery {
  page?: number;
  size?: number;
  /** Token opaco de la página siguiente (paginación por cursor). Excluye a `antes` y a `page`. */
  cursor?: string;
  /** Token opaco para volver a la página anterior. */
  antes?: string;
  q?: string;
  tipo?: TipoContrato | "";
  etapa?: EtapaContrato | "";
  ubigeo?: string;
  entidad?: string;
  monto_min?: number | string;
  monto_max?: number | string;
  /** YYYY-MM-DD, sobre fecha_convocatoria. */
  desde?: string;
  hasta?: string;
  /** Los cuatro tramos, o `en_revision` (el API lo acepta: leídos frenados para revisión humana). */
  riesgo?: RiesgoContrato | "en_revision" | "";
  estado?: EstadoContrato | "";
  operativo?: EstadoOperativo | "";
  orden?: OrdenContratos | "";
}

export const TIPOS: { value: TipoContrato; label: string }[] = [
  { value: "bienes", label: "Bienes" },
  { value: "servicios", label: "Servicios" },
  { value: "consultoria", label: "Consultoría" },
  { value: "obras", label: "Obras" },
  { value: "convenio", label: "Convenio" },
  { value: "directa", label: "Contratación directa" },
  { value: "otro", label: "Otro" },
];

export const ETAPAS: { value: EtapaContrato; label: string }[] = [
  { value: "planificacion", label: "Planificación" },
  { value: "convocada", label: "Convocada" },
  { value: "adjudicada", label: "Adjudicada" },
  { value: "contratada", label: "Contratada" },
  { value: "en_ejecucion", label: "En ejecución" },
  { value: "finalizada", label: "Finalizada" },
  { value: "desierta", label: "Desierta" },
  { value: "cancelada", label: "Cancelada" },
  { value: "nula", label: "Nula" },
  { value: "desconocida", label: "Desconocida" },
];

/**
 * Filtro por peso del riesgo (el tramo del score). "Riesgo", no "Señal": "Señal alta" es la
 * severidad de UNA señal, y un contrato de riesgo bajo puede traer una señal alta.
 */
export const RIESGOS: { value: RiesgoContrato; label: string }[] = [
  { value: "alto", label: "Riesgo alto (70 o más)" },
  { value: "medio", label: "Riesgo medio (40 a 69)" },
  { value: "bajo", label: "Riesgo bajo o sin señales (menos de 40)" },
  { value: "sin_analizar", label: "Sin leer" },
];

export const ORDENES: { value: OrdenContratos; label: string }[] = [
  { value: "fecha", label: "Más recientes" },
  { value: "monto", label: "Mayor monto" },
  { value: "score", label: "Mayor peso del riesgo" },
];

export const tipoLabel = (t: string | null | undefined) => TIPOS.find((x) => x.value === t)?.label ?? null;
export const etapaLabel = (e: string | null | undefined) => ETAPAS.find((x) => x.value === e)?.label ?? null;
export const riesgoLabel = (r: string | null | undefined) => RIESGOS.find((x) => x.value === r)?.label ?? null;
export const operativoLabel = (o: string | null | undefined) => OPERATIVOS.find((x) => x.value === o)?.label ?? null;

/** Estados que lib/auditoria no conoce (el resto usa `EstadoPill`). */
export const ESTADO_CONTRATO_EXTRA: Record<"sin_analizar" | "pendiente_de_procesamiento", { label: string; cls: string }> = {
  sin_analizar: { label: "Sin leer", cls: "bg-paperDeep text-mute" },
  // `text-clay` daba 4.20:1 sobre papel (bajo el piso de 4.5): el texto va en clayTexto.
  pendiente_de_procesamiento: { label: "No procesable todavía", cls: "bg-amber-soft/60 text-clayTexto" },
};

// Los cortes viven en lib/severidad.ts, que es la fuente única. Acá sólo se
// traduce al vocabulario local ("alto"/"medio") para no romper los call sites
// existentes. Nadie más debe volver a escribir un 70 ni un 40 a mano.
export function riesgoDe(score: number | null | undefined): RiesgoContrato {
  const n = nivelDeScore(score);
  return n === "alta" ? "alto" : n === "media" ? "medio" : n === "baja" ? "bajo" : "sin_analizar";
}

/** Texto por tramo. `bajo` es neutro, nunca el verde de lo positivo: puede traer señales. */
export const RIESGO_CLS: Record<RiesgoContrato, string> = {
  alto: "text-rust",
  medio: "text-amberTexto",
  bajo: "text-inkSoft",
  sin_analizar: "text-mute",
};

/** RUC que empieza en 10 = persona natural con negocio (contiene el DNI): se redacta. */
export const esPersonaNatural = (ruc: string | null | undefined) => !!ruc && /^10\d{9}$/.test(ruc);

/**
 * "CARPIO COBOS ABEL" (orden SUNAT, apellidos primero) → "ABEL CARPIO COBOS" (orden
 * hablado, como lo escriben las actas). Con tres palabras o más; si no, null.
 */
export function ordenHablado(sunat: string): string | null {
  const p = sunat.trim().split(/\s+/);
  if (p.length < 3) return null;
  return [...p.slice(2), ...p.slice(0, 2)].join(" ");
}

/**
 * En qué orden viene el nombre de un postor persona natural, para tapar su apellido
 * y no su nombre de pila. El proveedor del OCDS viene en orden SUNAT; las actas lo
 * escriben en orden hablado ("ABEL CARPIO COBOS"). Si el nombre coincide con la forma
 * hablada del proveedor adjudicado, se tapa la última palabra (el mismo apellido
 * materno); si no se sabe, se asume el orden del RNP (SUNAT).
 */
export function ordenNombrePostor(
  nombre: string,
  ruc: string | null | undefined,
  proveedor: string | null | undefined,
  proveedorRuc: string | null | undefined,
): "sunat" | "nombres-primero" {
  if (ruc && proveedor && ruc === proveedorRuc) {
    const hablado = ordenHablado(proveedor.toUpperCase());
    if (hablado && nombre.trim().toUpperCase().replace(/\s+/g, " ") === hablado) return "nombres-primero";
  }
  return "sunat";
}

/**
 * Personas naturales de un contrato (proveedor y postores con RUC 10), en las dos
 * formas en que aparecen en el texto libre de la evidencia. Se usa para taparles un
 * apellido también dentro de la prosa, no solo en las tarjetas.
 */
export function personasNaturalesDe(c: Pick<ContratoDetalle, "proveedor" | "proveedorRuc" | "postoresDetalle">): { nombre: string; orden: "sunat" | "nombres-primero" }[] {
  const out: { nombre: string; orden: "sunat" | "nombres-primero" }[] = [];
  const agregar = (nombre: string | null | undefined, ruc: string | null | undefined) => {
    if (!nombre || !esPersonaNatural(ruc)) return;
    const orden = ordenNombrePostor(nombre, ruc, c.proveedor, c.proveedorRuc);
    out.push({ nombre, orden });
    if (orden === "sunat") {
      const hablado = ordenHablado(nombre);
      if (hablado) out.push({ nombre: hablado, orden: "nombres-primero" });
    }
  };
  agregar(c.proveedor, c.proveedorRuc);
  for (const p of c.postoresDetalle ?? []) agregar(p.razonSocial, p.ruc);
  const vistos = new Set<string>();
  return out.filter((p) => {
    const k = p.nombre.toLowerCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

const PALABRA_CON_TILDE: Record<string, string> = {
  retrotraido: "retrotraído",
  resolucion: "resolución",
  adjudicacion: "adjudicación",
  suspension: "suspensión",
  evaluacion: "evaluación",
  descalificacion: "descalificación",
  admision: "admisión",
  calificacion: "calificación",
  ejecucion: "ejecución",
  cancelacion: "cancelación",
  valido: "válido",
  valida: "válida",
  unico: "único",
  unica: "única",
};

/**
 * Un código crudo del backend o del OCDS ("RETROTRAIDO_POR_RESOLUCION", "admitido",
 * "CONTRATADO") como texto para leer: minúsculas, sin guiones bajos, con tildes en
 * las palabras conocidas y la primera en mayúscula. No le inventa significado.
 */
export function humanizarCodigo(s: string | null | undefined): string | null {
  if (!s) return null;
  const palabras = s
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => PALABRA_CON_TILDE[w] ?? w);
  const t = palabras.join(" ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

/**
 * Formato de un documento, venga como extensión ("pdf") o como tipo MIME en
 * cualquier caja ("APPLICATION/PDF"). Antes se comparaba `formato === "pdf"` y un
 * PDF publicado como "APPLICATION/PDF" salía como "Bajar" en vez de "Ver".
 */
export function formatoDoc(f: string | null | undefined): string | null {
  if (!f) return null;
  const v = f.trim().toLowerCase().replace(/^application\//, "").replace(/^x-/, "");
  if (v.includes("pdf")) return "pdf";
  if (v.includes("wordprocessingml") || v === "docx") return "docx";
  if (v === "msword" || v === "doc") return "doc";
  if (v.includes("spreadsheetml") || v === "xlsx") return "xlsx";
  if (v.includes("zip")) return "zip";
  if (v.includes("rar")) return "rar";
  return v || null;
}

export const esPdf = (f: string | null | undefined) => formatoDoc(f) === "pdf";

export function contratosQueryString(q: ContratosQuery = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "" || (k === "page" && Number(v) <= 1)) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

/** Riesgos que acepta la URL: los cuatro tramos y "en revisión". */
const RIESGOS_URL: string[] = [...RIESGOS.map((r) => r.value), "en_revision"];

/** "2026-08" → primer y último día de ese mes (el API filtra por [desde, hasta]). */
export function rangoDeMes(mes: string): { desde: string; hasta: string } | null {
  const m = mes.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return null;
  const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Lo inverso: "2026-08" si [desde, hasta] es exactamente un mes calendario; si no, null. */
export function mesDeRango(desde: string | undefined, hasta: string | undefined): string | null {
  if (!desde || !hasta) return null;
  const r = rangoDeMes(desde.slice(0, 7));
  return r && r.desde === desde && r.hasta === hasta ? desde.slice(0, 7) : null;
}

/**
 * Lee `searchParams` de Next (strings sueltos) y deja solo lo válido. `mes=AAAA-MM` (el
 * filtro "Mes de convocatoria" de la lista) se traduce a `desde`/`hasta` para el API.
 */
export function parseContratosQuery(sp: Record<string, string | string[] | undefined> = {}): ContratosQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // `?pagina=` es el nombre del parámetro en los demás listados: un enlace escrito así también abre su página.
  const page = Math.max(1, Number(s("page") ?? s("pagina") ?? 1) || 1);
  // Cursor o "antes", nunca los dos: con ambos manda el cursor (ir hacia adelante).
  const token = (k: string) => { const v = s(k); return v && CURSOR_RX.test(v) ? v : undefined; };
  const cursor = token("cursor");
  const antes = cursor ? undefined : token("antes");
  const num = (k: string) => { const v = s(k); return v && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined; };
  const ubigeo = s("ubigeo");
  const entidad = s("entidad");
  const fecha = (k: string) => { const v = s(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined; };
  const mes = rangoDeMes(s("mes") ?? "");
  return {
    // Con cursor, la página por número no aplica (el API usaría el cursor igual, pero la URL queda limpia).
    page: cursor || antes ? undefined : page,
    cursor,
    antes,
    q: s("q")?.slice(0, 120) || undefined,
    tipo: TIPOS.some((t) => t.value === s("tipo")) ? (s("tipo") as TipoContrato) : undefined,
    etapa: ETAPAS.some((t) => t.value === s("etapa")) ? (s("etapa") as EtapaContrato) : undefined,
    ubigeo: ubigeo && /^\d{2}(\d{2}(\d{2})?)?$/.test(ubigeo) ? ubigeo : undefined,
    entidad: entidad && /^\d{11}$/.test(entidad) ? entidad : undefined,
    monto_min: num("monto_min"),
    monto_max: num("monto_max"),
    desde: mes?.desde ?? fecha("desde"),
    hasta: mes?.hasta ?? fecha("hasta"),
    riesgo: RIESGOS_URL.includes(s("riesgo") ?? "") ? (s("riesgo") as ContratosQuery["riesgo"]) : undefined,
    operativo: OPERATIVOS.some((t) => t.value === s("operativo")) ? (s("operativo") as EstadoOperativo) : undefined,
    orden: ORDENES.some((t) => t.value === s("orden")) ? (s("orden") as OrdenContratos) : undefined,
  };
}

/**
 * Los parámetros de la URL de /app/contratos como datos planos (strings), para el `Listado`
 * del kit: sin página (la borra cada filtro) y con `mes` en vez de `desde`/`hasta` cuando el
 * rango es un mes entero, que es como lo escribe el filtro.
 */
export function contratosParametros(q: ContratosQuery): Record<string, string | undefined> {
  const mes = mesDeRango(q.desde, q.hasta);
  const txt = (v: string | number | undefined) => (v == null || v === "" ? undefined : String(v));
  return {
    q: txt(q.q),
    riesgo: txt(q.riesgo),
    operativo: txt(q.operativo),
    tipo: txt(q.tipo),
    etapa: txt(q.etapa),
    ubigeo: txt(q.ubigeo),
    entidad: txt(q.entidad),
    mes: mes ?? undefined,
    desde: mes ? undefined : txt(q.desde),
    hasta: mes ? undefined : txt(q.hasta),
    monto_min: txt(q.monto_min),
    monto_max: txt(q.monto_max),
    orden: q.orden && q.orden !== "fecha" ? q.orden : undefined,
  };
}

async function getJson<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } } as any);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const getContratos = (q: ContratosQuery = {}) =>
  getJson<ContratosPagina>(`/contratos?${contratosQueryString(q)}`, 60);

/** Conteos por tipo/operativo/riesgo para los filtros rápidos (chips con número): cada faceta
 *  respeta los demás filtros activos pero no el propio (para poder mostrar las otras opciones). */
export interface ResumenContratos {
  total: number;
  porTipo: Partial<Record<TipoContrato | "sin_clasificar", number>>;
  porOperativo: Partial<Record<EstadoOperativo, number>>;
  porRiesgo: Partial<Record<GrupoResumen, number>>;
}
export const getResumenContratos = (q: ContratosQuery = {}) =>
  getJson<ResumenContratos>(
    `/contratos/resumen?${contratosQueryString({ ...q, page: undefined, size: undefined, orden: undefined, cursor: undefined, antes: undefined })}`,
    60,
  );

export const getContrato = (ocid: string) =>
  getJson<ContratoDetalle>(`/contratos/${encodeURIComponent(ocid)}`, 60);

/**
 * Lo que alguien pega en /app/contratos/[x]: el OCID (2026-425-9, 1225392), el OCID
 * largo (ocds-dgv273-seacev3-1235259) o el código SEACE (1235259). `GET /contratos/:id`
 * solo resuelve el OCID; si no lo encuentra y lo pegado termina en un código numérico,
 * se busca ese código y, si hay una fila con ese código EXACTO, se devuelve su OCID para
 * redirigir. Nunca se elige "el más parecido": sin coincidencia exacta, no hay contrato.
 */
export async function resolverContrato(param: string): Promise<{ contrato: ContratoDetalle | null; redirigirA: string | null }> {
  const directo = await getContrato(param);
  if (directo) return { contrato: directo, redirigirA: null };
  const codigo = param.match(/(?:^|-)(\d{5,})$/)?.[1];
  if (!codigo) return { contrato: null, redirigirA: null };
  const busqueda = await getJson<ContratosPagina>(`/contratos?${contratosQueryString({ q: codigo, size: 10 })}`, 300);
  const fila = busqueda?.data.find((r) => r.codigo === codigo);
  if (!fila || fila.ocid === param) return { contrato: null, redirigirA: null };
  return { contrato: null, redirigirA: fila.ocid };
}

export const getContratosGeo = (q: Pick<ContratosQuery, "tipo" | "etapa" | "riesgo" | "ubigeo" | "entidad" | "q" | "desde" | "hasta"> & { nivel?: "distrito" | "provincia" | "departamento" } = {}) =>
  getJson<{ nivel: string; data: ContratoZona[] }>(`/contratos/geo?${contratosQueryString(q as ContratosQuery)}`, 300).then((r) => r?.data ?? null);

// ─── Resumen de procesamiento enriquecido (PanelProcesamiento) ───────────────

export interface ProcesamientoActivo {
  ocid: string;
  faseActual: string | null;
  faseIndex: number | null;
  financiador: string;
  zona: string | null;
  titulo: string | null;
  desdeSeg: number;
  fases?: FasesMap | null;
}

export interface LoteIngesta {
  id: string;
  tipo: string | null;
  estado: string | null;
  total: number | null;
  completados: number | null;
  fallidos: number | null;
  iniciado: string | null;
}

export interface ResumenProcesamientoVivo {
  porEstado: Record<string, number>;
  procesadosHoy: number;
  activos: ProcesamientoActivo[];
  lote: LoteIngesta | null;
  descargados24h: number;
  /** Documentos del SEACE bajados por el lote nocturno en los últimos 7 días (no son contratos nuevos). */
  documentosDescargados7d?: { n: number; contratos: number } | null;
  /** Procesados con alerta bloqueada por la autoevaluación (revisión humana). */
  enRevision?: number;
  /** Migración 19: qué se analiza hoy y cuántos contratos tienen documentos listos. */
  procesamientoActivo: { tipos_activos: string[]; etapas_activas: string[]; nota?: string } | null;
  documentosListos: { n: number; contratos: number } | null;
  /** Pedidos de descarga (migración 15); null si la tabla no existe. */
  pedidos: { pendientes: number; descargando: number; listos24h: number; fallidos: number } | null;
  agentesActivos: string[];
  /** Mediana de duración de los procesados en 7 días (para el "≈ N min"). */
  estimado?: Estimado | null;
  /**
   * Cambia cuando cambia cualquier campo público de cualquier procesamiento (estado, fase,
   * fases, finalizado…). Con ella el tablero pide la lista sólo cuando algo se movió.
   * COMPAT-API-VIEJA: la API de prod todavía no la manda; sin ella se sondea la lista como antes.
   */
  version?: string;
  /**
   * Contratos activos (todo lo que no terminó bien, en análisis incluido) y en análisis, por
   * departamento (ubigeo de 2 dígitos). Lo usa el mapa para marcar dónde se lee ahora.
   * COMPAT-API-VIEJA: la API de prod todavía no lo manda; sin él se cuenta sobre la lista.
   */
  porDepartamento?: Record<string, { activos: number; procesando: number }>;
}

export const getResumenVivo = () =>
  getJson<ResumenProcesamientoVivo>(`/financiamiento/procesamientos/resumen`, 5);

// ─── Presentación ────────────────────────────────────────────────────────────

/**
 * Monto completo para tablas y fichas (DESIGN_SYSTEM.md §10.3: en tabla, sin compactar).
 * Antes compactaba desde el millón ("S/ 1.3 M") en la misma columna que "S/ 262,389": dos
 * formatos en una columna. Ahora delega en `lib/formato`. 0 o nulo = "Sin dato": el OCDS
 * publica 0 cuando no hay valor referencial, y un "S/ 0" sería un cero inventado.
 */
export const formatMonto = (n: number | null | undefined, moneda: string | null = "PEN") => {
  if (n == null || n === 0) return "Sin dato";
  const texto = soles(n);
  return moneda && moneda !== "PEN" ? texto.replace(/^S\/ /, `${moneda} `) : texto;
};

/** Fecha de tabla: "24 set." (o "24 set. 2025" si no es del año en curso). Delegado en `lib/formato`. */
export const formatFecha = (iso: string | null | undefined) => fechaCorta(iso ? iso.slice(0, 10) : null);

const TIPO_DOC: Record<string, string> = {
  biddingDocuments: "Bases",
  awardNotice: "Buena pro",
  contractSigned: "Contrato",
  evaluationReports: "Evaluación",
  clarifications: "Absolución de consultas",
  tenderNotice: "Convocatoria",
  contractArrangements: "Contrato",
};
export const tipoDocLabel = (t: string | null | undefined) => (t ? TIPO_DOC[t] ?? t.replace(/([a-z])([A-Z])/g, "$1 $2") : "Documento");

const VALIDACION: Record<string, string> = {
  infobras_avance: "Avance físico de obra (INFOBRAS) no disponible",
  market: "Sin ítems comparables para precios de mercado",
  document_parser: "Sin documentos descargables del expediente",
  person_network: "Sin RUC de proveedor para la red de personas",
  web_research: "Sin RUC de proveedor para la investigación web",
  news_research: "Sin RUC de proveedor para la búsqueda en prensa",
  entity_personnel: "Sin RUC de entidad para funcionarios",
  compliance_extended: "Sin proveedor para cumplimiento extendido",
};
export const validacionLabel = (v: string) => VALIDACION[v] ?? v.replace(/_/g, " ");

const MOTIVO: Record<string, string> = {
  tipo_no_soportado: "Tipo de contratación aún no soportado por los agentes",
  etapa_desconocida: "No se pudo determinar la etapa del proceso",
  sin_postores: "Todavía no hay postores ni bases publicadas",
  planificacion: "El proceso está en planificación: no hay bases ni postores",
};
export const motivoLabel = (m: string | null | undefined) => (m ? MOTIVO[m] ?? m.replace(/_/g, " ") : "Pendiente de procesamiento");
