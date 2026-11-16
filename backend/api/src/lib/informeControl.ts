/**
 * El informe de indicios en formato de control (2026-11-16, pedido del dueño: «crear un AGENTE que cree ese tipo de
 * documentos [los informes de la Contraloría] para las banderas»). Para un contrato con señales, un documento con la
 * forma de la Ficha Resumen y del informe de control de la Contraloría General de la República:
 *
 *   I. Información general   II. Alcance y fuentes   III. Resultados: una observación por hecho (sumilla, condición,
 *   criterio, efecto, causa, evidencia y precedentes)   IV. Conclusión   V. Recomendaciones   Anexo: fuentes.
 *
 * Quién pone qué:
 *   · el CÓDIGO (este módulo y routes/informeControl.ts): los datos del proceso, las cifras, las fechas, los enlaces, las
 *     normas (buscar_norma a la fecha de la convocatoria) y los precedentes (buscar_informe_control); también junta las
 *     señales que son el mismo hecho (`agrupar`: una observación por tema) y las ordena por gravedad;
 *   · el MODELO (lib/redactorControl.ts, modelos abiertos por vigia-llm): sólo el texto de cada observación (sumilla,
 *     condición, efecto, causa y cuáles de las normas y precedentes que se le dan vienen al caso), con la evidencia que se
 *     le pasa. Toda cifra, fecha, código o RUC de su texto se busca en esa evidencia y la oración que no la tiene se quita
 *     (`revisarTexto`); si no queda texto, va el que arma el código con los mismos datos (`condicionDeRespaldo`).
 *
 * No es un informe de la Contraloría ni atribuye responsabilidades: son indicios. Las personas no se nombran (el modelo
 * no recibe ningún nombre de persona); las empresas sí, por su razón social y su RUC 20.
 */
import { ETIQUETA_CRUCE } from "./cruces.js";
import { CONOSCE_BUSCADOR, fichaProveedorOece, procesoOece } from "./fuentes.js";
import { etiquetaRegla } from "./reglas.js";

/** Cambia cuando cambian las instrucciones o la forma del documento: los guardados con otra versión se rehacen. */
export const VERSION_REDACTOR = "control-1";
export const WEB = "https://vigia.gobserva.cloud";
export const TITULO_DOCUMENTO = "Informe de indicios en formato de control";
export const ELABORADO_POR = "Vigía by Gobserva con datos públicos (no es un informe de la Contraloría General de la República)";
export const CAUSA_NO_DETERMINADA = "No determinada con datos públicos.";
/** Observaciones que se desarrollan como mucho; las demás señales van en una lista aparte. */
export const MAX_OBSERVACIONES = 10;

export type Severidad = "alta" | "media" | "baja";
export type Regimen = "32069" | "30225";
type Fila = Record<string, any>;

// ─── Temas: qué señales son el mismo hecho ───────────────────────────────────────────────────────────────────────────

interface Tema {
  /** La sumilla cuando no hay texto del modelo. */
  titulo: string;
  /** Desempate entre observaciones de la misma gravedad (lo más cercano a la legalidad del proceso, primero). */
  orden: number;
  /**
   * A qué fecha se busca la norma: la de la convocatoria (lo que rige el procedimiento y su contrato) o la del HECHO,
   * cuando es otro acto de la Entidad con su propia fecha (las órdenes del fraccionamiento de 2023 se rigen por la ley de
   * 2023, aunque este proceso sea de 2026).
   */
  momento?: "hecho";
  /** Contexto, no observación: la prensa no es un registro oficial; va con las otras señales, sin desarrollar. */
  contexto?: true;
  /** Preguntas a buscar_norma por régimen (las del conjunto de evaluación del RAG normativo, backend/rag/evalset.jsonl). */
  normas: Record<Regimen, string[]>;
  /** Para buscar observaciones parecidas en los informes de la Contraloría. */
  control: string;
  /** El efecto y la recomendación cuando no hay texto del modelo. */
  efecto: string;
  recomendacion: string;
  miembros: string[];
}

const PRINCIPIOS: Record<Regimen, string> = {
  "32069": "principios de la contratación pública: libertad de concurrencia, igualdad de trato, transparencia, competencia, integridad, valor por dinero",
  "30225": "principios que rigen las contrataciones: libertad de concurrencia, igualdad de trato, transparencia, publicidad, competencia",
};
const IMPEDIMENTOS: Record<Regimen, string> = {
  "32069": "¿quiénes están impedidos de ser participantes, postores o contratistas: funcionarios, parientes hasta el segundo grado, empresas vinculadas?",
  "30225": "impedimentos para contratar con el Estado de funcionarios, ex funcionarios y sus parientes",
};
const CALIFICACION: Record<Regimen, string> = {
  "32069": "requisitos de calificación admisibles: capacidad legal, técnica, experiencia del postor; no se pueden exigir requisitos no previstos",
  "30225": "requisitos de calificación que pueden exigirse en las bases: capacidad legal, capacidad técnica y profesional, experiencia",
};

