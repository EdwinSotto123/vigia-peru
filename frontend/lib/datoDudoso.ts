/**
 * Datos que el Estado publicó y no se pueden creer (migración 102): Vigía los guarda y los muestra tal como vienen, con
 * una bandera de «posible error de carga», y no los suma ni los usa para comparar. Cada uno trae su motivo.
 */

export const MOTIVOS_DUDOSO = [
  "igual_ruc", "igual_numero", "mayor_100m", "tope_uit", "persona_sin_proceso",
  "negativo", "total_no_cuadra", "mes_1m", "sueldo_100k",
  "referencial_simbolico", "adjudicado_20x",
  // Obras de INFOBRAS e inversiones de Invierte.pe (migración 160).
  "avance_imposible", "financiero_imposible", "adicionales_imposibles", "plazo_imposible", "fecha_imposible", "costo_imposible",
] as const;
export type MotivoDudoso = (typeof MOTIVOS_DUDOSO)[number];

export const MOTIVO_DUDOSO: Record<MotivoDudoso, { corto: string; explica: string }> = {
  igual_ruc: { corto: "El monto es un RUC", explica: "En la casilla del monto la entidad escribió el RUC del proveedor." },
  igual_numero: { corto: "El monto es el número de la orden", explica: "En la casilla del monto la entidad escribió el número de la orden." },
  mayor_100m: { corto: "Más de S/ 100 millones", explica: "Pasa de S/ 100 millones: ninguna orden de compra o de servicio llega a tanto." },
  tope_uit: { corto: "20 veces su tope", explica: "Es una contratación «hasta 8 UIT» y el monto pasa 20 veces ese tope." },
  persona_sin_proceso: { corto: "S/ 1 M a una persona", explica: "Más de S/ 1 millón a una persona natural en una orden sin proceso de selección." },
  negativo: { corto: "Montos negativos", explica: "La planilla de ese mes trae montos negativos." },
  total_no_cuadra: { corto: "El total no cuadra", explica: "El total del mes no sale de la suma de sus partes (remuneración, honorarios, beneficios)." },
  mes_1m: { corto: "Más de S/ 1 millón en un mes", explica: "La planilla trae más de S/ 1 millón para una persona en un solo mes." },
  sueldo_100k: {
    corto: "Sueldo de S/ 100 mil o más",
    explica: "Un sueldo de S/ 100 mil o más en un mes: el más alto del Estado no llega a S/ 40 mil. Es un error o un pago acumulado de varios meses.",
  },
  referencial_simbolico: { corto: "Valor referencial de S/ 1", explica: "El valor referencial publicado es S/ 1 o menos: no se publicó el real." },
  adjudicado_20x: {
    corto: "20 veces el valor referencial",
    explica: "Lo adjudicado es 20 veces o más el valor referencial de todo el proceso: suelen ser decimales corridos o un valor mal escrito.",
  },
  avance_imposible: { corto: "Avance de más del 100 %", explica: "El avance físico registrado pasa el 100 % (o es negativo): una obra no puede estar construida más de una vez." },
  financiero_imposible: {
    corto: "Ejecución financiera imposible",
    explica: "La ejecución financiera registrada pasa el 300 % del costo de la obra: suele ser un monto escrito en la casilla del porcentaje.",
  },
  adicionales_imposibles: { corto: "Adicionales imposibles", explica: "Los adicionales registrados pasan tres veces el costo de toda la obra: suele ser un error al escribir el monto." },
  plazo_imposible: { corto: "Ampliación imposible", explica: "Las ampliaciones de plazo registradas pasan veinte veces el plazo de la obra." },
  fecha_imposible: { corto: "Fecha imposible", explica: "Una fecha registrada (de inicio o de paralización) es posterior al día en que se publicó el dato." },
  costo_imposible: { corto: "Costo imposible", explica: "El costo actualizado pasa mil veces el monto con que se declaró viable la inversión." },
};

/** El motivo, si la API manda uno que la web conoce. */
export const motivoDudoso = (m: unknown): MotivoDudoso | null =>
  typeof m === "string" && (MOTIVOS_DUDOSO as readonly string[]).includes(m) ? (m as MotivoDudoso) : null;

/** Quién publicó el dato, para el aviso. */
export const FUENTE_DUDOSO = {
  conosce_ordenes: "CONOSCE del OECE",
  pte_personal: "la entidad en su Portal de Transparencia",
  oece_ocds: "el SEACE del OECE",
  infobras: "la entidad en INFOBRAS (Contraloría)",
  invierte_pe: "la entidad en Invierte.pe (MEF)",
} as const;
export type FuenteDudoso = keyof typeof FUENTE_DUDOSO;

/** Quién cargó el dato, en la bandera y el aviso: «Posible error de CONOSCE», «Puede ser un error de la entidad…». */
export const QUIEN_CARGA: Record<FuenteDudoso, string> = {
  conosce_ordenes: "de CONOSCE",
  pte_personal: "de la entidad",
  oece_ocds: "del SEACE",
  infobras: "de la entidad en INFOBRAS",
  invierte_pe: "de la entidad en Invierte.pe",
};
