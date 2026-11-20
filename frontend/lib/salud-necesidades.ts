/**
 * Lo que una persona necesita, dicho con sus palabras («dientes», «embarazo», «rayos X»), y cómo lo nombra RENIPRESS
 * («Odontología», «Centro obstétrico», «Diagnóstico por imágenes»). Lo usan la ficha («¿Te pueden atender aquí?») y
 * «Estoy en un establecimiento» (los cercanos que lo declararon: la API recibe los `terminos`). Sin JSX.
 *
 * Un término es el comienzo de una palabra en el nombre normalizado (sin tildes, en mayúsculas): «PARTO» encuentra
 * «Atención de parto vaginal» y no «Departamento». Que una IPRESS lo haya declarado en RENIPRESS no garantiza que hoy
 * haya cupo o un especialista de turno; que no lo haya declarado no prueba que no lo atienda. Las dos cosas se dicen.
 */

export interface Necesidad {
  clave: string;
  /** El botón: corto, como lo diría cualquiera. */
  etiqueta: string;
  /** Cómo lo llama la medicina, para la respuesta: «odontología». */
  tecnico: string;
  /** Lo que alguien podría escribir (normalizado): si lo escrito contiene una, es esta necesidad. */
  palabras: string[];
  /** El comienzo de palabra que se busca en los nombres de RENIPRESS (normalizado). */
  terminos: string[];
  /** Entre los botones de la ficha y de «cerca de ti». */
  rapida?: boolean;
}