export const TEMAS: Record<string, Tema> = {
  inhabilitacion: {
    titulo: "Contratista con sanciones del Tribunal de Contrataciones del Estado",
    orden: 1,
    normas: {
      "32069": ["sanciones a proveedores: inhabilitación temporal, inhabilitación definitiva y multa por infracciones", IMPEDIMENTOS["32069"]],
      "30225": ["infracciones y sanciones a proveedores: inhabilitación temporal y definitiva, multa, presentación de documentos falsos", IMPEDIMENTOS["30225"]],
    },
    control: "contratista con inhabilitación o sanción del Tribunal de Contrataciones del Estado que obtuvo la buena pro o suscribió el contrato",
    efecto: "Contratar con un proveedor sancionado por el Tribunal de Contrataciones del Estado elevaría el riesgo de incumplimiento y, si la sanción estaba vigente, el contrato podría estar afectado por un impedimento para contratar con el Estado.",
    recomendacion: "Verificar con el Tribunal de Contrataciones del Estado y el Registro Nacional de Proveedores si, a la fecha de la oferta y de la suscripción del contrato, el contratista tenía una sanción vigente que le impidiera contratar con el Estado.",
    miembros: ["sancion", "sancion_definitiva", "sancion_temporal", "sancion_multa", "sancion_vigente", "proveedor_sancionado_osce", "sancion_vigente_oece", "sancion_historica_oece"],
  },
  vinculo_inhabilitada: {
    titulo: "Contratista vinculado con una empresa inhabilitada para contratar con el Estado",
    orden: 2,
    normas: {
      "32069": ["impedimento de las personas jurídicas cuyos socios, accionistas o representantes integran una persona jurídica inhabilitada para contratar", IMPEDIMENTOS["32069"]],
      "30225": ["impedimento de personas jurídicas cuyos integrantes forman parte de personas jurídicas sancionadas con inhabilitación", IMPEDIMENTOS["30225"]],
    },
    control: "empresa cuyos socios o representantes integran otra empresa inhabilitada por el Tribunal de Contrataciones, que obtuvo la buena pro estando impedida",
    efecto: "La vinculación societaria con una empresa inhabilitada constituiría un indicio de que el contratista podría haber estado impedido de contratar con el Estado, lo que afectaría la validez del contrato.",
    recomendacion: "Requerir a la Entidad la documentación societaria presentada por el contratista y verificar en el Registro Nacional de Proveedores si sus socios o representantes integraban una persona jurídica inhabilitada a la fecha de la oferta.",
    miembros: ["socio_de_inhabilitada", "empresa_espejo"],
  },
  conflicto_interes: {
    titulo: "Posible conflicto de intereses entre servidores de la Entidad y el contratista",
    orden: 3,
    normas: {
      "32069": [IMPEDIMENTOS["32069"], "conflicto de intereses y declaración jurada de intereses de los funcionarios que intervienen en la contratación"],
      "30225": [IMPEDIMENTOS["30225"], "impedimentos para integrar un comité de selección: titular, funcionarios con atribuciones de control, área usuaria"],
    },
    control: "conflicto de intereses: servidor o funcionario de la entidad vinculado por parentesco o por sociedad con el contratista",
    efecto: "El vínculo entre servidores de la Entidad y el contratista constituiría un indicio de conflicto de intereses que podría afectar la imparcialidad del procedimiento.",
    recomendacion: "Requerir a la Entidad las declaraciones juradas de intereses de los servidores que intervinieron en el procedimiento y verificar si alguno estaba impedido o debía abstenerse.",
    miembros: [
      "socio_en_entidad", "interes_declarado", "empleo_declarado", "pariente_funcionario", "puerta_giratoria", "conflicto_interes_funcionario_empresa",
      "firmante_con_empresa_rnp", "firmante_vinculado_ganador", "personal_clave_vinculado", "red_personas_vinculada", "vinculo_red_personas",
      "persona_contratada_senales", "conflicto_interes_socio_postores",
    ],
  },
  bases: {
    titulo: "Requisitos o factores de evaluación que restringirían la competencia",
    orden: 4,
    normas: {
      "32069": [
        PRINCIPIOS["32069"], "factores de evaluación de las ofertas: cuáles se pueden establecer en las bases y cómo se asigna el puntaje",
        "prohibición de hacer referencia a marcas, fabricación o procedencia en el requerimiento salvo estandarización", CALIFICACION["32069"],
      ],
      "30225": [
        PRINCIPIOS["30225"], "factores de evaluación de las ofertas y su ponderación en las bases",
        "el requerimiento no puede hacer referencia a marca o tipo de producto determinado salvo estandarización", CALIFICACION["30225"],
      ],
    },
    control: "bases con requisitos de calificación, factores de evaluación o especificaciones técnicas que direccionan el procedimiento a un postor o a una marca y restringen la competencia",
    efecto: "Los hechos descritos constituirían un indicio de restricción de la libre concurrencia y de la competencia, con el riesgo de que la Entidad no obtenga la oferta de mejor valor por dinero.",
    recomendacion: "Requerir a la Entidad el requerimiento del área usuaria, la indagación de mercado y el sustento técnico de los requisitos y factores de evaluación cuestionados en el pliego de absolución de consultas y observaciones.",
    miembros: ["red_flag_documental", "spec_restrictiva", "consultas_denuncia_direccionamiento", "consultas_observaciones_a_requisitos_rechazadas", "bases_marca_sin_equivalente", "bases_experiencia_alta"],
  },
  evaluacion: {
    titulo: "Evaluación y calificación de las ofertas",
    orden: 5,
    normas: {
      "32069": ["subsanación de ofertas: qué defectos se pueden subsanar sin alterar el precio ni el contenido esencial", "admisión, evaluación y calificación de ofertas y otorgamiento de la buena pro"],
      "30225": ["subsanación de ofertas: errores materiales o formales que pueden corregirse sin modificar la oferta", "admisión, evaluación y calificación de ofertas y otorgamiento de la buena pro"],
    },
    control: "comité de selección que descalificó postores por formalidades subsanables o no otorgó la buena pro a la oferta más económica",
    efecto: "La exclusión de ofertas descrita constituiría un indicio de que la evaluación pudo restringir la competencia y llevar a la Entidad a pagar un precio mayor.",
    recomendacion: "Requerir el acta de admisión, evaluación y calificación y los informes que sustentan la exclusión de las ofertas, y verificar si los defectos señalados eran subsanables.",
    miembros: ["oferta_mas_barata_no_gana", "acta_oferta_mas_baja_descartada", "acta_solo_queda_el_ganador", "acta_descalificados_por_formalidad", "otro_postor", "ganador_no_invitado", "fecha_buena_pro_incoherente"],
  },
  competencia: {
    titulo: "Competencia limitada en el procedimiento",
    orden: 6,
    normas: {
      "32069": ["otorgamiento de la buena pro cuando se presenta una sola oferta y evaluación económica de la oferta", "interacción con el mercado e indagación de mercado antes de convocar: fuentes y determinación de la cuantía"],
      "30225": ["valor referencial y valor estimado: cómo se determinan y límites de las ofertas respecto al valor referencial", "declaratoria de desierto cuando no queda ninguna oferta válida y reglas de la segunda convocatoria"],
    },
    control: "procedimiento con un solo postor u oferta única adjudicada por un monto igual o cercano al valor referencial",
    efecto: "La falta de competencia constituiría un indicio de que el precio adjudicado podría no reflejar las condiciones del mercado.",
    recomendacion: "Requerir la indagación de mercado y la determinación del valor estimado, y evaluar las causas de la escasa participación de postores.",
    miembros: ["unico_postor", "unico_postor_alto", "unica_oferta_valida", "-unica_oferta_valida", "oferta_igual_valor_referencial", "-oferta_igual_valor_referencial"],
  },
  postores_vinculados: {
    titulo: "Postores vinculados entre sí",
    orden: 7,
    normas: {
      "32069": [PRINCIPIOS["32069"], "infracciones de los proveedores: presentar ofertas concertadas, información inexacta o documentos falsos"],
      "30225": [PRINCIPIOS["30225"], "infracciones y sanciones a proveedores: presentación de información inexacta y concertación de ofertas"],
    },
    control: "postores vinculados por socios, representantes o domicilio común que presentaron ofertas en el mismo procedimiento de selección",
    efecto: "La vinculación entre postores constituiría un indicio de una competencia aparente, que podría afectar la determinación del precio y la selección del contratista.",
    recomendacion: "Requerir las ofertas presentadas y la documentación societaria de los postores, y evaluar la comunicación al INDECOPI si se confirma una posible concertación.",
    miembros: [
      "socio_comun", "domicilio_compartido", "postores_vinculados_rnp", "ofertas_agrupadas", "postor_de_relleno", "turno_postores", "consorcio_rival",
      "postores_coordinados_mismo_titular", "lazos_entre_postores_mismo_titular", "lazo_entre_postores_mismo_titular", "colusion_lazos_entre_postores",
      "postor_simultaneo_integrante_ganador",
    ],
  },
  precio: {
    titulo: "Precio por encima de las referencias de otras compras del Estado",
    orden: 8,
    normas: {
      "32069": ["interacción con el mercado e indagación de mercado antes de convocar: fuentes y determinación de la cuantía", PRINCIPIOS["32069"]],
      "30225": ["valor referencial y valor estimado: cómo se determinan y límites de las ofertas respecto al valor referencial", PRINCIPIOS["30225"]],
    },
    control: "valor referencial sobrevalorado y precios adjudicados por encima de los del mercado por una indagación de mercado deficiente",
    efecto: "Un precio por encima de las referencias constituiría un indicio de posible perjuicio económico para la Entidad, que debe confirmarse con la indagación de mercado del procedimiento.",
    recomendacion: "Requerir la indagación de mercado que sustentó el valor estimado y compararla con los precios pagados por otras entidades por el mismo bien o servicio.",
    miembros: ["sobreprecio", "sobreprecio_alto", "sobreprecio_extremo", "sobreprecio_elevado", "sobreprecio_muy_elevado", "sobreprecio_lote_elevado", "sobreprecio_lote_muy_elevado", "renovacion_mas_cara", "costo_mensual_salto"],
  },
  fraccionamiento: {
    titulo: "Posible fraccionamiento de contrataciones",
    orden: 9,
    momento: "hecho",
    normas: {
      "32069": ["¿Qué supuestos constituyen fraccionamiento prohibido de una contratación y cuáles no se consideran fraccionamiento?", "contratos menores iguales o inferiores a 8 UIT: reglas y registro"],
      "30225": ["prohibición de fraccionar la contratación de bienes, servicios u obras para evitar el tipo de procedimiento de selección que corresponde"],
    },
    control: "fraccionamiento de contrataciones en órdenes de compra o de servicio menores a ocho UIT emitidas al mismo proveedor",
    efecto: "Las órdenes emitidas el mismo día al mismo proveedor constituirían un indicio de fraccionamiento, que evitaría el procedimiento de selección que correspondía por el monto.",
    recomendacion: "Requerir a la Entidad el detalle y el sustento de las órdenes de compra o de servicio emitidas al proveedor en las fechas señaladas, y verificar si debieron agruparse en un procedimiento de selección.",
    miembros: ["fraccionamiento"],
  },
  red_societaria: {
    titulo: "Empresas con los mismos socios que contratan con la Entidad",
    orden: 10,
    normas: { "32069": [PRINCIPIOS["32069"], IMPEDIMENTOS["32069"]], "30225": [PRINCIPIOS["30225"], IMPEDIMENTOS["30225"]] },
    control: "empresas vinculadas por los mismos socios o representantes que obtienen contratos de la misma entidad",
    efecto: "La presencia de empresas con los mismos socios constituiría un indicio de concentración de contratos en un mismo grupo económico, que podría afectar la competencia.",
    recomendacion: "Requerir la documentación societaria de las empresas vinculadas y evaluar si compitieron entre sí o se repartieron las contrataciones de la Entidad.",
    miembros: ["mismo_dueno", "testaferro_multi_ruc"],
  },
  ejecucion: {
    titulo: "Modificaciones y garantías en la ejecución del contrato",
    orden: 11,
    normas: {
      "32069": ["prestaciones adicionales en bienes y servicios: porcentaje máximo y aprobación", "garantía de fiel cumplimiento: porcentaje del monto del contrato y excepciones"],
      "30225": ["adicionales y reducciones de prestaciones en bienes y servicios hasta el 25 % del monto del contrato original", "garantía de fiel cumplimiento del diez por ciento del monto del contrato original y su vigencia"],
    },
    control: "prestaciones adicionales, ampliaciones o garantías de fiel cumplimiento aprobadas sin sustento en la ejecución del contrato",
    efecto: "Las modificaciones descritas constituirían un indicio de riesgo en la ejecución contractual y podrían incrementar el costo del contrato para la Entidad.",
    recomendacion: "Requerir los informes técnicos y las resoluciones que aprobaron las modificaciones del contrato y verificar que respeten los límites y condiciones de la normativa.",
    miembros: ["adicional", "adicional_alto", "adicional_sobre_tope", "adicional_acumulado", "contrato_sobre_adjudicado", "retencion_sobre_tope"],
  },
  obra: {
    titulo: "Ejecución de la obra o de la inversión",
    orden: 12,
    normas: {
      "32069": ["límite porcentual de las prestaciones adicionales de obra y autorización previa de la Contraloría", "causales y procedimiento de ampliación del plazo contractual", "registro de las valorizaciones de obra en el SEACE: plazo y responsable"],
      "30225": ["prestaciones adicionales de obra hasta el 15 % y entre 15 % y 50 % con autorización previa de la Contraloría General", "ampliación del plazo contractual por atrasos no imputables al contratista y plazo para solicitarla"],
    },
    control: "obra paralizada o con atraso, adicionales de obra y valorizaciones pagadas por encima del avance físico",
    efecto: "La situación de la obra descrita constituiría un indicio de riesgo de incumplimiento de metas y de pagos sin la contraprestación ejecutada.",
    recomendacion: "Evaluar la pertinencia de un control concurrente o posterior sobre la ejecución de la obra, revisando valorizaciones, adicionales, ampliaciones de plazo y el cuaderno de obra.",
    miembros: [
      "obra_paralizada_larga", "obra_paralizada", "obra_paralizacion", "obra_atraso_grave", "obra_atraso", "obra_pagado_sin_avance", "obra_pago_adelantado",
      "obra_adicionales_sobre_tope", "obra_adicionales_altos", "obra_adicionales", "obra_plazo_duplicado", "obra_plazo_ampliado", "obra_controversia",
      "obra_informe_control", "inversion_sobrecosto_extremo", "inversion_sobrecosto", "inversion_laudo", "supervision_obra_paralizada", "supervision_avance_rezagado",
    ],
  },
  procedimiento: {
    titulo: "Elección del procedimiento de selección y sus plazos",
    orden: 13,
    normas: {
      "32069": ["¿qué procedimientos de selección competitivos existen y a qué cuantía corresponde cada uno?", "¿cuáles son los supuestos de contratación sujetos a procedimiento no competitivo (contratación directa) y cómo se aprueban?", "¿plazo mínimo entre la convocatoria y la presentación de ofertas en licitación pública?"],
      "30225": ["tipos de procedimientos de selección según el monto: licitación pública, concurso público, adjudicación simplificada, comparación de precios, subasta", "causales de contratación directa: emergencia, desabastecimiento, proveedor único, servicios personalísimos, secreto militar"],
    },
    control: "procedimiento de selección que no correspondía al monto, contratación directa sin sustento o plazos menores a los mínimos",
    efecto: "La elección del procedimiento o de sus plazos constituiría un indicio de que la contratación pudo sustraerse de la competencia que exigía su cuantía.",
    recomendacion: "Requerir el expediente de contratación con la determinación de la cuantía y, de ser el caso, los informes técnico y legal que sustentaron la contratación directa.",
    miembros: ["tipo_proceso_vs_monto", "plazo_convocatoria_minimo", "procedimiento_no_competitivo", "directa_sin_fundamento", "directa_causal_imprecisa", "directa_emergencia_sin_acto_resolutivo", "directa_recurrente", "cuantia_al_limite_del_tope"],
  },
  empresa_nueva: {
    titulo: "Contratista de reciente constitución",
    orden: 14,
    normas: {
      "32069": [CALIFICACION["32069"], "requisitos para ser proveedor del Estado e inscripción en el Registro Nacional de Proveedores (RNP)"],
      "30225": [CALIFICACION["30225"], "obligatoriedad de inscripción vigente en el RNP para participar en procedimientos de selección"],
    },
    control: "contratista de reciente creación sin experiencia previa que obtuvo la buena pro de un contrato de monto elevado",
    efecto: "La reciente constitución del contratista constituiría un indicio de riesgo sobre su capacidad para ejecutar el contrato y sobre la acreditación de la experiencia exigida.",
    recomendacion: "Requerir la documentación con la que el contratista acreditó la experiencia y la capacidad técnica exigidas en las bases.",
    miembros: ["recien_fundada", "recien_fundada_medio_ano", "recien_fundada_un_ano", "recien_fundada_dos_anos", "ruc_ganador_muy_nuevo", "ruc_ultra_nuevo"],
  },
  rubro: {
    titulo: "Actividad del contratista distinta del objeto contratado",
    orden: 15,
    normas: { "32069": [CALIFICACION["32069"]], "30225": [CALIFICACION["30225"]] },
    control: "contratista cuya actividad económica registrada no corresponde al objeto del contrato adjudicado",
    efecto: "La diferencia entre la actividad del contratista y el objeto contratado constituiría un indicio de riesgo sobre su capacidad para cumplir la prestación.",
    recomendacion: "Requerir la documentación con la que el contratista acreditó la experiencia en la especialidad y su capacidad técnica.",
    miembros: ["ciiu_vs_objeto", "rubro_ciiu_incongruente", "capacidad_operativa_cuestionable"],
  },
  visitas: {
    titulo: "Visitas del contratista a la Entidad durante el procedimiento",
    orden: 16,
    normas: { "32069": [PRINCIPIOS["32069"], "conflicto de intereses y declaración jurada de intereses de los funcionarios que intervienen en la contratación"], "30225": [PRINCIPIOS["30225"]] },
    control: "reuniones o visitas de proveedores con funcionarios de la entidad antes de la convocatoria o del otorgamiento de la buena pro",
    efecto: "Las visitas registradas durante el procedimiento constituirían un indicio de riesgo para la imparcialidad y la igualdad de trato entre postores.",
    recomendacion: "Requerir el registro de visitas de las fechas señaladas y verificar qué servidores recibieron al contratista y si intervinieron en el procedimiento.",
    miembros: ["visita_previa", "visita_repetida", "visita_fuera_horario", "visita_antes_convocatoria", "lobby_visits_pre_convocatoria"],
  },
  politico: {
    titulo: "Vínculos del contratista con organizaciones políticas",
    orden: 17,
    normas: { "32069": [IMPEDIMENTOS["32069"], PRINCIPIOS["32069"]], "30225": [IMPEDIMENTOS["30225"], PRINCIPIOS["30225"]] },
    control: "contratista aportante o proveedor de la campaña de la organización política que gobierna la entidad",
    efecto: "Los vínculos descritos constituirían un indicio de riesgo para la imparcialidad de la contratación, que debe evaluarse junto con el resto del procedimiento.",
    recomendacion: "Verificar si los servidores que intervinieron en el procedimiento tenían vínculos con la organización política señalada y si presentaron sus declaraciones juradas de intereses.",
    miembros: ["aporte", "aporte_empresa", "candidato", "autoridad", "partido_gobernante", "vendio_gobernante", "proveedor_campana", "funcionario_con_historial_politico"],
  },
  penalidades: {
    titulo: "Antecedentes de penalidades del contratista",
    orden: 18,
    normas: {
      "32069": ["fórmula de la penalidad por mora en la ejecución de la prestación y tope del diez por ciento", "otras penalidades distintas a la mora previstas en las bases y en el contrato"],
      "30225": ["penalidad por mora: 0.10 x monto / (F x plazo en días) y factor F según el plazo", "otras penalidades distintas a la penalidad por mora"],
    },
    control: "penalidades por incumplimiento del contratista en la ejecución contractual que no fueron aplicadas o se aplicaron de forma incompleta",
    efecto: "Los antecedentes de incumplimiento del contratista elevarían el riesgo de demoras o de prestaciones defectuosas en la ejecución de este contrato.",
    recomendacion: "Verificar, en la ejecución de este contrato, el cumplimiento de los plazos y la aplicación de las penalidades pactadas.",
    miembros: ["penalidad", "penalidades_oece_historicas", "ampliacion_denegada_penalidad"],
  },
  concentracion: {
    titulo: "Concentración de contrataciones en un mismo proveedor",
    orden: 19,
    normas: { "32069": [PRINCIPIOS["32069"]], "30225": [PRINCIPIOS["30225"]] },
    control: "concentración de contrataciones de la entidad en un mismo proveedor mediante adjudicaciones reiteradas",
    efecto: "La concentración de contrataciones constituiría un indicio de dependencia de un mismo proveedor, que podría restringir la competencia en la Entidad.",
    recomendacion: "Evaluar las contrataciones de la Entidad con el proveedor en el periodo señalado y las condiciones de competencia en que se adjudicaron.",
    miembros: ["recurrente", "recurrente_frecuente", "recurrente_dominante", "proveedor_cautivo", "concentracion_entidad", "postor_unico_mayoritario"],
  },
  sunat: {
    titulo: "Situación del contratista en la SUNAT",
    orden: 20,
    normas: {
      "32069": ["requisitos para ser proveedor del Estado e inscripción en el Registro Nacional de Proveedores (RNP)"],
      "30225": ["obligatoriedad de inscripción vigente en el RNP para participar en procedimientos de selección"],
    },
    control: "contratista con condición de no habido, suspendido o de baja en el registro de la SUNAT",
    efecto: "La situación tributaria del contratista constituiría un indicio de riesgo para el cumplimiento del contrato y para la vigencia de su inscripción como proveedor.",
    recomendacion: "Verificar la condición del contratista en la SUNAT y en el Registro Nacional de Proveedores a la fecha de la oferta y de la suscripción del contrato.",
    miembros: ["dada_de_baja", "suspendida", "no_habida"],
  },
  expediente: {
    titulo: "Inconsistencias en el registro del procedimiento",
    orden: 21,
    normas: {
      "32069": ["nulidad del contrato: causales y competencia del titular de la entidad", "registro de la información del procedimiento de selección en el SEACE"],
      "30225": ["declaratoria de nulidad de oficio del procedimiento o del contrato por vicios y actos dictados por órgano incompetente"],
    },
    control: "información registrada en el SEACE que no coincide con el expediente de contratación",
    efecto: "Las inconsistencias descritas constituirían un indicio de deficiencias en el registro y la publicidad del procedimiento.",
    recomendacion: "Requerir el expediente de contratación y contrastarlo con lo registrado en el SEACE.",
    miembros: ["inconsistencia_doc_vs_ocds", "objeto_no_corresponde_documento"],
  },
  prensa: {
    titulo: "Antecedentes públicos del contratista",
    orden: 22,
    contexto: true,
    normas: { "32069": [PRINCIPIOS["32069"]], "30225": [PRINCIPIOS["30225"]] },
    control: "antecedentes del contratista difundidos en medios de comunicación sobre contrataciones con el Estado",
    efecto: "Los antecedentes públicos del contratista constituirían un elemento de contexto que debe contrastarse con fuentes oficiales.",
    recomendacion: "Contrastar los antecedentes difundidos con los registros oficiales del contratista.",
    miembros: ["cobertura_prensa_adversa", "antecedente_proveedor_web", "antecedentes_proveedor"],
  },
  // Lo que la Contraloría YA observó en este mismo procedimiento (migración 313) no es un indicio nuevo de Vigía: es el
  // antecedente de control del caso. Va como contexto, con el número del informe, para que quien lea lo pida.
  control_previo: {
    titulo: "El procedimiento ya fue materia de un informe de control",
    orden: 23,
    contexto: true,
    normas: { "32069": [PRINCIPIOS["32069"]], "30225": [PRINCIPIOS["30225"]] },
    control: "seguimiento de las recomendaciones de un informe de control anterior sobre el mismo procedimiento de selección",
    efecto: "Lo observado antes por la Contraloría sobre este procedimiento constituiría un antecedente que debe leerse con el informe de origen.",
    recomendacion: "Revisar el informe de control de origen y el estado de la implementación de sus recomendaciones.",
    miembros: ["observado_por_contraloria"],
  },
};

const OTROS: Tema = {
  titulo: "Otras señales del proceso",
  orden: 30,
  normas: { "32069": [PRINCIPIOS["32069"]], "30225": [PRINCIPIOS["30225"]] },
  control: "irregularidades en un procedimiento de selección de contratación pública",
  efecto: "El hecho descrito constituiría un indicio que debe evaluarse con el expediente de contratación.",
  recomendacion: "Requerir a la Entidad el expediente de contratación para verificar el hecho descrito.",
  miembros: [],
};

const TEMA_DE = new Map<string, string>(Object.entries(TEMAS).flatMap(([k, t]) => t.miembros.map((m) => [m, k] as [string, string])));
/** Lo que no es una señal: reglas de prueba o avisos de que un documento no se pudo leer. */
const NO_SON_SENALES = new Set(["extraccion_documento_fallida", "sin_banderas_juicio", "no_flag_juicio", "placeholder_no_emitir", "juicio_contextual_sinnegativo"]);

