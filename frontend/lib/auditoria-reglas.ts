/**
 * Etiquetas de reglas para las superficies que no cargan el catálogo. Salió de
 * lib/auditoria.ts, que lo reexporta: quien importaba `reglaLabel` desde ahí no cambia.
 */

/**
 * Etiquetas del catálogo de reglas (backend/api/src/data/reglas.json, versión 7929ab6: perfiles
 * + otras señales). Copia chica para superficies que no cargan el catálogo (server components,
 * tarjetas): antes se armaban del id y salía "Firmante con empresa rnp". Si una regla nueva no
 * está acá, se cae al id legible; el catálogo cargado (useReglasPerfil) siempre tiene prioridad.
 */
const ETIQUETA_REGLA: Record<string, string> = {
  ampliacion_denegada_penalidad: "Ampliación denegada y penalidad",
  ciiu_vs_objeto: "Giro del proveedor vs. objeto",
  concentracion_entidad: "Concentración en la entidad",
  directa_sin_fundamento: "Contratación directa sin sustento",
  fecha_buena_pro_incoherente: "Fechas de buena pro incoherentes",
  firmante_con_empresa_rnp: "Firmante con empresa en el RNP",
  firmante_vinculado_ganador: "Firmante vinculado al ganador",
  fraccionamiento: "Fraccionamiento",
  ganador_no_invitado: "Ganador no invitado",
  inconsistencia_doc_vs_ocds: "Documento vs. registro OCDS",
  lobby_visits_pre_convocatoria: "Visitas previas a la convocatoria",
  oferta_igual_valor_referencial: "Oferta igual al valor referencial",
  oferta_mas_barata_no_gana: "La oferta más barata no ganó",
  ofertas_agrupadas: "Ofertas agrupadas",
  plazo_convocatoria_minimo: "Plazo de convocatoria muy corto",
  postor_unico_mayoritario: "Postor mayoritario en la entidad",
  postores_vinculados_rnp: "Postores vinculados entre sí",
  procedimiento_no_competitivo: "Procedimiento no competitivo",
  proveedor_sancionado_osce: "Proveedor con sanción OSCE/OECE",
  ruc_ganador_muy_nuevo: "RUC del ganador muy reciente",
  ruc_ultra_nuevo: "Postor con RUC ultra reciente",
  testaferro_multi_ruc: "Misma persona en varios RUC",
  tipo_proceso_vs_monto: "Procedimiento vs. monto",
  unica_oferta_valida: "Única oferta válida",
  unico_postor_alto: "Único postor con oferta alta",
  personal_clave_vinculado: "Personal clave vinculado",
  adicional_acumulado: "Adicionales acumulados",
  directa_recurrente: "Contratación directa recurrente",
  red_flag_documental: "Requisito dirigido en las bases",
  objeto_no_corresponde_documento: "Objeto vs. documentos",
  sobreprecio_elevado: "Sobreprecio frente al mercado",
  cobertura_prensa_adversa: "Cobertura de prensa adversa",
  antecedentes_proveedor: "Antecedentes del proveedor",
  funcionario_con_historial_politico: "Funcionario con historial político",
  red_personas_vinculada: "Red de personas vinculada",
};

const SIGLAS = /\b(rnp|ruc|ciiu|oece|osce|ocds|sunat|onpe|jne|mef|pep)\b/gi;

export const reglaLabel = (regla: string) =>
  ETIQUETA_REGLA[regla] ??
  regla.replace(/_/g, " ").replace(SIGLAS, (s) => s.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
