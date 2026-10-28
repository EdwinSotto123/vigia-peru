/**
 * Glosario: cada término técnico que Vigía muestra, explicado en lenguaje llano para una persona común. Un solo lugar
 * donde vive la definición, para no explicarlo de cinco formas distintas (molde: lib/datoDudoso.ts). Se usa con el
 * componente <AyudaTermino clave="pim" />, que lo cuelga de un ⓘ junto al dato. `termino` se redacta para que lea
 * bien tras «¿Qué es »; `definicion` son 1-2 frases simples; `fuente` es opcional (de dónde sale el dato).
 */
export interface TerminoGlosario {
  termino: string;
  definicion: string;
  fuente?: string;
}

export const GLOSARIO: Record<string, TerminoGlosario> = {
  // ── Contratación y compras del Estado ──────────────────────────────────────
  "orden-servicio": {
    termino: "una orden de servicio",
    definicion: "Una compra directa de un trabajo a una persona, sin concurso ni otros postores. La entidad la emite y la paga; suele ser por montos menores.",
  },
  "locacion": {
    termino: "la locación de servicios",
    definicion: "Trabajar para el Estado por órdenes de servicio, como independiente: sin sueldo fijo, sin vacaciones ni seguro, y sin haber ganado un concurso. A esa persona se le llama «locador».",
  },
  "cas": {
    termino: "un CAS",
    definicion: "Contrato Administrativo de Servicios: un contrato temporal con el Estado, ganado por concurso público, con menos beneficios que un puesto de planta.",
  },
  "planilla": {
    termino: "una planilla",
    definicion: "La lista oficial del personal de una entidad, con el sueldo de cada persona.",
  },
  "regimen": {
    termino: "el régimen",
    definicion: "El tipo de contrato de un servidor público: CAS (temporal por concurso), 276 (nombrado de carrera, estable), 728 (régimen laboral privado), y modalidades especiales como PAC, FAG, PNUD o Ley Servir.",
  },
  "proceso-seleccion": {
    termino: "un proceso de selección",
    definicion: "El concurso formal, con bases y ofertas, para elegir al proveedor. Por debajo de cierto monto se puede comprar sin él, con una orden directa.",
  },
  "convocatoria": {
    termino: "una convocatoria",
    definicion: "El llamado público para que las empresas presenten ofertas por un contrato del Estado.",
  },
  "contrato-menor": {
    termino: "un contrato menor",
    definicion: "Una compra del Estado por un monto pequeño (hasta 8 UIT, unos S/ 42,800 en 2026). Por ley no necesita concurso ni proceso de selección: la entidad contrata de forma directa.",
  },
  "cotizacion": {
    termino: "una cotización",
    definicion: "La oferta de precio que un proveedor presenta para una compra menor. Como no hay concurso formal, la entidad invita a cotizar y compara precios durante una ventana de días.",
  },
  "adjudicacion": {
    termino: "una adjudicación",
    definicion: "Declarar ganadora a una empresa (darle la buena pro). El «monto adjudicado» es lo que se decidió pagarle.",
  },
  "buena-pro": {
    termino: "la buena pro",
    definicion: "La decisión oficial que declara ganadora a una empresa en un proceso de selección.",
  },
  "participante": {
    termino: "un participante",
    definicion: "Una empresa o persona que se registró en un proceso de selección para poder ofertar. Registrarse no es competir: muchas se registran y no presentan oferta. Las que sí ofertan son los postores.",
    fuente: "registro OCDS del OECE (los llama «tenderers»)",
  },
  "postor": {
    termino: "un postor",
    definicion: "Una empresa o persona que presentó una oferta en un proceso de selección. No es lo mismo que un participante, que solo se registró para poder ofertar.",
    fuente: "CONOSCE (OECE)",
  },
  "unico-postor": {
    termino: "un único postor",
    definicion: "Cuando solo una empresa presentó oferta: no hubo competencia real, aunque se hayan registrado varias.",
  },
  "consentimiento": {
    termino: "el consentimiento de la buena pro",
    definicion: "El momento en que la buena pro queda firme: pasó el plazo para apelarla, o se resolvió la apelación. Desde ahí la entidad y el ganador firman el contrato.",
  },
  "valor-referencial": {
    termino: "el valor referencial",
    definicion: "El precio que la entidad calculó que costaría antes de contratar. El monto adjudicado es lo que de verdad se decidió pagar.",
  },
  "uit": {
    termino: "la UIT",
    definicion: "Unidad Impositiva Tributaria: un monto de referencia que el Estado fija cada año (ronda los S/ 5,000). Se usa como tope en muchos trámites; por ejemplo, «hasta 8 UIT» son unos S/ 41,000.",
  },
  "cubso": {
    termino: "el CUBSO",
    definicion: "El catálogo con que el Estado le pone un código a cada bien o servicio, para poder comparar el mismo producto entre entidades.",
  },
  "cui": {
    termino: "el CUI",
    definicion: "Código Único de Inversión: el número que identifica un proyecto de obra pública.",
  },
  "fraccionamiento": {
    termino: "el fraccionamiento",
    definicion: "Partir una compra grande en varias órdenes chicas para no tener que hacer un concurso.",
  },
  // ── Fuentes y organismos ───────────────────────────────────────────────────
  "oece": {
    termino: "el OECE",
    definicion: "El OECE (antes OSCE) es el organismo del Estado que supervisa las compras públicas y sanciona a los proveedores que incumplen.",
  },
  "conosce": {
    termino: "CONOSCE",
    definicion: "La base de datos abierta del OECE donde se publica cada orden y contrato del Estado.",
  },
  "seace": {
    termino: "el SEACE",
    definicion: "El portal público donde el Estado anuncia sus concursos (convocatorias) y publica los documentos de cada compra.",
  },
  "servir": {
    termino: "SERVIR",
    definicion: "La autoridad nacional del empleo público. «Talento Perú» es su plataforma, donde las entidades publican sus convocatorias CAS.",
  },
  "pte": {
    termino: "el Portal de Transparencia",
    definicion: "El Portal de Transparencia Estándar: la web donde, por ley, cada entidad publica a su personal y lo que le paga cada mes.",
  },
  "rnp": {
    termino: "el RNP",
    definicion: "Registro Nacional de Proveedores: el registro oficial de las empresas habilitadas para venderle al Estado, con sus socios y representantes.",
  },
  "ocid": {
    termino: "el OCID",
    definicion: "El código único que el estándar internacional de datos abiertos le da a un proceso de contratación, para poder seguirlo entre sistemas.",
  },
  "ocds": {
    termino: "el OCDS",
    definicion: "Estándar de Datos de Contrataciones Abiertas: el formato internacional en que se publican los datos de las compras públicas.",
  },
  "tribunal-contrataciones": {
    termino: "el Tribunal de Contrataciones",
    definicion: "El tribunal del OECE que sanciona a los proveedores que incumplen, con multas o con inhabilitación para contratar con el Estado.",
  },
  "inhabilitacion": {
    termino: "una inhabilitación",
    definicion: "Un castigo del Tribunal que le prohíbe a una persona o empresa contratar con el Estado por un tiempo (temporal) o para siempre (definitiva).",
  },
  // ── Presupuesto (MEF) ──────────────────────────────────────────────────────
  "pim": {
    termino: "el PIM",
    definicion: "La plata que una entidad tiene para gastar este año, ya con los ajustes hechos durante el año (Presupuesto Institucional Modificado).",
  },
  "pia": {
    termino: "el PIA",
    definicion: "El presupuesto que se aprobó al empezar el año, antes de cualquier cambio (Presupuesto Institucional de Apertura).",
  },
  "compromiso-presupuestal": {
    termino: "el compromiso presupuestal",
    definicion: "El momento en que la entidad aparta la plata de su presupuesto para esta compra: se compromete a gastarla. Va antes del pago; que esté comprometida no significa que ya se pagó.",
  },
  "devengado": {
    termino: "el devengado",
    definicion: "El gasto que la entidad ya dio por comprometido (reconoció que lo debe pagar). No es lo mismo que ya pagado.",
  },
  "girado": {
    termino: "el girado",
    definicion: "La plata que la entidad ya pagó de verdad, que salió de caja.",
  },
  "pliego": {
    termino: "un pliego",
    definicion: "Una entidad con presupuesto propio asignado por ley: un ministerio, un gobierno regional, una universidad pública.",
  },
  "unidad-ejecutora": {
    termino: "una unidad ejecutora",
    definicion: "La oficina concreta que ejecuta el gasto dentro de un pliego, por ejemplo una dirección regional de salud.",
  },
  "opd": {
    termino: "un organismo público descentralizado (OPD)",
    definicion: "Una entidad que depende de una municipalidad o de un gobierno regional pero maneja su propio presupuesto, como el SAT de Lima o el Parque de las Leyendas. El MEF publica su gasto aparte del resto del Estado.",
    fuente: "MEF, Datos Abiertos (gasto de los OPD)",
  },
  "ete": {
    termino: "una empresa municipal (ETE)",
    definicion: "Una empresa de una o varias municipalidades, como las EPS de agua potable. El MEF la llama «entidad de tratamiento empresarial» y publica su presupuesto aparte, con un solo monto ejecutado que la empresa reporta cada mes o cada trimestre: no lo separa en devengado y girado.",
    fuente: "MEF, Datos Abiertos (gasto de las ETE)",
  },
  "sector": {
    termino: "un sector",
    definicion: "El área de gobierno a la que pertenece una entidad: Salud, Educación, Defensa, Interior, etc.",
  },
  "autonomo": {
    termino: "un organismo autónomo",
    definicion: "Un organismo que no recibe órdenes del Poder Ejecutivo: la Contraloría, el JNE, el Ministerio Público, el Poder Judicial, el Congreso, entre otros.",
  },
  // ── Poder y análisis ───────────────────────────────────────────────────────
  "captura": {
    termino: "la captura",
    definicion: "Un indicio de que un partido que gobierna una entidad le da contratos a empresas cercanas: que le financiaron la campaña, que le vendieron, o que comparten un socio. Es para revisar, no una acusación.",
  },
  "puerta-giratoria": {
    termino: "la puerta giratoria",
    definicion: "Cuando alguien pasa de un cargo público a una empresa que contrata con ese mismo Estado, o al revés.",
  },
  "aga": {
    termino: "la AGA",
    definicion: "La Autoridad de la Gestión Administrativa: el cargo que, por ley, aprueba las contrataciones de la entidad (suele ser la gerencia u oficina de administración).",
  },
  "rof": {
    termino: "el ROF",
    definicion: "El Reglamento de Organización y Funciones: la norma de cada entidad que dice qué oficinas tiene, qué hace cada una y de quién depende. Se publica en El Peruano.",
  },
  "titular": {
    termino: "la titular de la entidad",
    definicion: "La máxima autoridad de la entidad (el gobernador, el alcalde, el ministro, el jefe del organismo): responde por ella y firma lo que decide.",
  },
  "mediana": {
    termino: "la mediana",
    definicion: "El valor del medio: la mitad de los casos está por debajo y la mitad por encima. Se usa en vez del promedio porque un caso extremo no la distorsiona.",
  },
  "severidad": {
    termino: "la severidad",
    definicion: "Cuánto pesa una señal para priorizar la revisión: alta, media o baja. No mide qué tan probable es la corrupción, solo qué tan urgente es mirarla.",
  },
  // ── Obras e inversiones (INFOBRAS e Invierte.pe) ───────────────────────────
  "infobras": {
    termino: "INFOBRAS",
    definicion: "El sistema de la Contraloría donde cada entidad registra sus obras públicas: quién las construye y quién las supervisa, cuánto cuestan, cuánto avanzan cada mes y si se paralizaron. Lo llena la propia entidad, que está obligada a mantenerlo al día.",
    fuente: "Contraloría General de la República, INFOBRAS",
  },
  "invierte-pe": {
    termino: "Invierte.pe",
    definicion: "El sistema del MEF donde se registra cada proyecto de inversión pública (una pista, un colegio, un sistema de agua): cuánto se aprobó, cuánto cuesta hoy y cuánto se gastó.",
    fuente: "MEF, Datos Abiertos (Banco de Inversiones)",
  },
  "monto-viable": {
    termino: "el monto viable",
    definicion: "Lo que se calculó que costaría una inversión cuando se aprobó (cuando se «declaró viable»). Es el punto de partida para ver cuánto se encareció después.",
  },
  "costo-actualizado": {
    termino: "el costo actualizado",
    definicion: "Lo que cuesta hoy una inversión, con los cambios que tuvo desde que se aprobó: el expediente técnico, los adicionales, los mayores costos.",
  },
  "expediente-tecnico": {
    termino: "el expediente técnico",
    definicion: "El proyecto detallado de una obra (planos, presupuesto, plazos y especificaciones) que la entidad aprueba antes de contratarla o construirla.",
  },
  "avance-fisico": {
    termino: "el avance físico",
    definicion: "Cuánto de la obra está construido, en porcentaje. Se compara con lo que debía llevar a esa fecha (el avance programado): la diferencia, en puntos, es el atraso.",
  },
  "avance-financiero": {
    termino: "la ejecución financiera",
    definicion: "Cuánto de la obra ya se pagó, en porcentaje de su costo. Si va muy por encima del avance físico, se pagó más de lo que está construido.",
  },
  "paralizacion-obra": {
    termino: "una obra paralizada",
    definicion: "Una obra que se detuvo antes de terminar: por falta de pago o de presupuesto, un problema con el contratista, el clima, un arbitraje… INFOBRAS dice desde cuándo y por qué.",
  },
  "adicional-obra": {
    termino: "un adicional de obra",
    definicion: "Un trabajo extra que se agrega a una obra ya contratada y que se paga aparte. La ley permite adicionales hasta el 15 % del contrato (restando los deductivos) con la sola aprobación de la entidad; por encima, hace falta la autorización previa de la Contraloría.",
  },
  "deductivo-obra": {
    termino: "un deductivo de obra",
    definicion: "Una parte de la obra que se quita del contrato y se descuenta de lo que se paga.",
  },
  "ampliacion-plazo": {
    termino: "una ampliación de plazo",
    definicion: "Más días que la entidad le da a la obra para terminar, por atrasos que no son culpa del contratista o que se aprueban por otros motivos. Muchas ampliaciones suelen venir con más costos.",
  },
  "controversia-obra": {
    termino: "una controversia en una obra",
    definicion: "Un desacuerdo entre la entidad y el contratista (por pagos, plazos, adicionales) que se lleva a un arbitraje, que es un juicio privado, o a una conciliación. El laudo es la decisión de los árbitros.",
  },
  "supervision-obra": {
    termino: "la supervisión de obra",
    definicion: "Quien vigila la obra por encargo de la entidad (una empresa o un profesional): controla que se construya como dice el expediente técnico y revisa lo que se cobra cada mes.",
  },
  "administracion-directa": {
    termino: "la administración directa",
    definicion: "Cuando la entidad construye la obra con su propio personal y compra ella misma los materiales, sin contratar a una empresa.",
  },
  "informe-control": {
    termino: "un informe de control",
    definicion: "Un informe en que la Contraloría revisa a una entidad o a una obra y señala riesgos, problemas o una responsabilidad presunta de sus funcionarios. No es una condena.",
  },
  "control-concurrente": {
    termino: "el control concurrente",
    definicion: "La revisión que hace la Contraloría mientras la obra se ejecuta, y no al final, para avisar a tiempo de los problemas. La ley la exige en las inversiones grandes: tenerla no es una mala señal.",
  },
};

/** Devuelve el término si la clave existe (para usos que lo necesiten en lógica). */
export const termino = (clave: string): TerminoGlosario | null => GLOSARIO[clave] ?? null;