export function temaDe(tipo: string): string {
  return TEMA_DE.get(tipo) ?? (/^(obra|inversion|supervision)_/.test(tipo) ? "obra" : `otros:${tipo}`);
}
export const datosTema = (clave: string): Tema => TEMAS[clave] ?? OTROS;

// ─── Formatos ────────────────────────────────────────────────────────────────────────────────────────────────────────

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const NUM2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM_ENTERO = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const numero = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** «S/ 1,112,981.43» (el formato de toda la web). */
export const soles = (v: unknown): string | null => {
  const n = numero(v);
  return n === null ? null : `S/ ${NUM2.format(n)}`;
};
export const entero = (v: unknown): string | null => {
  const n = numero(v);
  return n === null ? null : NUM_ENTERO.format(n);
};
/** «1 de junio de 2026». */
export function fechaLarga(v: unknown): string | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  if (!m) return null;
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : null;
}
const fechaIso = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** Una fracción (0,8753) o un porcentaje (87.5) como «87.5 %». */
const porcentaje = (v: unknown, fraccion = false): string | null => {
  const n = numero(v);
  if (n === null) return null;
  const p = fraccion ? n * 100 : n;
  return `${Math.round(p * 10) / 10} %`;
};
const recortar = (t: unknown, max: number): string => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")}…`;
};
/** Una oración que empieza con mayúscula y termina en punto. */
const oracion = (t: string) => {
  const s = t.replace(/\s+/g, " ").trim().replace(/\s*·\s*/g, ", ");
  if (!s) return s;
  const c = s.charAt(0).toLocaleUpperCase("es") + s.slice(1);
  return /[.!?…»)]$/.test(c) ? c : `${c}.`;
};
const DEPARTAMENTOS: Record<string, string> = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho", "06": "Cajamarca", "07": "Callao", "08": "Cusco",
  "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque", "15": "Lima", "16": "Loreto",
  "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura", "21": "Puno", "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};
/** «Andahuaylas, Apurímac». */
export function lugarDe(zona: unknown, ubigeo: unknown): string | null {
  const dep = typeof ubigeo === "string" ? DEPARTAMENTOS[ubigeo.slice(0, 2)] : undefined;
  const z = typeof zona === "string" && zona.trim() ? zona.trim() : null;
  if (z && dep && z.toLowerCase() !== dep.toLowerCase()) return `${z}, ${dep}`;
  return z ?? dep ?? null;
}

/** La copia de un documento del SEACE que guarda Vigía (GET /documentos/copia, migración 310), o null si no es del SEACE. */
export function copiaDocumento(url: unknown): string | null {
  if (typeof url !== "string" || !/^https:\/\/prod[0-9]\.seace\.gob\.pe(:9000)?\/[\w./?=&%-]{1,300}$/.test(url)) return null;
  return `${WEB}/v1/documentos/copia?u=${encodeURIComponent(url)}`;
}

// ─── Las señales del contrato ────────────────────────────────────────────────────────────────────────────────────────

export interface Enlace {
  texto: string;
  url: string;
  /** La copia en Vigía de un documento del SEACE (se abre aunque el SEACE falle). */
  copia?: string | null;
}

export interface Registros {
  titulo: string;
  columnas: string[];
  filas: (string | number | null)[][];
  /** Cuántos registros hay en total (pueden ser más que las filas). */
  total: number | null;
}

export interface SenalInforme {
  /** Estable: no cambia entre visitas (entra en la huella). */
  clave: string;
  origen: "cruce" | "dictamen";
  tipo: string;
  etiqueta: string;
  severidad: Severidad;
  tema: string;
  /** El hecho en una o dos frases con sus cifras y fechas (lo arma el código, o es la evidencia escrita del dictamen). */
  texto: string;
  fecha: string | null;
  monto: number | null;
  empresa: { nombre: string | null; ruc: string | null } | null;
  /** Los datos del registro, sin personas ni direcciones web. */
  datos: Record<string, unknown>;
  registros: Registros | null;
  fuente: string;
  enlaces: Enlace[];
  /** La norma o el criterio que cita la señal (va al criterio como referencia, nunca al modelo). */
  norma: string | null;
}

/** De dónde sale cada registro, en palabras. */
const FUENTE: Record<string, string> = {
  penalidades: "Registro de penalidades del OECE",
  osce_sancionados: "Registro de sanciones del Tribunal de Contrataciones del Estado",
  rnp_conformacion_juridica: "Registro Nacional de Proveedores (conformación societaria)",
  oece_rnp: "Registro Nacional de Proveedores",
  conosce_adjudicaciones: "CONOSCE (OECE): adjudicaciones",
  conosce_contratos: "CONOSCE (OECE): contratos",
  conosce_ordenes: "CONOSCE (OECE): órdenes de compra y de servicio",
  conosce_postores: "CONOSCE (OECE): postores",
  conosce_consorcios: "CONOSCE (OECE): consorcios",
  oece_ocds: "SEACE (Contrataciones Abiertas del OECE)",
  precio_item: "Precios adjudicados por otras entidades (CONOSCE)",
  servicio_costo_mensual: "Contratos anteriores del mismo servicio (CONOSCE)",
  sunat: "Padrón de la SUNAT",
  onpe_aportantes: "Aportes a organizaciones políticas (ONPE)",
  onpe_candidatos: "Candidatos (ONPE)",
  onpe_gastos_proveedores: "Gastos de campaña (ONPE)",
  jne_autoridades: "Autoridades electas (JNE)",
  jne_candidaturas: "Candidaturas (JNE)",
  visitas_entidades: "Registro de visitas de las entidades",
  dji: "Declaraciones juradas de intereses (Contraloría)",
  dji_contraloria: "Declaraciones juradas de intereses (Contraloría)",
  dji_vinculos: "Declaraciones juradas de intereses (Contraloría)",
  pte_personal: "Portal de Transparencia Estándar: personal",
  persona_entidad: "Órdenes y planilla de la Entidad (CONOSCE y Portal de Transparencia)",
  infobras: "INFOBRAS (Contraloría)",
  invierte_pe: "Invierte.pe (MEF)",
  acta_buena_pro: "Acta de otorgamiento de la buena pro (SEACE)",
  consultas_bases: "Pliego de absolución de consultas y observaciones (SEACE)",
  bases_seace: "Bases del procedimiento (SEACE)",
  contrato_seace: "Contrato (SEACE)",
};
export const fuenteLegible = (f: unknown): string =>
  String(f ?? "").split(/\s*\+\s*/).filter(Boolean).map((x) => FUENTE[x] ?? x).join(" y ") || "Registros públicos";

const FUENTE_AGENTE: [RegExp, string][] = [
  [/document|legal/i, "Lectura de los documentos del expediente (dictamen de Vigía)"],
  [/market|precio/i, "Análisis de precios de mercado (dictamen de Vigía)"],
  [/person|personnel|network/i, "Red de personas y empresas (dictamen de Vigía)"],
  [/news|web|prensa/i, "Prensa y web (dictamen de Vigía)"],
  [/compliance/i, "Reglas de Vigía sobre los registros públicos del proceso (dictamen de Vigía)"],
];
const fuenteDeAgente = (a: unknown) => FUENTE_AGENTE.find(([re]) => re.test(String(a ?? "")))?.[1] ?? "Dictamen de Vigía";

