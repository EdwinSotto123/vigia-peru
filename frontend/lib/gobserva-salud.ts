import { API_BASE } from "@/lib/api-client";
import { tildesEnTitulo } from "@/lib/tildes";
import type { FormaGrupo } from "@/lib/salud-formas";

/**
 * Gobserva Salud (salud.gobserva.cloud, 2026-11-20): los datos de la API /salud (backend/api/src/routes/gobservaSalud.ts)
 * y las palabras con que se muestran. Sin JSX: lo usan páginas del servidor y componentes de cliente.
 *
 * Reglas que la web no rompe (las mismas del asistente y del MCP):
 *   · Cada dato con su fuente y su fecha. Lo que una fuente no trae no se afirma: «no figura en … al <fecha>».
 *   · Cuatro clases de hecho con su rótulo y color propios, nunca mezclados: sanción firme, denuncia, reclamo y registro
 *     administrativo (lo que la IPRESS declaró en RENIPRESS).
 *   · La sanción de una IPRESS no es de quien la dirige. De los profesionales, sólo colegio, colegiatura y RNE.
 */

// ─── Tipos (la forma de las respuestas de la API) ──────────────────────────────────────────────────

export type Sector = "publico" | "privado" | "otro";
export type EstadoChequeo = "ok" | "atencion" | "alerta" | "sin_dato" | "externo";
export type TipoHecho = "registro_administrativo" | "sancion_firme" | "denuncia" | "verificacion_externa";

/** Una IPRESS en una lista, en la búsqueda o en el mapa. */
export interface FilaIpress {
  codigo: string;
  nombre: string;
  categoria: string | null;
  sector: Sector;
  institucion: string | null;
  clasificacion: string | null;
  tipo: string | null;
  estado: string | null;
  activo: boolean;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  direccion: string | null;
  lat: number | null;
  lon: number | null;
  telefono: string | null;
  horario: string | null;
  sanciones: number;
  ultimaSancion: string | null;
  cierreDefinitivo: boolean;
  /** Denuncias ante SUSALUD en `denunciasDe` (el último año publicado). */
  denuncias: number | null;
  denunciasDe: number | null;
  cirugias12m: number | null;
  /** Tiene la UPSS de centro quirúrgico activa según el detalle; null si aún no se leyó el detalle. */
  quirurgico: boolean | null;
  internamiento: boolean;
  conDetalle: boolean;
  ruc: string | null;
  razonSocial: string | null;
  medicos: number | null;
  camas: number | null;
}

export interface Chequeo {
  clave: "registro" | "categoria" | "quirurgico" | "licencia" | "sanciones" | "denuncias" | "responsable" | string;
  titulo: string;
  estado: EstadoChequeo;
  /** La frase que se puede afirmar, con su fuente dentro. */
  detalle: string;
  tipo: TipoHecho;
  fuente: string;
  url: string | null;
  /** AAAA-MM-DD. */
  al: string | null;
}

export interface Servicio { codigo: string | null; nombre: string | null; estado?: string | null }
export interface DocumentoDeclarado { tipo: string | null; numero: string | null; fecha: string | null; adjunto: boolean; id: string | null }

export interface DetalleIpress {
  ruc: string | null;
  razonSocial: string | null;
  propietarioNatural: boolean | null;
  categoria: string | null;
  categoriaDocumento: string | null;
  categoriaFecha: string | null;
  resolucionCreacion: string | null;
  fechaRegistro: string | null;
  ambientes: number | null;
  camas: number | null;
  telefonoEmergencia: string | null;
  upss: Servicio[];
  ups: Servicio[];
  upssSuspendidas: Servicio[];
  especialidades: Servicio[];
  cartera: Servicio[];
  documentos: DocumentoDeclarado[];
  consultores: Servicio[];
  responsableColegio: string | null;
  colegio: string | null;
  responsableColegiatura: string | null;
  responsableRne: string | null;
  situacionEstado: string | null;
  situacionCondicion: string | null;
  historial: Record<string, string | null>[];
  /** null: todavía no se leyó (o la última lectura falló: `error`). */
  leidoAl: string | null;
  error: string | null;
}

