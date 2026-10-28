/**
 * Las fuentes oficiales y el enlace más preciso a cada una: el que usa todo pie «Fuente:» de la app (FuenteDato) y toda
 * evidencia. El mismo catálogo vive en la API (backend/api/src/lib/fuentes.ts), que además arregla las direcciones que la
 * base guardó. Cada patrón se probó el 2026-10-27 desde el Perú con un registro real:
 *
 *   - Contrataciones Abiertas (OECE) abre un proceso sólo con el OCID completo: «ocds-dgv273-seacev3-» más el ocid que
 *     guarda Vigía («2018-1534-1» o «479951»); con el código solo dice «No se encontró el proceso». El código de CONOSCE no
 *     siempre es el final del OCID (442241 es …-2018-1534-1): con sólo el código, su búsqueda (/busqueda?search=442241).
 *     Un proveedor, con PE-RUC-<RUC> (/proveedor/PE-RUC-20545533406).
 *   - La ficha única del proveedor en el RNP (perfilprov-ui/ficha/<RUC>), INFOBRAS (Sumario?ObraId=), el SSI del MEF
 *     (Index?codigo=<CUI>&tipo=2), las declaraciones juradas de una entidad (ConsultaPublicaDJICRUC.aspx?ruc=) y la
 *     página de personal de una entidad en el Portal de Transparencia (pte_transparencia_personal.aspx?id_entidad=<id>
 *     &id_tema=32) abren el registro.
 *   - Claridad (ONPE), la consulta RUC de la SUNAT y el buscador de informes de la Contraloría no tienen enlace por
 *     registro (o piden captcha): se enlaza su consulta.
 *
 * Un RUC 10 nunca va en un enlace: lleva el DNI, y Vigía no lo publica.
 */

import { fecha } from "@/lib/formato";

/** Un enlace a la fuente: lo que dice y adónde lleva. */
export interface EnlaceFuente {
  texto: string;
  href: string;
}

const PNDA = "https://www.datosabiertos.gob.pe/dataset/";
export const datasetPnda = (slug: string) => `${PNDA}${slug}`;

export const CONTRATACIONES_ABIERTAS = "https://contratacionesabiertas.oece.gob.pe/";
export const CONOSCE_BUSCADOR = "https://conosce.oece.gob.pe/buscador/";
export const BUSCADOR_RNP = "https://apps.oece.gob.pe/perfilprov-ui/";
export const CLARIDAD_ONPE = "https://claridadportal.onpe.gob.pe/";
export const PLATAFORMA_JNE = "https://plataformaelectoral.jne.gob.pe/";
export const INFOGOB_JNE = "https://infogob.jne.gob.pe/";
export const CONSULTA_RUC_SUNAT = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp";
export const VISITAS_EN_LINEA = "https://visitas.servicios.gob.pe/";
/** El registro de visitas del Congreso (público, por día). */
export const VISITAS_CONGRESO = "https://wb2server.congreso.gob.pe/regvisitastransparencia/";
export const PORTAL_TRANSPARENCIA = "https://www.transparencia.gob.pe/";
export const DJI_CONSULTA = "https://appdji.contraloria.gob.pe/DJIC/";
export const TALENTO_PERU = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";
export const CONSULTA_AMIGABLE = "https://apps5.mineco.gob.pe/transparencia/Navegador/default.aspx";
export const DATASET_MEF = "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto";
export const BUSCADOR_CONTRALORIA = "https://buscadorinformes.contraloria.gob.pe/";
export const INFOBRAS = "https://infobras.contraloria.gob.pe/InfobrasWeb/";
/** El seguimiento de inversiones del MEF (Invierte.pe), su portada. */
export const SEGUIMIENTO_INVERSIONES = "https://ofi5.mef.gob.pe/ssi/";
/** El buscador público de las compras de hasta 8 UIT del SEACE (prod6) y la consulta de contratos (prod4). */
export const SEACE_MENORES = "https://prod6.seace.gob.pe/buscador-publico";
export const SEACE_CONTRATOS = "https://prod4.seace.gob.pe/contratos/publico/";

