/**
 * La ficha de UN caso de un patrón (GET /patrones/caso/:tipo/:clave; backend/api/src/lib/casoPatron.ts). Pedido del usuario
 * del 2026-11-18: «cada patrón detectado debería tener una ficha propia, que cuente una historia, con nodos, secciones,
 * involucrados, timelines y demás, fuentes». Un solo molde para todos los patrones: la página lo cuenta en capítulos.
 */
import { API_BASE } from "@/lib/api-client";

export type SeveridadCaso = "alta" | "media" | "baja";

export interface NodoCaso {
  id: string;
  tipo: "entidad" | "empresa" | "persona" | "funcionario";
  nombre: string;
  rol: string;
  href?: string | null;
  monto?: number | null;
  ordenes?: number | null;
  severidad?: SeveridadCaso | null;
  datos?: { etiqueta: string; valor: string }[];
}
export interface AristaCaso {
  de: string;
  a: string;
  texto: string;
  tipo: "vende" | "socio" | "pariente" | "apellidos" | "otro";
}
export type TipoHito = "fundacion" | "socio" | "salida" | "primera" | "ultima" | "anio" | "dia" | "repartido" | "sobre_tope" | "otro";
export interface HitoCaso {
  fecha: string;
  hasta?: string | null;
  tipo: TipoHito;
  titulo: string;
  detalle?: string | null;
  monto?: number | null;
  severidad?: SeveridadCaso | null;
  nodos?: string[];
  href?: string | null;
  fuente: string;
}
export interface RazonCaso {
  titulo: string;
  cifra: string;
  texto: string;
  severidad: SeveridadCaso | null;
}
export interface FilaEvidencia {
  id: string;
  fecha: string | null;
  documento: string;
  quien: string | null;
  nodo?: string | null;
  que: string | null;
  monto: number | null;
  moneda?: string | null;
  estado?: string | null;
  marcas?: string[];
  href?: string | null;
}
export interface CasoPatron {
  tipo: string;
  clave: string;
  patron: string;
  titulo: string;
  severidad: SeveridadCaso;
  observacion?: boolean;
  frase: string;
  entidad: { ruc: string; nombre: string | null } | null;
  desde: string | null;
  hasta: string | null;
  cifras: { etiqueta: string; valor: string; contexto?: string | null }[];
  serie?: { titulo: string; etiquetaA: string; etiquetaB: string; anios: { anio: number; a: number; b: number; detalleA: string; detalleB: string }[] } | null;
  nodos: NodoCaso[];
  aristas: AristaCaso[];
  hitos: HitoCaso[];
  razones: RazonCaso[];
  evidencia: { titulo: string; total: number; filas: FilaEvidencia[]; nota?: string | null; masHref?: string | null };
  revisar: string[];
  fuentes: { texto: string; href: string }[];
  relacionados: { texto: string; href: string }[];
  como_leerlo: string;
}

/** Los patrones que ya tienen su ficha de caso (la sección de /app/patrones de cada uno). */
export const PATRONES_CON_CASO = new Set(["grupos", "compras", "repetidas", "recien"]);

/** La ficha de un caso: /app/patrones/caso/grupos/56ccbe973e4e3e3d. */
export const rutaCaso = (tipo: string, clave: string) => `/app/patrones/caso/${tipo}/${clave}`;

/** `null` = no existe; `"error"` = la API no respondió (no es lo mismo: la página lo dice distinto). */
export async function getCasoPatron(tipo: string, clave: string): Promise<CasoPatron | null | "error"> {
  if (!/^[a-z_]{3,30}$/.test(tipo) || !/^(?:[0-9a-f]{16}|[0-9a-f]{32})$/.test(clave)) return null;
  try {
    const r = await fetch(`${API_BASE}/patrones/caso/${tipo}/${clave}`, { next: { revalidate: 900 } } as RequestInit);
    if (r.status === 404) return null;
    return r.ok ? ((await r.json()) as CasoPatron) : "error";
  } catch {
    return "error";
  }
}
