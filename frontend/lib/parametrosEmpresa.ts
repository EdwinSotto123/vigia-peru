/**
 * Los parámetros de la URL de las pestañas Contratos y Órdenes de la ficha de una empresa. Aquí y no en sus secciones para
 * que un componente del navegador (las tablas de visitas de una entidad) arme sus enlaces sin traer la sección entera.
 */
export const P_CONTRATOS = { q: "cq", anio: "canio", como: "ccomo", entidad: "cent", objeto: "cobj", familia: "cfam", departamento: "cdep", bandera: "cband", dudoso: "cdud", cruce: "ccruce", orden: "cord", page: "cpag" } as const;
export const P_ORDENES = { q: "oq", anio: "oanio", tipo: "otipo", dudosa: "odud", entidad: "oent", departamento: "odep", estado: "oest", orden: "oord", page: "opag" } as const;
/** Los filtros de la pestaña Antecedentes (tipo y severidad): aquí para que un componente del navegador enlace a ella. */
export const P_ANTECEDENTES = { tipo: "atipo", gravedad: "agrav" } as const;
