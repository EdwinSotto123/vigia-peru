/**
 * El catálogo de la pestaña «Patrones» de la ficha de una entidad (API GET /patrones/entidad/:ruc): en qué familia cae
 * cada patrón, cómo se llama, qué es en una frase y qué conviene mirar. Pedido del usuario del 2026-11-18: la ficha de
 * la entidad debe decir «aquí hay patrones de concertación» y tener una ficha por cada patrón, no sólo listas filtradas.
 *
 * Dos orígenes: las listas de /app/patrones que se pueden pedir por entidad (`PATRON_LISTA`, cada una con su tabla y su
 * panel por caso) y los antecedentes de quienes ganaron sus contratos, por tipo (`casos_cruce`; su nombre y su
 * explicación salen de lib/cruces.ts, aquí sólo su familia).
 */
import { numero } from "@/lib/formato";
import type { SeccionPatrones } from "@/lib/patrones";

export type FamiliaPatron = "concertacion" | "compras" | "familia" | "impedimento" | "agentes" | "otros";

/** Las familias, en el orden en que se muestran. */
export const FAMILIAS_PATRON: { clave: FamiliaPatron; nombre: string; corto: string; explica: string }[] = [
  {
    clave: "concertacion", nombre: "Concertación y competencia aparente", corto: "Concertación",
    explica: "Empresas que parecen competir y no compiten: un mismo dueño, postores que acompañan, socias que se turnan o un solo postor.",
  },
  {
    clave: "compras", nombre: "Compras partidas, repetidas o a la medida", corto: "Compras partidas",
    explica: "Órdenes que juntas pasan el tope, la misma compra repetida, empresas recién creadas, el mismo proveedor una y otra vez y precios fuera de lo habitual.",
  },
  {
    clave: "familia", nombre: "Familia, política y trato previo", corto: "Familia y política",
    explica: "Parientes de funcionarios, gente de la entidad detrás de un proveedor, quienes financiaron al que gobierna y visitas antes de ganar.",
  },
  {
    clave: "impedimento", nombre: "Proveedores con sanción, impedimento u observación", corto: "Sanciones",
    explica: "Inhabilitados, socios de una inhabilitada, proveedores en informes de control y los que siguieron ganando tras una observación.",
  },
  {
    clave: "agentes", nombre: "Lo que leyeron los agentes en sus documentos", corto: "Sus documentos",
    explica: "Señales que salen de leer bases, actas y contratos, y que se repiten en esta entidad más que en el resto del país.",
  },
  {
    clave: "otros", nombre: "Obras y otros antecedentes de sus proveedores", corto: "Obras y otros",
    explica: "Obras paralizadas o con sobrecosto y los demás antecedentes de quienes le ganaron.",
  },
];

export interface PatronDeLista {
  familia: FamiliaPatron;
  nombre: string;
  corto: string;
  severidad: "alta" | "media";
  /** Qué es, en una frase. */
  queEs: string;
  /** Qué conviene mirar en los casos. */
  mirar: string;
  /** Nace en observación (migración 329): se muestra y todavía no puntúa. */
  observacion?: boolean;
}

