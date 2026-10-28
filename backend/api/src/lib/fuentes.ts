/**
 * Las fuentes oficiales y el enlace más preciso a cada una. Cada patrón se probó el 2026-10-27 desde el Perú con un
 * registro real (curl):
 *
 *   - Contrataciones Abiertas del OECE abre un proceso sólo con el OCID completo: /proceso/ocds-dgv273-seacev3-84547
 *     responde el proceso; /proceso/84547 dice «No se encontró el proceso de contratación» (su API pide el ocid). El
 *     OCID es «ocds-dgv273-seacev3-» más el ocid que guarda Vigía (convocatorias.ocid: «2018-1534-1» o «479951»), que
 *     NO siempre es el código de CONOSCE (codigo_convocatoria 442241 es el OCID …-2018-1534-1). Con sólo el código, su
 *     búsqueda (/busqueda?search=442241) encuentra el proceso.
 *   - La ficha del proveedor (perfilprov-ui/ficha/RUC) responde igual en apps.osce y apps.oece; contratacionesabiertas.osce
 *     ya no responde.
 *   - INFOBRAS (Sumario?ObraId=), el SSI del MEF (Index?codigo=CUI&tipo=2), la consulta de declaraciones juradas de una
 *     entidad (ConsultaPublicaDJICRUC.aspx?ruc=) y la página de personal de una entidad en el Portal de Transparencia
 *     (pte_transparencia_personal.aspx?id_entidad=&id_tema=32) responden con el registro.
 *   - gob.pe/tce da 404; los datasets «penalidades-aplicadas-contratos-oece» y «autoridades-vigentes-jne» ya no existen (la
 *     PNDA redirige a su buscador): sus direcciones de hoy van abajo.
 *   - Claridad (ONPE) y la consulta RUC de la SUNAT rechazan a curl (403) pero abren en el navegador; no tienen enlace por
 *     registro (la SUNAT pide un captcha), así que se enlaza su consulta.
 *
 * La base guarda en cruces_proveedor.fuente_url y persona_senal.fuente_url la portada de cada portal (y, en algunas
 * fuentes, una de esas direcciones rotas). `enlaceFuente` las arregla al leer y, si la fila trae con qué, lleva al registro
 * exacto. Un RUC 10 nunca va en un enlace: lleva el DNI, y Vigía no lo publica.
 */

const PNDA_BASE = "https://www.datosabiertos.gob.pe/dataset/";

/** Un dataset de la Plataforma Nacional de Datos Abiertos, por su slug (con las tildes ya codificadas). */
export const datasetPnda = (slug: string) => `${PNDA_BASE}${slug}`;

/** El proceso en Contrataciones Abiertas del OECE: acepta el OCID completo o el que guarda Vigía (le pone el prefijo). */
export function procesoOece(ocidOCodigo: string | number): string {
  const s = String(ocidOCodigo).trim().replace(/^OECE-/i, "");
  return `https://contratacionesabiertas.oece.gob.pe/proceso/${encodeURIComponent(s.startsWith("ocds-") ? s : `ocds-dgv273-seacev3-${s}`)}`;
}
/** La búsqueda de Contrataciones Abiertas por el código del proceso (el de CONOSCE): el proceso aunque su OCID sea otro. */
export const busquedaOece = (codigo: string | number) =>
  `https://contratacionesabiertas.oece.gob.pe/busqueda?search=${encodeURIComponent(String(codigo).trim())}`;
/** El buscador de proveedores del RNP (OECE). */
export const BUSCADOR_RNP = "https://apps.oece.gob.pe/perfilprov-ui/";
/**
 * La ficha única del proveedor en el RNP (socios, sanciones, penalidades, contratos). Sólo un RUC 20: un RUC 10 lleva el
 * DNI y no va en un enlace; para ése, el buscador.
 */
export const fichaProveedorOece = (ruc: string) => (/^20\d{9}$/.test(ruc) ? `${BUSCADOR_RNP}ficha/${ruc}` : BUSCADOR_RNP);
/** Las declaraciones juradas de intereses presentadas en una entidad (la consulta pública de la Contraloría). */
export const djiEntidad = (ruc: string) => `https://appdji.contraloria.gob.pe/DJIC/ConsultaPublicaDJICRUC.aspx?ruc=${ruc}`;
/** «Personal y remuneraciones» de una entidad en el Portal de Transparencia Estándar, por su id en el portal. */
export const personalPte = (idPte: number | string) =>
  `https://www.transparencia.gob.pe/personal/pte_transparencia_personal.aspx?id_entidad=${idPte}&id_tema=32&ver=`;
/** La obra en INFOBRAS (Contraloría). */
export const obraInfobras = (codigo: number | string) =>
  `https://infobras.contraloria.gob.pe/InfobrasWeb/Mapa/Sumario?ObraId=${encodeURIComponent(String(codigo))}`;
