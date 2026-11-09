/**
 * Dónde publica sus procesos cada entidad cuyo aviso de SERVIR no trae un enlace que sirva (vacío, sólo Facebook o la
 * propia página de SERVIR). Descubierto el 2026-11-09 buscando la institución en gob.pe (busquedas.json con
 * contenido[]=instituciones), su «Trabaja con nosotros» y su web; cada uno probado con el buscador real sobre una plaza
 * abierta (las bases de ESE proceso). Sólo entran los probados: los que daban documentos de otro proceso quedan fuera.
 *
 * La llave es el nombre de la entidad como lo escribe SERVIR (cortado a ~40 letras), normalizado.
 */
import { fuenteDe } from "./empleoFuentes.js";

interface Enlace {
  url: string;
  /** Si el nombre se repite en otras entidades (tres hospitales Daniel A. Carrión), la región de la plaza. */
  ubicacion?: RegExp;
}

const ENLACES: Record<string, Enlace> = {
  "PROGRAMA NACIONAL CUNA MAS": { url: "http://extranet.cunamas.gob.pe/jobs" },
  "UNIVERSIDAD NACIONAL TECNOLOGICA DE LIMA SUR - UNTELS": { url: "https://www.untels.edu.pe/" },
  "HOSPITAL HUARAL Y SERVICIOS BASICOS DE SALUD": { url: "https://www.gob.pe/hhsbs" },
  "SERVICIO NACIONAL DE CERTIFICACION AMBIENTAL PARA LAS INVERSIONES SOSTENIBLES (SENACE)": { url: "https://www.senace.gob.pe/contrataciones/vigentes/" },
  "UNIVERSIDAD NACIONAL DE BARRANCA": { url: "https://www.gob.pe/unab" },
  "UNIDAD DE GESTION EDUCATIVA LOCAL DE TUMBES": { url: "https://www.gob.pe/ugeltumbes" },
  "PODER JUDICIAL": { url: "https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=C" },
  "JUNTA NACIONAL DE JUSTICIA": { url: "https://www.gob.pe/jnj" },
  "UNIDAD EJECUTORA SALUD CAJAMARCA": { url: "https://convocatorias.regioncajamarca.gob.pe/" },
  "GOBIERNO REGIONAL DE UCAYALI": { url: "https://www.gob.pe/regionucayali" },
  "MINISTERIO DE EDUCACION": { url: "https://postulacioncas.minedu.gob.pe/PostulacionCas/Home" },
  "MUNICIPALIDAD DISTR DE SANTA ROSA DE S": { url: "https://www.gob.pe/munisantarosadesacco" },
  "MUNICIPALIDAD DISTRITAL J.CRESPO Y CASTI": { url: "https://www.gob.pe/munijosecrespoycastillo" },
  "MUNICIPALIDAD PROVINCIAL DE JULCAN": { url: "https://www.gob.pe/munijulcan" },
  "UNIDAD DE GESTION EDUCATIVA LOCAL SAN PABLO": { url: "https://convocatoriasgrc.regioncajamarca.gob.pe/" },
  "CENTRO NACIONAL DE ESTIMACION, PREVENCION Y REDUCCION DEL RIESGO DE DESASTRES (CENEPRED)": { url: "https://www.gob.pe/cenepred" },
  "DIRECCION REGIONAL DE SALUD MOQUEGUA": { url: "https://www.gob.pe/regionmoquegua-diresa" },
  "GOBIERNO REGIONAL AYACUCHO": { url: "https://www.gob.pe/regionayacucho" },
  "HOSPITAL REGIONAL ELEAZAR GUZMAN BARRON": { url: "https://hegb.gob.pe/creacion/convocatorias.php" },
  "MICRO REGION ALTO HUALLAGA": { url: "https://www.gob.pe/regionsanmartin-gtah" },
  "MUNICIPALIDAD DISTRITAL DE LA ESPERANZA": { url: "https://www.gob.pe/munilaesperanza" },
  "SUPERINTENDENCIA NACIONAL DE MIGRACIONES - MIGRACIONES": { url: "https://www.migraciones.gob.pe/oportunidades_laborales_2026/" },
  "UNIDAD EJECUTORA 009: LA LIBERTAD": { url: "https://ddclalibertad.gob.pe/trabaja-con-nosotros/" },
  "UNIDAD EJECUTORA EDUCACION HUANTA": { url: "https://ugelhuanta.gob.pe/portal/index.php/nuestros-servicios/contratos/contrato-cas" },
  "UNIVERSIDAD NACIONAL AGRARIA LA MOLINA": { url: "http://agraria.lamolina.edu.pe/oficinas/administrativas/personal/personalunalm/index.php" },
  "UNIDAD EJECUTORA 405 RED DE SALUD ANGARAES": { url: "https://www.gob.pe/rsa" },
  "UNIDAD EJECUTORA 303 EDUCACION PISCO": { url: "https://www.gob.pe/ugelpisco" },
  // Con adaptador propio (lib/adaptadores/): el de Huancayo y la carpeta de Drive que la DISA pone en sus otros avisos.
  "HOSPITAL DANIEL ALCIDES CARRION": { url: "https://hdachyo.gob.pe/index.php/gestion/convocatoria-personal", ubicacion: /JUNIN/ },
  "DIRECCION SUB REGIONAL DE SALUD CUTERVO": { url: "https://drive.google.com/drive/folders/1F4KwRUessgyP_eCvGtmGHv1plEOCeWm4" },
};

const clave = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const POR_CLAVE = new Map(Object.entries(ENLACES).map(([k, v]) => [clave(k), v]));

/** El enlace conocido de la entidad, si el de SERVIR no sirve (sin enlace, sólo Facebook, SERVIR). */
export function enlaceConocido(p: { entidad: string | null; ubicacion?: string | null; detalle_url: string | null }): string | null {
  const f = fuenteDe(p.detalle_url);
  if (f.familia !== "G" && f.familia !== "E") return null;
  const e = POR_CLAVE.get(clave(p.entidad ?? ""));
  if (!e) return null;
  if (e.ubicacion && !e.ubicacion.test(clave(p.ubicacion ?? ""))) return null;
  return e.url;
}

/** La plaza con el enlace conocido de su entidad en lugar del que no sirve (o tal cual). */
export function conEnlace<T extends { entidad: string | null; ubicacion?: string | null; detalle_url: string | null }>(p: T): T {
  const url = enlaceConocido(p);
  return url ? { ...p, detalle_url: url } : p;
}

/** Cuántas entidades tienen enlace conocido (para medir). */
export const entidadesConEnlace = () => POR_CLAVE.size;
