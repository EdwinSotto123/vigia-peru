export type PinTipo = "alerta" | "reporte" | "convergente";

export type Severidad = "alta" | "media" | "baja";

export interface Bandera {
  regla: string;
  norma: string;
  severidad: Severidad;
  evidencia: string;
  fuenteUrl: string;
  opinionOece: string | null;
}

export interface Alerta {
  id: string;
  codigoconvocatoria: string;
  entidad: string;
  rucEntidad: string;
  proveedor: string;
  rucProveedor: string;
  edadRucDias: number;
  unicoPostor: boolean;
  montoSoles: number;
  fechaBuenaPro: string;
  objeto: string;
  region: string;
  provincia: string;
  distrito: string;
  lat: number;
  lon: number;
  score: number;
  banderas: Bandera[];
  fuenteUrl: string;
}

export interface ReporteCiudadano {
  id: string;
  categoria:
    | "obra_paralizada"
    | "obra_fantasma"
    | "funcionario_sospechoso"
    | "irregularidad_general";
  descripcion: string;
  fotoUrl?: string;
  lat: number;
  lon: number;
  region: string;
  fecha: string;
  confirmado: boolean;
}

export interface Convergencia {
  id: string;
  alertaId: string;
  reporteIds: string[];
  lat: number;
  lon: number;
  resumen: string;
}

export interface Metricas {
  alertasActivas: number;
  reportesCiudadanos: number;
  casosConvergentes: number;
  contratosVigilados: number;
  montoVigiladoSoles: number;
}
