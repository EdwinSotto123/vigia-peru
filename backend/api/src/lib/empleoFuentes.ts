/**
 * Las fuentes de las convocatorias de empleo público (docs/automatizacion_cas.md §4, migración 271): a qué familia de
 * sitio pertenece el enlace que publica SERVIR, qué tipo de documento es cada enlace de una convocatoria y la huella de
 * un evento. Todo puro: lo usan el recolector (lib/empleoRecolector.ts), la ruta de bases y las pruebas.
 *
 * Familias (cada una con su adaptador):
 *   A gob.pe (la plataforma única del Estado)      E Facebook (no se lee: pide sesión)
 *   B aplicativo propio (formularios, JSF, ASPX)    F archivo suelto (Google Drive, Docs, blogspot)
 *   C plataforma regional con varias entidades      G sin enlace o sólo SERVIR
 *   D web propia con lista de procesos              H con captcha (fuera: sólo el enlace)
 *
 * Privacidad: los documentos de RESULTADOS (aptos, ganadores, puntajes) traen nombres y DNI de postulantes. De ellos sólo
 * se guarda que existen (etapa, fecha y enlace): nunca se bajan, ni se copian en R2, ni se leen (`soloEnlace`).
 */
import { createHash } from "node:crypto";

export type Familia = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
export type EstadoFuente = "activa" | "bloqueada" | "captcha" | "solo_facebook" | "sin_web";
export type TipoDocumento = "bases" | "perfil" | "anexo" | "cronograma" | "comunicado" | "fe_erratas" | "resultado" | "otro";

export interface Fuente {
  /** El dominio (`www.gob.pe`, `aplicativo.pj.gob.pe`) o «(sin enlace)». */
  dominio: string;
  familia: Familia;
  estado: EstadoFuente;
  adaptador: string;
  /** Sólo responde a IPs del Perú (bloquea a Cloudflare): sale por el relay de Lima. */
  necesitaLima: boolean;
  /** La URL que se usa (la primera que no es de Facebook, si SERVIR trae varias). */
  url: string | null;
}

export const SIN_ENLACE = "(sin enlace)";

/** Los aplicativos propios conocidos (familia B), con el nombre de su adaptador. */
export const APLICATIVOS: Record<string, string> = {
  "aplicativo.pj.gob.pe": "poder_judicial",
  "convocatoria.minjus.gob.pe": "minjus",
  "postulacioncas.minedu.gob.pe": "minedu",
  "convocatorias.minsa.gob.pe": "minsa",
  "caspublico.oece.gob.pe": "oece",
  "convocatoria.juntos.gob.pe": "juntos",
  "app.inia.gob.pe": "inia",
  "convocatoria.fmp.gob.pe": "fmp",
  "aplicativosweb2.sunafil.gob.pe": "sunafil",
  "digpe.fap.mil.pe": "fap",
  "oportunidadeslaborales.indecopi.gob.pe": "indecopi",
  "esiscasv2.produce.gob.pe": "produce",
  "pad2.minem.gob.pe": "minem",
  "convocatorias.itp.gob.pe": "itp",
  "convocatorias.cultura.gob.pe": "cultura",
  "convocatorias.cofopri.gob.pe": "cofopri",
  "app.hrayacucho.gob.pe": "hr_ayacucho",
};

/** Con captcha o desafío anti-bots (no se resuelven): el Ministerio Público y la DRELM. */
// La DRELM puso un desafío de Cloudflare (2026-11-09: «Just a moment…» aun desde el Perú): fuera, como el captcha.
const CAPTCHA = new Set(["portal.mpfn.gob.pe", "www.drelm.gob.pe"]);
/** Bloquean a Cloudflare pero responden al Perú (medido): el Poder Judicial y la DRELM. */
const SOLO_PERU = /(^|\.)(pj\.gob\.pe|drelm\.gob\.pe|servir\.gob\.pe)$/i;
/** Plataformas de un gobierno regional que publican varias entidades (convocatorias.regionpiura.gob.pe…). */
const REGIONAL = /^(convocatorias?(grc)?\.region[a-z]+\.gob\.pe|[a-z0-9-]+\.region[a-z]+\.gob\.pe)$/i;