/** El nombre de un enlace por adónde lleva (el del registro, no el de quien lo citó). */
export function textoEnlace(url: string, defecto: string): string {
  if (/contratacionesabiertas\.o[es]ce\.gob\.pe\/proceso\//i.test(url)) return "El proceso en Contrataciones Abiertas del OECE";
  if (/perfilprov-ui\/ficha\//i.test(url)) return "Ficha del proveedor en el Registro Nacional de Proveedores (OECE)";
  if (/sunat\.gob\.pe/i.test(url)) return "Consulta RUC de la SUNAT";
  if (/infobras\.contraloria\.gob\.pe/i.test(url)) return "La obra en INFOBRAS (Contraloría)";
  if (/seace\.gob\.pe/i.test(url) && !/SEACE/.test(defecto)) return `${defecto} (documento del SEACE)`;
  return defecto;
}

/**
 * La evidencia escrita del dictamen, sin los restos de datos vacíos que dejó el agente («Puntajes: ganador None
 * (económico None…)»): la oración que los tiene no dice nada y confundiría al lector y al modelo.
 */
export function limpiarEvidencia(texto: string): string {
  return oraciones(texto)
    .filter((o) => !/\b(None|null|undefined|NaN)\b/.test(o))
    .join(" ")
    // Las fechas como en el resto del documento («8 de julio de 2025», no «2025-07-08»).
    .replace(/(?<![\d-])(\d{4}-\d{2}-\d{2})(?![\d-])/g, (f) => fechaLarga(f) ?? f)
    .trim();
}

/** Una persona natural (RUC 10, ya tapado por publicar) no se nombra: «el proveedor (persona natural)». */
export function empresaDe(nombre: unknown, ruc: unknown): { nombre: string | null; ruc: string | null; persona: boolean } {
  const r = typeof ruc === "string" ? ruc : null;
  const persona = !!r && (/^10/.test(r) || r.includes("ref·")) || (typeof nombre === "string" && nombre.includes("•"));
  if (persona) return { nombre: "el proveedor (persona natural)", ruc: null, persona: true };
  return { nombre: typeof nombre === "string" && nombre.trim() ? nombre.trim() : null, ruc: r && /^20\d{9}$/.test(r) ? r : null, persona: false };
}
const nombreEmpresa = (e: { nombre: string | null; ruc: string | null } | null) =>
  !e?.nombre ? "el contratista" : e.ruc ? `${e.nombre} (RUC ${e.ruc})` : e.nombre;

/**
 * Claves del detalle que no van al modelo: personas (su nombre, su documento), direcciones web, los metadatos de quien
 * leyó el documento y la norma (la pone el código). El cargo y el área de un servidor sí van: se pueden nombrar.
 */
const CLAVE_FUERA = /^(lector|modelo|via|origen_cui|fuente_visita|rol_alla|referencias|norma|enlace|urls|persona_doc|persona_nombre|nombre_persona|funcionario|visitante|declarante|documento_identidad|socios)$|(^|_)(url|dni)($|_)/i;

/** El detalle de un cruce sin personas ni direcciones, recortado (para el modelo y la huella). */
export function datosPublicables(v: unknown, profundidad = 0, clave = ""): unknown {
  if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.includes("•") || /ref·/.test(v)) return "(persona natural)";
    if (/^https?:\/\//i.test(v)) return undefined;
    return recortar(v, 500);
  }
  if (profundidad > 3) return undefined;
  if (Array.isArray(v)) {
    const xs = v.slice(0, 6).map((x) => datosPublicables(x, profundidad + 1, clave)).filter((x) => x !== undefined);
    return xs.length ? xs : undefined;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    // Dentro de una lista de empresas (postores, otras_empresas, fuera…) el nombre es una razón social: se queda si no
    // está tapado. Fuera de eso, un «nombre» suelto puede ser de una persona: se va.
    const deEmpresas = /postores|empresas|fuera|otras|rival|participantes|integrantes/i.test(clave);
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "nombre") {
        if (deEmpresas && typeof x === "string" && !x.includes("•")) out[k] = recortar(x, 200);
        continue;
      }
      if (CLAVE_FUERA.test(k)) continue;
      const y = datosPublicables(x, profundidad + 1, k);
      if (y !== undefined && !(Array.isArray(y) && !y.length)) out[k] = y;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** Los registros de la evidencia de un cruce (lib/evidencia.ts) en filas de texto, sin enlaces. */
function registrosDe(ev: unknown): Registros | null {
  const e = Array.isArray(ev) ? (ev[0] as Fila | undefined) : null;
  if (!e || !Array.isArray(e.columnas) || !Array.isArray(e.filas) || !e.filas.length) return null;
  const cols = (e.columnas as Fila[]).filter((c) => c?.tipo !== "enlace");
  const valor = (tipo: unknown, x: unknown): string | number | null => {
    if (x === null || x === undefined || x === "") return null;
    if (tipo === "soles") return soles(x);
    if (tipo === "fecha") return fechaLarga(x) ?? String(x);
    if (tipo === "pct") return porcentaje(x);
    if (typeof x === "object") return null;
    const s = String(x);
    return s.includes("•") ? "(persona natural)" : recortar(s, 220);
  };
  return {
    titulo: recortar(e.titulo, 160),
    columnas: cols.map((c) => String(c.titulo ?? c.clave)),
    filas: (e.filas as Fila[]).slice(0, 12).map((f) => cols.map((c) => valor(c.tipo, f[c.clave]))),
    total: numero(e.total) ?? e.filas.length,
  };
}

/** El tema de una observación de la Contraloría (lectura de IA de la ficha resumen, lista cerrada), en palabras. */
export const TEMA_OBSERVACION: Record<string, string> = {
  seleccion_contratacion: "la selección y la contratación",
  ejecucion_contractual: "la ejecución del contrato",
  pagos_adelantos: "pagos y adelantos",
  personal_planillas: "personal y planillas",
  bienes_almacen: "bienes y almacén",
  presupuesto_tesoreria: "presupuesto y tesorería",
};

/** El hecho de un cruce en una o dos frases, con sus cifras (los tipos frecuentes; el resto, genérico con sus datos). */
export function textoDeCruce(c: Fila, e: { nombre: string | null; ruc: string | null } | null): string {
  const d: Fila = c.detalle ?? {};
  const E = nombreEmpresa(e);
  const fl = fechaLarga;
  const bp: Fila | null = c.buenaPro ?? null;
  const tipo = String(c.tipo ?? "");
  const ofertaGanadora = bp?.montoSoles != null ? ` y obtuvo la buena pro el ${fl(bp.fecha) ?? "día registrado"} por ${soles(bp.montoSoles)}` : "";
  switch (true) {
    case tipo === "penalidad":
      return `El OECE registra ${d.penalidades ?? "varias"} penalidad(es) aplicada(s) a ${E} en contratos anteriores, en ${d.entidades ?? "una o más"} entidad(es), por ${soles(c.montoSoles) ?? "un monto no registrado"}${d.desde ? `, entre el ${fl(d.desde)} y el ${fl(d.hasta ?? d.desde)}` : ""}.`;
    case /^sancion/.test(tipo):
      return `El Tribunal de Contrataciones del Estado registra una sanción${d.tipo ? ` (${d.tipo})` : ""} a ${E}${d.resolucion ? ` mediante la Resolución N.° ${d.resolucion}` : ""}${d.desde ? `, desde el ${fl(d.desde)}` : ""}${d.hasta ? ` hasta el ${fl(d.hasta)}` : ""}${soles(c.montoSoles) && tipo === "sancion_multa" ? `, por ${soles(c.montoSoles)}` : ""}${d.infraccion ? `, por la infracción: ${recortar(String(d.infraccion).replace(/^-\s*/, ""), 300)}` : ""}.${tipo === "sancion_vigente" ? " La sanción estaba vigente cuando obtuvo la buena pro de este proceso." : ""}`;
    case tipo === "socio_de_inhabilitada":
      return `Un socio (persona natural) de ${E}${d.socio_desde ? `, socio desde el ${fl(d.socio_desde)}` : ""}, integra ${d.sancionada ?? "otra empresa"}${d.sancionada_ruc ? ` (RUC ${d.sancionada_ruc})` : ""}, inhabilitada por el Tribunal de Contrataciones del Estado${d.sancion ? ` (sanción ${d.sancion})` : ""}${d.sancion_desde ? ` desde el ${fl(d.sancion_desde)}` : ""}${d.sancion_hasta ? ` hasta el ${fl(d.sancion_hasta)}` : ""}${d.resolucion ? `, Resolución N.° ${d.resolucion}` : ""}.${d.fundada ? ` ${e?.nombre ?? "La empresa"} fue constituida el ${fl(d.fundada)}${ofertaGanadora}.` : ""}${d.consorcio ? ` Participó como integrante de ${d.consorcio}.` : ""}`;
    case tipo === "empresa_espejo":
      return `${E} comparte socio o representante con ${d.sancionada ?? "otra empresa"}${d.sancionada_ruc ? ` (RUC ${d.sancionada_ruc})` : ""}, inhabilitada por el Tribunal de Contrataciones del Estado${d.desde ? ` desde el ${fl(d.desde)}` : ""}${d.hasta ? ` hasta el ${fl(d.hasta)}` : ""}${d.resolucion ? ` (Resolución N.° ${d.resolucion})` : ""}.${d.fundada ? ` ${e?.nombre ?? "La empresa"} fue constituida el ${fl(d.fundada)}${ofertaGanadora}.` : ""}`;
    case /^recien_fundada/.test(tipo):
      return `${E} fue constituida el ${fl(d.fundada) ?? "fecha registrada en la SUNAT"} y obtuvo la buena pro el ${fl(d.buena_pro) ?? fl(c.fecha) ?? "día registrado"}${d.dias != null ? `, ${entero(d.dias)} días después` : ""}, por ${soles(d.monto ?? c.montoSoles) ?? "el monto adjudicado"}.`;
    case tipo === "unico_postor":
      return `El procedimiento tuvo un solo postor, ${E}${d.adjudicado != null ? `, al que se adjudicó ${soles(d.adjudicado)}` : ""}${d.referencial != null ? ` frente a un valor referencial de ${soles(d.referencial)}` : ""}.`;
    case tipo === "consultas_denuncia_direccionamiento": {
      const citas = (Array.isArray(d.denuncias) ? (d.denuncias as Fila[]) : []).slice(0, 2).map((x) => `«${recortar(x.cita, 320)}»`);
      return `En el pliego de absolución de consultas y observaciones${d.n_consultas != null ? ` (${d.n_consultas} consultas y observaciones)` : ""}, participantes sostuvieron que las bases favorecerían a un postor${citas.length ? `: ${citas.join(" ")}` : "."}`;
    }
    case tipo === "consultas_observaciones_a_requisitos_rechazadas":
      return `La Entidad no acogió ninguna de las observaciones a los requisitos formuladas en el pliego de absolución de consultas y observaciones${d.observaciones != null ? ` (${d.observaciones} observaciones)` : ""}.`;
    case tipo === "bases_marca_sin_equivalente": {
      const marcas = (Array.isArray(d.marcas) ? (d.marcas as Fila[]) : []).filter((m) => m?.marca).map((m) => `«${recortar(m.marca, 80)}»`);
      return `Las bases exigen ${marcas.length ? marcas.join(", ") : "una marca determinada"} sin la mención «o equivalente».`;
    }
    case tipo === "bases_experiencia_alta":
      return `Las bases exigen una experiencia del postor equivalente a tres veces el valor estimado o más${d.experiencia?.cita ? `: «${recortar(d.experiencia.cita, 320)}»` : "."}`;
    case /^acta_/.test(tipo): {
      const fuera = (Array.isArray(d.fuera) ? (d.fuera as Fila[]) : []).slice(0, 4)
        .map((f) => `${typeof f.nombre === "string" && !f.nombre.includes("•") ? f.nombre : "un postor"}${f.monto_ofertado != null ? ` (oferta de ${soles(f.monto_ofertado)})` : ""}: ${recortar(f.motivo, 260)}`);
      const montos = d.menor_monto != null && d.ganador_monto != null && tipo === "acta_oferta_mas_baja_descartada"
        ? ` La oferta más baja era de ${soles(d.menor_monto)} y el ganador ofertó ${soles(d.ganador_monto)}.` : "";
      return `Según el acta de otorgamiento de la buena pro${d.postores != null ? ` (${d.postores} postores)` : ""}, quedaron fuera de la evaluación: ${fuera.length ? fuera.join("; ") : "los demás postores"}.${montos}`;
    }
    case tipo === "fraccionamiento":
      return `${E} recibió de la Entidad ${d.ordenes ?? "varias"} órdenes${d.dias != null ? ` en ${d.dias} día(s)` : ""}${d.desde ? ` entre el ${fl(d.desde)} y el ${fl(d.hasta ?? d.desde)}` : ""} que juntas suman ${soles(d.total ?? c.montoSoles) ?? "un monto"}, por encima del tope de 8 UIT de las contrataciones menores.`;
    case tipo === "proveedor_cautivo":
      return `El ${porcentaje(d.parte, true) ?? "mayor parte"} de lo adjudicado a ${E} por el Estado${d.total_empresa != null ? ` (${soles(d.total_empresa)})` : ""} proviene de ${d.entidad ?? "la Entidad"}${d.procesos != null ? `, en ${d.procesos} procesos` : ""}.`;
    case /^recurrente/.test(tipo):
      return `${E} obtuvo ${d.procesos ?? "varios"} procesos de la Entidad${d.desde ? ` entre el ${fl(d.desde)} y el ${fl(d.hasta ?? d.desde)}` : ""}${c.montoSoles != null ? ` por ${soles(c.montoSoles)}` : ""}${d.participacion != null ? `, el ${porcentaje(d.participacion, true)} de los procesos de la Entidad` : ""}.`;
    case tipo === "socio_comun": {
      const otros = (Array.isArray(c.otrosPostores) ? (c.otrosPostores as Fila[]) : []).map((o) => `${o.nombre ?? "otro postor"}${/^20\d{9}$/.test(String(o.ruc)) ? ` (RUC ${o.ruc})` : ""}`);
      return `${E} comparte socio o representante con ${otros.length ? otros.join(", ") : "otro postor"}, que también se presentó en este procedimiento.`;
    }
    case tipo === "domicilio_compartido": {
      const otras = (Array.isArray(d.postores) ? (d.postores as Fila[]) : Array.isArray(d.empresas) ? (d.empresas as Fila[]) : [])
        .filter((o) => o?.ruc !== e?.ruc).map((o) => `${o.nombre ?? "otra empresa"}${/^20\d{9}$/.test(String(o.ruc)) ? ` (RUC ${o.ruc})` : ""}`);
      return `${E} declara ante la SUNAT el mismo domicilio fiscal${d.domicilio ? ` (${recortar(d.domicilio, 140)})` : ""} que ${otras.length ? otras.join(", ") : "otro participante"}.`;
    }
    case /^sobreprecio/.test(tipo) && !!d.peor: {
      const p: Fila = d.peor;
      return `El precio unitario de «${recortar(p.descripcion, 120)}» (${soles(p.unitario)} por ${p.unidad ?? "unidad"}) es ${p.razon} veces la mediana de ${p.entidades ?? "otras"} entidades (${soles(p.mediana)}) en ${p.anio ?? "el mismo año"}${d.exceso != null ? `; la diferencia estimada sobre lo adjudicado es de ${soles(d.exceso)}` : ""}.`;
    }
    case tipo === "renovacion_mas_cara":
      return `El costo mensual del servicio (${soles(d.costo_mensual) ?? "registrado"}) es ${d.diff_pct != null ? `${d.diff_pct} % ` : ""}mayor que el del contrato anterior del mismo servicio en la Entidad (${soles(d.costo_mensual_anterior) ?? "registrado"}${d.fecha_anterior ? `, del ${fl(d.fecha_anterior)}` : ""}).`;
    case /^adicional/.test(tipo):
      return `El contrato${d.contrato ? ` ${d.contrato}` : ""} registra prestaciones adicionales por ${soles(d.adicional ?? c.montoSoles) ?? "un monto"}${d.contratado != null ? ` sobre ${soles(d.contratado)} contratados` : ""}${d.porcentaje != null ? ` (${d.porcentaje} %)` : ""}.`;
    case /^visita/.test(tipo): {
      const vs = (Array.isArray(c.visitas) ? (c.visitas as Fila[]) : []).slice(0, 4)
        .map((v) => `el ${fl(v.fecha) ?? "día registrado"}${v.hora ? ` a las ${v.hora}` : ""}${v.cargoFuncionario ? `, con el cargo ${recortar(v.cargoFuncionario, 80)}` : ""}${v.areaFuncionario ? ` (${recortar(v.areaFuncionario, 80)})` : ""}`);
      return `Una persona vinculada a ${E} visitó ${d.entidad_visitada ?? "la Entidad"}${vs.length ? ` ${vs.join("; ")}` : ""}${d.buena_pro ? `, antes de la buena pro del ${fl(d.buena_pro)}` : ""}.`;
    }
    case tipo === "observado_por_contraloria": {
      const tema = TEMA_OBSERVACION[String(d.tema ?? "")];
      const resp = [...new Set((Array.isArray(d.responsabilidades) ? (d.responsabilidades as unknown[]) : [])
        .map((r) => (r === "penal" ? "penal" : r === "civil" ? "civil" : /^administrativa/.test(String(r)) ? "administrativa" : "")))]
        .filter(Boolean);
      const objeto = d.via === "cui" ? `la obra de este contrato${d.cui ? ` (código único de inversión ${d.cui})` : ""}` : "este procedimiento";
      return `La Contraloría General de la República observó ${objeto} en el Informe N.° ${d.informe_numero ?? d.informe_codigo ?? "registrado"}${d.emision ? `, emitido el ${fl(d.emision)}` : ""}${d.observacion_n != null ? ` (observación ${d.observacion_n}${tema ? `, sobre ${tema}` : ""})` : ""}${numero(d.perjuicio) ? `, en la que cuantifica un perjuicio de ${d.moneda === "USD" ? `US$ ${entero(d.perjuicio)}` : soles(d.perjuicio)}` : ""}.${resp.length ? ` El informe identifica presunta responsabilidad ${resp.join(", ")} de funcionarios y servidores.` : ""}${numero(d.n_observaciones) && Number(d.n_observaciones) > 1 ? ` En total, ${d.n_observaciones} observaciones de ${d.n_informes ?? 1} informe(s) nombran este contrato.` : ""}`;
    }
    case tipo === "dada_de_baja" || tipo === "suspendida" || tipo === "no_habida":
      return `A la fecha de la consulta, la SUNAT registra a ${E} como ${tipo === "no_habida" ? "no habida" : tipo === "suspendida" ? "suspendida" : "dada de baja"}.`;
    default: {
      const partes = [`${c.etiqueta ?? ETIQUETA_CRUCE[tipo] ?? tipo}: ${E}`];
      if (fl(c.fecha)) partes.push(`registro del ${fl(c.fecha)}`);
      if (soles(c.montoSoles)) partes.push(`monto de ${soles(c.montoSoles)}`);
      return oracion(partes.join(", "));
    }
  }
}

/** Una señal de sobreprecio del dictamen que el análisis de mercado no sostiene no se usa (como la web: dossier.ts). */
export function sobreprecioSostenido(evidencia: string, mercado: Fila | null | undefined): boolean {
  if (numero(mercado?.sobreprecioPct) !== null) return true;
  const item = ((mercado?.items ?? []) as Fila[]).find((i) => {
    const d = String(i?.item ?? "").slice(0, 80);
    return d && evidencia.startsWith(`Ítem '${d}'`);
  });
  if (!item || String(item.veredicto ?? "").toLowerCase() === "no_verificable") return false;
  const n = numero(item.nPrecios) ?? 0;
  if ((numero(item.diffPct) ?? 0) > 300 && n < 3) return false;
  return n >= 3;
}

/** Una bandera del dictamen tal como sale de la base (routes/informeControl.ts), ya pasada por publicar(). */
export interface FilaBandera {
  id: number | string;
  regla: string;
  severidad: string;
  evidencia: string | null;
  norma: string | null;
  fuente_url: string | null;
  agente_origen: string | null;
  puntua: boolean | null;
  verificada: boolean | null;
}

const sev = (s: unknown): Severidad => (s === "alta" || s === "media" ? s : "baja");

/**
 * Las señales del contrato: los antecedentes y hechos de los cruces de la ficha (los posteriores a la convocatoria no) y
 * las banderas publicadas del dictamen que suman (`puntua`), que no se cayeron en la verificación y, si son de
 * sobreprecio, que el mercado sostiene. Cada una con su texto, sus datos sin personas, sus registros y sus enlaces.
 */
export function senalesDelContrato(ficha: Fila, banderas: FilaBandera[]): SenalInforme[] {
  const out: SenalInforme[] = [];
  const participantes = new Map<string, string>();
  for (const p of (ficha.participantes ?? []) as Fila[]) if (/^20\d{9}$/.test(String(p?.ruc)) && p?.nombre) participantes.set(String(p.ruc), String(p.nombre));
  for (const a of (ficha.adjudicaciones ?? []) as Fila[]) if (/^20\d{9}$/.test(String(a?.proveedorRuc)) && a?.proveedor) participantes.set(String(a.proveedorRuc), String(a.proveedor));
  // El documento del SEACE del que sale una señal (el pliego, el acta, las bases), con su fecha de publicación.
  const documentos = new Map<string, string>();
  for (const d of (ficha.documentos ?? []) as Fila[]) {
    if (typeof d?.url !== "string") continue;
    const titulo = String(d.titulo ?? TIPO_DOCUMENTO[String(d.tipo)] ?? "Documento del proceso");
    documentos.set(d.url, fechaLarga(d.fecha) ? `${titulo}, publicado en el SEACE el ${fechaLarga(d.fecha)}` : titulo);
  }

  for (const c of (ficha.cruces ?? []) as Fila[]) {
    if (!c || c.posterior === true || NO_SON_SENALES.has(String(c.tipo))) continue;
    const tipo = String(c.tipo);
    const e = empresaDe(c.proveedor, c.rucProveedor);
    const datos = (datosPublicables(c.detalle ?? {}) as Record<string, unknown> | undefined) ?? {};
    // Lo que se leyó en un documento del proceso: la fecha del registro es la de la convocatoria, no la del documento (el
    // modelo la atribuía al pliego). Va el documento con SU fecha de publicación.
    const deDocumento = /^(consultas_|bases_|acta_)/.test(tipo);
    if (typeof c.fuenteUrl === "string" && documentos.has(c.fuenteUrl)) datos.documento = documentos.get(c.fuenteUrl);
    if (c.consorcio?.nombre) datos.consorcio = c.consorcio.nombre;
    if (Array.isArray(c.socios) && c.socios.length) datos.personas_vinculadas = c.socios.map((s: Fila) => s?.rol ?? "persona vinculada");
    if (Array.isArray(c.visitas) && c.visitas.length) {
      datos.visitas = c.visitas.slice(0, 6).map((v: Fila) => datosPublicables({ fecha: v.fecha, hora: v.hora, minutos: v.minutos, cargo: v.cargoFuncionario, area: v.areaFuncionario, entidad: v.entidad, motivo: v.motivo }));
    }
    if (Array.isArray(c.otrosPostores) && c.otrosPostores.length) datos.otros_postores = datosPublicables(c.otrosPostores, 1, "postores");
    if (c.buenaPro?.fecha || c.buenaPro?.montoSoles != null) datos.buena_pro = { fecha: c.buenaPro.fecha ?? null, monto: c.buenaPro.montoSoles ?? null };
    const enlaces: Enlace[] = [];
    if (typeof c.fuenteUrl === "string" && /^https?:\/\//.test(c.fuenteUrl)) enlaces.push({ texto: textoEnlace(c.fuenteUrl, fuenteLegible(c.fuente)), url: c.fuenteUrl, copia: copiaDocumento(c.fuenteUrl) });
    for (const ev of (Array.isArray(c.evidencia) ? (c.evidencia as Fila[]) : [])) {
      if (ev?.enlace?.url && /^https?:\/\//.test(ev.enlace.url)) enlaces.push({ texto: textoEnlace(ev.enlace.url, String(ev.enlace.texto ?? fuenteLegible(c.fuente))), url: ev.enlace.url, copia: copiaDocumento(ev.enlace.url) });
    }
    if (typeof c.detalle?.url_contrato === "string") enlaces.push({ texto: "Contrato publicado en el SEACE", url: c.detalle.url_contrato, copia: copiaDocumento(c.detalle.url_contrato) });
    // La ficha en el RNP de la empresa de la que se habla y, si la hay, de la inhabilitada con la que se la vincula.
    if (e.ruc) enlaces.push({ texto: `Ficha de ${e.nombre ?? e.ruc} en el Registro Nacional de Proveedores (OECE)`, url: fichaProveedorOece(e.ruc) });
    const sancionada = String(c.detalle?.sancionada_ruc ?? "");
    if (/^20\d{9}$/.test(sancionada)) {
      enlaces.push({ texto: `Ficha de ${c.detalle?.sancionada ?? sancionada} en el Registro Nacional de Proveedores (sanciones)`, url: fichaProveedorOece(sancionada) });
    }
    out.push({
      clave: `cruce:${tipo}:${c.rucProveedor ?? ""}:${fechaIso(c.fecha) ?? ""}`,
      origen: "cruce",
      tipo,
      // Lo que ya observó la Contraloría va como contexto (sin desarrollar): su etiqueta dice en qué informe.
      etiqueta: tipo === "observado_por_contraloria" && (c.detalle?.informe_numero ?? c.detalle?.informe_codigo)
        ? `La Contraloría observó ${c.detalle?.via === "cui" ? "la obra de este contrato" : "este procedimiento"} en el Informe N.° ${c.detalle.informe_numero ?? c.detalle.informe_codigo}`
        : String(c.etiqueta ?? ETIQUETA_CRUCE[tipo] ?? tipo),
      severidad: sev(c.severidad),
      tema: temaDe(tipo),
      texto: textoDeCruce(c, e),
      fecha: deDocumento ? null : fechaIso(c.fecha),
      monto: numero(c.montoSoles),
      empresa: e.nombre ? { nombre: e.nombre, ruc: e.ruc } : null,
      datos,
      registros: registrosDe(c.evidencia),
      fuente: fuenteLegible(c.fuente),
      enlaces: sinRepetir(enlaces),
      norma: typeof c.detalle?.norma === "string" ? c.detalle.norma : null,
    });
  }

  const mercado = (ficha.alerta?.mercado ?? null) as Fila | null;
  for (const b of banderas) {
    if (!b?.regla || NO_SON_SENALES.has(b.regla) || b.puntua === false || b.verificada === false) continue;
    const cruda = String(b.evidencia ?? "").replace(/\s+/g, " ").trim();
    if (!cruda) continue;
    if (b.regla.startsWith("sobreprecio") && !sobreprecioSostenido(cruda, mercado)) continue;
    const evidencia = limpiarEvidencia(cruda) || cruda;
    const ruc = /(?<!\d)20\d{9}(?!\d)/.exec(evidencia)?.[0] ?? null;
    const enlaces: Enlace[] = [];
    if (typeof b.fuente_url === "string" && /^https?:\/\//.test(b.fuente_url)) enlaces.push({ texto: textoEnlace(b.fuente_url, fuenteDeAgente(b.agente_origen)), url: b.fuente_url, copia: copiaDocumento(b.fuente_url) });
    const documento = typeof b.fuente_url === "string" ? documentos.get(b.fuente_url) : undefined;
    if (ruc) enlaces.push({ texto: `Ficha de ${participantes.get(ruc) ?? ruc} en el Registro Nacional de Proveedores (OECE)`, url: fichaProveedorOece(ruc) });
    out.push({
      clave: `dictamen:${b.id}`,
      origen: "dictamen",
      tipo: b.regla,
      etiqueta: etiquetaRegla(b.regla),
      severidad: sev(b.severidad),
      tema: temaDe(b.regla),
      texto: recortar(evidencia, 1500),
      fecha: null,
      monto: null,
      empresa: ruc ? { nombre: participantes.get(ruc) ?? null, ruc } : null,
      datos: documento ? { documento } : {},
      registros: null,
      fuente: fuenteDeAgente(b.agente_origen),
      enlaces: sinRepetir(enlaces),
      norma: b.norma ? String(b.norma) : null,
    });
  }
  return out;
}

function sinRepetir(xs: Enlace[]): Enlace[] {
  const vistos = new Set<string>();
  return xs.filter((x) => (vistos.has(x.url) ? false : (vistos.add(x.url), true)));
}

// ─── Observaciones: las señales del mismo hecho, juntas ─────────────────────────────────────────────────────────────

export interface GrupoObservacion {
  /** «O1», «O2»… en el orden del documento. */
  id: string;
  tema: string;
  titulo: string;
  severidad: Severidad;
  senales: SenalInforme[];
}

const RANGO: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };

/**
 * Una observación por tema (las señales del mismo hecho: la penalidad del cruce y la del dictamen, la denuncia del pliego
 * y el requisito dirigido de las bases), por gravedad: la más alta de sus señales, luego el orden del tema y cuántas
 * señales la sostienen. Más de `max`: las demás van aparte, sin desarrollar.
 */
export function agrupar(senales: SenalInforme[], max = MAX_OBSERVACIONES): { grupos: GrupoObservacion[]; resto: SenalInforme[] } {
  const por = new Map<string, SenalInforme[]>();
  const contexto: SenalInforme[] = [];
  for (const s of senales) {
    if (datosTema(s.tema).contexto) contexto.push(s);
    else por.set(s.tema, [...(por.get(s.tema) ?? []), s]);
  }
  const grupos = [...por.entries()].map(([tema, ss]) => {
    const ordenadas = [...ss].sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad] || (a.origen === b.origen ? 0 : a.origen === "dictamen" ? -1 : 1));
    const t = datosTema(tema);
    return { id: "", tema, titulo: tema.startsWith("otros:") ? ordenadas[0].etiqueta : t.titulo, severidad: ordenadas[0].severidad, senales: ordenadas };
  });
  grupos.sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad] || datosTema(a.tema).orden - datosTema(b.tema).orden || b.senales.length - a.senales.length);
  const elegidos = grupos.slice(0, max).map((g, i) => ({ ...g, id: `O${i + 1}` }));
  return { grupos: elegidos, resto: [...grupos.slice(max).flatMap((g) => g.senales), ...contexto] };
}