/** Las listas de /app/patrones que la API puede dar por entidad. */
export const PATRON_LISTA: Partial<Record<SeccionPatrones, PatronDeLista>> = {
  duenos: {
    familia: "concertacion", nombre: "Un mismo dueño gana con varias empresas", corto: "Mismo dueño", severidad: "alta",
    queEs: "Dos o más empresas de un mismo socio ganaron en esta entidad contratos de objeto parecido.",
    mirar: "Si se presentaron al mismo proceso, compitieron entre sí sólo en apariencia. Si ganaron por separado en pocas semanas, la compra pudo repartirse.",
  },
  grupos: {
    familia: "concertacion", nombre: "Grupos de proveedores por dueño o familia", corto: "Grupos por dueño y familia", severidad: "alta",
    queEs: "Empresas y personas del mismo socio, o con los mismos apellidos poco comunes, que le venden a la entidad por órdenes: cada una sola parece pequeña.",
    mirar: "Las órdenes de números seguidos, el mismo objeto repartido entre integrantes y cuánto dependen de esta entidad.",
  },
  repetidas: {
    familia: "compras", nombre: "La misma compra repetida en pocas semanas", corto: "Compras repetidas", severidad: "media",
    queEs: "Órdenes de compra directas iguales (mismo proveedor, monto y descripción) emitidas de 7 a 90 días entre sí.",
    mirar: "Si salieron de una sola necesidad es una compra partida en el tiempo; si la entrega fue una sola, un posible pago doble.",
  },
  recien: {
    familia: "compras", nombre: "Empresas recién creadas con órdenes directas", corto: "Recién creadas", severidad: "media",
    queEs: "Empresas que se inscribieron en la SUNAT y a 90 días o menos ya recibían órdenes sin proceso de selección de esta entidad.",
    mirar: "Quién las creó y si viven de este solo cliente.",
  },
  renovaciones: {
    familia: "compras", nombre: "El mismo servicio, renovado más caro", corto: "Renovaciones más caras", severidad: "media",
    queEs: "La entidad volvió a contratar el mismo servicio y el costo por mes subió 30 % o más frente al contrato anterior.",
    mirar: "Si cambió el alcance (más personal, más sedes) o sólo el precio.",
  },
  compras: {
    familia: "familia", nombre: "Trabaja en sus compras y un familiar cobra de la entidad", corto: "Compras y familia", severidad: "alta", observacion: true,
    queEs: "Quien declara un puesto de compras, logística o contrataciones tiene un familiar declarado que recibió órdenes de la entidad, a su nombre o con su empresa.",
    mirar: "Las órdenes emitidas con la persona en el puesto, y quién las pidió y las aprobó.",
  },
  cierres: {
    familia: "familia", nombre: "Una ola de personas nuevas al cierre de la gestión", corto: "Cierre de gestión", severidad: "media", observacion: true,
    queEs: "Entre la elección de 2022 y el cambio de mando dio órdenes a muchas más personas que nunca había contratado que un año antes y que un año después.",
    mirar: "Quiénes eran esas personas, qué servicio hicieron y si tenían relación con la campaña de la gestión que se iba.",
  },
  autoridad: {
    familia: "familia", nombre: "Una autoridad suya dejó una empresa que le vende", corto: "Autoridad que dejó su empresa", severidad: "alta", observacion: true,
    queEs: "Una autoridad electa de la entidad dejó de figurar en una empresa, y esa empresa le vendió a la entidad dentro de su periodo.",
    mirar: "Cuánto tenía en la empresa y a quién pasó su parte: el impedimento sigue 12 meses después de salir.",
  },
  doble: {
    familia: "familia", nombre: "Dos ingresos del Estado", corto: "Dos ingresos", severidad: "media",
    queEs: "Personas que figuran en una planilla del Estado y recibieron órdenes de servicio de otra entidad esos mismos meses; aquí, las que tocan a esta entidad.",
    mirar: "Si es docencia, que es la excepción que la ley permite; si no, la doble percepción.",
  },
  inhabilitadas: {
    familia: "impedimento", nombre: "Le ganó la empresa del socio de una inhabilitada", corto: "Socio de inhabilitada", severidad: "alta",
    queEs: "El socio de una empresa inhabilitada por el Tribunal de Contrataciones ganó en esta entidad con otra empresa, dentro de la sanción.",
    mirar: "El porcentaje del socio en las dos empresas y si son del mismo rubro.",
  },
  control: {
    familia: "impedimento", nombre: "Socio del ganador en un informe de control", corto: "Socio en informe de control", severidad: "media",
    queEs: "Un socio o representante de una empresa que le ganó figura con responsabilidad presunta en un informe de control de la Contraloría.",
    mirar: "Si el informe es de esta misma entidad y qué observó.",
  },
  observados: {
    familia: "impedimento", nombre: "Procesos observados por la Contraloría", corto: "Observados por la Contraloría", severidad: "alta",
    queEs: "Procesos de la entidad que una observación de un informe de control nombra, y proveedores que siguieron ganando después.",
    mirar: "Qué dijo la observación y si la entidad le volvió a adjudicar al mismo proveedor.",
  },
  observacion: {
    familia: "agentes", nombre: "Indicadores en observación", corto: "En observación", severidad: "media", observacion: true,
    queEs: "Cruces nuevos que Vigía todavía mide: reuniones con quien decide durante la evaluación, ofertas presentadas a la vez o firma dentro del plazo de apelación.",
    mirar: "La evidencia de cada uno: todavía no cuentan para el puntaje.",
  },
  entidades: {
    familia: "agentes", nombre: "Señales de sus documentos que se repiten", corto: "Señales que se repiten", severidad: "media",
    queEs: "Señales que los agentes de Vigía encontraron al leer sus contratos y que aparecen en esta entidad mucho más que en el resto del país.",
    mirar: "Un contrato raro puede ser un error; muchos iguales son un modo de trabajar.",
  },
};