/** Las URLs de un texto de SERVIR (a veces trae dos: la web y el Facebook). */
export function urls(texto: string | null | undefined): string[] {
  return [...(texto ?? "").matchAll(/https?:\/\/[^\s<>"'|]+/gi)].map((m) => m[0].replace(/[.,;)]+$/, ""));
}

/** La URL útil: la primera que no es Facebook; si sólo hay Facebook, ésa. */
export function urlPrincipal(texto: string | null | undefined): string | null {
  const xs = urls(texto);
  return xs.find((u) => !/facebook\.com|fb\.com/i.test(u)) ?? xs[0] ?? null;
}

/** La familia, el estado y el adaptador de la fuente de un enlace de SERVIR (`detalle_url`). */
export function fuenteDe(detalleUrl: string | null | undefined): Fuente {
  const url = urlPrincipal(detalleUrl);
  const vacia: Fuente = { dominio: SIN_ENLACE, familia: "G", estado: "sin_web", adaptador: "ninguno", necesitaLima: false, url: null };
  if (!url) return vacia;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return vacia;
  }
  const lima = SOLO_PERU.test(host);
  const f = (familia: Familia, adaptador: string, estado: EstadoFuente = "activa", dominio = host): Fuente => ({ dominio, familia, estado, adaptador, necesitaLima: lima, url });
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$/.test(host)) return f("E", "ninguno", "solo_facebook", "facebook.com");
  if (host === "drive.google.com" || host === "docs.google.com" || host.endsWith(".blogspot.com")) return f("F", "archivo");
  if (host === "www.gob.pe" || host === "gob.pe") return f("A", "gob_pe", "activa", "www.gob.pe");
  if (/(^|\.)servir\.gob\.pe$/.test(host)) return { ...f("G", "ninguno", "sin_web"), url };
  if (CAPTCHA.has(host)) return f("H", "ninguno", "captcha");
  if (APLICATIVOS[host]) return f("B", APLICATIVOS[host]);
  if (REGIONAL.test(host)) return f("C", "regional");
  return f("D", "generico");
}

/**
 * Un correo de OFICINA (selección, convocatorias, recursos humanos, mesa de partes…): se muestra entero porque es el canal
 * de postulación. Uno con el nombre de una persona (nombre.apellido@entidad.gob.pe) queda tapado, como todo correo.
 */
export function correoDeOficina(c: string | null | undefined): boolean {
  const m = /^([a-z0-9._%+-]+)@[a-z0-9.-]+\.(gob|edu)\.pe$/i.exec((c ?? "").trim());
  if (!m) return false;
  return /(seleccion|convocatoria|practica|practicante|rrhh|recursos|humanos|personal|mesadepartes|mesa_de_partes|mesa\.partes|tramite|talento|reclut|postula|secigra|ogrh|oficina)/i.test(m[1]);
}

/** Minúsculas, sin tildes, sin signos: para clasificar títulos de documentos. */
export function plano(s: string): string {
  let t = s;
  try {
    t = decodeURIComponent(t);
  } catch {
    /* queda como vino */
  }
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * El tipo de un documento por su título y su dirección. El orden importa: «Resultados de la convocatoria CAS» es un
 * resultado (no las bases) y «Aviso de convocatoria» son las bases (no un comunicado).
 */
export function tipoDocumento(titulo: string, url = ""): TipoDocumento {
  const t = plano(`${titulo} ${url.split("/").pop() ?? ""}`);
  if (/\berrata/.test(t)) return "fe_erratas";
  if (/\bresultad|\baptos?\b|\bganador|\bcuadro de merito|\bpuntaje|\brelacion de postulantes|\bpostulantes (aptos|calificados|admitidos)|\bacta de (evaluacion|resultados)/.test(t)) return "resultado";
  if (/\bbases?\b|\baviso de convocatoria/.test(t)) return "bases";
  if (/\bcomunicado|\bprorroga|\bampliacion|\bsuspension|\bcancelacion|\bdesiert|\bmodificacion|\bpostergacion/.test(t)) return "comunicado";
  if (/\bcronograma/.test(t)) return "cronograma";
  if (/\banexo|\bformato|\bdeclaracion(es)? jurada|\bficha (de )?(postula|curricular|resumen)|\bsolicitud de (inscripcion|postulacion)/.test(t)) return "anexo";
  if (/\bperfil|\btdr\b|\bterminos de referencia|\brequerimiento/.test(t)) return "perfil";
  if (/\bconvocatoria|\bproceso cas|\bcas n|\bconcurso/.test(t)) return "bases";
  return "otro";
}

/** Un documento del que sólo se guarda el enlace (resultados: traen nombres y DNI). */
export const soloEnlace = (titulo: string, url = "") => tipoDocumento(titulo, url) === "resultado";

/** El evento que deja un documento nuevo en una convocatoria que ya tenía documentos. */
export function eventoDeDocumento(tipo: TipoDocumento): "documento_nuevo" | "comunicado" | "resultado_etapa" {
  if (tipo === "resultado") return "resultado_etapa";
  if (tipo === "comunicado" || tipo === "fe_erratas") return "comunicado";
  return "documento_nuevo";
}

/** La huella de un evento: el mismo hecho no se avisa dos veces. */
export function huellaEvento(convocatoria: string, tipo: string, url: string | null, detalle: string): string {
  return createHash("sha256").update([convocatoria, tipo, url ?? "", detalle].join("|")).digest("hex").slice(0, 32);
}

/** Las etapas del cronograma que cambiaron de fecha (para el evento `cambio_cronograma`). */
export function cambiosCronograma(
  antes: { etapa: string; fecha: string }[] | null | undefined,
  ahora: { etapa: string; fecha: string }[] | null | undefined,
): { etapa: string; antes: string; ahora: string }[] {
  if (!antes?.length || !ahora?.length) return [];
  const previo = new Map(antes.map((x) => [plano(x.etapa), x.fecha]));
  const out: { etapa: string; antes: string; ahora: string }[] = [];
  for (const x of ahora) {
    const f = previo.get(plano(x.etapa));
    if (f != null && plano(f) !== plano(x.fecha)) out.push({ etapa: x.etapa, antes: f, ahora: x.fecha });
  }
  return out;
}

/**
 * Ordena una lista para que dos seguidas no sean del mismo sitio (de a una por dominio, en rondas): cortesía con las
 * webs chicas del Estado, que el recolector visita de a una plaza.
 */
export function intercalarPorDominio<T>(xs: T[], dominio: (x: T) => string): T[] {
  const grupos = new Map<string, T[]>();
  for (const x of xs) {
    const d = dominio(x);
    const g = grupos.get(d);
    if (g) g.push(x);
    else grupos.set(d, [x]);
  }
  const out: T[] = [];
  const colas = [...grupos.values()];
  for (let i = 0; out.length < xs.length; i++) for (const c of colas) if (c[i] !== undefined) out.push(c[i]);
  return out;
}
