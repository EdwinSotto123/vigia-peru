import { API_BASE } from "@/lib/api-client";
import { conAcentos } from "@/lib/financiamiento";
import type { ContribucionAliado } from "./CadenaAliado";

/**
 * Lectura del perfil de un aliado, compartida por su página y por su imagen para
 * compartir (Open Graph): las dos se alimentan del mismo lugar, así que no se pueden
 * contradecir. Sólo aliados reales, del API: un slug que no existe es `null` (o sea 404).
 */

export interface AliadoPerfil {
  /** El API lo devuelve como string. */
  id: number | string;
  tipo: "empresa" | "persona" | "organizacion";
  nombre: string;
  slug: string;
  logoUrl: string | null;
  desde: string;
  /**
   * Lo que le da cara propia al aliado en su ficha (migración 30). Opcionales: `GET
   * /financiamiento/aliados/:slug` devuelve `null` en lo que el aliado no publicó, y
   * sin la migración no los trae.
   */
  descripcion?: string | null;
  web?: string | null;
  /**
   * Correo de CONTACTO público, que el aliado decide mostrar (columna `email_publico`,
   * migración 30). Nunca `financiadores.email`, que es privado y sólo sirve para el pago.
   */
  email?: string | null;
  /** Sus redes, como enlaces completos. Sólo las que el aliado pidió publicar. */
  redes?: Partial<Record<RedSocial, string>> | null;
  /** Imagen de portada del perfil (opcional). Sin ella, la portada es la franja textil. */
  portadaUrl?: string | null;
}

export type RedSocial = "facebook" | "instagram" | "linkedin" | "x" | "tiktok" | "youtube";

export interface PerfilAliado {
  aliado: AliadoPerfil;
  contribuciones: ContribucionAliado[];
}

/**
 * `revalidate` se pasa a mano porque en Next 14 el TTL de una ruta es el MÍNIMO de
 * todos sus fetches: el perfil quiere 30 s; su imagen para compartir, 300.
 */
export async function getPerfilAliado(slug: string, revalidate = 30): Promise<PerfilAliado | null> {
  try {
    const r = await fetch(`${API_BASE}/financiamiento/aliados/${encodeURIComponent(slug)}`, {
      next: { revalidate },
    } as any);
    if (!r.ok) return null;
    const data = (await r.json()) as { aliado: AliadoPerfil; contribuciones: ContribucionAliado[] };
    return {
      aliado: data.aliado,
      contribuciones: (data.contribuciones ?? []).map((c) => ({ ...c, zona: conAcentos(c.zona) })),
    };
  } catch {
    return null;
  }
}

export interface RegionAlcanzada {
  ubigeo: string;
  zona: string;
  aportes: number;
  contratos: number;
  procesados: number;
  senales: number;
}

export interface ResumenPerfil {
  aportes: number;
  financiados: number;
  leidos: number;
  conSenal: number;
  enRevision: number;
  /** Leídos que salieron limpios: ni señal publicada ni revisión pendiente. */
  sinSenal: number;
  /** Zonas (región, provincia o distrito) donde cayeron sus aportes, tal como se financiaron. */
  regiones: RegionAlcanzada[];
  /**
   * Regiones (departamentos) distintas que alcanzó: los dos primeros dígitos del ubigeo.
   * Contar zonas como regiones decía "7 regiones" cuando Huaral (1506) y Lima (15) son
   * la misma región; /app/financiar, que cuenta departamentos, decía 6.
   */
  regionesDistintas: number;
}

/**
 * Agrega la línea de aportes en las cifras que la ficha y el panel muestran.
 * Una sola función para que el perfil, su resumen y su imagen sumen igual.
 */
export function resumirContribuciones(contribuciones: ContribucionAliado[]): ResumenPerfil {
  const porZona = new Map<string, RegionAlcanzada>();
  let financiados = 0;
  let leidos = 0;
  let conSenal = 0;
  let enRevision = 0;

  for (const c of contribuciones) {
    financiados += c.contratos;
    leidos += c.procesados;
    conSenal += c.senales;
    enRevision += c.enRevision ?? 0;
    const previa = porZona.get(c.ubigeo);
    if (previa) {
      previa.aportes += 1;
      previa.contratos += c.contratos;
      previa.procesados += c.procesados;
      previa.senales += c.senales;
    } else {
      porZona.set(c.ubigeo, {
        ubigeo: c.ubigeo,
        zona: c.zona,
        aportes: 1,
        contratos: c.contratos,
        procesados: c.procesados,
        senales: c.senales,
      });
    }
  }

  return {
    aportes: contribuciones.length,
    financiados,
    leidos,
    conSenal,
    enRevision,
    sinSenal: Math.max(0, leidos - conSenal - enRevision),
    regiones: [...porZona.values()].sort((a, b) => b.contratos - a.contratos || a.zona.localeCompare(b.zona, "es")),
    regionesDistintas: new Set(contribuciones.map((c) => c.ubigeo.slice(0, 2))).size,
  };
}
