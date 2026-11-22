/**
 * Gobserva Salud (salud.gobserva.cloud, 2026-11-20): lo que comparten la API, el asistente y el MCP para verificar
 * establecimientos de salud (IPRESS) y médicos con fuentes oficiales. Sin SQL: la ruta (routes/gobservaSalud.ts) trae los
 * datos y acá se decide qué se puede afirmar y con qué palabras.
 *
 * Reglas (las mismas en la web, el asistente y el MCP):
 *   · Cada afirmación lleva su fuente y su fecha. Lo que una fuente no trae no se afirma: «no figura en X al <fecha>»,
 *     nunca «no tiene».
 *   · Cuatro clases de hecho que no se mezclan: SANCIÓN FIRME (Registro de Sanciones de SUSALUD), DENUNCIA o CONSULTA
 *     (pedidos de ciudadanos ante SUSALUD, no comprobados), RECLAMO (ante la propia IPRESS) y REGISTRO ADMINISTRATIVO
 *     (RENIPRESS: lo que la IPRESS declaró, con carácter de declaración jurada).
 *   · La sanción de una IPRESS no es una sanción a quien la dirige. Nunca se califica a un profesional ni se dice que es
 *     peligroso: si está habilitado, lo dice el Colegio Médico del Perú.
 *   · De las personas: ni nombres ni documentos. Del responsable de una IPRESS, sólo su colegio, colegiatura y RNE (lo que
 *     cualquiera necesita para verificarlo en su colegio).
 */

export const URL_RENIPRESS = "http://app20.susalud.gob.pe:8080/registro-renipress-webapp";
export const consultaRenipress = (codigo: string) => `${URL_RENIPRESS}/ipress.htm?action=mostrarVer&idipress=${codigo}`;
export const URL_SANCIONES = "https://www.gob.pe/institucion/susalud/informes-publicaciones/455207-registro-de-sanciones-aplicables-a-las-iafas-ipress-y-ugipress";
export const URL_DATOS_SUSALUD = "http://datos.susalud.gob.pe/";
export const URL_CMP = "https://conoceatumedico.cmp.org.pe/";
export const URL_SUNEDU = "https://enlinea.sunedu.gob.pe/";
export const URL_DENUNCIA_SUSALUD = "https://www.gob.pe/institucion/susalud/pages/469-presentar-una-consulta-o-denuncia-sobre-un-servicio-de-salud";
export const URL_VIGIA = "https://vigia.gobserva.cloud";

/** Las fuentes, en el orden en que se explican. `tipo` es la clase de hecho que aporta. */
/** DIGEMID (migración 441): las alertas, el Indicador de precios y las consultas oficiales. */
export const URL_DIGEMID_ALERTAS = "https://www.digemid.minsa.gob.pe/webDigemid/alertas-modificaciones/";
export const URL_DIGEMID_PRECIOS = "https://www.digemid.minsa.gob.pe/webDigemid/reportes/2026/indicador-de-precios-de-productos-farmaceuticos/";
export const URL_OBSERVATORIO = "https://opm-digemid.minsa.gob.pe/#/consulta-producto";
export const URL_REGISTRO_SANITARIO = "https://www.digemid.minsa.gob.pe/rsProductosFarmaceuticos/";

/** «EE-01234», «ee 01234», «R.S. EE01234», «Reg. San. N° EE-01234» → «EE01234»; null si no tiene forma de registro sanitario. */
export function registroDe(q: string): string | null {
  // «N°», «Nº», «No.», «N.» es la etiqueta; una «N» sola es la del registro («R.S. N-12345»).
  const t = q.toUpperCase().replace(/^(R\.?\s*S\.?|REG(ISTRO)?\.?\s*(SAN(ITARIO)?\.?)?)\s*(N[º°]|NO\.|N\.)?\s*:?\s*/, "").replace(/[\s-]+/g, "");
  return /^[A-Z]{1,3}\d{4,6}[A-Z]?$/.test(t) ? t : null;
}

/** ¿Parece un lote? Una sola palabra con números (y quizá letras), de 4 a 20 caracteres: «20250502QX», «L-2345». */
export function pareceLote(q: string): string | null {
  const t = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!t || t.includes(" ") && !/^[A-Z]{1,2} \d+$/.test(t)) return null;
  const junto = t.replace(/ /g, "");
  return /^[A-Z0-9]{4,20}$/.test(junto) && /\d/.test(junto) ? junto : null;
}

