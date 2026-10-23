/**
 * Las pestañas de la ficha de una empresa (/empresa/<RUC>), una función por pestaña. Las que pueden ser muy largas
 * (contratos, órdenes, postulaciones) se paginan en el servidor con sus filtros en la URL; las demás llegan enteras y se
 * paginan y se buscan en la página. Los nombres de personas llegan de la API con un apellido tapado y nunca se buscan.
 * Server components.
 */

export * from "./secciones/contratos";
export * from "./secciones/ordenes";
export * from "./secciones/clientes";
export * from "./secciones/postulaciones";
export * from "./secciones/antecedentes";
export * from "./secciones/socios";
export * from "./secciones/visitas";
