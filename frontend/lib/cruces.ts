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
      { tipo: "partido_gobernante", corto: "Partido que gobierna", explica: "El ganador o un socio aportó a la campaña del partido que gobierna la entidad, o le vendió a esa campaña (ONPE × JNE)." },
      { tipo: "aporte", corto: "Aportó a un partido", explica: "El proveedor, o un socio o representante suyo, figura como aportante de una organización política (ONPE)." },
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
      { tipo: "sancion_vigente", corto: "Ganó inhabilitado", explica: "Ganó mientras tenía una inhabilitación vigente del Tribunal de Contrataciones." },
    ],
  },
  {
    titulo: "Historial del proveedor",
    tipos: [
      { tipo: "sancion", corto: "Sancionado", explica: "Tiene sanciones del Tribunal de Contrataciones del Estado (OSCE)." },
      { tipo: "penalidad", corto: "Penalidades", explica: "Le aplicaron penalidades en contratos anteriores." },
      { tipo: "adicional", corto: "Adicionales o prórrogas", explica: "El contrato tuvo adicionales o prórrogas (CONOSCE)." },
    ],
  },
  {
    titulo: "Patrón de compras",
    tipos: [
      { tipo: "fraccionamiento", corto: "Órdenes que pasan 8 UIT", explica: "Recibió de la misma entidad, el mismo día, varias órdenes menores que juntas pasan el tope de 8 UIT (CONOSCE)." },
      { tipo: "recurrente", corto: "Proveedor frecuente", explica: "Ganó varios procesos de la misma entidad (CONOSCE)." },
    ],
  },
];

export const TIPO_CRUCE = Object.fromEntries(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t])));