/**
 * La fecha a la que se busca la norma de una observación: la de la convocatoria, o la del hecho si el tema es otro acto con
 * su propia fecha (la más reciente de sus señales). `base` dice cuál es, para escribirlo en el criterio.
 */
export function fechaDelCriterio(g: GrupoObservacion, fechaConvocatoria: string | null): { fecha: string | null; base: "convocatoria" | "hecho" } {
  if (datosTema(g.tema).momento === "hecho") {
    const fechas = g.senales.map((s) => s.fecha).filter((f): f is string => !!f).sort();
    if (fechas.length) return { fecha: fechas[fechas.length - 1], base: "hecho" };
  }
  return { fecha: fechaConvocatoria, base: "convocatoria" };
}

/** «Ley N.° 32069 …» o «TUO de la Ley N.° 30225 …», según la fecha. */
export const leyDe = (fecha: string | null) =>
  regimenDe(fecha) === "32069"
    ? "Ley N.° 32069, Ley General de Contrataciones Públicas, y su Reglamento (D.S. N.° 009-2025-EF)"
    : "Texto Único Ordenado de la Ley N.° 30225, Ley de Contrataciones del Estado, y su Reglamento";

const GENERICAS = new Set(
  ("entidad procedimiento proceso seleccion contratacion contratista postor postores indicio indicios riesgo habria habrian podria " +
    "podrian constituiria constituirian conforme registro registros segun advierte advirtio observa respecto mediante asimismo " +
    "ademas tambien hecho hechos evidencia informacion publica publicos publicas datos senal senales vigia cual cuales sobre entre " +
    "durante desde hasta donde cuando quien quienes dicha dicho dichos dichas estos estas aquel aquella misma mismo mismos mismas " +
    "parte partes caso casos forma manera presente presenta presentaron presento ultimo ultima primera primero haber tener tenia " +
    "tenian habia habian pudo pudieron siendo sido estaba estaban seria serian puede pueden debe deben deberia contrato contratos " +
    "monto montos fecha fechas documento documentos condicion efecto causa normativa normas criterio consultas analisis articulo " +
    "contrataciones publicas publico estado opinion conclusion numeral literal total muestran muestra registra registran " +
    // Los meses: las fechas se revisan aparte, y la evidencia los escribe a veces cortos («abr.»).
    "enero febrero marzo abril junio julio agosto setiembre septiembre octubre noviembre diciembre")
    .split(/\s+/),
);
/** Las palabras con contenido de un texto (5 letras o más, sin tildes, sin el vocabulario del informe). */
export const palabrasDe = (t: string) => (normalizar(t).match(/\p{L}{5,}/gu) ?? []).filter((w) => !GENERICAS.has(w));

/**
 * ¿Un criterio del OECE (una opinión, un acuerdo) trata del hecho? Comparte al menos dos raíces con lo que se observa.
 * Sin esto, el modelo elegía a veces una opinión sobre otra cosa (la experiencia en supervisión, para unas visitas).
 */
export function criterioPertinente(texto: string, evidencia: string): boolean {
  const ev = new Set(palabrasDe(evidencia).map((w) => w.slice(0, 6)));
  const comunes = new Set(palabrasDe(texto).map((w) => w.slice(0, 6)).filter((w) => ev.has(w)));
  return comunes.size >= 2;
}

// ─── El proceso ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DatosProceso {
  ocid: string;
  codigo: string | null;
  nomenclatura: string | null;
  objeto: string;
  tipo: string | null;
  procedimiento: string | null;
  etapa: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  lugar: string | null;
  fechaConvocatoria: string | null;
  fechaBuenaPro: string | null;
  fechaContrato: string | null;
  valorReferencial: number | null;
  adjudicado: number | null;
  contratado: number | null;
  moneda: string;
  contratistas: { nombre: string | null; ruc: string | null; monto: number | null }[];
  postoresRegistrados: number | null;
  ofertas: number | null;
  /** La oferta más baja de otro postor (del acta leída), si fue menor que la ganadora, y la diferencia: el código la calcula. */
  ofertaMasBaja: { postor: string | null; monto: number; ganadora: number; diferencia: number } | null;
  documentos: { titulo: string; tipo: string | null; fecha: string | null; url: string; copia: string | null }[];
  /** La última fecha del cronograma del proceso (el fin del periodo revisado). */
  ultimaFecha: string | null;
  dictamen: { codigo: string | null; analizado: string | null } | null;
}

const TIPO_DOCUMENTO: Record<string, string> = {
  biddingDocuments: "Bases", clarifications: "Absolución de consultas y observaciones", evaluationReports: "Evaluación y calificación",
  awardNotice: "Otorgamiento de la buena pro", contractSigned: "Contrato", contractAnnexe: "Anexo del contrato", tenderNotice: "Convocatoria",
};

export function datosDelProceso(ficha: Fila): DatosProceso {
  const adjVigentes = ((ficha.adjudicaciones ?? []) as Fila[]).filter((a) => a?.vigente !== false);
  const conosce = (ficha.contratadoConosce ?? []) as Fila[];
  const sumaConosce = conosce.reduce((s, k) => s + (numero(k?.montoPen) ?? 0), 0);
  const sumaOcds = adjVigentes.reduce((s, a) => s + (numero(a?.montoPen) ?? 0), 0);
  const firmados = ((ficha.contrato?.firmados ?? []) as Fila[]).filter(Boolean);
  const porRuc = new Map<string, { nombre: string | null; ruc: string | null; monto: number | null }>();
  for (const a of adjVigentes) {
    const e = empresaDe(a?.proveedor, a?.proveedorRuc);
    const k = e.ruc ?? e.nombre ?? "";
    if (!k) continue;
    const prev = porRuc.get(k);
    porRuc.set(k, { nombre: e.nombre, ruc: e.ruc, monto: (prev?.monto ?? 0) + (numero(a?.montoPen) ?? 0) || null });
  }
  const fechas: string[] = [];
  for (const x of (ficha.cronograma ?? []) as Fila[]) for (const f of [x?.fecha, x?.hasta]) if (fechaIso(f)) fechas.push(fechaIso(f)!);
  fechas.sort();
  const documentos = ((ficha.documentos ?? []) as Fila[]).filter((d) => typeof d?.url === "string").map((d) => ({
    titulo: String(d.titulo ?? TIPO_DOCUMENTO[String(d.tipo)] ?? "Documento del proceso"),
    tipo: d.tipo ? String(d.tipo) : null,
    fecha: fechaIso(d.fecha),
    url: String(d.url),
    copia: d.enVigia ? copiaDocumento(d.url) : null,
  }));
  const objeto = String(ficha.descripcion ?? ficha.titulo ?? "").replace(/\s+/g, " ").trim();
  // La oferta ganadora frente a la más baja de los demás postores (el acta leída por los agentes o por el lector).
  const ofertas = ((ficha.postoresDetalle ?? []) as Fila[]).filter((x) => numero(x?.montoOferta) !== null);
  const ganadora = ofertas.find((x) => x.esGanador);
  const otra = ofertas.filter((x) => !x.esGanador).sort((a, b) => Number(a.montoOferta) - Number(b.montoOferta))[0];
  const ofertaMasBaja = ganadora && otra && Number(otra.montoOferta) < Number(ganadora.montoOferta)
    ? {
        postor: empresaDe(otra.razonSocial, otra.ruc).nombre,
        monto: Number(otra.montoOferta),
        ganadora: Number(ganadora.montoOferta),
        diferencia: Math.round((Number(ganadora.montoOferta) - Number(otra.montoOferta)) * 100) / 100,
      }
    : null;
  return {
    ocid: String(ficha.ocid),
    codigo: ficha.codigo ? String(ficha.codigo) : null,
    nomenclatura: ficha.nomenclatura ? String(ficha.nomenclatura) : null,
    objeto: objeto || `Proceso ${ficha.codigo ?? ficha.ocid}`,
    tipo: ficha.tipo ? String(ficha.tipo) : null,
    procedimiento: ficha.tipoProceso ? String(ficha.tipoProceso) : ficha.modalidad ? String(ficha.modalidad) : null,
    etapa: ficha.etapa ? String(ficha.etapa) : null,
    entidad: ficha.entidad ? String(ficha.entidad) : null,
    entidadRuc: /^\d{11}$/.test(String(ficha.entidadRuc ?? "")) ? String(ficha.entidadRuc) : null,
    lugar: lugarDe(ficha.zona, ficha.ubigeo),
    fechaConvocatoria: fechaIso(ficha.fecha),
    fechaBuenaPro: fechaIso(ficha.fechaBuenaPro),
    fechaContrato: fechaIso(firmados[0]?.firmado) ?? fechaIso(ficha.lecturaIA?.contrato?.fechaSuscripcion),
    valorReferencial: numero(ficha.montoPen),
    adjudicado: sumaConosce > 0 ? Math.round(sumaConosce * 100) / 100 : sumaOcds > 0 ? Math.round(sumaOcds * 100) / 100 : null,
    contratado: numero(ficha.contrato?.montoFirmados) ?? numero(ficha.lecturaIA?.contrato?.monto),
    moneda: String(ficha.moneda ?? "PEN"),
    contratistas: [...porRuc.values()],
    postoresRegistrados: numero(ficha.postores),
    ofertas: numero(ficha.ofertas),
    ofertaMasBaja,
    documentos,
    ultimaFecha: fechas[fechas.length - 1] ?? null,
    dictamen: ficha.alerta?.codigo ? { codigo: String(ficha.alerta.codigo), analizado: ficha.alerta.analizadoEn ? String(ficha.alerta.analizadoEn).slice(0, 10) : null } : null,
  };
}