/** La inversión en el Sistema de Seguimiento de Inversiones del MEF, por su CUI. */
export const inversionSsi = (cui: string) => `https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo=${encodeURIComponent(cui)}&tipo=2`;

export const CONOSCE_BUSCADOR = "https://conosce.oece.gob.pe/buscador/";
export const CONTRATACIONES_ABIERTAS = "https://contratacionesabiertas.oece.gob.pe/";
export const CLARIDAD_ONPE = "https://claridadportal.onpe.gob.pe/";
export const PLATAFORMA_JNE = "https://plataformaelectoral.jne.gob.pe/";
export const CONSULTA_RUC_SUNAT = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp";
export const VISITAS_EN_LINEA = "https://visitas.servicios.gob.pe/";
/** El registro de visitas del Congreso (su propio sistema, con la consulta pública por día). */
export const VISITAS_CONGRESO = "https://wb2server.congreso.gob.pe/regvisitastransparencia/";
export const PORTAL_TRANSPARENCIA = "https://www.transparencia.gob.pe/";
export const DJI_CONSULTA = "https://appdji.contraloria.gob.pe/DJIC/";

export const DATASET_SANCIONADOS = datasetPnda("proveedores-sancionados-2025");
export const DATASET_PENALIDADES = datasetPnda("penalidades-de-contratistas-organismo-especializado-para-las-contrataciones-p%C3%BAblicas");
export const DATASET_AUTORIDADES_JNE = datasetPnda("autoridades-vigentes-nivel-nacional-jurado-nacional-de-elecciones");
export const DATASET_SOCIOS_RNP = datasetPnda("personas-declaradas-en-la-conformaci%C3%B3n-jur%C3%ADdica-de-proveedores-en-el-registro-nacional-de");
export const DATASET_DJI = datasetPnda("declaraciones-juradas-de-intereses-presentadas-ante-la-contralor%C3%ADa");

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * El reporte mensual del registro de visitas en la PNDA donde está una visita de esa fecha. Los nombres, como los publicó
 * la PNDA (datasets_cargas, los 17 meses cargados): 2025 sin año («…-visitas-septiembre»); enero y febrero de 2026 con año;
 * desde marzo de 2026, «…-visitas-en-linea-marzo-2026». Después de mayo de 2026 no publicó más: el registro en línea.
 */
export function datasetVisitas(fecha: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(fecha ?? "");
  if (!m) return VISITAS_EN_LINEA;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const nombre = MESES[mes - 1];
  if (!nombre) return VISITAS_EN_LINEA;
  if (anio === 2025) return datasetPnda(`reporte-de-registro-de-visitas-${nombre}`);
  if (anio === 2026 && mes <= 2) return datasetPnda(`reporte-de-registro-de-visitas-${nombre}-2026`);
  if (anio === 2026 && mes <= 5) return datasetPnda(`reporte-de-registro-de-visitas-en-linea-${nombre}-2026`);
  return VISITAS_EN_LINEA;
}

/** La portada que corresponde a cada fuente cuando la fila no trae con qué ir al registro. */
const PORTADA: Record<string, string> = {
  conosce_ordenes: CONOSCE_BUSCADOR,
  conosce_adjudicaciones: CONOSCE_BUSCADOR,
  conosce_contratos: CONOSCE_BUSCADOR,
  persona_entidad: CONOSCE_BUSCADOR,
  oece_ocds: CONTRATACIONES_ABIERTAS,
  precio_item: CONTRATACIONES_ABIERTAS,
  osce_sancionados: DATASET_SANCIONADOS,
  penalidades: DATASET_PENALIDADES,
  rnp_conformacion_juridica: DATASET_SOCIOS_RNP,
  oece_rnp: DATASET_SOCIOS_RNP,
  dji: DJI_CONSULTA,
  dji_contraloria: DJI_CONSULTA,
  pte_personal: PORTAL_TRANSPARENCIA,
  visitas_entidades: VISITAS_EN_LINEA,
  jne_autoridades: PLATAFORMA_JNE,
  jne_candidaturas: PLATAFORMA_JNE,
  onpe_aportantes: CLARIDAD_ONPE,
  onpe_candidatos: CLARIDAD_ONPE,
  onpe_gastos_proveedores: CLARIDAD_ONPE,
  sunat: CONSULTA_RUC_SUNAT,
};

/**
 * Una dirección guardada → la que hoy lleva a algo. Sin dirección, la portada de la fuente. Arregla: gob.pe/tce (404),
 * los dos datasets que cambiaron de nombre, el dominio viejo de Contrataciones Abiertas (no responde), un proceso por su
 * código (no abre) y las portadas genéricas (gob.pe, datosabiertos.gob.pe) cuando la fuente tiene una propia.
 */
