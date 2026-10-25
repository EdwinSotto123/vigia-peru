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
  "adjudicacion": {
    termino: "una adjudicación",
    definicion: "Declarar ganadora a una empresa (darle la buena pro). El «monto adjudicado» es lo que se decidió pagarle.",
  },
  "buena-pro": {
    termino: "la buena pro",
    definicion: "La decisión oficial que declara ganadora a una empresa en un proceso de selección.",
  },
  "postor": {
    termino: "un postor",
    definicion: "Una empresa que se presentó a competir por un contrato del Estado.",
  },
  "unico-postor": {
    termino: "un único postor",
    definicion: "Cuando solo una empresa se presentó a competir: no hubo competencia real.",
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
  "mediana": {
    termino: "la mediana",
    definicion: "El valor del medio: la mitad de los casos está por debajo y la mitad por encima. Se usa en vez del promedio porque un caso extremo no la distorsiona.",
  },
  "severidad": {
    termino: "la severidad",
    definicion: "Cuánto pesa una señal para priorizar la revisión: alta, media o baja. No mide qué tan probable es la corrupción, solo qué tan urgente es mirarla.",
  },
};

/** Devuelve el término si la clave existe (para usos que lo necesiten en lógica). */
export const termino = (clave: string): TerminoGlosario | null => GLOSARIO[clave] ?? null;
