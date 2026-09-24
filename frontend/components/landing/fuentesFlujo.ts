/**
 * Lo que el mapa de fuentes de la portada (ExploradorFuentes) cuenta de cada
 * fuente y de cada resultado, en palabras de quien no programa.
 *
 * Acá va SÓLO lo que se pinta: este módulo viaja al navegador. El detalle
 * técnico (campos crudos, el código que limpia cada fuente, la tabla donde
 * queda, el horario exacto y las notas de lo que todavía no funciona) está en
 * `fuentesFlujoTecnico.ts`, con la misma `clave`, para quien quiera verificar.
 *
 * Cada dato dice lo que pasa HOY, verificado contra el código el 24 de
 * setiembre de 2026:
 *  - `alimenta` sale de quién lee cada tabla (reglas, cruces de personas,
 *    paneles). Una fuente que nadie lee va con `alimenta: []`: su camino es
 *    punteado y su ficha dice "Servirá para".
 *  - `frecuencia` y `agenda` cuentan cómo llega lo que SÍ usan las revisiones.
 *    Si eso se carga a mano, dice "a mano", aunque haya un job automático que
 *    baje otra cosa (sancionados, JNE, visitas: ver `fuentesFlujoTecnico.ts`).
 *  - `estado: "caida"` apaga la "próxima vez": no se promete una descarga que
 *    hoy falla.
 */

export type Agenda =
  | { tipo: "diaria"; hora: number; minuto: number }
  | { tipo: "semanal"; diaSemana: number; hora: number } // 0 = domingo
  | { tipo: "mensual"; dias: number[]; hora: number }
  | { tipo: "a_mano" };

/** Si la descarga funciona y si alguien la usa. Las notas de cada caso, en `fuentesFlujoTecnico.ts`. */
export type Estado = "en_uso" | "sin_cruce" | "caida";

/** Lo que Vigía termina produciendo. Sólo lo que el código genera y la app muestra. */
export type ResultadoClave = "contratos" | "entidades" | "proveedores" | "personas" | "relaciones" | "senales" | "informe";

export interface Resultado {
  clave: ResultadoClave;
  nombre: string;
  que: string;
  donde: { texto: string; href: string };
}

export interface FuenteFlujo {
  clave: string;
  /** Lo que se lee en el nodo. */
  corto: string;
  /** La página pública de la fuente, verificada. Sin ella, se muestra `lugar`. */
  url?: string;
  /** Dónde está, en palabras, cuando no hay un enlace público que dar. */
  lugar?: string;
  aporta: string;
  agenda: Agenda;
  estado: Estado;
  sirve: string;
  /**
   * Los resultados a los que llega, verificados contra quién lee su tabla:
   * reglas en `backend/agent/tools/compliance_rules/*`, cruces de personas en
   * `backend/agent/tools/personas/*`, paneles del front. Vacío = nadie la lee.
   */
  alimenta: ResultadoClave[];
  /** Lo que ve el visitante: en qué llega el dato, dicho sin jerga. */
  llegaComo: string;
  /** El formato en una o dos palabras, para las fichas de los resultados. */
  formato: "En línea" | "Excel" | "CSV" | "Varios";
  /** Cada cuánto, en palabras. */
  frecuencia: string;
  /** Qué se toma de la fuente, traducido de los campos que lee el código. */
  tomamos: string[];
}

