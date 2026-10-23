/**
 * Catálogo de los cruces del ganador con otros registros públicos (cruces_proveedor / casos_cruce): grupos, nombre corto
 * y qué significa cada uno. Lo usan la columna de cruces de /app/contratos y su panel de tipos (TiposCruce).
 */
export type Severidad = "alta" | "media" | "baja";

/** Grupos de cruces, en el orden en que se muestran; cada tipo con una explicación corta de qué se cruzó. */
export const GRUPOS_CRUCE: { titulo: string; tipos: { tipo: string; corto: string; explica: string }[] }[] = [
  {
    titulo: "Política",
    tipos: [
      { tipo: "partido_gobernante", corto: "Financió al que gobierna", explica: "El ganador o un socio aportó al partido que gobierna la entidad (ONPE × JNE)." },
      { tipo: "vendio_gobernante", corto: "Vendió al que gobierna", explica: "El ganador o un socio le vendió a la campaña del partido que gobierna la entidad (ONPE × JNE)." },
      { tipo: "aporte", corto: "Aportó a algún partido", explica: "El proveedor, o un socio o representante suyo, aportó a cualquier organización política, no necesariamente la que gobierna la entidad; la que gobierna es «Financió al que gobierna» (ONPE)." },
      { tipo: "aporte_empresa", corto: "La empresa aportó", explica: "La empresa ganadora aportó con su RUC a una organización política (ONPE)." },
      { tipo: "proveedor_campana", corto: "Vendió a una campaña", explica: "La empresa le facturó a una campaña electoral (gastos de campaña, ONPE Claridad)." },
      { tipo: "candidato", corto: "Fue candidato", explica: "El proveedor o un socio postuló en una elección (ONPE)." },
      { tipo: "autoridad", corto: "Autoridad electa", explica: "El proveedor o un socio es autoridad electa (JNE)." },
    ],
  },
  {
    titulo: "En el proceso",
    tipos: [
      { tipo: "socio_comun", corto: "Socio común entre postores", explica: "Dos postores del mismo proceso comparten socio o representante (RNP): competencia aparente." },
      { tipo: "visita_previa", corto: "Visita antes de la buena pro", explica: "Un socio o representante visitó una entidad pública en los 180 días previos a la buena pro (registro de visitas)." },
      { tipo: "otro_postor", corto: "Buena pro de otro postor", explica: "La buena pro fue primero de otro postor y se le adjudicó después a este, con su propia oferta (OCDS × CONOSCE): suele costar más." },
      { tipo: "sancion_vigente", corto: "Inhabilitado al ganar", explica: "Ganó la buena pro mientras tenía una inhabilitación vigente del Tribunal de Contrataciones: no podía contratar con el Estado." },
      // Sobreprecio en bandas por cuánto pasa la mediana (migración 121).
      { tipo: "sobreprecio_extremo", corto: "Precio 3 veces o más la mediana", explica: "El precio por unidad de un bien pasa 3 veces o más la mediana de lo que pagaron otras entidades por el mismo CUBSO y unidad (OCDS × CONOSCE): un sobreprecio extremo." },
      { tipo: "sobreprecio_alto", corto: "Precio 2 a 3 veces la mediana", explica: "El precio por unidad pasa de 2 a 3 veces la mediana de otras entidades por el mismo CUBSO y unidad." },
      { tipo: "sobreprecio", corto: "Precio 1.5 a 2 veces la mediana", explica: "El precio por unidad pasa de 1.5 a 2 veces la mediana de otras entidades. Puede tener explicación (poca cantidad, transporte, otra calidad)." },
    ],
  },
  {
    titulo: "Historial del proveedor",
    tipos: [
      // Sanción en bandas por el tipo de sanción del Tribunal (migración 121).
      { tipo: "sancion_definitiva", corto: "Inhabilitación definitiva antes", explica: "Tuvo una inhabilitación DEFINITIVA del Tribunal de Contrataciones antes de este proceso: la sanción más grave." },
      { tipo: "sancion_temporal", corto: "Inhabilitación temporal antes", explica: "Tuvo una inhabilitación temporal del Tribunal antes de este proceso. Si además seguía vigente al ganar, también dice «Inhabilitado al ganar»." },
      { tipo: "sancion_multa", corto: "Multa del Tribunal antes", explica: "El Tribunal le puso una multa antes de este proceso (sin inhabilitación)." },
      { tipo: "penalidad", corto: "Penalidades", explica: "Le aplicaron penalidades en contratos anteriores." },
      // Adicionales en bandas por cuánto pasan el tope legal (25% bienes y servicios) (migración 121).
      { tipo: "adicional_sobre_tope", corto: "Adicionales sobre el tope legal", explica: "El contrato sumó adicionales por más del 25% de lo contratado, el tope legal en bienes y servicios sin autorización de la Contraloría (CONOSCE)." },
      { tipo: "adicional_alto", corto: "Adicionales cerca del tope", explica: "El contrato sumó adicionales por entre 15% y 25% de lo contratado: cerca del tope legal." },
      { tipo: "adicional", corto: "Adicionales o prórrogas", explica: "El contrato tuvo adicionales (menos del 15%) o prórrogas (CONOSCE)." },
    ],
  },
  {
    titulo: "Patrón de compras",
    tipos: [
      { tipo: "fraccionamiento", corto: "Órdenes que pasan 8 UIT", explica: "Recibió de la misma entidad, el mismo día, varias órdenes menores que juntas pasan el tope de 8 UIT (CONOSCE)." },
      // Proveedor recurrente en bandas por cuánto del gasto de la entidad concentra (migración 121).
      { tipo: "recurrente_dominante", corto: "Concentra el gasto de la entidad", explica: "Se llevó la mitad o más de todo lo que esa entidad adjudicó desde 2018 (CONOSCE): un proveedor que domina sus compras." },
      { tipo: "recurrente_frecuente", corto: "Le ganó muchos procesos a la entidad", explica: "Le ganó 10 o más procesos a la misma entidad, o se llevó una parte importante (≥25%) de su gasto (CONOSCE)." },
      { tipo: "recurrente", corto: "Proveedor frecuente", explica: "Le ganó entre 3 y 9 procesos a la misma entidad (CONOSCE)." },
    ],
  },
  {
    // Señales de la empresa desde la ficha RUC de la SUNAT (migración 116). Son hechos de la EMPRESA, no de un contrato.
    titulo: "Registro SUNAT",
    tipos: [
      { tipo: "recien_fundada_medio_ano", corto: "Ganó con 6 meses o menos de fundada", explica: "Ganó este proceso del Estado a los 6 meses o menos de darse de alta en la SUNAT: muy nueva para ese contrato. No prueba nada por sí solo." },
      { tipo: "recien_fundada_un_ano", corto: "Ganó con menos de 1 año de fundada", explica: "Ganó este proceso con entre 6 meses y 1 año desde su alta en la SUNAT. Pesa más si el contrato es millonario." },
      { tipo: "recien_fundada_dos_anos", corto: "Ganó con menos de 2 años de fundada", explica: "Ganó este proceso con entre 1 y 2 años desde su alta en la SUNAT: una empresa todavía joven." },
      { tipo: "dada_de_baja", corto: "Dada de baja en la SUNAT", explica: "Hoy figura dada de baja en la SUNAT. Es su estado actual; la SUNAT no publica desde cuándo, así que no se afirma que vendiera estando de baja." },
      { tipo: "suspendida", corto: "Suspendida en la SUNAT", explica: "Hoy figura en suspensión temporal de actividades en la SUNAT." },
      { tipo: "no_habida", corto: "No habida", explica: "Hoy figura como «no habido» en la SUNAT: la autoridad no la ubica en su domicilio fiscal." },
    ],
  },
];

export const TIPO_CRUCE = Object.fromEntries(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t])));