export const NECESIDADES: Necesidad[] = [
  { clave: "emergencia", etiqueta: "Emergencia", tecnico: "emergencia", rapida: true,
    palabras: ["EMERGENCIA", "URGENCIA", "ACCIDENTE"], terminos: ["EMERGENCIA", "URGENCIA", "SHOCK TRAUMA"] },
  { clave: "dientes", etiqueta: "Dientes", tecnico: "odontología", rapida: true,
    palabras: ["DIENTE", "MUELA", "DENTIST", "ODONTOLOG", "CARIES", "ORTODONC", "BRACKET", "ENCIA"], terminos: ["ODONTOLOG", "DENTIST", "DENTAL", "ESTOMATOLOG", "ORTODONC", "ENDODONC", "PERIODONC", "CIRUJANO DENTISTA"] },
  { clave: "parto", etiqueta: "Embarazo y parto", tecnico: "obstetricia", rapida: true,
    palabras: ["EMBARAZ", "PARTO", "GESTANTE", "PRENATAL", "OBSTETR", "CESAREA", "DAR A LUZ"], terminos: ["OBSTETR", "PARTO", "PRENATAL", "GESTANTE", "MATERNO", "CENTRO OBSTETRICO"] },
  { clave: "ninos", etiqueta: "Niños", tecnico: "pediatría", rapida: true,
    palabras: ["NINO", "NINA", "BEBE", "HIJO", "PEDIATR", "RECIEN NACIDO", "INFANT"], terminos: ["PEDIATR", "NEONATOLOG", "RECIEN NACIDO", "CRED", "NINO"] },
  { clave: "mujer", etiqueta: "Ginecología", tecnico: "ginecología",
    palabras: ["GINECOLOG", "PAPANICOLAOU", "MUJER", "MENSTRUA", "MAMA "], terminos: ["GINECOLOG", "PAPANICOLAOU", "MAMOGRAF"] },
  { clave: "ojos", etiqueta: "Ojos", tecnico: "oftalmología", rapida: true,
    palabras: ["OJO", "VISTA", "OFTALMOLOG", "OCULIST", "LENTES", "CATARATA", "OPTOMETR"], terminos: ["OFTALMOLOG", "OPTOMETR", "CATARATA"] },
  { clave: "piel", etiqueta: "Piel", tecnico: "dermatología", rapida: true,
    palabras: ["PIEL", "DERMATOLOG", "ACNE", "MANCHA", "LUNAR"], terminos: ["DERMATOLOG"] },
  { clave: "corazon", etiqueta: "Corazón", tecnico: "cardiología", rapida: true,
    palabras: ["CORAZON", "CARDIOLOG", "PRESION", "HIPERTENS", "INFARTO"], terminos: ["CARDIOLOG", "CARDIOVASCULAR", "HEMODINAMIA"] },
  { clave: "huesos", etiqueta: "Huesos y fracturas", tecnico: "traumatología", rapida: true,
    palabras: ["HUESO", "FRACTUR", "TRAUMATOLOG", "ESGUINCE", "RODILLA", "COLUMNA", "ESPALDA"], terminos: ["TRAUMATOLOG", "ORTOPED"] },
  { clave: "mental", etiqueta: "Salud mental", tecnico: "psicología o psiquiatría", rapida: true,
    palabras: ["PSICOLOG", "PSIQUIATR", "SALUD MENTAL", "DEPRESION", "ANSIEDAD", "ADICCION"], terminos: ["PSICOLOG", "PSIQUIATR", "SALUD MENTAL"] },
  { clave: "analisis", etiqueta: "Análisis de laboratorio", tecnico: "laboratorio clínico", rapida: true,
    palabras: ["ANALISIS", "LABORATORIO", "SANGRE", "ORINA", "EXAMEN", "MUESTRA", "PRUEBA"], terminos: ["LABORATORIO", "PATOLOGIA CLINICA", "TOMA DE MUESTRA", "PRUEBAS RAPIDAS"] },
  { clave: "imagenes", etiqueta: "Rayos X y ecografía", tecnico: "diagnóstico por imágenes", rapida: true,
    palabras: ["RAYOS", "RADIOGRAF", "ECOGRAF", "TOMOGRAF", "RESONANCIA", "MAMOGRAF", "IMAGEN"], terminos: ["DIAGNOSTICO POR IMAGENES", "RADIOLOG", "RADIOGRAF", "ECOGRAF", "TOMOGRAF", "RESONANCIA", "MAMOGRAF"] },
  { clave: "vacunas", etiqueta: "Vacunas", tecnico: "inmunizaciones",
    palabras: ["VACUN", "INMUNIZ"], terminos: ["VACUN", "INMUNIZACION"] },
  { clave: "operacion", etiqueta: "Una operación", tecnico: "cirugía", rapida: true,
    palabras: ["OPERA", "CIRUGIA", "CIRUJANO", "QUIROFANO", "INTERVENCION"], terminos: ["CENTRO QUIRURGICO", "INTERVENCIONES QUIRURGICAS", "CIRUGIA GENERAL", "CIRUGIA AMBULATORIA"] },
  { clave: "estetica", etiqueta: "Cirugía estética", tecnico: "cirugía plástica",
    palabras: ["ESTETIC", "PLASTICA", "LIPOSUC", "RINOPLAST", "IMPLANTE MAMARIO", "BOTOX"], terminos: ["CIRUGIA PLASTICA", "ESTETIC", "REPARADORA"] },
  { clave: "rehabilitacion", etiqueta: "Terapia física", tecnico: "medicina de rehabilitación",
    palabras: ["TERAPIA FISICA", "REHABILITA", "FISIOTERAP", "TERAPIA"], terminos: ["REHABILITACION", "MEDICINA FISICA", "TERAPIA FISICA", "FISIOTERAP"] },
  { clave: "rinon", etiqueta: "Riñón y diálisis", tecnico: "nefrología y diálisis",
    palabras: ["RINON", "DIALISIS", "NEFROLOG"], terminos: ["NEFROLOG", "DIALISIS", "HEMODIALISIS"] },
  { clave: "cancer", etiqueta: "Cáncer", tecnico: "oncología",
    palabras: ["CANCER", "ONCOLOG", "TUMOR", "QUIMIO", "RADIOTERAP"], terminos: ["ONCOLOG", "CANCER", "QUIMIOTERAP", "RADIOTERAP"] },
  { clave: "estomago", etiqueta: "Estómago", tecnico: "gastroenterología",
    palabras: ["ESTOMAGO", "GASTRO", "ENDOSCOP", "COLON", "HIGADO"], terminos: ["GASTROENTEROLOG", "ENDOSCOP"] },
  { clave: "oido", etiqueta: "Oído, nariz y garganta", tecnico: "otorrinolaringología",
    palabras: ["OIDO", "NARIZ", "GARGANTA", "OTORRINO", "SORDERA"], terminos: ["OTORRINOLARINGOLOG", "AUDIOLOG"] },
  { clave: "diabetes", etiqueta: "Diabetes y tiroides", tecnico: "endocrinología",
    palabras: ["DIABETES", "TIROIDES", "ENDOCRINO", "AZUCAR"], terminos: ["ENDOCRINOLOG"] },
  { clave: "pulmones", etiqueta: "Pulmones y asma", tecnico: "neumología",
    palabras: ["PULMON", "ASMA", "NEUMOLOG", "RESPIRA", "TOS"], terminos: ["NEUMOLOG"] },
  { clave: "nervios", etiqueta: "Cerebro y nervios", tecnico: "neurología",
    palabras: ["CEREBRO", "NERVIO", "NEUROLOG", "MIGRANA", "CONVULSION", "DERRAME"], terminos: ["NEUROLOG", "NEUROCIRUG"] },
  { clave: "urologia", etiqueta: "Próstata y vías urinarias", tecnico: "urología",
    palabras: ["PROSTATA", "UROLOG", "VEJIGA", "URINARI"], terminos: ["UROLOG"] },
  { clave: "mayores", etiqueta: "Adultos mayores", tecnico: "geriatría",
    palabras: ["ADULTO MAYOR", "ANCIANO", "GERIATR", "ABUELO"], terminos: ["GERIATR"] },
  { clave: "nutricion", etiqueta: "Nutrición", tecnico: "nutrición",
    palabras: ["NUTRICION", "DIETA", "PESO", "OBESIDAD"], terminos: ["NUTRICION"] },
  { clave: "general", etiqueta: "Medicina general", tecnico: "medicina general",
    palabras: ["MEDICINA GENERAL", "MEDICO GENERAL", "CONSULTA", "CHEQUEO", "FIEBRE", "GRIPE", "DOLOR"], terminos: ["MEDICINA GENERAL", "MEDICO CIRUJANO", "MEDICO GENERAL"] },
];

