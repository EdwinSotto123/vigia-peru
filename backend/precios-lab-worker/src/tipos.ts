/** Tipos compartidos del laboratorio de precios (vigia-precios-lab). */
import type { Rubro } from "./directorio.ts";

/** Lo que pide quien investiga (el panel, por la API). */
export interface Entrada {
  /** El producto en palabras («papel bond A4 75 g, paquete de 500 hojas»). */
  consulta: string;
  /** Especificación técnica o lo que dicen las bases (opcional, se resume). */
  especificacion?: string;
  /** Unidad en que se compara («unidad», «paquete», «kg», «galón»). */
  unidad?: string;
  cantidad?: number;
  /** Precio unitario a comparar (p. ej. lo que pagó la entidad), en soles. */
  precioReferencia?: number;
  /** Referencias del Estado que trae la API (procesos y compras menores del mismo CUBSO). */
  referencias?: ReferenciaEstado[];
  /** El contrato e ítem de donde sale (para enlazar). */
  ocid?: string;
  item?: number;
  /** Preguntar también a las tiendas del directorio (paso «buscadores»). Por defecto sí. Se llama `web` porque antes
   * era la búsqueda web (Tavily), que el directorio reemplazó el 2026-11-12. */
  web?: boolean;
  /** Páginas que quien investiga ya encontró: se leen como las de la web (hasta 10). */
  urls?: string[];
  /** Quién la pidió (correo del panel), para la bitácora. */
  autor?: string;
}

export interface ReferenciaEstado {
  fuente: string;
  detalle: string;
  unidad: string | null;
  n: number;
  p25: number | null;
  mediana: number;
  p75: number | null;
}

/** Lo que el modelo entendió del pedido (paso «entender»). */
export interface Ficha {
  nombre: string;
  categoria: string;
  atributos: { nombre: string; valor: string; obligatorio: boolean }[];
  unidad_base: string;
  busquedas: string[];
  busqueda_web: string;
  excluir: string[];
  /** Rubros del directorio de tiendas (directorio.ts): a qué tiendas preguntar. */
  rubros: Rubro[];
}

export type Fuente = "tienda" | "buscador" | "web";
export type Extraccion =
  | "api_tienda"
  | "json_ld"
  | "microdatos"
  | "open_graph"
  | "ia"
  | "navegador_json_ld"
  | "navegador_ia"
  // Crawl4AI en el contenedor: una ficha de producto armada con JavaScript, o el buscador de una tienda.
  | "contenedor_json_ld"
  | "contenedor_ia"
  | "listado_json_ld"
  | "listado_ia";
export type Coincidencia = "exacta" | "equivalente" | "distinta" | "sin_juicio";

/** Una oferta encontrada, antes y después de juzgarla. */
export interface Oferta {
  n: number;
  fuente: Fuente;
  tienda: string;
  titulo: string;
  marca: string | null;
  url: string;
  precio: number | null;
  moneda: string | null;
  disponibilidad: string | null;
  extraccion: Extraccion;
  /** El precio aparece también en el texto visible de la página (validación cruzada). */
  confirmado: boolean | null;
  vendedor: string | null;
  /** Unidad o multiplicador que da la tienda («kg», «x12»), para el juicio. */
  presentacion?: string | null;
  similitud?: number | null;
  coincidencia?: Coincidencia;
  unidades?: number | null;
  razon?: string | null;
  precioUnitario?: number | null;
  valida?: boolean;
  motivo?: string | null;
  evidencia?: string | null;
}

/** Lo que sale de leer una página (paso «extraer»). */
export interface Lectura {
  titulo: string | null;
  marca: string | null;
  precio: number | null;
  moneda: string | null;
  disponibilidad: string | null;
  metodo: "json_ld" | "microdatos" | "open_graph" | null;
  /** El bloque de donde salió el precio (JSON-LD o la etiqueta), recortado: es la evidencia. */
  fragmento: string | null;
}

export interface Resumen {
  n: number;
  validas: number;
  minimo: number | null;
  p25: number | null;
  mediana: number | null;
  p75: number | null;
  maximo: number | null;
  porFuente: Record<string, number>;
  referencia: number | null;
  razon: number | null;
  veredicto: string;
  nota: string;
}

/** Lo que gastó cada investigación. */
export interface Gasto {
  tokensEntrada: number;
  tokensSalida: number;
  costoModelo: number;
  busquedasWeb: number;
  costoWeb: number;
  segundosNavegador: number;
  /** Crawl4AI en el contenedor de Cloudflare (lector.ts). */
  segundosContenedor: number;
}

export const gastoVacio = (): Gasto => ({ tokensEntrada: 0, tokensSalida: 0, costoModelo: 0, busquedasWeb: 0, costoWeb: 0, segundosNavegador: 0, segundosContenedor: 0 });