export function arreglarUrl(fuente: string | null | undefined, url: string | null | undefined): string | null {
  const portada = PORTADA[fuente ?? ""] ?? null;
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return portada;
  if (/^https?:\/\/(www\.)?gob\.pe\/tce\/?$/i.test(u)) return DATASET_SANCIONADOS;
  if (u.includes("/dataset/penalidades-aplicadas-contratos-oece")) return DATASET_PENALIDADES;
  if (u.includes("/dataset/autoridades-vigentes-jne")) return DATASET_AUTORIDADES_JNE;
  if (/^https?:\/\/(www\.)?(gob\.pe|datosabiertos\.gob\.pe)\/?$/i.test(u) || /^https?:\/\/(www\.)?gob\.pe\/oece\/?$/i.test(u)) return portada ?? u;
  const proceso = /^https?:\/\/contratacionesabiertas\.o[es]ce\.gob\.pe\/proceso\/([^/?#]+)/i.exec(u);
  if (proceso) return procesoOece(decodeURIComponent(proceso[1]));
  return u
    .replace(/^https?:\/\/contratacionesabiertas\.osce\.gob\.pe\//i, CONTRATACIONES_ABIERTAS)
    .replace(/^https?:\/\/apps\.osce\.gob\.pe\//i, "https://apps.oece.gob.pe/")
    .replace(/^https?:\/\/conosce\.osce\.gob\.pe\//i, "https://conosce.oece.gob.pe/");
}

/** Lo que una fila trae para llevar al registro exacto. */
export interface ContextoFuente {
  /** El proveedor (RUC 20: su ficha en el RNP; un RUC 10 nunca va en un enlace). */
  ruc?: string | null;
  /** El proceso (OCID o código SEACE). */
  ocid?: string | null;
  codigo?: string | number | null;
  /** La entidad de la fila (sus declaraciones juradas). */
  entidadRuc?: string | null;
  /** El id de la entidad en el Portal de Transparencia (pte_entidad). */
  idPte?: number | string | null;
  /** La fecha del hecho (para el reporte mensual de visitas). */
  fecha?: string | Date | null;
  detalle?: Record<string, unknown> | null;
}

const esRuc20 = (v: unknown): v is string => typeof v === "string" && /^20\d{9}$/.test(v);
const texto = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v : null);
const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/**
 * El enlace de una fila de cruce o de señal: el registro exacto si la fila trae con qué (el proceso, la ficha del
 * proveedor, las declaraciones juradas de la entidad, su planilla en el Portal de Transparencia, el reporte de visitas
 * del mes); si no, la dirección guardada ya arreglada.
 */
export function enlaceFuente(fuente: string | null | undefined, url: string | null | undefined, ctx: ContextoFuente = {}): string | null {
  const f = fuente ?? "";
  const d = ctx.detalle ?? {};
  const codigo = ctx.codigo != null && String(ctx.codigo).trim() ? String(ctx.codigo).trim() : null;
  switch (f) {
    case "conosce_adjudicaciones":
    case "oece_ocds":
    case "precio_item":
      if (ctx.ocid) return procesoOece(ctx.ocid);
      if (codigo) return busquedaOece(codigo);
      break;
    case "osce_sancionados":
    case "penalidades":
    case "rnp_conformacion_juridica":
      if (esRuc20(ctx.ruc)) return fichaProveedorOece(ctx.ruc);
      break;
    case "oece_rnp": {
      // socio_proveedor: la empresa de la que es socio (la primera citada).
      const empresa = lista(d.empresas).find((e) => esRuc20(e.ruc));
      if (empresa) return fichaProveedorOece(empresa.ruc as string);
      if (esRuc20(ctx.ruc)) return fichaProveedorOece(ctx.ruc);
      break;
    }
    case "dji":
    case "dji_contraloria": {
      // La entidad del funcionario que declaró (la del pariente citado, si la trae) o la de la fila.
      const pariente = lista(d.parientes).find((p) => esRuc20(p.entidad_ruc));
      const ruc = pariente ? (pariente.entidad_ruc as string) : ctx.entidadRuc;
      if (esRuc20(ruc)) return djiEntidad(ruc);
      break;
    }
    case "pte_personal":
      if (ctx.idPte != null && String(ctx.idPte).trim()) return personalPte(ctx.idPte);
      break;
    case "visitas_entidades": {
      // Cada visita a su registro (migración 193 guarda de dónde salió): el del Congreso, el reporte mensual de la PNDA
      // (que es sólo del Gobierno Regional de Loreto) o, lo demás, el Registro de Visitas en Línea de la PCM.
      const de = texto(d.fuente_visita);
      if (de === "congreso_visitas") return VISITAS_CONGRESO;
      if (de === "pnda_visitas") {
        const primera = lista(d.visitas)[0];
        const fecha = texto(primera?.fecha) ?? texto(ctx.fecha);
        if (fecha) return datasetVisitas(fecha);
      }
      return VISITAS_EN_LINEA;
    }
  }
  return arreglarUrl(f, url);
}