export interface Sancion {
  id: string;
  /** Como lo registró SUSALUD (razón social o nombre comercial). */
  nombre: string;
  /** codigo | codigo_otro_nombre (SUSALUD la registró con este código a otro nombre) | nombre | null. */
  enlace: string | null;
  pas: string | null;
  resolucion: string | null;
  fechaEmision: string | null;
  fechaNotificacion: string | null;
  fechaInscripcion: string | null;
  tipoSancion: "amonestacion" | "multa" | "cierre_definitivo" | "cierre_temporal" | "revocacion" | "otra";
  tipoSancionTexto: string | null;
  multaUit: number | null;
  medidasCorrectivas: string | null;
  judicializacion: string | null;
  judicializada: boolean;
  cancelacion: string | null;
  infraccionCodigo: string | null;
  gravedad: "leve" | "grave" | "muy_grave" | null;
  infraccion: string | null;
  normas: string | null;
  /** La infracción explicada con las palabras del Reglamento (catálogo RIS de SUSALUD). */
  infraccionDetalle: string | null;
  fuenteUrl: string | null;
  vistoAl: string | null;
}

export interface FichaIpress extends Omit<FilaIpress, "sanciones"> {
  ubigeo: string | null;
  disa: string | null;
  red: string | null;
  microred: string | null;
  unidadEjecutora: string | null;
  imagenes: string[] | null;
  inicioActividad: string | null;
  enRegistro: boolean;
  vistoAl: string | null;
  primeraVez: string | null;
  fuenteArchivo: string | null;
  multasUit: number | null;
  sancionesJudicializadas: number;
  consultas: number | null;
  cirugiasHasta: string | null;
  recursosAl: string | null;
  categoriaInfo: { nivel: string; nombre: string; detalle: string } | null;
  detalle: DetalleIpress | null;
  verificacion: Chequeo[];
  registroSanciones: Sancion[];
  denunciasPorAnio: { anio: number; consultas: number; denuncias: number; deOficio: number }[];
  recursos: Record<string, number | null> | null;
  cirugiasPorMes: { anio: number; mes: number; mayores: number | null; menores: number | null; suspendidas: number | null; programadas: number | null; emergencia: number | null }[];
  cambios: { campo: string; antes: string | null; despues: string | null; fecha: string; fuente: string }[];
  mismaEmpresa: { codigo: string; nombre: string; categoria: string | null; estado: string | null; activo: boolean; distrito: string | null; departamento: string | null }[];
  vigia: {
    ruc: string;
    sunat: { estado: string | null; condicion: string | null } | null;
    empresa: { nombre: string; estadoSunat: string | null; procesos: number | null; monto: number | null; ordenes: number | null; ordenesMonto: number | null; entidades: number | null; inhabilitada: string | null; inhabilitadaHasta: string | null; url: string } | null;
    entidad: { nombre: string; url: string } | null;
    informesControl: { total: number; ultimo: string | null; url: string } | null;
  } | null;
  fuentes: Record<"renipress" | "detalle" | "sanciones" | "denuncias" | "recursos" | "cirugias", { url: string; al: string | number | null; archivo?: string | null } | null>;
  aviso: string;
}

export interface Facetas {
  departamento: { clave: string; n: number }[];
  provincia: { clave: string; n: number }[];
  categoria: { clave: string; n: number }[];
  sector: { clave: string; n: number }[];
  tipo: { clave: string; n: number }[];
  /** Por institución: sis (MINSA y gobiernos regionales), essalud, sanidad, privado, otro. */
  seguro?: { clave: string; n: number }[];
  /** Cuántos declararon atender las 24 horas. */
  h24?: number;
}

export interface PaginaIpress {
  filas: FilaIpress[];
  total: number;
  conSanciones: number;
  pagina: number;
  tamano: number;
  facetas: Facetas;
}