/**
 * Las mismas listas vistas desde una EMPRESA (API GET /patrones/empresa/:ruc): cómo se llama cada patrón en su ficha y
 * qué conviene mirar. Van arriba de su pestaña «Antecedentes».
 */
export const PATRON_EMPRESA: Partial<Record<SeccionPatrones, Pick<PatronDeLista, "familia" | "nombre" | "corto" | "severidad" | "mirar" | "observacion">>> = {
  relleno: {
    familia: "concertacion", nombre: "Postor de relleno: acompaña, o la acompañan, casi siempre", corto: "Postor de relleno", severidad: "alta",
    mirar: "Una de las dos casi nunca gana y postula sobre todo donde gana la otra. Mira si comparten socio, domicilio o representante.",
  },
  consorcios: {
    familia: "concertacion", nombre: "Compite contra quien fue su socia de consorcio", corto: "Socias que compiten", severidad: "media",
    mirar: "Postularon juntas en un consorcio y después por separado, en procesos de pocos postores que gana siempre la misma.",
  },
  duenos: {
    familia: "concertacion", nombre: "Su dueño gana con varias empresas en la misma entidad", corto: "Mismo dueño", severidad: "alta",
    mirar: "Si las empresas del mismo socio se presentaron al mismo proceso, o ganaron por separado contratos parecidos en pocas semanas.",
  },
  grupos: {
    familia: "concertacion", nombre: "Es parte de un grupo de proveedores por dueño o familia", corto: "Grupo por dueño o familia", severidad: "alta",
    mirar: "Las órdenes de números seguidos y el mismo objeto repartido entre los integrantes del grupo.",
  },
  repetidas: {
    familia: "compras", nombre: "Le repitieron la misma compra en pocas semanas", corto: "Compras repetidas", severidad: "media",
    mirar: "Si salieron de una sola necesidad es una compra partida en el tiempo; si la entrega fue una sola, un posible pago doble.",
  },
  recien: {
    familia: "compras", nombre: "Recibió órdenes directas recién creada", corto: "Recién creada", severidad: "media",
    mirar: "Quién la creó y si vive de ese solo cliente.",
  },
  renovaciones: {
    familia: "compras", nombre: "Le renovaron el mismo servicio más caro", corto: "Renovación más cara", severidad: "media",
    mirar: "Si cambió el alcance (más personal, más sedes) o sólo el precio.",
  },
  compras: {
    familia: "familia", nombre: "Un familiar de quien trabaja en las compras de un cliente figura en ella", corto: "Compras y familia", severidad: "alta", observacion: true,
    mirar: "Las órdenes emitidas con esa persona en el puesto, y quién las pidió y las aprobó.",
  },
  autoridad: {
    familia: "familia", nombre: "Una autoridad dejó de figurar en ella y le vendió a su entidad", corto: "Autoridad que la dejó", severidad: "alta", observacion: true,
    mirar: "Cuánto tenía y a quién pasó su parte: el impedimento sigue 12 meses después de salir.",
  },
  inhabilitadas: {
    familia: "impedimento", nombre: "Ella o una empresa de su socio está inhabilitada, y la otra ganó", corto: "Socio de inhabilitada", severidad: "alta",
    mirar: "El porcentaje del socio en las dos empresas y si son del mismo rubro.",
  },
  control: {
    familia: "impedimento", nombre: "Un socio o representante suyo figura en un informe de control", corto: "Socio en informe de control", severidad: "media",
    mirar: "De qué entidad es el informe y qué observó.",
  },
  observados: {
    familia: "impedimento", nombre: "Ganó procesos que la Contraloría observó", corto: "Observada por la Contraloría", severidad: "alta",
    mirar: "Qué dijo la observación y si la misma entidad le volvió a adjudicar después.",
  },
  observacion: {
    familia: "agentes", nombre: "Indicadores en observación", corto: "En observación", severidad: "media", observacion: true,
    mirar: "La evidencia de cada uno: todavía no cuentan para el puntaje.",
  },
  proveedores: {
    familia: "agentes", nombre: "Señales de sus documentos que se repiten", corto: "Señales que se repiten", severidad: "media",
    mirar: "La misma señal de los documentos en varios de sus contratos y en más de una entidad.",
  },
};