export const FUENTES_FLUJO: FuenteFlujo[] = [
  {
    clave: "seace",
    corto: "SEACE / OECE",
    url: "https://contratacionesabiertas.oece.gob.pe/",
    aporta: "Cada contrato que el Estado publica: entidad, monto, fechas, postores y sus documentos. De aquí sale todo lo que ves en el mapa.",
    agenda: { tipo: "diaria", hora: 1, minuto: 30 },
    estado: "en_uso",
    sirve: "saber qué contratos existen, dónde y por cuánto, y leer sus documentos.",
    alimenta: ["contratos", "entidades", "proveedores", "personas", "senales", "informe"],
    llegaComo: "Datos en línea (formato abierto OCDS) y documentos en PDF",
    formato: "En línea",
    frecuencia: "Cada noche",
    tomamos: ["Qué entidad compra", "Qué compra y por cuánto", "Fechas del proceso", "Quién se presentó y quién ganó", "Bases, actas y contrato"],
  },
  {
    clave: "rnp",
    corto: "Socios RNP",
    // No está en datos abiertos: no hay una página pública que enlazar.
    lugar: "Registro Nacional de Proveedores (OECE)",
    aporta: "Quiénes son los socios, representantes legales y directivos de cada proveedor del Estado.",
    agenda: { tipo: "a_mano" },
    estado: "en_uso",
    sirve: "saber quién está detrás de cada empresa que se presenta a un contrato.",
    alimenta: ["proveedores", "personas", "relaciones", "senales", "informe"],
    // 1,44 millones de filas: no cabe en una hoja de Excel.
    llegaComo: "Un archivo CSV muy grande, de más de un millón de filas",
    formato: "CSV",
    frecuencia: "Se descarga a mano",
    tomamos: ["Socios de cada empresa", "Representantes legales", "Directivos", "Desde cuándo lo son"],
  },
  {
    clave: "sancionados",
    corto: "Sancionados",
    // Lo que usa la regla es la exportación del buscador del OECE, cargada a
    // mano; el job semanal de datos abiertos no llega a ella.
    url: "https://apps.osce.gob.pe/perfilprov-ui/",
    aporta: "Quién está inhabilitado para contratar con el Estado, desde cuándo y hasta cuándo.",
    agenda: { tipo: "a_mano" },
    estado: "en_uso",
    sirve: "avisar si quien ganó, o un socio suyo, tenía prohibido contratar con el Estado.",
    alimenta: ["senales", "informe"],
    llegaComo: "Un archivo Excel",
    formato: "Excel",
    frecuencia: "Se descarga a mano",
    tomamos: ["Empresa o persona sancionada", "Por qué infracción", "Desde y hasta cuándo", "Número de resolución"],
  },
  {
    clave: "visitas",
    corto: "Visitas",
    url: "https://visitas.servicios.gob.pe/consultas",
    aporta: "Quién entró a qué entidad pública, a ver a qué funcionario y por cuánto tiempo.",
    // Casi todo llega a mano: la descarga automática sólo trae a Loreto, y una
    // fecha "próxima" se leería como si valiera para todas las entidades.
    agenda: { tipo: "a_mano" },
    estado: "en_uso",
    sirve: "avisar si alguien ligado a una empresa visitó la entidad antes del concurso.",
    alimenta: ["personas", "relaciones", "senales", "informe"],
    llegaComo: "Archivos Excel",
    formato: "Excel",
    frecuencia: "Se descarga a mano. Las del Gobierno Regional de Loreto llegan solas los días 1 y 15 de cada mes.",
    tomamos: ["Quién visitó", "A qué funcionario", "En qué entidad", "Qué día y cuánto duró"],
  },
  {
    clave: "onpe",
    corto: "Aportes ONPE",
    url: "https://claridadportal.onpe.gob.pe/",
    aporta: "Quién financió a qué partido, cuánto y cuándo.",
    agenda: { tipo: "a_mano" },
    estado: "en_uso",
    sirve: "avisar si quien ganó, o un socio suyo, aportó a la campaña de la autoridad que contrata.",
    alimenta: ["personas", "relaciones", "senales", "informe"],
    llegaComo: "Datos en línea, consultados desde un navegador",
    formato: "En línea",
    frecuencia: "A mano, una vez al mes (cada semana en campaña)",
    tomamos: ["Quién aportó", "A qué partido", "Cuánto", "Cuándo"],
  },
  {
    clave: "jne",
    corto: "Candidatos y electos JNE",
    // Los agentes leen las candidaturas de Infogob, cargadas a mano; la tabla
    // del job mensual no la lee nadie.
    url: "https://infogob.jne.gob.pe/",
    aporta: "Quién postuló en cada elección y quién salió electo: en qué cargo, dónde y por qué partido.",
    agenda: { tipo: "a_mano" },
    estado: "en_uso",
    sirve: "reconocer a una autoridad, o a quien postuló, si aparece detrás de una empresa.",
    alimenta: ["personas", "relaciones", "senales", "informe"],
    llegaComo: "Archivos Excel, uno por elección",
    formato: "Excel",
    frecuencia: "Se descarga a mano",
    tomamos: ["Quién postuló", "Quién salió electo", "En qué cargo y dónde", "Por qué partido y en qué elección"],
  },
  {
    clave: "dji",
    corto: "Declaraciones de intereses",
    url: "https://www.datosabiertos.gob.pe/dataset/declaraciones-juradas-de-intereses-presentadas-ante-la-contralor%C3%ADa",
    aporta: "Dónde trabajó antes cada funcionario, según lo que él mismo declaró.",
    agenda: { tipo: "mensual", dias: [5], hora: 8 },
    estado: "caida",
    sirve: "detectar la puerta giratoria: un funcionario que antes trabajó en la empresa que hoy gana.",
    alimenta: [],
    // 1,8 millones de declaraciones y 2,7 millones de empleos previos.
    llegaComo: "Archivos CSV muy grandes, de millones de filas",
    formato: "CSV",
    frecuencia: "Por ahora no se actualiza",
    tomamos: ["Funcionario", "Entidad y cargo", "Empresas donde trabajó antes"],
  },
  {
    clave: "mef",
    corto: "Presupuesto MEF",
    url: "https://datosabiertos.mef.gob.pe/",
    aporta: "Cuánto tiene asignado cada región y cuánto ejecutó, por sector, pliego y programa.",
    agenda: { tipo: "mensual", dias: [12], hora: 8 },
    estado: "caida",
    sirve: "mostrar cuánto presupuesto tiene cada región y entidad, y cuánto gastó.",
    alimenta: ["entidades"],
    llegaComo: "Datos en línea",
    formato: "En línea",
    frecuencia: "Por ahora no se actualiza",
    tomamos: ["Presupuesto asignado", "Cuánto se gastó", "Por sector, pliego y programa"],
  },
  {
    clave: "datasets-oece",
    corto: "Datasets OECE",
    // Son siete conjuntos: el enlace es la búsqueda que los lista a todos.
    url: "https://www.datosabiertos.gob.pe/search/type/dataset?query=contrataciones%20p%C3%BAblicas%20eficientes",
    aporta: "Ofertantes, consorcios, profesionales certificados, pronunciamientos, cuadernos y valorizaciones de obra.",
    agenda: { tipo: "mensual", dias: [1], hora: 9 },
    estado: "sin_cruce",
    sirve: "cruzar consorcios, ofertantes y obras.",
    alimenta: [],
    llegaComo: "Archivos Excel, CSV y ZIP",
    formato: "Varios",
    frecuencia: "El día 1 de cada mes",
    tomamos: ["Ofertantes", "Consorcios", "Pronunciamientos", "Cuadernos y valorizaciones de obra"],
  },
];