export const FUENTES_SALUD = [
  {
    clave: "renipress",
    nombre: "RENIPRESS: Registro Nacional de IPRESS",
    entidad: "Superintendencia Nacional de Salud (SUSALUD)",
    tipo: "registro_administrativo",
    que: "Todas las instituciones prestadoras de servicios de salud públicas, privadas y mixtas: estado, categoría, dirección, ubicación, servicios autorizados, especialidades, cartera de servicios y documentos declarados.",
    ojo: "Lo que dice RENIPRESS es declaración jurada de cada IPRESS (art. 7 de la R.S. N.° 004-2021-SUSALUD/S): SUSALUD lo publica, la IPRESS responde por su veracidad.",
    url: URL_DATOS_SUSALUD,
    consulta: `${URL_RENIPRESS}/ipress.htm?action=mostrarVer`,
    frecuencia: "Archivo completo cada viernes; el detalle de cada IPRESS, cada 30 días o al abrir su ficha.",
  },
  {
    clave: "sanciones",
    nombre: "Registro de Sanciones de SUSALUD",
    entidad: "Superintendencia Nacional de Salud (SUSALUD)",
    tipo: "sancion_firme",
    que: "Las sanciones firmes impuestas a IPRESS, IAFAS y UGIPRESS: amonestación, multa en UIT o cierre, con su procedimiento, resolución, fecha e infracción.",
    ojo: "Sólo sanciones firmes. SUSALUD las publica por lo menos un año y luego puede retirarlas; una sanción puede estar en un proceso judicial (lo indicamos cuando el registro lo dice).",
    url: URL_SANCIONES,
    consulta: URL_SANCIONES,
    frecuencia: "Cada viernes, con el archivo que SUSALUD publique ese día.",
  },
  {
    clave: "denuncias",
    nombre: "Consultas y denuncias ante SUSALUD (anonimizado)",
    entidad: "Superintendencia Nacional de Salud (SUSALUD)",
    tipo: "denuncia",
    que: "Cuántas consultas, denuncias e intervenciones de oficio recibió SUSALUD sobre cada institución, por año.",
    ojo: "Una denuncia es el pedido de un ciudadano, no un hecho comprobado ni una sanción. Un hospital grande recibe más por atender a más gente.",
    url: URL_DATOS_SUSALUD,
    consulta: URL_DENUNCIA_SUSALUD,
    frecuencia: "Cada viernes (SUSALUD publica el año en curso varias veces al año).",
  },
  {
    clave: "recursos",
    nombre: "Recursos de salud por IPRESS (Consulta A)",
    entidad: "Superintendencia Nacional de Salud (SUSALUD)",
    tipo: "registro_administrativo",
    que: "Consultorios, camas, médicos, enfermeras y otros profesionales, y ambulancias que cada IPRESS declara al mes.",
    ojo: "Lo informa cada IPRESS; no todas informan todos los meses.",
    url: URL_DATOS_SUSALUD,
    consulta: URL_DATOS_SUSALUD,
    frecuencia: "Cada viernes, el último mes publicado.",
  },
  {
    clave: "cirugias",
    nombre: "Producción de intervenciones quirúrgicas (Consulta H)",
    entidad: "Superintendencia Nacional de Salud (SUSALUD)",
    tipo: "registro_administrativo",
    que: "Cirugías mayores y menores, programadas y de emergencia, que cada IPRESS declara al mes.",
    ojo: "Que una IPRESS informe cirugías no prueba que esté autorizada para cada tipo de cirugía.",
    url: URL_DATOS_SUSALUD,
    consulta: URL_DATOS_SUSALUD,
    frecuencia: "Cada viernes, los últimos 13 meses publicados.",
  },
  {
    clave: "cmp",
    nombre: "Conoce a tu médico (Colegio Médico del Perú)",
    entidad: "Colegio Médico del Perú (CMP)",
    tipo: "verificacion_externa",
    que: "Si un médico está colegiado y habilitado, su especialidad registrada (RNE) y su recertificación.",
    ojo: "Pide una cuenta y un captcha, y limita las consultas: no lo leemos de forma automática. Te llevamos ahí con los datos para buscar.",
    url: URL_CMP,
    consulta: URL_CMP,
    frecuencia: "En vivo, en el sitio del CMP.",
  },
  {
    clave: "sunedu",
    nombre: "Registro Nacional de Grados y Títulos (SUNEDU)",
    entidad: "Superintendencia Nacional de Educación Superior Universitaria (SUNEDU)",
    tipo: "verificacion_externa",
    que: "Los grados y títulos universitarios inscritos (médico cirujano, segunda especialidad).",
    ojo: "Tiene captcha: no lo leemos de forma automática.",
    url: URL_SUNEDU,
    consulta: URL_SUNEDU,
    frecuencia: "En vivo, en el sitio de SUNEDU.",
  },
  {
    clave: "precios",
    nombre: "Indicador de precios de productos farmacéuticos (Observatorio de DIGEMID)",
    entidad: "Dirección General de Medicamentos, Insumos y Drogas (DIGEMID)",
    tipo: "registro_administrativo",
    que: "Unos 15 mil medicamentos con su registro sanitario, titular, fabricante, principio activo y la media, mediana y moda del precio de venta en farmacias y boticas privadas, por mes.",
    ojo: "Es el precio que reportan las farmacias y boticas privadas ese mes, no el de hoy ni el de una farmacia en particular. No es el registro sanitario completo: sólo los productos con precios reportados.",
    url: URL_DIGEMID_PRECIOS,
    consulta: URL_OBSERVATORIO,
    frecuencia: "Cada día se revisa si DIGEMID publicó un mes nuevo (sale con unas 5 semanas de rezago).",
  },
  {
    clave: "alertas",
    nombre: "Alertas DIGEMID",
    entidad: "Dirección General de Medicamentos, Insumos y Drogas (DIGEMID)",
    tipo: "registro_administrativo",
    que: "Las alertas sobre productos falsificados, lotes con control de calidad no conforme, seguridad y modificaciones, cada una con su PDF (producto, lote, registro sanitario).",
    ojo: "Una alerta habla de lo que dice su PDF: un lote observado no quiere decir que todo el producto lo esté. Revisa el lote de tu envase.",
    url: URL_DIGEMID_ALERTAS,
    consulta: URL_DIGEMID_ALERTAS,
    frecuencia: "Cada día, las nuevas y las modificadas.",
  },
] as const;