/** Tipos de antecedente que ya tienen su lista aquí: si la lista trae casos, el tipo no se repite en el índice. */
export const CRUCE_CON_LISTA: Record<string, SeccionPatrones> = {
  mismo_dueno: "duenos",
  socio_de_inhabilitada: "inhabilitadas",
  socio_con_informe_control: "control",
  renovacion_mas_cara: "renovaciones",
  observado_por_contraloria: "observados",
  gano_tras_observacion: "observados",
};

const FAMILIA_CRUCE: Record<string, FamiliaPatron> = {
  // Concertación y competencia aparente.
  socio_comun: "concertacion", ofertas_a_la_vez: "concertacion", postor_de_relleno: "concertacion", consorcio_rival: "concertacion",
  mismo_dueno: "concertacion", turno_postores: "concertacion", domicilio_compartido: "concertacion", unico_postor: "concertacion",
  otro_postor: "concertacion", empresa_espejo: "concertacion", solo_admitido_el_ganador: "concertacion",
  // Compras partidas, repetidas o a la medida.
  fraccionamiento: "compras", recurrente_dominante: "compras", recurrente_frecuente: "compras", recurrente: "compras", proveedor_cautivo: "compras",
  renovacion_mas_cara: "compras", contrato_sobre_adjudicado: "compras", retencion_sobre_tope: "compras",
  // Familia, política y trato previo.
  partido_gobernante: "familia", vendio_gobernante: "familia", aporte: "familia", aporte_empresa: "familia", proveedor_campana: "familia",
  candidato: "familia", autoridad: "familia", socio_en_entidad: "familia", interes_declarado: "familia", pariente_funcionario: "familia",
  puerta_giratoria: "familia", empleo_declarado: "familia", reunion_en_evaluacion: "familia", visita_personal_decisor: "familia",
  trabajo_en_el_ganador: "familia", comite_mismo_ganador: "familia",
  // Sanción, impedimento u observación.
  socio_de_inhabilitada: "impedimento", comite_socio_proveedor: "impedimento", penalidad: "impedimento", dada_de_baja: "impedimento", suspendida: "impedimento", no_habida: "impedimento",
  observado_por_contraloria: "impedimento", gano_tras_observacion: "impedimento", socio_con_informe_control: "impedimento",
  // Sus documentos.
  firma_en_plazo_de_apelacion: "agentes",
};

// ─── El índice por familias (ficha de entidad y de empresa) ──────────────────────

/**
 * La pestaña Antecedentes de una empresa: su subpestaña (`?apv=antecedentes|patrones`) y el patrón elegido (`?apat=`).
 * Aquí y no en el componente (de cliente): una constante de un módulo «use client» no llega como texto al servidor.
 */
export const P_SUB_ANTECEDENTES = "apv";
export const P_PATRON_EMPRESA = "apat";

/** Lo que el índice necesita saber de cada entrada (un patrón o un tipo de antecedente) para agruparla y contarla. */
export interface EntradaConFamilia {
  clave: string;
  familia: FamiliaPatron;
  severidad: "alta" | "media" | "baja";
  /** Sus casos (contratos, órdenes, grupos, veces). */
  n: number;
  /** De esos casos, cuántos son de señal alta, si se sabe caso por caso (los antecedentes). */
  graves?: number;
}

/**
 * Una familia con casos, como la dibuja el reparto de arriba del índice (`RepartoFamilias`): cuántos casos, qué parte de
 * ellos es grave y cuál de sus entradas abre al tocarla. `serie` es su color: su lugar entre las familias presentes, el
 * mismo en el reparto, en el rótulo del índice y en las barras de sus entradas.
 */
export interface FamiliaConCasos {
  clave: FamiliaPatron;
  corto: string;
  nombre: string;
  explica: string;
  serie: number;
  /** Cuántas entradas del índice son de esta familia. */
  entradas: number;
  casos: number;
  /** La línea de gravedad («2 patrones, todos graves», «523 de señal alta») y la severidad más alta de sus entradas (el ícono). */
  gravedad: string;
  peor: "alta" | "media" | "baja";
  /** Sus entradas, en el orden del índice: la primera abre al tocar la familia; con ellas se sabe si la elegida es suya. */
  claves: string[];
}

const ORDEN_FAMILIA = new Map(FAMILIAS_PATRON.map((f, i) => [f.clave, i]));
const PESO_SEVERIDAD = { alta: 0, media: 1, baja: 2 } as const;

