/**
 * Las pestañas del dictamen (`?vista=dictamen&tab=`), con su nombre: las usan el informe (ResultadoView, en el navegador)
 * y la página del contrato (en el servidor, para la ruta de navegación y para saber qué `tab` existe). Un módulo sin
 * cliente: lo que exporta un "use client" no se puede leer desde el servidor.
 */

export type ClaveDictamen = "historia" | "resumen" | "dictamen" | "control" | "obra" | "items" | "proveedor" | "documentos" | "prensa" | "trace";

export const ETIQUETAS_DICTAMEN: Record<ClaveDictamen, string> = {
  historia: "La historia",
  resumen: "Señales",
  dictamen: "Dictamen",
  // Las señales y su evidencia con la forma de un informe de control (sections/PanelInformeControl.tsx).
  control: "Informe para control",
  obra: "La obra",
  items: "Ítems y mercado",
  proveedor: "Proveedor y red",
  documentos: "Documentos",
  prensa: "Prensa",
  trace: "Cómo se hizo",
};

/** La primera pestaña (no va a la URL). */
export const PRIMERA_DICTAMEN: ClaveDictamen = "historia";

export const esClaveDictamen = (t: unknown): t is ClaveDictamen => typeof t === "string" && Object.prototype.hasOwnProperty.call(ETIQUETAS_DICTAMEN, t);