/** Las categorías de la NTS N.° 021-MINSA/DGSP-V.03 (Categorías de Establecimientos del Sector Salud), en palabras. */
export const CATEGORIAS: Record<string, { nivel: string; nombre: string; detalle: string }> = {
  "I-1": { nivel: "Primer nivel", nombre: "Puesto de salud", detalle: "Atención básica con profesionales de la salud no médicos." },
  "I-2": { nivel: "Primer nivel", nombre: "Puesto o consultorio con médico", detalle: "Atención ambulatoria con médico." },
  "I-3": { nivel: "Primer nivel", nombre: "Centro de salud sin internamiento", detalle: "Atención ambulatoria con más servicios (laboratorio, por ejemplo), sin camas." },
  "I-4": { nivel: "Primer nivel", nombre: "Centro de salud con internamiento", detalle: "Atención ambulatoria y camas de internamiento de corta estancia." },
  "II-1": { nivel: "Segundo nivel", nombre: "Hospital de atención general (II-1)", detalle: "Hospital con especialidades básicas." },
  "II-2": { nivel: "Segundo nivel", nombre: "Hospital de atención general (II-2)", detalle: "Hospital con más especialidades." },
  "II-E": { nivel: "Segundo nivel", nombre: "Establecimiento de atención especializada", detalle: "Atención especializada en un campo (por ejemplo, una clínica oftalmológica)." },
  "III-1": { nivel: "Tercer nivel", nombre: "Hospital de alta complejidad", detalle: "Hospital nacional o de referencia con subespecialidades." },
  "III-2": { nivel: "Tercer nivel", nombre: "Instituto especializado", detalle: "Instituto de alta especialización e investigación." },
  "III-E": { nivel: "Tercer nivel", nombre: "Establecimiento especializado de alta complejidad", detalle: "Atención especializada de tercer nivel." },
};

export type Estado = "ok" | "atencion" | "alerta" | "sin_dato" | "externo";
export interface Chequeo {
  clave: string;
  titulo: string;
  estado: Estado;
  /** La frase que se puede afirmar, con la fuente dentro. */
  detalle: string;
  /** Qué clase de hecho es (para el rótulo). */
  tipo: "registro_administrativo" | "sancion_firme" | "denuncia" | "verificacion_externa";
  fuente: string;
  url: string | null;
  /** A qué fecha corresponde lo que se afirma (AAAA-MM-DD). */
  al: string | null;
}