export interface EstadoFuentes {
  renipressAl: string | null;
  sancionesAl: string | null;
  recursosAl: string | null;
  cirugiasAl: string | null;
  denunciasAl: number | null;
  /** Medicamentos (DIGEMID): el mes del Indicador de precios y el día de la última lectura de alertas. */
  preciosAl?: string | null;
  alertasAl?: string | null;
  detalle: { leidas: number; total: number; ultimaLectura: string | null };
  cargas: Record<string, { clave: string; archivo: string | null; url: string | null; cargadoAl: string | null; filas: number | null; sha256: string | null }>;
}

export interface ResumenSalud {
  ipress: number;
  activas: number;
  publicas: number;
  privadas: number;
  conInternamiento: number;
  inactivas: number;
  conSanciones: number;
  conUbicacion: number;
  conDetalle: number;
  sanciones: number;
  multas: number;
  multasUit: number;
  sancionesUltimoAnio: number;
  denunciasAnio: number | null;
  denuncias: number;
  porDepartamento: { clave: string; activas: number; privadas: number; conSanciones: number; sanciones: number }[];
  fuentes: EstadoFuentes;
  categorias: Record<string, { nivel: string; nombre: string; detalle: string }>;
}

export interface PasoVerificar { paso: string; detalle: string; url: string }

export interface ResultadoBusqueda {
  q: string;
  establecimientos: FilaIpress[];
  colegiatura: { numero: string; responsableDe: (FilaIpress & { colegio: string; responsableRne: string | null; leidoAl: string | null })[]; verificar: PasoVerificar[] } | null;
  sancionesSinEstablecimiento: { id: string; nombre: string; administradaTipo: string | null; tipoSancion: string; fechaEmision: string | null; ipressCodigo: string | null }[];
  nota: string | null;
  urlCmp: string;
}

export interface Medico {
  colegiatura: string;
  colegio: string | null;
  rne: string[];
  responsableDe: (FilaIpress & { colegio: string; responsableRne: string | null; leidoAl: string | null })[];
  cobertura: { leidas: number; total: number; al: string | null };
  resumen: string;
  habilitacion: { estado: "verificar_en_cmp"; detalle: string; url: string };
  verificar: PasoVerificar[];
  fuentes: { nombre: string; url: string; al: string | null }[];
  aviso: string;
}

export interface FilaSancion {
  id: string;
  nombre: string;
  administradaTipo: "IPRESS" | "IAFAS" | "UGIPRESS" | null;
  naturaleza: string | null;
  institucion: string | null;
  ipressCodigo: string | null;
  enlace: string | null;
  ipressNombre: string | null;
  pas: string | null;
  resolucion: string | null;
  fechaEmision: string | null;
  tipoSancion: Sancion["tipoSancion"];
  multaUit: number | null;
  gravedad: Sancion["gravedad"];
  infraccionCodigo: string | null;
  infraccion: string | null;
  judicializada: boolean;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
}

export interface PaginaSanciones {
  filas: FilaSancion[];
  n: number;
  uit: number;
  multas: number;
  amonestaciones: number;
  cierres: number;
  judicializadas: number;
  porAnio: { anio: number; n: number }[];
  pagina: number;
  tamano: number;
  fuente: { url: string; al: string | null };
}

export interface FuenteSalud {
  clave: string;
  nombre: string;
  entidad: string;
  tipo: TipoHecho;
  que: string;
  ojo: string;
  url: string;
  consulta: string;
  frecuencia: string;
}

export interface Mapa {
  /** [codigo, lat, lon, categoria, sector (p|v|o), activo (1|0), sanciones, quirurgico (1|0|null)] */
  puntos: [string, number, number, string | null, "p" | "v" | "o", 0 | 1, number, 0 | 1 | null][];
  total: number;
  sinUbicacion: number;
}

export interface Cambio { codigo: string; nombre: string; departamento: string | null; distrito: string | null; categoria: string | null; campo: string; antes: string | null; despues: string | null; fuente: string; fecha: string }