export const RESULTADOS: Resultado[] = [
  {
    clave: "contratos",
    nombre: "Contratos públicos",
    que: "Cada proceso con su entidad, su monto, su etapa y sus documentos, ubicado en su distrito.",
    donde: { texto: "Ver los contratos", href: "/app/contratos" },
  },
  {
    clave: "entidades",
    nombre: "Entidades y presupuesto",
    que: "Quién compra, dónde está, cuánto presupuesto tiene y cuánto ejecutó.",
    donde: { texto: "Ver las entidades", href: "/app/entidades" },
  },
  {
    clave: "proveedores",
    nombre: "Proveedores",
    que: "Quién se presentó, quién ganó y quiénes son sus socios y representantes.",
    donde: { texto: "En el informe de cada contrato", href: "/app/auditoria" },
  },
  {
    clave: "personas",
    nombre: "Personas",
    que: "Socios, representantes, firmantes, autoridades, aportantes y visitantes que aparecen alrededor de un contrato. Sus datos personales se muestran difuminados.",
    donde: { texto: "En el informe de cada contrato", href: "/app/auditoria" },
  },
  {
    clave: "relaciones",
    nombre: "Relaciones",
    que: "Quién está conectado con quién: el socio de un postor que aportó al partido de la autoridad, o que visitó la entidad antes de la convocatoria.",
    donde: { texto: "En el grafo de cada informe", href: "/app/auditoria" },
  },
  {
    clave: "senales",
    nombre: "Señales de riesgo",
    que: "Alertas con su evidencia: proveedor inhabilitado, postor único, fraccionamiento, postores que comparten socios, visitas antes de la convocatoria, aportes a la campaña de la autoridad.",
    donde: { texto: "Ver las señales", href: "/app/alertas" },
  },
  {
    clave: "informe",
    nombre: "Informe de cada contrato",
    que: "Todo lo anterior junto, con el artículo de la ley y la página del documento que sostiene cada señal. Si Vigía no está seguro, lo revisa una persona antes de publicarlo.",
    donde: { texto: "Ver los informes", href: "/app/auditoria" },
  },
];

export interface Norma {
  /** Lo que se cita: el número de la ley o quién la emite. */
  sigla: string;
  nombre: string;
  aporta: string;
  url?: string;
}

export const NORMA: Norma[] = [
  { sigla: "Ley 32069", nombre: "Normas vigentes", aporta: "La ley, su reglamento y las bases estándar." },
  { sigla: "Ley 30225", nombre: "Normas históricas", aporta: "La ley anterior y su reglamento: un contrato de 2023 se juzga con la ley de 2023." },
  { sigla: "OECE", nombre: "Criterios vinculantes", aporta: "Acuerdos de Sala Plena y opiniones de su Dirección Técnico Normativa." },
  { sigla: "Contraloría", nombre: "Control", aporta: "Las directivas de control que la Contraloría publica.", url: "https://apps.contraloria.gob.pe/ciudadano/" },
];