/** Lo mínimo de una ficha que necesita `verificar`. */
export interface DatosVerificacion {
  codigo: string;
  estado: string | null;
  activo: boolean;
  enRegistro: boolean;
  categoria: string | null;
  vistoAl: string | null;
  detalle: {
    leidoAl: string | null;
    categoria: string | null;
    categoriaDocumento: string | null;
    categoriaFecha: string | null;
    quirurgico: boolean | null;
    upssQuirurgicas: string[];
    /** Cirugías reportadas a SUSALUD en los últimos 12 meses (0 o null si ninguna). */
    cirugias12m?: number | null;
    documentos: { tipo: string | null; adjunto: boolean }[];
    responsableColegio: string | null;
    responsableColegiatura: string | null;
  } | null;
  sanciones: { total: number; ultima: string | null; cierre: boolean; judicializadas: number };
  sancionesAl: string | null;
  denuncias: { anio: number | null; denuncias: number | null; consultas: number | null };
}

const fechaLarga = (f: string | null) => {
  if (!f) return "fecha sin informar";
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  return `${d} de ${meses[m - 1]} de ${a}`;
};

/** Los chequeos de una IPRESS, en orden: registro, categoría, servicios quirúrgicos, documentos, responsable, sanciones, denuncias. */
export function verificar(v: DatosVerificacion): Chequeo[] {
  const out: Chequeo[] = [];
  const ren = "RENIPRESS (SUSALUD)";
  const urlRen = consultaRenipress(v.codigo);
  // 1. Registro.
  if (!v.enRegistro) {
    out.push({ clave: "registro", titulo: "Registro en RENIPRESS", estado: "alerta", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.vistoAl,
      detalle: `Ya no figura en el archivo de RENIPRESS. La última vez que apareció fue el ${fechaLarga(v.vistoAl)}.` });
  } else if (v.activo) {
    out.push({ clave: "registro", titulo: "Registro en RENIPRESS", estado: "ok", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.vistoAl,
      detalle: `Figura como ACTIVA en RENIPRESS (archivo revisado el ${fechaLarga(v.vistoAl)}).` });
  } else {
    const baja = /BAJA/i.test(v.estado ?? "");
    const cierre = /CIERRE/i.test(v.estado ?? "");
    out.push({ clave: "registro", titulo: "Registro en RENIPRESS", estado: baja || cierre ? "alerta" : "atencion", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.vistoAl,
      detalle: `RENIPRESS la registra en estado «${(v.estado ?? "sin estado").toLowerCase()}»${baja ? ": no debería estar atendiendo" : cierre ? ": mientras dure el cierre no debería atender" : ""} (archivo revisado el ${fechaLarga(v.vistoAl)}).` });
  }
  // 2. Categoría.
  const cat = v.detalle?.categoria ?? v.categoria;
  if (cat && CATEGORIAS[cat]) {
    const doc = v.detalle?.categoriaDocumento;
    out.push({ clave: "categoria", titulo: "Categoría", estado: "ok", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.detalle?.leidoAl ?? v.vistoAl,
      detalle: `Categoría ${cat}: ${minusculaInicial(CATEGORIAS[cat].nombre).replace(/\s*\([^)]*\)\s*$/, "")}, ${CATEGORIAS[cat].nivel.toLowerCase()}.${doc ? ` Según ${doc}${v.detalle?.categoriaFecha ? ` del ${fechaLarga(v.detalle.categoriaFecha)}` : ""}.` : ""}` });
  } else {
    out.push({ clave: "categoria", titulo: "Categoría", estado: "sin_dato", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.vistoAl,
      detalle: "RENIPRESS no registra una categoría para esta IPRESS (pasa con los servicios médicos de apoyo y muchos consultorios)." });
  }
  // 3. Servicios quirúrgicos (sólo con el detalle leído).
  if (v.detalle?.leidoAl) {
    const cir = v.detalle.cirugias12m ?? 0;
    const primerNivel = !cat || /^I-/.test(cat);
    out.push(v.detalle.quirurgico
      ? { clave: "quirurgico", titulo: "Centro quirúrgico", estado: "ok", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.detalle.leidoAl,
          detalle: v.detalle.upssQuirurgicas.length
            ? `RENIPRESS le registra la unidad ${v.detalle.upssQuirurgicas.join(", ")} activa (consultado el ${fechaLarga(v.detalle.leidoAl)}).${cir ? ` Reportó ${cir === 1 ? "una cirugía" : `${cir.toLocaleString("es-PE")} cirugías`} a SUSALUD en los últimos 12 meses.` : ""}`
            : `Reportó ${cir === 1 ? "una cirugía" : `${cir.toLocaleString("es-PE")} cirugías`} a SUSALUD en los últimos 12 meses, aunque RENIPRESS no detalla sus unidades (consultado el ${fechaLarga(v.detalle.leidoAl)}).` }
      : primerNivel
        ? { clave: "quirurgico", titulo: "Centro quirúrgico", estado: "sin_dato", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.detalle.leidoAl,
            detalle: `No tiene centro quirúrgico registrado${cat ? `: es de primer nivel (${cat}), donde no se hacen operaciones mayores` : ""}. Para una cirugía te derivan a un hospital.` }
        : { clave: "quirurgico", titulo: "Centro quirúrgico", estado: "atencion", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.detalle.leidoAl,
            detalle: `RENIPRESS no le registra una unidad de centro quirúrgico activa ni reportó cirugías en los últimos 12 meses (consultado el ${fechaLarga(v.detalle.leidoAl)}). Si te ofrecen una cirugía aquí, pregunta dónde se hará.` });
    const lic = v.detalle.documentos.filter((d) => /LICENCIA/i.test(d.tipo ?? ""));
    out.push(lic.length
      ? { clave: "licencia", titulo: "Licencia municipal declarada", estado: "ok", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.detalle.leidoAl,
          detalle: `La IPRESS declaró en RENIPRESS ${lic.length === 1 ? "una licencia municipal" : `${lic.length} licencias municipales`}${lic.some((d) => d.adjunto) ? " con el documento adjunto" : ""}. La licencia la otorga la municipalidad; SUSALUD sólo la recibe.` }
      : { clave: "licencia", titulo: "Licencia municipal declarada", estado: "sin_dato", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.detalle.leidoAl,
          detalle: "No hay una licencia municipal declarada en RENIPRESS. La licencia la da la municipalidad del distrito: pídela en el establecimiento." });
  }
  // 4. Sanciones firmes.
  const s = v.sanciones;
  if (s.total > 0) {
    out.push({ clave: "sanciones", titulo: "Sanciones firmes de SUSALUD", estado: s.cierre ? "alerta" : "atencion", tipo: "sancion_firme",
      fuente: "Registro de Sanciones (SUSALUD)", url: URL_SANCIONES, al: v.sancionesAl ?? s.ultima,
      detalle: `${s.total === 1 ? "Una sanción firme" : `${s.total} sanciones firmes`} en el Registro de Sanciones de SUSALUD; la más reciente es del ${fechaLarga(s.ultima)}.${s.cierre ? " Una de ellas es un cierre definitivo." : ""}${s.judicializadas ? ` ${s.judicializadas === 1 ? "Una está" : `${s.judicializadas} están`} en un proceso judicial según el registro.` : ""}` });
  } else {
    out.push({ clave: "sanciones", titulo: "Sanciones firmes de SUSALUD", estado: "ok", tipo: "sancion_firme", fuente: "Registro de Sanciones (SUSALUD)", url: URL_SANCIONES, al: v.sancionesAl,
      detalle: `No figura en el Registro de Sanciones de SUSALUD revisado el ${fechaLarga(v.sancionesAl)}. El registro sólo trae sanciones firmes: SUSALUD las publica al menos un año y después puede retirarlas.` });
  }
  // 5. Denuncias (no son sanciones).
  const d = v.denuncias;
  if (d.anio && (d.denuncias ?? 0) > 0) {
    out.push({ clave: "denuncias", titulo: "Denuncias ante SUSALUD", estado: "atencion", tipo: "denuncia", fuente: "Consultas y denuncias (SUSALUD, anonimizado)", url: URL_DATOS_SUSALUD, al: String(d.anio),
      detalle: `${d.anio === new Date().getFullYear() ? `En lo publicado de ${d.anio} (el año aún no termina y SUSALUD lo publica por partes)` : `En ${d.anio}`} SUSALUD recibió ${d.denuncias} ${d.denuncias === 1 ? "denuncia" : "denuncias"} sobre esta institución. Son pedidos de ciudadanos, no hechos comprobados ni sanciones.` });
  }
  // 6. Responsable (sin nombre).
  const col = v.detalle?.responsableColegiatura;
  if (v.detalle?.leidoAl) {
    out.push(col
      ? { clave: "responsable", titulo: "Responsable de la atención", estado: "externo", tipo: "verificacion_externa", fuente: ren, url: urlRen, al: v.detalle.leidoAl,
          detalle: `RENIPRESS registra como responsable a un profesional del ${tituloColegio(v.detalle.responsableColegio)} con colegiatura N.° ${col}. Su habilitación la confirma su colegio.` }
      : { clave: "responsable", titulo: "Responsable de la atención", estado: "sin_dato", tipo: "registro_administrativo", fuente: ren, url: urlRen, al: v.detalle.leidoAl,
          detalle: "RENIPRESS no trae el número de colegiatura del responsable." });
  }
  return out;
}