export interface NormaSalud { slug: string; documento: string; numero: string | null; tipo: string; fechaEmision: string | null; articulo: string | null; epigrafe: string | null; texto: string; url: string | null; puntaje: number }

// ─── Lecturas (servidor: con revalidación; cliente: tal cual) ─────────────────────────────────────

async function pedir<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}/salud${ruta}`, { next: { revalidate } } as RequestInit);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const getResumenSalud = () => pedir<ResumenSalud>("/resumen");
export const buscarSalud = (q: string) => pedir<ResultadoBusqueda>(`/buscar?q=${encodeURIComponent(q)}`, 300);
export const getEstablecimientos = (params: URLSearchParams) => pedir<PaginaIpress>(`/establecimientos?${params.toString()}`);
export const getMapaSalud = (params: URLSearchParams) => pedir<Mapa>(`/mapa?${params.toString()}`, 3600);
export const getFichaIpress = (codigo: string) => (/^\d{1,8}$/.test(codigo) ? pedir<FichaIpress>(`/establecimiento/${codigo}`, 900) : Promise.resolve(null));
export const getMedico = (colegiatura: string) => (/^\d{1,7}$/.test(colegiatura) ? pedir<Medico>(`/medico/${colegiatura}`, 900) : Promise.resolve(null));
export const getSanciones = (params: URLSearchParams) => pedir<PaginaSanciones>(`/sanciones?${params.toString()}`);
export const getCambios = (params: URLSearchParams) => pedir<{ filas: Cambio[]; total: number; pagina: number; tamano: number }>(`/cambios?${params.toString()}`);
export const getFuentesSalud = () => pedir<{ fuentes: FuenteSalud[]; estado: EstadoFuentes }>("/fuentes");
export const getNormasSalud = (q: string) => pedir<{ q: string; normas: NormaSalud[] }>(`/normas?q=${encodeURIComponent(q)}`, 3600);
export const getSitemapSalud = () => pedir<{ establecimientos: { codigo: string; al: string | null }[] }>("/sitemap", 3600);

/** La dirección del asistente (POST, NDJSON; cabecera cf-turnstile-response). */
export const URL_ASISTENTE_SALUD = `${API_BASE}/salud/asistente`;

// ─── Cerca de ti ──────────────────────────────────────────────────────────────────────────────────

/** Una IPRESS cercana: la fila de siempre, si sigue en RENIPRESS y su distancia (al punto redondeado que llegó a la API). */
export interface FilaCercana extends FilaIpress {
  enRegistro: boolean;
  distancia: number;
  /** Con una necesidad: el nombre (como en RENIPRESS) de lo que declaró y coincidió. */
  coincide?: string | null;
}
export interface Cercanos {
  origen: { lat: number; lon: number };
  radioKm: number;
  filas: FilaCercana[];
  /** Con una necesidad: cuántas activas de la zona ya tienen sus servicios leídos (las únicas que pueden aparecer). */
  cobertura?: { revisados: number; total: number } | null;
}

/** La dirección de «cerca de ti» (POST {lat, lon}: la ubicación va en el cuerpo, que la API no registra). */
export const URL_CERCA_SALUD = `${API_BASE}/salud/cerca`;

/** Una coordenada redondeada a 3 decimales (unos 110 m): lo único de la ubicación que sale del teléfono. */
export const redondearCoordenada = (v: number) => Math.round(v * 1000) / 1000;

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaMetros(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (g: number) => (g * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** «A 40 m», «a 350 m», «a 1,2 km», «a 25 km». */
export function textoDistancia(m: number): string {
  if (m < 1000) return `a ${Math.max(10, Math.round(m / 10) * 10)} m`;
  if (m < 10000) return `a ${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(m / 1000)} km`;
  return `a ${numero(Math.round(m / 1000))} km`;
}

// ─── Palabras ─────────────────────────────────────────────────────────────────────────────────────

/** Las cuatro clases de hecho: cada una con su rótulo, su explicación de un renglón y su tono (variables de globals.css). */
export const CLASES_DE_HECHO: Record<TipoHecho | "reclamo", { rotulo: string; explica: string }> = {
  sancion_firme: { rotulo: "Sanción firme", explica: "Impuesta por SUSALUD al terminar un procedimiento sancionador; ya no se puede apelar en la vía administrativa." },
  denuncia: { rotulo: "Denuncia", explica: "Un ciudadano la presentó ante SUSALUD. No es un hecho comprobado ni una sanción." },
  reclamo: { rotulo: "Reclamo", explica: "Se presentó ante la propia IPRESS. Lo resuelve ella; no es una sanción." },
  registro_administrativo: { rotulo: "Registro administrativo", explica: "Lo que la IPRESS declaró en RENIPRESS, con carácter de declaración jurada." },
  verificacion_externa: { rotulo: "Se verifica en la fuente", explica: "Lo confirma otra institución (el Colegio Médico, SUNEDU): te llevamos ahí." },
};

export const ESTADOS_CHEQUEO: Record<EstadoChequeo, { rotulo: string }> = {
  ok: { rotulo: "Conforme" },
  atencion: { rotulo: "Revisa" },
  alerta: { rotulo: "Alerta" },
  sin_dato: { rotulo: "Sin dato" },
  externo: { rotulo: "Verifica fuera" },
};

export const TIPO_SANCION: Record<string, string> = {
  amonestacion: "Amonestación escrita",
  multa: "Multa",
  cierre_definitivo: "Cierre definitivo",
  cierre_temporal: "Cierre temporal",
  revocacion: "Revocación",
  otra: "Otra sanción",
};

export const GRAVEDAD: Record<string, string> = { leve: "Leve", grave: "Grave", muy_grave: "Muy grave" };

export const SECTORES: Record<Sector, string> = { publico: "Público", privado: "Privado", otro: "Otro" };

export const TIPOS_IPRESS: { clave: string; nombre: string; detalle: string }[] = [
  { clave: "con_internamiento", nombre: "Con internamiento", detalle: "Hospitales y clínicas con camas." },
  { clave: "sin_internamiento", nombre: "Sin internamiento", detalle: "Centros, puestos y consultorios." },
  { clave: "apoyo", nombre: "Servicio médico de apoyo", detalle: "Laboratorios, imágenes, ambulancias." },
  { clave: "oferta_flexible", nombre: "Oferta flexible", detalle: "Atención itinerante o campañas." },
  { clave: "terapeuticas", nombre: "Comunidad terapéutica", detalle: "Rehabilitación de adicciones." },
];

/** Del texto del tipo de RENIPRESS a su clave de filtro. */
export function claveTipo(tipo: string | null | undefined): string | null {
  const t = (tipo ?? "").toUpperCase();
  if (t.includes("CON INTERNAMIENTO")) return "con_internamiento";
  if (t.includes("SIN INTERNAMIENTO")) return "sin_internamiento";
  if (t.includes("APOYO")) return "apoyo";
  if (t.includes("FLEXIBLE")) return "oferta_flexible";
  if (t.includes("TERAP")) return "terapeuticas";
  return null;
}

export const CATEGORIAS_ORDEN = ["I-1", "I-2", "I-3", "I-4", "II-1", "II-2", "II-E", "III-1", "III-2", "III-E"] as const;

/**
 * «HOSPITAL NACIONAL ARZOBISPO LOAYZA» → «Hospital Nacional Arzobispo Loayza»; «CLINICA» → «Clínica» (las tildes, con el
 * diccionario de lib/tildes.ts). Siglas y números quedan.
 */
export function nombrePropio(t: string | null | undefined): string {
  if (!t) return "";
  return tildesEnTitulo(capitalizar(t));
}

function capitalizar(t: string): string {
  const minus = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "o", "u", "en", "a", "con", "sin", "por", "para"]);
  return t
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => {
      if (/^\s+$/.test(w)) return w;
      if (/^(s\.?a\.?c\.?|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?a\.?|ii|iii|iv|vi|vii|viii|ix|xi|xii|essalud|minsa|ipress|sis|clas)$/i.test(w)) return w.toUpperCase();
      if (i > 0 && minus.has(w)) return w;
      return w.replace(/^([^\p{L}\d]*)(\p{L})/u, (_, antes: string, letra: string) => antes + letra.toUpperCase());
    })
    .join("");
}

/** «2026-11-19» → «19 nov. 2026». */
export function fechaCorta(f: string | null | undefined): string {
  if (!f) return "sin fecha";
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  if (!a || !m) return f;
  const meses = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
  return d ? `${d} ${meses[m - 1]} ${a}` : `${meses[m - 1]} ${a}`;
}

export const numero = (n: number | null | undefined) => (n == null ? "sin dato" : new Intl.NumberFormat("es-PE").format(n));

/**
 * Las multas van en UIT, como las publica SUSALUD (la UIT cambia cada año y la multa se paga con la del año del pago):
 * no se convierten a soles.
 */

/** Una IPRESS por su código, en esta web. */
export const rutaFicha = (codigo: string) => `/establecimiento/${codigo}`;
export const rutaMedico = (colegiatura: string) => `/medico/${colegiatura}`;

// ─── Medicamentos (DIGEMID, migración 441) ───────────────────────────────────────────────────────

export type TipoAlerta = "falsificado" | "calidad" | "seguridad" | "modificacion" | "internacional" | "otra";

/** Un medicamento del Indicador de precios de DIGEMID (una presentación). */
export interface Medicamento {
  codigo: number;
  nombre: string;
  concentracion: string | null;
  forma: string | null;
  presentacion: string | null;
  fracciones: number | null;
  clasificacion: string | null;
  registro: string | null;
  titular: string | null;
  fabricante: string | null;
  pais: string | null;
  ifa: string | null;
  grupo: string | null;
  establecimientos: number | null;
  precioMediana: number | null;
  precioMedia: number | null;
  precioModa: number | null;
  /** AAAA-MM del archivo de precios. */
  periodo: string;
  enCatalogo: boolean;
  cantidadIfas?: number | null;
  /** En la búsqueda: cuántas presentaciones del mismo producto se juntaron en esta fila, y su rango de precio. */
  presentacionesN?: number;
  precioMin?: number | null;
  precioMax?: number | null;
  /** La forma en diez grupos (lib/salud-formas.ts): el dibujo de la tarjeta y el filtro. */
  formaGrupo?: FormaGrupo;
  /** En el catálogo: cuántas alertas DIGEMID nombran su registro sanitario. */
  alertasRegistro?: number;
}

/** Una alerta DIGEMID. */
export interface AlertaDigemid {
  id: number;
  numero: string | null;
  fecha: string;
  tipo: TipoAlerta;
  titulo: string;
  motivo: string | null;
  productos: string | null;
  url: string;
  pdfUrl: string | null;
  /** Lo que dice la tabla de su PDF (migración 443): un elemento por producto, con sus lotes. Vacío si aún no se extrae. */
  observados?: ObservadoAlerta[];
}

/** Un producto observado en una alerta, extraído de su PDF y validado contra el texto (nada que no diga el PDF). */
export interface ObservadoAlerta {
  producto: string;
  presentacion: string | null;
  registro: string | null;
  titular: string | null;
  fabricante: string | null;
  pais: string | null;
  detalle: string | null;
  /** El producto del catálogo con ese registro sanitario, si lo hay. */
  medicamento: number | null;
  lotes: string[];
  vencimientos: string[];
}

/** Una fila de lo extraído con su alerta: la coincidencia exacta de un lote o un registro, o la vista de productos. */
export interface ProductoObservado {
  producto: string;
  presentacion: string | null;
  lote: string | null;
  registro: string | null;
  vencimiento: string | null;
  titular: string | null;
  fabricante?: string | null;
  pais?: string | null;
  detalle: string | null;
  medicamento: number | null;
  alertaId: number;
  numero: string | null;
  fecha: string;
  tipo: TipoAlerta;
  url: string;
  pdfUrl: string | null;
  /** En /medicamentos: si coincide el lote de la caja (y no sólo el registro). */
  coincideLote?: boolean;
}

export interface FuenteMedicamentos {
  productos: number;
  alertas: number;
  ultimaAlerta: string | null;
  precios: { url: string; consulta: string; al: string | null };
  avisos: { url: string; al: string | null };
  registroSanitario: string;
}

export interface BusquedaMedicamentos {
  q: string;
  como: "registro" | "lote" | "nombre" | null;
  /** El catálogo (2026-11-22): los filtros y el orden aplicados, y cuántos productos hay de cada forma y tipo. */
  forma?: FormaGrupo | null;
  tipo?: "generico" | "marca" | null;
  orden?: "relevancia" | "populares" | "precio" | "nombre";
  facetas?: { forma: { clave: FormaGrupo; n: number }[]; genericos: number; marcas: number };
  /** Ningún producto tenía todas las palabras: son los que más se parecen (por cuántas palabras coinciden). */
  aproximado?: boolean;
  /** Las palabras del nombre con que se buscaron las alertas («CEFALOGEN» de «Cefalogen 1G Polvo…»). */
  alertasPor?: string | null;
  filas: Medicamento[];
  total: number;
  pagina: number;
  tamano: number;
  alertas: AlertaDigemid[];
  alertasTotal: number | null;
  /** El lote o el registro que se escribió, tal cual, en la tabla de una alerta. */
  coincidencias?: ProductoObservado[];
  /** El registro sanitario reconocido en q (normalizado: «EE08059»); null si q no tiene esa forma. */
  registro?: string | null;
  /** El lote de la caja que vino aparte (&lote=, de la foto), normalizado; null si no vino o es lo mismo que q. */
  loteCaja?: string | null;
  /** En cuántas alertas está ese lote: en la tabla leída o, como palabra, en el texto del PDF. */
  loteEnAlertas?: number | null;
  fuente: FuenteMedicamentos;
}

/** Lo que el modelo leyó en la foto de una caja (POST /salud/medicamentos/foto), ya validado. */
export interface LecturaCaja {
  esMedicamento: boolean;
  nombre: string | null;
  principioActivo: string | null;
  concentracion: string | null;
  registro: string | null;
  lote: string | null;
  vencimiento: string | null;
  titular: string | null;
}

/** La foto de la caja: POST con la imagen JPEG en el cuerpo y el token de Turnstile. */
export const URL_FOTO_MEDICAMENTO = `${API_BASE}/salud/medicamentos/foto`;

export interface FichaMedicamento {
  producto: Medicamento;
  marca: string;
  equivalentes: Medicamento[];
  equivalentesResumen: { n: number; minimo: number | null; maximo: number | null; genericos: number };
  presentaciones: Medicamento[];
  alertasRegistro: AlertaDigemid[];
  alertasNombre: AlertaDigemid[];
  /** Los lotes de este registro sanitario que nombra la tabla de alguna alerta. */
  lotesObservados?: { lote: string; vencimiento: string | null; presentacion: string | null; detalle: string | null; numero: string | null; fecha: string; tipo: TipoAlerta; pdfUrl: string | null }[];
  fuente: FuenteMedicamentos;
}

export interface PaginaAlertas {
  filas: AlertaDigemid[];
  total: number;
  pagina: number;
  tamano: number;
  tipos: Partial<Record<TipoAlerta, number>>;
  fuente: FuenteMedicamentos;
}

export const buscarMedicamentos = (params: URLSearchParams) => pedir<BusquedaMedicamentos>(`/medicamentos?${params.toString()}`, 600);
export const getMedicamento = (codigo: string) => (/^\d{1,9}$/.test(codigo) ? pedir<FichaMedicamento>(`/medicamento/${codigo}`, 3600) : Promise.resolve(null));
export const getAlertas = (params: URLSearchParams) => pedir<PaginaAlertas>(`/alertas?${params.toString()}`, 600);

export interface PaginaProductosAlerta {
  filas: ProductoObservado[];
  n: number;
  conLote: number;
  alertas: number;
  pagina: number;
  tamano: number;
  fuente: FuenteMedicamentos;
}
export const getProductosAlerta = (params: URLSearchParams) => pedir<PaginaProductosAlerta>(`/alertas/productos?${params.toString()}`, 600);

export const rutaMedicamento = (codigo: number | string) => `/medicamento/${codigo}`;

/** Cada tipo de alerta en palabras, con lo que quiere decir para quien tiene el producto en la mano. */
export const TIPOS_ALERTA: Record<TipoAlerta, { nombre: string; corto: string; explica: string }> = {
  falsificado: { nombre: "Productos falsificados", corto: "Falsificado", explica: "DIGEMID encontró productos falsificados o de origen desconocido con ese nombre." },
  calidad: { nombre: "Control de calidad", corto: "Calidad", explica: "Un lote no pasó el control de calidad y DIGEMID dispuso su retiro." },
  seguridad: { nombre: "Seguridad", corto: "Seguridad", explica: "Un riesgo nuevo o un cambio en cómo usarlo con seguridad." },
  modificacion: { nombre: "Modificaciones", corto: "Modificación", explica: "Cambios en el registro o en la información del producto." },
  internacional: { nombre: "Alertas internacionales", corto: "Internacional", explica: "Alertas de otras agencias sanitarias que DIGEMID difunde." },
  otra: { nombre: "Otras", corto: "Otra", explica: "Otras comunicaciones de DIGEMID." },
};

/** S/ 12,50 (o «sin precio»). */
const SIGLAS = new Set(["OMS", "OPS", "DIGEMID", "MINSA", "SUSALUD", "FDA", "EMA", "ANMAT", "INVIMA", "COFEPRIS", "ANVISA", "AEMPS", "EEUU", "EE.UU.", "UE", "SIS", "RENIPRESS"]);
/**
 * «ALERTA INTERNACIONAL OCTUBRE III – 2026» → «Alerta internacional octubre III – 2026»: en oración, con los números
 * romanos y las siglas como van; lo que sigue a «:» (un nombre propio, un producto) queda como está. Si el texto no está
 * todo en mayúsculas, no se toca.
 */
export function oracionDeMayusculas(t: string | null | undefined): string {
  const s = (t ?? "").trim();
  if (!s || s !== s.toUpperCase()) return s;
  const i = s.indexOf(":");
  const cabeza = i >= 0 ? s.slice(0, i) : s;
  const cola = i >= 0 ? s.slice(i) : "";
  const palabras = cabeza.toLowerCase().split(/(\s+)/).map((w, k) => {
    const W = w.toUpperCase();
    if (/^[IVXL]+$/.test(W) && W.length <= 4 && k > 0) return W;
    if (SIGLAS.has(W.replace(/[,.;()]+$/, "")) ) return W;
    return w;
  });
  const junto = palabras.join("");
  return junto.charAt(0).toUpperCase() + junto.slice(1) + cola;
}

/**
 * La concentración como la lee cualquiera: «500 MG» → «500 mg»; «0.003» (DIGEMID escribe así los porcentajes, sin
 * unidad: gentamicina oftálmica) → «0.3 %». Vacío si no hay.
 */
export function concentracionLegible(c: string | null | undefined): string {
  const t = (c ?? "").trim();
  if (!t) return "";
  if (/^0?[.,]\d+$/.test(t)) {
    const n = Number(t.replace(",", ".")) * 100;
    return `${Number(n.toPrecision(3)).toString()} %`;
  }
  return t.toLowerCase();
}

export function soles(n: number | null | undefined): string {
  if (n == null) return "sin precio";
  return `S/ ${new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

/** «2026-09» → «setiembre de 2026». */
export function mesLargo(am: string | null | undefined): string {
  if (!am) return "";
  const [a, m] = am.split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  return m >= 1 && m <= 12 ? `${meses[m - 1]} de ${a}` : am;
}