/** El régimen que rige el proceso: la Ley N.° 32069 desde el 22-04-2025, antes la Ley N.° 30225 (como buscar_norma). */
export const regimenDe = (fecha: string | null): Regimen => ((fecha ?? new Date().toISOString().slice(0, 10)) >= "2025-04-22" ? "32069" : "30225");

/** El bloque del proceso que recibe el modelo (con las cifras ya escritas como se leen). */
export function procesoParaModelo(p: DatosProceso): Record<string, unknown> {
  return limpio({
    nomenclatura: p.nomenclatura,
    codigo_seace: p.codigo,
    objeto: recortar(p.objeto, 400),
    tipo: p.tipo,
    procedimiento: p.procedimiento,
    entidad: p.entidad,
    ruc_entidad: p.entidadRuc,
    lugar: p.lugar,
    fecha_convocatoria: fechaLarga(p.fechaConvocatoria),
    fecha_buena_pro: fechaLarga(p.fechaBuenaPro),
    fecha_contrato: fechaLarga(p.fechaContrato),
    valor_referencial: soles(p.valorReferencial),
    monto_adjudicado: soles(p.adjudicado),
    monto_contratado: soles(p.contratado),
    contratistas: p.contratistas.map((c) => limpio({ razon_social: c.nombre, ruc: c.ruc, monto: soles(c.monto) })),
    postores_registrados: p.postoresRegistrados,
    ofertas_presentadas: p.ofertas,
    oferta_ganadora: soles(p.ofertaMasBaja?.ganadora),
    oferta_mas_baja_de_otro_postor: p.ofertaMasBaja ? limpio({ postor: p.ofertaMasBaja.postor, monto: soles(p.ofertaMasBaja.monto) }) : null,
    diferencia_entre_la_oferta_ganadora_y_la_mas_baja: soles(p.ofertaMasBaja?.diferencia),
    diferencia_entre_el_valor_referencial_y_lo_adjudicado:
      p.valorReferencial !== null && p.adjudicado !== null ? soles(Math.round((p.valorReferencial - p.adjudicado) * 100) / 100) : null,
  });
}

/** Una señal como la ve el modelo: el hecho, sus datos y sus registros, sin enlaces ni normas. */
export function senalParaModelo(s: SenalInforme): Record<string, unknown> {
  return limpio({
    senal: s.etiqueta,
    gravedad: s.severidad,
    fuente: s.fuente,
    empresa: s.empresa ? limpio({ razon_social: s.empresa.nombre, ruc: s.empresa.ruc }) : null,
    fecha: fechaLarga(s.fecha),
    monto: soles(s.monto),
    hecho: s.texto,
    datos: Object.keys(s.datos).length ? s.datos : null,
    // Cada fila con el nombre de su columna («"Órdenes": "10"»): el modelo sabe qué cuenta cada cifra, y la revisión también.
    registros: s.registros
      ? { titulo: s.registros.titulo, total: s.registros.total, filas: s.registros.filas.map((f) => Object.fromEntries(s.registros!.columnas.map((c, i) => [c, f[i] ?? null]))) }
      : null,
  });
}

function limpio<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))) as T;
}

// ─── Revisión del texto del modelo: cada cifra, en la evidencia ─────────────────────────────────────────────────────

const MES_RE = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre";
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const mesNumero = (m: string) => {
  const i = MESES.indexOf(m.toLowerCase() === "septiembre" ? "setiembre" : m.toLowerCase());
  return i < 0 ? null : String(i + 1).padStart(2, "0");
};
const dos = (n: string) => n.padStart(2, "0");

export interface Cifras {
  /** La evidencia en minúsculas y sin tildes (para ver de qué habla cada número chico). Sólo en las permitidas. */
  texto?: string;
  /** Fechas completas (AAAA-MM-DD), meses (AAAA-MM), días sin año (MM-DD) y años. */
  fechas: Set<string>;
  meses: Set<string>;
  diasMes: Set<string>;
  anios: Set<string>;
  numeros: number[];
  /** Cada número del texto con sus lecturas posibles («1,568»: 1568 o 1.568): vale si alguna está en la evidencia. */
  lecturas: number[][];
  codigos: Set<string>;
  rucs: Set<string>;
  horas: Set<string>;
}

/** Los valores posibles de un número escrito con separadores de miles o decimales en cualquiera de los dos estilos. */
export function lecturasNumero(t: string): number[] {
  const s = t.trim();
  const coma = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  const limpiar = (x: string) => Number(x);
  if (coma >= 0 && punto >= 0) {
    // El último separador es el decimal.
    return coma > punto ? [limpiar(s.replace(/\./g, "").replace(",", "."))] : [limpiar(s.replace(/,/g, ""))];
  }
  const sep = coma >= 0 ? "," : punto >= 0 ? "." : null;
  if (!sep) return [limpiar(s)];
  const partes = s.split(sep);
  const ultima = partes[partes.length - 1];
  // Varios separadores iguales: son de miles (1,112,981 o 1.112.981).
  if (partes.length > 2) return [limpiar(partes.join(""))];
  // Uno solo con tres cifras detrás: puede ser de miles (15,694) o decimal (1.182): las dos.
  if (ultima.length === 3) return [limpiar(partes.join("")), limpiar(`${partes[0]}.${ultima}`)];
  return [limpiar(`${partes[0]}.${ultima}`)];
}