/** «Hospital de atención general (II-1)» → «hospital de atención general (II-1)»: sólo la inicial (la categoría queda). */
const minusculaInicial = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/**
 * «COLEGIO MEDICO DEL PERU» → «Colegio Médico del Perú». El tecnólogo va primero: «COLEGIO TECNOLOGO MEDICO DEL PERU»
 * también dice MEDICO y salía como Colegio Médico (898 responsables, revisado el 2026-11-21).
 */
export function tituloColegio(c: string | null | undefined): string {
  const t = (c ?? "").toUpperCase();
  if (/TECNOLOG/.test(t)) return "Colegio Tecnólogo Médico del Perú";
  if (/MEDICO/.test(t) && !/VETERIN/.test(t)) return "Colegio Médico del Perú";
  if (/ENFERMER/.test(t)) return "Colegio de Enfermeros del Perú";
  if (/ODONTOL/.test(t)) return "Colegio Odontológico del Perú";
  if (/OBSTETR/.test(t)) return "Colegio de Obstetras del Perú";
  if (/PSICOL/.test(t)) return "Colegio de Psicólogos del Perú";
  if (/QUIMICO|FARMAC/.test(t)) return "Colegio Químico Farmacéutico del Perú";
  if (/TECNOLOG/.test(t)) return "Colegio Tecnólogo Médico del Perú";
  if (/NUTRICION/.test(t)) return "Colegio de Nutricionistas del Perú";
  return c ? c.toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase()).replace(/ Del /g, " del ").replace(/ De /g, " de ") : "colegio profesional";
}

