import type { Guia } from "@/components/patrones/GuiaPestana";

/**
 * Qué es, de dónde sale y cómo leer cada pestaña de la ficha del contrato (pedido del usuario del 2026-11-13: «no se
 * explica qué es cada una»). Una o dos oraciones por celda, en palabras de cualquiera; la pestaña trae el detalle.
 * Por la clave de la pestaña (`ETIQUETAS_FICHA` de ContratoDetalle.tsx).
 */
export const GUIA_FICHA: Record<string, Guia> = {
  resumen: {
    que: "La vista rápida del contrato: en qué va la lectura de Vigía, las fechas del proceso y los antecedentes de quien ganó.",
    fuente: "El registro del proceso en el SEACE (OECE) y el dictamen que escribió Vigía al leer sus documentos.",
    leer: "Empieza por las señales de arriba: cada una abre su evidencia. Una señal es un motivo para revisar, nunca una acusación.",
  },
  antecedentes: {
    que: "Lo que otros registros del Estado dicen de quien ganó, sus socios y representantes: sanciones, penalidades, aportes de campaña, visitas a la entidad y socios en común con otros postores.",
    fuente: "OECE (sanciones, penalidades y Tribunal), ONPE, JNE, registro de visitas, SUNAT y las órdenes de CONOSCE.",
    leer: "Alta, media o baja dice cuánto pesa cada uno. Pesa más lo que pasó antes de la convocatoria y con esta misma entidad. Cada renglón trae su documento.",
  },
  historia: {
    que: "Todo lo que pasó, en orden de fecha: el proceso, las visitas de la gente del ganador a la entidad, sus antecedentes y sanciones, y la obra.",
    fuente: "SEACE, el registro de visitas de la entidad, el OECE e INFOBRAS, cruzados por fecha.",
    leer: "Fíjate en lo que pasa justo antes de la convocatoria o de la buena pro: una visita, una sanción que acaba de vencer, un cambio de gestión.",
  },
  items: {
    que: "Lo que se compra, ítem por ítem: qué es, cuánto se pide y el valor referencial, que es lo que la entidad calculó que costaría.",
    fuente: "Las bases y el registro OCDS del proceso en el SEACE.",
    leer: "Mira el precio por unidad. Si hay comparación con otras entidades, un precio de 2 o 3 veces la mediana merece revisarse.",
  },
  postores: {
    que: "Quiénes presentaron oferta, cuánto ofrecieron, quiénes quedaron fuera y por qué.",
    fuente: "El acta de buena pro del SEACE, leída por Vigía, y el registro OCDS del proceso.",
    leer: "Si solo quedó el ganador o se descartó la oferta más baja, lee el motivo: puede ser legal o una formalidad como una firma o un formato.",
  },
  participantes: {
    que: "Las empresas que se registraron en el proceso. Registrarse no es ofertar: muchas solo descargan las bases.",
    fuente: "El registro de participantes del SEACE (OCDS y CONOSCE).",
    leer: "Muchos registrados y una sola oferta, o un solo participante en un rubro con muchos proveedores, merece una segunda mirada.",
  },
  adjudicacion: {
    que: "A quién se le dio la buena pro, por cuánto, y el contrato que se firmó: monto, fecha y plazo.",
    fuente: "La adjudicación y el contrato en el registro OCDS del SEACE y en CONOSCE.",
    leer: "Compara lo adjudicado con el valor referencial: casi el 100 % en un proceso sin competencia es un patrón a revisar.",
  },
  precios: {
    que: "Lo que se pagó por unidad, frente a lo que otras entidades del Estado pagaron por lo mismo.",
    fuente: "Otras compras del SEACE con el mismo código y unidad, Perú Compras y el catálogo de precios de Vigía.",
    leer: "Un precio muy por encima de la mediana es una señal. Puede tener explicación (poca cantidad, transporte a una zona lejana, otra calidad).",
  },
  citas: {
    que: "Las frases exactas de los documentos en que se apoya cada señal, con la página.",
    fuente: "Los documentos oficiales del proceso que la entidad subió al SEACE.",
    leer: "Abre el documento en la página citada y compruébalo tú: así se verifica una señal.",
  },
  cronograma: {
    que: "Las fechas de cada etapa del proceso: convocatoria, consultas, ofertas, buena pro y contrato.",
    fuente: "El cronograma publicado en el SEACE.",
    leer: "Pocos días entre la convocatoria y las ofertas, o fechas que cambian a última hora, dejan menos tiempo para competir.",
  },
  documentos: {
    que: "Las bases, las actas, el contrato y demás archivos del proceso, para que los leas tú.",
    fuente: "El SEACE (OECE). Vigía guarda una copia de los que leyó.",
    leer: "Las bases dicen qué se pedía; el acta, por qué ganó quien ganó; el contrato, lo que se firmó al final.",
  },
};