export const DATASET_SANCIONADOS = datasetPnda("proveedores-sancionados-2025");
export const DATASET_PENALIDADES = datasetPnda("penalidades-de-contratistas-organismo-especializado-para-las-contrataciones-p%C3%BAblicas");
export const DATASET_AUTORIDADES_JNE = datasetPnda("autoridades-vigentes-nivel-nacional-jurado-nacional-de-elecciones");
export const DATASET_SOCIOS_RNP = datasetPnda("personas-declaradas-en-la-conformaci%C3%B3n-jur%C3%ADdica-de-proveedores-en-el-registro-nacional-de");
export const DATASET_DJI = datasetPnda("declaraciones-juradas-de-intereses-presentadas-ante-la-contralor%C3%ADa");

const esRuc20 = (ruc: string | null | undefined): ruc is string => !!ruc && /^20\d{9}$/.test(ruc);

/** El OCID completo a partir del que guarda Vigía (o el OCID tal cual). */
export function ocidDe(ocidOCodigo: string | number): string {
  const s = String(ocidOCodigo).trim().replace(/^OECE-/i, "");
  return s.startsWith("ocds-") ? s : `ocds-dgv273-seacev3-${s}`;
}
/** El proceso en Contrataciones Abiertas del OECE (sus etapas, documentos, postores y contratos). */
export const procesoOece = (ocidOCodigo: string | number) => `${CONTRATACIONES_ABIERTAS}proceso/${encodeURIComponent(ocidDe(ocidOCodigo))}`;
/** La búsqueda de Contrataciones Abiertas por el código del proceso (el de CONOSCE), para cuando Vigía no tiene su OCID. */
export const busquedaOece = (codigo: string | number) => `${CONTRATACIONES_ABIERTAS}busqueda?search=${encodeURIComponent(String(codigo).trim())}`;
/** El registro OCDS del proceso tal como lo publica el OECE (JSON). */
export const registroOcds = (ocidOCodigo: string | number) => `${CONTRATACIONES_ABIERTAS}api/v1/record/${encodeURIComponent(ocidDe(ocidOCodigo))}`;
/** Los procesos de un proveedor en Contrataciones Abiertas. Sólo un RUC 20; si no, la portada. */
export const proveedorOece = (ruc: string | null | undefined) => (esRuc20(ruc) ? `${CONTRATACIONES_ABIERTAS}proveedor/PE-RUC-${ruc}` : CONTRATACIONES_ABIERTAS);
/** La ficha única del proveedor en el RNP (socios, representantes, sanciones, penalidades). Sólo un RUC 20. */
export const fichaRnp = (ruc: string | null | undefined) => (esRuc20(ruc) ? `${BUSCADOR_RNP}ficha/${ruc}` : BUSCADOR_RNP);
/** La obra en INFOBRAS (Contraloría). */
export const obraInfobras = (codigo: number | string) => `${INFOBRAS}Mapa/Sumario?ObraId=${encodeURIComponent(String(codigo))}`;
/** La inversión en el Sistema de Seguimiento de Inversiones del MEF, por su CUI. */
export const inversionSsi = (cui: string | number) => `https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo=${encodeURIComponent(String(cui))}&tipo=2`;
/** Las declaraciones juradas de intereses presentadas en una entidad (consulta pública de la Contraloría). */
export const djiEntidad = (ruc: string | null | undefined) => (esRuc20(ruc) ? `${DJI_CONSULTA}ConsultaPublicaDJICRUC.aspx?ruc=${ruc}` : DJI_CONSULTA);
/** «Personal y remuneraciones» de una entidad en el Portal de Transparencia, por su id en el portal (si no, la portada). */
export const personalPte = (idPte: number | string | null | undefined) =>
  idPte != null && String(idPte).trim()
    ? `${PORTAL_TRANSPARENCIA}personal/pte_transparencia_personal.aspx?id_entidad=${idPte}&id_tema=32&ver=`
    : PORTAL_TRANSPARENCIA;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/**
 * El reporte mensual del registro de visitas en la PNDA con las visitas de esa fecha. Los nombres, como los publicó la
 * PNDA: 2025 sin año; enero y febrero de 2026 con año; desde marzo de 2026, «en línea». Después de mayo de 2026 no
 * publicó más: el registro en línea.
 */