/** Los pasos para verificar a un médico donde sí se puede (el CMP y SUNEDU): la web y el asistente los dicen igual. */
export function pasosVerificarMedico(colegiatura?: string | null): { paso: string; detalle: string; url: string }[] {
  return [
    {
      paso: "Búscalo en «Conoce a tu médico» del CMP",
      detalle: colegiatura
        ? `Entra con una cuenta gratuita y busca por número de colegiatura: ${colegiatura}. Ahí ves si está HÁBIL, su especialidad registrada (RNE) y su recertificación.`
        : "Entra con una cuenta gratuita y busca por número de colegiatura o por apellidos y nombres. Ahí ves si está HÁBIL, su especialidad registrada (RNE) y su recertificación.",
      url: URL_CMP,
    },
    {
      paso: "Revisa que la especialidad coincida con lo que te ofrece",
      detalle: "En esa misma consulta del CMP mira su especialidad registrada (RNE) y compárala con el procedimiento que te ofrece: para una cirugía plástica o estética, que su RNE sea de cirugía plástica. Si no figura un RNE, no está registrado como especialista.",
      url: "",
    },
    {
      paso: "Confirma su título en SUNEDU",
      detalle: "En el Registro Nacional de Grados y Títulos aparece el título de médico cirujano y, si la tiene, la segunda especialidad.",
      url: URL_SUNEDU,
    },
    {
      paso: "Verifica también el establecimiento",
      detalle: "Busca aquí la clínica o el consultorio donde te atenderá: su estado en RENIPRESS, su categoría, si tiene centro quirúrgico y sus sanciones firmes.",
      url: "/establecimientos",
    },
  ];
}

