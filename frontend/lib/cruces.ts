/**
 * Catálogo de los cruces del ganador con otros registros públicos (cruces_proveedor / casos_cruce): grupos, nombre corto
 * y qué significa cada uno. Lo usan la columna de cruces de /app/contratos y su panel de tipos (TiposCruce).
 */
export type Severidad = "alta" | "media" | "baja";

/** Grupos de cruces, en el orden en que se muestran; cada tipo con una explicación corta de qué se cruzó. */
/**
 * `chip`: el nombre para un chip en una celda angosta (la lista de contratos, el mapa de poder). Uno por tipo y sólo
 * aquí, para que el mismo cruce no tenga tres nombres; el `corto` completo y el `explica` van en el title o en la ⓘ.
 */
export const GRUPOS_CRUCE: { titulo: string; tipos: { tipo: string; corto: string; explica: string; chip?: string }[] }[] = [
  {
    titulo: "Política",
    tipos: [
      { tipo: "partido_gobernante", chip: "Financió al partido", corto: "Financió al que gobierna", explica: "El ganador o un socio aportó al partido que gobierna la entidad (ONPE × JNE)." },
      { tipo: "vendio_gobernante", chip: "Vendió a su campaña", corto: "Vendió al que gobierna", explica: "El ganador o un socio le vendió a la campaña del partido que gobierna la entidad (ONPE × JNE)." },
      { tipo: "aporte", chip: "Aportó a un partido", corto: "Aportó a algún partido", explica: "El proveedor, o un socio o representante suyo, aportó a cualquier organización política, no necesariamente la que gobierna la entidad; la que gobierna es «Financió al que gobierna» (ONPE)." },
      { tipo: "aporte_empresa", corto: "La empresa aportó", explica: "La empresa ganadora aportó con su RUC a una organización política (ONPE)." },
      { tipo: "proveedor_campana", corto: "Vendió a una campaña", explica: "La empresa le facturó a una campaña electoral (gastos de campaña, ONPE Claridad)." },
      { tipo: "candidato", corto: "Fue candidato", explica: "El proveedor o un socio postuló en una elección (ONPE)." },
      { tipo: "autoridad", corto: "Autoridad electa", explica: "El proveedor o un socio es autoridad electa (JNE)." },
    ],
  },
  {
    titulo: "En el proceso",
    tipos: [
      { tipo: "socio_comun", chip: "Socio común", corto: "Socio común entre postores", explica: "Dos postores del mismo proceso comparten socio o representante (RNP): competencia aparente." },
      { tipo: "unico_postor", corto: "Único postor", explica: "El proceso tuvo un solo postor (OCDS): no hubo competencia real. Pesa más si además se adjudicó pegado al valor referencial o es millonario: posible direccionamiento." },
      { tipo: "socio_en_entidad", chip: "Socio en la entidad", corto: "Socio del proveedor trabaja en la entidad", explica: "Un socio o representante del ganador es, además, una persona contratada por la MISMA entidad que le dio el contrato (RNP × registro de contratados): conflicto de interés directo." },
      { tipo: "interes_declarado", chip: "Interés de un funcionario", corto: "Un funcionario declaró un interés en el ganador", explica: "Un funcionario de la entidad declaró en su Declaración Jurada de Intereses (Contraloría) tener acciones, un poder o un asiento en el directorio de la empresa que ganó: conflicto de interés directo." },
      { tipo: "empleo_declarado", chip: "Trabajó ahí un funcionario", corto: "Un funcionario trabajó para el ganador", explica: "Un funcionario de la entidad declaró en su Declaración Jurada de Intereses haber trabajado o asesorado a la empresa que ganó: puerta giratoria." },
      { tipo: "domicilio_compartido", chip: "Mismo domicilio", corto: "Mismo domicilio que otro participante", explica: "El ganador comparte su domicilio fiscal en la SUNAT con otra empresa que participó en el mismo proceso: posible competencia aparente o empresas vinculadas. Pesa más si la otra también presentó oferta. No cuentan las direcciones con más de 5 empresas (centros de oficinas)." },
      { tipo: "visita_previa", chip: "Visita previa", corto: "Visita antes de la buena pro", explica: "Un socio o representante visitó una entidad pública en los 180 días previos a la buena pro (registro de visitas)." },
      { tipo: "otro_postor", chip: "Buena pro de otro", corto: "Buena pro de otro postor", explica: "La buena pro fue primero de otro postor y se le adjudicó después a este, con su propia oferta (OCDS × CONOSCE): suele costar más." },
      { tipo: "sancion_vigente", corto: "Inhabilitado al ganar", explica: "Ganó la buena pro mientras tenía una inhabilitación vigente del Tribunal de Contrataciones: no podía contratar con el Estado." },
      { tipo: "empresa_espejo", chip: "Empresa espejo", corto: "Ganó mientras su empresa hermana estaba inhabilitada", explica: "Ganó la buena pro mientras otra empresa con la que comparte un socio, representante o directivo (RNP) estaba inhabilitada por el Tribunal de Contrataciones: puede ser la forma de seguir contratando con otra razón social. Pesa más si se fundó cerca de la sanción. No cuentan las personas que figuran en más de 10 empresas (apoderados de muchas)." },
      // Sobreprecio en bandas por cuánto pasa la mediana (migración 121).
      { tipo: "sobreprecio_extremo", chip: "Precio 3× o más", corto: "Precio 3 veces o más la mediana", explica: "El precio por unidad de un bien pasa 3 veces o más la mediana de lo que pagaron otras entidades por el mismo CUBSO y unidad (OCDS × CONOSCE): un sobreprecio extremo." },
      { tipo: "sobreprecio_alto", chip: "Precio 2 a 3×", corto: "Precio 2 a 3 veces la mediana", explica: "El precio por unidad pasa de 2 a 3 veces la mediana de otras entidades por el mismo CUBSO y unidad." },
      { tipo: "sobreprecio", chip: "Precio 1.5 a 2×", corto: "Precio 1.5 a 2 veces la mediana", explica: "El precio por unidad pasa de 1.5 a 2 veces la mediana de otras entidades. Puede tener explicación (poca cantidad, transporte, otra calidad)." },
    ],
  },
  {
    titulo: "Historial del proveedor",
    tipos: [
      // Sanción en bandas por el tipo de sanción del Tribunal (migración 121).
      { tipo: "sancion_definitiva", chip: "Inhabilitación definitiva", corto: "Inhabilitación definitiva antes", explica: "Tuvo una inhabilitación DEFINITIVA del Tribunal de Contrataciones antes de este proceso: la sanción más grave." },
      { tipo: "sancion_temporal", chip: "Inhabilitación temporal", corto: "Inhabilitación temporal antes", explica: "Tuvo una inhabilitación temporal del Tribunal antes de este proceso. Si además seguía vigente al ganar, también dice «Inhabilitado al ganar»." },
      { tipo: "sancion_multa", chip: "Multa del Tribunal", corto: "Multa del Tribunal antes", explica: "El Tribunal le puso una multa antes de este proceso (sin inhabilitación)." },
      { tipo: "penalidad", corto: "Penalidades", explica: "Le aplicaron penalidades en contratos anteriores." },
      // Adicionales en bandas por cuánto pasan el tope legal (25% bienes y servicios) (migración 121).
      { tipo: "adicional_sobre_tope", chip: "Adicionales sobre tope", corto: "Adicionales sobre el tope legal", explica: "El contrato sumó adicionales por más del 25% de lo contratado, el tope legal en bienes y servicios sin autorización de la Contraloría (CONOSCE)." },
      { tipo: "adicional_alto", chip: "Adicionales altos", corto: "Adicionales cerca del tope", explica: "El contrato sumó adicionales por entre 15% y 25% de lo contratado: cerca del tope legal." },
      { tipo: "adicional", chip: "Adicionales", corto: "Adicionales o prórrogas", explica: "El contrato tuvo adicionales (menos del 15%) o prórrogas (CONOSCE)." },
    ],
  },
  {
    titulo: "Patrón de compras",
    tipos: [
      { tipo: "fraccionamiento", chip: "Pasan 8 UIT", corto: "Órdenes que pasan 8 UIT", explica: "Recibió de la misma entidad, el mismo día, varias órdenes menores que juntas pasan el tope de 8 UIT (CONOSCE)." },
      // Proveedor recurrente en bandas por cuánto del gasto de la entidad concentra (migración 121).
      { tipo: "recurrente_dominante", chip: "Concentra el gasto", corto: "Concentra el gasto de la entidad", explica: "Se llevó la mitad o más de todo lo que esa entidad adjudicó desde 2018 (CONOSCE): un proveedor que domina sus compras." },
      { tipo: "recurrente_frecuente", chip: "Muchos procesos", corto: "Le ganó muchos procesos a la entidad", explica: "Le ganó 10 o más procesos a la misma entidad, o se llevó una parte importante (≥25%) de su gasto (CONOSCE)." },
      { tipo: "recurrente", chip: "Frecuente", corto: "Proveedor frecuente", explica: "Le ganó entre 3 y 9 procesos a la misma entidad (CONOSCE)." },
      { tipo: "proveedor_cautivo", chip: "Casi sólo esta entidad", corto: "Casi solo le vende a esta entidad", explica: "La empresa recibe la gran mayoría (≥75%) de todo lo que le compra el Estado de UNA sola entidad: dependencia fuerte. Distinto de «Concentra el gasto»: aquí es el proveedor el que depende de la entidad." },
    ],
  },
  {
    // Señales de la empresa desde la ficha RUC de la SUNAT (migración 116). Son hechos de la EMPRESA, no de un contrato.
    titulo: "Registro SUNAT",
    tipos: [
      { tipo: "recien_fundada_medio_ano", chip: "6 meses de fundada", corto: "Ganó con 6 meses o menos de fundada", explica: "Ganó este proceso del Estado a los 6 meses o menos de darse de alta en la SUNAT: muy nueva para ese contrato. No prueba nada por sí solo." },
      { tipo: "recien_fundada_un_ano", chip: "Menos de 1 año", corto: "Ganó con menos de 1 año de fundada", explica: "Ganó este proceso con entre 6 meses y 1 año desde su alta en la SUNAT. Pesa más si el contrato es millonario." },
      { tipo: "recien_fundada_dos_anos", chip: "Menos de 2 años", corto: "Ganó con menos de 2 años de fundada", explica: "Ganó este proceso con entre 1 y 2 años desde su alta en la SUNAT: una empresa todavía joven." },
      { tipo: "dada_de_baja", chip: "De baja (SUNAT)", corto: "Dada de baja en la SUNAT", explica: "Hoy figura dada de baja en la SUNAT. Es su estado actual; la SUNAT no publica desde cuándo, así que no se afirma que vendiera estando de baja." },
      { tipo: "suspendida", chip: "Suspendida (SUNAT)", corto: "Suspendida en la SUNAT", explica: "Hoy figura en suspensión temporal de actividades en la SUNAT." },
      { tipo: "no_habida", corto: "No habida", explica: "Hoy figura como «no habido» en la SUNAT: la autoridad no la ubica en su domicilio fiscal." },
    ],
  },
  {
    // La obra del contrato en INFOBRAS (Contraloría) y su inversión en Invierte.pe (MEF), migración 160. Son hechos de la
    // ejecución de ESTE contrato (la obra que construye o supervisa), no antecedentes de la empresa.
    titulo: "En la obra",
    tipos: [
      { tipo: "obra_paralizada_larga", chip: "Paralizada 6+ meses", corto: "Obra paralizada hace 6 meses o más", explica: "La obra de este contrato está paralizada hace 180 días o más según INFOBRAS, que la entidad registra. La causa puede ser de la entidad (falta de pago o de presupuesto) o del contratista." },
      { tipo: "obra_paralizada", chip: "Obra paralizada", corto: "Obra paralizada", explica: "La obra de este contrato está paralizada hoy, hace menos de 180 días, según INFOBRAS." },
      { tipo: "obra_paralizacion", chip: "Estuvo paralizada", corto: "La obra estuvo paralizada", explica: "La obra se paralizó en algún momento y después siguió o terminó (INFOBRAS dice cuántos días y por qué)." },
      { tipo: "obra_atraso_grave", chip: "Atraso de 40+ puntos", corto: "Obra atrasada 40 puntos o más", explica: "En ejecución, la obra lleva 40 puntos porcentuales o más de avance físico por debajo de lo que debía llevar a esa fecha (INFOBRAS)." },
      { tipo: "obra_atraso", chip: "Obra atrasada", corto: "Obra atrasada de 20 a 40 puntos", explica: "En ejecución, la obra lleva de 20 a 40 puntos porcentuales de avance físico por debajo de lo programado (INFOBRAS)." },
      { tipo: "obra_pagado_sin_avance", chip: "Pagada sin avance", corto: "Pagada 50 puntos por encima de lo construido", explica: "La ejecución financiera (lo pagado) pasa en 50 puntos o más al avance físico (lo construido), con la obra sin terminar (INFOBRAS)." },
      { tipo: "obra_pago_adelantado", chip: "Pago adelantado", corto: "Pagada 30 a 50 puntos por encima de lo construido", explica: "Lo pagado pasa en 30 a 50 puntos al avance físico de la obra (INFOBRAS). Puede haber un adelanto contractual: vale revisar." },
      { tipo: "obra_adicionales_sobre_tope", chip: "Adicionales sobre 15 %", corto: "Adicionales de obra por más del 15 %", explica: "La obra es por contrata y sus adicionales, restados los deductivos, pasan el 15 % del contrato: el tope que la ley permite sin la autorización previa de la Contraloría (INFOBRAS)." },
      { tipo: "obra_adicionales_altos", chip: "Adicionales sobre 10 %", corto: "Adicionales de obra por más del 10 %", explica: "Los adicionales de obra, restados los deductivos, pasan el 10 % del contrato (o del expediente técnico, si la obra no tiene contrato). En una obra por contrata, cerca del tope legal del 15 % (INFOBRAS)." },
      { tipo: "obra_adicionales", chip: "Adicionales de obra", corto: "La obra tuvo adicionales", explica: "La obra sumó adicionales (trabajos extra que se pagan aparte) por hasta el 10 % del contrato (INFOBRAS)." },
      { tipo: "obra_plazo_duplicado", chip: "Plazo duplicado", corto: "Plazo de la obra duplicado o más", explica: "Las ampliaciones de plazo suman el plazo original de la obra o más: se le dio el doble de tiempo (INFOBRAS)." },
      { tipo: "obra_plazo_ampliado", chip: "Plazo ampliado", corto: "Plazo ampliado a la mitad o más", explica: "Las ampliaciones de plazo suman la mitad del plazo original o más (INFOBRAS)." },
      { tipo: "obra_controversia", chip: "Controversia", corto: "Obra con controversias", explica: "INFOBRAS registra controversias entre la entidad y el contratista: arbitrajes o conciliaciones por pagos, plazos o adicionales." },
      { tipo: "obra_informe_control", chip: "Informe de control", corto: "Obra con informes de la Contraloría", explica: "La Contraloría emitió informes de control sobre esta obra: revisiones que señalan riesgos o problemas. No son una condena." },
      { tipo: "inversion_sobrecosto_extremo", chip: "Cuesta 2× o más", corto: "La inversión cuesta 2 veces o más lo aprobado", explica: "El costo actualizado de la inversión de este contrato es 2 veces o más el monto con que se declaró viable (Invierte.pe, MEF)." },
      { tipo: "inversion_sobrecosto", chip: "Cuesta 1.5× o más", corto: "La inversión cuesta 1.5 veces o más lo aprobado", explica: "El costo actualizado de la inversión es de 1.5 a 2 veces el monto con que se declaró viable, con S/ 100 mil de diferencia o más (Invierte.pe)." },
      { tipo: "inversion_laudo", chip: "Laudo arbitral", corto: "La inversión registra un laudo arbitral", explica: "Invierte.pe registra laudos arbitrales en la inversión de este contrato: la entidad y el contratista resolvieron una controversia en un arbitraje." },
    ],
  },
];

/** ¿Es una bandera de «En la obra» (INFOBRAS e Invierte.pe)? Hechos de la ejecución del contrato, no antecedentes de quien ganó. */
export const esTipoObra = (tipo: string) => tipo.startsWith("obra_") || tipo.startsWith("inversion_");
export const TIPOS_OBRA = GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => t.tipo)).filter(esTipoObra);

export const TIPO_CRUCE = Object.fromEntries(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t])));

/** El nombre de un cruce para un chip angosto (o su `corto` si no tiene uno más breve). */
export const chipCruce = (tipo: string): string => TIPO_CRUCE[tipo]?.chip ?? TIPO_CRUCE[tipo]?.corto ?? tipo;
