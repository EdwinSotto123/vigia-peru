/*
 * Rutas que se auditan. Los ids reales (contrato, entidad, partido, zona, revisión) se resuelven en
 * auditar.mjs contra la API para medir pantallas con datos de verdad; si la API no responde se usan los
 * de respaldo de `ids`.
 */

/** Ids de respaldo (verificados contra la API pública el 2026-10-11). */
export const ids = {
  ocidLeido: "1248872", // contrato con riesgo alto, leído
  ocidSinLeer: "1256450", // contrato sin analizar
  rucEntidad: "20406325815", // Gobierno Regional de Puno, Sede Central
  partido: "partido-democratico-somos-peru",
  zona: "21", // Puno
  revisionId: null, // se resuelve contra el panel; si no hay, se omite
};

/**
 * @param {typeof ids} i
 * @returns {{id:string, ruta:string, grupo:"app"|"admin", nota?:string}[]}
 */
export function rutas(i = ids) {
  const app = [
    ["app-inicio", "/app"],
    ["app-mapa", "/app/mapa"],
    ["app-contratos", "/app/contratos"],
    ["app-contrato-leido", `/app/contratos/${i.ocidLeido}`, "ficha de un contrato leído"],
    ["app-contrato-sin-leer", `/app/contratos/${i.ocidSinLeer}`, "ficha de un contrato sin leer"],
    ["app-alertas", "/app/alertas"],
    ["app-hallazgos", "/app/hallazgos"],
    ["app-entidades", "/app/entidades"],
    ["app-entidad-ficha", `/entidad/${i.rucEntidad}`, "ficha de una entidad"],
    ["app-partidos", "/app/partidos"],
    ["app-partido-ficha", `/app/partidos/${i.partido}?anio=2022`],
    ["app-financiar", "/app/financiar"],
    ["app-financiar-zona", `/app/financiar/${i.zona}`],
    ["app-financiar-entidades", "/app/financiar/entidad"],
    ["app-financiar-por-partido", "/app/financiar?por=partido&anio=2022"],
    ["app-financiar-por-partido-region", "/app/financiar?por=partido&anio=2022&region=15"],
    ["app-financiar-por-entidad", "/app/financiar?por=entidad"],
    ["app-financiar-entidad", `/app/financiar/entidad/${i.rucEntidad}`],
    ["app-financiar-partido", `/app/financiar/partido/${i.partido}?anio=2022`],
    ["app-aliados", "/app/aliados"],
    ["app-auditoria", "/app/auditoria"],
    ["app-auditoria-ficha", `/app/auditoria/${i.ocidLeido}`, "auditoría en vivo de un contrato"],
    ["app-denuncias", "/app/denuncias"],
    ["app-reporte", "/reporte/nuevo", "formulario de denuncia de obra, tres columnas"],
    ["app-reporte-entidad", "/reporte/nuevo?modo=entidad", "formulario de denuncia a una entidad"],
    ["app-convocatoria", "/app/convocatoria"],
    ["app-mi-impacto", "/app/mi-impacto", "pide cuenta: se audita lo que ve alguien sin sesión"],
    ["app-configuracion", "/app/configuracion", "pide cuenta: se audita lo que ve alguien sin sesión"],
  ].map(([id, ruta, nota]) => ({ id, ruta, grupo: "app", nota }));

  const admin = [
    ["admin-resumen", "/admin"],
    ["admin-financiadores", "/admin/financiadores"],
    ["admin-contribuciones", "/admin/contribuciones"],
    ["admin-pagos", "/admin/pagos"],
    ["admin-procesamientos", "/admin/procesamientos"],
    ["admin-clasificacion", "/admin/clasificacion"],
    ["admin-cobertura", "/admin/cobertura"],
    ["admin-analisis", "/admin/analisis"],
    ["admin-revision", "/admin/revision"],
    ...(i.revisionId ? [["admin-revision-ficha", `/admin/revision/${i.revisionId}`]] : []),
    ["admin-equipo", "/admin/equipo"],
    ["admin-bitacora", "/admin/bitacora"],
  ].map(([id, ruta, nota]) => ({ id, ruta, grupo: "admin", nota }));

  return [...app, ...admin];
}

export const VIEWPORTS = [
  { nombre: "1440", w: 1440, h: 900 },
  { nombre: "390", w: 390, h: 844 },
];