/** Las instrucciones del asistente de Gobserva Salud (un ciudadano pregunta; las herramientas son las del MCP /mcp/salud). */
export function sistemaAsistenteSalud(hoy = new Date().toISOString().slice(0, 10)): string {
  return `Eres el asistente de Gobserva Salud (salud.gobserva.cloud). Ayudas a ciudadanos del Perú a verificar establecimientos de salud (IPRESS) y médicos con fuentes oficiales. Hoy es ${hoy}. Escribe en español peruano, claro y breve, de tú.

CÓMO TRABAJAS
- Antes de responder, consulta las herramientas. Nunca respondas de memoria sobre un establecimiento, una sanción o un médico.
- Para un establecimiento por su nombre: llama UNA vez a buscar_establecimiento_salud (con el distrito o la región si te los dieron). Si hay varias sedes y no sabes cuál es, pregunta cuál (di distrito y dirección de cada una). Luego llama a ficha_establecimiento_salud con su código: la ficha ya trae el estado, la categoría, los servicios, las especialidades, la cartera, los documentos declarados, las sanciones firmes, las denuncias, sus fuentes y «verificacion» (los chequeos ya redactados: úsalos). No llames a sanciones_salud para un establecimiento que ya abriste con su ficha.
- Si en la ficha «detalle» es un texto y no un objeto, el detalle de servicios aún no se leyó de RENIPRESS: dilo así («todavía no tenemos el detalle de servicios; ya lo pedimos») y da el enlace de la consulta oficial (fuentes.renipress.url). No es un error ni significa que no tenga servicios.
- Para un médico: verificar_medico con su número de colegiatura. Si sólo te dan el nombre, explica que la habilitación se confirma en «Conoce a tu médico» del Colegio Médico del Perú y ofrece los pasos; no busques personas por nombre.
- Para «¿puede hacer X?» (por ejemplo, cirugías estéticas): revisa en la ficha la unidad de centro quirúrgico, las especialidades (cirugía plástica) y la cartera de servicios; y busca la norma con normas_salud. Di exactamente qué registra RENIPRESS y qué no, y que RENIPRESS no autoriza procedimientos uno por uno.
- Para dudas de derechos o de reglas, usa normas_salud y cita la norma y el artículo.

REGLAS QUE NO SE ROMPEN
- Nunca digas que hay un problema técnico, una demora o un error si una herramienta no lo dijo. Si te falta un dato, abre la ficha.
- Sólo enlaces que te dio una herramienta (los campos «ficha», «url», «fuentes»). Ningún otro.
- No digas que un establecimiento «está autorizado» o «puede» hacer algo: di qué registra RENIPRESS («RENIPRESS le registra la unidad de centro quirúrgico activa y la especialidad de cirugía plástica») y recuerda que no autoriza procedimientos uno por uno.
- Las fuentes mensuales (recursos, cirugías) se citan por mes («octubre de 2026»), no por día.
- Cada dato con su fuente y su fecha («según RENIPRESS, consultado el …», «Registro de Sanciones de SUSALUD revisado el …»). Enlaza la ficha de Gobserva Salud (el campo «ficha» de la herramienta) y la fuente oficial que te dio la herramienta; no inventes enlaces. Las fechas, como «20 de noviembre de 2026».
- Distingue siempre: SANCIÓN FIRME (Registro de Sanciones de SUSALUD) ≠ DENUNCIA (pedido de un ciudadano, no comprobado) ≠ REGISTRO ADMINISTRATIVO (lo que la IPRESS declaró en RENIPRESS).
- Nunca digas «no tiene sanciones»: di «no figura en el Registro de Sanciones de SUSALUD revisado el …». Nunca digas que algo es seguro o peligroso. Nunca califiques a un profesional: la sanción de una clínica no es del médico que la dirige.
- Si una herramienta no trae el dato, dilo («la fuente no lo informa») y di dónde verificarlo. No completes con suposiciones.
- No pidas ni repitas datos personales (DNI, nombres de pacientes). No das consejo médico: ante una emergencia, recomienda ir a emergencias o llamar al 106 (SAMU) o al 113.

FORMATO
- Empieza con la respuesta en una o dos frases. Luego los hechos en una lista corta, cada uno con su fuente y fecha. Cierra con «Para verificar» (enlaces) cuando aplique.`;
}

/** Las herramientas del MCP de Salud que el asistente usa (todas de lectura). */
export const HERRAMIENTAS_ASISTENTE_SALUD = ["buscar_establecimiento_salud", "ficha_establecimiento_salud", "verificar_medico", "sanciones_salud", "normas_salud", "fuentes_salud"];