/** Las cifras de un texto: fechas, horas, códigos, RUC y números (en ese orden; lo que se reconoce se saca del texto). */
export function cifrasDe(texto: string): Cifras {
  const c: Cifras = { fechas: new Set(), meses: new Set(), diasMes: new Set(), anios: new Set(), numeros: [], lecturas: [], codigos: new Set(), rucs: new Set(), horas: new Set() };
  // «S/1,000» como «S/ 1,000»: si no, «S/1» se leería como un código.
  let t = ` ${texto} `.replace(/S\/\s*(?=\d)/g, "S/ ");
  const sacar = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    t = t.replace(re, (...args) => {
      fn(args.slice(0, -2) as unknown as RegExpExecArray);
      return " ";
    });
  };
  // Fechas: 2026-06-01, 01/06/2026, 01.06.2026, «1 de junio de 2026», «1° de junio del 2026», «junio de 2026», «1 de junio».
  sacar(/(\d{4})-(\d{2})-(\d{2})/g, (m) => c.fechas.add(`${m[1]}-${m[2]}-${m[3]}`));
  sacar(/(?<!\d)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?!\d)/g, (m) => c.fechas.add(`${m[3]}-${dos(m[2])}-${dos(m[1])}`));
  sacar(new RegExp(`(?<!\\d)(\\d{1,2})(?:°|º)?\\s+de\\s+(${MES_RE})\\s+(?:de|del)\\s+(\\d{4})`, "gi"), (m) => {
    const mes = mesNumero(m[2]);
    if (mes) c.fechas.add(`${m[3]}-${mes}-${dos(m[1])}`);
  });
  // «18 abr. 2023», como las tablas de la evidencia (lib/formato de la web: fechaConAnio).
  sacar(/(?<!\d)(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|set|sep|oct|nov|dic)\.?\s+(\d{4})(?!\d)/gi, (m) => {
    const mes = MESES_CORTOS.indexOf(m[2].toLowerCase().replace("sep", "set"));
    if (mes >= 0) c.fechas.add(`${m[3]}-${String(mes + 1).padStart(2, "0")}-${dos(m[1])}`);
  });
  sacar(new RegExp(`(?<!\\d)(\\d{1,2})(?:°|º)?\\s+de\\s+(${MES_RE})`, "gi"), (m) => {
    const mes = mesNumero(m[2]);
    if (mes) c.diasMes.add(`${mes}-${dos(m[1])}`);
  });
  sacar(new RegExp(`(${MES_RE})\\s+(?:de|del)\\s+(\\d{4})`, "gi"), (m) => {
    const mes = mesNumero(m[1]);
    if (mes) c.meses.add(`${m[2]}-${mes}`);
  });
  sacar(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g, (m) => c.horas.add(`${Number(m[1])}:${m[2]}`));
  // Códigos (resoluciones, contratos, nomenclaturas, OCID): letras y cifras unidas por guiones o barras, con alguna cifra.
  sacar(/(?<![A-Za-z0-9])(?=[A-Za-z0-9/-]*\d)[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+(?![A-Za-z0-9])/g, (m) => c.codigos.add(m[0].toUpperCase()));
  sacar(/(?<!\d)((?:10|15|17|20)\d{9})(?!\d)/g, (m) => c.rucs.add(m[1]));
  // Un número no empieza pegado a otro (ni tras «1,» o «1.» de uno más largo): en `[1,2]` o `"a":2,` el 2 sí cuenta.
  sacar(/(?<!\d|\d[.,])(\d{1,3}(?:[,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)(?![\d])/g, (m) => {
    const lecturas = lecturasNumero(m[1]);
    const validas = lecturas.filter((n) => Number.isFinite(n));
    c.numeros.push(...validas);
    if (validas.length) c.lecturas.push(validas);
    if (/^(19|20)\d{2}$/.test(m[1])) c.anios.add(m[1]);
  });
  // Los años de las fechas también valen solos («en 2026»).
  for (const f of [...c.fechas, ...c.meses]) c.anios.add(f.slice(0, 4));
  return c;
}

/** Lo que se puede decir: las cifras de la evidencia, más las fechas como meses, días y años. */
export function permitidasDe(evidencia: string): Cifras {
  const c = cifrasDe(evidencia);
  for (const f of c.fechas) {
    c.meses.add(f.slice(0, 7));
    c.diasMes.add(f.slice(5));
  }
  for (const a of c.anios) c.numeros.push(Number(a));
  c.texto = normalizar(evidencia);
  return c;
}

const normalizar = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Palabras que pueden ir entre un número y lo que cuenta («2 de los postores») y no dicen qué es. */
const ENTRE = new Set(["de", "del", "los", "las", "sus", "mas", "menos", "por", "en", "con"]);

/**
 * Un número chico (de 2 a 99) está en casi toda evidencia (días, conteos, cifras de una fecha): que esté no basta. Tiene
 * que estar junto a LO QUE CUENTA: «7 penalidades» se sostiene si la evidencia trae 7 cerca de «penalidad»
 * (`"penalidades":7`); «2 integrantes con otro giro» no, si el 2 de la evidencia era de «2 entidades».
 */
export function numerosChicosFueraDeContexto(oracion: string, p: Cifras): string[] {
  if (!p.texto) return [];
  const malas: string[] = [];
  const t = normalizar(oracion);
  // Un número pegado a letras («M03», «3E») es un código, no un conteo.
  const re = /(?<![a-zñ\d.,:/-])(\d{1,2})(?![a-zñ\d.,:/-])\s+((?:[a-zñ]+\s+){0,2}?)([a-zñ]{4,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const n = Number(m[1]);
    if (n < 2) continue;
    // Las palabras de enlace no cuentan: «2 de los postores» cuenta postores.
    const intermedias = m[2].trim().split(/\s+/).filter(Boolean);
    if (intermedias.some((w) => !ENTRE.has(w))) continue;
    // Las fechas («1 de junio») ya se revisaron como fechas.
    if (/^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)$/.test(m[3])) continue;
    if (!cuentaEnEvidencia(n, m[3].slice(0, 5), p.texto)) malas.push(`${n} ${m[3]}`);
  }
  return malas;
}

/**
 * ¿La evidencia cuenta lo mismo? El número va seguido de lo que cuenta («2 entidades», «7 penalidad(es)») o es el valor
 * de una clave que lo nombra (`"penalidades":7`, `"postores_registrados":12`) o de un rótulo («penalidades: 7»).
 */
function cuentaEnEvidencia(n: number, raiz: string, texto: string): boolean {
  const re = new RegExp(`(?<!\\d|\\d[.,])0*${n}(?!\\d|[.,]\\d)`, "g");
  let k: RegExpExecArray | null;
  while ((k = re.exec(texto))) {
    const despues = texto.slice(k.index + k[0].length, k.index + k[0].length + 40);
    const siguiente = (despues.match(/[a-zñ]+/g) ?? []).find((w) => !ENTRE.has(w));
    if (siguiente?.startsWith(raiz)) return true;
    const antes = texto.slice(Math.max(0, k.index - 64), k.index);
    // `"penalidades":7` o, en una fila de tabla, `"ordenes":"10"`.
    const clave = /"([a-zñ_ ]+)"\s*:\s*"?$/.exec(antes)?.[1];
    if (clave?.split(/[_ ]/).some((w) => w.startsWith(raiz))) return true;
    // Un rótulo en prosa: «Otros integrantes con giro distinto: 2».
    const rotulo = /([a-zñ ]{1,60}):\s*$/.exec(antes)?.[1];
    if (rotulo?.split(/\s+/).some((w) => w.startsWith(raiz))) return true;
  }
  return false;
}

/** ¿Un número del texto está en la evidencia? Al céntimo, o redondeado al entero o a un decimal. Los 0 y 1 sueltos valen. */
function numeroPermitido(n: number, permitidas: number[]): boolean {
  if (n === 0 || n === 1) return true;
  return permitidas.some((x) => Math.abs(x - n) < 0.006 || (Number.isInteger(n) && Math.abs(x) >= 10 && Math.round(x) === n)
    || Math.abs(Math.round(x * 10) / 10 - n) < 0.0001);
}

/** Las cifras de un texto que NO están en la evidencia (vacío = todo en orden). */
export function cifrasSinRespaldo(texto: string, p: Cifras): string[] {
  const c = cifrasDe(texto);
  const malas: string[] = [];
  for (const f of c.fechas) if (!p.fechas.has(f)) malas.push(f);
  for (const m of c.meses) if (!p.meses.has(m)) malas.push(m);
  for (const d of c.diasMes) if (!p.diasMes.has(d)) malas.push(d);
  for (const h of c.horas) if (!p.horas.has(h)) malas.push(h);
  for (const k of c.codigos) if (!p.codigos.has(k)) malas.push(k);
  for (const r of c.rucs) if (!p.rucs.has(r)) malas.push(r);
  for (const a of c.anios) if (!p.anios.has(a)) malas.push(a);
  // Los años ya revisados como años no se revisan otra vez como números.
  const anios = new Set([...c.anios].map(Number));
  for (const ls of c.lecturas) if (!ls.some((n) => anios.has(n) || numeroPermitido(n, p.numeros))) malas.push(String(ls[0]));
  if (!malas.length) malas.push(...numerosChicosFueraDeContexto(texto, p));
  return malas;
}

/**
 * Palabras que una observación nunca dice de una persona ni del caso: no hay delito ni culpables en un indicio. La oración
 * que las tiene se quita (el redactor lo sabe; esto es la red).
 */
const PROHIBIDAS = /(?<![\p{L}])(delito|delictiv\p{L}*|corrupci[oó]n|corrupt[oa]s?|cohecho|colusi[oó]n|coludid[oa]s?|culpable\p{L}*|dolos[oa]s?|dolo|malversaci[oó]n|peculado|negociaci[oó]n incompatible|responsabilidad(es)? (penal|civil|administrativa)\p{L}*|es responsable|son responsables|se acredit[oó]|qued[oó] acreditad[oa]|comprob[oó] que|est[aá] probado)(?![\p{L}])/iu;
/** Una persona tapada por publicar() (un apellido con •••) no va en el texto del modelo. */
const PERSONA_TAPADA = /•/;
/** «RUC de la evidencia», «RUC no consignado»: un RUC sin sus 11 cifras es un dato que el modelo no tenía. */
const RUC_SIN_NUMERO = /\bRUC\b(?!\s*(?:N\.?\s*[°º]\s*)?\d{11})/;

/** Parte en oraciones sin cortar montos («1,112,981.43»), siglas («S.A.C.») ni números de resolución («N.° 5»). */
export function oraciones(texto: string): string[] {
  const t = texto.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const partes: string[] = [];
  let desde = 0;
  const re = /([.!?])\s+(?=[«"(¿A-ZÁÉÍÓÚÑ0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const antes = t.slice(Math.max(0, m.index - 4), m.index);
    // «S.A.C. La…», «N.° 5», «Art. 30»: la letra suelta o la abreviatura no cierran la oración.
    if (m[1] === "." && /(\b[A-ZÁÉÍÓÚÑ]|\bN|°|\bart|\bArt|\bInc|\binc|\bSr|\bDr|\bEd)$/.test(antes)) continue;
    partes.push(t.slice(desde, m.index + 1).trim());
    desde = m.index + m[0].length;
  }
  partes.push(t.slice(desde).trim());
  return partes.filter(Boolean);
}

export interface RevisionTexto {
  texto: string;
  /** Oraciones quitadas y por qué (una cifra sin respaldo, una palabra prohibida, una persona). */
  quitadas: { oracion: string; motivo: string }[];
  cifras: number;
}

/** Quita del texto del modelo cada oración con una cifra que no está en la evidencia, una persona o una palabra prohibida. */
export function revisarTexto(texto: string, permitidas: Cifras): RevisionTexto {
  const quitadas: RevisionTexto["quitadas"] = [];
  let cifras = 0;
  const buenas = oraciones(String(texto ?? "").replace(/\s*·\s*/g, ", ")).filter((o) => {
    const c = cifrasDe(o);
    cifras += c.fechas.size + c.meses.size + c.diasMes.size + c.codigos.size + c.rucs.size + c.lecturas.length + c.horas.size;
    if (PERSONA_TAPADA.test(o)) {
      quitadas.push({ oracion: o, motivo: "nombra a una persona" });
      return false;
    }
    if (PROHIBIDAS.test(o)) {
      quitadas.push({ oracion: o, motivo: "afirma una responsabilidad o un delito" });
      return false;
    }
    if (RUC_SIN_NUMERO.test(o)) {
      quitadas.push({ oracion: o, motivo: "menciona un RUC que no está en la evidencia" });
      return false;
    }
    const malas = cifrasSinRespaldo(o, permitidas);
    if (malas.length) {
      quitadas.push({ oracion: o, motivo: `cifra sin respaldo: ${malas.slice(0, 3).join(", ")}` });
      return false;
    }
    return true;
  });
  return { texto: buenas.join(" ").trim(), quitadas, cifras };
}

// ─── El texto de respaldo (sin modelo) ───────────────────────────────────────────────────────────────────────────────

/**
 * La condición armada con los hechos de cada señal, tal cual, cuando el modelo no respondió o su texto no se sostuvo. Si
 * un cruce y una bandera del dictamen hablan de la misma empresa en el mismo tema (las penalidades del ganador), va el
 * del cruce, que trae los registros: decir dos veces lo mismo confunde.
 */
export function condicionDeRespaldo(g: GrupoObservacion): string[] {
  const conCruce = new Set(g.senales.filter((s) => s.origen === "cruce" && s.empresa?.ruc).map((s) => s.empresa!.ruc));
  const vistos = new Set<string>();
  return g.senales
    .filter((s) => !(s.origen === "dictamen" && s.empresa?.ruc && conCruce.has(s.empresa.ruc)))
    .map((s) => oracion(s.texto))
    .filter((t) => (vistos.has(t) ? false : (vistos.add(t), true)))
    .slice(0, 4);
}

// ─── El documento ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface NormaCriterio {
  id: string;
  documento: string;
  articulo: string | null;
  epigrafe: string | null;
  extracto: string;
  url: string | null;
  /** «texto que regía hasta el 13-01-2026» si el artículo cambió después. */
  version: string | null;
  /** norma (ley, reglamento, directiva, bases estándar) o criterio (opinión del OECE, acuerdo de Sala Plena). */
  clase: "norma" | "criterio";
}

export interface Precedente {
  id: string;
  numero: string | null;
  codigo: string;
  entidad: string | null;
  anio: number | null;
  titulo: string | null;
  observacion: string | null;
  modalidad: string | null;
  responsabilidades: string[];
  url: string | null;
  /** El informe observó ESTE mismo procedimiento (migración 313), no una contratación parecida. */
  directo?: boolean;
}

export interface RedaccionObservacion {
  sumilla: string;
  condicion: string[];
  efecto: string;
  causa: string;
  criterios: string[];
  precedentes: string[];
  recomendaciones: string[];
  /** «modelo» si el texto lo escribió el modelo y se sostuvo; «datos» si es el de respaldo. */
  redaccion: "modelo" | "datos";
  quitadas: { oracion: string; motivo: string }[];
  cifras: number;
}

export interface Observacion {
  numero: number;
  id: string;
  tema: string;
  severidad: Severidad;
  sumilla: string;
  condicion: string[];
  /** La norma a la fecha de la convocatoria o, si el hecho es otro acto con su propia fecha, a la fecha del hecho. */
  criterio: { fecha: string | null; base: "convocatoria" | "hecho"; ley: string; normas: NormaCriterio[]; referencias: string[] };
  efecto: string;
  causa: string;
  evidencia: (Enlace & { fuente: string })[];
  registros: Registros[];
  precedentes: Precedente[];
  senales: { tipo: string; etiqueta: string; severidad: Severidad; origen: "cruce" | "dictamen"; fuente: string }[];
  redaccion: "modelo" | "datos";
}

export interface InformeControl {
  version: string;
  titulo: string;
  numero: string;
  fecha: string;
  aviso: string;
  general: {
    titulo: string;
    objetivo: string;
    entidad: { nombre: string | null; ruc: string | null };
    proceso: { nomenclatura: string | null; codigo: string | null; ocid: string; procedimiento: string | null; tipo: string | null; etapa: string | null };
    montos: { referencial: number | null; adjudicado: number | null; contratado: number | null; moneda: string };
    lugar: string | null;
    fechas: { convocatoria: string | null; buenaPro: string | null; contrato: string | null };
    contratistas: { nombre: string | null; ruc: string | null; monto: number | null }[];
    elaboradoPor: string;
  };
  alcance: {
    periodo: { desde: string | null; hasta: string | null };
    antecedentesDesde: string | null;
    corte: string;
    regimen: string;
    registros: string[];
    documentos: DatosProceso["documentos"];
    nota: string;
  };
  observaciones: Observacion[];
  otrasSenales: { etiqueta: string; severidad: Severidad; fuente: string }[];
  antecedentesControl: Precedente[];
  conclusion: string[];
  recomendaciones: string[];
  fuentes: { texto: string; url: string; tipo: string }[];
  enlaces: { vigia: string; dictamen: string | null; oece: string; conosce: string };
  verificacion: { cifrasRevisadas: number; oracionesQuitadas: number; observacionesConTextoDelModelo: number; observacionesConTextoDeDatos: number };
}

const NIVEL: Record<Severidad, string> = { alta: "alto", media: "medio", baja: "bajo" };
export const nivelDelIndicio = (s: Severidad) => NIVEL[s];

export interface PiezasInforme {
  proceso: DatosProceso;
  grupos: GrupoObservacion[];
  resto: SenalInforme[];
  redacciones: Map<string, RedaccionObservacion>;
  normas: Map<string, NormaCriterio[]>;
  precedentes: Map<string, Precedente[]>;
  antecedentes: Precedente[];
  hoy: string;
  version: number;
}

/** El documento entero, con las piezas que puso el código y el texto que escribió (o no) el modelo. */
export function armarInforme(x: PiezasInforme): InformeControl {
  const p = x.proceso;
  const ley = leyDe(p.fechaConvocatoria);
  const observaciones: Observacion[] = x.grupos.map((g, i) => {
    const fc = fechaDelCriterio(g, p.fechaConvocatoria);
    const r = x.redacciones.get(g.id)!;
    const candidatas = x.normas.get(g.id) ?? [];
    const elegidas = r.criterios.length ? candidatas.filter((n) => r.criterios.includes(n.id)) : candidatas.filter((n) => n.clase === "norma").slice(0, 2);
    const precedentes = x.precedentes.get(g.id) ?? [];
    const prec = r.precedentes.length ? precedentes.filter((q) => r.precedentes.includes(q.id)) : r.redaccion === "datos" ? precedentes.slice(0, 2) : [];
    const referencias = [...new Set(g.senales.map((s) => s.norma).filter((n): n is string => !!n).map(referenciaLegible))].filter(Boolean).slice(0, 3);
    const evidencia = sinRepetir(g.senales.flatMap((s) => s.enlaces)).map((e) => ({ ...e, fuente: g.senales.find((s) => s.enlaces.some((y) => y.url === e.url))?.fuente ?? "" }));
    return {
      numero: i + 1,
      id: g.id,
      tema: g.tema,
      severidad: g.severidad,
      sumilla: r.sumilla,
      condicion: r.condicion,
      criterio: { fecha: fc.fecha, base: fc.base, ley: leyDe(fc.fecha), normas: elegidas.length ? elegidas : candidatas.slice(0, 2), referencias },
      efecto: r.efecto,
      causa: r.causa,
      evidencia,
      registros: g.senales.map((s) => s.registros).filter((y): y is Registros => !!y).slice(0, 3),
      precedentes: prec.slice(0, 3),
      senales: g.senales.map((s) => ({ tipo: s.tipo, etiqueta: s.etiqueta, severidad: s.severidad, origen: s.origen, fuente: s.fuente })),
      redaccion: r.redaccion,
    };
  });

  const todasLasSenales = [...x.grupos.flatMap((g) => g.senales), ...x.resto];
  const registros = [...new Set([
    "SEACE: registro del procedimiento en Contrataciones Abiertas del OECE (estándar OCDS)",
    "CONOSCE (OECE): adjudicaciones y contratos",
    ...todasLasSenales.map((s) => s.fuente),
  ])];
  // Desde cuándo hay antecedentes: la fecha de cada señal y, si la trae, desde cuándo cubre su registro (penalidades).
  const fechasSenales = todasLasSenales.flatMap((s) => [s.fecha, fechaIso(s.datos.desde)]).filter((f): f is string => !!f).sort();
  const enlaces = {
    vigia: `${WEB}/app/contratos/${encodeURIComponent(p.ocid)}`,
    dictamen: p.dictamen ? `${WEB}/app/contratos/${encodeURIComponent(p.ocid)}?vista=dictamen` : null,
    oece: procesoOece(p.ocid),
    conosce: CONOSCE_BUSCADOR,
  };

  const recomendaciones = recomendacionesDe(p, observaciones, x.redacciones);
  const fuentes = fuentesDe(p, observaciones, enlaces, x.antecedentes);
  const conPalabrasDelModelo = observaciones.filter((o) => o.redaccion === "modelo").length;
  return {
    version: VERSION_REDACTOR,
    titulo: TITULO_DOCUMENTO,
    numero: `VIG-${p.codigo ?? p.ocid}-${String(x.version).padStart(2, "0")}`,
    fecha: x.hoy,
    aviso: "Este documento reúne indicios detectados con datos públicos por Vigía by Gobserva. No es un informe de la Contraloría General de la República, no es el resultado de un servicio de control y no determina responsabilidades: cada observación debe verificarse con el expediente de contratación completo.",
    general: {
      titulo: p.objeto,
      objetivo: `Evaluar si el procedimiento de selección ${p.nomenclatura ?? p.codigo ?? p.ocid}${p.procedimiento ? ` (${p.procedimiento})` : ""}, convocado por ${p.entidad ?? "la Entidad"}${p.fechaConvocatoria ? ` el ${fechaLarga(p.fechaConvocatoria)}` : ""}, se realizó conforme a la normativa de contrataciones del Estado aplicable a la fecha de su convocatoria, a partir de los indicios detectados en datos públicos.`,
      entidad: { nombre: p.entidad, ruc: p.entidadRuc },
      proceso: { nomenclatura: p.nomenclatura, codigo: p.codigo, ocid: p.ocid, procedimiento: p.procedimiento, tipo: p.tipo, etapa: p.etapa },
      montos: { referencial: p.valorReferencial, adjudicado: p.adjudicado, contratado: p.contratado, moneda: p.moneda },
      lugar: p.lugar,
      fechas: { convocatoria: p.fechaConvocatoria, buenaPro: p.fechaBuenaPro, contrato: p.fechaContrato },
      contratistas: p.contratistas,
      elaboradoPor: ELABORADO_POR,
    },
    alcance: {
      periodo: { desde: p.fechaConvocatoria, hasta: p.ultimaFecha && p.ultimaFecha < x.hoy ? p.ultimaFecha : x.hoy },
      antecedentesDesde: fechasSenales[0] && (!p.fechaConvocatoria || fechasSenales[0] < p.fechaConvocatoria) ? fechasSenales[0] : null,
      corte: x.hoy,
      regimen: ley,
      registros,
      documentos: p.documentos,
      nota: "Se revisaron los registros públicos del procedimiento y de quienes participaron en él, y los documentos del expediente publicados en el SEACE que Vigía leyó. No se tuvo acceso al expediente de contratación completo ni a información de la Entidad que no sea pública.",
    },
    observaciones,
    otrasSenales: x.resto.map((s) => ({ etiqueta: s.etiqueta, severidad: s.severidad, fuente: s.fuente })),
    antecedentesControl: x.antecedentes,
    conclusion: conclusionDe(p, observaciones),
    recomendaciones,
    fuentes,
    enlaces,
    verificacion: {
      cifrasRevisadas: [...x.redacciones.values()].reduce((s, r) => s + r.cifras, 0),
      oracionesQuitadas: [...x.redacciones.values()].reduce((s, r) => s + r.quitadas.length, 0),
      observacionesConTextoDelModelo: conPalabrasDelModelo,
      observacionesConTextoDeDatos: observaciones.length - conPalabrasDelModelo,
    },
  };
}

/** «Ley N.° 32069, artículo 30»; si el documento ya nombra el artículo («…, artículo 30: impedimentos…»), no se repite. */
export function tituloNorma(n: { documento: string; articulo: string | null }): string {
  if (!n.articulo) return n.documento;
  const yaLoDice = new RegExp(`art[ií]culo\\s+${n.articulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(n.documento);
  return yaLoDice ? n.documento : `${n.documento}, artículo ${n.articulo}`;
}

/** «Heurística — coherencia rubro…» es un criterio de Vigía, no una norma; la URL pegada a la norma va fuera. */
export function referenciaLegible(norma: string): string {
  const n = norma.replace(/\s*\(\s*https?:\/\/[^)\s]*\)?/g, "").replace(/\s*https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
  const m = n.match(/^heur[ií]stica\s*[—–:-]\s*(.+)$/i);
  return m ? `Criterio de Vigía: ${m[1]}` : n;
}

function conclusionDe(p: DatosProceso, obs: Observacion[]): string[] {
  const n = obs.length;
  const graves = obs.filter((o) => o.severidad === "alta").length;
  const proceso = p.nomenclatura ?? p.codigo ?? p.ocid;
  return [
    `De la revisión de los registros públicos del procedimiento ${proceso}, convocado por ${p.entidad ?? "la Entidad"}, se ${n === 1 ? "identificó un indicio" : `identificaron ${n} indicios`}${graves ? `, ${graves === 1 ? "uno" : graves} de nivel alto` : ""}, que ${n === 1 ? "amerita" : "ameritan"} su evaluación por el órgano de control competente:`,
    ...obs.map((o) => `Observación N.° ${o.numero} (nivel ${nivelDelIndicio(o.severidad)}): ${o.sumilla}`),
    "Estos indicios no constituyen hallazgos de auditoría ni determinan responsabilidades. Su confirmación requiere revisar el expediente de contratación completo y aplicar los procedimientos del control gubernamental.",
  ];
}

function recomendacionesDe(p: DatosProceso, obs: Observacion[], redacciones: Map<string, RedaccionObservacion>): string[] {
  const proceso = p.nomenclatura ?? p.codigo ?? p.ocid;
  const enEjecucion = /contrat|ejecuci/i.test(p.etapa ?? "") || !!p.fechaContrato;
  const out = [
    `Evaluar la pertinencia de programar un servicio de control sobre el procedimiento ${proceso}${enEjecucion ? " (un control concurrente si el contrato sigue en ejecución, o un servicio de control posterior)" : ""}, considerando los indicios descritos en este documento.`,
  ];
  // Una por observación: la del modelo (la más concreta: qué documento pedir) o la del tema.
  for (const o of obs) {
    const r = redacciones.get(o.id);
    const propia = r?.redaccion === "modelo" && r.recomendaciones[0] ? r.recomendaciones[0] : datosTema(o.tema).recomendacion;
    out.push(`${propia.replace(/[.\s]+$/, "")} (Observación N.° ${o.numero}).`);
  }
  out.push("Requerir a la Entidad el expediente de contratación completo, incluidos los documentos que no se publicaron en el SEACE, para verificar los hechos descritos.");
  const vistos = new Set<string>();
  return out.filter((x) => {
    const k = x.toLowerCase().replace(/\s+/g, " ").replace(/\(observación n\.° \d+\)/, "").trim();
    return vistos.has(k) ? false : (vistos.add(k), true);
  });
}

function fuentesDe(p: DatosProceso, obs: Observacion[], enlaces: InformeControl["enlaces"], antecedentes: Precedente[]): InformeControl["fuentes"] {
  const out: InformeControl["fuentes"] = [
    { texto: `El proceso en Contrataciones Abiertas del OECE (${p.codigo ?? p.ocid})`, url: enlaces.oece, tipo: "proceso" },
    { texto: "Buscador de CONOSCE (OECE)", url: enlaces.conosce, tipo: "proceso" },
    { texto: "La ficha del contrato en Vigía", url: enlaces.vigia, tipo: "vigia" },
  ];
  if (enlaces.dictamen) out.push({ texto: "El dictamen de Vigía del contrato", url: enlaces.dictamen, tipo: "vigia" });
  for (const c of p.contratistas) if (c.ruc) out.push({ texto: `Ficha de ${c.nombre ?? c.ruc} en el Registro Nacional de Proveedores`, url: fichaProveedorOece(c.ruc), tipo: "proveedor" });
  for (const d of p.documentos) out.push({ texto: `${d.titulo}${d.fecha ? ` (${fechaLarga(d.fecha)})` : ""}`, url: d.copia ?? d.url, tipo: "documento" });
  for (const o of obs) {
    for (const e of o.evidencia) out.push({ texto: `${e.texto} (Observación N.° ${o.numero})`, url: e.copia ?? e.url, tipo: "evidencia" });
    for (const n of o.criterio.normas) if (n.url) out.push({ texto: tituloNorma(n), url: n.url, tipo: "norma" });
    for (const q of o.precedentes) if (q.url) out.push({ texto: `Informe de control N.° ${q.numero ?? q.codigo}${q.entidad ? `, ${q.entidad}` : ""}`, url: q.url, tipo: "precedente" });
  }
  for (const q of antecedentes) if (q.url) out.push({ texto: `Informe de control N.° ${q.numero ?? q.codigo}${q.entidad ? `, ${q.entidad}` : ""}`, url: q.url, tipo: "precedente" });
  const vistos = new Set<string>();
  return out.filter((f) => (vistos.has(f.url) ? false : (vistos.add(f.url), true)));
}

// ─── Markdown ────────────────────────────────────────────────────────────────────────────────────────────────────────

const md = (t: unknown) => String(t ?? "").replace(/\s*·\s*/g, ", ").replace(/([\\`*_[\]<>|])/g, "\\$1");
const enlaceMd = (texto: string, url: string) => `[${md(texto)}](${url.replace(/\)/g, "%29").replace(/ /g, "%20")})`;

/** El documento en Markdown (lo guarda la base, lo lee el MCP y se baja como texto). */
export function markdownDe(d: InformeControl): string {
  const g = d.general;
  const L: string[] = [];
  L.push(`# ${d.titulo}`, "", `**${md(d.numero)}**. ${md(fechaLarga(d.fecha) ?? d.fecha)}.`, "", `> ${md(d.aviso)}`, "");
  L.push("## I. Información general", "");
  const filas: [string, string | null][] = [
    ["Título", md(g.titulo)],
    ["Objetivo", md(g.objetivo)],
    ["Entidad", g.entidad.nombre ? `${md(g.entidad.nombre)}${g.entidad.ruc ? ` (RUC ${g.entidad.ruc})` : ""}` : null],
    ["Procedimiento", [g.proceso.nomenclatura, g.proceso.procedimiento].filter(Boolean).map(md).join(", ") || null],
    ["Código del proceso (SEACE)", g.proceso.codigo ?? g.proceso.ocid],
    ["Valor referencial", soles(g.montos.referencial)],
    ["Monto adjudicado", soles(g.montos.adjudicado)],
    ["Monto contratado", soles(g.montos.contratado)],
    ["Contratista", g.contratistas.map((c) => `${md(c.nombre ?? "Sin nombre")}${c.ruc ? ` (RUC ${c.ruc})` : ""}`).join("; ") || null],
    ["Lugar", g.lugar ? md(g.lugar) : null],
    ["Convocatoria", fechaLarga(g.fechas.convocatoria)],
    ["Buena pro", fechaLarga(g.fechas.buenaPro)],
    ["Contrato", fechaLarga(g.fechas.contrato)],
    ["Fecha del documento", fechaLarga(d.fecha)],
    ["Elaborado por", md(g.elaboradoPor)],
  ];
  L.push("| Dato | Detalle |", "| --- | --- |", ...filas.filter(([, v]) => v).map(([k, v]) => `| ${k} | ${v} |`), "");
  L.push("## II. Alcance y fuentes", "");
  const a = d.alcance;
  L.push(`Periodo revisado: del ${fechaLarga(a.periodo.desde) ?? "inicio del procedimiento"} al ${fechaLarga(a.periodo.hasta)}${a.antecedentesDesde ? `, con antecedentes del contratista desde el ${fechaLarga(a.antecedentesDesde)}` : ""}. Datos al ${fechaLarga(a.corte)}.`, "");
  L.push(`Normativa aplicable a la fecha de la convocatoria: ${md(a.regimen)}.`, "", md(a.nota), "", "Registros consultados:", "", ...a.registros.map((r) => `- ${md(r)}`), "");
  if (a.documentos.length) L.push("Documentos del expediente publicados en el SEACE:", "", ...a.documentos.map((x) => `- ${enlaceMd(`${x.titulo}${x.fecha ? ` (${fechaLarga(x.fecha)})` : ""}`, x.copia ?? x.url)}`), "");
  const directos = d.antecedentesControl.filter((q) => q.directo);
  if (directos.length) {
    L.push("Informes de control de la Contraloría que ya observaron este procedimiento:", "");
    for (const q of directos) L.push(`- ${q.url ? enlaceMd(`Informe N.° ${q.numero ?? q.codigo}`, q.url) : `Informe N.° ${md(q.numero ?? q.codigo)}`}, ${md(q.entidad ?? "")}${q.anio ? ` (${q.anio})` : ""}: ${md(q.titulo ?? "")}`);
    L.push("");
  }
  if (d.antecedentesControl.some((q) => !q.directo)) {
    L.push("Informes de control de la Contraloría sobre contrataciones parecidas:", "");
    for (const q of d.antecedentesControl.filter((x) => !x.directo)) L.push(`- ${q.url ? enlaceMd(`Informe N.° ${q.numero ?? q.codigo}`, q.url) : `Informe N.° ${md(q.numero ?? q.codigo)}`}, ${md(q.entidad ?? "")}${q.anio ? ` (${q.anio})` : ""}: ${md(q.titulo ?? "")}`);
    L.push("");
  }
  L.push("## III. Resultados", "");
  for (const o of d.observaciones) {
    L.push(`### Observación N.° ${o.numero}: ${md(o.sumilla)}`, "", `**Nivel del indicio:** ${nivelDelIndicio(o.severidad)}.`, "");
    L.push("**Condición**", "", ...o.condicion.map((x) => `${md(x)}\n`));
    L.push("**Criterio**", "", `Normativa vigente a la fecha ${o.criterio.base === "hecho" ? "del hecho" : "de la convocatoria"} (${fechaLarga(o.criterio.fecha) ?? "sin fecha"}): ${md(o.criterio.ley)}.`, "");
    for (const n of o.criterio.normas) {
      const titulo = `${tituloNorma(n)}${n.epigrafe ? ` (${n.epigrafe})` : ""}`;
      L.push(`- ${n.url ? enlaceMd(titulo, n.url) : md(titulo)}${n.version ? `, ${md(n.version)}` : ""}: «${md(n.extracto)}»`);
    }
    for (const r of o.criterio.referencias) L.push(`- Referencia de la señal: ${md(r)}`);
    L.push("", "**Efecto**", "", md(o.efecto), "", "**Causa**", "", md(o.causa), "", "**Evidencia**", "");
    for (const e of o.evidencia) L.push(`- ${enlaceMd(e.texto, e.copia ?? e.url)}${e.copia ? ` (${enlaceMd("original en el SEACE", e.url)})` : ""}`);
    for (const r of o.registros) {
      L.push("", `${md(r.titulo)}${r.total && r.total > r.filas.length ? ` (${r.filas.length} de ${r.total})` : ""}:`, "", `| ${r.columnas.map(md).join(" | ")} |`, `| ${r.columnas.map(() => "---").join(" | ")} |`);
      for (const f of r.filas) L.push(`| ${f.map((v) => md(v ?? "")).join(" | ")} |`);
    }
    L.push("", "**Precedentes**", "");
    if (o.precedentes.length) {
      for (const q of o.precedentes) L.push(`- ${q.url ? enlaceMd(`Informe N.° ${q.numero ?? q.codigo}`, q.url) : `Informe N.° ${md(q.numero ?? q.codigo)}`}, ${md(q.entidad ?? "")}${q.anio ? ` (${q.anio})` : ""}: ${md(q.observacion ?? q.titulo ?? "")}`);
    } else L.push("Sin observaciones comparables en los informes de control disponibles.");
    L.push("");
  }
  if (d.otrasSenales.length) L.push("### Otras señales del proceso (sin desarrollar)", "", ...d.otrasSenales.map((s) => `- ${md(s.etiqueta)} (nivel ${nivelDelIndicio(s.severidad)}; ${md(s.fuente)})`), "");
  L.push("## IV. Conclusión", "", md(d.conclusion[0]), "", ...d.conclusion.slice(1, -1).map((x) => `- ${md(x)}`), "", md(d.conclusion[d.conclusion.length - 1]), "");
  L.push("## V. Recomendaciones al órgano de control", "", ...d.recomendaciones.map((r, i) => `${i + 1}. ${md(r)}`), "");
  L.push("## Anexo: fuentes", "", ...d.fuentes.map((f) => `- ${enlaceMd(f.texto, f.url)}`), "");
  L.push(`Documento generado por ${md(d.general.elaboradoPor)}. Versión del redactor: ${d.version}.`);
  return L.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ─── Huella de las entradas ──────────────────────────────────────────────────────────────────────────────────────────

/** SHA-256 (hex) de un valor en JSON con las claves ordenadas (la misma huella para las mismas entradas). */
export async function huellaDe(valor: unknown): Promise<string> {
  const ordenado = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(ordenado) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, ordenado((v as Record<string, unknown>)[k])])) : v;
  const bytes = new TextEncoder().encode(JSON.stringify(ordenado(valor)));
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