export const NECESIDADES_RAPIDAS = NECESIDADES.filter((n) => n.rapida);
export const necesidadDe = (clave: string | null | undefined) => NECESIDADES.find((n) => n.clave === clave) ?? null;

/** Sin tildes, en mayúsculas, sólo letras, números y espacios: como se compara todo aquí. */
export function normalizarTexto(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VACIAS = new Set(["PARA", "COMO", "TIENE", "TIENEN", "ATIENDEN", "ATIENDE", "AQUI", "PUEDO", "PUEDEN", "HACER", "HACEN", "ESTE", "ESTA", "SERVICIO", "ATENCION", "QUIERO", "NECESITO", "TRATAR", "TRATAN", "CONSULTA"]);

/** La raíz de una palabra escrita: «cardiólogo» y «cardiología» → «CARDIOLOG»; «dermatólogos» → «DERMATOLOG». */
function raiz(p: string): string {
  if (/OLOG(O|A|IA|OS|AS)$/.test(p)) return p.replace(/(O|A|IA|OS|AS)$/, "");
  if (p.length >= 7) return p.slice(0, -2);
  if (p.length >= 5) return p.slice(0, -1);
  return p;
}

/**
 * Lo escrito → las necesidades que nombra y los términos que se buscan: los de esas necesidades y, además, la raíz de
 * cada palabra larga (alguien que escribe «dermatología» o «hemodiálisis» encuentra eso aunque no haya botón).
 */
export function terminosDe(texto: string): { necesidades: Necesidad[]; terminos: string[] } {
  const q = ` ${normalizarTexto(texto)} `;
  if (q.trim().length < 3) return { necesidades: [], terminos: [] };
  const necesidades = NECESIDADES.filter((n) => n.palabras.some((p) => q.includes(` ${p}`) || q.includes(p)));
  const terminos = new Set(necesidades.flatMap((n) => n.terminos));
  for (const p of q.trim().split(" ")) if (p.length >= 5 && !VACIAS.has(p)) terminos.add(raiz(p));
  return { necesidades, terminos: [...terminos].slice(0, 16) };
}

/** ¿El nombre (normalizado) tiene alguna palabra que empiece con alguno de los términos? */
export function coincide(nombreNormalizado: string, terminos: string[]): boolean {
  const n = ` ${nombreNormalizado}`;
  return terminos.some((t) => n.includes(` ${t}`));
}