export function datasetVisitas(fecha: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(fecha ?? "");
  const nombre = m ? MESES[Number(m[2]) - 1] : undefined;
  if (!m || !nombre) return VISITAS_EN_LINEA;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (anio === 2025) return datasetPnda(`reporte-de-registro-de-visitas-${nombre}`);
  if (anio === 2026 && mes <= 2) return datasetPnda(`reporte-de-registro-de-visitas-${nombre}-2026`);
  if (anio === 2026 && mes <= 5) return datasetPnda(`reporte-de-registro-de-visitas-en-linea-${nombre}-2026`);
  return VISITAS_EN_LINEA;
}

/** Cada registro de visitas que carga Vigía (`fuente` de la visita), por su nombre. */
const REGISTRO_VISITAS: Record<string, string> = {
  portal_visitas_nacional: "Registro de Visitas en Línea de la PCM",
  portal_visitas_manual: "Registro de Visitas en Línea de la PCM",
  pnda_visitas: "Reporte de visitas del Gobierno Regional de Loreto (datos abiertos)",
  congreso_visitas: "Registro de visitas del Congreso",
};

/**
 * Dónde está una visita en la fuente oficial, según el registro del que salió: el del Congreso, el reporte mensual de la
 * PNDA de su mes (que es sólo del Gobierno Regional de Loreto) o, lo demás —la plataforma nacional de la PCM—, el
 * Registro de Visitas en Línea. Sin la fuente, el registro en línea: ahí están todas.
 */
export function registroVisita(
  fecha: string | null | undefined,
  fuente: string | null | undefined,
): { texto: string; href: string; fuente: string } {
  const nombre = (fuente && REGISTRO_VISITAS[fuente]) || "Registro de Visitas en Línea";
  if (fuente === "congreso_visitas") return { texto: "Registro del Congreso", href: VISITAS_CONGRESO, fuente: nombre };
  if (fuente === "pnda_visitas") {
    const href = datasetVisitas(fecha);
    const m = /^(\d{4})-(\d{2})/.exec(fecha ?? "");
    if (href !== VISITAS_EN_LINEA && m) return { texto: `Reporte de ${MESES[Number(m[2]) - 1]} de ${m[1]}`, href, fuente: nombre };
  }
  return { texto: "Registro en línea", href: VISITAS_EN_LINEA, fuente: nombre };
}

/**
 * Los enlaces de un proceso: el proceso en el OECE (por su ocid de Vigía; si no lo tiene, la búsqueda por su código de
 * CONOSCE) y su registro OCDS, y CONOSCE (adjudicaciones, postores, contratos).
 */
export function enlacesProceso(
  ocid: string | null | undefined,
  opciones: { codigo?: string | number | null; conosce?: boolean; json?: boolean } = {},
): EnlaceFuente[] {
  const codigo = opciones.codigo != null && String(opciones.codigo).trim() ? String(opciones.codigo).trim() : null;
  const l: EnlaceFuente[] = ocid
    ? [{ texto: "El proceso en Contrataciones Abiertas (OECE)", href: procesoOece(ocid) }]
    : codigo
      ? [{ texto: `El proceso ${codigo} en Contrataciones Abiertas (OECE)`, href: busquedaOece(codigo) }]
      : [{ texto: "Contrataciones Abiertas (OECE)", href: CONTRATACIONES_ABIERTAS }];
  if (opciones.json && ocid) l.push({ texto: "Su registro OCDS (JSON)", href: registroOcds(ocid) });
  if (opciones.conosce) l.push({ texto: "Buscador de CONOSCE (OECE)", href: CONOSCE_BUSCADOR });
  return l;
}

/**
 * Hasta cuándo llega el registro de visitas (la API da la fecha de la última visita cargada). Si es de hace más de dos
 * meses, también por qué: la Plataforma Nacional de Datos Abiertos dejó de publicarlo (después de mayo de 2026). Sin
 * la fecha, «no registra visitas» parecía un dato de hoy.
 */
export function avisoVisitas(hasta: string | null | undefined): string | null {
  if (!hasta) return null;
  const dias = (Date.now() - new Date(`${hasta}T12:00:00`).getTime()) / 86_400_000;
  return dias > 60
    ? `El registro de visitas llega hasta el ${fecha(hasta)}: la Plataforma Nacional de Datos Abiertos no publicó los meses siguientes.`
    : `El registro de visitas llega hasta el ${fecha(hasta)}.`;
}