/** Por familia (en su orden), lo grave primero y, dentro, lo que más casos tiene. */
export function ordenarPorFamilia<T extends EntradaConFamilia>(entradas: T[]): T[] {
  return [...entradas].sort(
    (a, b) => ORDEN_FAMILIA.get(a.familia)! - ORDEN_FAMILIA.get(b.familia)! || PESO_SEVERIDAD[a.severidad] - PESO_SEVERIDAD[b.severidad] || b.n - a.n,
  );
}

/**
 * Las entradas como las lee el índice (`IndiceAntecedentes`): por familia, con el nombre de su familia como rótulo
 * (`grupo`) y su color (`serie`), sin lo que el índice no usa.
 */
export function indicePorFamilia<T extends EntradaConFamilia>(entradas: T[]): (Omit<T, "familia" | "graves"> & { grupo?: string; serie?: number })[] {
  const series = seriesDeFamilias(entradas);
  return ordenarPorFamilia(entradas).map(({ familia, graves: _graves, ...resto }) => ({
    ...resto,
    grupo: FAMILIAS_PATRON.find((f) => f.clave === familia)?.nombre,
    serie: series.get(familia),
  }));
}

/** El color de cada familia presente: su lugar entre las presentes (hasta seis, como las series de los gráficos). */
export function seriesDeFamilias(entradas: EntradaConFamilia[]): Map<FamiliaPatron, number> {
  const presentes = FAMILIAS_PATRON.filter((f) => entradas.some((e) => e.familia === f.clave));
  return new Map(presentes.map((f, i) => [f.clave, i]));
}

/**
 * Las familias con entradas, en su orden. `por` dice cómo se cuenta lo grave: en los patrones, cuántos de ellos son de
 * señal alta (sus casos no traen severidad acá); en los antecedentes, cuántos casos lo son.
 */
export function familiasDeEntradas(
  entradas: EntradaConFamilia[],
  por: { uno: string; varios: string; casoAcaso: boolean },
): FamiliaConCasos[] {
  const series = seriesDeFamilias(entradas);
  return FAMILIAS_PATRON.flatMap((f) => {
    const suyas = ordenarPorFamilia(entradas.filter((e) => e.familia === f.clave));
    if (!suyas.length) return [];
    const casos = suyas.reduce((s, e) => s + e.n, 0);
    let gravedad: string;
    if (por.casoAcaso) {
      const g = suyas.reduce((s, e) => s + (e.graves ?? 0), 0);
      gravedad = g > 0 ? `${numero(g)} de señal alta` : "ninguno de señal alta";
    } else {
      const g = suyas.filter((e) => e.severidad === "alta").length;
      const n = suyas.length;
      const cuantos = `${numero(n)} ${n === 1 ? por.uno : por.varios}`;
      gravedad = g === 0 ? `${cuantos}, ninguno grave` : g === n ? (n === 1 ? `${cuantos}, grave` : `${cuantos}, todos graves`) : `${cuantos}, ${numero(g)} ${g === 1 ? "grave" : "graves"}`;
    }
    return [{ clave: f.clave, corto: f.corto, nombre: f.nombre, explica: f.explica, serie: series.get(f.clave) ?? 0, entradas: suyas.length, casos, gravedad, peor: suyas[0].severidad, claves: suyas.map((e) => e.clave) }];
  });
}

/**
 * La primera oración de una explicación larga, si es corta (la bajada de una ficha: una línea, ≤ 140 caracteres); el resto
 * va en su ⓘ. Corta en el primer punto seguido de espacio y mayúscula (no en «S.A.» ni en «art. 11»).
 */
export function primeraOracion(texto: string | undefined | null, max = 140): string | null {
  if (!texto) return null;
  const m = texto.match(/^(.+?[.!?])\s+(?=[A-ZÁÉÍÓÚÑ«(])/);
  const primera = (m ? m[1] : texto).trim();
  return primera.length <= max ? primera : null;
}

/** La familia de un tipo de antecedente de sus contratos: la del catálogo o, si es nuevo, la que diga su nombre. */
export function familiaDeCruce(tipo: string): FamiliaPatron {
  const f = FAMILIA_CRUCE[tipo];
  if (f) return f;
  if (/^(sancion|inhabilit)/.test(tipo)) return "impedimento";
  if (/^visita/.test(tipo)) return "familia";
  if (/^(recien_fundada|adicional|sobreprecio)/.test(tipo)) return "compras";
  if (/^(acta_|consultas_|bases_)/.test(tipo)) return "agentes";
  return "otros";
}
