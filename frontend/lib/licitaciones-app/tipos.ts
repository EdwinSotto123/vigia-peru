/**
 * El contrato de datos de la app de Gobserva Licitaciones (docs/PLAN.md). La UI sólo conoce estos tipos; de dónde salen
 * (la muestra de demostración o la API en vivo) lo decide el adaptador (fuente.ts).
 */

export type NivelSenal = "alta" | "media" | "info";
export type ClaveSenal = "unico_postor" | "concentracion" | "tope_referencial" | "sin_valor" | "consultas_cortas";

/** Una señal de riesgo: un hecho con cifras, nunca una acusación. */
export interface Senal {
  clave: ClaveSenal;
  nivel: NivelSenal;
  titulo: string;
  evidencia: string;
}

export interface Entidad {
  ruc: string | null;
  nombre: string | null;
}

/** Una fila de la bandeja. */
export interface Oportunidad {
  /** El OCID del OECE. */
  id: string;
  codigo: string | null;
  objeto: string | null;
  tipo: string | null;
  procedimiento: string | null;
  /** Valor referencial en soles; null si la entidad no lo publicó. */
  valor: number | null;
  /** Fecha de convocatoria (ISO). */
  publicada: string;
  /** Fin de consultas y observaciones (ISO), si se publicó. */
  consultasHasta: string | null;
  entidad: Entidad;
  /** Ubigeo de la región (dos dígitos). */
  region: string | null;
  items: number;
  senales: Senal[];
}

export interface Conteo {
  clave: string;
  n: number;
}

export interface ResultadoBandeja {
  data: Oportunidad[];
  total: number;
  /** La página que se devolvió (si se pidió una más allá del final, la última). */
  pagina: number;
  tamano: number;
  paginas: number;
  facetas: { tipo: Conteo[]; region: Conteo[]; proc: Conteo[] };
  /** conSenales: null cuando el adaptador no lo sabe para todo el resultado (en vivo). */
  resumen: { valorTotal: number; conValor: number; entidades: number; conSenales: number | null; vencenSemana: number };
}

export interface Item {
  posicion: number;
  descripcion: string | null;
  cantidad: number | null;
  unidad: string | null;
  cubso: string | null;
  cubsoNombre: string | null;
  valor: number | null;
  estado: string | null;
}

export interface Documento {
  titulo: string;
  url: string;
  tipo: string | null;
  fecha: string | null;
  formato: string | null;
}

/** Un paso del cronograma. Sin fecha: está en el cronograma oficial del SEACE, no en los datos abiertos. */
export interface Hito {
  clave: "convocatoria" | "consultas_desde" | "consultas_hasta" | "integracion" | "ofertas" | "buena_pro";
  etiqueta: string;
  fecha: string | null;
}

export interface ProveedorTop {
  ruc: string;
  nombre: string | null;
  procesos: number;
  monto: number | null;
}

/** El comprador en los últimos 12 meses (CONOSCE). */
export interface Comprador {
  procesos: number;
  monto: number;
  adjSobreRef: number | null;
  conPostores: number;
  postoresPromedio: number | null;
  unSoloPostor: number;
  proveedores: ProveedorTop[];
}

/** Un proceso parecido ya adjudicado, con su precio unitario. */
export interface Parecido {
  id: string;
  codigo: string | null;
  descripcion: string | null;
  entidad: string | null;
  departamento: string | null;
  fecha: string | null;
  unidad: string | null;
  cantidad: number | null;
  unitRef: number | null;
  unitAdj: number | null;
  adjudicado: number | null;
  /** Sólo empresas (RUC 20): una persona natural sale sin nombre. */
  proveedor: string | null;
}

export interface PrecioRef {
  cubso: string;
  unidad: string;
  anio: number;
  n: number;
  entidades: number;
  p25: number | null;
  mediana: number | null;
  p75: number | null;
}

export interface DetalleOportunidad extends Oportunidad {
  descripcion: string | null;
  etapa: string | null;
  provincia: string | null;
  itemsDetalle: Item[];
  documentos: Documento[];
  cronograma: Hito[];
  comprador: Comprador | null;
  parecidos: Parecido[];
  precios: PrecioRef[];
  enlaces: { seace: string; busqueda: string | null };
}
